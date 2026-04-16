// src/components/RequestList.tsx
import React, { useState, useMemo } from 'react';
import {
  ArrowUp, ArrowDown, ArrowUpDown,
  CornerDownRight, HardDrive, Clock, AlertTriangle,
} from 'lucide-react';
import { Entry } from '../types/har';
import { HarAnalyzer } from '../utils/harAnalyzer';
import { formatBytes, formatTime } from '../utils/formatters';

export const formatTimestamp = (iso: string): string => {
  const tIdx = iso.indexOf('T');
  if (tIdx === -1) return iso;
  const time = iso.slice(tIdx + 1);
  // Strip timezone suffix (Z or ±HH:MM)
  const clean = time.replace(/([Z]|[+-]\d{2}:\d{2})$/, '');
  // Return up to HH:MM:SS.mmm (12 chars)
  return clean.substring(0, 12);
};

interface AnalysisBadge {
  key: string;
  icon: React.ReactElement;
  className: string;
  title: string;
}

const getAnalysisBadges = (entry: Entry): AnalysisBadge[] => {
  const badges: AnalysisBadge[] = [];
  const { status, bodySize } = entry.response;

  if (status >= 300 && status < 400) {
    badges.push({
      key: 'redirect',
      icon: <CornerDownRight size={12} aria-hidden="true" />,
      className: 'badge-redirect',
      title: 'Redirect',
    });
  }
  if (status === 304 || (status === 200 && bodySize === 0)) {
    badges.push({
      key: 'cached',
      icon: <HardDrive size={12} aria-hidden="true" />,
      className: 'badge-cached',
      title: 'Cached',
    });
  }
  if (entry.time > 3000) {
    badges.push({
      key: 'slow',
      icon: <Clock size={12} aria-hidden="true" />,
      className: 'badge-slow',
      title: 'Slow (>3s)',
    });
  }
  if (bodySize > 1_000_000) {
    badges.push({
      key: 'large',
      icon: <AlertTriangle size={12} aria-hidden="true" />,
      className: 'badge-large',
      title: 'Large response (>1MB)',
    });
  }
  return badges;
};

interface RequestListProps {
  entries: Entry[];
  selectedEntry: Entry | null;
  onSelectEntry: (entry: Entry) => void;
  timingType: 'relative' | 'independent';
}

type SortField = 'status' | 'method' | 'url' | 'size' | 'time' | 'timestamp';
type SortDirection = 'asc' | 'desc';

const RequestList: React.FC<RequestListProps> = ({
  entries,
  selectedEntry,
  onSelectEntry,
  timingType,
}) => {
  const [sortField, setSortField] = useState<SortField>('timestamp');
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
        case 'timestamp':
          comparison = new Date(a.startedDateTime).getTime() - new Date(b.startedDateTime).getTime();
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
    if (sortField !== field) return <ArrowUpDown size={12} className="sort-icon" aria-hidden="true" />;
    return sortDirection === 'asc'
      ? <ArrowUp size={12} className="sort-icon active" aria-hidden="true" />
      : <ArrowDown size={12} className="sort-icon active" aria-hidden="true" />;
  };

  const renderEntry = (entry: Entry, index: number) => {
    const isSelected = selectedEntry === entry;
    const timingBreakdown = HarAnalyzer.getTimingBreakdown(entry);
    const totalTime = entry.time;
    const badges = getAnalysisBadges(entry);

    return (
      <div
        key={index}
        className={`request-item ${isSelected ? 'selected' : ''}`}
        onClick={() => onSelectEntry(entry)}
      >
        <span
          className="request-timestamp"
          data-testid="request-timestamp"
          title={entry.startedDateTime}
        >
          {formatTimestamp(entry.startedDateTime)}
        </span>
        <span className={`request-status ${getStatusClass(entry.response.status)}`}>
          {entry.response.status}
        </span>
        <span className="request-method">{entry.request.method}</span>
        <span className="request-url-cell">
          <span className="request-url" title={entry.request.url}>
            {entry.request.url}
          </span>
          {badges.length > 0 && (
            <span className="analysis-badges">
              {badges.map(b => (
                <span key={b.key} className={`analysis-badge ${b.className}`} title={b.title}>
                  {b.icon}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="request-size">
          <span className="request-size-up" data-testid="size-upload">
            <ArrowUp size={9} aria-hidden="true" />
            {entry.request.bodySize > 0 ? formatBytes(entry.request.bodySize, 0) : '—'}
          </span>
          <span className="request-size-sep" aria-hidden="true" />
          <span className="request-size-down" data-testid="size-download">
            <ArrowDown size={9} aria-hidden="true" />
            {entry.response.bodySize > 0 ? formatBytes(entry.response.bodySize, 0) : '—'}
          </span>
        </span>
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

  return (
    <div className="request-list har-request-list">
      <div className="request-list-header">
        <button
          className="header-cell sortable"
          onClick={() => handleSort('timestamp')}
        >
          Timestamp {renderSortIcon('timestamp')}
        </button>
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
          sortedEntries.map((entry, index) => renderEntry(entry, index))
        )}
      </div>
    </div>
  );
};

export default RequestList;
