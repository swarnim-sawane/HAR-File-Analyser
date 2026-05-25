import React from 'react';
import { Handle, Position } from 'reactflow';
import { TYPE_COLOR } from '../utils/requestFlowAnalyzer';

export interface RequestFlowNodePayload {
  type: string;
  status: number;
  method: string;
  url: string;
  time?: number;
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
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? `Open in Analyzer ${data.method} ${pathLabel} ${data.status}` : undefined}
      onClick={data.onClick}
      onKeyDown={(event) => handleNodeKeyDown(event, data.onClick)}
      style={{
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
