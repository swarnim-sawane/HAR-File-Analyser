import React from 'react';
import { HarPreviewSnapshot } from '../services/progressiveHarPreview';

interface ProgressiveHarPreviewProps {
  snapshot: HarPreviewSnapshot;
}

const previewHeading = (snapshot: HarPreviewSnapshot) => {
  if (snapshot.phase === 'failed') return 'HAR file could not be processed';
  if (snapshot.phase === 'cancelled') return 'HAR loading cancelled';
  return 'Loading HAR file';
};

const ProgressiveHarPreview: React.FC<ProgressiveHarPreviewProps> = ({ snapshot }) => (
  <section className="progressive-analyzer" aria-label="Progressive HAR analyzer preview">
    <div className="har-sticky-header progressive-analyzer__tabs">
      <div className="main-tabs har-main-tabs" role="tablist" aria-label="HAR analysis views">
        <button type="button" className="main-tab active" role="tab" aria-selected="true">
          Analyzer
        </button>
        {['Request Flow', 'Scorecard', 'AI Insights'].map((label) => (
          <button
            key={label}
            type="button"
            className="main-tab"
            role="tab"
            aria-selected="false"
            aria-disabled="true"
            disabled
            title="Available when authoritative server analysis is ready"
          >
            {label}
          </button>
        ))}
      </div>
    </div>

    <div className="analyzer-layout progressive-analyzer__layout">
      <aside className="sidebar-left progressive-analyzer__sidebar">
        <div className="filter-file-summary" aria-label="Active HAR file">
          <span className="filter-file-kicker">File</span>
          <strong title={snapshot.fileName}>{snapshot.fileName}</strong>
          <span>
            {previewHeading(snapshot)} - {snapshot.totalParsed} request
            {snapshot.totalParsed === 1 ? '' : 's'} read
          </span>
        </div>

        <div className="progressive-analyzer__sidebar-section" aria-hidden="true">
          <span className="progressive-analyzer__skeleton is-label" />
          <span className="progressive-analyzer__skeleton is-control" />
        </div>
        <div className="progressive-analyzer__sidebar-section" aria-hidden="true">
          <span className="progressive-analyzer__skeleton is-label" />
          <span className="progressive-analyzer__skeleton is-chips" />
        </div>
      </aside>

      <div className="content-area progressive-analyzer__content">
        <div className={`progressive-analyzer__loader is-${snapshot.phase}`} role="status" aria-live="polite">
          <span className="progressive-analyzer__loader-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="progressive-analyzer__loader-copy">
            <strong>{previewHeading(snapshot)}</strong>
            <small className="progressive-analyzer__loader-progress">
              {snapshot.totalParsed} request{snapshot.totalParsed === 1 ? '' : 's'} read incrementally
            </small>
            {snapshot.phase !== 'failed' && snapshot.phase !== 'cancelled' && (
              <small>
                Rows appear as they are read. Likely Issue will appear and auto-scroll when the
                complete analysis is ready.
              </small>
            )}
            {snapshot.skippedOversizedEntries > 0 && (
              <small className="progressive-analyzer__loader-note">
                {snapshot.skippedOversizedEntries} oversized request
                {snapshot.skippedOversizedEntries === 1 ? '' : 's'} omitted locally; server validation continues.
              </small>
            )}
          </span>
        </div>

        {snapshot.error && (
          <div className="progressive-analyzer__notice is-error" role="alert">{snapshot.error}</div>
        )}

        {snapshot.requests.length === 0 ? (
          <div className="progressive-analyzer__empty" aria-label="Reading HAR requests">
            {Array.from({ length: 7 }, (_, index) => (
              <span key={index} className="progressive-analyzer__request-skeleton" />
            ))}
          </div>
        ) : (
          <div className="progressive-har-preview__table-wrap">
            <table className="progressive-har-preview__table">
              <thead>
                <tr><th>#</th><th>Time</th><th>Status</th><th>Method</th><th>URL</th><th>Duration</th></tr>
              </thead>
              <tbody>
                {snapshot.requests.map((request) => (
                  <tr key={request.id}>
                    <td>{request.index + 1}</td>
                    <td>{request.startedDateTime.split('T')[1]?.replace('Z', '') || request.startedDateTime}</td>
                    <td>
                      <span className={`progressive-status status-${Math.floor(request.status / 100)}xx`}>
                        {request.status}
                      </span>
                    </td>
                    <td>{request.method}</td>
                    <td title={request.url}>{request.url}</td>
                    <td>{Math.round(request.durationMs)} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="progressive-analyzer__summary">
              {snapshot.totalParsed} requests read
              {snapshot.totalParsed > snapshot.requests.length
                ? ` - showing the first ${snapshot.maxRequests}`
                : ''}
            </div>
          </div>
        )}
      </div>
    </div>
  </section>
);

export default ProgressiveHarPreview;
