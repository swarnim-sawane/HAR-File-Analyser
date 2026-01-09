// src/components/ConsoleLogDetails.tsx

import React, { useState } from 'react';
import { ConsoleLogEntry } from '../types/consolelog';
import { formatDate } from '../utils/formatters';

interface ConsoleLogDetailsProps {
  entry: ConsoleLogEntry;
  onClose: () => void;
}

const ConsoleLogDetails: React.FC<ConsoleLogDetailsProps> = ({ entry, onClose }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'stack' | 'args'>('overview');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

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

  const handleCopy = (text: string, section: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const copyFullEntry = () => {
    const fullText = `[${entry.level.toUpperCase()}] ${formatDate(entry.timestamp)}
${entry.source ? `Source: ${entry.source}${entry.lineNumber ? `:${entry.lineNumber}` : ''}${entry.columnNumber ? `:${entry.columnNumber}` : ''}\n` : ''}${entry.url ? `URL: ${entry.url}\n` : ''}${entry.category ? `Category: ${entry.category}\n` : ''}
Message:
${entry.message}${entry.stackTrace ? `\n\nStack Trace:\n${entry.stackTrace}` : ''}${entry.args && entry.args.length > 0 ? `\n\nArguments:\n${entry.args.map((arg, i) => `Argument ${i + 1}: ${JSON.stringify(arg, null, 2)}`).join('\n\n')}` : ''}`;
    
    handleCopy(fullText, 'full');
  };

  return (
    <div className="details-panel">
      <div className="details-header">
        <h2>Log Entry Details</h2>
        <div className="header-actions">
          <button 
            className={`btn-copy-header ${copiedSection === 'full' ? 'copied' : ''}`}
            onClick={copyFullEntry}
            title="Copy entire log entry"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            {copiedSection === 'full' ? 'Copied!' : 'Copy All'}
          </button>
          <button onClick={onClose} className="btn-close">✕</button>
        </div>
      </div>

      <div className="details-tabs">
        <button
          className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        {entry.stackTrace && (
          <button
            className={`tab ${activeTab === 'stack' ? 'active' : ''}`}
            onClick={() => setActiveTab('stack')}
          >
            Stack Trace
          </button>
        )}
        {entry.args && entry.args.length > 0 && (
          <button
            className={`tab ${activeTab === 'args' ? 'active' : ''}`}
            onClick={() => setActiveTab('args')}
          >
            Arguments
          </button>
        )}
      </div>

      <div className="details-content">
        {activeTab === 'overview' && (
          <div className="details-section">
            <div className="detail-row">
              <span className="detail-label">Level:</span>
              <span
                className="level-badge-glow"
                style={{ 
                  backgroundColor: getLevelColor(entry.level),
                  boxShadow: `0 0 12px ${getLevelColor(entry.level)}40, 0 2px 4px ${getLevelColor(entry.level)}30`
                }}
              >
                {entry.level.toUpperCase()}
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
                  {entry.lineNumber && `:${entry.lineNumber}`}
                  {entry.columnNumber && `:${entry.columnNumber}`}
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

            <div className="detail-section-with-copy">
              <div className="section-header-inline">
                <span className="detail-label">Message:</span>
                <button
                  className={`btn-copy-inline ${copiedSection === 'message' ? 'copied' : ''}`}
                  onClick={() => handleCopy(entry.message, 'message')}
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

        {activeTab === 'stack' && entry.stackTrace && (
          <div className="details-section">
            <div className="section-header-with-action">
              <h3>Stack Trace</h3>
              <button
                className={`btn-copy-section ${copiedSection === 'stack' ? 'copied' : ''}`}
                onClick={() => handleCopy(entry.stackTrace!, 'stack')}
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
                    onClick={() => handleCopy(JSON.stringify(arg, null, 2), `arg-${index}`)}
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
