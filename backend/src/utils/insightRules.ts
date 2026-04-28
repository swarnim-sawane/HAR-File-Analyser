export type InsightSectionType =
  | 'critical_issues'
  | 'performance'
  | 'security'
  | 'recommendations';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type InsightsSourceType = 'har' | 'console';

export interface InsightFinding {
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

export interface InsightSection {
  type: InsightSectionType;
  title: string;
  findings: InsightFinding[];
}

const SECTION_PRIORITY: Record<InsightSectionType, number> = {
  critical_issues: 0,
  performance: 1,
  security: 2,
  recommendations: 3,
};

const CORS_SIGNAL_RE =
  /\b(CORS_BLOCKED|blocked by CORS policy|preflight request.*access control check|Access-Control-Allow-Origin|cross-origin request blocked)\b/i;
const FAILED_FETCH_RE = /\bTypeError:\s*Failed to fetch\b|\bFailed to fetch\b/i;

export function normalizeInsightsSourceType(value: unknown): InsightsSourceType {
  return value === 'console' ? 'console' : 'har';
}

function extractField(line: string, name: string): string | null {
  const match = line.match(new RegExp(`\\b${name}=([^\\s]+)`, 'i'));
  return match?.[1]?.trim() || null;
}

function extractQuotedValue(context: string, pattern: RegExp): string | null {
  const match = context.match(pattern);
  return typeof match?.[1] === 'string' && match[1].trim() ? match[1].trim() : null;
}

function extractFirstUrl(context: string): string | null {
  return context.match(/https?:\/\/[^\s'"<>]+/i)?.[0] ?? null;
}

function extractEndpoint(context: string): string | null {
  const corsLine = context.split(/\r?\n/).find((line) => CORS_SIGNAL_RE.test(line)) ?? context;
  return (
    extractField(corsLine, 'endpoint') ||
    extractQuotedValue(context, /\b(?:fetch|XMLHttpRequest)\s+at\s+['"]([^'"]+)['"]/i) ||
    extractQuotedValue(context, /\bAccess to fetch at\s+['"]([^'"]+)['"]/i) ||
    extractFirstUrl(context)
  );
}

function extractOrigin(context: string): string | null {
  const corsLine = context.split(/\r?\n/).find((line) => CORS_SIGNAL_RE.test(line)) ?? context;
  return (
    extractField(corsLine, 'origin') ||
    extractQuotedValue(context, /\bfrom origin\s+['"]([^'"]+)['"]/i)
  );
}

function hasCorsEvidence(context: string, sourceType: InsightsSourceType): boolean {
  return sourceType === 'console' && CORS_SIGNAL_RE.test(context);
}

function buildCorsFinding(context: string): InsightFinding {
  const endpoint = extractEndpoint(context) ?? 'unknown endpoint';
  const origin = extractOrigin(context) ?? 'unknown origin';
  const hasMissingHeader = /Access-Control-Allow-Origin/i.test(context);
  const hasPreflight = /preflight|OPTIONS/i.test(context);
  const hasFailedFetch = FAILED_FETCH_RE.test(context);
  const isOrds = /\/ords(?:\/|$)/i.test(endpoint);
  const header = hasMissingHeader ? 'Access-Control-Allow-Origin' : 'CORS response header';

  return {
    severity: 'high',
    title: isOrds
      ? 'CORS preflight blocked ORDS REST call'
      : 'CORS preflight blocked REST call',
    ...(isOrds ? { product: 'ORDS', component: 'ORDS/proxy CORS' } : { component: 'CORS policy' }),
    what: `The browser blocked the REST call to ${endpoint} from origin ${origin} before application code could consume the response.`,
    why: `Root cause is the ORDS/proxy CORS preflight response, not Visual Builder client code. The response is missing ${header}; ${
      hasFailedFetch ? 'TypeError: Failed to fetch is the browser-side symptom after the policy block.' : 'the browser then rejects the cross-origin request.'
    }`,
    evidence: `endpoint=${endpoint} origin=${origin} missing_header=${header} preflight=${hasPreflight ? 'true' : 'likely'}${hasFailedFetch ? ' symptom=TypeError: Failed to fetch' : ''}`,
    fix: `Configure ORDS/proxy CORS for OPTIONS on ${endpoint}: return 2xx for the preflight and add Access-Control-Allow-Origin for ${origin}, Access-Control-Allow-Methods including OPTIONS and the actual method, and the required Access-Control-Allow-Headers.`,
    srGuidance:
      'Collect ORDS access logs and reverse-proxy logs for the OPTIONS request, including request Origin and response CORS headers.',
  };
}

export function buildDeterministicInsights(
  context: string,
  sourceType: InsightsSourceType = 'har'
): InsightSection[] {
  if (!hasCorsEvidence(context, sourceType)) return [];

  return [
    {
      type: 'critical_issues',
      title: 'Critical Issues',
      findings: [buildCorsFinding(context)],
    },
  ];
}

function findingFingerprint(finding: InsightFinding): string {
  return `${finding.title.toLowerCase()}::${finding.evidence.toLowerCase()}`;
}

function dedupeFindings(findings: InsightFinding[]): InsightFinding[] {
  const seen = new Set<string>();
  const deduped: InsightFinding[] = [];

  for (const finding of findings) {
    const fingerprint = findingFingerprint(finding);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    deduped.push(finding);
  }

  return deduped;
}

export function mergeDeterministicInsights(
  modelSections: InsightSection[],
  deterministicSections: InsightSection[]
): InsightSection[] {
  if (deterministicSections.length === 0) return modelSections;

  const merged = new Map<InsightSectionType, InsightSection>();

  for (const section of modelSections) {
    merged.set(section.type, {
      ...section,
      findings: [...section.findings],
    });
  }

  for (const deterministicSection of deterministicSections) {
    const existing = merged.get(deterministicSection.type);
    if (!existing) {
      merged.set(deterministicSection.type, {
        ...deterministicSection,
        findings: dedupeFindings(deterministicSection.findings).slice(0, 3),
      });
      continue;
    }

    merged.set(deterministicSection.type, {
      ...existing,
      title: existing.title || deterministicSection.title,
      findings: dedupeFindings([
        ...deterministicSection.findings,
        ...existing.findings,
      ]).slice(0, 3),
    });
  }

  return Array.from(merged.values()).sort(
    (a, b) => SECTION_PRIORITY[a.type] - SECTION_PRIORITY[b.type]
  );
}
