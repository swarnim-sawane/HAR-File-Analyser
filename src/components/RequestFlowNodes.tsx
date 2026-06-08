import React from 'react';
import { Handle, Position } from 'reactflow';
import { TYPE_COLOR } from '../utils/requestFlowAnalyzer';

export interface RequestFlowNodePayload {
  type: string;
  status: number;
  statusText?: string;
  method: string;
  url: string;
  time?: number;
  startedDateTime?: string;
  mimeType?: string;
  responseSize?: number;
  requestSize?: number;
  timings?: {
    blocked?: number;
    dns?: number;
    connect?: number;
    ssl?: number;
    send?: number;
    wait?: number;
    receive?: number;
  };
  isSlow?: boolean;
  isCritical?: boolean;
  isDimmed?: boolean;
  isFocusPath?: boolean;
  isFocusAnchor?: boolean;
  isErrorJumpSelected?: boolean;
  focusLabel?: string;
  focusSeverity?: 'critical' | 'warning' | 'notice';
  focusStep?: number;
  focusReason?: string;
  entryIndex: number;
  domainLabel?: string;
  productLabel?: string;
  traceRole?: 'root' | 'primary' | 'branch' | 'terminal';
  onClick?: () => void;
  onPreviewOpen?: () => void;
  onPreviewClose?: () => void;
}

const getStatusColor = (status: number) => {
  if (status >= 200 && status < 300) return '#10b981';
  if (status >= 300 && status < 400) return '#f59e0b';
  if (status >= 400) return '#ef4444';
  return '#6b7280';
};

const getPathLabel = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || '/'}${parsed.search || ''}`;
  } catch {
    return url;
  }
};

const handleNodeKeyDown = (
  event: React.KeyboardEvent<HTMLDivElement>,
  onClick?: () => void
) => {
  if (!onClick) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onClick();
  }
};

const handleNodeBlur = (
  event: React.FocusEvent<HTMLDivElement>,
  onPreviewClose?: () => void
) => {
  if (!onPreviewClose) return;
  if (event.currentTarget.contains(event.relatedTarget)) return;
  onPreviewClose();
};

const handleStyle = (accent: string): React.CSSProperties => ({
  width: 10,
  height: 10,
  border: '2px solid var(--bg-primary)',
  background: accent,
});

const getTraceBadge = (traceRole?: RequestFlowNodePayload['traceRole'], status?: number) => {
  switch (traceRole) {
    case 'root':
      return {
        label: 'Root',
        color: '#5b8def',
      };
    case 'branch':
      return {
        label: 'Branch',
        color: '#64748b',
      };
    case 'terminal':
      return {
        label: status && status >= 400 ? 'Failure' : 'Terminal',
        color: status && status >= 400 ? '#ef4444' : '#5b8def',
      };
    default:
      return null;
  }
};

const getHostLabel = (url: string) => {
  try {
    return new URL(url).hostname || 'unknown host';
  } catch {
    return 'unknown host';
  }
};

const formatBytes = (bytes?: number) => {
  if (!Number.isFinite(bytes) || bytes === undefined || bytes < 0) return 'Unknown';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
};

const formatMilliseconds = (value?: number) =>
  Number.isFinite(value) && value !== undefined ? `${Math.round(value)}ms` : 'n/a';

const getIssueHint = (data: RequestFlowNodePayload) => {
  if (data.status === 0) return 'No response captured';
  if (data.status >= 500) return 'Server-side failure';
  if (data.status >= 400 && (data.responseSize === 0 || data.responseSize === undefined)) {
    return 'Missing response body';
  }
  if (data.status >= 400) return 'Client-side HTTP error';
  if (data.isSlow) return 'Slow request';
  return null;
};

const RequestPreviewCard = ({
  data,
  pathLabel,
}: {
  data: RequestFlowNodePayload;
  pathLabel: string;
}) => {
  const issueHint = getIssueHint(data);
  const hostLabel = getHostLabel(data.url);
  const waitTime = data.timings?.wait;
  const receiveTime = data.timings?.receive;

  return (
    <div
      className="request-flow-node-preview"
      role="tooltip"
      id={`request-flow-node-preview-${data.entryIndex}`}
      aria-label={`${data.method} ${pathLabel} ${data.status} request preview`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="request-flow-node-preview-header">
        <div>
          <span>Request preview</span>
          <strong>
            {data.method} <em>{data.status}</em>
          </strong>
        </div>
        {issueHint ? <mark>{issueHint}</mark> : null}
      </div>

      <div className="request-flow-node-preview-url" title={data.url}>
        <strong>{pathLabel}</strong>
        <span>{hostLabel}</span>
      </div>

      <dl className="request-flow-node-preview-grid">
        <div>
          <dt>Status</dt>
          <dd>
            {data.status}
            {data.statusText ? ` ${data.statusText}` : ''}
          </dd>
        </div>
        <div>
          <dt>Total time</dt>
          <dd>{formatMilliseconds(data.time)}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(data.responseSize)}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{data.mimeType || data.type}</dd>
        </div>
      </dl>

      <div className="request-flow-node-preview-timing" aria-label="Timing summary">
        <span>
          Wait <strong>{formatMilliseconds(waitTime)}</strong>
        </span>
        <span>
          Receive <strong>{formatMilliseconds(receiveTime)}</strong>
        </span>
      </div>

      <div className="request-flow-node-preview-footer">
        Click node for full analyzer details
      </div>
    </div>
  );
};

const renderNode = (
  data: RequestFlowNodePayload,
  options: {
    accent: string;
    badgeLabel?: string;
    badgeColor?: string;
    surface?: string;
    shadow: string;
    highlightRing: string;
    statusColor?: string;
  }
) => {
  const pathLabel = getPathLabel(data.url);
  const isInteractive = typeof data.onClick === 'function';
  const domainLabel = data.productLabel || data.domainLabel;
  const focusColor = data.focusSeverity === 'critical'
    ? '#ef4444'
    : data.focusSeverity === 'warning'
      ? '#f97316'
      : '#f59e0b';
  const focusShadow = data.isFocusPath
    ? `0 0 0 ${data.isFocusAnchor ? 3 : 2}px ${focusColor}33, 0 10px 28px ${focusColor}26`
    : options.shadow;
  const boxShadow = data.isCritical || data.isFocusPath
    ? `0 0 0 2px ${data.isErrorJumpSelected ? '#dc262666' : data.isFocusPath ? `${focusColor}55` : options.highlightRing}, ${focusShadow}`
    : options.shadow;
  const borderColor = data.isErrorJumpSelected ? '#dc2626' : data.isFocusPath ? focusColor : options.accent;
  const traceBadge = getTraceBadge(data.traceRole, data.status);
  const badges = [
    ...(traceBadge ? [traceBadge] : []),
    ...(data.isFocusAnchor
      ? [
          {
            label: data.focusLabel || 'Likely issue',
            color: focusColor,
          },
        ]
      : []),
    ...(options.badgeLabel
      ? [
          {
            label: options.badgeLabel,
            color: options.badgeColor || options.accent,
          },
        ]
      : []),
  ];

  return (
    <div
      className={`request-flow-node-card ${data.isErrorJumpSelected ? 'is-error-jump-selected' : ''}`}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? `Open in Analyzer ${data.method} ${pathLabel} ${data.status}` : undefined}
      aria-describedby={`request-flow-node-preview-${data.entryIndex}`}
      onClick={data.onClick}
      onKeyDown={(event) => handleNodeKeyDown(event, data.onClick)}
      onMouseEnter={data.onPreviewOpen}
      onMouseLeave={data.onPreviewClose}
      onFocus={data.onPreviewOpen}
      onBlur={(event) => handleNodeBlur(event, data.onPreviewClose)}
      style={{
        position: 'relative',
        padding: '12px 16px',
        borderRadius: '10px',
        background: options.surface || 'var(--bg-primary)',
        border: `${data.isCritical || data.isFocusAnchor || data.isErrorJumpSelected ? 2 : 1}px solid ${borderColor}`,
        minWidth: '220px',
        maxWidth: '220px',
        boxShadow,
        cursor: isInteractive ? 'pointer' : 'default',
        opacity: data.isDimmed ? 0.54 : 1,
        filter: data.isDimmed ? 'grayscale(0.72) saturate(0.48)' : 'none',
        transition: 'opacity 160ms ease, filter 160ms ease, box-shadow 160ms ease, border-color 160ms ease',
      }}
    >
      <Handle type="target" position={Position.Left} style={handleStyle(options.accent)} />

      {data.isFocusPath && (
        <div className="request-flow-node-diagnostic-row">
          {data.focusStep && (
            <span className="request-flow-node-step-badge">{data.focusStep}</span>
          )}
          {data.isFocusAnchor && (
            <span className="request-flow-node-start-label">Start here</span>
          )}
          {data.isFocusAnchor && data.focusReason && (
            <span className="request-flow-node-reason" title={data.focusReason}>
              {data.focusReason}
            </span>
          )}
        </div>
      )}

      <div
        style={{
          marginBottom: '6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: options.accent,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {data.type}
        </span>

        {badges.length > 0 && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            {badges.map((badge) => (
              <span
                key={badge.label}
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: badge.color,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {badge.label}
              </span>
            ))}
          </span>
        )}
      </div>

      <div style={{ marginBottom: '4px', fontWeight: 600, fontSize: '13px' }}>
        {data.method}{' '}
        <span style={{ color: options.statusColor || getStatusColor(data.status), fontWeight: 700 }}>
          {data.status}
        </span>
      </div>

      <div
        style={{
          fontSize: '11px',
          color: 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '188px',
        }}
        title={data.url}
      >
        {pathLabel}
      </div>

      <div
        style={{
          marginTop: '6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: '10px',
            color: data.isSlow ? '#f97316' : 'var(--text-tertiary)',
            fontWeight: data.isSlow ? 700 : 500,
          }}
        >
          {Math.round(data.time || 0)}ms
        </span>

        {domainLabel && (
          <span
            style={{
              fontSize: '10px',
              color: 'var(--text-tertiary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={domainLabel}
          >
            {domainLabel}
          </span>
        )}
      </div>

      <RequestPreviewCard data={data} pathLabel={pathLabel} />

      <Handle type="source" position={Position.Right} style={handleStyle(options.accent)} />
    </div>
  );
};

export const DefaultNode = ({ data }: { data: RequestFlowNodePayload }) =>
  renderNode(data, {
    accent: TYPE_COLOR[data.type] || TYPE_COLOR.other,
    badgeLabel: data.isSlow ? 'Slow' : undefined,
    badgeColor: '#f97316',
    shadow: '0 2px 8px rgba(15, 23, 42, 0.08)',
    highlightRing: 'rgba(91, 141, 239, 0.2)',
  });

export const ErrorNode = ({ data }: { data: RequestFlowNodePayload }) =>
  renderNode(data, {
    accent: '#ef4444',
    badgeLabel: 'Error',
    badgeColor: '#ef4444',
    shadow: '0 4px 12px rgba(239, 68, 68, 0.18)',
    highlightRing: 'rgba(239, 68, 68, 0.18)',
    statusColor: '#dc2626',
  });
