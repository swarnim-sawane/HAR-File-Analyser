export interface DocumentationSection {
  id: string;
  title: string;
  summary: string;
  content: string;
  icon: 'network' | 'console' | 'route' | 'shield' | 'sparkles' | 'globe';
}

export const documentationIntro = {
  eyebrow: 'Tool Guide',
  title: 'HAR File Analyzer Documentation',
  lead:
    'Use this guide when you want a faster path from raw browser traces to a clear explanation of what is slow, failing, or risky in a session.',
  note:
    'The tool is designed for engineers, support teams, and troubleshooting workflows that need both structured network analysis and guided interpretation.',
};

export const documentationHighlights = [
  {
    label: 'Best for',
    value: 'Slow pages, failed API calls, auth issues, regressions, and noisy console sessions.',
  },
  {
    label: 'Inputs',
    value: 'HAR files, console logs, side-by-side comparisons, and sanitization reviews.',
  },
  {
    label: 'Outcome',
    value: 'A smaller investigation surface with clearer next steps and faster handoff to the right team.',
  },
];

export const documentationSections: DocumentationSection[] = [
  {
    id: 'what-this-tool-does',
    title: 'What this tool does',
    summary: 'A focused explanation of the tool and the kinds of troubleshooting sessions it supports.',
    icon: 'globe',
    content: `
This tool helps you inspect browser activity without reading raw trace files line by line.

It brings HAR analysis, console log analysis, comparison workflows, sanitization, and AI-assisted reasoning into one workspace so you can move from **"something broke"** to **"this is probably why"** much faster.

It is especially useful when you need to:

- explain a failed session to another engineer
- isolate the slowest network requests in a page load
- compare two recordings of the same scenario
- sanitize a HAR before sharing it more widely
- combine network and console evidence during a diagnosis
`,
  },
  {
    id: 'main-features',
    title: 'Main features',
    summary: 'The core capabilities available inside the analyzer.',
    icon: 'network',
    content: `
The main workspace supports several investigation paths:

- **HAR analysis** for request timing, status codes, payload behavior, and request details
- **Console log analysis** for severity, source, and repeated client-side failures
- **Request flow views** for seeing how a session unfolds across endpoints or domains
- **Performance scorecards** for plain-language summaries of what looks healthy and what needs attention
- **HAR comparison** for understanding what changed between two runs
- **Sanitization workflows** for reducing the risk of exposing tokens, cookies, and other sensitive fields
- **AI insights and chat** when you want a guided summary or a targeted follow-up explanation

You can also keep multiple analysis tabs open, reopen recent files, and export filtered results for sharing.
`,
  },
  {
    id: 'how-to-use-har-analyzer',
    title: 'How to use HAR Analyzer',
    summary: 'The quickest path from file upload to meaningful network analysis.',
    icon: 'network',
    content: `
### Generate a HAR file

1. Open Chrome DevTools with \`F12\`
2. Go to the **Network** tab
3. Reload the page so the browser captures activity
4. Right-click inside the request list and choose **Save all as HAR with content**

### Analyze it in this tool

1. Upload the HAR file on the home screen
2. Use filters to narrow the request list to the failing or slow requests
3. Open individual request details to inspect timings, metadata, and payload behavior
4. Move into request-flow and scorecard views when you need a broader session-level picture

### Good habits while reviewing HAR data

- Start with **5xx** responses, then **4xx**, then redirects, then slow successful requests
- Check whether the biggest delays are in **wait / server time** or in connection setup
- Use the filtered view before exporting so you only share the slice that matters
`,
  },
  {
    id: 'console-log-analysis',
    title: 'How to capture and upload console logs',
    summary: 'A lightweight workflow for client-side errors, warnings, and noisy browser logs.',
    icon: 'console',
    content: `
### Capture console output

1. Open Chrome DevTools with \`F12\`
2. Go to the **Console** tab
3. Right-click in the console and choose **Save as...**
4. Or paste the log output into a \`.txt\` or \`.log\` file

### Review it in the analyzer

1. Upload the console log file
2. Use filters to focus on the most severe or repeated entries
3. Review statistics and insights to separate one-off noise from patterns
4. Ask AI follow-up questions when you need a concise explanation of repeated failures

Console logs are most useful when paired with HAR evidence, especially for auth issues, JavaScript errors, and failures that only partly show up in the network trace.
`,
  },
  {
    id: 'recommended-investigation-workflow',
    title: 'Recommended investigation workflow',
    summary: 'A practical order of operations when a user reports a slow or broken session.',
    icon: 'route',
    content: `
Use this order when you want a repeatable way to investigate:

1. Upload the HAR file and scan for the most obvious errors
2. Apply request filters until the list is small enough to reason about clearly
3. Inspect the slowest or failing requests first
4. Open request-flow or related visual summaries to see whether the issue is isolated or part of a chain
5. Review the performance scorecard to catch broader risks like caching, compression, or redirect overhead
6. Bring in console logs if you suspect client-side issues, missing scripts, or browser-side exceptions
7. Compare against a second HAR if you need to explain what changed between two runs

This order helps reduce noise early, which makes the later AI and comparison views much more useful.
`,
  },
  {
    id: 'compare-and-sanitization',
    title: 'Compare and sanitization workflows',
    summary: 'Two supporting workflows that help with regression analysis and safe sharing.',
    icon: 'shield',
    content: `
### Compare HAR files

Use comparison when you need to answer questions like:

- what changed between UAT and production
- why incognito behaves differently from a normal browser session
- whether a deployment improved or worsened request timings
- which requests were added, removed, or started failing

### Sanitize before sharing

Use the sanitizer when a HAR contains information that should not be passed around freely.

Typical targets include:

- cookies
- auth headers
- bearer tokens
- session identifiers
- sensitive query parameters

If a file will leave your immediate troubleshooting circle, sanitization should be part of the handoff flow.
`,
  },
  {
    id: 'ai-insights-and-chat',
    title: 'AI insights and chat',
    summary: 'Where AI helps most, and how to use it as an accelerator instead of a replacement for review.',
    icon: 'sparkles',
    content: `
AI features work best after you have already narrowed the investigation surface.

Use **AI Insights** when you want:

- a first-pass explanation of likely root causes
- a short summary of what stands out in a HAR or console session
- a prioritized list of suspicious requests or error clusters

Use the **floating AI chat** when you want:

- a follow-up explanation for a specific request or error pattern
- a shorter summary to share with another engineer
- help connecting network evidence to console evidence

The strongest results usually come from combining AI output with your own filtered views rather than asking AI to reason across a completely unfiltered session.
`,
  },
  {
    id: 'troubleshooting-notes',
    title: 'Troubleshooting / notes',
    summary: 'A few practical notes that prevent avoidable dead ends during analysis.',
    icon: 'shield',
    content: `
Keep these points in mind while using the tool:

- Empty or incomplete HAR files usually mean the browser did not record enough traffic before export
- Recent-file shortcuts depend on the browser still having access to the stored file content
- Very large files may take longer to process and can fall back to local parsing for console logs
- AI-assisted features depend on the environment being configured correctly, but the core analyzer remains useful without them
- If a session is sensitive, sanitize the HAR before sharing it with broader audiences

When the investigation still feels ambiguous, the most effective escalation is usually a small bundle of evidence: the relevant filtered HAR slice, the matching console output, and a short explanation of the user action that triggered the problem.
`,
  },
];

export const documentationCta = {
  title: 'Ready to analyze a session?',
  body:
    'Return to the analyzer when you are ready to upload a HAR file or console log and work through the evidence inside the main workspace.',
};
