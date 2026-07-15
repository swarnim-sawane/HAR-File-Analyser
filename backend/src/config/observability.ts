export type ObservabilityLogLevel = 'info' | 'warn' | 'error';
export type OpsStatusLevel = 'ok' | 'warning' | 'error' | 'unknown';
export type OpsStatusColor = 'green' | 'amber' | 'red' | 'slate';

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|password|secret|token|api[-_]?key|oca[-_]?token)/i;

export function getOpsStatusColor(status: OpsStatusLevel): OpsStatusColor {
  if (status === 'ok') return 'green';
  if (status === 'warning') return 'amber';
  if (status === 'error') return 'red';
  return 'slate';
}

export function deriveOverallStatus(statuses: Array<{ status: OpsStatusLevel; affectsOverall?: boolean }>): OpsStatusLevel {
  const effectiveStatuses = statuses.filter((item) => item.affectsOverall !== false);
  if (effectiveStatuses.some((item) => item.status === 'error')) return 'error';
  if (effectiveStatuses.some((item) => item.status === 'warning')) return 'warning';
  if (effectiveStatuses.some((item) => item.status === 'unknown')) return 'unknown';
  return 'ok';
}

export function measureDurationMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[MaxDepth]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, depth + 1));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeForLog(entryValue, depth + 1),
    ]),
  );
}

function writeStructuredLog(level: ObservabilityLogLevel, event: string, fields: Record<string, unknown> = {}) {
  const sanitizedFields = sanitizeForLog(fields) as Record<string, unknown>;
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...sanitizedFields,
  };

  const serialized = JSON.stringify(payload);
  if (level === 'error') {
    console.error(serialized);
    return;
  }
  if (level === 'warn') {
    console.warn(serialized);
    return;
  }
  console.log(serialized);
}

export function logInfo(event: string, fields?: Record<string, unknown>) {
  writeStructuredLog('info', event, fields);
}

export function logWarn(event: string, fields?: Record<string, unknown>) {
  writeStructuredLog('warn', event, fields);
}

export function logError(event: string, fields?: Record<string, unknown>) {
  writeStructuredLog('error', event, fields);
}
