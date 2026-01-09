// src/components/HarSanitizer.tsx
import React, { useState, useCallback, useEffect } from 'react';
import { 
  sanitize, 
  getHarInfo, 
  PossibleScrubItems, 
  defaultScrubItems,
  SanitizeOptions 
} from '../utils/har_sanitize';

export type ScrubState = Record<ScrubType, Record<string, boolean>>;
export type ScrubType = 'cookies' | 'headers' | 'queryArgs' | 'postParams' | 'mimeTypes';

const defaultScrubState: ScrubState = {
  cookies: {},
  headers: {},
  queryArgs: {},
  postParams: {},
  mimeTypes: {},
};

const typeMap: Record<ScrubType, string> = {
  cookies: 'Cookies',
  mimeTypes: 'MIME Types',
  headers: 'Headers',
  postParams: 'POST Body Params',
  queryArgs: 'Query String Parameters',
};

const HarSanitizer: React.FC = () => {
  const [originalHar, setOriginalHar] = useState<string>('');
  const [sanitizedHar, setSanitizedHar] = useState<string>('');
  const [scrubItems, setScrubItems] = useState<ScrubState>(defaultScrubState);
  const [fileName, setFileName] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string>('');

  function getScrubableItems(input: string): ScrubState {
    const rawItems = getHarInfo(input);
    const output = { ...defaultScrubState };

    Object.entries(rawItems).forEach(([key, items]: [string, string[]]) => {
      output[key as ScrubType] = items.reduce(
        (acc, curr) => {
          if (!curr) return acc;
          acc[curr] = defaultScrubItems.includes(curr);
          return acc;
        },
        {} as Record<string, boolean>
      );
    });

    return output;
  }

  const sanitizeHar = useCallback((input: string, scrubState: ScrubState): string => {
    const words = new Set<string>();
    
    Object.entries(scrubState.cookies).forEach(([key, val]) => {
      if (val) words.add(key);
    });
    Object.entries(scrubState.headers).forEach(([key, val]) => {
      if (val) words.add(key);
    });
    Object.entries(scrubState.queryArgs).forEach(([key, val]) => {
      if (val) words.add(key);
    });
    Object.entries(scrubState.postParams).forEach(([key, val]) => {
      if (val) words.add(key);
    });

    const mimeTypes = new Set<string>();
    Object.entries(scrubState.mimeTypes).forEach(([key, val]) => {
      if (val) mimeTypes.add(key);
    });

    const options: SanitizeOptions = {
      scrubWords: [...words],
      scrubMimetypes: [...mimeTypes],
    };

    return sanitize(input, options);
  }, []);

  useEffect(() => {
    if (originalHar) {
      try {
        const scrubState = getScrubableItems(originalHar);
        setScrubItems(scrubState);
        const sanitized = sanitizeHar(originalHar, scrubState);
        setSanitizedHar(sanitized);
      } catch (err) {
        console.error('Failed to process HAR:', err);
      }
    }
  }, [originalHar, sanitizeHar]);

  const handleFileUpload = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      JSON.parse(text); // Validate JSON
      setOriginalHar(text);
      setFileName(file.name);
      setError('');
    } catch (err) {
      setError('Failed to parse HAR file. Please upload a valid HAR file.');
      console.error(err);
    }
  }, []);

  const handleScrubItemChange = useCallback((
    type: ScrubType,
    item: string,
    checked: boolean
  ) => {
    setScrubItems(prev => {
      const newState = {
        ...prev,
        [type]: {
          ...prev[type],
          [item]: checked,
        },
      };
      
      if (originalHar) {
        const sanitized = sanitizeHar(originalHar, newState);
        setSanitizedHar(sanitized);
      }
      
      return newState;
    });
  }, [originalHar, sanitizeHar]);

  const handleSelectAll = useCallback((type: ScrubType, checked: boolean) => {
    setScrubItems(prev => {
      const newState = {
        ...prev,
        [type]: Object.keys(prev[type]).reduce((acc, key) => {
          acc[key] = checked;
          return acc;
        }, {} as Record<string, boolean>),
      };
      
      if (originalHar) {
        const sanitized = sanitizeHar(originalHar, newState);
        setSanitizedHar(sanitized);
      }
      
      return newState;
    });
  }, [originalHar, sanitizeHar]);

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
      handleFileUpload(harFile);
    }
  }, [handleFileUpload]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  }, [handleFileUpload]);

  const handleDownload = () => {
    if (!sanitizedHar) return;

    try {
      JSON.parse(sanitizedHar); // Validate before download
      const blob = new Blob([sanitizedHar], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `redacted_${fileName}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to generate sanitized HAR. The file may be corrupted.');
    }
  };

  const handleClear = () => {
    setOriginalHar('');
    setSanitizedHar('');
    setFileName('');
    setScrubItems(defaultScrubState);
    setError('');
  };

  const getOriginalCount = () => {
    try {
      return JSON.parse(originalHar).log.entries.length;
    } catch {
      return 0;
    }
  };

  const getSanitizedCount = () => {
    try {
      return JSON.parse(sanitizedHar).log.entries.length;
    } catch {
      return 0;
    }
  };

  return (
    <div className="har-sanitizer">
      <div className="sanitizer-header">
        <div>
          <h2>HAR Sanitizer</h2>
          <p className="sanitizer-description">
            Remove sensitive data from HAR files before sharing. Based on{' '}
            <a 
              href="https://github.com/cloudflare/har-sanitizer" 
              target="_blank" 
              rel="noopener noreferrer"
              className="sanitizer-link"
            >
              Cloudflare's HAR Sanitizer
            </a>
          </p>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
          <button onClick={() => setError('')} className="btn-dismiss-error">✕</button>
        </div>
      )}

      {!originalHar ? (
        <div className="sanitizer-upload">
          <div
            className={`drop-zone ${isDragging ? 'dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="upload-icon">🔒</div>
            <h3>Upload HAR File to Sanitize</h3>
            <p>Your file is processed locally - nothing is sent to a server</p>
            <input
              type="file"
              accept=".har,application/json"
              onChange={handleFileInput}
              style={{ display: 'none' }}
              id="sanitizer-file-input"
            />
            <label htmlFor="sanitizer-file-input" className="upload-button">
              Choose HAR File
            </label>
          </div>

          <div className="sanitizer-info">
            <h4>Why sanitize HAR files?</h4>
            <ul>
              <li>HAR files contain complete HTTP request/response data</li>
              <li>May include sensitive information like tokens, cookies, and passwords</li>
              <li>Should be cleaned before sharing with support teams or online</li>
              <li>Uses Cloudflare's proven sanitization logic with regex-based scrubbing</li>
              <li>Automatically redacts JWT signatures and sensitive parameters</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="sanitizer-content">
          <div className="sanitizer-controls">
            <div className="current-file-info">
              <span className="file-icon">📄</span>
              <span className="file-name">{fileName}</span>
              <button className="btn-clear-file" onClick={handleClear}>
                ✕ Clear
              </button>
            </div>

            <div className="sanitizer-options">
              <h3>Select Items to Sanitize</h3>
              <p className="options-help">Choose which elements to remove from your HAR file</p>

              {(Object.entries(scrubItems) as [ScrubType, Record<string, boolean>][]).map(
                ([type, items], index) => {
                  const itemKeys = Object.keys(items);
                  if (itemKeys.length === 0) return null;

                  const allChecked = Object.values(items).every(v => v);
                  const someChecked = Object.values(items).some(v => v);

                  return (
                    <div key={type} className="scrub-type-section">
                      {index > 0 && <div className="section-divider" />}
                      
                      <div className="scrub-type-header">
                        <h4>{typeMap[type]}</h4>
                        <label className="select-all-label">
                          <input
                            type="checkbox"
                            checked={allChecked}
                            ref={(el) => {
                              if (el) el.indeterminate = someChecked && !allChecked;
                            }}
                            onChange={(e) => handleSelectAll(type, e.target.checked)}
                          />
                          <span>Select All</span>
                        </label>
                      </div>

                      <div className="scrub-items">
                        {Object.entries(items).map(([item, checked]) => (
                          <label key={item} className="scrub-item-label">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => handleScrubItemChange(type, item, e.target.checked)}
                            />
                            <span className="item-name">{item}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </div>

          <div className="sanitizer-preview">
            <div className="preview-header">
              <h3>Sanitized Preview</h3>
              <button className="btn-download" onClick={handleDownload}>
                ⬇ Download Sanitized HAR
              </button>
            </div>

            <div className="preview-stats">
              <div className="stat">
                <span className="stat-label">Original Entries:</span>
                <span className="stat-value">{getOriginalCount()}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Sanitized Entries:</span>
                <span className="stat-value">{getSanitizedCount()}</span>
              </div>
            </div>

            <div className="preview-content">
              <pre>{sanitizedHar.substring(0, 5000)}...</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HarSanitizer;
