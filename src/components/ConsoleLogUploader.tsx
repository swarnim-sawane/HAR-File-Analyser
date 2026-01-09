// src/components/ConsoleLogUploader.tsx

import React, { useCallback, useState } from 'react';

interface RecentFile {
  name: string;
  timestamp: number;
  data: File;
}

interface ConsoleLogUploaderProps {
  onFileUpload: (file: File) => void;
  recentFiles?: RecentFile[];
  onClearRecent?: () => void;
}

const ConsoleLogUploader: React.FC<ConsoleLogUploaderProps> = ({
  onFileUpload,
  recentFiles = [],
  onClearRecent
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const logFile = files.find(file =>
      file.name.endsWith('.log') || 
      file.name.endsWith('.txt') || 
      file.name.endsWith('.json') ||
      file.type === 'text/plain' ||
      file.type === 'application/json'
    );

    if (logFile) {
      onFileUpload(logFile);
    } else {
      alert('Please upload a valid log file (.log, .txt, or .json)');
    }
  }, [onFileUpload]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileUpload(file);
    }
  }, [onFileUpload]);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div className="file-uploader">
      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="upload-icon">📋</div>
        <h2>Upload Console Log File</h2>
        <p>Drag and drop your log file here</p>
        <p className="supported-formats">Supports: .log, .txt, .json</p>
        <label className="upload-button">
          <input
            type="file"
            accept=".log,.txt,.json,text/plain,application/json"
            onChange={handleFileInput}
            style={{ display: 'none' }}
          />
          Choose File
        </label>
      </div>

      {recentFiles.length > 0 && (
        <div className="recent-files-section">
          <div className="recent-files-header">
            <h3>Recent Files</h3>
            {onClearRecent && (
              <button onClick={onClearRecent} className="btn-clear-all">
                Clear All
              </button>
            )}
          </div>
          <div className="recent-files-list">
            {recentFiles.map((file, index) => (
              <button
                key={index}
                className="recent-file-card"
                onClick={() => onFileUpload(file.data)}
              >
                <div className="recent-file-info">
                  <span className="recent-file-icon">📄</span>
                  <div className="recent-file-details">
                    <div className="recent-file-name">{file.name}</div>
                    <div className="recent-file-time">{formatDate(file.timestamp)}</div>
                  </div>
                </div>
                <span className="recent-file-arrow">→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="info-section">
        <h3>How to capture console logs</h3>
        <ol>
          <li>Open Chrome DevTools (F12)</li>
          <li>Go to the Console tab</li>
          <li>Right-click in the console and select "Save as..."</li>
          <li>Or copy logs and paste into a .txt or .log file</li>
        </ol>
      </div>
    </div>
  );
};

export default ConsoleLogUploader;
