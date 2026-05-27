import { afterEach, describe, expect, it } from 'vitest';
import { generateInsightsForContext } from './aiRoutes';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('generateInsightsForContext', () => {
  it('returns deterministic fallback insights when OCA is unavailable', async () => {
    delete process.env.OCA_BASE_URL;
    delete process.env.OCA_TOKEN;

    const response = await generateInsightsForContext(
      [
        'HAR SUMMARY: requests:3 errors:1 5xx:1 statuses:200:2 503:1',
        '5XX SERVER ERRORS (1 total - analyse first, highest severity):',
        'GET ords.example.com/ords/hr/employees status:503 totalms:1800ms wait:1500ms',
      ].join('\n'),
      'har',
      { allowDeterministicFallback: true },
    );

    expect(response.ai.source).toBe('deterministic_fallback');
    expect(response.ai.fallbackReason).toMatch(/OCA is not configured/i);
    expect(response.result.sections[0].findings[0]).toMatchObject({
      severity: 'high',
      title: 'HTTP 5xx failure detected in HAR',
    });
  });
});
