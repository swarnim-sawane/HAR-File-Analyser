// src/components/PerformanceMetrics.tsx
import React from 'react';

interface PerformanceMetricsProps {
  metrics: {
    totalRequests: number;
    totalSize: number;
    totalTime: number;
    avgTime: number;
    statusCounts: Record<number, number>;
  };
}

const PerformanceMetrics: React.FC<PerformanceMetricsProps> = ({ metrics }) => {
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatTime = (ms: number): string => {
    if (ms < 1000) return `${ms.toFixed(0)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  return (
    <div className="performance-metrics">
      <h3>Performance Overview</h3>
      
      <div className="metric-card">
        <div className="metric-label">Total Requests</div>
        <div className="metric-value">{metrics.totalRequests}</div>
      </div>

      <div className="metric-card">
        <div className="metric-label">Total Size</div>
        <div className="metric-value">{formatSize(metrics.totalSize)}</div>
      </div>

      <div className="metric-card">
        <div className="metric-label">Total Time</div>
        <div className="metric-value">{formatTime(metrics.totalTime)}</div>
      </div>

      <div className="metric-card">
        <div className="metric-label">Average Time</div>
        <div className="metric-value">{formatTime(metrics.avgTime)}</div>
      </div>

      <div className="status-breakdown">
        <h4>Status Codes</h4>
        {Object.entries(metrics.statusCounts).map(([status, count]) => (
          <div key={status} className="status-row">
            <span className={`status-indicator status-${status}`}>{status}xx</span>
            <span className="status-count">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PerformanceMetrics;
