import React, { useMemo, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightLongIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  ServerIcon,
} from './Icons';
import { mcpAccessGuide, mcpServiceGuide } from '../content/documentation';

interface McpDocumentationPageProps {
  onBackToAnalyzer?: () => void;
  onBackToDocs?: () => void;
}

type CopyTarget = 'endpoint' | 'verify' | 'config';
type CopyStatus = Record<CopyTarget, 'idle' | 'copied' | 'error'>;

const toolRows = [
  {
    name: 'create_workspace',
    use: 'Start a diagnostic case backed by AI Diagnosis.',
    returns: 'Workspace/session identifiers and workbench link context.',
  },
  {
    name: 'upload_evidence',
    use: 'Attach HAR, logs, ZIP children, documents, images, traces, tables, or binaries.',
    returns: 'Evidence ids, routing, attachment ids, and file metadata.',
  },
  {
    name: 'list_evidence',
    use: 'Confirm what the workspace can see before analysis.',
    returns: 'Evidence inventory, analyzer kind, status, and report artifacts.',
  },
  {
    name: 'analyze_evidence',
    use: 'Run deterministic HAR/log summaries or metadata fallback.',
    returns: 'Analyzer summary, counts, risks, and routing details.',
  },
  {
    name: 'search_evidence',
    use: 'Find exact HAR requests or parsed log rows.',
    returns: 'Matching rows with citation-ready fields.',
  },
  {
    name: 'inspect_evidence',
    use: 'Open one exact request/log row for evidence citation.',
    returns: 'Detailed request, timing, response, or log entry data.',
  },
  {
    name: 'ask_ai_diagnosis',
    use: 'Ask the case AI to reason across selected evidence.',
    returns: 'Diagnosis response grounded in uploaded files and prior context.',
  },
  {
    name: 'generate_support_report',
    use: 'Create a support-ready diagnosis artifact.',
    returns: 'Report summary and generated artifact references.',
  },
  {
    name: 'open_in_workbench',
    use: 'Give the engineer a frontend link for visual inspection.',
    returns: 'Deep link to Visual Analysis or AI Diagnosis context.',
  },
];

const pageSections = [
  { id: 'quickstart', label: 'Quickstart' },
  { id: 'client-config', label: 'Client config' },
  { id: 'endpoints', label: 'Endpoints' },
  { id: 'tools', label: 'Tools' },
  { id: 'examples', label: 'Examples' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
  { id: 'security', label: 'Security' },
];

const copyLabels: Record<CopyTarget, string> = {
  endpoint: 'MCP endpoint',
  verify: 'verify command',
  config: 'client config',
};

const McpDocumentationPage: React.FC<McpDocumentationPageProps> = ({ onBackToAnalyzer, onBackToDocs }) => {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>({
    endpoint: 'idle',
    verify: 'idle',
    config: 'idle',
  });
  const groupedTools = useMemo(() => new Map(mcpAccessGuide.toolGroups.map((group) => [group.label, group.tools])), []);
  const mcpEndpoint = useMemo(() => resolveMcpEndpoint(mcpServiceGuide.primaryEndpoint), []);
  const clientConfigSnippet = useMemo(
    () => mcpServiceGuide.clientConfigSnippet.replace(/<mcp-endpoint>/g, mcpEndpoint),
    [mcpEndpoint]
  );
  const verifySnippet = useMemo(
    () => mcpServiceGuide.verifySnippet.replace(/http:\/\/<vcap-host>:4100\/mcp/g, mcpEndpoint),
    [mcpEndpoint]
  );
  const quickstartSteps = useMemo(() => [
    {
      id: 'endpoint',
      title: 'Use the VCAP MCP endpoint',
      body: 'Copy the remote endpoint exposed by the experimental HAR backend. Engineers should not run a local MCP process for normal usage.',
      code: mcpEndpoint,
    },
    {
      id: 'configure',
      title: 'Add the remote MCP config',
      body: 'Paste the client config into the approved MCP-capable client. The only required value is the VCAP MCP URL.',
    },
    {
      id: 'verify',
      title: 'Verify the tools list',
      body: 'Use a tools/list smoke request if you need to confirm that the VCAP endpoint is reachable and exposing services.',
      code: verifySnippet,
    },
    {
      id: 'test',
      title: 'Run a small evidence test',
      body: 'Create a workspace, upload one small HAR or log through the client, then ask it to search or inspect exact evidence.',
    },
  ], [mcpEndpoint, verifySnippet]);

  const handleCopy = async (target: CopyTarget, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus((current) => ({ ...current, [target]: 'copied' }));
    } catch {
      setCopyStatus((current) => ({ ...current, [target]: 'error' }));
    }

    window.setTimeout(() => {
      setCopyStatus((current) => ({ ...current, [target]: 'idle' }));
    }, 1800);
  };

  const renderCopyButton = (target: CopyTarget, value: string) => (
    <button
      type="button"
      className="docs-copy-button dev-docs-copy-button"
      onClick={() => void handleCopy(target, value)}
      aria-label={`Copy ${copyLabels[target]}`}
    >
      {copyStatus[target] === 'copied' ? <CheckIcon /> : <CopyIcon />}
      <span>
        {copyStatus[target] === 'copied'
          ? 'Copied'
          : copyStatus[target] === 'error'
          ? 'Copy failed'
          : 'Copy'}
      </span>
    </button>
  );

  const renderCodeBlock = (target: CopyTarget, code: string) => (
    <div className="dev-docs-code-block">
      <div className="dev-docs-code-head">
        <span>{copyLabels[target]}</span>
        {renderCopyButton(target, code)}
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );

  return (
    <div className="docs-page dev-docs-page">
      <div className="dev-docs-shell">
        <header className="dev-docs-header" aria-labelledby="mcp-docs-title">
          <div>
            <div className="dev-docs-badges" aria-label="MCP service status">
              <span>remote http</span>
              <span>vcap hosted</span>
              <span>experimental</span>
            </div>
            <p className="docs-eyebrow">{mcpServiceGuide.eyebrow}</p>
            <h1 id="mcp-docs-title">{mcpServiceGuide.title}</h1>
            <p>{mcpServiceGuide.lead}</p>
          </div>
          <div className="dev-docs-header-actions">
            {onBackToDocs && (
              <button type="button" className="docs-secondary-button" onClick={onBackToDocs}>
                <ArrowLeftIcon />
                <span>Docs index</span>
              </button>
            )}
            {onBackToAnalyzer && (
              <button type="button" className="docs-primary-button" onClick={onBackToAnalyzer}>
                <ArrowLeftIcon />
                <span>Back to Analyzer</span>
              </button>
            )}
          </div>
        </header>

        <div className="dev-docs-layout">
          <aside className="dev-docs-toc" aria-labelledby="mcp-toc-title">
            <div>
              <h2 id="mcp-toc-title">MCP setup</h2>
              <nav aria-label="MCP documentation navigation">
                {pageSections.map((section) => (
                  <a key={section.id} href={`#${section.id}`}>
                    {section.label}
                  </a>
                ))}
              </nav>
            </div>
            <div className="dev-docs-service-note">
              <ServerIcon />
              <p>This is a remote VCAP service. The browser UI remains the visual workbench.</p>
            </div>
          </aside>

          <main className="dev-docs-content">
            <section id="quickstart" className="dev-docs-section">
              <div className="dev-docs-section-head">
                <p className="docs-eyebrow">Quickstart</p>
                <h2>Connect an LLM client in four steps</h2>
                <p>Start here. This is the minimum path to expose Support Analyzer tools to an approved client.</p>
              </div>
              <ol className="dev-docs-steps">
                {quickstartSteps.map((step, index) => (
                  <li key={step.id}>
                    <span className="dev-docs-step-number">{index + 1}</span>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.body}</p>
                      {step.code && renderCodeBlock(step.id === 'endpoint' ? 'endpoint' : 'verify', step.code)}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section id="client-config" className="dev-docs-section">
              <div className="dev-docs-section-head">
                <p className="docs-eyebrow">Client Config</p>
                <h2>Paste this into the MCP-capable client</h2>
                <p>Use the VCAP MCP endpoint. Do not configure frontend URLs or local server commands for normal usage.</p>
              </div>
              {renderCodeBlock('config', clientConfigSnippet)}
              <div className="dev-docs-callout">
                <CodeIcon />
                <p>
                  MCP endpoint: <code>{mcpEndpoint}</code>. The approved client calls this remote endpoint directly.
                </p>
              </div>
            </section>

            <section id="endpoints" className="dev-docs-section">
              <div className="dev-docs-section-head">
                <p className="docs-eyebrow">Endpoints</p>
                <h2>VCAP access details</h2>
                <p>These are service endpoints for the hosted experimental deployment. Users normally configure only the MCP URL.</p>
              </div>
              <div className="dev-docs-endpoint-grid">
                {mcpServiceGuide.runtimeTargets.map((target) => (
                  <article key={target.label} className="dev-docs-endpoint-card">
                    <h3>{target.label}</h3>
                    <table>
                      <tbody>
                        <tr>
                          <th>MCP URL</th>
                          <td><code>{replaceVcapHost(target.mcp)}</code></td>
                        </tr>
                        <tr>
                          <th>Analyzer API</th>
                          <td><code>{replaceVcapHost(target.analyzer)}</code></td>
                        </tr>
                        <tr>
                          <th>Workbench API</th>
                          <td><code>{replaceVcapHost(target.workbench)}</code></td>
                        </tr>
                        <tr>
                          <th>Frontend UI</th>
                          <td><code>{replaceVcapHost(target.ui)}</code></td>
                        </tr>
                      </tbody>
                    </table>
                    <p>{target.note}</p>
                  </article>
                ))}
              </div>
            </section>

            <section id="tools" className="dev-docs-section">
              <div className="dev-docs-section-head">
                <p className="docs-eyebrow">Tools Reference</p>
                <h2>Available MCP services</h2>
                <p>Use exact analyzer tools before asking for broad diagnosis. This keeps answers evidence-based.</p>
              </div>
              <div className="dev-docs-tool-summary">
                {mcpAccessGuide.toolGroups.map((group) => (
                  <span key={group.label}>
                    <strong>{group.label}</strong>
                    {(groupedTools.get(group.label) ?? []).length} tools
                  </span>
                ))}
              </div>
              <div className="dev-docs-table-wrap">
                <table className="dev-docs-tool-table">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>Use when</th>
                      <th>Returns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {toolRows.map((tool) => (
                      <tr key={tool.name}>
                        <td><code>{tool.name}</code></td>
                        <td>{tool.use}</td>
                        <td>{tool.returns}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section id="examples" className="dev-docs-section">
              <div className="dev-docs-section-head">
                <p className="docs-eyebrow">Examples</p>
                <h2>Prompts that make the MCP useful</h2>
              </div>
              <ul className="dev-docs-example-list">
                {mcpServiceGuide.examples.map((example) => (
                  <li key={example}>
                    <CheckIcon />
                    <span>{example}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section id="troubleshooting" className="dev-docs-section">
              <div className="dev-docs-section-head">
                <p className="docs-eyebrow">Troubleshooting</p>
                <h2>Common setup failures</h2>
              </div>
              <div className="dev-docs-troubleshooting-list">
                {mcpServiceGuide.troubleshooting.map((item) => (
                  <article key={item.problem}>
                    <h3>{item.problem}</h3>
                    <p>{item.fix}</p>
                  </article>
                ))}
              </div>
            </section>

            <section id="security" className="dev-docs-section">
              <div className="dev-docs-section-head">
                <p className="docs-eyebrow">Security</p>
                <h2>Access and evidence rules</h2>
              </div>
              <ul className="dev-docs-security-list">
                {mcpServiceGuide.securityNotes.map((note) => (
                  <li key={note}>
                    <CheckIcon />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="dev-docs-next">
              <div>
                <h2>After setup</h2>
                <p>Use the LLM client to create a workspace, upload a small file, and ask it to cite exact evidence.</p>
              </div>
              {onBackToAnalyzer && (
                <button type="button" className="docs-primary-button" onClick={onBackToAnalyzer}>
                  <span>Open Workbench</span>
                  <ArrowRightLongIcon />
                </button>
              )}
            </section>
          </main>
        </div>
      </div>
    </div>
  );
};

export default McpDocumentationPage;

function getVisibleHost(): string {
  if (typeof window === 'undefined') return '<vcap-host>';
  const host = window.location.hostname;
  return host && host !== 'localhost' && host !== '127.0.0.1' ? host : '<vcap-host>';
}

function resolveMcpEndpoint(template: string): string {
  return replaceVcapHost(template);
}

function replaceVcapHost(value: string): string {
  return value.replace(/<vcap-host>/g, getVisibleHost());
}
