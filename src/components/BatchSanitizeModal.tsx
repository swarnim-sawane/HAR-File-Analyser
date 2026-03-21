// src/components/BatchSanitizeModal.tsx
// Shown when the user uploads multiple HAR files at once.
// Scans all files in parallel, presents a single choice:
//   • Auto Redact All  — applies default redaction to every file
//   • Skip — opens all files as-is (no sensitive data removal)
// Replacing N separate SanitizeModals with one unified decision.

import React, { useEffect, useState } from 'react';
import type { UploadResult } from '../services/chunkedUploader';
import { defaultScrubItems } from '../utils/har_sanitize';
import { CloseIcon } from './Icons';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:4000';

interface FileScanResult {
  result: UploadResult;
  sensitiveCount: number;
  scanned: boolean;
  error: boolean;
}

export interface BatchSanitizeModalProps {
  uploadResults: UploadResult[];
  /** Called with the final fileIds (may differ from original if sanitization was applied) */
  onProceed: (finalResults: UploadResult[]) => void;
  onCancel: () => void;
}

const BatchSanitizeModal: React.FC<BatchSanitizeModalProps> = ({
  uploadResults,
  onProceed,
  onCancel,
}) => {
  const [fileScans, setFileScans] = useState<FileScanResult[]>(
    uploadResults.map(r => ({ result: r, sensitiveCount: 0, scanned: false, error: false }))
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');

  // Scan all files in parallel as soon as the modal opens
  useEffect(() => {
    const scanAll = async () => {
      const promises = uploadResults.map(async (r, idx) => {
        try {
          const res = await fetch(`${API_BASE_URL}/api/sanitize/${r.fileId}/scan`);
          const data = await res.json();

          // Count detected sensitive items using the same default-items logic as SanitizeModal
          let count = 0;
          if (data.info) {
            Object.values(data.info as Record<string, string[]>).forEach(items => {
              items.forEach(item => {
                if (defaultScrubItems.includes(item)) count++;
              });
            });
          }
          setFileScans(prev => prev.map((s, i) =>
            i === idx ? { ...s, sensitiveCount: count, scanned: true } : s
          ));
        } catch {
          setFileScans(prev => prev.map((s, i) =>
            i === idx ? { ...s, scanned: true, error: true } : s
          ));
        }
      });
      await Promise.all(promises);
    };

    scanAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalSensitive = fileScans.reduce((acc, s) => acc + s.sensitiveCount, 0);
  const allScanned = fileScans.every(s => s.scanned);
  const filesWithSensitiveData = fileScans.filter(s => s.sensitiveCount > 0).length;

  const handleAutoRedactAll = async () => {
    setIsProcessing(true);
    const finalResults: UploadResult[] = [];

    for (let i = 0; i < fileScans.length; i++) {
      const scan = fileScans[i];
      setProcessingStatus(`Redacting ${i + 1} of ${fileScans.length}: ${scan.result.fileName}`);
      try {
        if (scan.sensitiveCount > 0) {
          const resp = await fetch(`${API_BASE_URL}/api/sanitize/${scan.result.fileId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'auto' }),
          });
          const data = await resp.json();
          finalResults.push({ ...scan.result, fileId: data.fileId });
        } else {
          // No sensitive data — open as-is
          finalResults.push(scan.result);
        }
      } catch {
        // If redaction fails for one file, fall back to original
        finalResults.push(scan.result);
      }
    }

    setIsProcessing(false);
    onProceed(finalResults);
  };

  const handleSkipAll = () => {
    onProceed(uploadResults);
  };

  return (
    <div className="sanitize-modal-overlay">
      <div className="sanitize-modal" style={{ maxWidth: '520px' }}>

        {/* Header */}
        <div className="sanitize-modal-header">
          <div className="sanitize-modal-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <div>
            <h2>Sensitive Data Detected</h2>
            <p>
              Scanning <strong>{uploadResults.length} HAR files</strong> for tokens, cookies, and auth headers.
            </p>
          </div>
        </div>

        {/* File scan list */}
        <div className="sanitize-modal-body" style={{ padding: '0 24px 8px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflowY: 'auto' }}>
            {fileScans.map((scan, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'var(--bg-secondary, #f9fafb)',
                fontSize: '13px',
              }}>
                {/* Scan status indicator */}
                {!scan.scanned ? (
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#d1d5db', flexShrink: 0 }} />
                ) : scan.sensitiveCount > 0 ? (
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
                )}

                {/* Filename */}
                <span style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--text-primary, #111827)',
                }}>
                  {scan.result.fileName}
                </span>

                {/* Result badge */}
                {!scan.scanned ? (
                  <span style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '11px' }}>Scanning…</span>
                ) : scan.error ? (
                  <span style={{ color: '#ef4444', fontSize: '11px' }}>Scan failed</span>
                ) : scan.sensitiveCount > 0 ? (
                  <span style={{
                    background: 'rgba(245, 158, 11, 0.12)',
                    color: '#92400e',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    borderRadius: '4px',
                    padding: '2px 7px',
                    fontSize: '11px',
                    flexShrink: 0,
                  }}>
                    {scan.sensitiveCount} sensitive items
                  </span>
                ) : (
                  <span style={{
                    background: 'rgba(16, 185, 129, 0.1)',
                    color: '#065f46',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    borderRadius: '4px',
                    padding: '2px 7px',
                    fontSize: '11px',
                    flexShrink: 0,
                  }}>
                    Clean
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Summary */}
          {allScanned && (
            <div style={{
              marginTop: '14px',
              padding: '10px 14px',
              borderRadius: '8px',
              background: totalSensitive > 0
                ? 'rgba(245, 158, 11, 0.08)'
                : 'rgba(16, 185, 129, 0.08)',
              border: `1px solid ${totalSensitive > 0 ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.25)'}`,
              fontSize: '13px',
              color: 'var(--text-secondary, #6b7280)',
              lineHeight: '1.5',
            }}>
              {totalSensitive > 0 ? (
                <>
                  <strong style={{ color: '#92400e' }}>
                    {totalSensitive} sensitive items found
                  </strong>{' '}
                  across {filesWithSensitiveData} of {uploadResults.length} files.
                  {' '}Auto Redact will strip tokens, cookies, and auth headers from all flagged files.
                </>
              ) : (
                <>
                  <strong style={{ color: '#065f46' }}>No sensitive data detected</strong>{' '}
                  in any of the {uploadResults.length} files.
                </>
              )}
            </div>
          )}

          {/* Processing status */}
          {isProcessing && (
            <div style={{
              marginTop: '10px',
              fontSize: '12px',
              color: 'var(--text-secondary, #6b7280)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <div className="sanitize-spinner" style={{ width: '14px', height: '14px' }} />
              {processingStatus}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="sanitize-modal-actions">
          <button
            className="btn-skip"
            onClick={handleSkipAll}
            disabled={isProcessing || !allScanned}
          >
            Skip — Open all as-is
          </button>
          <button
            className="btn-auto-redact"
            onClick={handleAutoRedactAll}
            disabled={isProcessing || !allScanned || totalSensitive === 0}
            title={totalSensitive === 0 ? 'No sensitive data detected' : undefined}
          >
            {isProcessing ? 'Redacting…' : `Auto Redact All (${filesWithSensitiveData} file${filesWithSensitiveData !== 1 ? 's' : ''})`}
          </button>
        </div>

        <button className="sanitize-modal-close" onClick={onCancel} disabled={isProcessing}>
          <CloseIcon />
        </button>
      </div>
    </div>
  );
};

export default BatchSanitizeModal;
