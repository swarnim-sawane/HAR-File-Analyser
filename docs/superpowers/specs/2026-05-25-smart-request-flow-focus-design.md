# Smart Request Flow Focus Design

**Goal:** Add automatic visual guidance to Request Flow so support engineers can see where to look first without opening another panel, report, modal, or AI explanation surface.

**Decision:** Use a hybrid focus behavior: automatically identify the most suspicious request chain, glow that path, strengthen those node borders, softly dim unrelated requests, and pan/zoom the canvas enough to bring the focused chain into view.

## Problem

The current Request Flow gives engineers full visibility into every request, but the scattered view can still feel like a map without a starting point. It answers what happened, but not clearly enough where the engineer should inspect first.

The fix should keep the existing visual analyzer as the source of truth. It should not add a new content block above the graph, another drawer, a report card, or a chatbot-style explanation. The Request Flow itself should guide the eye.

## User Experience

When a HAR file is opened and the user enters Request Flow, the graph automatically applies a focus state if there is enough evidence to identify a likely issue path.

The focused path shows:

- stronger borders on involved request nodes;
- a warm glow on connecting edges;
- slightly larger/stronger endpoint treatment for the highest-risk request;
- unrelated nodes and edges dimmed but still visible;
- current click behavior preserved: selecting a focused node opens the existing Analyzer row/details.

The user can turn this off through the existing control area. The existing checkbox label should become `Focus likely issue` rather than `Highlight critical path`, because the behavior is not only about latency. It covers failures, suspicious redirects, blocked resources, and performance issues.

If no likely issue is found, Request Flow stays in normal all-requests mode. There should be no empty state or new explanation card.

## Ranking Signals

Focus selection should be deterministic for v1. AI can be added later, but the first version should be explainable, fast, and stable.

Each request receives a risk score from visible HAR evidence:

- `5xx` response: highest failure signal.
- `4xx` response: strong failure signal, with auth-related status codes receiving extra weight.
- explicit CORS, blocked, failed, aborted, or network error evidence where available.
- response timing above p90.
- request timing above a high absolute threshold, such as 3000ms, with lower weight than failures.
- redirect immediately before a failure or slow terminal request.
- failed or slow XHR/fetch/document requests weighted above images/fonts/static assets.
- repeated calls to the same endpoint that include failures or unusually slow timings.
- missing/zero response body only when paired with failure or blocked evidence.

The highest-scoring request becomes the focus anchor. Neighboring requests are included when they are temporally or causally related:

- direct redirect predecessor/successor;
- same host/path family near the same timestamp;
- immediate prior document/XHR chain;
- dependent asset requests around a failed document request;
- repeated endpoint group when repeated failures are the issue.

The result is a `FocusPath` object, not just a single request.

## Data Shape

Add a shared focus analysis shape near the Request Flow analyzer utilities:

```ts
type RequestFlowFocusReason =
  | 'http-5xx'
  | 'http-4xx'
  | 'auth-failure'
  | 'cors-or-blocked'
  | 'slow-p90'
  | 'slow-absolute'
  | 'redirect-before-failure'
  | 'repeated-endpoint'
  | 'terminal-failure';

type RequestFlowFocusPath = {
  anchorIndex: number;
  nodeIndexes: number[];
  edgeKeys: string[];
  score: number;
  severity: 'critical' | 'warning' | 'notice';
  reasons: RequestFlowFocusReason[];
};
```

This shape should be produced from HAR entries and consumed by both Journey Map and Scattered View where practical. If a view cannot represent edges directly, it should still highlight the involved nodes.

## Component Boundaries

`requestFlowAnalyzer` or a sibling utility should own scoring and focus-path selection. It should not live inside React components.

`RequestFlowGraphView` should consume the focus path and apply node/edge emphasis in the scattered graph.

`RequestFlowDiagram` should consume the same focus path and visually emphasize the corresponding journey zone/request rows.

`HarTabContent` should keep the current tab state and pass focus controls into the flow views. It should not implement scoring.

## Interaction Rules

Default state:

- focus is enabled automatically when a focus path exists;
- no visible popup is shown;
- graph pans/zooms to the focus path once per file/view load;
- user panning/zooming after that should not be overridden repeatedly.

Toggle behavior:

- `Focus likely issue` on: emphasize focus path and dim unrelated nodes.
- `Focus likely issue` off: show the graph normally.
- Existing filters still work. If filters remove the focus path, the graph should not force it back into view.

Click behavior:

- clicking any focused node opens the existing Analyzer detail flow;
- no new custom detail panel is introduced.

## Visual Treatment

Use the existing black/white HAR Analyzer visual language with restrained status accents.

Focused path:

- warm orange for slow/suspicious path;
- red for failed terminal/anchor request;
- subtle glow, not thick decorative effects;
- dim unrelated items to around 45-60% opacity;
- keep all labels readable.

Avoid:

- large badges floating over the canvas;
- extra explanatory cards;
- animated distractions;
- heavy gradients or decorative blobs.

## Edge Cases

No entries:

- show existing empty state.

All requests healthy:

- no automatic focus path.

Only slow requests, no failures:

- focus the slowest p90 outlier chain as warning.

Many failures:

- anchor on the earliest high-confidence failure that likely caused downstream noise, not simply the last failure.

Static asset failures:

- do not outrank failed documents, XHR, fetch, or auth endpoints unless all failures are static assets.

Large HAR files:

- scoring must run in linear or near-linear time over entries and avoid expensive graph traversal.

## Testing

Unit tests should cover focus-path scoring for:

- `5xx` terminal failure;
- `401/403` auth failure;
- CORS or blocked network evidence;
- slow p90 outlier with no failures;
- redirect before failure;
- repeated endpoint failures;
- healthy HAR producing no focus path.

UI tests should cover:

- Request Flow defaults to focused mode when a focus path exists;
- focused nodes/edges receive critical/focus styling;
- unrelated nodes are dimmed;
- toggling `Focus likely issue` restores normal graph opacity;
- clicking a focused node opens the existing Analyzer details.

Regression tests should confirm existing Request Flow filters, Journey Map, Scattered View, Scorecard, AI Insights, and analyzer row selection still work.

## Non-Goals

V1 does not add a new report panel, modal, drawer, AI-written explanation, or separate issue preview window.

V1 does not require Support Workbench or OCA calls.

V1 does not replace Scorecard or AI Insights. It gives the existing Request Flow an automatic visual starting point.
