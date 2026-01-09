// src/components/RequestList.tsx
import React, { useState, useMemo } from 'react';
import { Entry } from '../types/har';
import { HarAnalyzer } from '../utils/harAnalyzer';
import { formatBytes, formatTime } from '../utils/formatters';

interface RequestListProps {
  entries: Entry[];
  groupedEntries: Map<string, Entry[]> | null;
  selectedEntry: Entry | null;
  onSelectEntry: (entry: Entry) => void;
  timingType: 'relative' | 'independent';
}

type SortField = 'status' | 'method' | 'url' | 'size' | 'time';
type SortDirection = 'asc' | 'desc';

const RequestList: React.FC<RequestListProps> = ({
  entries,
  groupedEntries,
  selectedEntry,
  onSelectEntry,
  timingType,
}) => {
  const [sortField, setSortField] = useState<SortField>('time');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedEntries = useMemo(() => {
    const sorted = [...entries];
    
    sorted.sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'status':
          comparison = a.response.status - b.response.status;
          break;
        case 'method':
          comparison = a.request.method.localeCompare(b.request.method);
          break;
        case 'url':
          comparison = a.request.url.localeCompare(b.request.url);
          break;
        case 'size':
          comparison = a.response.bodySize - b.response.bodySize;
          break;
        case 'time':
          comparison = a.time - b.time;
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return sorted;
  }, [entries, sortField, sortDirection]);

  const maxTime = useMemo(() => {
    return Math.max(...entries.map(e => e.time), 1);
  }, [entries]);

  const getStatusClass = (status: number): string => {
    if (status >= 200 && status < 300) return 'status-2xx';
    if (status >= 300 && status < 400) return 'status-3xx';
    if (status >= 400 && status < 500) return 'status-4xx';
    if (status >= 500) return 'status-5xx';
    return 'status-0';
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <span className="sort-icon">⇅</span>;
    }
    return sortDirection === 'asc' ? 
      <span className="sort-icon active">↑</span> : 
      <span className="sort-icon active">↓</span>;
  };

  const renderEntry = (entry: Entry, index: number) => {
    const isSelected = selectedEntry === entry;
    const timingBreakdown = HarAnalyzer.getTimingBreakdown(entry);
    const totalTime = entry.time;

    return (
      <div
        key={index}
        className={`request-item ${isSelected ? 'selected' : ''}`}
        onClick={() => onSelectEntry(entry)}
      >
        <span className={`request-status ${getStatusClass(entry.response.status)}`}>
          {entry.response.status}
        </span>
        <span className="request-method">{entry.request.method}</span>
        <span className="request-url" title={entry.request.url}>
          {entry.request.url}
        </span>
        <span className="request-size">{formatBytes(entry.response.bodySize)}</span>
        <span className="request-time">{formatTime(totalTime)}</span>
        <div className="request-waterfall">
          <div
            className="waterfall-bar"
            style={{ width: `${(totalTime / maxTime) * 100}%` }}
          >
            {Object.entries(timingBreakdown).map(([phase, time]) => {
              if (time <= 0) return null;
              const percentage = (time / totalTime) * 100;
              return (
                <div
                  key={phase}
                  className={`timing-segment timing-${phase}`}
                  style={{ width: `${percentage}%` }}
                  title={`${phase}: ${formatTime(time)}`}
                />
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderGroupedEntries = () => {
    if (!groupedEntries) {
      return sortedEntries.map((entry, index) => renderEntry(entry, index));
    }

    return Array.from(groupedEntries.entries()).map(([pageId, pageEntries]) => {
      // Sort entries within each group
      const sortedPageEntries = [...pageEntries];
      sortedPageEntries.sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case 'status':
            comparison = a.response.status - b.response.status;
            break;
          case 'method':
            comparison = a.request.method.localeCompare(b.request.method);
            break;
          case 'url':
            comparison = a.request.url.localeCompare(b.request.url);
            break;
          case 'size':
            comparison = a.response.bodySize - b.response.bodySize;
            break;
          case 'time':
            comparison = a.time - b.time;
            break;
        }
        return sortDirection === 'asc' ? comparison : -comparison;
      });

      return (
        <div key={pageId} className="page-group">
          <div className="page-header">
            <span className="page-title">
              {pageId === '_orphan' ? 'Ungrouped Requests' : `Page: ${pageId}`}
            </span>
            <span className="page-count">{pageEntries.length} requests</span>
          </div>
          {sortedPageEntries.map((entry, index) => renderEntry(entry, index))}
        </div>
      );
    });
  };

  return (
    <div className="request-list">
      <div className="request-list-header">
        <button 
          className="header-cell sortable" 
          onClick={() => handleSort('status')}
        >
          Status {renderSortIcon('status')}
        </button>
        <button 
          className="header-cell sortable" 
          onClick={() => handleSort('method')}
        >
          Method {renderSortIcon('method')}
        </button>
        <button 
          className="header-cell sortable" 
          onClick={() => handleSort('url')}
        >
          URL {renderSortIcon('url')}
        </button>
        <button 
          className="header-cell sortable" 
          onClick={() => handleSort('size')}
        >
          Size {renderSortIcon('size')}
        </button>
        <button 
          className="header-cell sortable" 
          onClick={() => handleSort('time')}
        >
          Time {renderSortIcon('time')}
        </button>
        <span className="header-cell">Timeline</span>
      </div>
      <div className="request-list-content">
        {entries.length === 0 ? (
          <div className="no-data">No requests match the current filters</div>
        ) : (
          renderGroupedEntries()
        )}
      </div>
    </div>
  );
};

export default RequestList;
