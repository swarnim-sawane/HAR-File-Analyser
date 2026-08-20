import React, { useEffect, useMemo, useState } from 'react';
import type { ConsoleLogEntry, ConsoleLogEntrySummary } from '../types/consolelog';
import {
  AlertIcon,
  CheckIcon,
  CodeIcon,
  ConsoleIcon,
  NetworkIcon,
  RouteIcon,
} from './Icons';
import {
  buildConsoleLogIssueMap,
  type ConsoleIssueMapEdge,
  type ConsoleIssueMapModel,
  type ConsoleIssueMapNode,
  type ConsoleIssueMapTone,
} from '../utils/consoleLogIssueMap';

interface ConsoleLogIssueMapProps {
  entries: Array<ConsoleLogEntry | ConsoleLogEntrySummary>;
  totalEntries: number;
  isPartial: boolean;
  onSelectEntry: (entry: ConsoleLogEntry | ConsoleLogEntrySummary) => void;
}

const ISSUE_NODE_LIMIT = 6;

const TONE_ICON: Record<ConsoleIssueMapTone, React.ReactNode> = {
  critical: <AlertIcon />,
  warning: <AlertIcon />,
  network: <NetworkIcon />,
  auth: <CheckIcon />,
  runtime: <CodeIcon />,
  context: <RouteIcon />,
  muted: <ConsoleIcon />,
  neutral: <ConsoleIcon />,
};

function formatTime(timestamp: string | null): string {
  if (!timestamp) return 'unknown time';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return 'unknown time';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getVerdict(model: ConsoleIssueMapModel): {
  title: string;
  body: string;
  tone: 'linked' | 'warning' | 'quiet';
} {
  if (model.edges.length > 0) {
    return {
      title: 'Start with the linked console failure',
      body: 'The analyzer found at least one supported relationship. Inspect the linked rows first, then ignore repeated noise unless it matches the customer action window.',
      tone: 'linked',
    };
  }

  if (model.summary.errorCount > 0) {
    return {
      title: 'Failures present, but no proven chain',
      body: 'The log contains errors, but the visible evidence does not prove a cause-and-effect sequence. Review the highest-severity clusters first.',
      tone: 'warning',
    };
  }

  if (model.summary.warningCount > 0) {
    return {
      title: 'Warnings only in the visible console rows',
      body: 'No direct error chain is visible. Treat this as context evidence unless the timestamps match the customer symptom.',
      tone: 'warning',
    };
  }

  return {
    title: 'No actionable console failure in this view',
    body: 'The visible rows are mostly informational or framework noise. Use Analyzer filters or inspect another evidence file.',
    tone: 'quiet',
  };
}

function buildInspectionOrder(model: ConsoleIssueMapModel): ConsoleIssueMapNode[] {
  const nodeById = new Map(model.nodes.map(node => [node.id, node]));
  const ordered: ConsoleIssueMapNode[] = [];
  const seen = new Set<string>();

  const pushNode = (node: ConsoleIssueMapNode | undefined) => {
    if (!node || seen.has(node.id)) return;
    seen.add(node.id);
    ordered.push(node);
  };

  model.edges.forEach(edge => {
    pushNode(nodeById.get(edge.source));
    pushNode(nodeById.get(edge.target));
  });

  model.nodes
    .filter(node => node.level === 'error' || node.confidence !== 'low')
    .forEach(pushNode);

  model.nodes.forEach(pushNode);

  return ordered.slice(0, 8);
}

function getNodeLabel(node: ConsoleIssueMapNode): string {
  if (node.count > 1) {
    return `${node.title} (${node.count} rows)`;
  }
  return node.title;
}

const SummaryMetric = ({ value, label }: { value: number | string; label: string }) => (
  <div className="console-overview-metric">
    <strong>{value}</strong>
    <span>{label}</span>
  </div>
);

const RelationshipStrip = ({
  edges,
  model,
  onInspect,
}: {
  edges: ConsoleIssueMapEdge[];
  model: ConsoleIssueMapModel;
  onInspect: (node: ConsoleIssueMapNode) => void;
}) => {
  const nodeById = useMemo(() => new Map(model.nodes.map(node => [node.id, node])), [model.nodes]);
  const visibleEdges = edges.slice(0, 3);

  if (visibleEdges.length === 0) {
    return (
      <section className="console-overview-relation-strip is-empty">
        <div>
          <strong>No supported relationship found</strong>
          <span>Rows are grouped by evidence type, but the analyzer did not draw a causal link.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="console-overview-relation-strip" aria-label="Supported console relationships">
      <header>
        <strong>Supported relationship{visibleEdges.length === 1 ? '' : 's'}</strong>
        <span>Only direct or nearby evidence links are shown here.</span>
      </header>

      <div className="console-overview-relations">
        {visibleEdges.map(edge => {
          const source = nodeById.get(edge.source);
          const target = nodeById.get(edge.target);
          if (!source || !target) return null;

          return (
            <div key={edge.id} className={`console-overview-relation confidence-${edge.confidence}`}>
              <button type="button" onClick={() => onInspect(source)}>
                <span>{source.title}</span>
                <small>{source.sourceLabel}</small>
              </button>
              <div className="console-overview-relation-arrow">
                <span>{edge.label}</span>
              </div>
              <button type="button" onClick={() => onInspect(target)}>
                <span>{target.title}</span>
                <small>{target.sourceLabel}</small>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
};

const IssueCard = ({
  node,
  selected,
  onPreview,
  onInspect,
}: {
  node: ConsoleIssueMapNode;
  selected: boolean;
  onPreview: (node: ConsoleIssueMapNode) => void;
  onInspect: (node: ConsoleIssueMapNode) => void;
}) => (
  <button
    type="button"
    className={`console-overview-issue-card tone-${node.tone} ${selected ? 'is-selected' : ''}`}
    onMouseEnter={() => onPreview(node)}
    onFocus={() => onPreview(node)}
    onClick={() => onInspect(node)}
    aria-label={`Open ${node.title} in Analyzer`}
  >
    <span className="console-overview-issue-icon" aria-hidden="true">
      {TONE_ICON[node.tone]}
    </span>
    <span className="console-overview-issue-copy">
      <span className="console-overview-issue-kicker">
        {node.level.toUpperCase()}
        <em>{node.confidence === 'high' ? 'direct' : node.confidence}</em>
      </span>
      <strong>{getNodeLabel(node)}</strong>
      <small>{node.subtitle}</small>
    </span>
    <span className="console-overview-issue-meta">
      <span>{node.sourceLabel}</span>
      <span>{formatTime(node.firstTimestamp)} - {formatTime(node.lastTimestamp)}</span>
    </span>
  </button>
);

const EvidencePanel = ({
  issue,
  onInspect,
}: {
  issue: ConsoleIssueMapNode | null;
  onInspect: (node: ConsoleIssueMapNode) => void;
}) => {
  if (!issue) {
    return (
      <aside className="console-overview-evidence-panel is-empty">
        <ConsoleIcon />
        <strong>No issue selected</strong>
        <span>Hover an issue card to preview it, or open it directly in Analyzer.</span>
      </aside>
    );
  }

  return (
    <aside className={`console-overview-evidence-panel tone-${issue.tone}`}>
      <header>
        <span className="console-overview-evidence-icon" aria-hidden="true">
          {TONE_ICON[issue.tone]}
        </span>
        <div>
          <span>Selected evidence</span>
          <strong>{issue.title}</strong>
        </div>
      </header>

      <p>{issue.detail}</p>

      <dl className="console-overview-evidence-grid">
        <div>
          <dt>Rows</dt>
          <dd>{issue.count}</dd>
        </div>
        <div>
          <dt>Level</dt>
          <dd>{issue.level.toUpperCase()}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd title={issue.sourceLabel}>{issue.sourceLabel}</dd>
        </div>
        <div>
          <dt>First seen</dt>
          <dd>{formatTime(issue.firstTimestamp)}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>{formatTime(issue.lastTimestamp)}</dd>
        </div>
      </dl>

      {issue.tags.length > 0 && (
        <div className="console-overview-tag-row">
          {issue.tags.slice(0, 5).map(tag => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}

      <button
        type="button"
        className="console-overview-open-row"
        onClick={() => onInspect(issue)}
      >
        Open exact row in Analyzer
      </button>
    </aside>
  );
};

const ConsoleLogIssueMap: React.FC<ConsoleLogIssueMapProps> = ({
  entries,
  totalEntries,
  isPartial,
  onSelectEntry,
}) => {
  const issueMap = useMemo(() => buildConsoleLogIssueMap(entries), [entries]);
  const inspectionOrder = useMemo(() => buildInspectionOrder(issueMap), [issueMap]);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(inspectionOrder[0]?.id ?? null);
  const verdict = useMemo(() => getVerdict(issueMap), [issueMap]);
  const selectedIssue = issueMap.nodes.find(node => node.id === selectedIssueId)
    ?? inspectionOrder[0]
    ?? issueMap.nodes[0]
    ?? null;

  useEffect(() => {
    if (!selectedIssueId || !issueMap.nodes.some(node => node.id === selectedIssueId)) {
      setSelectedIssueId(inspectionOrder[0]?.id ?? issueMap.nodes[0]?.id ?? null);
    }
  }, [inspectionOrder, issueMap.nodes, selectedIssueId]);

  const inspectNode = (node: ConsoleIssueMapNode) => {
    setSelectedIssueId(node.id);
    onSelectEntry(node.representativeEntry);
  };

  const previewNode = (node: ConsoleIssueMapNode) => {
    setSelectedIssueId(node.id);
  };

  if (entries.length === 0) {
    return (
      <section className="console-map-empty" aria-label="Console issue overview">
        <ConsoleIcon />
        <strong>No console rows available for overview</strong>
        <span>Adjust analyzer filters or load the console file before opening the map.</span>
      </section>
    );
  }

  return (
    <section className="console-map-shell console-overview-shell" aria-label="Console issue overview">
      <header className={`console-overview-verdict tone-${verdict.tone}`}>
        <div className="console-overview-verdict-copy">
          <span>Console Issue Overview</span>
          <h2>{verdict.title}</h2>
          <p>{verdict.body}</p>
          {isPartial && (
            <small>This server-paged view uses currently loaded rows. Scroll or filter in Analyzer to expand the evidence set.</small>
          )}
        </div>

        <div className="console-overview-metrics" aria-label="Console map metrics">
          <SummaryMetric value={issueMap.summary.totalEntries} label="mapped rows" />
          <SummaryMetric value={totalEntries} label="matching rows" />
          <SummaryMetric value={issueMap.summary.errorCount} label="errors" />
          <SummaryMetric value={issueMap.summary.relationCount} label="real links" />
        </div>
      </header>

      <div className="console-overview-main-grid">
        <main className="console-overview-primary">
          <RelationshipStrip
            edges={issueMap.edges}
            model={issueMap}
            onInspect={inspectNode}
          />

          <section className="console-overview-inspection-order">
            <header>
              <strong>Recommended inspection order</strong>
              <span>Open these exact rows before reading lower-value noise.</span>
            </header>

            <ol>
              {inspectionOrder.slice(0, 5).map((node, index) => (
                <li key={node.id}>
                  <button
                    type="button"
                    onMouseEnter={() => previewNode(node)}
                    onFocus={() => previewNode(node)}
                    onClick={() => inspectNode(node)}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{getNodeLabel(node)}</strong>
                    <small>{node.sourceLabel} · {formatTime(node.firstTimestamp)}</small>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section className="console-overview-groups" aria-label="Console issue groups">
            {issueMap.groups.map(group => {
              const groupNodes = issueMap.nodes.filter(node => node.groupId === group.id);
              const visibleNodes = groupNodes.slice(0, ISSUE_NODE_LIMIT);
              const overflowCount = groupNodes.length - visibleNodes.length;

              return (
                <article key={group.id} className={`console-overview-group tone-${group.tone}`}>
                  <header>
                    <span aria-hidden="true">{TONE_ICON[group.tone]}</span>
                    <div>
                      <strong>{group.title}</strong>
                      <small>{group.count} rows - {group.actionableCount} actionable</small>
                    </div>
                  </header>

                  <div className="console-overview-group-list">
                    {visibleNodes.map(node => (
                      <IssueCard
                        key={node.id}
                        node={node}
                        selected={selectedIssue?.id === node.id}
                        onPreview={previewNode}
                        onInspect={inspectNode}
                      />
                    ))}

                    {overflowCount > 0 && (
                      <div className="console-overview-overflow-note">
                        {overflowCount} more clusters hidden. Narrow filters to reveal them.
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        </main>

        <EvidencePanel issue={selectedIssue} onInspect={inspectNode} />
      </div>
    </section>
  );
};

export default ConsoleLogIssueMap;
