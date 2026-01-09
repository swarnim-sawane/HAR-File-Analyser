// src/components/Timeline.tsx
import React, { useMemo } from 'react';
import { Entry } from '../types/har';

interface TimelineProps {
  entries: Entry[];
  selectedEntry: Entry | null;
  timingType: 'relative' | 'independent';
}

const Timeline: React.FC<TimelineProps> = ({ entries, selectedEntry, timingType }) => {
  const timelineData = useMemo(() => {
    if (entries.length === 0) return null;

    const startTimes = entries.map(entry => new Date(entry.startedDateTime).getTime());
    const minTime = Math.min(...startTimes);
    const maxTime = Math.max(...entries.map((entry, index) => 
      startTimes[index] + entry.time
    ));
    const totalDuration = maxTime - minTime;

    return entries.map((entry, index) => {
      const startTime = startTimes[index];
      const relativeStart = startTime - minTime;
      const position = (relativeStart / totalDuration) * 100;
      const width = (entry.time / totalDuration) * 100;

      return {
        entry,
        position,
        width,
        startTime: relativeStart,
      };
    });
  }, [entries]);

  if (!timelineData || timelineData.length === 0) {
    return null;
  }

  return (
    <div className="timeline-container">
      <h3>Request Timeline</h3>
      <div className="timeline">
        <div className="timeline-track">
          {timelineData.map(({ entry, position, width }, index) => (
            <div
              key={index}
              className={`timeline-bar ${selectedEntry === entry ? 'selected' : ''}`}
              style={{
                left: `${position}%`,
                width: `${Math.max(width, 0.5)}%`,
              }}
              title={`${entry.request.url} - ${entry.time.toFixed(2)}ms`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Timeline;
