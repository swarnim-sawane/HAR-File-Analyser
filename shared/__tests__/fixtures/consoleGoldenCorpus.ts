export interface ConsoleGoldenExpectation {
  level: string;
  source?: string;
  messageIncludes: string;
  issueTags?: string[];
  notIssueTags?: string[];
  inferredSeverity?: string;
  parseStatus: 'parsed' | 'partial' | 'fallback';
  parseFormat:
    | 'json'
    | 'odl'
    | 'catalina-iso'
    | 'browser-console'
    | 'access-log'
    | 'generic-level'
    | 'fallback';
  parseConfidence: 'high' | 'medium' | 'low';
}

export interface ConsoleGoldenCase {
  name: string;
  content: string;
  expected: ConsoleGoldenExpectation[];
}

export const consoleGoldenCases: ConsoleGoldenCase[] = [
  {
    name: 'Catalina bracketed ISO server log',
    content: [
      '2026-05-09T17:20:53.362Z [INFO] [http-nio-10.89.0.2-8012-exec-2] [Context: {tenantId=7712EB5F949146B4910EB86BD8EBF46F}] [com.oracle.breeze.metrics.HourlyVisitorTrackingFilter@1007] VB_OPID_HOURLY_VISIT: Added one to TenantHourlyPK for URI /rt/warehouse_reception_module/live/resources/data/GantryOblpnInfo Headers: User-Agent = oracle-cloud-rest/21.2.1',
      '2026-05-09T17:20:53.443Z [ERROR] [vb-data-rt-pool-thread-9403] [Context: {tenantId=7712EB5F949146B4910EB86BD8EBF46F}] [oracle.adf.model.log.Jpx@2240] JPX Namespace /sitedef does not have a writable MetadataStore, forcing mMergedJpxPersisted to DISABLE',
    ].join('\n'),
    expected: [
      {
        level: 'info',
        source: 'com.oracle.breeze.metrics.HourlyVisitorTrackingFilter@1007',
        messageIncludes: 'VB_OPID_HOURLY_VISIT',
        notIssueTags: ['cors', 'network'],
        inferredSeverity: 'none',
        parseStatus: 'parsed',
        parseFormat: 'catalina-iso',
        parseConfidence: 'high',
      },
      {
        level: 'error',
        source: 'oracle.adf.model.log.Jpx@2240',
        messageIncludes: 'writable MetadataStore',
        inferredSeverity: 'none',
        parseStatus: 'parsed',
        parseFormat: 'catalina-iso',
        parseConfidence: 'high',
      },
    ],
  },
  {
    name: 'ODL server log',
    content:
      '[2026-05-09T17:20:53.443+00:00] [oacore] [ERROR] [JBO-29000] [oracle.adf.model.log.Jpx] [tid: 12] JPX Namespace /sitedef does not have a writable MetadataStore',
    expected: [
      {
        level: 'error',
        source: 'oracle.adf.model.log.Jpx',
        messageIncludes: 'JPX Namespace',
        parseStatus: 'parsed',
        parseFormat: 'odl',
        parseConfidence: 'high',
      },
    ],
  },
  {
    name: 'Apache access log successful status with large response body',
    content:
      '[09/May/2026:15:57:00 +0000] 252.177.147.165 - C6135B63D0AC31293BFAD982B55A4BCB "GET /ic/builder/rt/app/live/resources/data/GantryReplenishment HTTP/1.1" 200 507088 565',
    expected: [
      {
        level: 'log',
        source: '252.177.147.165',
        messageIncludes: 'GET /ic/builder/rt/app/live/resources/data/GantryReplenishment HTTP/1.1',
        notIssueTags: ['http-5xx'],
        inferredSeverity: 'none',
        parseStatus: 'parsed',
        parseFormat: 'access-log',
        parseConfidence: 'high',
      },
    ],
  },
  {
    name: 'Browser CORS failure',
    content:
      "webapp/:1 Access to fetch at 'https://api.example.com/ords/test' from origin 'https://app.example.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
    expected: [
      {
        level: 'error',
        source: 'webapp/',
        messageIncludes: 'blocked by CORS policy',
        issueTags: ['cors', 'network'],
        inferredSeverity: 'error',
        parseStatus: 'partial',
        parseFormat: 'browser-console',
        parseConfidence: 'medium',
      },
    ],
  },
  {
    name: 'Harmless CORS header counter',
    content: 'Access-Control-Allow-Origin: count 1',
    expected: [
      {
        level: 'log',
        messageIncludes: 'Access-Control-Allow-Origin: count 1',
        notIssueTags: ['cors', 'network'],
        inferredSeverity: 'none',
        parseStatus: 'fallback',
        parseFormat: 'fallback',
        parseConfidence: 'low',
      },
    ],
  },
  {
    name: 'Successful status with millisecond timing',
    content: 'GET /ords/status completed with status 200 in 500ms',
    expected: [
      {
        level: 'log',
        messageIncludes: 'status 200 in 500ms',
        notIssueTags: ['http-5xx'],
        inferredSeverity: 'none',
        parseStatus: 'fallback',
        parseFormat: 'fallback',
        parseConfidence: 'low',
      },
    ],
  },
  {
    name: 'Unknown server line',
    content: 'Tenant routing cache warmed for shard alpha without diagnostic prefix',
    expected: [
      {
        level: 'log',
        messageIncludes: 'Tenant routing cache warmed',
        notIssueTags: ['cors', 'network', 'http-5xx'],
        inferredSeverity: 'none',
        parseStatus: 'fallback',
        parseFormat: 'fallback',
        parseConfidence: 'low',
      },
    ],
  },
];
