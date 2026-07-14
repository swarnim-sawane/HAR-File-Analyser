import express from 'express';
import { once } from 'events';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import aiRouter, { generateInsightsForContext, validateAiChatPayload } from './aiRoutes';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('generateInsightsForContext', () => {
  it('reports OpenAI as intentionally unconfigured without affecting API availability', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;

    const app = express();
    app.use('/api/ai', aiRouter);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/ai/status`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        configured: false,
        connected: false,
        model: null,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it('returns deterministic fallback insights when OpenAI is unavailable', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;

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
    expect(response.ai.fallbackReason).toMatch(/OpenAI is not configured/i);
    expect(response.result.sections[0].findings[0]).toMatchObject({
      severity: 'high',
      title: 'HTTP 5xx failure detected in HAR',
    });
  });

  it('fails safe to deterministic insights when the OpenAI endpoint is invalid', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'approved-model';
    process.env.OPENAI_BASE_URL = 'http://insecure.example.com/v1';

    const response = await generateInsightsForContext(
      'HAR SUMMARY: requests:1 errors:0 status:200 GET /api/orders',
      'har',
      { allowDeterministicFallback: true },
    );

    expect(response.ai.source).toBe('deterministic_fallback');
    expect(response.ai.fallbackReason).toMatch(/OPENAI_BASE_URL must use HTTPS/i);
  });

  it('uses OpenAI Responses streaming with disabled response storage', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'approved-model';
    delete process.env.OPENAI_BASE_URL;

    const insightJson = JSON.stringify({
      overallHealth: 'degraded',
      summary: 'The API returned a server error.',
      sections: [{
        type: 'critical_issues',
        title: 'Server errors',
        findings: [{
          severity: 'high',
          title: 'Orders API failed',
          what: 'The orders API returned a server error.',
          why: 'The upstream service did not complete the request.',
          evidence: 'GET /api/orders status 503',
          fix: 'Update the API timeout configuration for /api/orders.',
        }],
      }],
    });

    const fetchMock = vi.fn().mockResolvedValue(new Response(
      `event: response.output_text.delta\n` +
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: insightJson })}\n\n` +
      `event: response.completed\n` +
      `data: ${JSON.stringify({ type: 'response.completed' })}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const response = await generateInsightsForContext(
      'HAR SUMMARY: requests:1 errors:1 status:503 GET /api/orders',
      'har',
    );

    expect(response.ai.source).toBe('openai');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({ method: 'POST' }),
    );

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: 'approved-model',
      stream: true,
      store: false,
      max_output_tokens: 3500,
    });
  });

  it('bounds chat history and validates message shapes before calling OpenAI', () => {
    const tooManyMessages = Array.from({ length: 51 }, () => ({
      role: 'user',
      content: 'hello',
    }));

    expect(validateAiChatPayload(tooManyMessages, '')).toMatchObject({ status: 413 });
    expect(validateAiChatPayload([{ role: 'system', content: 'not allowed' }], '')).toMatchObject({
      status: 400,
    });
    expect(validateAiChatPayload([{ role: 'user', content: 'hello' }], 'diagnostic context')).toBeNull();
  });

  it('does not expose an upstream OpenAI error body in logs or fallback metadata', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'approved-model';

    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      'internal-tenant-detail-that-must-not-leak',
      { status: 403 },
    )));

    const response = await generateInsightsForContext(
      'HAR SUMMARY: requests:1 errors:1 status:503 GET /api/orders',
      'har',
      { allowDeterministicFallback: true },
    );

    expect(response.ai.source).toBe('deterministic_fallback');
    expect(response.ai.fallbackReason).toContain('OpenAI request failed (403)');
    expect(response.ai.fallbackReason).not.toContain('internal-tenant-detail');
    expect(logSpy.mock.calls.flat().join(' ')).not.toContain('internal-tenant-detail');
  });

  it('does not log malformed model output containing diagnostic evidence', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'approved-model';

    const sensitiveOutput = 'customer-evidence-that-must-not-be-logged';
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: sensitiveOutput })}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )));

    const response = await generateInsightsForContext(
      'HAR SUMMARY: requests:1 errors:0 status:200 GET /api/orders',
      'har',
      { allowDeterministicFallback: true },
    );

    expect(response.ai.source).toBe('deterministic_fallback');
    expect(response.ai.fallbackReason).toBe('Failed to parse OpenAI JSON response.');
    expect(logSpy.mock.calls.flat().join(' ')).not.toContain(sensitiveOutput);
  });

});
