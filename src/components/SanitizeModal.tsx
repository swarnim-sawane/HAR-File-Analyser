// src/components/SanitizeModal.tsx
import React, { useState, useEffect } from 'react';
import { defaultScrubItems } from '../utils/har_sanitize';
import type { UploadResult } from '../services/chunkedUploader';
import type { ScrubType, ScrubState } from './HarSanitizer';
import { CloseIcon } from './Icons';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:4000';

interface SanitizeModalProps {
  uploadResult: UploadResult;
  onProceed: (fileId: string) => void;
  onCancel: () => void;
}

const typeLabels: Record<ScrubType, string> = {
  cookies: 'Cookies',
  headers: 'Headers',
  queryArgs: 'Query Parameters',
  postParams: 'POST Body Params',
  mimeTypes: 'MIME Types (response bodies)',
};

const SanitizeModal: React.FC<SanitizeModalProps> = ({ uploadResult, onProceed, onCancel }) => {
  const [mode, setMode] = useState<'choice' | 'custom'>('choice');
  const [scrubItems, setScrubItems] = useState<ScrubState>({
    cookies: {}, headers: {}, queryArgs: {}, postParams: {}, mimeTypes: {}
  });
  const [detectedCount, setDetectedCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isScanning, setIsScanning] = useState(true);

  useEffect(() => {
    setIsScanning(true);
    fetch(`${API_BASE_URL}/api/sanitize/${uploadResult.fileId}/scan`)
      .then(r => r.json())
      .then(data => {
        let count = 0;
        const state: ScrubState = { cookies: {}, headers: {}, queryArgs: {}, postParams: {}, mimeTypes: {} };
        (Object.entries(data.info) as [ScrubType, string[]][]).forEach(([type, items]) => {
          items.forEach(item => {
            const isDefault = defaultScrubItems.includes(item);
            state[type][item] = isDefault;
            if (isDefault) count++;
          });
        });
        setScrubItems(state);
        setDetectedCount(count);
      })
      .catch(err => console.error('Scan failed:', err))
      .finally(() => setIsScanning(false));
  }, [uploadResult.fileId]);

  const handleSkip = () => onProceed(uploadResult.fileId);

  const handleAutoRedact = async () => {
    setIsProcessing(true);
    try {
      const resp = await fetch(`${API_BASE_URL}/api/sanitize/${uploadResult.fileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'auto' }),
      });
      const data = await resp.json();
      onProceed(data.fileId);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCustomApply = async () => {
    setIsProcessing(true);
    const words: string[] = [];
    const mimeTypes: string[] = [];
    (Object.entries(scrubItems) as [ScrubType, Record<string, boolean>][]).forEach(([type, items]) => {
      Object.entries(items).forEach(([key, checked]) => {
        if (!checked) return;
        if (type === 'mimeTypes') mimeTypes.push(key);
        else words.push(key);
      });
    });
    try {
      const resp = await fetch(`${API_BASE_URL}/api/sanitize/${uploadResult.fileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'custom', scrubWords: words, scrubMimetypes: mimeTypes }),
      });
      const data = await resp.json();
      onProceed(data.fileId);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleItem = (type: ScrubType, key: string, val: boolean) => {
    setScrubItems(prev => ({ ...prev, [type]: { ...prev[type], [key]: val } }));
  };

  const toggleAll = (type: ScrubType, val: boolean) => {
    setScrubItems(prev => ({
      ...prev,
      [type]: Object.fromEntries(Object.keys(prev[type]).map(k => [k, val]))
    }));
  };

  return (
    <div className="sanitize-modal-overlay">
      <div className="sanitize-modal">

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
              Found <strong>{detectedCount} potentially sensitive items</strong> in{' '}
              <code>{uploadResult.fileName}</code> — tokens, cookies, auth headers, and more.
            </p>
          </div>
        </div>

        {isScanning ? (
          <div className="sanitize-scanning">
            <div className="sanitize-spinner" />
            <p>Scanning for sensitive data...</p>
          </div>
        ) : mode === 'choice' ? (
          <>
            <div className="sanitize-modal-body">
              <p className="sanitize-note">
                Your file stays <strong>100% local</strong>.
                You can optionally redact sensitive values before analysis.
              </p>

              {/* What will be redacted preview */}
              <div className="detected-summary">
                {(Object.entries(scrubItems) as [ScrubType, Record<string, boolean>][]).map(([type, items]) => {
                  const flagged = Object.entries(items).filter(([, v]) => v).map(([k]) => k);
                  if (!flagged.length) return null;
                  return (
                    <div key={type} className="detected-group">
                      <span className="detected-type">{typeLabels[type]}:</span>
                      <div className="detected-tags">
                        {flagged.map(item => (
                          <span key={item} className="detected-tag">{item}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="sanitize-modal-actions">
              <button className="btn-skip" onClick={handleSkip}>
                Skip — Analyze as-is
              </button>
              <button className="btn-custom" onClick={() => setMode('custom')}>
                Custom Redaction
              </button>
              <button className="btn-auto-redact" onClick={handleAutoRedact} disabled={isProcessing}>
                {isProcessing ? 'Redacting...' : 'Auto Redact & Analyze'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Custom mode */}
            <div className="sanitize-modal-body custom-mode">
              <p>Select exactly what to redact:</p>
              {(Object.entries(scrubItems) as [ScrubType, Record<string, boolean>][]).map(([type, items]) => {
                const keys = Object.keys(items);
                if (!keys.length) return null;
                const allChecked = Object.values(items).every(Boolean);
                return (
                  <div key={type} className="custom-section">
                    <div className="custom-section-header">
                      <strong>{typeLabels[type]}</strong>
                      <label>
                        <input type="checkbox" checked={allChecked}
                          onChange={e => toggleAll(type, e.target.checked)} />
                        {' '}All
                      </label>
                    </div>
                    <div className="custom-items">
                      {keys.map(key => (
                        <label key={key} className={`custom-item ${defaultScrubItems.includes(key) ? 'is-sensitive' : ''}`}>
                          <input type="checkbox" checked={items[key]}
                            onChange={e => toggleItem(type, key, e.target.checked)} />
                          <span>{key}</span>
                          {defaultScrubItems.includes(key) && <span className="sensitive-badge">sensitive</span>}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="sanitize-modal-actions">
              <button className="btn-skip" onClick={() => setMode('choice')}>← Back</button>
              <button className="btn-skip" onClick={handleSkip}>Skip — Analyze as-is</button>
              <button className="btn-auto-redact" onClick={handleCustomApply} disabled={isProcessing}>
                {isProcessing ? 'Applying...' : 'Apply & Analyze'}
              </button>
            </div>
          </>
        )}

        <button className="sanitize-modal-close" onClick={onCancel}><CloseIcon /></button>
      </div>
    </div>
  );
};

export default SanitizeModal;
