import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ConsoleLogEntry,
  ConsoleLogEntrySummary,
  ConsoleLogFacets,
  ConsoleLogSortField,
  LogLevel,
} from '../types/consolelog';
import { formatDate } from '../utils/formatters';
import { getConsoleDisplayLevel } from '../utils/consoleLogSeverity';

interface PagedConsoleLogListProps {
  totalEntries: number;
  facets: ConsoleLogFacets | null;
  selectedEntry: ConsoleLogEntry | null;
  selectedEntryIndex: number | null;
  selectedEntryId: string | null;
  isLoadingRows: boolean;
  sortField: ConsoleLogSortField;
  sortDirection: 'asc' | 'desc';
  getEntryAt: (position: number) => ConsoleLogEntrySummary | undefined;
  getLoadedEntries: () => ConsoleLogEntrySummary[];
  ensureRange: (startIndex: number, endIndex: number) => void;
  onSelectEntry: (entry: ConsoleLogEntrySummary) => void | Promise<void>;
  onSortChange: (field: ConsoleLogSortField) => void;
}

const ENTRY_ROW_HEIGHT = 64;
const VIRTUAL_OVERSCAN = 12;
const FALLBACK_VIEWPORT_HEIGHT = 600;

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

function getLevelBadgeClass(level: LogLevel): string {
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
}

const PagedConsoleLogList: React.FC<PagedConsoleLogListProps> = ({
  totalEntries,
  facets,
  selectedEntry,
  selectedEntryIndex,
  selectedEntryId,
  isLoadingRows,
  sortField,
  sortDirection,
  getEntryAt,
  getLoadedEntries,
  ensureRange,
  onSelectEntry,
  onSortChange,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const listContentRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);

  useEffect(() => {
    const element = listContentRef.current;
    if (!element) return undefined;

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

  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current;

      const loadedIds = new Set(getLoadedEntries().map((entry) => entry.id));
      const next = new Set(Array.from(current).filter((entryId) => loadedIds.has(entryId)));
      return next.size === current.size ? current : next;
    });
  }, [getLoadedEntries, totalEntries]);

  const firstVisibleIndex = Math.max(0, Math.floor(scrollTop / ENTRY_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ENTRY_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
  const lastVisibleIndex = Math.min(totalEntries - 1, firstVisibleIndex + visibleCount);

  useEffect(() => {
    if (totalEntries <= 0) return;
    ensureRange(firstVisibleIndex, lastVisibleIndex);
  }, [ensureRange, firstVisibleIndex, lastVisibleIndex, totalEntries]);

  const visibleRows = useMemo(() => {
    if (totalEntries <= 0) return [];

    const rows: Array<{ index: number; top: number; entry?: ConsoleLogEntrySummary }> = [];
    for (let index = firstVisibleIndex; index <= lastVisibleIndex; index += 1) {
      rows.push({
        index,
        top: index * ENTRY_ROW_HEIGHT,
        entry: getEntryAt(index),
      });
    }
    return rows;
  }, [firstVisibleIndex, getEntryAt, lastVisibleIndex, totalEntries]);

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

  const buildClipboardText = (entry: ConsoleLogEntrySummary): string => {
    const displayLevel = getConsoleDisplayLevel(entry);
    const sourceText = entry.source ? `\nSource: ${entry.source}` : '';
    const issueTagsText =
      entry.issueTags.length > 0 ? `\nIssue Tags: ${entry.issueTags.join(', ')}` : '';
    return `[${displayLevel.toUpperCase()}] ${formatDate(entry.timestamp)}${sourceText}${issueTagsText}\n\nMessage:\n${entry.message}`;
  };

  const handleCopyEvent = async (entry: ConsoleLogEntrySummary, event: React.MouseEvent) => {
    event.stopPropagation();
    await copyToClipboard(buildClipboardText(entry));
    setCopiedId(entry.id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  const handleCopySelected = async () => {
    const selectedEntries = getLoadedEntries().filter((entry) => selectedIds.has(entry.id));
    await copyToClipboard(selectedEntries.map(buildClipboardText).join('\n\n---\n\n'));
    setCopiedId('bulk-copy');
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  const toggleEntrySelection = (entryId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const handleSelectLoaded = () => {
    const loadedEntries = getLoadedEntries();
    setSelectedIds((current) => {
      if (loadedEntries.length > 0 && loadedEntries.every((entry) => current.has(entry.id))) {
        return new Set();
      }
      return new Set(loadedEntries.map((entry) => entry.id));
    });
  };

  const renderSortIcon = (field: ConsoleLogSortField) => {
    if (sortField !== field) {
      return <span className="console-sort-icon inactive">{'\u2195'}</span>;
    }

    return (
      <span className="console-sort-icon">
        {sortDirection === 'asc' ? '\u2191' : '\u2193'}
      </span>
    );
  };

  const renderIssueBadges = (entry: ConsoleLogEntrySummary) =>
    entry.issueTags.slice(0, 3).map((tag) => (
      <span key={`${entry.id}-${tag}`} className={`console-issue-pill issue-${tag}`}>
        {ISSUE_TAG_LABELS[tag] || tag}
      </span>
    ));

  const renderEntry = (entry: ConsoleLogEntrySummary) => {
    const displayLevel = getConsoleDisplayLevel(entry);
    const isSelected =
      selectedEntryId === entry.id ||
      selectedEntryIndex === entry.index ||
      selectedEntry?.id === entry.id ||
      selectedEntry?.index === entry.index;
    const isChecked = selectedIds.has(entry.id);
    const sourceLabel = entry.source ? entry.source.split('/').pop() || entry.source : null;
    const isPromoted = entry.originalLevel && entry.originalLevel !== displayLevel;

    return (
      <div
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
            aria-label={`Select log entry ${entry.index}`}
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
            <span className="source-file">{sourceLabel}</span>
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

  const loadedEntries = getLoadedEntries();
  const allLoadedSelected =
    loadedEntries.length > 0 && loadedEntries.every((entry) => selectedIds.has(entry.id));
  const errorCount = facets?.levelCounts.error ?? 0;
  const warningCount = facets?.levelCounts.warn ?? 0;

  const handleListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  return (
    <div className="request-list console-request-list">
      <div className="log-summary-bar console-log-summary-bar">
        <div className="summary-left console-summary-left">
          <div className="console-select-all-container">
            <label className="select-all-label console-select-all-label">
              <input
                type="checkbox"
                className="console-select-all-input"
                checked={allLoadedSelected}
                onChange={handleSelectLoaded}
                aria-label={allLoadedSelected ? 'Deselect loaded log entries' : 'Select loaded log entries'}
              />
              <span className="checkbox-custom console-select-all-checkbox" aria-hidden="true"></span>
              <span className="select-text console-select-text">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select loaded'}
              </span>
            </label>
          </div>

          <span className="summary-text console-summary-text">
            <strong>{totalEntries.toLocaleString()}</strong> matching full file
          </span>

          {errorCount > 0 && (
            <span className="summary-badge console-summary-badge status-4xx">
              {errorCount.toLocaleString()} errors
            </span>
          )}

          {warningCount > 0 && (
            <span className="summary-badge console-summary-badge status-3xx">
              {warningCount.toLocaleString()} warnings
            </span>
          )}

          {isLoadingRows && <span className="console-page-loading">Loading rows...</span>}
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
              onClick={() => onSortChange('timestamp')}
            >
              Time {renderSortIcon('timestamp')}
            </button>
            <button
              className={`sort-button console-sort-button ${sortField === 'level' ? 'active' : ''}`}
              onClick={() => onSortChange('level')}
            >
              Level {renderSortIcon('level')}
            </button>
          </div>
        </div>
      </div>

      <div className="request-list-header">
        <div className="header-cell checkbox-cell"></div>
        <div className="header-cell" onClick={() => onSortChange('level')} style={{ cursor: 'pointer' }}>
          Level {renderSortIcon('level')}
        </div>
        <div className="header-cell" onClick={() => onSortChange('timestamp')} style={{ cursor: 'pointer' }}>
          Timestamp {renderSortIcon('timestamp')}
        </div>
        <div className="header-cell">Message</div>
        <div className="header-cell">Source</div>
        <div className="header-cell actions-header">Actions</div>
      </div>

      <div className="request-list-content" ref={listContentRef} onScroll={handleListScroll}>
        {totalEntries === 0 ? (
          <div className="no-data">No log entries match the current filters.</div>
        ) : (
          <div
            className="console-virtual-list-inner"
            style={{ height: totalEntries * ENTRY_ROW_HEIGHT }}
          >
            {visibleRows.map(({ index, top, entry }) => (
              <div
                key={entry?.id ?? `placeholder-${index}`}
                className="console-virtual-row console-virtual-entry-row"
                style={{
                  height: ENTRY_ROW_HEIGHT,
                  transform: `translateY(${top}px)`,
                }}
              >
                {entry ? renderEntry(entry) : (
                  <div className="request-item console-row-placeholder">
                    <div className="log-message-cell">Loading log entry {index + 1}...</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PagedConsoleLogList;
