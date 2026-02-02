// src/components/FileUploader.tsx
import React, { useCallback, useState, useEffect } from 'react';

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

interface ValidationResult {
  isValid: boolean;
  error?: string;
}

const FileUploader: React.FC<FileUploaderProps> = ({
  onFileUpload,
  recentFiles = [],
  onClearRecent
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isErrorVisible, setIsErrorVisible] = useState(false);

  // Trigger fade-in animation when error appears
  useEffect(() => {
    if (error) {
      // Small delay to trigger CSS animation
      setTimeout(() => setIsErrorVisible(true), 10);
    } else {
      setIsErrorVisible(false);
    }
  }, [error]);

  const validateHarFile = async (file: File): Promise<ValidationResult> => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.log) {
        return {
          isValid: false,
          error: 'Invalid HAR file: Missing "log" property'
        };
      }

      if (!data.log.entries || !Array.isArray(data.log.entries)) {
        return {
          isValid: false,
          error: 'Invalid HAR file: Missing or invalid "entries" array'
        };
      }

      if (data.log.entries.length === 0) {
        return {
          isValid: false,
          error: 'HAR file contains no network requests. Please record some network activity and try again.'
        };
      }

      const hasValidEntries = data.log.entries.some((entry: any) => {
        return entry.request && entry.response && entry.startedDateTime;
      });

      if (!hasValidEntries) {
        return {
          isValid: false,
          error: 'HAR file entries are corrupted or incomplete. Please re-record the HAR file.'
        };
      }

      if (!data.log.version) {
        console.warn('HAR file missing version information');
      }

      return { isValid: true };
    } catch (err) {
      if (err instanceof SyntaxError) {
        return {
          isValid: false,
          error: 'Invalid JSON format. Please ensure the file is a valid HAR file.'
        };
      }
      return {
        isValid: false,
        error: 'Failed to read file. Please try again.'
      };
    }
  };

  const processFile = async (file: File) => {
    setError(null);
    setIsValidating(true);

    try {
      const validation = await validateHarFile(file);

      if (!validation.isValid) {
        setError(validation.error || 'Invalid HAR file');
        setIsValidating(false);
        return;
      }

      onFileUpload(file);
      setIsValidating(false);
    } catch (err) {
      setError('An unexpected error occurred while processing the file.');
      setIsValidating(false);
    }
  };

  const handleDismiss = () => {
    setIsErrorVisible(false);
    // Wait for fade-out animation to complete before removing error
    setTimeout(() => setError(null), 300);
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
    const harFile = files.find(file =>
      file.name.endsWith('.har') || file.type === 'application/json'
    );

    if (harFile) {
      processFile(harFile);
    } else {
      setError('Please upload a valid .har file');
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
      {/* Error Banner - Fixed Position with Smooth Animation */}
      {error && (
        <div
          className="error-banner"
          style={{
            position: 'fixed',
            top: '80px',
            left: '48%',
            transform: `translateX(-50%) translateY(${isErrorVisible ? '0' : '-20px'})`,
            zIndex: 1000,
            maxWidth: '550px',
            width: '90%',
            opacity: isErrorVisible ? 1 : 0,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            pointerEvents: isErrorVisible ? 'auto' : 'none'
          }}
        >
          <span className="error-icon">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="icon icon-tabler icons-tabler-outline icon-tabler-file-alert"
            >
              <path stroke="none" d="M0 0h24v24H0z" fill="none" />
              <path d="M14 3v4a1 1 0 0 0 1 1h4" />
              <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2" />
              <path d="M12 17l.01 0" />
              <path d="M12 11l0 3" />
            </svg>
          </span>

          <span>{error}</span>
          <button
            className="btn-dismiss"
            onClick={handleDismiss}
            style={{
              transition: 'opacity 0.2s ease',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.7'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            ✕
          </button>
        </div>
      )}

      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''} ${isValidating ? 'validating' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="upload-icon">
          {isValidating ? <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon icon-tabler icons-tabler-outline icon-tabler-hourglass-empty"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6 20v-2a6 6 0 1 1 12 0v2a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1" /><path d="M6 4v2a6 6 0 1 0 12 0v-2a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1" /></svg> : '📁'}
        </div>
        <h2>{isValidating ? 'Validating HAR File...' : 'Upload HAR File'}</h2>
        <p>
          {isValidating
            ? 'Please wait while we validate your file'
            : 'Drag and drop your .har file here'}
        </p>
        {!isValidating && (
          <>
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
          </>
        )}
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
                onClick={() => handleRecentFileClick(file.data)}
                disabled={isValidating}
              >
                <div className="recent-file-info">
                  <span className="recent-file-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="icon icon-tabler icons-tabler-filled icon-tabler-file"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 2l.117 .007a1 1 0 0 1 .876 .876l.007 .117v4l.005 .15a2 2 0 0 0 1.838 1.844l.157 .006h4l.117 .007a1 1 0 0 1 .876 .876l.007 .117v9a3 3 0 0 1 -2.824 2.995l-.176 .005h-10a3 3 0 0 1 -2.995 -2.824l-.005 -.176v-14a3 3 0 0 1 2.824 -2.995l.176 -.005h5z" /><path d="M19 7h-4l-.001 -4.001z" /></svg></span>
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
        <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          <strong><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon icon-tabler icons-tabler-outline icon-tabler-bulb"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7" /><path d="M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3" /><path d="M9.7 17l4.6 0" /></svg> Tip:</strong> Make sure to record some network activity before saving the HAR file. Empty HAR files will be rejected.
        </div>
      </div>
    </div>
  );
};

export default FileUploader;
