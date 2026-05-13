// src/components/ConsoleLogStatistics.tsx

import React from 'react';
import { ConsoleLogEntry, ConsoleLogFacets } from '../types/consolelog';
import { ConsoleLogAnalyzer } from '../utils/consoleLogAnalyzer';

interface ConsoleLogStatisticsProps {
  entries: ConsoleLogEntry[];
  totalEntries?: number;   // actual total in backend (may be > entries.length)
  truncatedAt?: number;    // set when backend has more entries than loaded
  facets?: ConsoleLogFacets | null;
  label?: string;
}

const ConsoleLogStatistics: React.FC<ConsoleLogStatisticsProps> = ({
  entries,
  totalEntries,
  truncatedAt,
  facets,
  label,
}) => {
  const stats = ConsoleLogAnalyzer.getStatistics(entries);
  const isTruncated = truncatedAt !== undefined && (totalEntries ?? 0) > truncatedAt;
  const isFacetBacked = Boolean(facets);
  const totalForStats = totalEntries ?? stats.totalEntries;
  const levelCounts = facets?.levelCounts ?? stats.levelCounts;

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
          <strong style={{ color: '#f59e0b' }}>Large file</strong><br />
          Showing first <strong>{fmt(truncatedAt!)}</strong> of <strong>{fmt(totalEntries ?? 0)}</strong> entries.
          Use <strong>Filters</strong> or <strong>Search</strong> to narrow results.
        </div>
      )}

      <div className="filter-section">
        <h3>Statistics</h3>
        {label && <p className="console-stats-scope">{label}</p>}

        <div className="console-stats-total-card">
          <div className="console-stats-total-label">Total Entries</div>
          <div className="console-stats-total-value">{fmt(totalForStats)}</div>
        </div>

        <div className="console-stats-level-list">
          {Object.entries(levelCounts).map(([level, count]) => {
            if (count <= 0) return null;
            const percent = totalForStats > 0 ? (count / totalForStats) * 100 : 0;
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

      {facets && Object.keys(facets.issueTagCounts).length > 0 && (
        <div className="filter-section">
          <h3>Issue Tags</h3>
          <div className="console-stats-error-list">
            {Object.entries(facets.issueTagCounts).slice(0, 5).map(([tag, count]) => (
              <div key={tag} className="console-stats-error-card">
                <div className="console-stats-error-message">{tag}</div>
                <div className="console-stats-error-count">{fmt(count)} matching entries</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {facets && facets.topSources.length > 0 && (
        <div className="filter-section">
          <h3>Top Sources</h3>
          <div className="console-stats-error-list">
            {facets.topSources.slice(0, 5).map((source) => (
              <div key={source.source} className="console-stats-error-card">
                <div className="console-stats-error-message">{source.source}</div>
                <div className="console-stats-error-count">{fmt(source.count)} matching entries</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isFacetBacked && stats.topErrors.length > 0 && (
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

      {!isFacetBacked && stats.timeRange && (
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
