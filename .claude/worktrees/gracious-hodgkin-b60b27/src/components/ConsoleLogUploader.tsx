import React, { useCallback, useEffect, useState } from 'react';
import { chunkedUploader, UploadProgress, UploadResult } from '../services/chunkedUploader';
import { restoreRecentFile } from '../services/recentFilesStore';
import {
  AlertIcon,
  ChevronRightIcon,
  CloseIcon,
  ConsoleIcon,
  FileTextIcon,
  RefreshIcon,
  UploadIcon,
} from './Icons';

interface RecentFile {
  name: string;
  timestamp: number;
  data: File;
}

interface ConsoleLogUploaderProps {
  onFileUpload: (result: UploadResult, sourceFile?: File) => void | Promise<void>;
  recentFiles?: RecentFile[];
  onClearRecent?: () => void;
}

const ConsoleLogUploader: React.FC<ConsoleLogUploaderProps> = ({
  onFileUpload,
  recentFiles = [],
  onClearRecent,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isErrorVisible, setIsErrorVisible] = useState(false);

  useEffect(() => {
    if (!error) {
      setIsErrorVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setIsErrorVisible(true), 10);
    return () => window.clearTimeout(timer);
  }, [error]);

  const isSupportedLogFile = useCallback((file: File) =>
    file.name.endsWith('.log') ||
    file.name.endsWith('.txt') ||
    file.name.endsWith('.json') ||
    file.type === 'text/plain' ||
    file.type === 'application/json', []);

  const validateLogFile = useCallback(async (file: File): Promise<{ isValid: boolean; error?: string }> => {
    if (!isSupportedLogFile(file)) {
      return { isValid: false, error: 'Please upload a valid log file (.log, .txt, or .json)' };
    }
    if (file.size <= 0) {
      return { isValid: false, error: 'The selected file is empty. Please choose a valid log file.' };
    }
    return { isValid: true };
  }, [isSupportedLogFile]);

  const processFile = useCallback(async (file: File) => {
    setError(null);
    setIsValidating(true);

    try {
      const validation = await validateLogFile(file);
      if (!validation.isValid) {
        setError(validation.error || 'Invalid log file');
        return;
      }

      setIsValidating(false);
      setIsUploading(true);

      const result = await chunkedUploader.uploadFile(file, 'log', (progress) => {
        setUploadProgress(progress);
      });

      setIsUploading(false);
      setUploadProgress(null);
      await onFileUpload(result, file);
    } catch (err) {
      setError((err as Error)?.message || 'Log upload failed.');
      setIsUploading(false);
      setUploadProgress(null);
    } finally {
      setIsValidating(false);
    }
  }, [onFileUpload, validateLogFile]);

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
    const logFile = files.find(isSupportedLogFile);

    if (logFile) {
      processFile(logFile);
    } else {
      setError('Please upload a valid log file (.log, .txt, or .json)');
    }
  }, [isSupportedLogFile, processFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  }, [processFile]);

  const handleDismiss = () => {
    setIsErrorVisible(false);
    window.setTimeout(() => setError(null), 300);
  };

  const handleRecentFileClick = async (file: RecentFile) => {
    // In-session: file.data is the real File object.
    // After a page refresh: file.data is undefined (localStorage only stores name/
    // timestamp), so we fall back to IndexedDB where we persisted the content.
    let resolvedFile: File | null =
      file.data instanceof File && file.data.size > 0 ? file.data : null;

    if (!resolvedFile) {
      resolvedFile = await restoreRecentFile('log', file.name);
    }

    if (!resolvedFile) {
      setError(`"${file.name}" is no longer available in this browser. Please upload the file again.`);
      return;
    }

    void processFile(resolvedFile);
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
      {error && (
        <div
          className="upload-error-banner"
          style={{
            opacity: isErrorVisible ? 1 : 0,
            transform: `translateY(${isErrorVisible ? '0' : '-8px'})`,
            transition: 'opacity 0.2s ease, transform 0.2s ease',
          }}
        >
          <span className="uploader-inline-icon error-icon">
            <AlertIcon />
          </span>
          <span className="error-message">{error}</span>
          <button className="btn-dismiss" onClick={handleDismiss} aria-label="Dismiss error">
            <span className="uploader-inline-icon uploader-close-icon">
              <CloseIcon />
            </span>
          </button>
        </div>
      )}

      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''} ${isValidating || isUploading ? 'validating' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isUploading && uploadProgress ? (
          <div className="upload-progress-view">
            <div className="uploader-leading-icon is-active is-uploading" aria-hidden="true">
              <UploadIcon />
            </div>
            <h2>Uploading Console Log...</h2>
            <p className="upload-filename">{uploadProgress.fileName}</p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${uploadProgress.progress}%` }} />
              <div className="progress-glow" style={{ width: `${uploadProgress.progress}%` }} />
            </div>
            <p className="upload-stats">
              Chunk {uploadProgress.uploadedChunks} of {uploadProgress.totalChunks} - {Math.round(uploadProgress.progress)}%
            </p>
          </div>
        ) : (
          <>
            <div className={`uploader-leading-icon ${isValidating ? 'is-active is-spinning' : ''}`} aria-hidden="true">
              {isValidating ? <RefreshIcon /> : <ConsoleIcon />}
            </div>
            <h2>{isValidating ? 'Validating Console Log...' : 'Upload Console Log File'}</h2>
            <p>{isValidating ? 'Please wait while we validate your file' : 'Drag and drop your log file here'}</p>
            <p className="supported-formats">Supports: .log, .txt, .json</p>
            {!isValidating && !isUploading && (
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
            )}
          </>
        )}
      </div>

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
                onClick={() => handleRecentFileClick(file)}
                disabled={isValidating || isUploading}
              >
                <div className="recent-file-info">
                  <span className="recent-file-icon">
                    <FileTextIcon />
                  </span>
                  <div className="recent-file-details">
                    <div className="recent-file-name">{file.name}</div>
                    <div className="recent-file-time">{formatDate(file.timestamp)}</div>
                  </div>
                </div>
                <span className="recent-file-arrow">
                  <ChevronRightIcon />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="info-section">
        <h3>How to capture console logs</h3>
        <ol>
          <li>Open Chrome DevTools (F12)</li>
          <li>Go to the <strong>Console</strong> tab</li>
          <li>Right-click in the console and select &ldquo;Save as&hellip;&rdquo;</li>
          <li>Or copy logs and paste into a .txt or .log file</li>
        </ol>
      </div>
    </div>
  );
};

export default ConsoleLogUploader;
