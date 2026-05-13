import { describe, expect, it } from 'vitest';
import {
  CONSOLE_LOG_LOCAL_PARSE_THRESHOLD_BYTES,
  createLocalConsoleLogUploadResult,
  shouldParseConsoleLogLocally,
} from '../consoleLogProcessing';

describe('console log processing routing', () => {
  it('keeps medium Catalina logs on the local parser path', () => {
    expect(shouldParseConsoleLogLocally(44_278_289)).toBe(true);
  });

  it('routes genuinely huge logs to backend processing', () => {
    expect(shouldParseConsoleLogLocally(CONSOLE_LOG_LOCAL_PARSE_THRESHOLD_BYTES + 1)).toBe(false);
  });

  it('creates a local upload result without claiming a backend job', () => {
    const file = new File(['log row'], 'vm1_catalina.log', { type: 'text/plain' });
    const result = createLocalConsoleLogUploadResult(file);

    expect(result.fileId).toMatch(/^local_/);
    expect(result.jobId).toBe('local');
    expect(result.fileName).toBe('vm1_catalina.log');
    expect(result.fileSize).toBe(file.size);
  });
});
