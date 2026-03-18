export interface OracleProductMatch {
  product: string;
  shortName: string;
  component: string;
  subComponent?: string;
  knownIssues: string[];
}

export interface DetectedOracleProduct {
  product: string;
  shortName: string;
  components: string[];
  matchedUrls: string[];
  knownIssueHints: string[];
}

const ORACLE_PATTERNS: Array<{ pattern: RegExp; match: OracleProductMatch }> = [
  {
    // VB Studio design-time: /vbdt/design/ and /vbdt/ paths used by the designer experience
    pattern: /\/vbdt\/|\/vbdt$/i,
    match: {
      product: 'Oracle Visual Builder Studio',
      shortName: 'VB Studio',
      component: 'Design-time Resource Loader',
      subComponent: 'Application Design Package',
      knownIssues: [
        'Large VB applications with many pages, flows, or custom components causing slow /vbdt/design/ load.',
        'Slow /resources/storage/ responses from oversized binary assets stored in the VB app package.',
        'Design-time resource requests serialized due to missing HTTP/2 multiplexing on the VB Studio endpoint.',
        'High wait_ms on /vbdt/ paths indicating VB Studio backend hydration delay for large app definitions.',
      ],
    },
  },
  {
    pattern: /\/ic\/builder\/rt\/|\/rt\/SPA\//i,
    match: {
      product: 'Oracle Visual Builder Studio',
      shortName: 'VB Studio',
      component: 'VB Runtime Engine',
      subComponent: 'SPA Runtime Loader',
      knownIssues: [
        'Sequential Service Data Provider calls on page entry causing serialized latency.',
        'Action chain initialization bottlenecks in startup events.',
        'Large page metadata and fragment graphs delaying runtime hydration.',
      ],
    },
  },
  {
    pattern: /\/ic\/builder\/|oraclejet|\/oj\//i,
    match: {
      product: 'Oracle Visual Builder Studio',
      shortName: 'VB Studio',
      component: 'VB Studio Runtime',
      subComponent: 'Oracle JET Loader',
      knownIssues: [
        'Excessive module fetches increasing bootstrap cost.',
        'Component bundle fan-out due to missing route-level lazy loading.',
        'Theme and shell assets blocking first route paint.',
      ],
    },
  },
  {
    pattern: /\/ic\/api\/integration\/v\d+\/|\/ic\/home\/designer\//i,
    match: {
      product: 'Oracle Integration Cloud',
      shortName: 'OIC',
      component: 'Integration Flow Executor',
      subComponent: 'REST Trigger Endpoint',
      knownIssues: [
        'Mapper and downstream adapter latency driving high wait time.',
        'Integration queue backlog causing bursty response times.',
        'Connection pool saturation on adapter connections.',
      ],
    },
  },
  {
    pattern: /\/oauth2\/v1\/|\/sso\/v1\/|identity\.oraclecloud/i,
    match: {
      product: 'Oracle Identity Cloud Service',
      shortName: 'IDCS',
      component: 'OAuth2 and SSO Gateway',
      subComponent: 'Token Service',
      knownIssues: [
        'Token refresh loops due to short token windows or propagation gaps.',
        'Repeated authorization redirects from session cookie scope mismatches.',
        '401 cascades after stale bearer token reuse.',
      ],
    },
  },
  {
    pattern: /\/fscmUI\/|\/hcmUI\/|\/scmUI\/|\/crmUI\/|\/fscmRestApi\/|\/hcmRestApi\//i,
    match: {
      product: 'Oracle Fusion Applications',
      shortName: 'Fusion Apps',
      component: 'Fusion UI Shell',
      subComponent: 'Business Object REST Proxy',
      knownIssues: [
        'Slow task-flow and region initialization in page shell.',
        'Effective-dated REST queries returning oversized datasets.',
        'Report and attachment service latency impacting workflow pages.',
      ],
    },
  },
  {
    pattern: /\/content\/published\/api\/|\/content\/management\/api\//i,
    match: {
      product: 'Oracle Content Management',
      shortName: 'OCM',
      component: 'Content Delivery API',
      subComponent: 'Asset and Rendition Service',
      knownIssues: [
        'Content queries missing filters causing oversized payloads.',
        'Large rendition delivery without effective edge cache usage.',
        'Schema-heavy content types increasing response processing time.',
      ],
    },
  },
  {
    pattern: /objectstorage\..*\.oraclecloud\.com|\.oraclecloud\.com\/20\d{6}\//i,
    match: {
      product: 'Oracle Cloud Infrastructure',
      shortName: 'OCI',
      component: 'OCI REST API',
      subComponent: 'Object Storage and Control Plane',
      knownIssues: [
        'Compartment throttling and retry storms causing request bursts.',
        'Signature and clock skew issues creating authorization failures.',
        'Cross-region endpoint usage introducing avoidable latency.',
      ],
    },
  },
  {
    pattern: /\/ui\/dv\/|\/ui\/analytics\/|\/analytics\/saw\.dll/i,
    match: {
      product: 'Oracle Analytics Cloud',
      shortName: 'OAC',
      component: 'Dashboard Renderer',
      subComponent: 'Query Execution Pipeline',
      knownIssues: [
        'Slow dashboard render from non-cached physical query paths.',
        'Presentation server queue saturation causing burst latency.',
        'Large browser-side datasets due to missing aggregation pushdown.',
      ],
    },
  },
  {
    pattern: /\/commerce\/|\/cpq\//i,
    match: {
      product: 'Oracle CPQ Cloud',
      shortName: 'CPQ',
      component: 'Configuration and Pricing Engine',
      subComponent: 'Commerce Runtime',
      knownIssues: [
        'Rule evaluation fan-out causing configuration page delays.',
        'Pricing calls blocked by synchronous external dependency checks.',
        'Deep product structure expansion without cache reuse.',
      ],
    },
  },
  {
    pattern: /\/ords\/|\/ords\/_\/|ords\.oraclecloud\.com/i,
    match: {
      product: 'Oracle REST Data Services',
      shortName: 'ORDS',
      component: 'ORDS REST Gateway',
      subComponent: 'Connection Pool and SQL Handler',
      knownIssues: [
        'Connection pool exhaustion causing 503 Service Unavailable under concurrent load — check ords.xml pool settings.',
        'REST module or privilege not found returning 404 from missing ORDS module registration or grant.',
        '401 Unauthorized on protected endpoints from OAuth scope mismatch, expired JWT, or missing privilege assignment.',
        'Slow SQL queries backing REST handlers elevating TTFB on /ords/ paths — profile with DBMS_MONITOR or AWR.',
        'APEX-ORDS integration POST/PUT latency from trigger, validation, or audit overhead on the backing table.',
      ],
    },
  },
  {
    pattern: /\/faces\/|_adf\.ctrl-state|ADF_FACES|adfb\.|javax\.faces\./i,
    match: {
      product: 'Oracle ADF (Application Development Framework)',
      shortName: 'ADF',
      component: 'ADF Faces Runtime',
      subComponent: 'Partial Page Rendering Engine',
      knownIssues: [
        'Serialized Partial Page Rendering (PPR) XHR calls to /faces/ creating sequential request waterfalls on action.',
        'ViewObject fetch-all queries returning oversized datasets to the UI tier — missing setMaxFetchSize or query-by-example.',
        'JSF viewState inflation increasing POST body size and server-side deserialization time.',
        'ADF task flow navigation triggering full-page redirects instead of bounded region refreshes.',
        'ADF session state serialization latency on large conversation-scope or pageFlowScope payloads.',
      ],
    },
  },
  {
    pattern: /frmservlet|\/forms\/frmservlet|\/forms\/lservlet|formsapp/i,
    match: {
      product: 'Oracle Forms',
      shortName: 'Forms',
      component: 'Forms Listener Servlet',
      subComponent: 'Forms Runtime Engine',
      knownIssues: [
        'Forms Listener Servlet unavailability causing connection refused or timeout on initial frmservlet request.',
        'WebUtil and Java applet initialization failures delaying Forms client launch — check JRE version and webutil.cfg.',
        'Forms heartbeat (keepalive) requests timing out indicating server-side session expiry or WLS node restart.',
        'High network round-trip amplification from chatty Forms record-locking and screen-refresh protocol.',
        'Forms session failover gaps after WLS managed server bounce causing client disconnect or data loss.',
      ],
    },
  },
  {
    pattern: /\/resources\/data\/[^/]+\?|\/ic\/builder\/rt\/[^/]+\/[^/]+\/resources\//i,
    match: {
      product: 'Oracle Visual Builder Cloud Service',
      shortName: 'VBCS',
      component: 'Business Objects REST API',
      subComponent: 'Data Provider Layer',
      knownIssues: [
        'Business Object queries returning full dataset without filterCriterion, inflating response payload significantly.',
        'Sequential Business Object fetches on page load creating a startup request waterfall — should parallelize via SDP.',
        'Process (workflow) API calls adding synchronous latency to page navigation or button actions.',
        'BO trigger and validation overhead from custom business rules inflating POST/PATCH response times.',
        'Missing field selection (fields= parameter) causing oversized BO responses with unrequested attributes.',
      ],
    },
  },
];

const uniq = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

function extractUrlsFromContext(context: string): string[] {
  const urlMatches = context.match(/https?:\/\/[^\s"'`<>]+/gi) || [];
  return uniq(urlMatches).slice(0, 240);
}

function collectMatchedLines(context: string, pattern: RegExp): string[] {
  const lines = context
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.filter((line) => pattern.test(line)).slice(0, 5);
}

export function detectOracleProductsFromContext(context: string): DetectedOracleProduct[] {
  const source = typeof context === 'string' ? context : '';
  if (!source.trim()) return [];

  const urls = extractUrlsFromContext(source);
  const detected = new Map<string, DetectedOracleProduct>();

  for (const { pattern, match } of ORACLE_PATTERNS) {
    const urlMatches = urls.filter((url) => pattern.test(url));
    const contextMatched = pattern.test(source);
    if (urlMatches.length === 0 && !contextMatched) continue;

    const key = `${match.product}::${match.component}`;
    const existing = detected.get(key);
    const sampleUrls =
      urlMatches.length > 0 ? urlMatches.slice(0, 5) : collectMatchedLines(source, pattern);

    const next: DetectedOracleProduct = existing
      ? {
          ...existing,
          components: uniq([
            ...existing.components,
            match.component,
            ...(match.subComponent ? [match.subComponent] : []),
          ]),
          matchedUrls: uniq([...existing.matchedUrls, ...sampleUrls]).slice(0, 5),
          knownIssueHints: uniq([...existing.knownIssueHints, ...match.knownIssues]).slice(0, 8),
        }
      : {
          product: match.product,
          shortName: match.shortName,
          components: uniq([match.component, ...(match.subComponent ? [match.subComponent] : [])]),
          matchedUrls: sampleUrls,
          knownIssueHints: match.knownIssues.slice(0, 8),
        };

    detected.set(key, next);
  }

  return Array.from(detected.values()).sort((a, b) => a.product.localeCompare(b.product));
}

export function buildOracleKbPrompt(detectedProducts: DetectedOracleProduct[]): string {
  if (!detectedProducts.length) return '';

  // Deduplicate by shortName so the same product doesn't appear twice (multiple pattern matches)
  const seen = new Set<string>();
  const unique = detectedProducts.filter((p) => {
    if (seen.has(p.shortName)) return false;
    seen.add(p.shortName);
    return true;
  });

  const lines: string[] = ['=== ORACLE PRODUCTS DETECTED ==='];

  for (const product of unique) {
    lines.push(`${product.shortName} (${product.product}): ${product.components.slice(0, 2).join(', ')}`);
    // Limit to 2 known issues — the model gets the pattern; more just burns tokens
    for (const hint of product.knownIssueHints.slice(0, 2)) {
      lines.push(`  - ${hint}`);
    }
  }

  lines.push('Use exact product/component names above in every finding. No generic advice.');
  lines.push('=== END ===');

  return lines.join('\n');
}

export function buildOracleSpecificityTokens(detectedProducts: DetectedOracleProduct[]): Set<string> {
  const tokens: string[] = [];

  for (const product of detectedProducts) {
    tokens.push(product.product, product.shortName, ...product.components);
  }

  return new Set(
    tokens
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length >= 3)
  );
}
