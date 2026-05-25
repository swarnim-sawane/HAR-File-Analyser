# Request Flow Evidence Focus v2 Design

## Summary

Request Flow v1 added an automatic likely-issue spotlight, but it only partially solves the support workflow. It can glow a suspicious chain, yet the engineer still has to decide whether the target is correct, find the same request elsewhere, and manually inspect details.

V2 should make the spotlight evidence-driven. The analyzer should identify the primary suspect request, focus the same request across the existing Request Flow, request list, waterfall/timeline, and details surfaces, and show compact reason chips that explain why this is worth inspecting first. This must stay inside the existing analyzer surfaces. It should not add a new panel, modal, report, or AI-style explanation block.

Chosen direction: **Evidence-Driven Focus**.

## Goals

- Make the tool answer "where should I look first?" more directly.
- Improve target quality for real support cases by scoring confidence and reasons, not only severity.
- Carry the same likely-issue marker across Request Flow, request table, timeline/waterfall, and details.
- Auto-open the useful evidence once, without fighting the user's later manual selection.
- Keep the interaction visual, compact, and native to the current HAR Analyzer shell.

## Non-Goals

- Do not create an issue navigator panel.
- Do not add a new report card or AI diagnosis summary inside Visual Analysis.
- Do not change upload, HAR compare, HAR sanitizer, recent files, or AI Diagnosis behavior.
- Do not deeply solve every multi-issue HAR in v2. Multiple strong suspects can be stored in the model, but the UI should lead with one primary suspect.

## User Behavior

When Request Flow identifies a useful focus target:

- Request Flow opens with the likely issue path focused.
- The primary suspect request is auto-selected once so the existing request details pane shows it immediately.
- The matching request gets a subtle `Likely issue` marker in the main request table, waterfall, timeline, Journey Map, and Scattered View.
- The existing details pane shows compact evidence chips above the normal request detail content.
- The `Focus likely issue` toggle remains the control for this behavior.
- Turning `Focus likely issue` off removes map dimming/glow and suppresses automatic selection.

The UI should make the first inspection path obvious without hiding the rest of the HAR.

## Focus Model

Extend the current focus result so it can support UI decisions beyond the graph:

```ts
type RequestFlowFocusConfidence = 'high' | 'medium' | 'low';

type RequestFlowFocusReason =
  | 'http-5xx'
  | 'http-4xx'
  | 'auth-failure'
  | 'cors-or-blocked'
  | 'slow-p90'
  | 'slow-absolute'
  | 'redirect-before-failure'
  | 'repeated-endpoint'
  | 'terminal-failure'
  | 'large-payload'
  | 'missing-response-body';

type RequestFlowNextInspection =
  | 'headers'
  | 'response'
  | 'timings'
  | 'preview'
  | 'initiator'
  | 'general';

type RequestFlowFocusCandidate = {
  index: number;
  score: number;
  severity: 'critical' | 'warning' | 'notice';
  confidence: RequestFlowFocusConfidence;
  reasons: RequestFlowFocusReason[];
  nextInspection: RequestFlowNextInspection;
  summary: string;
};

type RequestFlowFocusPath = {
  anchorIndex: number;
  nodeIndexes: number[];
  edgeKeys: string[];
  score: number;
  severity: 'critical' | 'warning' | 'notice';
  confidence: RequestFlowFocusConfidence;
  reasons: RequestFlowFocusReason[];
  reasonLabels: string[];
  nextInspection: RequestFlowNextInspection;
  summary: string;
  candidates: RequestFlowFocusCandidate[];
};
```

The current analyzer can keep using `anchorIndex`, `nodeIndexes`, `edgeKeys`, `severity`, and `reasons`; new surfaces use `confidence`, `reasonLabels`, `nextInspection`, and `summary`.

## Scoring Rules

The scorer should prefer user-impacting failures over noisy assets:

- API, document, auth, and XHR/fetch failures outrank images, fonts, and most static assets.
- Terminal failures outrank earlier recoverable failures.
- 5xx failures outrank 4xx failures except auth-specific 401/403/407/419/440 on login, token, OAuth, SSO, IDCS, or auth URLs.
- CORS or blocked requests are high-priority because they commonly explain browser-visible failures.
- Slow requests become primary only when no clear failure exists, or when paired with another strong signal.
- Repeated endpoint failures raise confidence and include related failed attempts in the focus path.
- Redirect-before-failure adds the redirect predecessor to the path.
- Static asset failures should usually be `low` or `medium` confidence unless they are terminal, blocking render, or repeated.

Confidence should be explainable:

- `high`: multiple strong signals, such as 5xx + terminal, CORS + blocked status, auth failure on auth endpoint, or repeated endpoint failures.
- `medium`: one strong signal or several moderate signals.
- `low`: weak signal, noisy asset, slow-only outlier, or ambiguous evidence.

Low-confidence targets should use softer UI wording: `Worth checking` instead of `Likely issue`.

## Visual Treatment

The visual style should quietly guide attention:

- Primary suspect: thin red/orange ring, small marker, highest z-index in Scattered View.
- Related path: softer orange edge and node glow.
- Unrelated graph nodes: dimmed but still visible.
- Main request table: compact row marker and subtle border or background accent.
- Waterfall/timeline: small marker on the matching bar, not a large badge.
- Details pane: compact chips above existing request detail content, such as `503`, `4.2s`, `terminal`, `auth`, `CORS`, `repeated`.
- Journey Map: preserve v1 row/zone emphasis, adding reason chips or a tooltip only for the anchor row.
- Hovering or focusing the marker should show a short reason summary, for example: `HTTP 503, 4.2s, terminal request`.

Avoid heavy cards, large banners, or long explanatory text.

## Control Rules

The feature should not fight the engineer:

- Auto-select the primary suspect only once per uploaded file/tab.
- If the user manually selects another request, suspend auto-selection for that file/tab.
- If the user turns off `Focus likely issue`, keep manual selection untouched and stop applying focus dimming/glow.
- If the user turns focus back on, restore visual focus but do not auto-select again unless the file is reloaded.
- If filters hide the suspect, do not force hidden rows visible; keep the focus metadata available and show markers only where the request is currently visible.
- If no meaningful issue exists, disable the toggle and render normally.

## Component Responsibilities

### `requestFlowFocus`

- Rank candidate requests.
- Return primary anchor, path, confidence, reason labels, next inspection hint, and secondary candidates.
- Stay deterministic and pure for unit testing.

### `HarTabContent`

- Own the one-time auto-selection guard per file/tab.
- Pass focus metadata into request list, timeline, waterfall, details, Journey Map, and Scattered View.
- Stop auto-selection after manual user selection.

### `RequestList`

- Mark the focused row with a compact marker.
- Preserve existing selection behavior.
- Do not scroll aggressively unless the selected row is outside the visible viewport and auto-selection just occurred.

### `Timeline` And `WaterfallChart`

- Mark the focused request bar with a small visual indicator.
- Preserve existing selected-entry styling.

### `RequestDetails`

- Show compact reason chips and the short focus summary at the top of the existing details surface.
- Use `nextInspection` only as a hint for which section should be easiest to inspect first. If no matching detail section exists, fall back to the existing default.

### `RequestFlowDiagram` And `RequestFlowGraphView`

- Continue to render the focused path and anchor.
- Use `Likely issue` for high/medium confidence and `Worth checking` for low confidence.

## Testing

Add and update tests for:

- Scoring confidence for 5xx terminal, auth failure, CORS/blocked, repeated endpoint, slow-only, and noisy static asset cases.
- One-time auto-selection in `HarTabContent`.
- Manual selection suppressing future auto-selection.
- `Focus likely issue` toggle disabling visual focus without changing manual selection.
- Request list marker rendering.
- Timeline/waterfall focus markers.
- Details pane reason chips.
- Low-confidence wording using `Worth checking`.
- Regression coverage for existing HAR upload, request selection, Journey Map, Scattered View, compare, sanitizer, and AI Diagnosis mode switching.

## Rollout Notes

This should be implemented as an evolution of the current v1 focus code. The current visual spotlight is useful scaffolding and should not be thrown away. The main upgrade is propagating focus metadata into the analyzer surfaces that engineers already use for actual diagnosis.
