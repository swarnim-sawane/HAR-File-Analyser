// src/components/FileUploader.tsx
import React, { useCallback, useState } from 'react';

interface RecentFile {
  name: string;
  timestamp: number;
  data: File;
}

interface FileUploaderProps {
  onFileUpload: (file: File) => void;
  recentFiles?: RecentFile[];
  onClearRecent?: () => void;
}

const FileUploader: React.FC<FileUploaderProps> = ({ 
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
    const harFile = files.find(file => 
      file.name.endsWith('.har') || file.type === 'application/json'
    );

    if (harFile) {
      onFileUpload(harFile);
    } else {
      alert('Please upload a valid .har file');
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
        <div className="upload-icon">
          📁
        </div>
        <h2>Upload HAR File</h2>
        <p>Drag and drop your .har file here</p>
        <input
          type="file"
          accept=".har,application/json"
          onChange={handleFileInput}
          style={{ display: 'none' }}
          id="file-input"
        />
        <label htmlFor="file-input" className="upload-button">
          Choose File
        </label>
      </div>

      {recentFiles.length > 0 && (
        <div className="recent-files-section">
          <div className="recent-files-header">
            <h3>Recent Files</h3>
            {onClearRecent && (
              <button className="btn-clear-all" onClick={onClearRecent}>
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
                    <span className="recent-file-name">{file.name}</span>
                    <span className="recent-file-time">{formatDate(file.timestamp)}</span>
                  </div>
                </div>
                <span className="recent-file-arrow">→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="info-section">
        <h3>How to generate a HAR file</h3>
        <ol>
          <li>Open Chrome DevTools (F12)</li>
          <li>Go to the Network tab</li>
          <li>Reload the page to capture network activity</li>
          <li>Right-click and select "Save all as HAR with content"</li>
        </ol>
      </div>
    </div>
  );
};

export default FileUploader;
