# HAR Analyzer Consolidation Backlog

Status: Active implementation backlog
Date: 2026-08-16
Source of truth: move these items into the team's approved issue tracker when available; until then this file is authoritative.

## Status definitions

| Status | Meaning |
|---|---|
| Ready | Scope and acceptance criteria are sufficient to begin |
| In progress | Implementation and local verification are underway; release verification remains |
| Discovery | A bounded decision or inventory is still required |
| Blocked | An external decision or dependency prevents useful implementation |
| Rejected | Deliberately excluded because its risk, ambiguity, or duplication exceeds its product value |
| Done | Acceptance criteria and verification evidence are complete |

## Priority model

- P0: required for safe consolidation or reliable operation.
- P1: high-value functionality needed before Workbench retirement.
- P2: useful enhancement that does not block consolidation.
- P3: retain only if evidence proves the cost is justified.

## Program backlog

| ID | Priority | Status | Work item | Acceptance summary |
|---|---:|---|---|---|
| CONS-001 | P0 | Ready | Freeze and baseline Workbench | Commit, image digest, deployment state, tests, consumers, and limitations are recorded; only migration/security fixes continue |
| CONS-002 | P0 | Ready | Baseline Data Sanitizer | Supported applications, release state, security gates, consumers, and reusable privacy assets are recorded |
| CONS-003 | P0 | Ready | Establish one backlog and owner | New HAR, Workbench-migration, privacy, deployment, and observability work is triaged in one place |
| HAR-101 | P1 | In progress | Port console-log issue map | Implemented with deterministic grouping, first/last occurrence evidence, source navigation, and local tests; deployment verification remains |
| HAR-102 | P1 | In progress | Port console-log comparison | Implemented with new/resolved/increased/decreased/unchanged signatures and evidence navigation; deployment verification remains |
| HAR-103 | P3 | Rejected | Reject inferred console action chains | Time-window and before/after links can imply causality without an exact correlation identifier; the feature has been removed from the stable UI and source |
| HAR-104 | P3 | Rejected | Reject cross-source incident timeline | Clock skew, partial evidence, and unrelated overlapping events can create false relationships; the feature has been removed from the stable UI and source |
| HAR-105 | P3 | Rejected | Reject generic evidence routing | Unrelated or unsupported files must fail clearly; a file type is added only with a dedicated deterministic analyzer, fixtures, limits, and tests |
| HAR-106 | P3 | Rejected | Delegate narrative support reporting to Codex | The application exposes structured deterministic findings and privacy metadata; Codex produces narrative summaries when requested |
| HAR-107 | P1 | Discovery | Adopt stable workspace/evidence model | Investigation identifiers survive navigation and can support MCP and deep links without exposing storage paths |
| PERF-101 | P1 | Ready | Establish large-HAR performance baseline | Measure parse, render, filter, flow, scorecard, and compare behavior at representative entry counts before optimizing measured bottlenecks |
| MCP-101 | P1 | Ready | Implement HAR Analyzer MCP adapter | Tools use stable APIs, bounded inline uploads or server paths, structured errors, authentication, and audit logs |
| MCP-102 | P1 | Ready | Update Workbench Codex skill | The distinct Workbench skill targets the HAR MCP adapter; the local analyzer skill remains local-only |
| PRIV-101 | P0 | Ready | Approve data-handling decision record | Allowed systems, data classes, retention, model usage, export rules, and approvers are explicit |
| PRIV-102 | P0 | Ready | Define shared redaction contracts | Finding, replacement, receipt, policy, verification, and failure contracts are versioned and tested |
| PRIV-103 | P0 | Ready | Integrate HAR and console adapters | Sanitization preserves required diagnostic structure and removes configured sensitive values |
| PRIV-104 | P0 | Ready | Enforce trust-boundary policies | Model, share, ticket, and report paths cannot bypass their configured privacy policy |
| PRIV-105 | P1 | Ready | Add privacy regression corpus | Representative and adversarial fixtures cover secrets, tokens, identifiers, URLs, headers, and multiline logs |
| OPS-101 | P0 | Ready | Establish production service indicators | Availability, latency, error rate, saturation, queue health, and deployment version are queryable |
| OPS-102 | P0 | Ready | Add actionable alarms | Alarms have thresholds, severity, owner, notification route, runbook, and duplicate suppression |
| OPS-103 | P1 | Ready | Automate post-deployment verification | Authentication, UI, upload, analysis, queue, storage, and safe-export smoke tests produce retained evidence |
| OPS-104 | P1 | Ready | Establish backup and recovery checks | Recovery procedure, evidence retention, object storage, and database restore assumptions are tested |
| SEC-101 | P0 | Ready | Run application security baseline | Secrets, dependencies, uploads, auth, injection, browser security, container, and infrastructure are reviewed |
| SEC-102 | P0 | Ready | Add release security gates | Dependency and static scans run on clean installs; findings have severity-based release rules |
| RET-101 | P1 | Blocked | Put Workbench in read-only mode | Blocked until approved P1 migrations and consumer inventory are complete |
| RET-102 | P1 | Blocked | Archive Workbench service | Blocked until read-only observation passes and rollback artifacts are verified |
| RET-103 | P2 | Blocked | Retire standalone Data Sanitizer release path | Blocked until policy decision, consumer inventory, privacy-core adoption, and owner approval |
| EXP-101 | P3 | Discovery | Evaluate video evidence | Retain only if a real support workflow, privacy model, performance budget, and owner are identified |
| EXP-102 | P3 | Discovery | Evaluate embeddings/vector search | Do not migrate Ollama, Chroma, or embedding infrastructure without measured retrieval value |

## Issue-ready specifications

### CONS-001 - Freeze and baseline Workbench

Deliverables:

- tag or record the migration source commit;
- record the last known deployment/image and current reachability;
- list active MCP clients, deep-link consumers, and stored investigations;
- record the exact passing test commands and failures;
- add a maintenance-only notice in the Workbench repository;
- forbid new feature work outside approved migration tasks.

Acceptance criteria:

- the Workbench state can be reconstructed from documentation and retained artifacts;
- every known consumer has an owner and migration disposition;
- the baseline distinguishes locally tested, deployed, and currently reachable states.

### CONS-002 - Baseline Data Sanitizer

Deliverables:

- record the canonical source commit and supported applications;
- identify every current user, automation, and distributed binary;
- inventory reusable contracts, adapters, fixtures, receipts, and tests;
- record unresolved dependency, security-scan, signing, and platform-validation gates;
- mark standalone work as maintenance-only pending the policy decision.

Acceptance criteria:

- no standalone consumer is retired accidentally;
- reusable privacy assets have a target HAR module or an explicit rejection reason;
- release evidence is preserved separately from source-complete claims.

### HAR-101 - Console-log issue map

Candidate migration source:

- `src/utils/consoleLogIssueMap.ts`
- `src/utils/__tests__/consoleLogIssueMap.test.ts`
- `src/components/ConsoleLogIssueMap.tsx`

Acceptance criteria:

- groups repeated errors without losing the original event references;
- shows count, first occurrence, last occurrence, severity, and representative message;
- selecting a group navigates to its source events;
- parsing failures produce a bounded, user-visible error;
- tests cover repeated events, mixed severities, empty logs, malformed lines, and stable ordering;
- no network or AI call is required.

### HAR-102 - Console-log comparison

Candidate migration source:

- `src/utils/consoleLogCompare.ts`
- `src/utils/__tests__/consoleLogCompare.test.ts`
- `src/components/ConsoleLogCompare.tsx`

Acceptance criteria:

- accepts two compatible parsed logs and labels their source clearly;
- reports new, resolved, increased, decreased, and unchanged signatures;
- does not compare unrelated messages using only weak text similarity;
- all comparison rows link back to source evidence;
- deterministic output is stable across repeated runs.

### HAR-103 and HAR-104 - Rejected correlation surfaces

Decision:

- do not construct causal-looking chains from time proximity, ordering, message similarity, or incomplete cross-source clocks;
- keep Request Flow for the sequence recorded inside one HAR;
- keep source timestamps and exact correlation identifiers available as evidence, but do not turn them into an inferred incident narrative;
- let Codex discuss possible relationships as clearly labelled hypotheses after reviewing the deterministic evidence.

Verification:

- Action Chains and Incident Timeline are absent from the stable navigation and source tree;
- no replacement view may be introduced without an approved, exact correlation contract and adversarial false-link tests.

### HAR-105 - Rejected generic evidence routing

Decision:

- accept only advertised formats with an owned deterministic parser and analyzer;
- reject unsupported, malformed, mislabeled, and unrelated inputs with a bounded user-visible error;
- introduce each future format through a separate feature with fixtures, resource limits, security review, and deterministic acceptance tests.

### HAR-106 - Narrative reporting delegated to Codex

Decision:

- the application may export structured findings, analyzer version, source references, and applied privacy metadata;
- the application does not generate an executive narrative, root-cause hypothesis, or recommended action list;
- Codex or Atlas converts structured evidence into the requested communication, keeping observations and hypotheses distinct.

### PERF-101 - Large-HAR performance baseline

Acceptance criteria:

- benchmark representative 1k, 5k, and 10k-request HARs, plus an agreed upper-bound fixture;
- record parse duration, time to first usable view, filter/sort response, Request Flow render, Scorecard calculation, comparison duration, and peak memory;
- runs use repeatable fixtures and capture browser/device/build metadata;
- optimization targets are based on measured bottlenecks and include regression thresholds;
- large or invalid inputs remain cancellable and fail without freezing the browser.

### MCP-101 - HAR Analyzer MCP adapter

Initial supported tools:

- create workspace;
- upload evidence;
- list evidence;
- analyze evidence;
- search deterministic findings;
- inspect evidence or a finding;
- return structured deterministic findings and privacy metadata for Codex-authored reporting;
- return a shareable investigation link when permitted.

Acceptance criteria:

- tool schemas are versioned and contract-tested;
- `filePaths` are documented as server-visible paths only;
- clients can alternatively send bounded base64 content;
- all tools return structured, non-sensitive errors;
- repeated submissions support idempotency;
- authentication and authorization are enforced per workspace;
- AI diagnosis is optional and never replaces deterministic analysis.

### PRIV-101 - Data-handling decision record

Questions that must be answered in writing:

- Which enterprise AI products and tenants are approved?
- Which customer and employee data classifications are allowed?
- Are prompts, files, outputs, abuse logs, and telemetry retained, and for how long?
- May data be used for training or service improvement?
- Which regions and subprocessors apply?
- When is sanitization mandatory, optional, or prohibited because it would destroy required evidence?
- Who can approve an exception?
- What must be logged in the redaction receipt and audit trail?

Until approved, existing conservative privacy behavior remains the baseline.

### OPS-101 - Production service indicators

Minimum indicators:

| Indicator | Initial signal |
|---|---|
| Availability | Successful authenticated UI and API requests |
| Latency | API Gateway and application p50, p95, and p99 latency |
| Errors | 4xx by cause, 5xx, parser failures, queue failures, and storage failures |
| Saturation | CPU, memory, container restarts, upload concurrency, and queue depth |
| Dependencies | PostgreSQL, Redis, object storage, IDCS, and backend invocation health |
| Version | UI image digest, backend artifact, schema version, and analyzer version |

Acceptance criteria:

- each signal has a query or dashboard source;
- missing telemetry is distinguishable from a healthy zero;
- dashboards avoid storing raw HAR or log content;
- an operator can identify the running version without opening a container shell.

### SEC-101 - Application security baseline

Minimum coverage:

- authentication and session lifecycle;
- resource-principal and dynamic-group permissions;
- secret retrieval and rotation;
- upload limits, archive extraction, parser denial of service, and path traversal;
- stored and reflected injection in evidence viewers;
- SSRF and outbound network behavior;
- dependency and container-image vulnerabilities;
- sensitive logging and error responses;
- object storage, database, and Redis isolation;
- browser headers, CORS, CSP, cookies, and cache behavior;
- retention and deletion verification.

Acceptance criteria:

- findings include evidence, severity, owner, remediation, and verification state;
- high and critical unresolved findings block production approval;
- a clean, registry-connected dependency installation and current scan are required for a release claim.

## Migration disposition matrix

| Existing capability | Current home | Disposition | Target |
|---|---|---|---|
| HAR analyzer, request flow, scorecard | HAR Analyzer | Keep and harden | HAR Analyzer |
| HAR sanitization | HAR Analyzer | Replace or augment with shared contracts | Privacy layer |
| Console-log analyzer | HAR Analyzer | Keep; add Workbench workflows | HAR Analyzer |
| Console issue map and exact comparison | Workbench | Migrate P1 | HAR Analyzer |
| Console action chains | Workbench | Reject inferred linkage | None |
| Incident timeline | Workbench | Reject cross-source correlation | None |
| Broad file routing | Workbench | Reject generic routing; add owned analyzers individually | Unified ingestion |
| MCP evidence ingestion | Workbench | Rebuild on stable HAR APIs | HAR MCP adapter |
| Deep-link investigation | Workbench | Migrate after stable evidence IDs | HAR Analyzer |
| Separate AI Diagnosis surface | Workbench | Retire | Codex/Atlas skill plus HAR findings |
| Narrative support report | Workbench | Delegate to Codex from structured findings | Codex/Atlas skill |
| Ollama, Chroma, and embeddings | Workbench | Do not migrate by default | Discovery only |
| Video evidence analysis | Workbench | Defer pending demand and privacy review | Discovery only |
| Redaction contracts and receipts | Data Sanitizer | Extract and maintain | Privacy layer |
| Adversarial privacy fixtures | Data Sanitizer | Migrate relevant corpus | Privacy tests |
| Clipboard and desktop companions | Data Sanitizer | Keep outside HAR; maintenance decision | Standalone only |
| Duplicate deployment and UI shells | Workbench/Data Sanitizer | Retire after gates | None |

## Recommended execution order

1. CONS-001, CONS-002, and CONS-003.
2. PRIV-101 in parallel with HAR-101 and HAR-102.
3. Stabilize Analyzer, Request Flow, Scorecard, HAR comparison, search/filtering, and sanitization.
4. PERF-101, followed by measured performance improvements.
5. PRIV-102 through PRIV-105.
6. HAR-107 and MCP-101 through MCP-102.
7. OPS-101 through OPS-104 and SEC-101 through SEC-102 before production approval.
8. RET-101 through RET-103 only after their gates are satisfied.

## First-slice portability check

The console investigation slice was checked against the current HAR Analyzer tree. Its shared dependencies already exist in the target repository:

- `shared/consoleLogCore.ts`;
- `src/types/consolelog.ts`;
- `src/types/har.ts`;
- `src/utils/consoleLogSeverity.ts`;
- `src/utils/consoleLogParser.ts`;
- `src/services/apiClient.ts`.

This makes HAR-101 and HAR-102 suitable for incremental migration. Port the deterministic utility and its tests first, then integrate the component into the existing console-log surface. Do not port inferred action chains, cross-source timelines, or the Workbench application shell, and do not make HAR Analyzer depend on the Workbench repository at runtime.

## Definition of done for every migrated feature

- The feature has a named owner and user-visible purpose.
- Behavior is covered by deterministic tests in HAR Analyzer.
- Privacy and security implications are reviewed.
- Accessibility and large-evidence behavior are checked.
- Observability identifies success, failure, and version.
- Documentation no longer directs users to Workbench for that capability.
- Deployment verification proves the feature works in the supported environment.
- Rollback does not require deleting retained evidence.
