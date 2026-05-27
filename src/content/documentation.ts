export interface DocumentationSection {
  id: string;
  title: string;
  summary: string;
  content: string;
  icon: 'network' | 'console' | 'route' | 'shield' | 'sparkles' | 'globe';
}

export const mcpAccessGuide = {
  eyebrow: 'LLM Integration',
  title: 'Use the workbench from approved LLM clients',
  lead:
    'Connect ChatGPT, Claude, Codex, or an internal SR assistant to Support Analyzer MCP so the model can upload evidence, run deterministic analyzer tools, ask AI Diagnosis, and return deep links back into the visual workbench.',
  actionLabel: 'Open MCP services',
  flow: [
    {
      id: 'client',
      label: 'Step 1',
      title: 'LLM client',
      body: 'The engineer starts in an approved MCP-capable assistant and asks it to inspect SR evidence.',
      icon: 'client',
    },
    {
      id: 'mcp',
      label: 'Step 2',
      title: 'Support Analyzer MCP',
      body: 'The assistant calls curated tools for upload, search, inspection, reports, and AI Diagnosis.',
      icon: 'mcp',
    },
    {
      id: 'workbench',
      label: 'Step 3',
      title: 'Workbench evidence',
      body: 'The result includes exact rows, log lines, report artifacts, and links back to Visual Analysis.',
      icon: 'workbench',
    },
  ],
  configSnippet: `{
  "mcpServers": {
    "support-analyzer-workbench": {
      "url": "<mcp-endpoint>"
    }
  }
}`,
  setupNotes: [
    'Use the VCAP MCP endpoint exposed by the experimental HAR backend.',
    'Do not ask engineers to run a local MCP process for normal usage.',
    'Use local stdio only when maintaining or testing the MCP implementation itself.',
  ],
  toolGroups: [
    {
      label: 'Evidence',
      tools: ['create_workspace', 'upload_evidence', 'list_evidence'],
    },
    {
      label: 'Exact lookup',
      tools: ['analyze_evidence', 'search_evidence', 'inspect_evidence'],
    },
    {
      label: 'Diagnosis',
      tools: ['ask_ai_diagnosis', 'generate_support_report', 'open_in_workbench'],
    },
  ],
  useCases: [
    'SR bot uploads a customer ZIP, asks for first failure window, then links the visual workspace.',
    'Engineer asks an LLM to search a HAR for 5xx requests and inspect the exact failing row.',
    'Assistant generates a support handoff using analyzer evidence plus AI Diagnosis context.',
  ],
};

export const mcpServiceGuide = {
  eyebrow: 'MCP Services',
  title: 'Support Analyzer MCP Service Access',
  lead:
    'Use this page when you want an approved LLM client to invoke Support Analyzer Workbench through the VCAP-hosted MCP endpoint. The endpoint gives the client controlled access to evidence upload, analyzer search, exact row inspection, AI Diagnosis, reports, and visual workbench deep links.',
  serviceModel: [
    {
      label: 'How it runs',
      value:
        'The MCP endpoint is hosted by the experimental HAR backend on VCAP. Engineers configure one remote URL in the approved client.',
    },
    {
      label: 'What it connects to',
      value:
        'It calls the HAR Analyzer backend for deterministic analysis and the Support Workbench backend for AI Diagnosis sessions.',
    },
    {
      label: 'What users get',
      value:
        'The LLM can return exact evidence and also provide links back into the frontend workbench for visual inspection.',
    },
  ],
  runtimeTargets: [
    {
      label: 'VCAP experimental deployment',
      mcp: 'http://<vcap-host>:4100/mcp',
      analyzer: 'http://<vcap-host>:4100',
      workbench: 'http://<vcap-host>:4318',
      ui: 'http://<vcap-host>:3100',
      note: 'Use the VM host name or IP visible to the approved client. The MCP endpoint is the only URL engineers should normally configure.',
    },
  ],
  primaryEndpoint: 'http://<vcap-host>:4100/mcp',
  commandSnippet: `http://<vcap-host>:4100/mcp`,
  clientConfigSnippet: mcpAccessGuide.configSnippet,
  verifySnippet: `curl -s -X POST http://<vcap-host>:4100/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
  examples: [
    'Upload this SR ZIP, list all evidence, and identify the first failure window with exact log lines.',
    'Search the HAR for 5xx and slow requests, inspect the top failing row, then open it in the workbench.',
    'Generate a support-ready summary from the uploaded HAR, screenshots, PDF, and Catalina logs.',
  ],
  troubleshooting: [
    {
      problem: 'The client cannot reach the MCP endpoint',
      fix: 'Confirm the VCAP HAR backend is online and reachable at the configured /mcp URL. Use the backend port, not the frontend UI port.',
    },
    {
      problem: 'Tools are listed but upload or analysis fails',
      fix: 'Ask the VM owner to verify the experimental backend environment points at the matching HAR backend, Support Workbench backend, Redis, and MongoDB services.',
    },
    {
      problem: 'AI Diagnosis session is missing files',
      fix: 'Use list_evidence first, then upload_evidence for missing files. Remote clients should send inline files; large archives may need targeted child files or upload through the workbench UI.',
    },
    {
      problem: 'The answer has conclusions without evidence',
      fix: 'Ask the client to run search_evidence or inspect_evidence and cite file names, request URLs, statuses, timings, or log lines.',
    },
  ],
  securityNotes: [
    'Use only approved LLM clients and approved internal hosts.',
    'Sanitize customer-sensitive HAR data before broad sharing.',
    'Treat MCP output as evidence-assisted diagnosis, not a replacement for engineer review.',
  ],
};

export const documentationIntro = {
  eyebrow: 'Product Guide',
  title: 'Support Analyzer Workbench Documentation',
  lead:
    'Use this guide to diagnose customer evidence in one workspace: upload files once, review visual evidence, then use AI Diagnosis for case-level reasoning and handoff.',
  note:
    'The workbench combines the HAR Analyzer visual investigation model with an embedded AI Diagnosis workspace. It is built for support engineers who need to triage HAR files, logs, archives, documents, screenshots, and mixed incident bundles without jumping between separate tools.',
};

export const documentationHighlights = [
  {
    label: 'Best for',
    value: 'Customer SR evidence, HAR captures, console logs, server logs, screenshots, documents, ZIP bundles, and regression comparisons.',
  },
  {
    label: 'Core flow',
    value: 'Upload once, inspect in Visual Analysis, escalate selected files or the full case to AI Diagnosis.',
  },
  {
    label: 'Outcome',
    value: 'Clear evidence, likely root cause, next checks, report artifacts, and a cleaner handoff to product or operations teams.',
  },
  {
    label: 'Automation',
    value: 'MCP access lets approved LLM clients upload evidence, run analyzer searches, ask AI Diagnosis, and deep-link back to the visual workbench.',
  },
];

export const documentationSections: DocumentationSection[] = [
  {
    id: 'what-this-product-is',
    title: 'What this product is',
    summary: 'The product model and why it is more than a HAR viewer or chatbot.',
    icon: 'globe',
    content: `
Support Analyzer Workbench is a unified diagnostic workspace for support evidence.

It has two analysis lenses inside the same product shell:

| Lens | Use it for | What it gives you |
| --- | --- | --- |
| **Visual Analysis** | Precise inspection of HAR files, logs, tables, documents, images, archives, and file previews | Clickable evidence, filtered rows, request details, request flow, scorecard, compare, sanitizer, and basic viewers |
| **AI Diagnosis** | Case-level reasoning across all attached evidence | Chat diagnosis, file correlation, reports, approvals, and guided next steps |

The important design rule is simple: **upload once, diagnose from both sides**. Files uploaded in the main workbench are registered in the visual analyzer and synced to AI Diagnosis whenever they are eligible.

This is not meant to replace engineering judgment. It reduces the surface area, organizes the evidence, and helps engineers reach a defensible diagnosis faster.
`,
  },
  {
    id: 'workspace-layout',
    title: 'Workspace layout',
    summary: 'How the main screen, tools menu, tabs, and modes work together.',
    icon: 'route',
    content: `
### Entry screen

The first screen is the unified uploader. Users should not choose a tool before uploading. Drop or select files and the workbench will classify them automatically.

### After upload

The workbench opens a case-style workspace with:

- **Tools** menu for Analyzer, HAR Compare, and HAR Sanitizer
- **File count** beside Tools showing how many visual analyzer tabs are open
- **Visual Analysis / AI Diagnosis** toggle in the center
- **Upload** button for adding more files to the same workspace
- **File tabs** for currently opened visual files

Use the file tabs as working tabs, not as the full evidence list. If an archive or case has many files, open only the files that need visual inspection and send the rest to AI Diagnosis when needed.

### When all tabs are closed

The empty state shows uploaded files that can be reopened. The file count near Tools should return to zero when no analyzer tabs are open.
`,
  },
  {
    id: 'supported-file-types',
    title: 'Supported files and routing',
    summary: 'Which files get deep analysis, basic previews, or metadata-only handling.',
    icon: 'network',
    content: `
The uploader accepts broad diagnostic evidence. Every file is classified and routed to the best available visual surface.

| File family | Examples | Visual route |
| --- | --- | --- |
| **HAR captures** | \`.har\`, \`.oc\`, \`.ocp\`, HAR-shaped JSON | Deep HAR Analyzer |
| **Known logs** | ODL/ADF, access logs, Tomcat/Catalina, browser console, JVM/GC, generic timestamp/severity logs | Console Log Analyzer |
| **Text, traces, dumps** | \`.trc\`, \`.trace\`, \`.tdump\`, \`.dmp\`, \`.stack\`, \`.sql\`, configs, source files | Basic text viewer with line numbers, search, copy, and AI handoff |
| **Structured files** | JSON, XML, YAML, TOML, JDeveloper \`.jws\` / \`.jpr\` | Structured viewer with validation and tree/raw modes where possible |
| **Tables** | CSV, TSV | Table preview with row count and filtering |
| **Documents** | PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX | Document preview or metadata plus AI Diagnosis handoff |
| **Images** | PNG, JPG, JPEG, GIF, WEBP, BMP, TIFF | Image preview and AI Diagnosis handoff |
| **Archives** | ZIP, SR bundles, incident bundles | Bundle summary, supported child detection, child open, and bulk AI Diagnosis handoff |
| **Unsupported binaries** | Unknown binaries or installer payloads | Metadata-only card with file name, size, type, and AI handoff when useful |

Unsupported files should not create a blank page. They should still become case evidence, even if the visual side can only show metadata.
`,
  },
  {
    id: 'visual-analysis-har',
    title: 'Visual Analysis for HAR files',
    summary: 'How to use Analyzer, Request Flow, Scorecard, AI Insights, Compare, and Sanitizer.',
    icon: 'network',
    content: `
HAR files are the deepest visual workflow in the product.

### Analyzer tab

Use the Analyzer tab when you need exact request-level evidence:

- filter by status, method, URL, domain, MIME type, and timing
- open request details for headers, payload metadata, timing breakdown, and response behavior
- use failing and slow rows as the primary evidence for escalation

### Request Flow

Request Flow has two useful views:

- **Journey Map** shows the session path across domains and request groups
- **Scattered View** highlights issue nodes and relationships across the full request set

Use Scattered View when someone asks, "Where should I look first?" Hover a node for a compact request card. Click a node to open the matching request in the analyzer.

### Scorecard

Use Scorecard for a compact health summary:

- top slow requests
- status code risk
- request weight and response size patterns
- cache/compression/redirect concerns
- clickable slow requests for drilling into details

### AI Insights

Use AI Insights for a first-pass narrative, but validate it against visible request rows and details before sharing it.

### HAR Compare

Use HAR Compare when you need to explain what changed between two captures, such as UAT vs production, working vs failing, before vs after deployment, or normal vs incognito.

### HAR Sanitizer

Use HAR Sanitizer before wider sharing. Focus on cookies, authorization headers, bearer tokens, session IDs, tenant identifiers, and sensitive query parameters.
`,
  },
  {
    id: 'visual-analysis-logs',
    title: 'Visual Analysis for logs',
    summary: 'How known logs and generic logs are classified and reviewed.',
    icon: 'console',
    content: `
Known logs open in the Console Log Analyzer.

Currently recognized patterns include:

- ADF / ODL logs
- Tomcat and Catalina logs
- access logs
- browser console logs
- JVM / GC logs
- generic logs with timestamps, severity levels, or repeated error patterns

Recommended log workflow:

1. Upload the log or ZIP bundle.
2. Open the log tab if it was detected as analyzer-ready.
3. Filter for **ERROR**, **SEVERE**, **FATAL**, repeated warnings, HTTP 5xx, ORA errors, Java exceptions, and timestamp clusters.
4. Compare the log timestamps with HAR failures or screenshots.
5. Send the log to AI Diagnosis when correlation across multiple files is needed.

If a specialized report tool fails, the chat should continue and fall back to bounded reads, grep/search evidence, and visible log excerpts. A failed report is not the same as a failed diagnosis.
`,
  },
  {
    id: 'basic-viewers',
    title: 'Basic viewers for other evidence',
    summary: 'How text, structured, tables, images, documents, archives, and binaries behave.',
    icon: 'route',
    content: `
Not every file needs a custom visual analyzer in v1. The basic viewers make unsupported and partially supported files useful instead of invisible.

### Text, traces, and dumps

Use search, line numbers, and copy to capture exact evidence. Thread dumps, Forms traces, JDBC dumps, source/config files, and plain text all route here unless they match a deeper log analyzer.

### Structured files

JSON, XML, YAML, TOML, and JDeveloper workspace files route to a structured preview. Use validation status and raw/tree views to check whether the file is readable.

### Tables

CSV and TSV files show a tabular preview with filters. Use this for exported diagnostics, timing tables, and customer-provided spreadsheets that can be saved as CSV.

### Images

Screenshots can be previewed visually and sent to AI Diagnosis. Do not depend on OCR as the only path. The AI Diagnosis backend can reason over attached images when image input is supported.

### Documents

PDF and Word files can be attached as case evidence. Use them for SR notes, customer steps, screenshots embedded in documents, and exported reports.

### Archives

ZIP files show a bundle summary. Supported child files can be opened as analyzer tabs. Use **Send all files to AI Diagnosis** when the ZIP contains several related logs or traces.

### Binaries

Unknown binaries are accepted as metadata-only evidence unless size or security rules block them. Upload extracted logs, traces, or screenshots if deeper diagnosis is needed.
`,
  },
  {
    id: 'ai-diagnosis',
    title: 'AI Diagnosis',
    summary: 'How to use the embedded AI workspace without losing evidence discipline.',
    icon: 'sparkles',
    content: `
AI Diagnosis is the case-level reasoning side of the product. It is embedded in the same shell so users can switch between visual evidence and chat without feeling like they opened another application.

### What AI Diagnosis sees

AI Diagnosis can use:

- files synced from the unified uploader
- files attached directly in the AI composer
- files sent from archive children
- selected file context when opened from a basic viewer
- previous chat messages
- generated reports and artifacts

### How to ask good questions

Good prompts are specific and evidence-oriented:

- "Analyze these Catalina logs and identify the first failure window."
- "Correlate this HAR with the console log and tell me which request likely caused login failure."
- "Summarize this PDF and screenshot, then list what evidence is still missing."
- "Review this ZIP bundle and group errors by timestamp and component."

Avoid vague prompts like "check this" unless the attached files are very small.

### Evidence standard

Answers should cite visible evidence: file names, log lines, timestamps, request URLs, status codes, HAR rows, report artifacts, or image/document snippets. If the answer gives a root cause without evidence, ask it to show the supporting lines or requests.

### Analyze button

When files are attached in AI Diagnosis, the floating **Analyze** action is the fastest path for the common support workflow. Use it when the next task is simply "diagnose the selected evidence."

### Files and Reports

The AI side should stay simple: use **Files** to confirm what evidence is available and **Reports** to review generated artifacts. Avoid treating tool output as final truth unless it matches the visible evidence.
`,
  },
  {
    id: 'common-scenarios',
    title: 'Common scenarios',
    summary: 'Practical investigation paths for the cases support engineers see most often.',
    icon: 'route',
    content: `
### Slow page or failed API call

Upload the HAR first. Review 5xx, 4xx, slow requests, redirects, and large payloads. Open Request Flow to identify where the session starts failing. Use AI Diagnosis only after the suspicious rows are visible.

### Login, auth, or session issue

Upload HAR plus browser console. Check redirects, 401/403 responses, cookies, CORS errors, failed scripts, and repeated console exceptions. Sanitize before sharing.

### Oracle Forms, JVM, Tomcat, or ADF issue

Upload logs or an SR ZIP. Open analyzer-ready logs visually. Send related logs to AI Diagnosis together so it can correlate timestamps, components, repeated signatures, and missing follow-up evidence.

### Customer sends screenshots, PDF, or DOCX

Upload the files as case evidence. Preview what is visible, then ask AI Diagnosis to summarize the customer-reported steps, error text, timestamps, and missing diagnostic files.

### Large ZIP or SR bundle

Open the ZIP summary first. If the bundle has supported child files, open the most relevant logs visually or send all AI-ready children to AI Diagnosis. Installer payloads and unrelated binaries may be skipped as metadata.

### Regression or environment difference

Use HAR Compare for before/after captures. Look for new failing requests, removed requests, slower endpoints, cache differences, and payload size changes.
`,
  },
  {
    id: 'handoff-quality',
    title: 'Good handoff format',
    summary: 'What a support-ready finding should contain before escalation.',
    icon: 'shield',
    content: `
A good handoff should be short, evidence-based, and reproducible.

Use this structure:

1. **Issue summary** - one sentence describing the user impact.
2. **Evidence** - file names, request URLs, status codes, log lines, timestamps, screenshots, or report artifacts.
3. **Likely cause** - what the evidence suggests, with confidence level.
4. **What was ruled out** - examples: no 5xx in HAR, no Java exception, no matching timestamp in server log.
5. **Next checks** - exact files, commands, teams, or timestamps needed next.
6. **Sanitization note** - whether the HAR or customer evidence was sanitized before sharing.

Do not send AI output alone. Attach the visual evidence or cite the exact rows and lines that support it.
`,
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    summary: 'What to do when upload, routing, preview, or AI sync does not behave as expected.',
    icon: 'shield',
    content: `
### A file opens in the wrong viewer

Check the extension and content. HAR exports from Analysis Portal may use \`.ocp\` and should route to HAR Analyzer. Logs without recognizable severity or timestamp patterns may route to the basic text viewer.

### A ZIP does not open every child file

The ZIP summary only opens supported children. Very large bundles may be indexed without fully loading every nested payload. If the ZIP contains installers or binaries, those may remain metadata-only.

### "Ask AI Diagnosis" does nothing or keeps syncing

Switch to AI Diagnosis and check the Files area. If the file is missing, upload it directly in AI Diagnosis or re-open the visual file and retry. Archives may need **Send all files to AI Diagnosis** instead of sending the ZIP itself.

### AI report generation fails

Do not stop the investigation. Ask AI Diagnosis to continue with bounded file reads and visible evidence. A report tool can fail because a path, folder, or generated artifact is unavailable, but the uploaded file can still be analyzed.

### Theme switch feels slow

The visual shell and embedded AI Diagnosis both receive theme changes. If the embedded frame briefly reloads, wait for it to settle and continue in the same session.

### Recent file opens a duplicate

If a recent file is already open, selecting it should focus the existing tab. If it loads again, close the duplicate and continue with the active tab.

### AI answer is too broad

Ask for a smaller evidence-based answer: "Only cite lines from these files and list the top three findings with timestamps."
`,
  },
];

export const documentationCta = {
  title: 'Ready to diagnose evidence?',
  body:
    'Return to the workbench, upload the case files, start in Visual Analysis for exact evidence, and switch to AI Diagnosis when you need cross-file reasoning or a support-ready summary.',
};
