// src/components/WaterfallChart.tsx
import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Entry } from '../types/har';
import { HarAnalyzer } from '../utils/harAnalyzer';

interface WaterfallChartProps {
  entries: Entry[];
  selectedEntry: Entry | null;
  onSelectEntry: (entry: Entry) => void;
  timingType: 'relative' | 'independent';
}

interface WaterfallRow {
  entry: Entry;
  startTime: number;
  totalTime: number;
  timings: {
    blocked: number;
    dns: number;
    connect: number;
    ssl: number;
    send: number;
    wait: number;
    receive: number;
  };
}

const WaterfallChart: React.FC<WaterfallChartProps> = ({
  entries,
  selectedEntry,
  onSelectEntry,
  timingType,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const waterfallData = useMemo((): {
    rows: WaterfallRow[];
    maxTime: number;
    minTime: number;
    totalDuration: number;
  } => {
    if (entries.length === 0) {
      return { rows: [], maxTime: 0, minTime: 0, totalDuration: 0 };
    }

    const startTimes = entries.map(entry => new Date(entry.startedDateTime).getTime());
    const minTime = Math.min(...startTimes);
    const maxTime = Math.max(
      ...entries.map((entry, index) => startTimes[index] + entry.time)
    );
    const totalDuration = maxTime - minTime;

    const rows: WaterfallRow[] = entries.map((entry, index) => {
      const startTime = startTimes[index];
      const relativeStart = startTime - minTime;
      const timings = HarAnalyzer.getTimingBreakdown(entry);

      return {
        entry,
        startTime: relativeStart,
        totalTime: entry.time,
        timings,
      };
    });

    return { rows, maxTime, minTime, totalDuration };
  }, [entries]);

  const formatTime = (ms: number): string => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname + urlObj.search;
      return path.length > 50 ? path.substring(0, 50) + '...' : path;
    } catch {
      return url.length > 50 ? url.substring(0, 50) + '...' : url;
    }
  };

  const getStatusClass = (status: number): string => {
    if (status >= 200 && status < 300) return 'status-success';
    if (status >= 300 && status < 400) return 'status-redirect';
    if (status >= 400 && status < 500) return 'status-client-error';
    if (status >= 500) return 'status-server-error';
    return 'status-default';
  };

  const chartWidth = containerWidth - 400; // Reserve space for labels

  if (waterfallData.rows.length === 0) {
    return (
      <div className="waterfall-chart empty">
        <p>No requests to display</p>
      </div>
    );
  }

  return (
    <div className="waterfall-chart" ref={containerRef}>
      <div className="waterfall-header">
        <div className="waterfall-labels">
          <span className="label-status">Status</span>
          <span className="label-method">Method</span>
          <span className="label-url">URL</span>
          <span className="label-size">Size</span>
        </div>
        <div className="waterfall-timeline">
          <div className="timeline-markers">
            {[0, 0.25, 0.5, 0.75, 1].map(fraction => (
              <div
                key={fraction}
                className="timeline-marker"
                style={{ left: `${fraction * 100}%` }}
              >
                <span>{formatTime(waterfallData.totalDuration * fraction)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="waterfall-body">
        {waterfallData.rows.map((row, index) => {
          const isSelected = selectedEntry === row.entry;
          const startPosition =
            timingType === 'relative'
              ? (row.startTime / waterfallData.totalDuration) * 100
              : 0;
          const width = (row.totalTime / waterfallData.totalDuration) * 100;

          return (
            <div
              key={index}
              className={`waterfall-row ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelectEntry(row.entry)}
            >
              <div className="waterfall-labels">
                <span
                  className={`request-status ${getStatusClass(
                    row.entry.response.status
                  )}`}
                >
                  {row.entry.response.status}
                </span>
                <span className="request-method">{row.entry.request.method}</span>
                <span className="request-url" title={row.entry.request.url}>
                  {formatUrl(row.entry.request.url)}
                </span>
                <span className="request-size">
                  {(row.entry.response.bodySize / 1024).toFixed(1)}KB
                </span>
              </div>

              <div className="waterfall-bars">
                <div
                  className="waterfall-bar-container"
                  style={{
                    marginLeft: `${startPosition}%`,
                    width: `${Math.max(width, 0.5)}%`,
                  }}
                >
                  {Object.entries(row.timings).map(([phase, time]) => {
                    if (time <= 0) return null;
                    const percentage = (time / row.totalTime) * 100;
                    return (
                      <div
                        key={phase}
                        className={`timing-segment timing-${phase}`}
                        style={{ width: `${percentage}%` }}
                        title={`${phase}: ${formatTime(time)}`}
                      />
                    );
                  })}
                  <div className="bar-label">{formatTime(row.totalTime)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WaterfallChart;
