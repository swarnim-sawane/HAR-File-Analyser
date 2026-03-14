import React, { useCallback, useState, useEffect } from 'react';
import { chunkedUploader, UploadProgress, UploadResult } from '../services/chunkedUploader';
import { wsClient } from '../services/websocketClient';

interface RecentFile {
  name: string;
  timestamp: number;
  data: File;
}

interface ConsoleLogUploaderProps {
  onFileUpload: (result: UploadResult) => void; // ✅ NEW: UploadResult instead of File
  recentFiles?: RecentFile[];
  onClearRecent?: () => void;
}

const ConsoleLogUploader: React.FC<ConsoleLogUploaderProps> = ({
  onFileUpload,
  recentFiles = [],
  onClearRecent
}) => {
  const [isDragging, setIsDragging] = useState(false);
  
  // ✅ NEW: Upload states
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ✅ NEW: Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // ✅ NEW: Process file with chunked upload
  const processFile = async (file: File) => {
    setError(null);
    setUploadProgress(null);

    // Validate file type
    const validExtensions = ['.log', '.txt', '.json'];
    const hasValidExtension = validExtensions.some(ext => file.name.endsWith(ext));
    const validTypes = ['text/plain', 'application/json'];
    const hasValidType = validTypes.includes(file.type);

    if (!hasValidExtension && !hasValidType) {
      setError('Please upload a valid log file (.log, .txt, or .json)');
      return;
    }

    // Validate file size (max 1GB)
    const maxSize = 1024 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('File size exceeds 1GB limit');
      return;
    }

    setIsUploading(true);

    try {
      // Upload file in chunks
      const result = await chunkedUploader.uploadFile(
        file,
        'log',
        (progress) => {
          setUploadProgress(progress);
        }
      );

      console.log('Log upload complete:', result);

      // Subscribe to file processing updates
      wsClient.subscribeToFile(result.fileId);

      // Notify parent component
      onFileUpload(result);

      // Reset states
      setIsUploading(false);
      setUploadProgress(null);

    } catch (err) {
      setError((err as Error).message || 'Upload failed. Please try again.');
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

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
      processFile(logFile);
    } else {
      setError('Please upload a valid log file (.log, .txt, or .json)');
    }
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  }, []);

  const handleRecentFileClick = async (file: File) => {
    await processFile(file);
  };

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
      {/* ✅ NEW: Error notification (no inline styles) */}
      {error && (
        <div className="upload-error-notification">
          <span className="error-icon">⚠️</span>
          <span className="error-message">{error}</span>
          <button className="btn-dismiss" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* ✅ RESTORED: Original drop zone structure */}
      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''} ${isUploading ? 'uploading' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isUploading && uploadProgress ? (
          // ✅ NEW: Upload progress view
          <div className="upload-progress-view">
            <div className="upload-spinner">
              <svg className="spinner-icon" width="48" height="48" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.25"/>
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
              </svg>
            </div>
            <h2>Uploading...</h2>
            <p className="upload-filename">{uploadProgress.fileName}</p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${uploadProgress.progress}%` }}></div>
            </div>
            <p className="upload-stats">
              Chunk {uploadProgress.uploadedChunks} of {uploadProgress.totalChunks} • {Math.round(uploadProgress.progress)}%
            </p>
          </div>
        ) : (
          // ✅ RESTORED: Original upload UI
          <>
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
                disabled={isUploading}
              />
              Choose File
            </label>
          </>
        )}
      </div>

      {/* ✅ RESTORED: Recent files section (with disabled state during upload) */}
      {recentFiles.length > 0 && !isUploading && (
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
                onClick={() => handleRecentFileClick(file.data)}
                disabled={isUploading}
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

      {/* ✅ RESTORED: Info section */}
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
