import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConsoleLogEntry, LogLevel } from '../types/consolelog';
import { formatDate } from '../utils/formatters';
import { getConsoleDisplayLevel } from '../utils/consoleLogSeverity';

interface ConsoleLogListProps {
  entries: ConsoleLogEntry[];
  groupedEntries: Map<string, ConsoleLogEntry[]> | null;
  selectedEntry: ConsoleLogEntry | null;
  onSelectEntry: (entry: ConsoleLogEntry) => void | Promise<void>;
}

type SortField = 'timestamp' | 'severity';
type SortDirection = 'asc' | 'desc';
type VirtualRow =
  | {
      type: 'group';
      key: string;
      groupKey: string;
      count: number;
      errorCount: number;
      warningCount: number;
    }
  | {
      type: 'entry';
      key: string;
      entry: ConsoleLogEntry;
    };

const ENTRY_ROW_HEIGHT = 64;
const GROUP_ROW_HEIGHT = 42;
const VIRTUAL_OVERSCAN = 12;
const FALLBACK_VIEWPORT_HEIGHT = 600;

function getVirtualRowHeight(row: VirtualRow): number {
  return row.type === 'group' ? GROUP_ROW_HEIGHT : ENTRY_ROW_HEIGHT;
}

function findFirstVisibleIndex(rows: VirtualRow[], offsets: number[], scrollTop: number): number {
  let low = 0;
  let high = rows.length - 1;
  let result = rows.length;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const rowBottom = offsets[middle] + getVirtualRowHeight(rows[middle]);

    if (rowBottom < scrollTop) {
      low = middle + 1;
    } else {
      result = middle;
      high = middle - 1;
    }
  }

  return result === rows.length ? Math.max(0, rows.length - 1) : result;
}

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
}) => {
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const listContentRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);

  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) {
        return current;
      }

      const visibleIds = new Set(entries.map((entry) => entry.id));
      const next = new Set(Array.from(current).filter((entryId) => visibleIds.has(entryId)));
      return next.size === current.size ? current : next;
    });
  }, [entries]);

  useEffect(() => {
    const element = listContentRef.current;
    if (!element) {
      return undefined;
    }

    const measure = () => {
      setViewportHeight(element.clientHeight || FALLBACK_VIEWPORT_HEIGHT);
      setScrollTop(element.scrollTop);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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

  const visibleSummary = useMemo(() => {
    let errorCount = 0;
    let warningCount = 0;

    for (const entry of entries) {
      const displayLevel = getConsoleDisplayLevel(entry);
      if (displayLevel === 'error') {
        errorCount += 1;
      } else if (displayLevel === 'warn') {
        warningCount += 1;
      }
    }

    return { errorCount, warningCount };
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
    const isPromoted = entry.originalLevel && entry.originalLevel !== displayLevel;

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
            {isPromoted && (
              <span className="console-original-level">
                original: {entry.originalLevel!.toUpperCase()}
              </span>
            )}
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

  const virtualRows = useMemo<VirtualRow[]>(() => {
    if (!groupedEntries) {
      return sortedEntries.map((entry) => ({
        type: 'entry',
        key: `entry-${entry.id}`,
        entry,
      }));
    }

    return Array.from(groupedEntries.entries()).flatMap(([groupKey, groupEntries]) => {
      const sortedGroupEntries = sortEntries(groupEntries);
      let groupErrorCount = 0;
      let groupWarningCount = 0;

      for (const entry of sortedGroupEntries) {
        const displayLevel = getConsoleDisplayLevel(entry);
        if (displayLevel === 'error') {
          groupErrorCount += 1;
        } else if (displayLevel === 'warn') {
          groupWarningCount += 1;
        }
      }

      return [
        {
          type: 'group',
          key: `group-${groupKey}`,
          groupKey,
          count: groupEntries.length,
          errorCount: groupErrorCount,
          warningCount: groupWarningCount,
        },
        ...sortedGroupEntries.map((entry) => ({
          type: 'entry' as const,
          key: `entry-${groupKey}-${entry.id}`,
          entry,
        })),
      ];
    });
  }, [groupedEntries, sortedEntries, sortDirection, sortField]);

  const virtualLayout = useMemo(() => {
    const offsets: number[] = [];
    let totalHeight = 0;

    for (const row of virtualRows) {
      offsets.push(totalHeight);
      totalHeight += getVirtualRowHeight(row);
    }

    return { offsets, totalHeight };
  }, [virtualRows]);

  const visibleVirtualRows = useMemo(() => {
    if (virtualRows.length === 0) {
      return [];
    }

    const viewportBottom = scrollTop + viewportHeight;
    const firstVisible = findFirstVisibleIndex(virtualRows, virtualLayout.offsets, scrollTop);
    const startIndex = Math.max(0, firstVisible - VIRTUAL_OVERSCAN);
    let endIndex = firstVisible;

    while (
      endIndex < virtualRows.length &&
      virtualLayout.offsets[endIndex] < viewportBottom
    ) {
      endIndex += 1;
    }

    const finalEndIndex = Math.min(virtualRows.length, endIndex + VIRTUAL_OVERSCAN);

    return virtualRows.slice(startIndex, finalEndIndex).map((row, localIndex) => {
      const index = startIndex + localIndex;
      return {
        row,
        index,
        top: virtualLayout.offsets[index],
      };
    });
  }, [scrollTop, viewportHeight, virtualLayout, virtualRows]);

  const handleListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const renderGroupHeader = (row: Extract<VirtualRow, { type: 'group' }>) => (
    <div className="page-header">
      <div className="group-title-container">
        <span className="group-title">{row.groupKey}</span>
        {(row.errorCount > 0 || row.warningCount > 0) && (
          <span className="group-severity">
            {row.errorCount > 0 && <span className="error-count">{row.errorCount} issues</span>}
            {row.warningCount > 0 && <span className="warn-count">{row.warningCount} warnings</span>}
          </span>
        )}
      </div>
      <span className="page-count">{row.count} entries</span>
    </div>
  );

  const allSelected = entries.length > 0 && selectedIds.size === entries.length;

  return (
    <div className="request-list console-request-list">
      <div className="log-summary-bar console-log-summary-bar">
        <div className="summary-left console-summary-left">
          <div className="console-select-all-container">
            <label className="select-all-label console-select-all-label">
              <input
                type="checkbox"
                className="console-select-all-input"
                checked={allSelected}
                onChange={handleSelectAll}
                aria-label={allSelected ? 'Deselect all visible log entries' : 'Select all visible log entries'}
              />
              <span className="checkbox-custom console-select-all-checkbox" aria-hidden="true"></span>
              <span className="select-text console-select-text">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
              </span>
            </label>
          </div>

          <span className="summary-text console-summary-text">
            <strong>{entries.length}</strong> visible
          </span>

          {visibleSummary.errorCount > 0 && (
            <span className="summary-badge console-summary-badge status-4xx">
              {visibleSummary.errorCount} errors
            </span>
          )}

          {visibleSummary.warningCount > 0 && (
            <span className="summary-badge console-summary-badge status-3xx">
              {visibleSummary.warningCount} warnings
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

      <div className="request-list-content" ref={listContentRef} onScroll={handleListScroll}>
        {entries.length === 0 ? (
          <div className="no-data">No log entries match the current filters.</div>
        ) : (
          <div
            className="console-virtual-list-inner"
            style={{ height: virtualLayout.totalHeight }}
          >
            {visibleVirtualRows.map(({ row, top }) => (
              <div
                key={row.key}
                className={`console-virtual-row ${
                  row.type === 'group' ? 'console-virtual-group-row' : 'console-virtual-entry-row'
                }`}
                style={{
                  height: getVirtualRowHeight(row),
                  transform: `translateY(${top}px)`,
                }}
              >
                {row.type === 'group' ? renderGroupHeader(row) : renderEntry(row.entry)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConsoleLogList;
