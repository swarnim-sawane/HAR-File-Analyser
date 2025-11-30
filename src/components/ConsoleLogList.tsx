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
    alert(`Copied ${selectedEntries.length} log entries to clipboard`);
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
        className={`log-entry level-${entry.level} ${isSelected ? 'selected' : ''} ${isChecked ? 'checked' : ''}`}
        onClick={() => onSelectEntry(entry)}
      >
        <button
          className={`copy-btn-hover ${copiedId === entry.id ? 'copied' : ''}`}
          onClick={(e) => handleCopyMessage(entry, e)}
          title="Copy log entry"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>

        <div className="log-checkbox">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => handleSelectEntry(entry.id, e as any)}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="checkbox-custom"></span>
        </div>
        
        <div className="log-level">
          <span
            className="level-badge-glow"
            style={{ 
              backgroundColor: getLevelColor(entry.level),
              boxShadow: `0 0 12px ${getLevelColor(entry.level)}40, 0 2px 4px ${getLevelColor(entry.level)}30`
            }}
          >
            {entry.level.toUpperCase()}
          </span>
          {priority >= 4 && (
            <span className="priority-indicator" title={`Priority: ${priority}`}>
              {'!'.repeat(priority - 3)}
            </span>
          )}
        </div>
        
        <div className="log-timestamp">
          {formatDate(entry.timestamp)}
        </div>
        
        <div className="log-message-container">
          <div className="log-message">{entry.message}</div>
        </div>
        
        <div className="log-source">
          {entry.source && (
            <>
              <span className="source-file">{entry.source.split('/').pop()}</span>
              {entry.lineNumber && (
                <span className="source-line">:{entry.lineNumber}</span>
              )}
            </>
          )}
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
        <div key={groupKey} className="log-group">
          <div className="group-header">
            <div className="group-title-container">
              <span className="group-title">{groupKey}</span>
              {(errorCount > 0 || warnCount > 0) && (
                <span className="group-severity">
                  {errorCount > 0 && <span className="error-count">{errorCount} errors</span>}
                  {warnCount > 0 && <span className="warn-count">{warnCount} warnings</span>}
                </span>
              )}
            </div>
            <span className="group-count">{groupEntries.length} entries</span>
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
    <div className="log-list">
      <div className="log-list-summary glass-summary">
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
            Showing <strong>{entries.length}</strong> entries
          </span>
          {errorCount > 0 && (
            <span className="summary-badge error-badge">
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
          )}
          {warnCount > 0 && (
            <span className="summary-badge warn-badge">
              {warnCount} warning{warnCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="summary-right">
          {selectedIds.size > 0 && (
            <div className="selection-actions">
              <button className="action-btn-glass copy_all " onClick={handleCopySelected}>
                Copy Selected
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
              Time {sortField === 'timestamp' && renderSortIcon('timestamp')}
            </button>
            <button
              className={`sort-button ${sortField === 'severity' ? 'active' : ''}`}
              onClick={() => handleSort('severity')}
            >
              Severity {sortField === 'severity' && renderSortIcon('severity')}
            </button>
          </div>
        </div>
      </div>
      
      <div className="log-list-header">
        <div className="header-cell copy-cell"></div>
        <div className="header-cell checkbox-cell"></div>
        <div className="header-cell">Level</div>
        <div className="header-cell">Timestamp</div>
        <div className="header-cell">Message</div>
        <div className="header-cell">Source</div>
      </div>
      <div className="log-list-body">
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
