// src/components/UnifiedUploader.tsx
//
// Single drop zone that auto-detects whether a dropped file is a HAR file or a
// console log and routes it to the appropriate handler. Replaces the two
// separate uploaders on the initial home screen.

import React, { useCallback, useEffect, useState } from 'react';
import { chunkedUploader, UploadProgress, UploadResult } from '../services/chunkedUploader';
import { wsClient } from '../services/websocketClient';
import SanitizeModal from './SanitizeModal';
import BatchSanitizeModal from './BatchSanitizeModal';
import {
  AlertIcon,
  ChevronRightIcon,
  CloseIcon,
  FileTextIcon,
  RefreshIcon,
  UploadIcon,
} from './Icons';

interface RecentFile {
  name: string;
  timestamp: number;
  data: File;
}

interface UnifiedUploaderProps {
  /** Called for each successfully uploaded (and sanitized) HAR file */
  onHarFileUpload: (result: UploadResult) => void | Promise<void>;
  harRecentFiles?: RecentFile[];
  onClearHarRecent?: () => void;

  /** Called after a console log is uploaded; sourceFile is the original File object */
  onLogFileUpload: (result: UploadResult, sourceFile: File) => void | Promise<void>;
  logRecentFiles?: RecentFile[];
  onClearLogRecent?: () => void;
}

type DetectedType = 'har' | 'log';

interface TypedFile {
  file: File;
  type: DetectedType;
}

const UnifiedUploader: React.FC<UnifiedUploaderProps> = ({
  onHarFileUpload,
  harRecentFiles = [],
  onClearHarRecent,
  onLogFileUpload,
  logRecentFiles = [],
  onClearLogRecent,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isErrorVisible, setIsErrorVisible] = useState(false);

  // Processing states
  const [isDetecting, setIsDetecting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [multiTotal, setMultiTotal] = useState(0);
  const [multiDone, setMultiDone] = useState(0);

  // HAR sanitize modals
  const [pendingHarResult, setPendingHarResult] = useState<UploadResult | null>(null);
  const [showHarSanitizeModal, setShowHarSanitizeModal] = useState(false);
  const [pendingBatchResults, setPendingBatchResults] = useState<UploadResult[] | null>(null);

  useEffect(() => {
    if (error) {
      const t = window.setTimeout(() => setIsErrorVisible(true), 10);
      return () => window.clearTimeout(t);
    } else {
      setIsErrorVisible(false);
    }
  }, [error]);

  // ── File-type detection ───────────────────────────────────────────────────

  const detectFileType = async (file: File): Promise<DetectedType> => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.har')) return 'har';
    if (name.endsWith('.log') || name.endsWith('.txt')) return 'log';
    if (name.endsWith('.json') || file.type === 'application/json') {
      // Peek at the first 8 KB: HAR files have {"log":{"entries":[...]}}
      try {
        const snippet = await file.slice(0, 8192).text();
        if (/"log"\s*:\s*\{/.test(snippet) && /"entries"\s*:/.test(snippet)) return 'har';
      } catch {
        // ignore read errors, fall through to log
      }
      return 'log';
    }
    return 'log';
  };

  // ── Validation ────────────────────────────────────────────────────────────

  const validateHarFile = async (file: File): Promise<{ isValid: boolean; error?: string }> => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.log)
        return { isValid: false, error: `${file.name}: Missing "log" property` };
      if (!data.log.entries || !Array.isArray(data.log.entries))
        return { isValid: false, error: `${file.name}: Missing or invalid "entries" array` };
      if (data.log.entries.length === 0)
        return { isValid: false, error: `${file.name}: No network requests found` };
      const hasValidEntries = data.log.entries.some(
        (e: any) => e.request && e.response && e.startedDateTime
      );
      if (!hasValidEntries)
        return { isValid: false, error: `${file.name}: HAR entries are corrupted or incomplete` };
      return { isValid: true };
    } catch (err) {
      if (err instanceof SyntaxError)
        return { isValid: false, error: `${file.name}: Invalid JSON format` };
      return { isValid: false, error: `${file.name}: Failed to read file` };
    }
  };

  const validateLogFile = (file: File): { isValid: boolean; error?: string } => {
    if (file.size <= 0) return { isValid: false, error: `${file.name}: File is empty` };
    return { isValid: true };
  };

  // ── HAR processing ────────────────────────────────────────────────────────

  const processHarFiles = async (files: File[]) => {
    setIsValidating(true);
    setStatusMessage('Validating HAR file(s)...');

    const validFiles: File[] = [];
    const validationErrors: string[] = [];
    for (const file of files) {
      const v = await validateHarFile(file);
      if (v.isValid) {
        validFiles.push(file);
      } else {
        validationErrors.push(v.error ?? `${file.name}: Invalid HAR file`);
      }
    }
    setIsValidating(false);

    if (validFiles.length === 0) {
      setError(validationErrors.join(' · '));
      return;
    }
    if (validationErrors.length > 0) {
      // Non-blocking: warn but continue with valid files
      setError(`Skipped invalid file(s): ${validationErrors.join(', ')}`);
    }

    // Upload all valid HAR files, show per-file progress
    setIsUploading(true);
    setMultiTotal(validFiles.length);
    setMultiDone(0);

    const collectedResults: UploadResult[] = [];
    for (const file of validFiles) {
      setStatusMessage(`Uploading ${file.name}...`);
      try {
        const result = await chunkedUploader.uploadFile(file, 'har', (p) => setUploadProgress(p));
        collectedResults.push(result);
      } catch (err) {
        setError(`Failed to upload ${file.name}: ${(err as Error)?.message ?? 'Unknown error'}`);
      }
      setMultiDone((prev) => prev + 1);
    }

    setIsUploading(false);
    setUploadProgress(null);
    setMultiTotal(0);
    setMultiDone(0);
    setStatusMessage('');

    if (collectedResults.length === 0) {
      setError('All HAR uploads failed. Please try again.');
      return;
    }

    // Hand off to sanitize flow
    if (collectedResults.length === 1) {
      setPendingHarResult(collectedResults[0]);
      setShowHarSanitizeModal(true);
    } else {
      setPendingBatchResults(collectedResults);
    }
  };

  // ── Console log processing ────────────────────────────────────────────────

  const processLogFile = async (file: File) => {
    const v = validateLogFile(file);
    if (!v.isValid) {
      setError(v.error ?? 'Invalid log file');
      return;
    }

    setIsUploading(true);
    setStatusMessage(`Uploading ${file.name}...`);

    try {
      const result = await chunkedUploader.uploadFile(file, 'log', (p) => setUploadProgress(p));
      await onLogFileUpload(result, file);
    } catch (err) {
      setError((err as Error)?.message ?? 'Console log upload failed.');
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      setStatusMessage('');
    }
  };

  // ── Main entry: detect → group → process ─────────────────────────────────

  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);

    // 1. Detect types
    setIsDetecting(true);
    setStatusMessage('Detecting file type...');
    const typed: TypedFile[] = await Promise.all(
      files.map(async (f) => ({ file: f, type: await detectFileType(f) }))
    );
    setIsDetecting(false);
    setStatusMessage('');

    const harFiles = typed.filter((t) => t.type === 'har').map((t) => t.file);
    const logFiles = typed.filter((t) => t.type === 'log').map((t) => t.file);

    if (harFiles.length === 0 && logFiles.length === 0) {
      setError('Unsupported file type. Please upload a .har, .log, or .txt file.');
      return;
    }

    // 2. Process console log first (no blocking modal)
    if (logFiles.length > 0) {
      if (logFiles.length > 1) {
        setError(`Only one console log can be open at a time — opening "${logFiles[0].name}".`);
      }
      await processLogFile(logFiles[0]);
    }

    // 3. Process HAR files (may show sanitize modal)
    if (harFiles.length > 0) {
      await processHarFiles(harFiles);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onHarFileUpload, onLogFileUpload]);

  // ── Sanitize modal handlers ───────────────────────────────────────────────

  const handleSanitizeComplete = (fileId: string) => {
    setShowHarSanitizeModal(false);
    if (!pendingHarResult) return;
    wsClient.subscribeToFile(fileId);
    void onHarFileUpload({ ...pendingHarResult, fileId });
    setPendingHarResult(null);
  };

  const handleBatchSanitizeComplete = async (finalResults: UploadResult[]) => {
    setPendingBatchResults(null);
    for (const result of finalResults) {
      wsClient.subscribeToFile(result.fileId);
      await onHarFileUpload(result);
    }
  };

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) void processFiles(files);
    },
    [processFiles]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      if (files.length > 0) void processFiles(files);
    },
    [processFiles]
  );

  const handleDismiss = () => {
    setIsErrorVisible(false);
    window.setTimeout(() => setError(null), 300);
  };

  // ── Recent files (merged, sorted newest-first) ────────────────────────────

  const allRecentFiles = [
    ...harRecentFiles.map((f) => ({ ...f, fileType: 'har' as const })),
    ...logRecentFiles.map((f) => ({ ...f, fileType: 'log' as const })),
  ]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 6);

  const handleRecentFileClick = async (f: { data: File; fileType: DetectedType }) => {
    if (!(f.data instanceof File)) {
      setError('Recent file data is unavailable. Please upload the file again.');
      return;
    }
    await processFiles([f.data]);
  };

  const formatDate = (ts: number) => {
    const diffMins = Math.floor((Date.now() - ts) / 60_000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  const isBusy = isDetecting || isValidating || isUploading;

  const handleClearAll = () => {
    onClearHarRecent?.();
    onClearLogRecent?.();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="file-uploader unified-uploader">
      {/* Single-file HAR sanitize modal */}
      {showHarSanitizeModal && pendingHarResult && (
        <SanitizeModal
          uploadResult={pendingHarResult}
          onProceed={handleSanitizeComplete}
          onCancel={() => {
            setShowHarSanitizeModal(false);
            setPendingHarResult(null);
          }}
        />
      )}

      {/* Multi-file HAR batch sanitize modal */}
      {pendingBatchResults && (
        <BatchSanitizeModal
          uploadResults={pendingBatchResults}
          onProceed={handleBatchSanitizeComplete}
          onCancel={() => setPendingBatchResults(null)}
        />
      )}

      {/* Error banner */}
      {error && (
        <div
          className="error-banner"
          style={{
            position: 'fixed',
            top: '80px',
            left: '48%',
            transform: `translateX(-50%) translateY(${isErrorVisible ? '0' : '-20px'})`,
            zIndex: 1000,
            maxWidth: '560px',
            width: '90%',
            opacity: isErrorVisible ? 1 : 0,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            pointerEvents: isErrorVisible ? 'auto' : 'none',
          }}
        >
          <span className="uploader-inline-icon"><AlertIcon /></span>
          <span>{error}</span>
          <button className="btn-dismiss" onClick={handleDismiss} style={{ cursor: 'pointer' }}>
            <span className="uploader-inline-icon uploader-close-icon"><CloseIcon /></span>
          </button>
        </div>
      )}

      {/* ── Drop zone ── */}
      <div
        className={`drop-zone unified-drop-zone ${isDragging ? 'dragging' : ''} ${isBusy ? 'validating' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isUploading && uploadProgress ? (
          <div className="upload-progress-view">
            <div className="uploader-leading-icon is-active is-uploading" aria-hidden="true">
              <UploadIcon />
            </div>
            <h2>Uploading...</h2>
            <p className="upload-filename">{uploadProgress.fileName}</p>
            {multiTotal > 1 && (
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 8px' }}>
                File {multiDone + 1} of {multiTotal}
              </p>
            )}
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${uploadProgress.progress}%` }} />
              <div className="progress-glow" style={{ width: `${uploadProgress.progress}%` }} />
            </div>
            <p className="upload-stats">
              Chunk {uploadProgress.uploadedChunks} of {uploadProgress.totalChunks} &mdash;{' '}
              {Math.round(uploadProgress.progress)}%
            </p>
          </div>
        ) : isBusy ? (
          <>
            <div className="uploader-leading-icon is-active is-spinning" aria-hidden="true">
              <RefreshIcon />
            </div>
            <h2>{statusMessage || 'Processing...'}</h2>
            <p>Please wait</p>
          </>
        ) : (
          <>
            <div className="uploader-leading-icon" aria-hidden="true">
              <UploadIcon />
            </div>
            <h2>Drop any file to get started</h2>
            <p>The system automatically detects whether it's a HAR file or a console log</p>

            {/* Supported type pills */}
            <div className="unified-type-badges">
              <span className="unified-type-badge unified-badge-har">.har</span>
              <span className="unified-type-badge unified-badge-log">.log / .txt</span>
              <span className="unified-type-badge unified-badge-json">.json</span>
            </div>

            <input
              type="file"
              accept=".har,.log,.txt,.json,application/json,text/plain"
              onChange={handleFileInput}
              style={{ display: 'none' }}
              id="unified-file-input"
              multiple
            />
            <label htmlFor="unified-file-input" className="upload-button">
              Choose Files
            </label>
          </>
        )}
      </div>

      {/* ── Merged recent files ── */}
      {allRecentFiles.length > 0 && !isBusy && (
        <div className="recent-files-section">
          <div className="recent-files-header">
            <h3>Recent Files</h3>
            {(harRecentFiles.length > 0 || logRecentFiles.length > 0) && (
              <button className="btn-clear-all" onClick={handleClearAll}>
                Clear All
              </button>
            )}
          </div>
          <div className="recent-files-list">
            {allRecentFiles.map((file, idx) => (
              <button
                key={idx}
                className="recent-file-card"
                onClick={() => handleRecentFileClick(file)}
                disabled={isBusy}
              >
                <div className="recent-file-info">
                  <span className="recent-file-icon">
                    <FileTextIcon />
                  </span>
                  <div className="recent-file-details">
                    <span className="recent-file-name">{file.name}</span>
                    <span className="recent-file-time">{formatDate(file.timestamp)}</span>
                  </div>
                </div>
                <div className="unified-recent-right">
                  <span
                    className={`unified-type-pill ${
                      file.fileType === 'har' ? 'unified-pill-har' : 'unified-pill-log'
                    }`}
                  >
                    {file.fileType === 'har' ? 'HAR' : 'LOG'}
                  </span>
                  <span className="recent-file-arrow">
                    <ChevronRightIcon />
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Info grid ── */}
      <div className="unified-info-grid">
        <div className="info-section" style={{ marginTop: 0 }}>
          <h3>
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              width="13"
              height="13"
              style={{ marginRight: 6, verticalAlign: 'middle', opacity: 0.7 }}
            >
              <path d="M1 1h10l2 2v11H1z" />
              <path d="M11 1v3h3" />
            </svg>
            Generate a HAR file
          </h3>
          <ol>
            <li>Open Chrome DevTools (F12)</li>
            <li>Go to the <strong>Network</strong> tab</li>
            <li>Reload the page to capture activity</li>
            <li>Right-click → <em>Save all as HAR with content</em></li>
          </ol>
        </div>

        <div className="info-section" style={{ marginTop: 0 }}>
          <h3>
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              width="13"
              height="13"
              style={{ marginRight: 6, verticalAlign: 'middle', opacity: 0.7 }}
            >
              <polyline points="3 12 7 8 3 4" />
              <line x1="9" y1="14" x2="14" y2="14" />
            </svg>
            Capture console logs
          </h3>
          <ol>
            <li>Open Chrome DevTools (F12)</li>
            <li>Go to the <strong>Console</strong> tab</li>
            <li>Right-click in the console → <em>Save as...</em></li>
            <li>Or paste logs into a <code>.txt</code> / <code>.log</code> file</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default UnifiedUploader;
