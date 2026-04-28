import React, { useEffect, useId, useMemo, useState } from 'react';
import { ConsoleLogEntry, ConsoleQuickFocus, LogLevel } from '../types/consolelog';
import { formatDate } from '../utils/formatters';
import { getConsoleDisplayLevel } from '../utils/consoleLogSeverity';

interface ConsoleLogListProps {
  entries: ConsoleLogEntry[];
  groupedEntries: Map<string, ConsoleLogEntry[]> | null;
  selectedEntry: ConsoleLogEntry | null;
  onSelectEntry: (entry: ConsoleLogEntry) => void | Promise<void>;
  quickFocus: ConsoleQuickFocus;
  onQuickFocusChange: (quickFocus: ConsoleQuickFocus) => void;
}

type SortField = 'timestamp' | 'severity';
type SortDirection = 'asc' | 'desc';

const QUICK_FOCUS_OPTIONS: Array<{ key: ConsoleQuickFocus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'errors', label: 'Errors' },
  { key: 'warnings', label: 'Warnings' },
  { key: 'cors', label: 'CORS' },
  { key: 'network', label: 'Network' },
  { key: 'exception', label: 'Exceptions' },
  { key: 'react', label: 'React' },
  { key: 'browser-policy', label: 'Browser Policy' },
];

const ISSUE_TAG_LABELS: Record<string, string> = {
  cors: 'CORS',
  network: 'Network',
  exception: 'Exception',
  promise: 'Promise',
  react: 'React',
  'browser-policy': 'Browser Policy',
  'http-4xx': 'HTTP 4xx',
  'http-5xx': 'HTTP 5xx',
};

const ConsoleLogList: React.FC<ConsoleLogListProps> = ({
  entries,
  groupedEntries,
  selectedEntry,
  onSelectEntry,
  quickFocus,
  onQuickFocusChange,
}) => {
  const selectAllId = useId();
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedIds((current) => {
      const visibleIds = new Set(entries.map((entry) => entry.id));
      const next = new Set(Array.from(current).filter((entryId) => visibleIds.has(entryId)));
      return next.size === current.size ? current : next;
    });
  }, [entries]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortField(field);
    setSortDirection('desc');
  };

  const copyToClipboard = async (text: string) => {
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
  };

  const buildClipboardText = (entry: ConsoleLogEntry): string => {
    const sourceText = entry.source
      ? `\nSource: ${entry.source}${entry.lineNumber ? `:${entry.lineNumber}` : ''}${
          entry.columnNumber ? `:${entry.columnNumber}` : ''
        }`
      : '';
    const urlText = entry.url ? `\nURL: ${entry.url}` : '';
    const issueTagsText =
      entry.issueTags.length > 0 ? `\nIssue Tags: ${entry.issueTags.join(', ')}` : '';
    const rawText = entry.rawText?.trim() ? `\n\nRaw Event:\n${entry.rawText}` : '';
    const displayLevel = getConsoleDisplayLevel(entry);

    return `[${displayLevel.toUpperCase()}] ${formatDate(entry.timestamp)}${sourceText}${urlText}${issueTagsText}\n\nMessage:\n${entry.message}${rawText}`;
  };

  const handleCopyEvent = async (entry: ConsoleLogEntry, event: React.MouseEvent) => {
    event.stopPropagation();
    await copyToClipboard(buildClipboardText(entry));
    setCopiedId(entry.id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  const toggleEntrySelection = (entryId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds((current) => {
      if (entries.length > 0 && current.size === entries.length) {
        return new Set();
      }
      return new Set(entries.map((entry) => entry.id));
    });
  };

  const handleCopySelected = async () => {
    const selectedEntries = entries.filter((entry) => selectedIds.has(entry.id));
    const text = selectedEntries.map(buildClipboardText).join('\n\n---\n\n');
    await copyToClipboard(text);
    setCopiedId('bulk-copy');
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  const getLevelPriority = (entry: ConsoleLogEntry): number => {
    const priorities: Record<LogLevel, number> = {
      error: 5,
      warn: 4,
      info: 3,
      log: 2,
      debug: 1,
      trace: 1,
      verbose: 1,
    };

    return priorities[getConsoleDisplayLevel(entry)] || 0;
  };

  const sortEntries = (items: ConsoleLogEntry[]) =>
    [...items].sort((a, b) => {
      let comparison = 0;

      if (sortField === 'timestamp') {
        comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      } else {
        comparison = getLevelPriority(b) - getLevelPriority(a);
        if (comparison === 0) {
          comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        }
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

  const sortedEntries = useMemo(() => sortEntries(entries), [entries, sortDirection, sortField]);

  const overlayErrorCount = entries.filter(
    (entry) => getConsoleDisplayLevel(entry) === 'error',
  ).length;
  const overlayWarningCount = entries.filter(
    (entry) => getConsoleDisplayLevel(entry) === 'warn',
  ).length;

  const quickFocusCounts = useMemo(() => {
    return {
      all: entries.length,
      errors: entries.filter((entry) => getConsoleDisplayLevel(entry) === 'error').length,
      warnings: entries.filter((entry) => getConsoleDisplayLevel(entry) === 'warn').length,
      cors: entries.filter((entry) => entry.issueTags.includes('cors')).length,
      network: entries.filter((entry) => entry.issueTags.includes('network')).length,
      exception: entries.filter((entry) => entry.issueTags.includes('exception')).length,
      promise: entries.filter((entry) => entry.issueTags.includes('promise')).length,
      react: entries.filter((entry) => entry.issueTags.includes('react')).length,
      'http-4xx': entries.filter((entry) => entry.issueTags.includes('http-4xx')).length,
      'http-5xx': entries.filter((entry) => entry.issueTags.includes('http-5xx')).length,
      'browser-policy': entries.filter((entry) => entry.issueTags.includes('browser-policy')).length,
    } satisfies Record<ConsoleQuickFocus, number>;
  }, [entries]);

  const getLevelBadgeClass = (level: LogLevel): string => {
    const classes: Record<LogLevel, string> = {
      error: 'status-4xx',
      warn: 'status-3xx',
      info: 'status-1xx',
      log: 'status-0',
      debug: 'status-0',
      trace: 'status-0',
      verbose: 'status-0',
    };
    return classes[level] || 'status-0';
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <span className="console-sort-icon inactive">{'\u2195'}</span>;
    }

    return (
      <span className="console-sort-icon">
        {sortDirection === 'asc' ? '\u2191' : '\u2193'}
      </span>
    );
  };

  const renderIssueBadges = (entry: ConsoleLogEntry) =>
    entry.issueTags.slice(0, 3).map((tag) => (
      <span key={`${entry.id}-${tag}`} className={`console-issue-pill issue-${tag}`}>
        {ISSUE_TAG_LABELS[tag] || tag}
      </span>
    ));

  const renderEntry = (entry: ConsoleLogEntry) => {
    const isSelected =
      selectedEntry?.id === entry.id || (selectedEntry?.index !== undefined && selectedEntry.index === entry.index);
    const isChecked = selectedIds.has(entry.id);
    const sourceLabel = entry.source ? entry.source.split('/').pop() || entry.source : null;
    const displayLevel = getConsoleDisplayLevel(entry);

    return (
      <div
        key={entry.id}
        className={`request-item ${isSelected ? 'selected' : ''} ${isChecked ? 'checked-item' : ''}`}
        data-inferred-severity={entry.inferredSeverity}
        onClick={() => void onSelectEntry(entry)}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void onSelectEntry(entry);
          }
        }}
      >
        <div className="log-checkbox">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => toggleEntrySelection(entry.id)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select log entry ${entry.index ?? entry.id}`}
          />
          <span className="checkbox-custom console-row-checkbox" aria-hidden="true"></span>
        </div>

        <div className="log-level-cell">
          <div className="console-level-stack">
            <span className={`status-badge ${getLevelBadgeClass(displayLevel)}`}>
              {displayLevel.toUpperCase()}
            </span>
          </div>
        </div>

        <div className="log-timestamp-cell">{formatDate(entry.timestamp)}</div>

        <div className="log-message-cell">
          <div className="console-message-stack">
            <div className="log-message" title={entry.message}>
              {entry.message}
            </div>
            {entry.issueTags.length > 0 && (
              <div className="console-row-badges">{renderIssueBadges(entry)}</div>
            )}
          </div>
        </div>

        <div className="log-source-cell" title={entry.source || undefined}>
          {sourceLabel ? (
            <>
              <span className="source-file">{sourceLabel}</span>
              {entry.lineNumber ? <span className="source-line">:{entry.lineNumber}</span> : null}
              {entry.columnNumber ? <span className="source-line">:{entry.columnNumber}</span> : null}
            </>
          ) : (
            <span className="console-source-empty">--</span>
          )}
        </div>

        <div className="log-actions-cell">
          <button
            className={`btn-copy ${copiedId === entry.id ? 'copied' : ''}`}
            onClick={(event) => void handleCopyEvent(entry, event)}
            title="Copy full event"
            aria-label="Copy full event"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
      </div>
    );
  };

  const renderGroupedEntries = () => {
    if (!groupedEntries) {
      return sortedEntries.map(renderEntry);
    }

    return Array.from(groupedEntries.entries()).map(([groupKey, groupEntries]) => {
      const sortedGroupEntries = sortEntries(groupEntries);
      const groupErrorCount = sortedGroupEntries.filter(
        (entry) => getConsoleDisplayLevel(entry) === 'error',
      ).length;
      const groupWarningCount = sortedGroupEntries.filter(
        (entry) => getConsoleDisplayLevel(entry) === 'warn',
      ).length;

      return (
        <div key={groupKey} className="page-group">
          <div className="page-header">
            <div className="group-title-container">
              <span className="group-title">{groupKey}</span>
              {(groupErrorCount > 0 || groupWarningCount > 0) && (
                <span className="group-severity">
                  {groupErrorCount > 0 && <span className="error-count">{groupErrorCount} issues</span>}
                  {groupWarningCount > 0 && <span className="warn-count">{groupWarningCount} warnings</span>}
                </span>
              )}
            </div>
            <span className="page-count">{groupEntries.length} entries</span>
          </div>
          <div className="group-entries">{sortedGroupEntries.map(renderEntry)}</div>
        </div>
      );
    });
  };

  const allSelected = entries.length > 0 && selectedIds.size === entries.length;

  return (
    <div className="request-list console-request-list">
      <div className="log-summary-bar console-log-summary-bar">
        <div className="summary-left console-summary-left">
          <div className="console-select-all-container">
            <input type="checkbox" id={selectAllId} checked={allSelected} onChange={handleSelectAll} />
            <label htmlFor={selectAllId} className="select-all-label console-select-all-label">
              <span className="checkbox-custom console-select-all-checkbox" aria-hidden="true"></span>
              <span className="select-text console-select-text">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
              </span>
            </label>
          </div>

          <span className="summary-text console-summary-text">
            <strong>{entries.length}</strong> visible
          </span>

          {overlayErrorCount > 0 && (
            <span className="summary-badge console-summary-badge status-4xx">
              {overlayErrorCount} errors
            </span>
          )}

          {overlayWarningCount > 0 && (
            <span className="summary-badge console-summary-badge status-3xx">
              {overlayWarningCount} warnings
            </span>
          )}
        </div>

        <div className="summary-right console-summary-right">
          {selectedIds.size > 0 && (
            <div className="selection-actions console-selection-actions">
              <button
                className={`action-btn-glass console-action-btn copy-all ${copiedId === 'bulk-copy' ? 'copied' : ''}`}
                onClick={() => void handleCopySelected()}
              >
                {copiedId === 'bulk-copy' ? 'Copied' : 'Copy Selected'}
              </button>
              <button
                className="action-btn-glass console-action-btn clear"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </button>
            </div>
          )}

          <div className="sort-controls console-sort-controls">
            <span className="sort-label console-sort-label">Sort by:</span>
            <button
              className={`sort-button console-sort-button ${sortField === 'timestamp' ? 'active' : ''}`}
              onClick={() => handleSort('timestamp')}
            >
              Time {renderSortIcon('timestamp')}
            </button>
            <button
              className={`sort-button console-sort-button ${sortField === 'severity' ? 'active' : ''}`}
              onClick={() => handleSort('severity')}
            >
              Severity {renderSortIcon('severity')}
            </button>
          </div>
        </div>

        <div className="console-summary-inline-filters" role="toolbar" aria-label="Console issue quick filters">
          {QUICK_FOCUS_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`console-quick-chip ${quickFocus === option.key ? 'active' : ''}`}
              onClick={() => onQuickFocusChange(option.key)}
            >
              <span>{option.label}</span>
              <strong aria-hidden="true">{quickFocusCounts[option.key]}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="request-list-header">
        <div className="header-cell checkbox-cell"></div>
        <div className="header-cell" onClick={() => handleSort('severity')} style={{ cursor: 'pointer' }}>
          Level {renderSortIcon('severity')}
        </div>
        <div className="header-cell" onClick={() => handleSort('timestamp')} style={{ cursor: 'pointer' }}>
          Timestamp {renderSortIcon('timestamp')}
        </div>
        <div className="header-cell">Message</div>
        <div className="header-cell">Source</div>
        <div className="header-cell actions-header">Actions</div>
      </div>

      <div className="request-list-content">
        {entries.length === 0 ? (
          <div className="no-data">No log entries match the current filters.</div>
        ) : (
          renderGroupedEntries()
        )}
      </div>
    </div>
  );
};

export default ConsoleLogList;
