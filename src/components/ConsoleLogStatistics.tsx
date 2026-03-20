// src/components/ConsoleLogStatistics.tsx

import React from 'react';
import { ConsoleLogEntry } from '../types/consolelog';
import { ConsoleLogAnalyzer } from '../utils/consoleLogAnalyzer';

interface ConsoleLogStatisticsProps {
  entries: ConsoleLogEntry[];
  totalEntries?: number;   // actual total in backend (may be > entries.length)
  truncatedAt?: number;    // set when backend has more entries than loaded
}

const ConsoleLogStatistics: React.FC<ConsoleLogStatisticsProps> = ({ entries, totalEntries, truncatedAt }) => {
  const stats = ConsoleLogAnalyzer.getStatistics(entries);
  const isTruncated = truncatedAt !== undefined && (totalEntries ?? 0) > truncatedAt;

  const levelColors: Record<string, string> = {
    error: '#ef4444',
    warn: '#f59e0b',
    info: '#3b82f6',
    log: '#6b7280',
    debug: '#8b5cf6',
    trace: '#ec4899',
    verbose: '#06b6d4',
  };

  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="filter-panel console-stats-panel">
      {isTruncated && (
        <div style={{
          background: 'rgba(245, 158, 11, 0.12)',
          border: '1px solid rgba(245, 158, 11, 0.4)',
          borderRadius: '8px',
          padding: '10px 12px',
          marginBottom: '12px',
          fontSize: '12px',
          lineHeight: '1.5',
          color: 'var(--text-secondary, #888)',
        }}>
          <strong style={{ color: '#f59e0b' }}>⚠ Large file</strong><br />
          Showing first <strong>{fmt(truncatedAt!)}</strong> of <strong>{fmt(totalEntries ?? 0)}</strong> entries.
          Use <strong>Filters</strong> or <strong>Search</strong> to narrow results.
        </div>
      )}

      <div className="filter-section">
        <h3>Statistics</h3>

        <div className="console-stats-total-card">
          <div className="console-stats-total-label">Total Entries</div>
          <div className="console-stats-total-value">{fmt(totalEntries ?? stats.totalEntries)}</div>
        </div>

        <div className="console-stats-level-list">
          {Object.entries(stats.levelCounts).map(([level, count]) => {
            if (count <= 0) return null;
            const percent = stats.totalEntries > 0 ? (count / stats.totalEntries) * 100 : 0;
            return (
              <div key={level} className="console-stats-level-row">
                <span
                  className="console-stats-level-badge"
                  style={{ backgroundColor: levelColors[level] }}
                >
                  {level.toUpperCase()}
                </span>
                <span className="console-stats-level-count">{count}</span>
                <div className="console-stats-level-bar">
                  <div
                    className="console-stats-level-bar-fill"
                    style={{
                      width: `${percent}%`,
                      backgroundColor: levelColors[level],
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {stats.topErrors.length > 0 && (
        <div className="filter-section">
          <h3>Top Errors</h3>
          <div className="console-stats-error-list">
            {stats.topErrors.slice(0, 5).map((error, index) => (
              <div key={index} className="console-stats-error-card">
                <div className="console-stats-error-message">{error.message}</div>
                <div className="console-stats-error-count">{error.count}x occurrences</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.timeRange && (
        <div className="filter-section">
          <h3>Time Range</h3>
          <div className="console-stats-time-card">
            <div className="console-stats-time-row">
              <strong>Start:</strong>
              <span>{new Date(stats.timeRange.start).toLocaleString()}</span>
            </div>
            <div className="console-stats-time-row">
              <strong>End:</strong>
              <span>{new Date(stats.timeRange.end).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConsoleLogStatistics;
