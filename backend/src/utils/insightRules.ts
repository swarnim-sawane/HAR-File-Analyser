export type InsightSectionType =
  | 'analyzer_evidence'
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
  analyzer_evidence: 0,
  critical_issues: 1,
  performance: 2,
  security: 3,
  recommendations: 4,
};

const CORS_FAILURE_RE =
  /\b(CORS_BLOCKED|blocked by CORS policy|cross-origin request blocked|preflight request[^.\n]*(?:fail|failed|doesn'?t pass|not pass|blocked|denied)|(?:no|missing)\s+['"]?Access-Control-Allow-Origin|access control check[^.\n]*(?:fail|failed|doesn'?t pass|not pass|blocked|denied)|CORS policy[^.\n]*(?:fail|failed|blocked|denied))\b/i;
const FAILED_FETCH_RE = /\bTypeError:\s*Failed to fetch\b|\bFailed to fetch\b/i;
const JPX_METADATA_STORE_RE =
  /JPX Namespace\s+\/sitedef\s+does not have a writable MetadataStore/i;

export function normalizeInsightsSourceType(value: unknown): InsightsSourceType {
  return value === 'console' ? 'console' : 'har';
}

export function getEmptyInsightsSummary(sourceType: InsightsSourceType): string {
  if (sourceType === 'console') {
    return 'No high-confidence, evidence-backed console findings were identified in the analyzed log context. The log was parsed, but the model response did not include concrete evidence and actionable remediation that passed validation.';
  }

  return 'No high-confidence, evidence-backed HAR findings were identified in the analyzed request context. The HAR was parsed, but the model response did not include concrete evidence and actionable remediation that passed validation.';
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
  const corsLine = context.split(/\r?\n/).find((line) => CORS_FAILURE_RE.test(line)) ?? context;
  return (
    extractField(corsLine, 'endpoint') ||
    extractQuotedValue(context, /\b(?:fetch|XMLHttpRequest)\s+at\s+['"]([^'"]+)['"]/i) ||
    extractQuotedValue(context, /\bAccess to fetch at\s+['"]([^'"]+)['"]/i) ||
    extractFirstUrl(context)
  );
}

function extractOrigin(context: string): string | null {
  const corsLine = context.split(/\r?\n/).find((line) => CORS_FAILURE_RE.test(line)) ?? context;
  return (
    extractField(corsLine, 'origin') ||
    extractQuotedValue(context, /\bfrom origin\s+['"]([^'"]+)['"]/i)
  );
}

function hasCorsEvidence(context: string, sourceType: InsightsSourceType): boolean {
  return sourceType === 'console' && CORS_FAILURE_RE.test(context);
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

function extractJpxMetadataStoreCount(context: string): number {
  const repeatedMatch = context.match(/x(\d+):[^\n]*JPX Namespace\s+\/sitedef\s+does not have a writable MetadataStore/i);
  if (repeatedMatch?.[1]) {
    return Number.parseInt(repeatedMatch[1], 10);
  }

  const errorsMatch = context.match(/ERRORS\s+\((\d+)\s+total\)/i);
  if (errorsMatch?.[1]) {
    return Number.parseInt(errorsMatch[1], 10);
  }

  return 1;
}

function extractJpxMetadataStoreSource(context: string): string {
  return (
    context.match(/ERROR\s+\[([^\]]*Jpx[^\]]*)\]/i)?.[1] ||
    context.match(/\[([^\]]*Jpx[^\]]*)\]/i)?.[1] ||
    'oracle.adf.model.log.Jpx'
  );
}

function buildJpxMetadataStoreFinding(context: string): InsightFinding {
  const count = extractJpxMetadataStoreCount(context);
  const source = extractJpxMetadataStoreSource(context);

  return {
    severity: count >= 3 ? 'medium' : 'low',
    title: 'Repeated ADF metadata-store error signal',
    product: 'Visual Builder',
    component: 'ADF metadata store',
    what: `The analyzer found ${count} server error signal${count === 1 ? '' : 's'} from ${source}: JPX Namespace /sitedef does not have a writable MetadataStore.`,
    why: 'This points to a server-side ADF metadata-store persistence/configuration signal. It is analyzer evidence, not an AI-confirmed root cause, so it should be correlated with the affected request window.',
    evidence: `ERROR [${source}]: JPX Namespace /sitedef does not have a writable MetadataStore, forcing mMergedJpxPersisted to DISABLE`,
    fix: 'Review the Visual Builder/ADF metadata-store configuration for /sitedef and collect surrounding server logs for the same tenant, user, and timestamp before raising an SR.',
    srGuidance:
      'Collect Catalina logs around the repeated JPX errors, tenant/user context, affected URI, and any ADF metadata-store or MDS configuration diagnostics.',
  };
}

function buildAnalyzerEvidenceInsights(
  context: string,
  sourceType: InsightsSourceType
): InsightSection[] {
  if (sourceType !== 'console' || !JPX_METADATA_STORE_RE.test(context)) return [];

  return [
    {
      type: 'analyzer_evidence',
      title: 'Analyzer Evidence',
      findings: [buildJpxMetadataStoreFinding(context)],
    },
  ];
}

function firstHarEvidenceLine(context: string, headingPattern: RegExp): string | null {
  const lines = context.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => headingPattern.test(line));
  if (headingIndex === -1) return null;

  return lines
    .slice(headingIndex + 1)
    .find((line) => /\bstatus:\d{3}\b/i.test(line) || /\bstatus\b[^0-9]{0,8}\d{3}\b/i.test(line))
    ?.trim() ?? null;
}

function inferOracleProductFromHarLine(line: string): { product?: string; component?: string } {
  if (/idcs|oauth2|openid|sso|token/i.test(line)) {
    return { product: 'IDCS', component: 'Authentication/session flow' };
  }

  if (/\/ords(?:\/|$)|ords\./i.test(line)) {
    return { product: 'ORDS', component: 'ORDS REST endpoint' };
  }

  if (/vbcs|visualbuilder|visual-builder|\/ic\/builder|vb\./i.test(line)) {
    return { product: 'VBCS', component: 'Visual Builder application' };
  }

  return {};
}

function buildHarServerErrorFinding(context: string): InsightFinding | null {
  const evidenceLine = firstHarEvidenceLine(context, /5XX SERVER ERRORS/i);
  if (!evidenceLine) return null;

  const product = inferOracleProductFromHarLine(evidenceLine);

  return {
    severity: /x\d+\s+failures|\brepeated\b/i.test(context) ? 'critical' : 'high',
    title: 'HTTP 5xx failure detected in HAR',
    ...product,
    what: `The HAR contains a server-side failure that should be triaged before successful 2xx performance signals: ${evidenceLine}.`,
    why: 'A 5xx response means the browser reached a backend or gateway layer that failed while handling the request; this is higher priority than slow successful responses.',
    evidence: evidenceLine,
    fix: 'Route this to the owning backend or platform team with the failing endpoint, status code, timestamp, and server-side logs for the same request window.',
    srGuidance:
      'Collect application server logs, gateway/proxy logs, and any ORDS or WebLogic diagnostic logs around the failed request timestamp.',
  };
}

function buildHarClientErrorFinding(context: string): InsightFinding | null {
  const evidenceLine = firstHarEvidenceLine(context, /4XX CLIENT ERRORS/i);
  if (!evidenceLine) return null;

  const product = inferOracleProductFromHarLine(evidenceLine);
  const isAuth = /\bstatus:(401|403)\b|\b(401|403)\b/i.test(evidenceLine);

  return {
    severity: isAuth ? 'high' : 'medium',
    title: isAuth
      ? 'Authentication or authorization failure detected in HAR'
      : 'HTTP 4xx failure detected in HAR',
    ...product,
    what: `The HAR contains a client/error-tier response that is likely relevant to the reported issue: ${evidenceLine}.`,
    why: isAuth
      ? '401/403 responses usually indicate an authentication, authorization, token, or stale-session problem and should be checked before performance-only findings.'
      : '4xx responses indicate the browser requested a resource or endpoint the server rejected or could not resolve.',
    evidence: evidenceLine,
    fix: isAuth
      ? 'Validate the sign-in/sign-out sequence, token/session freshness, IDCS/OAM policy, and the application redirect target for this request.'
      : 'Validate the requested endpoint, route/module registration, proxy rewrite rule, and application deployment mapping for this request.',
    srGuidance: isAuth
      ? 'Collect IDCS/OAM audit events, browser timestamps, user identifier, and application session logs around the failing 401/403 request.'
      : 'Collect application routing/deployment details and server or proxy access logs for the failing 4xx request.',
  };
}

function buildHarDeterministicInsights(context: string, sourceType: InsightsSourceType): InsightSection[] {
  if (sourceType !== 'har') return [];

  const findings = [
    buildHarServerErrorFinding(context),
    buildHarClientErrorFinding(context),
  ].filter((finding): finding is InsightFinding => Boolean(finding));

  if (findings.length === 0) return [];

  return [
    {
      type: 'critical_issues',
      title: 'Critical Issues',
      findings,
    },
  ];
}

export function buildDeterministicInsights(
  context: string,
  sourceType: InsightsSourceType = 'har'
): InsightSection[] {
  const sections: InsightSection[] = [];

  if (hasCorsEvidence(context, sourceType)) {
    sections.push({
      type: 'critical_issues',
      title: 'Critical Issues',
      findings: [buildCorsFinding(context)],
    });
  }

  sections.push(...buildAnalyzerEvidenceInsights(context, sourceType));
  sections.push(...buildHarDeterministicInsights(context, sourceType));

  return sections;
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
