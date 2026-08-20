import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  UploadIcon,
} from './Icons';
import type { ConsoleLogEntry, ConsoleLogFile, LogLevel } from '../types/consolelog';
import { apiClient } from '../services/apiClient';
import { ConsoleLogParser } from '../utils/consoleLogParser';
import { buildConsoleLogCompare } from '../utils/consoleLogCompare';
import { getConsoleDisplayLevel } from '../utils/consoleLogSeverity';

export interface OpenLogTab {
  fileId: string | null;
  fileName: string;
  localData?: ConsoleLogFile | null;
}

const LOG_FILE_ACCEPT = '.log,.txt,.out,.json,application/json,text/plain';
const BACKEND_COMPARE_ROW_LIMIT = 1000;

function countDeltaSign(delta: number): string {
  if (delta === 0) return '0';
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function deltaTone(delta: number, lowerIsBetter = true): string {
  if (delta === 0) return 'var(--text-secondary)';
  const worse = lowerIsBetter ? delta > 0 : delta < 0;
  return worse ? '#dc2626' : '#059669';
}

function shortText(text: string, limit = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}...` : normalized;
}

function normalizeBackendLog(
  fileName: string,
  entries: ConsoleLogFile['entries'],
  totalEntries: number,
): ConsoleLogFile {
  return {
    metadata: {
      fileName,
      uploadedAt: new Date().toISOString(),
      totalEntries,
      truncatedAt: totalEntries > entries.length ? entries.length : undefined,
    },
    entries,
  };
}

interface LogCompareFileCardProps {
  side: 'A' | 'B';
  title: string;
  fileName: string | null;
  loading: boolean;
  progress: number;
  error: string | null;
  entryCount: number | null;
  openTabs: OpenLogTab[];
  onFile: (file: File) => void;
  onSelectOpenTab: (tab: OpenLogTab) => void;
}

const LogCompareFileCard: React.FC<LogCompareFileCardProps> = ({
  side,
  title,
  fileName,
  loading,
  progress,
  error,
  entryCount,
  openTabs,
  onFile,
  onSelectOpenTab,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <section className={`log-compare-file-card log-compare-file-card--${side.toLowerCase()}`}>
      <input
        ref={inputRef}
        type="file"
        accept={LOG_FILE_ACCEPT}
        style={{ display: 'none' }}
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />

      <div className="log-compare-file-card-head">
        <span className="cmp-file-badge">{side}</span>
        <div>
          <span className="cmp-file-role">{title}</span>
          <strong title={fileName ?? undefined}>{fileName ?? 'Choose console log'}</strong>
        </div>
        <span className={`cmp-file-state${fileName ? ' is-ready' : ''}${loading ? ' is-loading' : ''}`}>
          {loading ? `${Math.max(1, Math.round(progress))}%` : fileName ? 'Ready' : 'Missing'}
        </span>
      </div>

      <button
        type="button"
        className="log-compare-drop"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
      >
        <span className="log-compare-drop-icon">
          {loading ? <ClockIcon /> : fileName ? <CheckIcon /> : <UploadIcon />}
        </span>
        <span>
          <strong>{loading ? 'Loading console log' : fileName ? 'Replace log' : 'Upload log file'}</strong>
          <small>
            {entryCount !== null
              ? `${entryCount} parsed entries`
              : 'Supports browser console, Catalina, access, and generic logs'}
          </small>
        </span>
      </button>

      {openTabs.length > 0 && (
        <label className="log-compare-open-select">
          <span>Select from open logs</span>
          <select
            value=""
            onChange={event => {
              const selected = openTabs[Number(event.target.value)];
              if (selected) onSelectOpenTab(selected);
            }}
          >
            <option value="" disabled>Choose an open log</option>
            {openTabs.map((tab, index) => (
              <option key={`${tab.fileId ?? 'local'}-${tab.fileName}-${index}`} value={index}>
                {tab.fileName}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <div className="log-compare-error"><AlertIcon />{error}</div>}
    </section>
  );
};

interface ConsoleLogCompareProps {
  openTabs?: OpenLogTab[];
}

interface ConsoleLogCompareSnapshot {
  logA: ConsoleLogFile | null;
  logB: ConsoleLogFile | null;
  nameA: string | null;
  nameB: string | null;
}

let consoleLogCompareSnapshot: ConsoleLogCompareSnapshot = {
  logA: null,
  logB: null,
  nameA: null,
  nameB: null,
};

const ConsoleLogCompare: React.FC<ConsoleLogCompareProps> = ({ openTabs = [] }) => {
  const [logA, setLogA] = useState<ConsoleLogFile | null>(consoleLogCompareSnapshot.logA);
  const [logB, setLogB] = useState<ConsoleLogFile | null>(consoleLogCompareSnapshot.logB);
  const [nameA, setNameA] = useState<string | null>(consoleLogCompareSnapshot.nameA);
  const [nameB, setNameB] = useState<string | null>(consoleLogCompareSnapshot.nameB);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [progressA, setProgressA] = useState(0);
  const [progressB, setProgressB] = useState(0);
  const [errorA, setErrorA] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<{ side: 'A' | 'B'; entry: ConsoleLogEntry } | null>(null);

  const result = useMemo(
    () => (logA && logB ? buildConsoleLogCompare(logA, logB) : null),
    [logA, logB],
  );

  useEffect(() => {
    consoleLogCompareSnapshot = { logA, logB, nameA, nameB };
  }, [logA, logB, nameA, nameB]);

  const loadParsedLog = async (
    loader: () => Promise<{ fileName: string; data: ConsoleLogFile }>,
    side: 'A' | 'B',
  ) => {
    const setLoading = side === 'A' ? setLoadingA : setLoadingB;
    const setProgress = side === 'A' ? setProgressA : setProgressB;
    const setError = side === 'A' ? setErrorA : setErrorB;
    const setName = side === 'A' ? setNameA : setNameB;
    const setLog = side === 'A' ? setLogA : setLogB;

    setLoading(true);
    setError(null);
    setProgress(0);
    const ticker = window.setInterval(() => setProgress(value => Math.min(value + 18, 88)), 80);

    try {
      const { fileName, data } = await loader();
      setLog(data);
      setName(fileName);
      setProgress(100);
    } catch (error: any) {
      setError(error?.message ?? 'Failed to load console log');
    } finally {
      window.clearInterval(ticker);
      setLoading(false);
    }
  };

  const loadFile = (file: File, side: 'A' | 'B') => {
    void loadParsedLog(async () => ({
      fileName: file.name,
      data: await ConsoleLogParser.parseFile(file),
    }), side);
  };

  const loadOpenTab = (tab: OpenLogTab, side: 'A' | 'B') => {
    void loadParsedLog(async () => {
      if (tab.localData) {
        return { fileName: tab.fileName, data: tab.localData };
      }

      if (!tab.fileId) {
        throw new Error('This open log does not have parsed data available.');
      }

      const response = await apiClient.getLogEntries(tab.fileId, {
        page: 1,
        limit: BACKEND_COMPARE_ROW_LIMIT,
        sortBy: 'timestamp',
        sortDir: 'asc',
      });

      return {
        fileName: tab.fileName,
        data: normalizeBackendLog(
          tab.fileName,
          response.entries,
          response.pagination.totalEntries,
        ),
      };
    }, side);
  };

  const levelRows: LogLevel[] = ['error', 'warn', 'info', 'log', 'debug', 'trace', 'verbose'];

  return (
    <div className="log-compare-root">
      <section className="cmp-hero log-compare-hero">
        <div className="cmp-hero-copy">
          <span className="cmp-hero-kicker">Console log compare</span>
          <h2>Compare two console logs by severity, issue tags, and recurring messages</h2>
          <p>Use this for before/after captures, two nodes, or customer versus internal reproductions.</p>
        </div>
        <div className="cmp-hero-summary">
          <div className="cmp-hero-pill"><span>Baseline</span><strong>{nameA ? 'Ready' : 'Missing'}</strong></div>
          <div className="cmp-hero-pill"><span>Comparison</span><strong>{nameB ? 'Ready' : 'Missing'}</strong></div>
          <div className="cmp-hero-pill"><span>Open logs</span><strong>{openTabs.length}</strong></div>
        </div>
      </section>

      <section className="log-compare-upload-grid">
        <LogCompareFileCard
          side="A"
          title="Baseline log"
          fileName={nameA}
          loading={loadingA}
          progress={progressA}
          error={errorA}
          entryCount={logA?.entries.length ?? null}
          openTabs={openTabs}
          onFile={file => loadFile(file, 'A')}
          onSelectOpenTab={tab => loadOpenTab(tab, 'A')}
        />
        <LogCompareFileCard
          side="B"
          title="Comparison log"
          fileName={nameB}
          loading={loadingB}
          progress={progressB}
          error={errorB}
          entryCount={logB?.entries.length ?? null}
          openTabs={openTabs}
          onFile={file => loadFile(file, 'B')}
          onSelectOpenTab={tab => loadOpenTab(tab, 'B')}
        />
      </section>

      {result && (
        <section className="log-compare-results">
          <div className="log-compare-verdict">
            <span className="log-compare-verdict-icon"><FileTextIcon /></span>
            <div>
              <span className="cmp-panel-kicker">Compare verdict</span>
              <h3>{result.summary}</h3>
              <p>
                File B has {countDeltaSign(result.metricsB.errorCount - result.metricsA.errorCount)} errors and {countDeltaSign(result.metricsB.warningCount - result.metricsA.warningCount)} warnings versus File A.
              </p>
            </div>
          </div>

          <div className="log-compare-metric-grid">
            <div className="log-compare-metric">
              <span>Total entries</span>
              <strong>{result.metricsA.totalEntries}{' to '}{result.metricsB.totalEntries}</strong>
              <small style={{ color: deltaTone(result.metricsB.totalEntries - result.metricsA.totalEntries, false) }}>
                {countDeltaSign(result.metricsB.totalEntries - result.metricsA.totalEntries)}
              </small>
            </div>
            <div className="log-compare-metric">
              <span>Errors</span>
              <strong>{result.metricsA.errorCount}{' to '}{result.metricsB.errorCount}</strong>
              <small style={{ color: deltaTone(result.metricsB.errorCount - result.metricsA.errorCount) }}>
                {countDeltaSign(result.metricsB.errorCount - result.metricsA.errorCount)}
              </small>
            </div>
            <div className="log-compare-metric">
              <span>Warnings</span>
              <strong>{result.metricsA.warningCount}{' to '}{result.metricsB.warningCount}</strong>
              <small style={{ color: deltaTone(result.metricsB.warningCount - result.metricsA.warningCount) }}>
                {countDeltaSign(result.metricsB.warningCount - result.metricsA.warningCount)}
              </small>
            </div>
            <div className="log-compare-metric">
              <span>Issue tags</span>
              <strong>{result.metricsA.issueTagCount}{' to '}{result.metricsB.issueTagCount}</strong>
              <small>{result.newIssueTags.length} new</small>
            </div>
          </div>

          <div className="log-compare-panels">
            <section className="log-compare-panel">
              <div className="cmp-panel-head">
                <div>
                  <span className="cmp-panel-kicker">Severity movement</span>
                  <h4>Level deltas</h4>
                </div>
              </div>
              <div className="log-compare-level-list">
                {levelRows.map(level => {
                  const delta = result.levelDeltas[level] ?? 0;
                  return (
                    <div key={level} className="log-compare-level-row">
                      <span>{level}</span>
                      <strong style={{ color: deltaTone(delta) }}>{countDeltaSign(delta)}</strong>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="log-compare-panel">
              <div className="cmp-panel-head">
                <div>
                  <span className="cmp-panel-kicker">Issue classification</span>
                  <h4>New and removed signals</h4>
                </div>
              </div>
              <div className="log-compare-tags">
                <div>
                  <span>New in B</span>
                  {result.newIssueTags.length
                    ? result.newIssueTags.map(tag => <strong key={tag}>{tag}</strong>)
                    : <em>None</em>}
                </div>
                <div>
                  <span>Removed from B</span>
                  {result.removedIssueTags.length
                    ? result.removedIssueTags.map(tag => <strong key={tag}>{tag}</strong>)
                    : <em>None</em>}
                </div>
              </div>
            </section>
          </div>

          <section className="log-compare-panel">
            <div className="cmp-panel-head">
              <div>
                <span className="cmp-panel-kicker">Error movement</span>
                <h4>New and resolved error messages</h4>
              </div>
            </div>
            <div className="log-compare-error-columns">
              <div>
                <h5>New in File B</h5>
                {result.newErrors.length ? result.newErrors.map(entry => (
                  <button type="button" className="log-compare-evidence-link" key={`new-${entry.id}`} onClick={() => setSelectedEvidence({ side: 'B', entry })}>
                    {shortText(entry.message)}
                  </button>
                )) : <p className="log-compare-muted">No new error messages.</p>}
              </div>
              <div>
                <h5>Resolved from File A</h5>
                {result.resolvedErrors.length ? result.resolvedErrors.map(entry => (
                  <button type="button" className="log-compare-evidence-link" key={`resolved-${entry.id}`} onClick={() => setSelectedEvidence({ side: 'A', entry })}>
                    {shortText(entry.message)}
                  </button>
                )) : <p className="log-compare-muted">No resolved error messages.</p>}
              </div>
            </div>
          </section>

          <section className="log-compare-panel">
            <div className="cmp-panel-head">
              <div>
                <span className="cmp-panel-kicker">Signature movement</span>
                <h4>New, resolved, changed, and unchanged signatures</h4>
              </div>
            </div>
            <div className="log-compare-message-table" role="table" aria-label="Console message signature classifications">
              <div className="log-compare-message-row log-compare-message-head" role="row">
                <span role="columnheader">Signature</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">A</span>
                <span role="columnheader">B</span>
                <span role="columnheader">Evidence</span>
              </div>
              {result.signatureDeltas.length ? result.signatureDeltas.map(item => (
                <div key={item.signature} className="log-compare-message-row" role="row">
                  <span role="cell" title={item.message}>{shortText(item.message, 140)}</span>
                  <strong role="cell" className={`log-compare-status status-${item.status}`}>{item.status}</strong>
                  <span role="cell">{item.countA}</span>
                  <span role="cell">{item.countB}</span>
                  <span role="cell" className="log-compare-evidence-actions">
                    {item.evidenceA[0] && <button type="button" onClick={() => setSelectedEvidence({ side: 'A', entry: item.evidenceA[0] })}>A</button>}
                    {item.evidenceB[0] && <button type="button" onClick={() => setSelectedEvidence({ side: 'B', entry: item.evidenceB[0] })}>B</button>}
                  </span>
                </div>
              )) : (
                <div className="log-compare-message-empty">No message signatures found.</div>
              )}
            </div>
          </section>

          {selectedEvidence && (
            <section className="log-compare-panel log-compare-selected-evidence" aria-live="polite">
              <div className="cmp-panel-head">
                <div>
                  <span className="cmp-panel-kicker">Source evidence · File {selectedEvidence.side}</span>
                  <h4>{selectedEvidence.entry.source || selectedEvidence.entry.url || selectedEvidence.entry.category || 'Source unavailable'}</h4>
                </div>
                <button type="button" className="log-compare-evidence-close" onClick={() => setSelectedEvidence(null)}>Close</button>
              </div>
              <dl>
                <div><dt>Timestamp</dt><dd>{selectedEvidence.entry.timestamp || 'Unavailable'}</dd></div>
                <div><dt>Level</dt><dd>{getConsoleDisplayLevel(selectedEvidence.entry)}</dd></div>
              </dl>
              <pre>{selectedEvidence.entry.rawText || selectedEvidence.entry.message}</pre>
            </section>
          )}
        </section>
      )}
    </div>
  );
};

export default ConsoleLogCompare;
