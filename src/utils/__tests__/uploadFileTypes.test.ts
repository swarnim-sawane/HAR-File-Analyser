import {
  detectUploadFileType,
} from '../uploadFileTypes';

function makeHarJson() {
  return JSON.stringify({
    log: {
      version: '1.2',
      creator: { name: 'Vitest' },
      entries: [
        {
          startedDateTime: '2025-01-01T00:00:00.000Z',
          time: 24,
          request: {
            method: 'GET',
            url: 'https://example.com/api/status',
            headers: [],
            queryString: [],
            cookies: [],
            headersSize: -1,
            bodySize: 0,
          },
          response: {
            status: 200,
            statusText: 'OK',
            headers: [],
            cookies: [],
            content: {
              size: 0,
              mimeType: 'application/json',
              text: '{}',
            },
            redirectURL: '',
            headersSize: -1,
            bodySize: 0,
          },
          cache: {},
          timings: {
            blocked: 0,
            dns: 0,
            connect: 0,
            ssl: 0,
            send: 0,
            wait: 24,
            receive: 0,
          },
        },
      ],
    },
  });
}

function makeFile(content: string, name: string, type = ''): File {
  return new File([content], name, { type });
}

describe('uploadFileTypes', () => {
  it('treats .oc files as HAR even without a useful mime type', async () => {
    const detected = await detectUploadFileType(makeFile(makeHarJson(), 'capture.oc'));

    expect(detected).toBe('har');
  });

  it('keeps HAR-shaped .json uploads classified as HAR', async () => {
    const detected = await detectUploadFileType(
      makeFile(makeHarJson(), 'capture.json', 'application/json'),
    );

    expect(detected).toBe('har');
  });

  it('keeps .log and .txt uploads classified as console logs', async () => {
    await expect(detectUploadFileType(makeFile('Console ready', 'browser.log'))).resolves.toBe('log');
    await expect(detectUploadFileType(makeFile('Console ready', 'browser.txt', 'text/plain'))).resolves.toBe('log');
  });

  it('does not promote unknown non-json extensions to HAR', async () => {
    const detected = await detectUploadFileType(makeFile(makeHarJson(), 'capture.weird'));

    expect(detected).toBe('log');
  });
});
