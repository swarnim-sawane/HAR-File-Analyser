import React, { useMemo, useState } from 'react';
import { ConsoleLogEntry } from '../types/consolelog';
import { formatDate } from '../utils/formatters';

interface ConsoleLogDetailsProps {
  entry: ConsoleLogEntry;
  onClose: () => void;
  isLoading?: boolean;
}

type DetailTab = 'overview' | 'raw' | 'stack' | 'args';

const ISSUE_LABELS: Record<string, string> = {
  cors: 'CORS',
  network: 'Network',
  exception: 'Exception',
  promise: 'Promise',
  react: 'React',
  'browser-policy': 'Browser Policy',
  'http-4xx': 'HTTP 4xx',
  'http-5xx': 'HTTP 5xx',
};

function buildFullEventText(entry: ConsoleLogEntry): string {
  if (entry.rawText?.trim()) {
    return entry.rawText;
  }

  const lines = [`[${entry.level.toUpperCase()}] ${formatDate(entry.timestamp)}`];

  if (entry.source) {
    lines.push(
      `Source: ${entry.source}${entry.lineNumber ? `:${entry.lineNumber}` : ''}${
        entry.columnNumber ? `:${entry.columnNumber}` : ''
      }`,
    );
  }

  if (entry.url) {
    lines.push(`URL: ${entry.url}`);
  }

  if (entry.category) {
    lines.push(`Category: ${entry.category}`);
  }

  lines.push('', 'Message:', entry.message);

  if (entry.stackTrace) {
    lines.push('', 'Stack Trace:', entry.stackTrace);
  }

  if (entry.args?.length) {
    lines.push('', 'Arguments:');
    entry.args.forEach((arg, index) => {
      lines.push(`Argument ${index + 1}: ${JSON.stringify(arg, null, 2)}`);
    });
  }

  return lines.join('\n');
}

const ConsoleLogDetails: React.FC<ConsoleLogDetailsProps> = ({ entry, onClose, isLoading = false }) => {
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const fullEventText = useMemo(() => buildFullEventText(entry), [entry]);

  const getLevelColor = (level: string): string => {
    const colors: Record<string, string> = {
      error: '#ef4444',
      warn: '#f59e0b',
      info: '#3b82f6',
      log: '#6b7280',
      debug: '#8b5cf6',
      trace: '#ec4899',
      verbose: '#06b6d4',
    };
    return colors[level] || '#6b7280';
  };

  const handleCopy = async (text: string, section: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    setCopiedSection(section);
    window.setTimeout(() => setCopiedSection(null), 2000);
  };

  const tabs: Array<{ key: DetailTab; label: string; hidden?: boolean }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'raw', label: 'Raw Event' },
    { key: 'stack', label: 'Stack Trace', hidden: !entry.stackTrace },
    { key: 'args', label: 'Arguments', hidden: !entry.args?.length },
  ];

  return (
    <div className="details-panel">
      <div className="details-header">
        <h2>Log Entry Details</h2>
        <div className="header-actions">
          <button
            className={`btn-copy-header ${copiedSection === 'full' ? 'copied' : ''}`}
            onClick={() => void handleCopy(fullEventText, 'full')}
            title="Copy entire log entry"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            {copiedSection === 'full' ? 'Copied!' : 'Copy All'}
          </button>
          <button onClick={onClose} className="btn-close" aria-label="Close details">
            x
          </button>
        </div>
      </div>

      <div className="details-tabs" role="tablist" aria-label="Console event detail tabs">
        {tabs
          .filter((tab) => !tab.hidden)
          .map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
      </div>

      <div className="details-content">
        {isLoading && <div className="console-details-loading">Loading full event details...</div>}

        {activeTab === 'overview' && (
          <div className="details-section">
            <div className="detail-row">
              <span className="detail-label">Level:</span>
              <span
                className="level-badge-glow"
                style={{
                  backgroundColor: getLevelColor(entry.level),
                  boxShadow: `0 0 12px ${getLevelColor(entry.level)}40, 0 2px 4px ${getLevelColor(entry.level)}30`,
                }}
              >
                {entry.level.toUpperCase()}
              </span>
            </div>

            <div className="detail-row">
              <span className="detail-label">Inferred Severity:</span>
              <span className={`console-inferred-pill ${entry.inferredSeverity}`}>
                {entry.inferredSeverity === 'error'
                  ? 'Error'
                  : entry.inferredSeverity === 'warning'
                    ? 'Warning'
                    : 'None'}
              </span>
            </div>

            <div className="detail-row">
              <span className="detail-label">Timestamp:</span>
              <span className="detail-value">{formatDate(entry.timestamp)}</span>
            </div>

            {entry.source && (
              <div className="detail-row">
                <span className="detail-label">Source:</span>
                <span className="detail-value">
                  {entry.source}
                  {entry.lineNumber ? `:${entry.lineNumber}` : ''}
                  {entry.columnNumber ? `:${entry.columnNumber}` : ''}
                </span>
              </div>
            )}

            {entry.url && (
              <div className="detail-row">
                <span className="detail-label">URL:</span>
                <span className="detail-value url">{entry.url}</span>
              </div>
            )}

            {entry.category && (
              <div className="detail-row">
                <span className="detail-label">Category:</span>
                <span className="detail-value">{entry.category}</span>
              </div>
            )}

            {entry.issueTags.length > 0 && (
              <div className="detail-row full-width">
                <span className="detail-label">Issue Tags:</span>
                <div className="console-detail-tag-row">
                  {entry.issueTags.map((tag) => (
                    <span key={tag} className={`console-issue-pill issue-${tag}`}>
                      {ISSUE_LABELS[tag] || tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="detail-section-with-copy">
              <div className="section-header-inline">
                <span className="detail-label">Message:</span>
                <button
                  className={`btn-copy-inline ${copiedSection === 'message' ? 'copied' : ''}`}
                  onClick={() => void handleCopy(entry.message, 'message')}
                  title="Copy message"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  {copiedSection === 'message' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="message-content">{entry.message}</pre>
            </div>
          </div>
        )}

        {activeTab === 'raw' && (
          <div className="details-section">
            <div className="section-header-with-action">
              <h3>Raw Event</h3>
              <button
                className={`btn-copy-section ${copiedSection === 'raw' ? 'copied' : ''}`}
                onClick={() => void handleCopy(fullEventText, 'raw')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                {copiedSection === 'raw' ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="message-content raw-event-content">{fullEventText}</pre>
          </div>
        )}

        {activeTab === 'stack' && entry.stackTrace && (
          <div className="details-section">
            <div className="section-header-with-action">
              <h3>Stack Trace</h3>
              <button
                className={`btn-copy-section ${copiedSection === 'stack' ? 'copied' : ''}`}
                onClick={() => void handleCopy(entry.stackTrace ?? '', 'stack')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                {copiedSection === 'stack' ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="stack-trace">{entry.stackTrace}</pre>
          </div>
        )}

        {activeTab === 'args' && entry.args && entry.args.length > 0 && (
          <div className="details-section">
            <h3>Arguments</h3>
            {entry.args.map((arg, index) => (
              <div key={index} className="arg-item-with-copy">
                <div className="arg-header">
                  <span className="arg-label">Argument {index + 1}:</span>
                  <button
                    className={`btn-copy-inline ${copiedSection === `arg-${index}` ? 'copied' : ''}`}
                    onClick={() => void handleCopy(JSON.stringify(arg, null, 2), `arg-${index}`)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    {copiedSection === `arg-${index}` ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="arg-value">{JSON.stringify(arg, null, 2)}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConsoleLogDetails;
