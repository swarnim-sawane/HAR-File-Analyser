import { describe, expect, it, vi } from 'vitest';
import {
  deriveOverallStatus,
  getOpsStatusColor,
  logInfo,
  measureDurationMs,
} from './observability';

describe('observability helpers', () => {
  it('maps operational statuses to UI colors', () => {
    expect(getOpsStatusColor('ok')).toBe('green');
    expect(getOpsStatusColor('warning')).toBe('amber');
    expect(getOpsStatusColor('error')).toBe('red');
    expect(getOpsStatusColor('unknown')).toBe('slate');
  });

  it('derives overall status from core checks only', () => {
    expect(deriveOverallStatus([
      { status: 'ok' },
      { status: 'warning', affectsOverall: false },
    ])).toBe('ok');

    expect(deriveOverallStatus([
      { status: 'ok' },
      { status: 'warning' },
    ])).toBe('warning');

    expect(deriveOverallStatus([
      { status: 'warning' },
      { status: 'error' },
    ])).toBe('error');
  });

  it('measures non-negative durations', () => {
    expect(measureDurationMs(Date.now() + 1000)).toBe(0);
  });

  it('redacts sensitive log fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logInfo('test.event', {
      fileId: 'file-1',
      ocaToken: 'secret-token',
      nested: { authorization: 'Bearer abc' },
    });

    const payload = JSON.parse(String(spy.mock.calls[0][0]));
    expect(payload.event).toBe('test.event');
    expect(payload.fileId).toBe('file-1');
    expect(payload.ocaToken).toBe('[REDACTED]');
    expect(payload.nested.authorization).toBe('[REDACTED]');

    spy.mockRestore();
  });
});
