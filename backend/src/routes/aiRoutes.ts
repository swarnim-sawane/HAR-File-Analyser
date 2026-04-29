import { Router, Request, Response as ExpressResponse } from 'express';
import { randomUUID } from 'crypto';
import {
  buildOracleKbPrompt,
  buildOracleSpecificityTokens,
  detectOracleProductsFromContext,
  type DetectedOracleProduct,
} from '../utils/oracleProductKb';

const router = Router();
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

type HealthLevel = 'critical' | 'degraded' | 'warning' | 'healthy';
type InsightSectionType =
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

const HEALTH_VALUES: HealthLevel[] = ['critical', 'degraded', 'warning', 'healthy'];
const SECTION_VALUES: InsightSectionType[] = [
  'critical_issues',
  'performance',
  'security',
  'recommendations',
];
const SEVERITY_VALUES: FindingSeverity[] = ['critical', 'high', 'medium', 'low'];

const SECTION_LABELS: Record<InsightSectionType, string> = {
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
  critical_issues: 0,
  performance: 1,
  security: 2,
  recommendations: 3,
};

const SOFT_TIMEOUT_MS = 20000;
const HARD_TIMEOUT_MS = 105000;
// 55s: models can pause mid-generation without being stalled — this gives enough room without
// exceeding the 105s hard limit. Previously 30s was cutting off legitimate slow responses.
const UPSTREAM_INACTIVITY_MS = 55000;
const STATUS_UPDATE_INTERVAL_MS = 5000;

const INSIGHTS_SYSTEM_PROMPT = `You are an Oracle Support Analyst helping L1/L2 engineers triage issues from HAR traces.
Return ONLY a strict JSON object. No markdown. No prose outside JSON.

Schema:
{"overallHealth":"critical|degraded|warning|healthy","summary":"one sentence","sections":[{"type":"critical_issues|performance|security|recommendations","title":"string","findings":[{"severity":"critical|high|medium|low","title":"string","product":"ORDS|ADF|VBCS|Forms|OIC|Fusion Apps|IDCS|OAC|OCI|CPQ (omit if N/A)","component":"sub-component name (omit if N/A)","what":"what HAR shows — request counts, status codes, timings","why":"root cause referencing Oracle product internals","evidence":"URL path, status code, timing in ms, or header name","fix":"actionable step — reference Oracle config path, admin UI, or SQL","srGuidance":"logs/diagnostics to collect for SR: log file path, diagnostic level, SQL trace command (omit for low severity)"}]}]}

Rules:
- The summary must be a triage conclusion that names the most likely root cause and the exact evidence signal, not a generic health summary.
- If EXPERT TRIAGE CASE FILE exists, treat it as curated forensic evidence and use it before broad 4xx/5xx buckets.
- Case-file evidence overrides generic status-tier order when it points to a concrete root cause.
- Do not write blanket explanations like "401 means unauthorized" or "400 means bad request". Explain what is different in this trace: missing auth/cookies, response auth challenge, request field names, response body clue, redirect target, or first failing endpoint.
- Distinguish root cause from symptoms. Repeated 401/400/404 responses after FIRST_DECISIVE_FAILURE are symptoms unless they have a different endpoint or different evidence signature.
- Do not bunch unrelated 401/400 responses into one generic finding. Create one finding per distinct failure signature, then mention repeated symptoms only as supporting evidence.
- If TypeError/failed fetch, static asset warnings, slow 2xx, or deprecation warnings appear alongside hard error evidence, treat them as symptoms or lower-priority follow-up.
- If CORS_POLICY_EVIDENCE shows missing Access-Control-Allow-Origin on an /ords/ endpoint, name ORDS/proxy CORS handling as the likely owning layer; failed fetch is only the client symptom.
- If CORS_PREFLIGHT_EVIDENCE shows an OPTIONS response without Access-Control-Allow-Origin, or a paired request with status=0, treat that as the root CORS/preflight failure before any favicon/static 401.
- Never name favicon.ico, icons, fonts, maps, images, or other static asset 401/404 as the root cause of the user flow unless the context explicitly says no other application failure exists. If NO_DECISIVE_APPLICATION_FAILURE is present, say no decisive application failure is visible instead of inventing one.
- Only include findings with concrete HAR evidence (URL, status code, ms timing, header).
- Fix must be specific — name Oracle config files, admin UI paths, or SQL. No vague "check logs".
- srGuidance must name specific Oracle artifacts: WLS server log path, ORDS log, ADFLogger level, AWR/ASH, fmw_diag.
- Name the Oracle product and component in every finding when products are detected.
- Max 3 findings per section, 3 sections max. Highest severity first.
- STRICT ANALYSIS ORDER — always exhaust higher tiers before lower ones:
  1. 5XX SERVER ERRORS first — any 5xx response is minimum severity "high"; repeated 5xx on the same endpoint is "critical". Map every 5xx to a server-side Oracle config fix.
  2. 4XX CLIENT ERRORS second — 401/403 indicate auth/token failures (IDCS, OAM); 404 indicates missing Oracle module registration (ORDS, ADF, VB); 429 indicates rate limiting.
  3. 3XX REDIRECT ISSUES third — only flag if the chain is long (>3 hops), slow (>2 s total), or terminates on an error page.
  4. 2XX PERFORMANCE last — slow successful responses are lower priority than any error-tier finding.

Context field guide:
- EXPERT TRIAGE CASE FILE is curated forensic evidence. Prefer it over broad status buckets when it exists.
- FIRST_DECISIVE_FAILURE is the earliest meaningful failing request. Start the root-cause narrative there.
- SUCCESS_VS_FAILURE_DELTA compares the nearest successful same endpoint with the failing request. Missing Authorization or cookie names are stronger auth/session evidence than the raw 401 count.
- AUTH_EVIDENCE names auth headers/challenges without leaking secrets. Use WWW-Authenticate, authorization presence, and cookie_names to explain auth/session root cause.
- CORS_POLICY_EVIDENCE with missing Access-Control-Allow-Origin means a browser policy block. For /ords/ endpoints, name ORDS/proxy CORS handling as the likely owning layer.
- CORS_PREFLIGHT_EVIDENCE from HAR is hard browser policy evidence. status=0 on a paired request means the browser did not receive an application response; when paired with missing Access-Control-Allow-Origin, diagnose ORDS/proxy CORS/preflight handling.
- NETWORK FAILURES / STATUS 0 indicates a browser-blocked, aborted, or otherwise response-less request. Correlate it with CORS_PREFLIGHT_EVIDENCE before calling it connectivity.
- BAD_REQUEST_EVIDENCE gives query parameter names, request content type, POST body field names, and server response snippet. Use these to identify request-contract or validation failures instead of saying "400 bad request".
- DOWNSTREAM_SYMPTOMS counts repeated failures after the first decisive failure. Mention them as blast radius, not the primary root cause.
- STATIC_ASSET_FAILURES and LOW-PRIORITY STATIC ASSET ERRORS are explicitly demoted. They are supporting noise unless the main document, app bundle, or API call is affected.
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
  // status events before Node.js pauses execution waiting for the OCA upstream fetch.
  res.flushHeaders();
}

function writeSseEvent(res: ExpressResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeSseDone(res: ExpressResponse): void {
  res.write('data: [DONE]\n\n');
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
    /(https?:\/\/|\/[a-z0-9._~!$&'()*+,;=:@%/-]+|\bstatus\b[^0-9]{0,8}\d{3}\b|\b\d+(?:\.\d+)?\s*(ms|s|kb|mb|%)\b|\b[a-z_]+=(\d+(?:\.\d+)?)\b|\b(dns|connect|wait|receive|ssl|ttfb|latency|redirect)\b|\b(cache-control|content-type|content-encoding|strict-transport-security|content-security-policy|x-frame-options|x-content-type-options|set-cookie|authorization|etag|expires|pragma)\b)/i;
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

function fallbackSummary(sections: InsightSection[]): string {
  const topFinding = sections
    .flatMap((section) => section.findings)
    .sort((a, b) => SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity])[0];

  if (!topFinding) {
    return 'No high-confidence, evidence-backed insights were identified from this HAR context.';
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
      summary: 'No high-confidence, evidence-backed insights were identified from this HAR context.',
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

// ─── Multi-backend helpers ────────────────────────────────────────────────────

const OCA_CONNECT_TIMEOUT_MS = 10000;

/**
 * Fetches a streaming POST from OCA with a connect timeout enforced independently
 * from the route-level timeouts.
 */
async function fetchOcaInsightsStream(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  upstreamAbort: AbortSignal
): Promise<FetchResponse> {
  const ocaBaseUrl = process.env.OCA_BASE_URL;
  const ocaToken = process.env.OCA_TOKEN;

  if (!ocaBaseUrl || !ocaToken) {
    throw new Error('OCA is not configured (missing OCA_BASE_URL or OCA_TOKEN)');
  }

  const connectController = new AbortController();
  const connectTimer = setTimeout(
    () => connectController.abort(new Error(`OCA connect timeout after ${OCA_CONNECT_TIMEOUT_MS}ms`)),
    OCA_CONNECT_TIMEOUT_MS
  );

  // Mirror upstream aborts into the connect-timeout controller.
  const onUpstreamAbort = () => connectController.abort(upstreamAbort.reason);
  upstreamAbort.addEventListener('abort', onUpstreamAbort, { once: true });

  try {
    return await fetch(`${ocaBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ocaToken}`,
      },
      body: JSON.stringify({
        model: process.env.OCA_MODEL || 'oca/gpt5',
        messages,
        stream: true,
        temperature: 0.15,
        max_tokens: maxTokens,
      }),
      signal: connectController.signal,
    });
  } finally {
    clearTimeout(connectTimer);
    upstreamAbort.removeEventListener('abort', onUpstreamAbort);
  }
}

// POST /api/ai/chat - proxy to OCA, stream response back
router.post('/chat', async (req: Request, res: ExpressResponse) => {
  const { messages, systemPrompt } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // ── Oracle product detection ─────────────────────────────────────────────
  // Scan the system prompt (which contains the full file context) and the latest
  // user message for Oracle product URL patterns. Inject the same product KB
  // that the /insights endpoint uses — closing the gap between the two pipelines.
  const latestUserContent = [...messages].reverse().find(
    (m: { role: string; content: string }) => m.role === 'user'
  )?.content ?? '';
  const detectionSource = `${systemPrompt ?? ''}\n${latestUserContent}`;
  const chatDetectedProducts = detectOracleProductsFromContext(detectionSource);
  const chatOracleKb = chatDetectedProducts.length > 0
    ? buildOracleKbPrompt(chatDetectedProducts)
    : '';

  // Append Oracle KB and the analysis-order rule to whatever system prompt the
  // frontend already built (analyst persona + file context). This keeps the
  // frontend in control of the persona while the backend enriches it.
  let enrichedSystemPrompt = systemPrompt ?? '';
  if (chatOracleKb) {
    enrichedSystemPrompt += `\n\n${chatOracleKb}`;
    enrichedSystemPrompt += `\nOracle specificity rule: always name the detected Oracle product and component in every finding.`;
  }
  enrichedSystemPrompt += `\n\nAnalysis priority rule: exhaust 5xx server errors before 4xx, 4xx before 3xx, 3xx before 2xx performance. Never report a lower-tier finding first.`;

  const allMessages = enrichedSystemPrompt
    ? [{ role: 'system', content: enrichedSystemPrompt }, ...messages]
    : messages;

  try {
    const ocaResponse = await fetch(
      `${process.env.OCA_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OCA_TOKEN}`,
        },
        body: JSON.stringify({
          model: process.env.OCA_MODEL || 'oca/gpt-5.4',
          messages: allMessages,
          stream: true,
        }),
      }
    );

    if (!ocaResponse.ok) {
      const err = await ocaResponse.text();
      return res.status(ocaResponse.status).json({ error: err });
    }

    setSseHeaders(res);

    const reader = ocaResponse.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) return res.status(500).json({ error: 'No response body' });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.end();
  } catch (err) {
    console.error('OCA proxy error:', err);
    res.status(500).json({ error: 'Failed to reach OCA API' });
  }
});

router.post('/insights', async (req: Request, res: ExpressResponse) => {
  const { context } = req.body ?? {};

  if (!context || typeof context !== 'string' || !context.trim()) {
    return res.status(400).json({ error: 'context is required' });
  }

  const requestId = randomUUID();
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

  log(
    `request accepted | products_detected=${detectedProducts.length} (${
      detectedProducts.map(p => p.shortName).join(',') || 'none'
    }) | context_chars=${context.length}`
  );

  const chatMessages = [
    { role: 'system', content: insightsSystemPrompt },
    {
      role: 'user',
      content: `Analyze this HAR triage context and return strict JSON insights only.\n\n${context}`,
    },
  ];

  try {
    const ocaBaseUrl = process.env.OCA_BASE_URL;
    if (!ocaBaseUrl || !process.env.OCA_TOKEN) {
      log('ERROR: OCA config missing');
      return res.status(503).json({ error: 'OCA is not configured.' });
    }

    log(`-> OCA fetch start | model=${process.env.OCA_MODEL || 'oca/gpt-5.4'}`);

    // OCA fetch (streaming from OCA, accumulated server-side)
    const upstream = await fetch(`${ocaBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OCA_TOKEN}`,
      },
      body: JSON.stringify({
        model: process.env.OCA_MODEL || 'oca/gpt-5.4',
        messages: chatMessages,
        stream: true, // OCA requires stream=true; server accumulates chunks
        temperature: 0.15,
        max_tokens: 3500,
      }),
    });

    log(`<- OCA responded | status=${upstream.status}`);

    if (!upstream.ok) {
      const errText = await upstream.text();
      log(`OCA error | ${upstream.status} | ${errText.slice(0, 200)}`);
      return res.status(502).json({
        error: `OCA request failed (${upstream.status}). Verify VPN and token.`,
      });
    }

    // Accumulate the full streamed response into one string
    const reader = upstream.body?.getReader();
    if (!reader) {
      return res.status(502).json({ error: 'OCA returned no response body.' });
    }

    const decoder = new TextDecoder();
    let buf = '';
    let accumulatedContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta   = parsed?.choices?.[0]?.delta?.content;
          const message = parsed?.choices?.[0]?.message?.content;
          const content = typeof delta === 'string' ? delta
                        : typeof message === 'string' ? message
                        : '';
          if (content) accumulatedContent += content;
        } catch {
          // skip malformed chunk
        }
      }
    }

    log(`OCA stream complete | chars=${accumulatedContent.length}`);

    const rawContent = accumulatedContent;
    if (!rawContent.trim()) {
      return res.status(502).json({ error: 'OCA returned empty content.' });
    }

    // Parse the JSON the model returned
    let parsed: unknown;
    try {
      parsed = parseInsightsPayload(rawContent);
    } catch (parseErr) {
      log(`JSON parse failed | ${String(parseErr)}`);
      log(`raw dump: ${rawContent.slice(0, 500)}`);
      return res.status(502).json({ error: 'Failed to parse model JSON response.' });
    }

    const normalized = normalizeInsights(
      parsed,
      { oracleSpecificityRequired, oracleSpecificityTokens },
      detectedProducts
    );

    log(
      `done | sections=${normalized.sections.length} findings=${normalized.sections.reduce(
        (s, sec) => s + sec.findings.length, 0
      )} health=${normalized.overallHealth}`
    );

    // Return detected products in the response too
    const responsePayload = {
      ...normalized,
      detectedProducts: detectedProducts.map(p => ({
        product: p.product,
        shortName: p.shortName,
        components: p.components,
        matchedUrls: p.matchedUrls,
      })),
    };

    return res.json({ result: responsePayload });

  } catch (err) {
    log(`ERROR: ${String(err)}`);
    return res.status(500).json({
      error: `Insights failed: ${(err as Error)?.message ?? String(err)}`,
    });
  }
});


// GET /api/ai/status - health check for frontend
router.get('/status', async (_req: Request, res: ExpressResponse) => {
  const ocaBaseUrl = process.env.OCA_BASE_URL;
  const ocaToken = process.env.OCA_TOKEN;
  const model = process.env.OCA_MODEL || 'oca/gpt-5.4';

  if (!ocaBaseUrl || !ocaToken) {
    return res.json({ connected: false, model: null });
  }

  const fetchWithTimeout = async (
    url: string,
    init: RequestInit,
    timeoutMs = 8000
  ): Promise<FetchResponse> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const modelsResponse = await fetchWithTimeout(`${ocaBaseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${ocaToken}` },
    });

    if (modelsResponse.ok) {
      return res.json({ connected: true, model });
    }

    // Fallback probe: some OCA deployments don't expose /models, but /chat/completions works.
    const chatProbeResponse = await fetchWithTimeout(
      `${ocaBaseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ocaToken}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'health-check' }],
          stream: true,
          max_tokens: 1,
          temperature: 0,
        }),
      }
    );

    if (chatProbeResponse.ok) {
      await chatProbeResponse.body?.cancel();
      return res.json({ connected: true, model });
    }

    return res.json({ connected: false, model: null });
  } catch {
    return res.json({ connected: false, model: null });
  }
});

export default router;


