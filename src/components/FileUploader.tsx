import React, { useCallback, useEffect, useState } from 'react';
import { chunkedUploader, UploadProgress, UploadResult } from '../services/chunkedUploader';
import { restoreRecentFile, storeRecentFile } from '../services/recentFilesStore';
import { wsClient } from '../services/websocketClient';
import { HAR_FILE_INPUT_ACCEPT, isHarFileCandidate } from '../utils/uploadFileTypes';
import SanitizeModal from './SanitizeModal';
import BatchSanitizeModal from './BatchSanitizeModal';
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
  /** Allow selecting/dropping multiple HAR capture files at once (each creates its own tab) */
  multiple?: boolean;
}

interface ValidationResult {
  isValid: boolean;
  error?: string;
}

const FileUploader: React.FC<FileUploaderProps> = ({
  onFileUpload,
  recentFiles = [],
  onClearRecent,
  multiple = false,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isErrorVisible, setIsErrorVisible] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [pendingUploadResult, setPendingUploadResult] = useState<UploadResult | null>(null);
  const [showSanitizeModal, setShowSanitizeModal] = useState(false);
  // Multi-file batch upload state
  const [multiTotal, setMultiTotal] = useState(0);
  const [multiDone, setMultiDone] = useState(0);
  // Holds uploaded results waiting for the BatchSanitizeModal decision
  const [pendingBatchResults, setPendingBatchResults] = useState<UploadResult[] | null>(null);

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

  const processFile = async (file: File, skipSanitizeModal = false) => {
    setError(null);
    setIsValidating(true);

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

      // Persist file content to IndexedDB so it can be reopened from Recent Files
      // after a page refresh (the parent only receives UploadResult, not the File).
      void storeRecentFile('har', file);

      setIsUploading(false);
      setUploadProgress(null);

      if (skipSanitizeModal) {
        // Multi-file batch: skip the sanitize prompt, open directly
        wsClient.subscribeToFile(result.fileId);
        await onFileUpload(result);
      } else {
        setPendingUploadResult(result);
        setShowSanitizeModal(true);
      }
    } catch (err) {
      setError((err as Error).message || 'Upload failed.');
      setIsValidating(false);
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  /**
   * Upload all files first (showing progress), then show BatchSanitizeModal
   * for a single sanitization decision before opening any tabs.
   */
  const processMultipleFiles = async (files: File[]) => {
    const harFiles = files.filter(isHarFileCandidate);
    if (harFiles.length === 0) {
      setError('No valid HAR capture files found in your selection');
      return;
    }

    // Validate all files first — collect errors but don't stop the whole batch
    setIsValidating(true);
    const validFiles: File[] = [];
    for (const file of harFiles) {
      const v = await validateHarFile(file);
      if (v.isValid) {
        validFiles.push(file);
      } else {
        console.warn(`Skipping invalid HAR: ${file.name} — ${v.error}`);
      }
    }
    setIsValidating(false);

    if (validFiles.length === 0) {
      setError('None of the selected files are valid HAR files');
      return;
    }

    // Upload all valid files sequentially, showing per-file progress
    setMultiTotal(validFiles.length);
    setMultiDone(0);
    setIsUploading(true);

    const collectedResults: UploadResult[] = [];

    for (const file of validFiles) {
      try {
        const result = await chunkedUploader.uploadFile(file, 'har', (progress) => {
          setUploadProgress(progress);
        });
        collectedResults.push(result);
      } catch (err) {
        console.error(`Failed to upload ${file.name}:`, err);
        setError(`Failed to upload ${file.name}. Other files are still being processed.`);
      }
      setMultiDone(prev => prev + 1);
    }

    setIsUploading(false);
    setUploadProgress(null);
    setMultiTotal(0);
    setMultiDone(0);

    if (collectedResults.length === 0) {
      setError('All uploads failed. Please try again.');
      return;
    }

    // Show the batch sanitize modal — user makes ONE decision for all files
    setPendingBatchResults(collectedResults);
  };

  const handleSanitizeComplete = (fileId: string) => {
    setShowSanitizeModal(false);
    wsClient.subscribeToFile(fileId);
    onFileUpload({ ...pendingUploadResult!, fileId });
    setPendingUploadResult(null);
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
    const allFiles = Array.from(e.dataTransfer.files);
    const harFiles = allFiles.filter(isHarFileCandidate);
    if (harFiles.length === 0) {
      setError('Please upload a valid HAR capture file');
      return;
    }
    if (harFiles.length === 1) {
      processFile(harFiles[0]);
    } else {
      processMultipleFiles(harFiles);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (files.length === 1) {
      processFile(files[0]);
    } else {
      processMultipleFiles(files);
    }
    // Reset input so the same files can be re-selected if needed
    e.target.value = '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRecentFileClick = async (recentFile: RecentFile) => {
    // In-session: recentFile.data is the real File.
    // After a page refresh: recentFile.data is undefined (localStorage only
    // persists name/timestamp), so fall back to IndexedDB content.
    let file: File | null =
      recentFile.data instanceof File && recentFile.data.size > 0
        ? recentFile.data
        : null;

    if (!file) {
      file = await restoreRecentFile('har', recentFile.name);
    }

    if (!file) {
      setError(`"${recentFile.name}" is no longer available in this browser. Please upload the file again.`);
      return;
    }

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

  /** Called when the BatchSanitizeModal resolves with final (possibly-redacted) file IDs */
  const handleBatchSanitizeComplete = async (finalResults: UploadResult[]) => {
    setPendingBatchResults(null);
    for (const result of finalResults) {
      wsClient.subscribeToFile(result.fileId);
      await onFileUpload(result);
    }
  };

  return (
    <div className="file-uploader">
      {/* Single-file sanitize modal */}
      {showSanitizeModal && pendingUploadResult && (
        <SanitizeModal
          uploadResult={pendingUploadResult}
          onProceed={handleSanitizeComplete}
          onCancel={() => { setShowSanitizeModal(false); setPendingUploadResult(null); }}
        />
      )}

      {/* Multi-file batch sanitize modal */}
      {pendingBatchResults && (
        <BatchSanitizeModal
          uploadResults={pendingBatchResults}
          onProceed={handleBatchSanitizeComplete}
          onCancel={() => setPendingBatchResults(null)}
        />
      )}

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
            <p>
              {isValidating
                ? 'Please wait while we validate your file'
                : multiple
                  ? 'Drag and drop one or more HAR capture files here'
                  : 'Drag and drop your HAR capture file here'}
            </p>
            {multiTotal > 0 && (
              <p style={{ fontSize: '13px', color: 'var(--text-secondary, #888)', marginTop: '4px' }}>
                Opening file {multiDone + 1} of {multiTotal}…
              </p>
            )}
            {!isValidating && !isUploading && (
              <>
                <input
                  type="file"
                  accept={HAR_FILE_INPUT_ACCEPT}
                  onChange={handleFileInput}
                  style={{ display: 'none' }}
                  id="file-input"
                  disabled={isUploading}
                  multiple={multiple}
                />
                <label htmlFor="file-input" className="upload-button">
                  {multiple ? 'Choose Files' : 'Choose File'}
                </label>
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
              <button key={index} className="recent-file-card" onClick={() => handleRecentFileClick(file)} disabled={isValidating || isUploading}>
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
