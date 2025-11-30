// src/components/ConsoleLogStatistics.tsx

import React from 'react';
import { ConsoleLogEntry } from '../types/consolelog';
import { ConsoleLogAnalyzer } from '../utils/consoleLogAnalyzer';

interface ConsoleLogStatisticsProps {
  entries: ConsoleLogEntry[];
}

const ConsoleLogStatistics: React.FC<ConsoleLogStatisticsProps> = ({ entries }) => {
  const stats = ConsoleLogAnalyzer.getStatistics(entries);

  const levelColors: Record<string, string> = {
    error: '#ef4444',
    warn: '#f59e0b',
    info: '#3b82f6',
    log: '#6b7280',
    debug: '#8b5cf6',
    trace: '#ec4899',
    verbose: '#06b6d4',
  };

  return (
    <div className="filter-panel" style={{ marginTop: '16px' }}>
      <div className="filter-section">
        <h3>Statistics</h3>
        
        <div style={{ 
          background: 'var(--bg-secondary)', 
          padding: '16px', 
          borderRadius: '8px',
          marginBottom: '16px',
          textAlign: 'center'
        }}>
          <div style={{ 
            fontSize: '11px', 
            color: 'var(--text-tertiary)',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 600
          }}>
            Total Entries
          </div>
          <div style={{ 
            fontSize: '32px', 
            fontWeight: 700,
            color: 'var(--text-primary)'
          }}>
            {stats.totalEntries}
          </div>
        </div>

        {Object.entries(stats.levelCounts).map(([level, count]) => (
          count > 0 && (
            <div key={level} style={{ 
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '8px',
              fontSize: '13px'
            }}>
              <span 
                className="level-badge"
                style={{ 
                  backgroundColor: levelColors[level],
                  fontSize: '9px',
                  padding: '2px 8px'
                }}
              >
                {level.toUpperCase()}
              </span>
              <span style={{ flex: 1, color: 'var(--text-secondary)' }}>
                {count}
              </span>
              <div style={{ 
                flex: 2,
                height: '6px',
                background: 'var(--bg-tertiary)',
                borderRadius: '3px',
                overflow: 'hidden'
              }}>
                <div 
                  style={{ 
                    width: `${(count / stats.totalEntries) * 100}%`,
                    height: '100%',
                    background: levelColors[level]
                  }}
                />
              </div>
            </div>
          )
        ))}
      </div>

      {stats.topErrors.length > 0 && (
        <div className="filter-section">
          <h3>Top Errors</h3>
          {stats.topErrors.slice(0, 5).map((error, index) => (
            <div key={index} style={{ 
              marginBottom: '12px',
              padding: '10px',
              background: 'var(--bg-secondary)',
              borderRadius: '6px',
              fontSize: '12px'
            }}>
              <div style={{ 
                fontFamily: '"SF Mono", "Monaco", monospace',
                marginBottom: '4px',
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {error.message}
              </div>
              <div style={{ 
                color: 'var(--error)',
                fontWeight: 600,
                fontSize: '11px'
              }}>
                {error.count}× occurrences
              </div>
            </div>
          ))}
        </div>
      )}

      {stats.timeRange && (
        <div className="filter-section">
          <h3>Time Range</h3>
          <div style={{ 
            background: 'var(--bg-secondary)',
            padding: '12px',
            borderRadius: '6px',
            fontSize: '12px',
            lineHeight: '1.6'
          }}>
            <div style={{ marginBottom: '6px' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Start:</strong>{' '}
              <span style={{ color: 'var(--text-secondary)' }}>
                {new Date(stats.timeRange.start).toLocaleString()}
              </span>
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>End:</strong>{' '}
              <span style={{ color: 'var(--text-secondary)' }}>
                {new Date(stats.timeRange.end).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConsoleLogStatistics;
