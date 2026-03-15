// src/components/RequestFlowNodes.tsx
import React from 'react';
import { Handle, Position } from 'reactflow';

const getTypeColor = (type: string) => {
  const colors: Record<string, string> = {
    document: '#3b82f6',
    script: '#f59e0b',
    xhr: '#10b981',
    stylesheet: '#a78bfa',
    image: '#ec4899',
    font: '#14b8a6',
    other: '#6b7280',
  };
  return colors[type] || colors.other;
};

const getStatusColor = (status: number) => {
  if (status >= 200 && status < 300) return '#10b981';
  if (status >= 300 && status < 400) return '#f59e0b';
  if (status >= 400) return '#ef4444';
  return '#6b7280';
};

export const DefaultNode = ({ data }: any) => {
  const typeColor = getTypeColor(data.type);
  const statusColor = getStatusColor(data.status);

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        background: 'var(--bg-primary)',
        border: `2px solid ${typeColor}`,
        minWidth: '220px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <Handle type="target" position={Position.Left} />

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
            color: typeColor,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {data.type}
        </span>
        {data.isSlow && (
          <span
            style={{
              fontSize: '11px',
              color: '#f97316',
              fontWeight: 600,
            }}
          >
            🔥 Slow
          </span>
        )}
      </div>

      <div style={{ marginBottom: '4px', fontWeight: 600, fontSize: '13px' }}>
        {data.method}{' '}
        <span style={{ color: statusColor, fontWeight: 700 }}>
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
          maxWidth: '190px',
        }}
        title={data.url}
      >
        {new URL(data.url).pathname}
      </div>

      <div
        style={{
          fontSize: '10px',
          color: data.isSlow ? '#f97316' : 'var(--text-tertiary)',
          marginTop: '4px',
        }}
      >
        {data.time?.toFixed?.(0)}ms
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
};

export const ErrorNode = ({ data }: any) => {
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        background: '#fef2f2',
        border: '2px solid #ef4444',
        minWidth: '220px',
        boxShadow: '0 4px 12px rgba(239, 68, 68, 0.25)',
        animation: 'pulse 2s infinite',
      }}
    >
      <Handle type="target" position={Position.Left} />

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
            color: '#ef4444',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          ❌ Error
        </span>
        {data.isSlow && (
          <span
            style={{
              fontSize: '11px',
              color: '#b91c1c',
              fontWeight: 600,
            }}
          >
            🔥 Slow
          </span>
        )}
      </div>

      <div
        style={{
          marginBottom: '4px',
          fontWeight: 700,
          fontSize: '13px',
          color: '#dc2626',
        }}
      >
        {data.method} {data.status}
      </div>

      <div
        style={{
          fontSize: '11px',
          color: '#b91c1c',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '190px',
        }}
        title={data.url}
      >
        {new URL(data.url).pathname}
      </div>

      <div
        style={{
          fontSize: '10px',
          color: '#7f1d1d',
          marginTop: '4px',
        }}
      >
        {data.time?.toFixed?.(0)}ms
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
};
