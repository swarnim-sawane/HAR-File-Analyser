# Analyzer Contract

## Evidence Levels

- **Observed**: directly present in the supplied evidence.
- **Correlated**: supported by multiple observations that align in time or
  request flow.
- **Hypothesis**: a plausible explanation that still requires validation.

Never present a hypothesis as an observed root cause.

## Severity

- **Critical**: broad outage, security exposure, or unrecoverable data risk
  directly supported by evidence.
- **High**: user-visible failure, repeated server error, or blocked primary
  workflow.
- **Medium**: degraded behavior, significant latency, risky configuration, or
  partial failure.
- **Low**: optimization or isolated observation with limited impact.
- **Info**: context that helps investigation but is not a defect by itself.

## Confidence

- **High**: explicit protocol or log evidence.
- **Medium**: strong correlation with limited ambiguity.
- **Low**: incomplete, fallback, or format-unknown evidence.

## Parser Health

- **Parsed**: timestamp and recognized level or a structured record were parsed.
- **Partial**: only part of the line was recognized, such as an explicit level,
  HTTP status, CORS failure, or timestamp.
- **Fallback**: the line is preserved but its format is unsupported.

Fallback evidence must remain visible and must not be promoted to warning or
error without explicit evidence.

## HAR Guardrails

- Status `0` means no normal HTTP response was recorded. Check cancellation,
  navigation, client blocking, DNS, TLS, proxy, timeout, and CORS evidence.
- An `OPTIONS` request is not automatically a failed preflight.
- A redirect is not automatically a redirect loop.
- A repeated endpoint is not automatically a defect. Repeated failures or
  unnecessary identical requests are stronger evidence.
- A large transfer or missing compression is a performance observation, not a
  functional failure.
- Missing cache headers matter most for reusable static resources.
- A repeated failing signature is a strong observation. A repeated successful
  signature, however, might be normal polling, loading, or telemetry.
- A redirect-cycle candidate is not a confirmed loop until the surrounding
  navigation proves the browser returns to an earlier redirect source.
- The `requestJourney` phase labels are heuristic navigation aids; rely on
  request evidence, not the label alone, for root-cause claims.
- Remove query and fragment values from reported URLs.

## Output Contract

The analyzer writes JSON only. Its sections have these roles:

- `summary`: capture-wide request, method, status, latency, and domain facts.
- `findings`: ranked deterministic signals with sanitized evidence samples.
- `performance`: slow-request ranking and aggregated HAR timing phases.
- `domainAnalysis`: per-host request, failure, latency, and evidence rollups.
- `requestJourney`: heuristic document, authentication, callback, application,
  static, persistent, and logout groupings.
- `parserHealth` and `limitations`: reasons to lower confidence or request more
  evidence.

Never invent missing fields to make a report look complete.

## Console Guardrails

- Require explicit failure language for CORS classification.
- Do not classify neutral references to preflight, access control, or
  `Access-Control-Allow-Origin` as failures.
- Recognize HTTP failures only from explicit protocol/status forms, such as
  `HTTP/1.1 503` or `status: 503`.
- Preserve unknown lines with low confidence.

## Privacy Contract

Reports may include sanitized URLs, methods, status codes, durations, source
line numbers, and summarized messages. Reports must not include:

- authorization, cookie, token, password, or API-key values
- request or response bodies
- query-string or fragment values
- customer identifiers that are not needed to explain the finding

Recommend running evidence through the approved Data Sanitizer before sharing.
