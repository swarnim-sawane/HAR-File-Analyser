import React, { useCallback, useEffect, useState } from 'react';
import { chunkedUploader, UploadProgress, UploadResult } from '../services/chunkedUploader';
import { wsClient } from '../services/websocketClient';
import {
  AlertIcon,
  ChevronRightIcon,
  CloseIcon,
  FileTextIcon,
  InfoIcon,
  RefreshIcon,
  UploadIcon,
} from './Icons';

interface RecentFile {
  name: string;
  timestamp: number;
  data: File;
}

interface FileUploaderProps {
  onFileUpload: (result: UploadResult) => void | Promise<void>;
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
  onClearRecent,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isErrorVisible, setIsErrorVisible] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  useEffect(() => {
    if (error) {
      setTimeout(() => setIsErrorVisible(true), 10);
    } else {
      setIsErrorVisible(false);
    }
  }, [error]);

  const validateHarFile = async (file: File): Promise<ValidationResult> => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.log) return { isValid: false, error: 'Invalid HAR file: Missing "log" property' };
      if (!data.log.entries || !Array.isArray(data.log.entries)) return { isValid: false, error: 'Invalid HAR file: Missing or invalid "entries" array' };
      if (data.log.entries.length === 0) return { isValid: false, error: 'HAR file contains no network requests. Please record some network activity and try again.' };
      const hasValidEntries = data.log.entries.some((entry: any) => entry.request && entry.response && entry.startedDateTime);
      if (!hasValidEntries) return { isValid: false, error: 'HAR file entries are corrupted or incomplete. Please re-record the HAR file.' };
      if (!data.log.version) console.warn('HAR file missing version information');
      return { isValid: true };
    } catch (err) {
      if (err instanceof SyntaxError) return { isValid: false, error: 'Invalid JSON format. Please ensure the file is a valid HAR file.' };
      return { isValid: false, error: 'Failed to read file. Please try again.' };
    }
  };

  const processFile = async (file: File) => {
    setError(null);
    setIsValidating(true);
    setUploadProgress(null);

    try {
      const validation = await validateHarFile(file);
      if (!validation.isValid) {
        setError(validation.error || 'Invalid HAR file');
        setIsValidating(false);
        return;
      }

      setIsValidating(false);
      setIsUploading(true);

      const result = await chunkedUploader.uploadFile(file, 'har', (progress) => {
        setUploadProgress(progress);
      });

      wsClient.subscribeToFile(result.fileId);
      await onFileUpload(result);

      setIsUploading(false);
      setUploadProgress(null);
    } catch (err) {
      setError((err as Error).message || 'Upload failed. Please try again.');
      setIsValidating(false);
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  const handleDismiss = () => {
    setIsErrorVisible(false);
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
    const harFile = Array.from(e.dataTransfer.files).find((f) => f.name.endsWith('.har') || f.type === 'application/json');
    if (harFile) processFile(harFile);
    else setError('Please upload a valid .har file');
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, []);

  const handleRecentFileClick = async (file: File) => {
    await processFile(file);
  };

  const formatDate = (timestamp: number) => {
    const diffMins = Math.floor((Date.now() - timestamp) / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  return (
    <div className="file-uploader">
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
            pointerEvents: isErrorVisible ? 'auto' : 'none',
          }}
        >
          <span className="uploader-inline-icon">
            <AlertIcon />
          </span>
          <span>{error}</span>
          <button
            className="btn-dismiss"
            onClick={handleDismiss}
            style={{ transition: 'opacity 0.2s ease', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.7';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
          >
            <span className="uploader-inline-icon uploader-close-icon">
              <CloseIcon />
            </span>
          </button>
        </div>
      )}

      <div className={`drop-zone ${isDragging ? 'dragging' : ''} ${isValidating || isUploading ? 'validating' : ''}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        {isUploading && uploadProgress ? (
          <div className="upload-progress-view">
            <div className="uploader-leading-icon is-active is-uploading" aria-hidden="true">
              <UploadIcon />
            </div>
            <h2>Uploading...</h2>
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
              {isValidating ? (
                <RefreshIcon />
              ) : (
                <UploadIcon />
              )}
            </div>
            <h2>{isValidating ? 'Validating HAR File...' : 'Upload HAR File'}</h2>
            <p>{isValidating ? 'Please wait while we validate your file' : 'Drag and drop your .har file here'}</p>
            {!isValidating && !isUploading && (
              <>
                <input type="file" accept=".har,application/json" onChange={handleFileInput} style={{ display: 'none' }} id="file-input" disabled={isUploading} />
                <label htmlFor="file-input" className="upload-button">Choose File</label>
              </>
            )}
          </>
        )}
      </div>

      {recentFiles.length > 0 && !isUploading && (
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
              <button key={index} className="recent-file-card" onClick={() => handleRecentFileClick(file.data)} disabled={isValidating || isUploading}>
                <div className="recent-file-info">
                  <span className="recent-file-icon">
                    <FileTextIcon />
                  </span>
                  <div className="recent-file-details">
                    <span className="recent-file-name">{file.name}</span>
                    <span className="recent-file-time">{formatDate(file.timestamp)}</span>
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
        <h3>How to generate a HAR file</h3>
        <ol>
          <li>Open Chrome DevTools (F12)</li>
          <li>Go to the Network tab</li>
          <li>Reload the page to capture network activity</li>
          <li>Right-click and select "Save all as HAR with content"</li>
        </ol>
        <div className="uploader-tip-box">
          <span className="uploader-tip-icon">
            <InfoIcon />
          </span>
          <div>
            <strong>Tip:</strong> Make sure to record some network activity before saving the HAR file. Empty HAR files will be rejected.
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileUploader;
