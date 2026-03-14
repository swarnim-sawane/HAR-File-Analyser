// src/components/ConsoleLogList.tsx

import React, { useState, useMemo } from 'react';
import { LogEntry } from '../../../shared/types/consolelog';

interface ConsoleLogListProps {
  logs: LogEntry[];
  selectedLog: LogEntry | null;
  onSelectLog: (log: LogEntry) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  loading: boolean;
}

type SortField = 'timestamp' | 'level' | 'message';
type SortDirection = 'asc' | 'desc';

const ConsoleLogList: React.FC<ConsoleLogListProps> = ({
  logs,
  selectedLog,
  onSelectLog,
  hasMore,
  onLoadMore,
  loading,
}) => {
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

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
    return colors[level.toLowerCase()] || '#6b7280';
  };

  const getLevelBadgeClass = (level: string): string => {
    const classes: Record<string, string> = {
      error: 'status-4xx',
      warn: 'status-3xx',
      info: 'status-1xx',
      log: 'status-0',
      debug: 'status-0',
      trace: 'status-0',
      verbose: 'status-0',
    };
    return classes[level.toLowerCase()] || 'status-0';
  };

  const getLevelPriority = (level: string): number => {
    const priorities: Record<string, number> = {
      error: 5,
      warn: 4,
      info: 3,
      log: 2,
      debug: 1,
      trace: 1,
      verbose: 1,
    };
    return priorities[level.toLowerCase()] || 0;
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleCopyMessage = (log: LogEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const formattedText = `[${log.level.toUpperCase()}] ${new Date(log.timestamp).toLocaleString()}\n${log.message}`;
    
    navigator.clipboard.writeText(formattedText);
    setCopiedId(log.index);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(logs.map(l => l.index)));
    }
  };

  const handleSelectEntry = (logIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedIds);
    if (newSelected.has(logIndex)) {
      newSelected.delete(logIndex);
    } else {
      newSelected.add(logIndex);
    }
    setSelectedIds(newSelected);
  };

  const handleCopySelected = () => {
    const selectedEntries = logs.filter(l => selectedIds.has(l.index));
    const text = selectedEntries.map(l => 
      `[${l.level.toUpperCase()}] ${new Date(l.timestamp).toLocaleString()}\n${l.message}`
    ).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopiedId(-1); // Using -1 for bulk copy
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const sortedLogs = useMemo(() => {
    const sorted = [...logs];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'timestamp':
          comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          break;
        case 'level':
          comparison = a.level.localeCompare(b.level);
          break;
        case 'message':
          comparison = a.message.localeCompare(b.message);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [logs, sortField, sortDirection]);

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <span className="sort-icon inactive">⇅</span>;
    }
    return sortDirection === 'asc'
      ? <span className="sort-icon">↑</span>
      : <span className="sort-icon">↓</span>;
  };

  const errorCount = logs.filter(l => l.level.toLowerCase() === 'error').length;
  const warnCount = logs.filter(l => l.level.toLowerCase() === 'warn').length;
  const allSelected = selectedIds.size === logs.length && logs.length > 0;

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
            <strong>{logs.length}</strong> entries
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
                className={`action-btn-glass copy-all ${copiedId === -1 ? 'copied' : ''}`}
                onClick={handleCopySelected}
              >
                {copiedId === -1 ? '✓ Copied' : 'Copy Selected'}
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
              className={`sort-button ${sortField === 'level' ? 'active' : ''}`}
              onClick={() => handleSort('level')}
            >
              Level {renderSortIcon('level')}
            </button>
          </div>
        </div>
      </div>

      <div className="request-list-header">
        <div className="header-cell checkbox-cell"></div>
        <div className="header-cell" onClick={() => handleSort('level')} style={{ cursor: 'pointer' }}>
          Level {renderSortIcon('level')}
        </div>
        <div className="header-cell" onClick={() => handleSort('timestamp')} style={{ cursor: 'pointer' }}>
          Timestamp {renderSortIcon('timestamp')}
        </div>
        <div className="header-cell">Message</div>
        <div className="header-cell actions-header">Actions</div>
      </div>

      <div className="request-list-content">
        {logs.length === 0 ? (
          <div className="no-data">No logs match the current filters</div>
        ) : (
          <>
            {sortedLogs.map((log) => {
              const isSelected = selectedLog?.index === log.index;
              const isChecked = selectedIds.has(log.index);
              const priority = getLevelPriority(log.level);

              return (
                <div
                  key={log.index}
                  className={`request-item ${isSelected ? 'selected' : ''} ${isChecked ? 'checked-item' : ''}`}
                  onClick={() => onSelectLog(log)}
                >
                  <div className="log-checkbox">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => handleSelectEntry(log.index, e as any)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="checkbox-custom"></span>
                  </div>
                  
                  <div className="log-level-cell">
                    <span className={`status-badge ${getLevelBadgeClass(log.level)}`}>
                      {log.level.toUpperCase()}
                    </span>
                    {priority >= 4 && (
                      <span className="priority-indicator" title={`Priority: ${priority}`}>
                        {'!'.repeat(priority - 3)}
                      </span>
                    )}
                  </div>
                  
                  <div className="log-timestamp-cell">
                    {new Date(log.timestamp).toLocaleString()}
                  </div>
                  
                  <div className="log-message-cell">
                    <div className="log-message">{log.message}</div>
                  </div>

                  <div className="log-actions-cell">
                    <button
                      className={`btn-copy ${copiedId === log.index ? 'copied' : ''}`}
                      onClick={(e) => handleCopyMessage(log, e)}
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
            })}
          </>
        )}
      </div>

      {/* Load More Section */}
      {hasMore && (
        <div className="load-more-container">
          <button
            className="btn-load-more"
            onClick={onLoadMore}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                Loading...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                Load More ({logs.length} loaded)
              </>
            )}
          </button>
        </div>
      )}

      {/* End of list indicator */}
      {!hasMore && logs.length > 0 && (
        <div className="end-of-list">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 13l4 4L19 7" />
          </svg>
          All {logs.length} logs loaded
        </div>
      )}
    </div>
  );
};

export default ConsoleLogList;
