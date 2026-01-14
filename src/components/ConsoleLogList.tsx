// src/components/ConsoleLogList.tsx

import React, { useState, useMemo } from 'react';
import { ConsoleLogEntry, LogLevel } from '../types/consolelog';
import { formatDate } from '../utils/formatters';

interface ConsoleLogListProps {
  entries: ConsoleLogEntry[];
  groupedEntries: Map<string, ConsoleLogEntry[]> | null;
  selectedEntry: ConsoleLogEntry | null;
  onSelectEntry: (entry: ConsoleLogEntry) => void;
}

type SortField = 'timestamp' | 'severity';
type SortDirection = 'asc' | 'desc';

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

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'timestamp' ? 'desc' : 'desc');
    }
  };

  const handleCopyMessage = (entry: ConsoleLogEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const formattedText = `[${entry.level.toUpperCase()}] ${formatDate(entry.timestamp)}
${entry.message}${entry.source ? `\nSource: ${entry.source}${entry.lineNumber ? `:${entry.lineNumber}` : ''}` : ''}`;
    
    navigator.clipboard.writeText(formattedText);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map(e => e.id)));
    }
  };

  const handleSelectEntry = (entryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedIds);
    if (newSelected.has(entryId)) {
      newSelected.delete(entryId);
    } else {
      newSelected.add(entryId);
    }
    setSelectedIds(newSelected);
  };

  const handleCopySelected = () => {
    const selectedEntries = entries.filter(e => selectedIds.has(e.id));
    const text = selectedEntries.map(e => 
      `[${e.level.toUpperCase()}] ${formatDate(e.timestamp)}\n${e.message}${e.source ? `\nSource: ${e.source}${e.lineNumber ? `:${e.lineNumber}` : ''}` : ''}`
    ).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopiedId('bulk-copy');
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const getLevelPriority = (level: LogLevel): number => {
    const priorities: Record<LogLevel, number> = {
      error: 5,
      warn: 4,
      info: 3,
      log: 2,
      debug: 1,
      trace: 1,
      verbose: 1,
    };
    return priorities[level] || 0;
  };

  const sortedEntries = useMemo(() => {
    const sorted = [...entries];
    sorted.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'timestamp':
          comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          break;
        case 'severity':
          comparison = getLevelPriority(b.level) - getLevelPriority(a.level);
          if (comparison === 0) {
            comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          }
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [entries, sortField, sortDirection]);

  const getLevelColor = (level: LogLevel): string => {
    const colors: Record<LogLevel, string> = {
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
      return <span className="sort-icon inactive">⇅</span>;
    }
    return sortDirection === 'asc'
      ? <span className="sort-icon">↑</span>
      : <span className="sort-icon">↓</span>;
  };

  const renderEntry = (entry: ConsoleLogEntry) => {
    const isSelected = selectedEntry?.id === entry.id;
    const isChecked = selectedIds.has(entry.id);
    const priority = getLevelPriority(entry.level);

    return (
      <div
        key={entry.id}
        className={`request-item ${isSelected ? 'selected' : ''} ${isChecked ? 'checked-item' : ''}`}
        onClick={() => onSelectEntry(entry)}
      >
        <div className="log-checkbox">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => handleSelectEntry(entry.id, e as any)}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="checkbox-custom"></span>
        </div>
        
        <div className="log-level-cell">
          <span className={`status-badge ${getLevelBadgeClass(entry.level)}`}>
            {entry.level.toUpperCase()}
          </span>
          {priority >= 4 && (
            <span className="priority-indicator" title={`Priority: ${priority}`}>
              {'!'.repeat(priority - 3)}
            </span>
          )}
        </div>
        
        <div className="log-timestamp-cell">
          {formatDate(entry.timestamp)}
        </div>
        
        <div className="log-message-cell">
          <div className="log-message">{entry.message}</div>
        </div>
        
        <div className="log-source-cell">
          {entry.source && (
            <>
              <span className="source-file">{entry.source.split('/').pop()}</span>
              {entry.lineNumber && (
                <span className="source-line">:{entry.lineNumber}</span>
              )}
            </>
          )}
        </div>

        <div className="log-actions-cell">
          <button
            className={`btn-copy ${copiedId === entry.id ? 'copied' : ''}`}
            onClick={(e) => handleCopyMessage(entry, e)}
            title="Copy log entry"
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
      const sortedGroupEntries = [...groupEntries].sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case 'timestamp':
            comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
            break;
          case 'severity':
            comparison = getLevelPriority(b.level) - getLevelPriority(a.level);
            if (comparison === 0) {
              comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
            }
            break;
        }
        return sortDirection === 'asc' ? comparison : -comparison;
      });

      const errorCount = groupEntries.filter(e => e.level === 'error').length;
      const warnCount = groupEntries.filter(e => e.level === 'warn').length;

      return (
        <div key={groupKey} className="page-group">
          <div className="page-header">
            <div className="group-title-container">
              <span className="group-title">{groupKey}</span>
              {(errorCount > 0 || warnCount > 0) && (
                <span className="group-severity">
                  {errorCount > 0 && <span className="error-count">{errorCount} errors</span>}
                  {warnCount > 0 && <span className="warn-count">{warnCount} warnings</span>}
                </span>
              )}
            </div>
            <span className="page-count">{groupEntries.length} entries</span>
          </div>
          <div className="group-entries">
            {sortedGroupEntries.map(renderEntry)}
          </div>
        </div>
      );
    });
  };

  const errorCount = entries.filter(e => e.level === 'error').length;
  const warnCount = entries.filter(e => e.level === 'warn').length;
  const allSelected = selectedIds.size === entries.length && entries.length > 0;

  return (
    <div className="request-list">
      <div className="log-summary-bar">
        <div className="summary-left">
          <div className="select-all-container">
            <input
              type="checkbox"
              id="select-all"
              checked={allSelected}
              onChange={handleSelectAll}
            />
            <label htmlFor="select-all" className="select-all-label">
              <span className="checkbox-custom"></span>
              <span className="select-text">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
              </span>
            </label>
          </div>
          <span className="summary-text">
            <strong>{entries.length}</strong> entries
          </span>
          {errorCount > 0 && (
            <span className="summary-badge status-4xx">
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
          )}
          {warnCount > 0 && (
            <span className="summary-badge status-3xx">
              {warnCount} warning{warnCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="summary-right">
          {selectedIds.size > 0 && (
            <div className="selection-actions">
              <button 
                className={`action-btn-glass copy-all ${copiedId === 'bulk-copy' ? 'copied' : ''}`}
                onClick={handleCopySelected}
              >
                {copiedId === 'bulk-copy' ? '✓ Copied' : 'Copy Selected'}
              </button>
              <button className="action-btn-glass clear" onClick={handleClearSelection}>
                ✕ Clear
              </button>
            </div>
          )}
          <div className="sort-controls">
            <span className="sort-label">Sort by:</span>
            <button
              className={`sort-button ${sortField === 'timestamp' ? 'active' : ''}`}
              onClick={() => handleSort('timestamp')}
            >
              Time {renderSortIcon('timestamp')}
            </button>
            <button
              className={`sort-button ${sortField === 'severity' ? 'active' : ''}`}
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
      
      <div className="request-list-content">
        {entries.length === 0 ? (
          <div className="no-data">No log entries match the current filters</div>
        ) : (
          renderGroupedEntries()
        )}
      </div>
    </div>
  );
};

export default ConsoleLogList;
