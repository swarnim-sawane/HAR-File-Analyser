import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSupportWorkbenchSession,
  uploadSupportWorkbenchAttachments,
} from './supportWorkbenchClient';

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.stubGlobal('fetch', originalFetch);
  vi.unstubAllEnvs();
});

describe('supportWorkbenchClient', () => {
  it('creates a bridged support workbench session through the HAR backend with browser credentials', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        session: {
          id: 'support-session-1',
          cwd: 'C:/repo',
          status: 'idle',
        },
        snapshot: {
          sessionId: 'support-session-1',
        },
      }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const response = await createSupportWorkbenchSession({ sessionId: 'support-session-1' });

    expect(response.session.id).toBe('support-session-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/support-workbench/session',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId: 'support-session-1' }),
      })
    );
  });

  it('uploads the same source files as support workbench attachments', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        accepted: true,
        attachments: [{ id: 'attachment-1', originalName: 'mock.har' }],
        snapshot: {
          sessionId: 'support-session-1',
        },
      }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['har body'], 'mock.har', { type: 'application/json' });

    await uploadSupportWorkbenchAttachments('support-session-1', [file]);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/support-workbench/session/support-session-1/attachments',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: expect.any(FormData),
      })
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = (init as RequestInit).body as FormData;
    expect(body.getAll('files')).toEqual([file]);
  });
});
