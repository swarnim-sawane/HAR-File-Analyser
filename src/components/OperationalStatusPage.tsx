import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../services/apiClient';
import type { OpsCheck, OpsStatusLevel, OpsStatusResponse, OpsStorageSnapshot } from '../types/ops';
import { DatabaseIcon, RefreshIcon, ServerIcon } from './Icons';

const STATUS_LABELS: Record<OpsStatusLevel, string> = {
  ok: 'Healthy',
  warning: 'Needs attention',
  error: 'Down',
  unknown: 'Optional / unknown',
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Unknown';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${Math.floor(seconds % 60)}s`;
}

function StatusPill({ status }: { status: OpsStatusLevel }) {
  return (
    <span className={`ops-status-pill ops-status-pill--${status}`}>
      <span className="ops-status-dot" />
      {STATUS_LABELS[status]}
    </span>
  );
}

function StatusCard({ check }: { check: OpsCheck }) {
  return (
    <article className={`ops-status-card ops-status-card--${check.status}`}>
      <div className="ops-status-card-head">
        <div>
          <h3>{check.label}</h3>
          <p>{check.affectsOverall ? 'Core runtime check' : 'Optional capability'}</p>
        </div>
        <StatusPill status={check.status} />
      </div>
      <p className="ops-status-detail">{check.detail}</p>
      <div className="ops-status-meta">
        {typeof check.latencyMs === 'number' && <span>{check.latencyMs} ms</span>}
        {check.data && Object.entries(check.data).slice(0, 5).map(([key, value]) => (
          <span key={key}>{key}: {Array.isArray(value) ? value.length : String(value)}</span>
        ))}
      </div>
    </article>
  );
}

function StorageCard({ storage }: { storage: OpsStorageSnapshot }) {
  return (
    <article className={`ops-status-card ops-status-card--${storage.status}`}>
      <div className="ops-status-card-head">
        <div>
          <h3>{storage.label}</h3>
          <p>{storage.fileCount.toLocaleString()} files</p>
        </div>
        <StatusPill status={storage.status} />
      </div>
      <p className="ops-status-detail">{storage.detail}</p>
      <div className="ops-status-meta">
        <span>{formatBytes(storage.sizeBytes)}</span>
        <span className="ops-status-path">{storage.path}</span>
      </div>
    </article>
  );
}

const OperationalStatusPage: React.FC = () => {
  const [status, setStatus] = useState<OpsStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.getOpsStatus();
      setStatus(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load operations status.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const coreChecks = useMemo(
    () => status?.checks.filter((check) => check.affectsOverall) ?? [],
    [status]
  );
  const optionalChecks = useMemo(
    () => status?.checks.filter((check) => !check.affectsOverall) ?? [],
    [status]
  );

  return (
    <section className="ops-page" aria-labelledby="ops-page-title">
      <div className="ops-hero">
        <div className="ops-hero-copy">
          <span className={`ops-overall-chip ops-overall-chip--${status?.status ?? 'unknown'}`}>
            {status ? STATUS_LABELS[status.status] : 'Checking'}
          </span>
          <h2 id="ops-page-title">Operations Status</h2>
          <p>
            Lightweight runtime visibility for uploads, worker queues, persistence, storage, and optional AI dependencies.
          </p>
        </div>
        <button type="button" className="ops-refresh-button" onClick={loadStatus} disabled={isLoading}>
          <RefreshIcon />
          <span>{isLoading ? 'Refreshing' : 'Refresh'}</span>
        </button>
      </div>

      {error && (
        <div className="ops-error-banner" role="alert">
          <strong>Status unavailable</strong>
          <span>{error}</span>
        </div>
      )}

      {status && (
        <>
          <div className="ops-summary-grid">
            <div className="ops-summary-tile">
              <ServerIcon />
              <span>Backend uptime</span>
              <strong>{formatUptime(status.uptimeSeconds)}</strong>
            </div>
            <div className="ops-summary-tile">
              <DatabaseIcon />
              <span>Runtime</span>
              <strong>{status.runtime.nodeVersion}</strong>
            </div>
            <div className="ops-summary-tile">
              <span className="ops-summary-icon-text">{status.runtime.platform}</span>
              <span>Process ID</span>
              <strong>{status.runtime.pid}</strong>
            </div>
            <div className="ops-summary-tile">
              <span className="ops-summary-icon-text">UTC</span>
              <span>Last checked</span>
              <strong>{new Date(status.timestamp).toLocaleTimeString()}</strong>
            </div>
          </div>

          <div className="ops-section">
            <div className="ops-section-head">
              <h3>Core Runtime</h3>
              <p>These checks affect readiness and should stay green for shared use.</p>
            </div>
            <div className="ops-card-grid">
              {coreChecks.map((check) => <StatusCard key={check.id} check={check} />)}
            </div>
          </div>

          <div className="ops-section">
            <div className="ops-section-head">
              <h3>Storage</h3>
              <p>Upload and processed artifact directories need periodic cleanup in shared environments.</p>
            </div>
            <div className="ops-card-grid">
              {status.storage.map((storage) => <StorageCard key={storage.id} storage={storage} />)}
            </div>
          </div>

          <div className="ops-section">
            <div className="ops-section-head">
              <h3>Optional Capabilities</h3>
              <p>These can be amber or slate without taking the analyzer down.</p>
            </div>
            <div className="ops-card-grid">
              {optionalChecks.map((check) => <StatusCard key={check.id} check={check} />)}
            </div>
          </div>
        </>
      )}

      {!status && !error && (
        <div className="ops-loading-panel">
          <div className="spinner" />
          <span>Loading operations status...</span>
        </div>
      )}
    </section>
  );
};

export default OperationalStatusPage;
