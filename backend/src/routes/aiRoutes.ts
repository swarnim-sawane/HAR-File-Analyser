import { Router, Request, Response as ExpressResponse } from 'express';
import { randomUUID } from 'crypto';
import {
  buildOracleKbPrompt,
  buildOracleSpecificityTokens,
  detectOracleProductsFromContext,
  type DetectedOracleProduct,
} from '../utils/oracleProductKb';
import {
  buildDeterministicInsights,
  getEmptyInsightsSummary,
  mergeDeterministicInsights,
  normalizeInsightsSourceType,
  type InsightsSourceType,
} from '../utils/insightRules';
import { getOpenAiConfig, getOpenAiConfigurationError, type OpenAiConfig } from '../config/openAiConfig';
import {
  extractOpenAiResponseMetadata,
  recordAiUsageEvent,
  type AiUsageOperation,
  type OpenAiResponseMetadata,
} from '../services/aiUsageService';

const router = Router();
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

type HealthLevel = 'critical' | 'degraded' | 'warning' | 'healthy';
type InsightSectionType =
  | 'analyzer_evidence'
  | 'critical_issues'
  | 'performance'
  | 'security'
  | 'recommendations';
type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
type InsightStage = 'starting' | 'analyzing' | 'finalizing';

interface InsightFinding {
  severity: FindingSeverity;
  title: string;
  product?: string;
  component?: string;
  what: string;
  why: string;
  evidence: string;
  fix: string;
  srGuidance?: string;
}

interface InsightSection {
  type: InsightSectionType;
  title: string;
  findings: InsightFinding[];
}

interface InsightsResult {
  overallHealth: HealthLevel;
  summary: string;
  sections: InsightSection[];
  detectedProducts?: Array<{
    product: string;
    shortName: string;
    components: string[];
    matchedUrls: string[];
  }>;
}

export interface InsightsGenerationResponse {
  result: InsightsResult;
  ai: {
    source: 'openai' | 'deterministic_fallback';
    fallbackReason?: string;
  };
}

export interface GenerateInsightsOptions {
  allowDeterministicFallback?: boolean;
  requestId?: string;
}

const HEALTH_VALUES: HealthLevel[] = ['critical', 'degraded', 'warning', 'healthy'];
const SECTION_VALUES: InsightSectionType[] = [
  'analyzer_evidence',
  'critical_issues',
  'performance',
  'security',
  'recommendations',
];
const SEVERITY_VALUES: FindingSeverity[] = ['critical', 'high', 'medium', 'low'];

const SECTION_LABELS: Record<InsightSectionType, string> = {
  analyzer_evidence: 'Analyzer Evidence',
  critical_issues: 'Critical Issues',
  performance: 'Performance',
  security: 'Security',
  recommendations: 'Recommendations',
};

const SEVERITY_PRIORITY: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const SECTION_PRIORITY: Record<InsightSectionType, number> = {
  analyzer_evidence: 0,
  critical_issues: 1,
  performance: 2,
  security: 3,
  recommendations: 4,
};

const SOFT_TIMEOUT_MS = 20000;
const HARD_TIMEOUT_MS = 105000;
// 55s: models can pause mid-generation without being stalled — this gives enough room without
// exceeding the 105s hard limit. Previously 30s was cutting off legitimate slow responses.
const UPSTREAM_INACTIVITY_MS = 55000;
const STATUS_UPDATE_INTERVAL_MS = 5000;
const MAX_AI_CONTEXT_CHARS = 1_000_000;
const MAX_AI_CHAT_MESSAGES = 50;
const MAX_AI_CHAT_INPUT_CHARS = 500_000;

const INSIGHTS_SYSTEM_PROMPT = `You are an Oracle Support Analyst helping L1/L2 engineers triage issues from HAR traces and browser console logs.
Return ONLY a strict JSON object. No markdown. No prose outside JSON.

Schema:
{"overallHealth":"critical|degraded|warning|healthy","summary":"one sentence","sections":[{"type":"critical_issues|performance|security|recommendations","title":"string","findings":[{"severity":"critical|high|medium|low","title":"string","product":"ORDS|ADF|VBCS|Forms|OIC|Fusion Apps|IDCS|OAC|OCI|CPQ (omit if N/A)","component":"sub-component name (omit if N/A)","what":"what HAR or console evidence shows — request counts, status codes, timings, browser policy errors","why":"root cause referencing Oracle product internals","evidence":"URL path, status code, timing in ms, browser error, or header name","fix":"actionable step — reference Oracle config path, admin UI, proxy policy, or SQL","srGuidance":"logs/diagnostics to collect for SR: log file path, diagnostic level, SQL trace command (omit for low severity)"}]}]}

Rules:
- Only include findings with concrete HAR or console evidence (URL, status code, ms timing, browser policy error, header).
- Fix must be specific — name Oracle config files, admin UI paths, or SQL. No vague "check logs".
- srGuidance must name specific Oracle artifacts: WLS server log path, ORDS log, ADFLogger level, AWR/ASH, fmw_diag.
- Name the Oracle product and component in every finding when products are detected.
- Max 3 findings per section, 3 sections max. Highest severity first.
- STRICT ANALYSIS ORDER — always exhaust higher tiers before lower ones:
  1. 5XX SERVER ERRORS first — any 5xx response is minimum severity "high"; repeated 5xx on the same endpoint is "critical". Map every 5xx to a server-side Oracle config fix.
  2. 4XX CLIENT ERRORS second — 401/403 indicate auth/token failures (IDCS, OAM); 404 indicates missing Oracle module registration (ORDS, ADF, VB); 429 indicates rate limiting.
  3. 3XX REDIRECT ISSUES third — only flag if the chain is long (>3 hops), slow (>2 s total), or terminates on an error page.
  4. 2XX PERFORMANCE last — slow successful responses are lower priority than any error-tier finding.

Console priority override:
- CORS / PREFLIGHT BLOCKING ERRORS outrank generic JavaScript errors, connectivity summaries, performance issues, and deprecation warnings.
- blocked by CORS policy, failed preflight access-control checks, and missing Access-Control-Allow-Origin are high-priority root-cause signals.
- TypeError: Failed to fetch is a browser symptom when paired with CORS/preflight evidence, not the root cause.
- For CORS evidence on /ords/ endpoints, name the owning layer as ORDS/proxy CORS, not generic VBCS. Recommend fixing OPTIONS/preflight headers and allowed origins.
- If CORS_PREFLIGHT_EVIDENCE shows an OPTIONS response without Access-Control-Allow-Origin, or a paired request with status=0, treat that as the root CORS/preflight failure before any favicon/static 401.
- NETWORK FAILURES / STATUS 0 indicates a browser-blocked, aborted, or otherwise response-less request. Correlate it with CORS_PREFLIGHT_EVIDENCE before calling it connectivity.
- LOW-PRIORITY STATIC ASSET ERRORS are supporting noise unless the main document, app bundle, or API call is affected. Do not name favicon.ico, icons, fonts, maps, or images as root cause when application failure evidence exists.

Context field guide:
- 5XX SERVER ERRORS / HTTP 5XX SERVER ERRORS IN LOGS sections contain the highest-priority findings — always produce at least one finding for every distinct 5xx endpoint before reporting performance issues.
- 4XX CLIENT ERRORS / HTTP 4XX CLIENT ERRORS IN LOGS sections should be analysed for auth flow failures, missing resource registrations, and repeated retry storms.
- ERROR CLUSTERS section highlights the same endpoint failing multiple times — a cluster with ⚠ 5XX is a cascade failure candidate and should be rated "critical".
- REDIRECT CHAIN section shows sequential requests in chronological order. Report the total chain duration as user-perceived time.
- ENDS_ON_ERROR_PAGE:true means the redirect chain terminates on a known error page. This is a CRITICAL finding even when all HTTP status codes are 2xx or 3xx — the user hit a failure state.
- [NEW-CONN] on a request means a fresh TCP connection was established (dns= and connect= are real costs). Distinguish this from [KEEPALIVE] reuse. NEW-CONN latency is fixed by CDN pre-warming, TCP keep-alive tuning, or connection pooling — not server-side code changes.
- wait= is pure server processing time (TTFB). High wait on a [KEEPALIVE] request points to server-side bottlenecks (session lookup, DB query, federation handshake).
- wait_ratio= shows what fraction of total time was server wait. If >80%, the bottleneck is server processing, not network or payload transfer.
- When a REDIRECT CHAIN exists, always include a finding that covers the full chain with total duration — do not report each redirect as a separate finding unless latency causes differ.`;

function setSseHeaders(res: ExpressResponse): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Flush headers immediately so the client receives the SSE opening and initial
  // status events before Node.js pauses execution waiting for the OpenAI upstream fetch.
  res.flushHeaders();
}

function writeSseEvent(res: ExpressResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeSseDone(res: ExpressResponse): void {
  res.write('data: [DONE]\n\n');
}

interface AiMessage {
  role: 'system' | 'developer' | 'user' | 'assistant';
  content: string;
}

export interface AiPayloadValidationError {
  status: 400 | 413;
  error: string;
}

export function validateAiChatPayload(
  messages: unknown,
  systemPrompt: unknown,
): AiPayloadValidationError | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { status: 400, error: 'messages array required' };
  }

  if (messages.length > MAX_AI_CHAT_MESSAGES) {
    return { status: 413, error: `A maximum of ${MAX_AI_CHAT_MESSAGES} chat messages is allowed.` };
  }

  if (systemPrompt !== undefined && typeof systemPrompt !== 'string') {
    return { status: 400, error: 'systemPrompt must be a string' };
  }

  let totalChars = typeof systemPrompt === 'string' ? systemPrompt.length : 0;
  for (const message of messages) {
    if (
      !message
      || typeof message !== 'object'
      || !['user', 'assistant'].includes(String((message as { role?: unknown }).role))
      || typeof (message as { content?: unknown }).content !== 'string'
    ) {
      return { status: 400, error: 'Each message must contain a user or assistant role and string content.' };
    }
    totalChars += (message as { content: string }).content.length;
  }

  if (totalChars > MAX_AI_CHAT_INPUT_CHARS) {
    return { status: 413, error: 'AI chat input is too large.' };
  }

  return null;
}

interface OpenAiResponseOptions {
  stream: boolean;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

function buildOpenAiResponsesPayload(
  config: OpenAiConfig,
  messages: AiMessage[],
  options: OpenAiResponseOptions,
): Record<string, unknown> {
  const instructions = messages
    .filter((message) => message.role === 'system' || message.role === 'developer')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');

  const input = messages
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content.trim())
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    }));

  return {
    model: config.model,
    ...(instructions ? { instructions } : {}),
    input,
    stream: options.stream,
    // Diagnostic artifacts can contain sensitive operational evidence. Do not retain responses.
    store: false,
    ...(options.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}),
  };
}

async function fetchOpenAiResponses(
  messages: AiMessage[],
  options: OpenAiResponseOptions,
): Promise<FetchResponse> {
  const config = getOpenAiConfig();
  if (!config) throw new Error(getOpenAiConfigurationError());

  return fetch(`${config.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(buildOpenAiResponsesPayload(config, messages, options)),
    signal: options.signal,
  });
}

function getOpenAiStreamDelta(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';

  const event = payload as {
    type?: unknown;
    delta?: unknown;
    error?: { message?: unknown };
  };

  if (event.type === 'error' || event.type === 'response.failed') {
    const message = typeof event.error?.message === 'string'
      ? event.error.message
      : 'OpenAI response failed.';
    throw new Error(message);
  }

  if (
    (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') &&
    typeof event.delta === 'string'
  ) {
    return event.delta;
  }

  return '';
}

interface OpenAiStreamResult {
  output: string;
  metadata: OpenAiResponseMetadata;
}

async function readOpenAiResponseStream(
  response: FetchResponse,
  onDelta?: (delta: string) => void,
): Promise<OpenAiStreamResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('OpenAI returned no response body.');

  const decoder = new TextDecoder();
  let buffered = '';
  let output = '';
  let metadata: OpenAiResponseMetadata = {};

  const processEvent = (rawEvent: string) => {
    for (const line of rawEvent.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      try {
        const payload = JSON.parse(data);
        const eventMetadata = extractOpenAiResponseMetadata(payload);
        metadata = {
          responseId: eventMetadata.responseId ?? metadata.responseId,
          model: eventMetadata.model ?? metadata.model,
          usage: eventMetadata.usage ?? metadata.usage,
        };
        const delta = getOpenAiStreamDelta(payload);
        if (!delta) continue;
        output += delta;
        onDelta?.(delta);
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffered += decoder.decode(value, { stream: true });
    const events = buffered.split(/\r?\n\r?\n/);
    buffered = events.pop() ?? '';
    events.forEach(processEvent);
  }

  buffered += decoder.decode();
  if (buffered.trim()) processEvent(buffered);
  return { output, metadata };
}

async function accountOpenAiRequest(input: {
  requestId: string;
  operation: AiUsageOperation;
  status: 'completed' | 'failed';
  configuredModel: string;
  metadata?: OpenAiResponseMetadata;
  providerHttpStatus?: number;
  startedAt: number;
  failureCategory?: 'configuration' | 'upstream_http' | 'stream' | 'unknown';
}): Promise<void> {
  await recordAiUsageEvent({
    requestId: input.requestId,
    operation: input.operation,
    status: input.status,
    model: input.metadata?.model ?? input.configuredModel,
    providerResponseId: input.metadata?.responseId,
    providerHttpStatus: input.providerHttpStatus,
    durationMs: Date.now() - input.startedAt,
    usage: input.metadata?.usage,
    failureCategory: input.failureCategory,
  });
}

function writeStatusEvent(
  res: ExpressResponse,
  stage: InsightStage,
  startedAt: number,
  requestId: string,
  message?: string
): void {
  const elapsedMs = Date.now() - startedAt;
  writeSseEvent(res, {
    type: 'status',
    stage,
    requestId,
    elapsedMs,
    slow: elapsedMs >= SOFT_TIMEOUT_MS,
    ...(message ? { message } : {}),
  });
}

function sanitizeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeHealth(value: unknown): HealthLevel | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return HEALTH_VALUES.includes(normalized as HealthLevel)
    ? (normalized as HealthLevel)
    : null;
}

function normalizeSectionType(value: unknown): InsightSectionType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return SECTION_VALUES.includes(normalized as InsightSectionType)
    ? (normalized as InsightSectionType)
    : null;
}

function normalizeSeverity(value: unknown): FindingSeverity | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return SEVERITY_VALUES.includes(normalized as FindingSeverity)
    ? (normalized as FindingSeverity)
    : null;
}

function hasConcreteEvidence(evidence: string): boolean {
  if (evidence.length < 8) return false;
  const evidencePattern =
    /(https?:\/\/|\/[a-z0-9._~!$&'()*+,;=:@%/-]+|\bstatus\b[^0-9]{0,8}\d{3}\b|\b\d+(?:\.\d+)?\s*(ms|s|kb|mb|%)\b|\b[a-z_]+=(\d+(?:\.\d+)?)\b|\b(dns|connect|wait|receive|ssl|ttfb|latency|redirect)\b|\b(access-control-allow-origin|access-control-allow-methods|access-control-allow-headers|cache-control|content-type|content-encoding|strict-transport-security|content-security-policy|x-frame-options|x-content-type-options|set-cookie|authorization|etag|expires|pragma)\b)/i;
  return evidencePattern.test(evidence);
}

function isActionableFix(fix: string): boolean {
  if (fix.length < 18) return false;
  const actionVerbPattern =
    /\b(add|set|enable|disable|update|remove|cache|compress|retry|index|increase|decrease|configure|route|rewrite|replace|avoid|serve|prefetch|batch|parallelize|paginate|deduplicate|whitelist|block|rotate|expire|invalidate|fix|switch|enforce|apply|reduce|split|defer|lazy|instrument|trace|profile|rollback|adjust)\b/i;
  const genericPattern =
    /\b(check logs|monitor|investigate further|look into this|review system|optimize performance|improve latency|improve security|best practice)\b/i;
  const specificityPattern =
    /(https?:\/\/|\/[a-z0-9._~!$&'()*+,;=:@%/-]+|\b(status|ttfb|dns|connect|wait|receive|ssl|header|endpoint|query|cache|timeout|redirect|cors|cookie|authorization|csp|hsts|gzip|brotli|cdn|http\/2|http\/3|db|database|index|keep-alive|pool|integration|identity|token|mapper|adapter|object storage|region|compartment)\b|\b[a-z-]+:\s*[^\s]+\b)/i;
  return actionVerbPattern.test(fix) && specificityPattern.test(fix) && !genericPattern.test(fix);
}

interface NormalizeOptions {
  oracleSpecificityRequired: boolean;
  oracleSpecificityTokens: Set<string>;
  sourceType: InsightsSourceType;
}

function hasOracleSpecificity(
  finding: { title: string; why: string; fix: string; product?: string; component?: string },
  options: NormalizeOptions
): boolean {
  if (!options.oracleSpecificityRequired) return true;
  if (options.oracleSpecificityTokens.size === 0) return false;

  const text = [
    finding.product || '',
    finding.component || '',
    finding.title,
    finding.why,
    finding.fix,
  ]
    .join(' ')
    .toLowerCase();

  for (const token of options.oracleSpecificityTokens) {
    if (token.length >= 3 && text.includes(token)) return true;
  }

  return false;
}

function normalizeFinding(value: unknown, options: NormalizeOptions): InsightFinding | null {
  if (!value || typeof value !== 'object') return null;

  const finding = value as Record<string, unknown>;
  const severity = normalizeSeverity(finding.severity);
  const title = sanitizeText(finding.title);
  const product = sanitizeText(finding.product);
  const component = sanitizeText(finding.component);
  const what = sanitizeText(finding.what);
  const why = sanitizeText(finding.why);
  const evidence = sanitizeText(finding.evidence);
  const fix = sanitizeText(finding.fix);
  const srGuidance = sanitizeText(finding.srGuidance);

  if (!severity || !title || !what || !why || !evidence || !fix) return null;
  if (!hasConcreteEvidence(evidence)) return null;
  if (!isActionableFix(fix)) return null;
  if (!hasOracleSpecificity({ title, why, fix, product, component }, options)) return null;

  return {
    severity,
    title,
    ...(product ? { product } : {}),
    ...(component ? { component } : {}),
    what,
    why,
    evidence,
    fix,
    // Only include srGuidance when it is substantive (at least 20 chars to exclude placeholder strings)
    ...(srGuidance && srGuidance.length >= 20 ? { srGuidance } : {}),
  };
}

function dedupeFindings(findings: InsightFinding[]): InsightFinding[] {
  const seen = new Set<string>();
  const deduped: InsightFinding[] = [];

  for (const finding of findings) {
    const fingerprint = [
      finding.severity,
      finding.title.toLowerCase(),
      finding.evidence.toLowerCase(),
      finding.fix.toLowerCase(),
    ].join('||');

    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    deduped.push(finding);
  }

  return deduped;
}

function deriveOverallHealth(sections: InsightSection[]): HealthLevel {
  const all = sections.flatMap((section) => section.findings);
  if (all.some((finding) => finding.severity === 'critical')) return 'critical';
  if (all.some((finding) => finding.severity === 'high')) return 'degraded';
  if (all.some((finding) => finding.severity === 'medium')) return 'warning';
  return 'healthy';
}

function fallbackSummary(
  sections: InsightSection[],
  sourceType: InsightsSourceType = 'har'
): string {
  const topFinding = sections
    .flatMap((section) => section.findings)
    .sort((a, b) => SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity])[0];

  if (!topFinding) {
    return getEmptyInsightsSummary(sourceType);
  }

  return `${topFinding.title}: ${topFinding.what}`;
}

function normalizeInsights(
  raw: unknown,
  options: NormalizeOptions,
  detectedProducts: DetectedOracleProduct[]
): InsightsResult {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawSections = Array.isArray(input.sections) ? input.sections : [];
  const normalizedSections: InsightSection[] = [];

  for (const sectionCandidate of rawSections) {
    if (!sectionCandidate || typeof sectionCandidate !== 'object') continue;

    const section = sectionCandidate as Record<string, unknown>;
    const type = normalizeSectionType(section.type);
    if (!type) continue;

    const title = sanitizeText(section.title) || SECTION_LABELS[type];
    const rawFindings = Array.isArray(section.findings) ? section.findings : [];

    const findings = dedupeFindings(
      rawFindings
        .map((finding) => normalizeFinding(finding, options))
        .filter((finding): finding is InsightFinding => Boolean(finding))
    )
      .sort((a, b) => SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity])
      .slice(0, 3);

    if (findings.length === 0) continue;

    normalizedSections.push({ type, title, findings });
  }

  normalizedSections.sort((a, b) => {
    if (SECTION_PRIORITY[a.type] !== SECTION_PRIORITY[b.type]) {
      return SECTION_PRIORITY[a.type] - SECTION_PRIORITY[b.type];
    }

    const aRank = Math.min(...a.findings.map((finding) => SEVERITY_PRIORITY[finding.severity]));
    const bRank = Math.min(...b.findings.map((finding) => SEVERITY_PRIORITY[finding.severity]));
    return aRank - bRank;
  });

  // Cap at 3 sections to match the 3-section budget in the trimmed system prompt
  normalizedSections.splice(3);

  if (normalizedSections.length === 0) {
    return {
      overallHealth: 'warning',
      summary: getEmptyInsightsSummary(options.sourceType),
      sections: [],
      ...(detectedProducts.length
        ? {
            detectedProducts: detectedProducts.map((product) => ({
              product: product.product,
              shortName: product.shortName,
              components: product.components,
              matchedUrls: product.matchedUrls,
            })),
          }
        : {}),
    };
  }

  const overallHealth = normalizeHealth(input.overallHealth) ?? deriveOverallHealth(normalizedSections);
  const summary = sanitizeText(input.summary) || fallbackSummary(normalizedSections);

  return {
    overallHealth,
    summary,
    sections: normalizedSections,
    ...(detectedProducts.length
      ? {
          detectedProducts: detectedProducts.map((product) => ({
            product: product.product,
            shortName: product.shortName,
            components: product.components,
            matchedUrls: product.matchedUrls,
          })),
        }
      : {}),
  };
}

function extractJsonCandidate(raw: string): string | null {
  const fencedMatches = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedMatches) {
    if (match[1]?.trim()) return match[1].trim();
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

  const candidates: string[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === '}') {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start !== -1) {
        candidates.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
}

function parseInsightsPayload(rawContent: string): unknown {
  const direct = rawContent.trim();
  if (direct) {
    try {
      return JSON.parse(direct);
    } catch {
      // Continue with extracted candidates.
    }
  }

  const candidate = extractJsonCandidate(rawContent);
  if (!candidate) throw new Error('Model returned empty content');

  try {
    return JSON.parse(candidate);
  } catch {
    const wrappedCandidate = extractJsonCandidate(candidate);
    if (!wrappedCandidate) throw new Error('No valid JSON object found in model output');
    return JSON.parse(wrappedCandidate);
  }
}

function detectedProductsPayload(detectedProducts: DetectedOracleProduct[]) {
  return detectedProducts.map(p => ({
    product: p.product,
    shortName: p.shortName,
    components: p.components,
    matchedUrls: p.matchedUrls,
  }));
}

function buildDeterministicFallbackResponse(
  context: string,
  sourceType: InsightsSourceType,
  detectedProducts: DetectedOracleProduct[],
  fallbackReason: string,
): InsightsGenerationResponse {
  const deterministicSections = buildDeterministicInsights(context, sourceType);
  const result: InsightsResult = {
    overallHealth: deterministicSections.length > 0
      ? deriveOverallHealth(deterministicSections)
      : 'warning',
    summary: fallbackSummary(deterministicSections, sourceType),
    sections: deterministicSections,
    detectedProducts: detectedProductsPayload(detectedProducts),
  };

  return {
    result,
    ai: {
      source: 'deterministic_fallback',
      fallbackReason,
    },
  };
}

export async function generateInsightsForContext(
  context: string,
  rawSourceType: unknown = 'har',
  options: GenerateInsightsOptions = {},
): Promise<InsightsGenerationResponse> {
  const requestId = options.requestId ?? randomUUID();
  const sourceType = normalizeInsightsSourceType(rawSourceType);
  const detectedProducts = detectOracleProductsFromContext(context);
  const oracleContext = buildOracleKbPrompt(detectedProducts);
  const oracleSpecificityTokens = buildOracleSpecificityTokens(detectedProducts);
  const oracleSpecificityRequired = detectedProducts.length > 0;
  const oracleSpecificityInstruction = oracleSpecificityRequired
    ? '\nOracle specificity rule: findings must explicitly reference detected Oracle product/component names in title, why, or fix.'
    : '';

  const insightsSystemPrompt = `${INSIGHTS_SYSTEM_PROMPT}${
    oracleContext ? `\n\n${oracleContext}` : ''
  }${oracleSpecificityInstruction}`;

  const log = (msg: string) => console.info(`[ai-insights:${requestId}] ${msg}`);
  const fallback = (reason: string) => {
    log(`fallback | ${reason}`);
    return buildDeterministicFallbackResponse(context, sourceType, detectedProducts, reason);
  };

  log(
    `request accepted | products_detected=${detectedProducts.length} (${
      detectedProducts.map(p => p.shortName).join(',') || 'none'
    }) | source=${sourceType} | context_chars=${context.length}`
  );

  const chatMessages: AiMessage[] = [
    { role: 'system', content: insightsSystemPrompt },
    {
      role: 'user',
      content: `Analyze this ${sourceType === 'console' ? 'browser console log' : 'HAR'} context and return strict JSON insights only.\n\n${context}`,
    },
  ];

  const openAiConfigurationError = getOpenAiConfigurationError();
  if (openAiConfigurationError) {
    const reason = openAiConfigurationError;
    if (options.allowDeterministicFallback) return fallback(reason);
    throw new Error(reason);
  }
  const openAiConfig = getOpenAiConfig();
  if (!openAiConfig) {
    const reason = 'OpenAI configuration could not be loaded.';
    if (options.allowDeterministicFallback) return fallback(reason);
    throw new Error(reason);
  }

  const usageStartedAt = Date.now();
  let usageAccountingAttempted = false;

  try {
    log(`-> OpenAI Responses fetch start | model=${openAiConfig.model}`);

    const upstream = await fetchOpenAiResponses(chatMessages, {
      stream: true,
      maxOutputTokens: 3500,
    });

    log(`<- OpenAI responded | status=${upstream.status}`);

    if (!upstream.ok) {
      await upstream.body?.cancel();
      await accountOpenAiRequest({
        requestId,
        operation: 'insights',
        status: 'failed',
        configuredModel: openAiConfig.model,
        providerHttpStatus: upstream.status,
        startedAt: usageStartedAt,
        failureCategory: 'upstream_http',
      });
      usageAccountingAttempted = true;
      const reason = `OpenAI request failed (${upstream.status}). Verify the approved model and API key.`;
      log(`OpenAI error | status=${upstream.status}`);
      if (options.allowDeterministicFallback) return fallback(reason);
      throw new Error(reason);
    }

    const streamResult = await readOpenAiResponseStream(upstream);
    await accountOpenAiRequest({
      requestId,
      operation: 'insights',
      status: 'completed',
      configuredModel: openAiConfig.model,
      metadata: streamResult.metadata,
      providerHttpStatus: upstream.status,
      startedAt: usageStartedAt,
    });
    usageAccountingAttempted = true;

    log(`OpenAI stream complete | chars=${streamResult.output.length}`);

    const rawContent = streamResult.output;
    if (!rawContent.trim()) {
      const reason = 'OpenAI returned empty content.';
      if (options.allowDeterministicFallback) return fallback(reason);
      throw new Error(reason);
    }

    let parsed: unknown;
    try {
      parsed = parseInsightsPayload(rawContent);
    } catch (parseErr) {
      const reason = 'Failed to parse OpenAI JSON response.';
      log(`JSON parse failed | ${parseErr instanceof Error ? parseErr.name : 'invalid payload'}`);
      if (options.allowDeterministicFallback) return fallback(reason);
      throw new Error(reason);
    }

    const normalized = normalizeInsights(
      parsed,
      { oracleSpecificityRequired, oracleSpecificityTokens, sourceType },
      detectedProducts
    );
    const deterministicSections = buildDeterministicInsights(context, sourceType);
    const mergedSections = mergeDeterministicInsights(
      normalized.sections,
      deterministicSections
    );
    const result: InsightsResult = {
      ...normalized,
      sections: mergedSections,
      overallHealth: deterministicSections.length > 0
        ? deriveOverallHealth(mergedSections)
        : normalized.overallHealth,
      summary: deterministicSections.length > 0
        ? fallbackSummary(mergedSections, sourceType)
        : normalized.summary,
      detectedProducts: detectedProductsPayload(detectedProducts),
    };

    log(
      `done | sections=${result.sections.length} findings=${result.sections.reduce(
        (s, sec) => s + sec.findings.length, 0
      )} deterministic_sections=${deterministicSections.length} health=${result.overallHealth}`
    );

    return {
      result,
      ai: { source: 'openai' },
    };
  } catch (err) {
    if (!usageAccountingAttempted) {
      await accountOpenAiRequest({
        requestId,
        operation: 'insights',
        status: 'failed',
        configuredModel: openAiConfig.model,
        startedAt: usageStartedAt,
        failureCategory: 'stream',
      });
    }
    const reason = `Insights failed: ${(err as Error)?.message ?? String(err)}`;
    log(`ERROR: ${String(err)}`);
    if (options.allowDeterministicFallback) return fallback(reason);
    throw err;
  }
}

// ─── Multi-backend helpers ────────────────────────────────────────────────────

// POST /api/ai/chat - backend-owned OpenAI proxy, stream response back
router.post('/chat', async (req: Request, res: ExpressResponse) => {
  const { messages, systemPrompt } = req.body ?? {};
  const validationError = validateAiChatPayload(messages, systemPrompt);
  if (validationError) {
    return res.status(validationError.status).json({ error: validationError.error });
  }

  const validatedMessages = messages as AiMessage[];
  const validatedSystemPrompt = systemPrompt as string | undefined;

  // ── Oracle product detection ─────────────────────────────────────────────
  // Scan the system prompt (which contains the full file context) and the latest
  // user message for Oracle product URL patterns. Inject the same product KB
  // that the /insights endpoint uses — closing the gap between the two pipelines.
  const latestUserContent = [...validatedMessages].reverse().find(
    (m: { role: string; content: string }) => m.role === 'user'
  )?.content ?? '';
  const detectionSource = `${validatedSystemPrompt ?? ''}\n${latestUserContent}`;
  const chatDetectedProducts = detectOracleProductsFromContext(detectionSource);
  const chatOracleKb = chatDetectedProducts.length > 0
    ? buildOracleKbPrompt(chatDetectedProducts)
    : '';

  // Append Oracle KB and the analysis-order rule to whatever system prompt the
  // frontend already built (analyst persona + file context). This keeps the
  // frontend in control of the persona while the backend enriches it.
  let enrichedSystemPrompt = validatedSystemPrompt ?? '';
  if (chatOracleKb) {
    enrichedSystemPrompt += `\n\n${chatOracleKb}`;
    enrichedSystemPrompt += `\nOracle specificity rule: always name the detected Oracle product and component in every finding.`;
  }
  enrichedSystemPrompt += `\n\nAnalysis priority rule: exhaust 5xx server errors before 4xx, 4xx before 3xx, 3xx before 2xx performance. Never report a lower-tier finding first.`;

  const allMessages = enrichedSystemPrompt
    ? [{ role: 'system' as const, content: enrichedSystemPrompt }, ...validatedMessages]
    : validatedMessages;

  const openAiConfigurationError = getOpenAiConfigurationError();
  if (openAiConfigurationError) {
    return res.status(503).json({ error: openAiConfigurationError });
  }
  const openAiConfig = getOpenAiConfig();
  if (!openAiConfig) {
    return res.status(503).json({ error: 'OpenAI configuration could not be loaded.' });
  }
  const requestId = randomUUID();
  const usageStartedAt = Date.now();
  let usageAccountingAttempted = false;

  try {
    const openAiResponse = await fetchOpenAiResponses(allMessages, {
      stream: true,
      maxOutputTokens: 1200,
    });

    if (!openAiResponse.ok) {
      await openAiResponse.body?.cancel();
      await accountOpenAiRequest({
        requestId,
        operation: 'chat',
        status: 'failed',
        configuredModel: openAiConfig.model,
        providerHttpStatus: openAiResponse.status,
        startedAt: usageStartedAt,
        failureCategory: 'upstream_http',
      });
      usageAccountingAttempted = true;
      return res.status(openAiResponse.status).json({
        error: `OpenAI request failed (${openAiResponse.status}).`,
      });
    }

    // Keep our own SSE contract stable so the frontend is independent of provider event formats.
    setSseHeaders(res);
    const streamResult = await readOpenAiResponseStream(openAiResponse, (delta) => {
      writeSseEvent(res, { choices: [{ delta: { content: delta } }] });
    });
    await accountOpenAiRequest({
      requestId,
      operation: 'chat',
      status: 'completed',
      configuredModel: openAiConfig.model,
      metadata: streamResult.metadata,
      providerHttpStatus: openAiResponse.status,
      startedAt: usageStartedAt,
    });
    usageAccountingAttempted = true;
    writeSseDone(res);
    res.end();
  } catch (err) {
    if (!usageAccountingAttempted) {
      await accountOpenAiRequest({
        requestId,
        operation: 'chat',
        status: 'failed',
        configuredModel: openAiConfig.model,
        startedAt: usageStartedAt,
        failureCategory: 'stream',
      });
    }
    console.error('OpenAI proxy error:', err);
    if (res.headersSent) {
      writeSseEvent(res, { error: 'OpenAI streaming request failed.' });
      writeSseDone(res);
      return res.end();
    }
    res.status(502).json({ error: 'Failed to reach OpenAI API.' });
  }
});

router.post('/insights', async (req: Request, res: ExpressResponse) => {
  const { context, sourceType: rawSourceType } = req.body ?? {};

  if (!context || typeof context !== 'string' || !context.trim()) {
    return res.status(400).json({ error: 'context is required' });
  }
  if (context.length > MAX_AI_CONTEXT_CHARS) {
    return res.status(413).json({ error: 'AI insights context is too large.' });
  }

  try {
    const responsePayload = await generateInsightsForContext(
      context,
      rawSourceType,
      { allowDeterministicFallback: true },
    );
    return res.json(responsePayload);
  } catch (err) {
    console.error('OpenAI insights error:', err);
    return res.status(500).json({ error: 'Failed to generate insights.' });
  }
});


// GET /api/ai/status - health check for frontend
router.get('/status', async (_req: Request, res: ExpressResponse) => {
  const openAiConfigurationError = getOpenAiConfigurationError();
  if (openAiConfigurationError) {
    return res.json({ configured: false, connected: false, model: null });
  }
  const openAiConfig = getOpenAiConfig();
  if (!openAiConfig) {
    return res.json({ configured: false, connected: false, model: null });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const requestId = randomUUID();
  const usageStartedAt = Date.now();

  try {
    const response = await fetchOpenAiResponses(
      [{ role: 'user', content: 'Reply with OK.' }],
      {
        stream: false,
        maxOutputTokens: 16,
        signal: controller.signal,
      },
    );

    if (response.ok) {
      let metadata: OpenAiResponseMetadata = {};
      try {
        metadata = extractOpenAiResponseMetadata(await response.json());
      } catch {
        metadata = {};
      }
      await accountOpenAiRequest({
        requestId,
        operation: 'status_probe',
        status: 'completed',
        configuredModel: openAiConfig.model,
        metadata,
        providerHttpStatus: response.status,
        startedAt: usageStartedAt,
      });
    } else {
      await response.body?.cancel();
      await accountOpenAiRequest({
        requestId,
        operation: 'status_probe',
        status: 'failed',
        configuredModel: openAiConfig.model,
        providerHttpStatus: response.status,
        startedAt: usageStartedAt,
        failureCategory: 'upstream_http',
      });
    }
    return res.json({
      configured: true,
      connected: response.ok,
      model: openAiConfig.model,
    });
  } catch {
    await accountOpenAiRequest({
      requestId,
      operation: 'status_probe',
      status: 'failed',
      configuredModel: openAiConfig.model,
      startedAt: usageStartedAt,
      failureCategory: 'stream',
    });
    return res.json({ configured: true, connected: false, model: openAiConfig.model });
  } finally {
    clearTimeout(timer);
  }
});

export default router;

