import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

type UnifiedUploaderMockProps = {
  onHarFileUpload?: (result: {
    success: boolean;
    fileId: string;
    jobId: string;
    fileName: string;
    fileSize: number;
    hash: string;
    message: string;
  }, sourceFile: File) => void | Promise<void>;
  onLogFileUpload?: (result: {
    success: boolean;
    fileId: string;
    jobId: string;
    fileName: string;
    fileSize: number;
    hash: string;
    message: string;
  }, sourceFile: File) => void | Promise<void>;
  onBasicFileUpload?: (sourceFile: File, classification: {
    analyzerKind: 'text' | 'structured' | 'table' | 'image' | 'archive' | 'document' | 'binary';
    displayKind: string;
    extension: string;
    mediaType: string;
    classificationConfidence: 'high' | 'medium' | 'low';
    classificationReasons: string[];
    visualStatus: string;
    suggestedToolName: string;
  }) => void | Promise<void>;
  onOpenExistingRecentFile?: (file: { name: string; fileType: 'har' | 'log' }) => boolean | Promise<boolean>;
};

function createSizedFile(parts: BlobPart[], fileName: string, size: number, options?: FilePropertyBag): File {
  const file = new File(parts, fileName, options);
  Object.defineProperty(file, 'size', {
    configurable: true,
    value: size,
  });
  return file;
}

vi.mock('./components/UnifiedUploader', () => ({
  default: ({ onHarFileUpload, onLogFileUpload, onBasicFileUpload, onOpenExistingRecentFile }: UnifiedUploaderMockProps) => (
    <div>
      <div>Drop any file to get started</div>
      <button
        type="button"
        onClick={() => {
          const sourceFile = new File(['{"log":{"entries":[{"startedDateTime":"2026-01-01T00:00:00.000Z","request":{},"response":{}}]}}'], 'mock.har', {
            type: 'application/json',
          });
          void onHarFileUpload?.({
            success: true,
            fileId: 'mock-har-id',
            jobId: 'mock-job-id',
            fileName: 'mock.har',
            fileSize: 128,
            hash: 'mock-hash',
            message: 'ok',
          }, sourceFile);
        }}
      >
        Load mock HAR
      </button>
      <button
        type="button"
        onClick={() => {
          const firstFile = new File(['{"log":{"entries":[{"startedDateTime":"2026-01-01T00:00:00.000Z","request":{},"response":{}}]}}'], '2336486-Performance_issue.har', {
            type: 'application/json',
          });
          const secondFile = new File(['{"log":{"entries":[{"startedDateTime":"2026-01-01T00:00:01.000Z","request":{},"response":{}}]}}'], '2937373-VBS_slowness_issue.har', {
            type: 'application/json',
          });

          void (async () => {
            await onHarFileUpload?.({
              success: true,
              fileId: 'perf-har-id',
              jobId: 'perf-job-id',
              fileName: '2336486-Performance_issue.har',
              fileSize: 442496,
              hash: 'perf-hash',
              message: 'ok',
            }, firstFile);
            await onHarFileUpload?.({
              success: true,
              fileId: 'slowness-har-id',
              jobId: 'slowness-job-id',
              fileName: '2937373-VBS_slowness_issue.har',
              fileSize: 101711872,
              hash: 'slow-hash',
              message: 'ok',
            }, secondFile);
          })();
        }}
      >
        Load two HAR files
      </button>
      <button
        type="button"
        onClick={() => {
          const sourceFile = createSizedFile(
            ['{"log":{"entries":[{"startedDateTime":"2026-01-01T00:00:00.000Z","request":{},"response":{}}]}}'],
            'large-customer-capture.har',
            101_711_872,
            { type: 'application/json' }
          );
          void onHarFileUpload?.({
            success: true,
            fileId: 'large-har-id',
            jobId: 'large-har-job-id',
            fileName: 'large-customer-capture.har',
            fileSize: sourceFile.size,
            hash: 'large-har-hash',
            message: 'ok',
          }, sourceFile);
        }}
      >
        Load large HAR
      </button>
      <button
        type="button"
        onClick={() => {
          const harFile = new File(['{"log":{"entries":[{"startedDateTime":"2026-01-01T00:00:00.000Z","request":{},"response":{}}]}}'], 'network.har', {
            type: 'application/json',
          });
          const logFile = new File(['2026-01-01T00:00:01.000Z ERROR Something failed'], 'server.log', {
            type: 'text/plain',
          });

          void (async () => {
            await onHarFileUpload?.({
              success: true,
              fileId: 'network-har-id',
              jobId: 'network-job-id',
              fileName: 'network.har',
              fileSize: 95,
              hash: 'network-hash',
              message: 'ok',
            }, harFile);
            await onLogFileUpload?.({
              success: true,
              fileId: 'server-log-id',
              jobId: 'server-log-job-id',
              fileName: 'server.log',
              fileSize: logFile.size,
              hash: 'server-log-hash',
              message: 'ok',
            }, logFile);
          })();
        }}
      >
        Load HAR and log files
      </button>
      <button
        type="button"
        onClick={() => {
          void onOpenExistingRecentFile?.({
            name: '2336486-Performance_issue.har',
            fileType: 'har',
          });
        }}
      >
        Open recent existing HAR
      </button>
      <button
        type="button"
        onClick={() => {
          const diagnosticFile = new File(['FRM-92101 connection failed\njava.lang.Exception: sample'], 'forms-trace.trc', {
            type: 'text/plain',
          });
          void onBasicFileUpload?.(diagnosticFile, {
            analyzerKind: 'text',
            displayKind: 'Forms trace',
            extension: '.trc',
            mediaType: 'text/plain',
            classificationConfidence: 'high',
            classificationReasons: ['Trace extension detected'],
            visualStatus: 'Preview ready',
            suggestedToolName: 'review_forms_traces',
          });
        }}
      >
        Load text diagnostic
      </button>
      <button
        type="button"
        onClick={() => {
          const pdfFile = new File(['%PDF-1.7\n% customer screenshot notes'], 'customer-evidence.pdf', {
            type: 'application/pdf',
          });
          void onBasicFileUpload?.(pdfFile, {
            analyzerKind: 'document',
            displayKind: 'PDF document',
            extension: '.pdf',
            mediaType: 'application/pdf',
            classificationConfidence: 'high',
            classificationReasons: ['PDF extension or media type detected'],
            visualStatus: 'Document preview ready',
            suggestedToolName: 'triage_customer_evidence',
          });
        }}
      >
        Load customer PDF
      </button>
      <button
        type="button"
        onClick={() => {
          const documentXml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
            '<w:body><w:p><w:r><w:t>Customer escalation notes from uploaded DOCX</w:t></w:r></w:p></w:body>',
            '</w:document>',
          ].join('');
          const fileName = 'word/document.xml';
          const nameBytes = new Uint8Array(Array.from(fileName).map(char => char.charCodeAt(0)));
          const contentBytes = new Uint8Array(Array.from(documentXml).map(char => char.charCodeAt(0)));
          const localHeaderLength = 30 + nameBytes.length;
          const centralDirectoryOffset = localHeaderLength + contentBytes.length;
          const centralDirectoryLength = 46 + nameBytes.length;
          const totalLength = centralDirectoryOffset + centralDirectoryLength + 22;
          const docxBytes = new Uint8Array(totalLength);
          const view = new DataView(docxBytes.buffer);

          const writeBytes = (offset: number, bytes: Uint8Array) => {
            docxBytes.set(bytes, offset);
          };

          view.setUint32(0, 0x04034b50, true);
          view.setUint16(4, 20, true);
          view.setUint16(8, 0, true);
          view.setUint32(14, 0, true);
          view.setUint32(18, contentBytes.length, true);
          view.setUint32(22, contentBytes.length, true);
          view.setUint16(26, nameBytes.length, true);
          writeBytes(30, nameBytes);
          writeBytes(localHeaderLength, contentBytes);

          view.setUint32(centralDirectoryOffset, 0x02014b50, true);
          view.setUint16(centralDirectoryOffset + 4, 20, true);
          view.setUint16(centralDirectoryOffset + 6, 20, true);
          view.setUint16(centralDirectoryOffset + 10, 0, true);
          view.setUint32(centralDirectoryOffset + 16, 0, true);
          view.setUint32(centralDirectoryOffset + 20, contentBytes.length, true);
          view.setUint32(centralDirectoryOffset + 24, contentBytes.length, true);
          view.setUint16(centralDirectoryOffset + 28, nameBytes.length, true);
          view.setUint32(centralDirectoryOffset + 42, 0, true);
          writeBytes(centralDirectoryOffset + 46, nameBytes);

          const eocdOffset = centralDirectoryOffset + centralDirectoryLength;
          view.setUint32(eocdOffset, 0x06054b50, true);
          view.setUint16(eocdOffset + 8, 1, true);
          view.setUint16(eocdOffset + 10, 1, true);
          view.setUint32(eocdOffset + 12, centralDirectoryLength, true);
          view.setUint32(eocdOffset + 16, centralDirectoryOffset, true);

          const docxFile = new File([docxBytes], 'customer-notes.docx', {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          });
          void onBasicFileUpload?.(docxFile, {
            analyzerKind: 'document',
            displayKind: 'Word document',
            extension: '.docx',
            mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            classificationConfidence: 'high',
            classificationReasons: ['Word extension or media type detected'],
            visualStatus: 'Document preview ready',
            suggestedToolName: 'triage_customer_evidence',
          });
        }}
      >
        Load customer DOCX
      </button>
      <button
        type="button"
        onClick={() => {
          const fileName = '6368374-repojvm_node7.log';
          const content = '2026-01-01T00:00:01.000Z ERROR JVM node failed';
          const nameBytes = new Uint8Array(Array.from(fileName).map(char => char.charCodeAt(0)));
          const contentBytes = new Uint8Array(Array.from(content).map(char => char.charCodeAt(0)));
          const localHeaderLength = 30 + nameBytes.length;
          const centralDirectoryOffset = localHeaderLength + contentBytes.length;
          const centralDirectoryLength = 46 + nameBytes.length;
          const totalLength = centralDirectoryOffset + centralDirectoryLength + 22;
          const zipBytes = new Uint8Array(totalLength);
          const view = new DataView(zipBytes.buffer);

          const writeBytes = (offset: number, bytes: Uint8Array) => {
            zipBytes.set(bytes, offset);
          };

          view.setUint32(0, 0x04034b50, true);
          view.setUint16(4, 20, true);
          view.setUint16(8, 0, true);
          view.setUint32(14, 0, true);
          view.setUint32(18, contentBytes.length, true);
          view.setUint32(22, contentBytes.length, true);
          view.setUint16(26, nameBytes.length, true);
          writeBytes(30, nameBytes);
          writeBytes(localHeaderLength, contentBytes);

          view.setUint32(centralDirectoryOffset, 0x02014b50, true);
          view.setUint16(centralDirectoryOffset + 4, 20, true);
          view.setUint16(centralDirectoryOffset + 6, 20, true);
          view.setUint16(centralDirectoryOffset + 10, 0, true);
          view.setUint32(centralDirectoryOffset + 16, 0, true);
          view.setUint32(centralDirectoryOffset + 20, contentBytes.length, true);
          view.setUint32(centralDirectoryOffset + 24, contentBytes.length, true);
          view.setUint16(centralDirectoryOffset + 28, nameBytes.length, true);
          view.setUint32(centralDirectoryOffset + 42, 0, true);
          writeBytes(centralDirectoryOffset + 46, nameBytes);

          const eocdOffset = centralDirectoryOffset + centralDirectoryLength;
          view.setUint32(eocdOffset, 0x06054b50, true);
          view.setUint16(eocdOffset + 8, 1, true);
          view.setUint16(eocdOffset + 10, 1, true);
          view.setUint32(eocdOffset + 12, centralDirectoryLength, true);
          view.setUint32(eocdOffset + 16, centralDirectoryOffset, true);

          const zipFile = new File([zipBytes], 'sr-bundle.zip', {
            type: 'application/x-zip-compressed',
          });

          void onBasicFileUpload?.(zipFile, {
            analyzerKind: 'archive',
            displayKind: 'Archive',
            extension: '.zip',
            mediaType: 'application/x-zip-compressed',
            classificationConfidence: 'high',
            classificationReasons: ['Archive extension or media type detected'],
            visualStatus: 'Bundle summary ready',
            suggestedToolName: 'analyze_incident',
          });
        }}
      >
        Load ZIP with log
      </button>
      <button
        type="button"
        onClick={() => {
          const entries = [
            {
              name: 'large-bundle/server-diagnostic.log',
              content: '2026-01-01T00:00:01.000Z ERROR Large bundle child failed',
            },
            {
              name: 'large-bundle/forms-trace.trc',
              content: 'FRM-92101 connection failed in large bundle',
            },
          ].map(entry => ({
            ...entry,
            nameBytes: new Uint8Array(Array.from(entry.name).map(char => char.charCodeAt(0))),
            contentBytes: new Uint8Array(Array.from(entry.content).map(char => char.charCodeAt(0))),
            localHeaderOffset: 0,
          }));
          const localLength = entries.reduce((total, entry) => total + 30 + entry.nameBytes.length + entry.contentBytes.length, 0);
          const paddingLength = 33 * 1024 * 1024;
          const centralDirectoryOffset = localLength + paddingLength;
          const centralDirectoryLength = entries.reduce((total, entry) => total + 46 + entry.nameBytes.length, 0);
          const totalLength = centralDirectoryOffset + centralDirectoryLength + 22;
          const zipBytes = new Uint8Array(totalLength);
          const view = new DataView(zipBytes.buffer);

          const writeBytes = (offset: number, bytes: Uint8Array) => {
            zipBytes.set(bytes, offset);
          };

          let localOffset = 0;
          for (const entry of entries) {
            entry.localHeaderOffset = localOffset;
            view.setUint32(localOffset, 0x04034b50, true);
            view.setUint16(localOffset + 4, 20, true);
            view.setUint16(localOffset + 8, 0, true);
            view.setUint32(localOffset + 14, 0, true);
            view.setUint32(localOffset + 18, entry.contentBytes.length, true);
            view.setUint32(localOffset + 22, entry.contentBytes.length, true);
            view.setUint16(localOffset + 26, entry.nameBytes.length, true);
            writeBytes(localOffset + 30, entry.nameBytes);
            writeBytes(localOffset + 30 + entry.nameBytes.length, entry.contentBytes);
            localOffset += 30 + entry.nameBytes.length + entry.contentBytes.length;
          }

          let centralOffset = centralDirectoryOffset;
          for (const entry of entries) {
            view.setUint32(centralOffset, 0x02014b50, true);
            view.setUint16(centralOffset + 4, 20, true);
            view.setUint16(centralOffset + 6, 20, true);
            view.setUint16(centralOffset + 10, 0, true);
            view.setUint32(centralOffset + 16, 0, true);
            view.setUint32(centralOffset + 20, entry.contentBytes.length, true);
            view.setUint32(centralOffset + 24, entry.contentBytes.length, true);
            view.setUint16(centralOffset + 28, entry.nameBytes.length, true);
            view.setUint32(centralOffset + 42, entry.localHeaderOffset, true);
            writeBytes(centralOffset + 46, entry.nameBytes);
            centralOffset += 46 + entry.nameBytes.length;
          }

          const eocdOffset = centralDirectoryOffset + centralDirectoryLength;
          view.setUint32(eocdOffset, 0x06054b50, true);
          view.setUint16(eocdOffset + 8, entries.length, true);
          view.setUint16(eocdOffset + 10, entries.length, true);
          view.setUint32(eocdOffset + 12, centralDirectoryLength, true);
          view.setUint32(eocdOffset + 16, centralDirectoryOffset, true);

          const largeZipFile = new File([zipBytes], 'large-incident-bundle.zip', {
            type: 'application/x-zip-compressed',
          });

          void onBasicFileUpload?.(largeZipFile, {
            analyzerKind: 'archive',
            displayKind: 'Archive',
            extension: '.zip',
            mediaType: 'application/x-zip-compressed',
            classificationConfidence: 'high',
            classificationReasons: ['Archive extension or media type detected'],
            visualStatus: 'Bundle summary ready',
            suggestedToolName: 'analyze_incident',
          });
        }}
      >
        Load large ZIP
      </button>
      <button
        type="button"
        onClick={() => {
          const createStoredZipBytes = (entries: Array<{ name: string; content: string | Uint8Array }>, paddingLength = 0) => {
            const zipEntries = entries.map(entry => {
              const contentBytes = typeof entry.content === 'string'
                ? new Uint8Array(Array.from(entry.content).map(char => char.charCodeAt(0)))
                : entry.content;
              return {
                ...entry,
                nameBytes: new Uint8Array(Array.from(entry.name).map(char => char.charCodeAt(0))),
                contentBytes,
                localHeaderOffset: 0,
              };
            });
            const localLength = zipEntries.reduce((total, entry) => total + 30 + entry.nameBytes.length + entry.contentBytes.length, 0);
            const centralDirectoryOffset = localLength + paddingLength;
            const centralDirectoryLength = zipEntries.reduce((total, entry) => total + 46 + entry.nameBytes.length, 0);
            const totalLength = centralDirectoryOffset + centralDirectoryLength + 22;
            const zipBytes = new Uint8Array(totalLength);
            const view = new DataView(zipBytes.buffer);
            const writeBytes = (offset: number, bytes: Uint8Array) => {
              zipBytes.set(bytes, offset);
            };

            let localOffset = 0;
            for (const entry of zipEntries) {
              entry.localHeaderOffset = localOffset;
              view.setUint32(localOffset, 0x04034b50, true);
              view.setUint16(localOffset + 4, 20, true);
              view.setUint16(localOffset + 8, 0, true);
              view.setUint32(localOffset + 14, 0, true);
              view.setUint32(localOffset + 18, entry.contentBytes.length, true);
              view.setUint32(localOffset + 22, entry.contentBytes.length, true);
              view.setUint16(localOffset + 26, entry.nameBytes.length, true);
              writeBytes(localOffset + 30, entry.nameBytes);
              writeBytes(localOffset + 30 + entry.nameBytes.length, entry.contentBytes);
              localOffset += 30 + entry.nameBytes.length + entry.contentBytes.length;
            }

            let centralOffset = centralDirectoryOffset;
            for (const entry of zipEntries) {
              view.setUint32(centralOffset, 0x02014b50, true);
              view.setUint16(centralOffset + 4, 20, true);
              view.setUint16(centralOffset + 6, 20, true);
              view.setUint16(centralOffset + 10, 0, true);
              view.setUint32(centralOffset + 16, 0, true);
              view.setUint32(centralOffset + 20, entry.contentBytes.length, true);
              view.setUint32(centralOffset + 24, entry.contentBytes.length, true);
              view.setUint16(centralOffset + 28, entry.nameBytes.length, true);
              view.setUint32(centralOffset + 42, entry.localHeaderOffset, true);
              writeBytes(centralOffset + 46, entry.nameBytes);
              centralOffset += 46 + entry.nameBytes.length;
            }

            const eocdOffset = centralDirectoryOffset + centralDirectoryLength;
            view.setUint32(eocdOffset, 0x06054b50, true);
            view.setUint16(eocdOffset + 8, zipEntries.length, true);
            view.setUint16(eocdOffset + 10, zipEntries.length, true);
            view.setUint32(eocdOffset + 12, centralDirectoryLength, true);
            view.setUint32(eocdOffset + 16, centralDirectoryOffset, true);

            return zipBytes;
          };

          const innerZipBytes = createStoredZipBytes([
            {
              name: 'diagnostics/forms-runtime.log',
              content: '2026-01-01T00:00:01.000Z ERROR nested bundle failure',
            },
          ]);
          const outerZipBytes = createStoredZipBytes([
            {
              name: 'V1045122-01.zip',
              content: innerZipBytes,
            },
          ], 33 * 1024 * 1024);
          const nestedZipFile = new File([outerZipBytes], 'V1045122-01.zip', {
            type: 'application/x-zip-compressed',
          });

          void onBasicFileUpload?.(nestedZipFile, {
            analyzerKind: 'archive',
            displayKind: 'Archive',
            extension: '.zip',
            mediaType: 'application/x-zip-compressed',
            classificationConfidence: 'high',
            classificationReasons: ['Archive extension or media type detected'],
            visualStatus: 'Bundle summary ready',
            suggestedToolName: 'analyze_incident',
          });
        }}
      >
        Load nested SR ZIP
      </button>
    </div>
  ),
}));

vi.mock('./components/HarTabContent', () => ({
  default: () => <div>HAR tab content mock</div>,
}));

vi.mock('./components/ConsoleLogTabContent', () => ({
  default: () => <div>Console tab content mock</div>,
}));

vi.mock('./utils/consoleLogParser', () => ({
  ConsoleLogParser: {
    parseFile: vi.fn(async (file: File) => ({
      metadata: {
        fileName: file.name,
        uploadedAt: '2026-01-01T00:00:00.000Z',
        totalEntries: 1,
      },
      entries: [
        {
          id: 'entry-1',
          index: 0,
          timestamp: '2026-01-01T00:00:01.000Z',
          level: 'error',
          message: 'Something failed',
          inferredSeverity: 'error',
          issueTags: [],
        },
      ],
    })),
  },
}));

vi.mock('./components/HarCompare', () => ({
  default: () => <div data-testid="har-compare">Compare mock</div>,
}));

vi.mock('./components/HarSanitizer', () => ({
  default: () => <div>Sanitizer mock</div>,
}));

const setPath = (path: string) => {
  window.history.replaceState({}, '', path);
};

const getHarTab = (fileName: string): HTMLElement => {
  const tab = screen.getAllByTitle(fileName).find(element => element.classList.contains('har-file-tab'));
  if (!tab) throw new Error(`HAR tab not found for ${fileName}`);
  return tab;
};

const queryHarTab = (fileName: string): HTMLElement | undefined =>
  screen.queryAllByTitle(fileName).find(element => element.classList.contains('har-file-tab'));

const originalMatchMedia = window.matchMedia;
const originalFetch = globalThis.fetch;

const setPrefersDark = (prefersDark: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })),
  });
};

const resetThemeEnvironment = () => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
};

beforeEach(() => {
  resetThemeEnvironment();
  setPrefersDark(false);
  setPath('/');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/support-workbench/session') && !url.includes('/attachments')) {
      return {
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
      } as Response;
    }

    if (url.includes('/api/support-workbench/session/support-session-1/attachments')) {
      return {
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
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
    } as Response;
  }));
});

afterAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: originalMatchMedia,
  });
  vi.stubGlobal('fetch', originalFetch);
});

describe('App theme behavior', () => {
  it.each(['light', 'dark', 'redwood'] as const)('restores a saved %s theme on mount', (savedTheme) => {
    window.localStorage.setItem('theme', savedTheme);

    render(<App />);

    expect(document.documentElement.dataset.theme).toBe(savedTheme);
    expect(document.documentElement.style.colorScheme).toBe(savedTheme === 'dark' ? 'dark' : 'light');
    expect(screen.getByRole('radio', { name: new RegExp(`${savedTheme} theme`, 'i') })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('keeps a pre-mounted root dataset theme before consulting storage or media', () => {
    document.documentElement.dataset.theme = 'redwood';
    window.localStorage.setItem('theme', 'dark');
    setPrefersDark(true);

    render(<App />);

    expect(document.documentElement.dataset.theme).toBe('redwood');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(screen.getByRole('radio', { name: /redwood theme/i })).toHaveAttribute('aria-checked', 'true');
  });

  it.each([
    { prefersDark: false, expectedTheme: 'light' },
    { prefersDark: true, expectedTheme: 'dark' },
  ])('uses the system $expectedTheme theme when there is no saved preference', ({ prefersDark, expectedTheme }) => {
    setPrefersDark(prefersDark);

    render(<App />);

    expect(document.documentElement.dataset.theme).toBe(expectedTheme);
    expect(document.documentElement.style.colorScheme).toBe(expectedTheme);
    expect(screen.getByRole('radio', { name: new RegExp(`${expectedTheme} theme`, 'i') })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('updates the root theme and persisted preference when a theme is selected', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('radiogroup', { name: /theme/i })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /redwood theme/i }));
    expect(document.documentElement.dataset.theme).toBe('redwood');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(window.localStorage.getItem('theme')).toBe('redwood');
    expect(screen.getByRole('radio', { name: /redwood theme/i })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('radio', { name: /dark theme/i }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem('theme')).toBe('dark');
    expect(screen.getByRole('radio', { name: /dark theme/i })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('App documentation navigation', () => {
  it('reveals the analysis toolbar after upload and keeps the uploaded file available to AI Diagnosis', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText('Drop any file to get started')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ai diagnosis/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /analysis toolbar/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /load mock har/i }));

    const visualAnalysis = screen.getByRole('region', { name: /visual analysis/i });
    expect(visualAnalysis).toBeVisible();
    expect(screen.getByRole('heading', { name: /support analyzer workbench/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /visual analysis/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /ai diagnosis/i })).toHaveAttribute('aria-pressed', 'false');

    const analysisToolbar = screen.getByRole('region', { name: /analysis toolbar/i });
    expect(analysisToolbar).toHaveTextContent('Tools');
    expect(analysisToolbar).toHaveTextContent('1 file');
    const uploadButton = within(analysisToolbar).getByRole('button', { name: /^upload$/i });
    expect(uploadButton).toBeInTheDocument();
    expect(within(analysisToolbar).queryByRole('button', { name: /upload new/i })).not.toBeInTheDocument();
    expect(analysisToolbar).not.toHaveTextContent('Visual ready');
    expect(analysisToolbar).not.toHaveTextContent('AI synced');
    expect(analysisToolbar).not.toHaveTextContent('AI sync failed');
    expect(analysisToolbar).not.toHaveTextContent('Current file');
    expect(analysisToolbar).not.toHaveTextContent('mock.har');
    expect(analysisToolbar).not.toHaveTextContent('Workspace');

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/support-workbench/session',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
        })
      );
    });
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/support-workbench/session/support-session-1/attachments',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: expect.any(FormData),
        })
      );
    });
    expect(analysisToolbar).not.toHaveTextContent('AI synced');

    await user.click(uploadButton);
    const uploadDialog = screen.getByRole('dialog', { name: /^upload$/i });
    expect(uploadDialog).toBeInTheDocument();
    expect(within(uploadDialog).getByText('Drop any file to get started')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close upload dialog/i }));
    expect(screen.queryByRole('dialog', { name: /^upload$/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ai diagnosis/i }));

    expect(visualAnalysis).not.toBeVisible();
    expect(screen.getByRole('region', { name: /ai diagnosis/i })).toBeVisible();
    expect(screen.getByTitle(/ai diagnosis/i)).toHaveAttribute(
      'src',
      'http://localhost:4173/?sessionId=support-session-1&embedded=1&theme=light'
    );
    expect(screen.getByRole('button', { name: /visual analysis/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /ai diagnosis/i })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /visual analysis/i }));

    expect(visualAnalysis).toBeVisible();
  });

  it('syncs large HAR captures to AI Diagnosis instead of treating them like oversized archive bundles', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load large har/i }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/support-workbench/session/support-session-1/attachments',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: expect.any(FormData),
        })
      );
    });

    const attachmentCall = vi.mocked(globalThis.fetch).mock.calls.find(([input]) =>
      String(input).includes('/api/support-workbench/session/support-session-1/attachments')
    );
    const uploadedFiles = (attachmentCall?.[1]?.body as FormData).getAll('files') as File[];
    expect(uploadedFiles.map(file => file.name)).toEqual(['large-customer-capture.har']);
  });

  it('shows zero files in the toolbar when all analyzer tabs are closed', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load mock har/i }));

    const analysisToolbar = screen.getByRole('region', { name: /analysis toolbar/i });
    expect(analysisToolbar).toHaveTextContent('1 file');

    await user.click(screen.getByRole('button', { name: /close mock\.har/i }));

    expect(screen.getByRole('region', { name: /no analyzer tabs open/i })).toBeInTheDocument();
    expect(analysisToolbar).toHaveTextContent('0 files');
    expect(analysisToolbar).not.toHaveTextContent('1 file');
  });

  it('keeps the embedded AI Diagnosis frame loaded when the shell theme changes', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load mock har/i }));
    await user.click(screen.getByRole('button', { name: /ai diagnosis/i }));

    const aiFrame = screen.getByTitle(/ai diagnosis/i) as HTMLIFrameElement;
    const initialFrameSrc = aiFrame.getAttribute('src');
    const postMessageSpy = vi.spyOn(aiFrame.contentWindow as Window, 'postMessage');

    await user.click(screen.getByRole('radio', { name: /dark theme/i }));

    expect(aiFrame.getAttribute('src')).toBe(initialFrameSrc);
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'support-workbench:set-theme', theme: 'dark' },
      'http://localhost:4173'
    );
  });

  it('places Analyzer, HAR Compare, and HAR Sanitizer in the tools menu without showing a workspace drawer', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load two har files/i }));

    await waitFor(() => {
      expect(getHarTab('2937373-VBS_slowness_issue.har')).toHaveClass('active');
    });

    const analysisToolbar = screen.getByRole('region', { name: /analysis toolbar/i });
    expect(analysisToolbar).toHaveTextContent('2 files');
    expect(analysisToolbar).not.toHaveTextContent('2937373-VBS_slowness_issue.har');
    expect(screen.queryByRole('dialog', { name: /workspace/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open tools/i }));

    const menu = screen.getByRole('menu', { name: /tools/i });
    expect(within(menu).getByRole('menuitemradio', { name: /analyzer/i })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByRole('menuitemradio', { name: /har compare/i })).toHaveAttribute('aria-checked', 'false');
    expect(within(menu).getByRole('menuitemradio', { name: /har sanitizer/i })).toHaveAttribute('aria-checked', 'false');

    await user.click(within(menu).getByRole('menuitemradio', { name: /har compare/i }));

    expect(screen.getByTestId('har-compare')).toBeVisible();
    expect(screen.queryByRole('menu', { name: /tools/i })).not.toBeInTheDocument();
  });

  it('switches to an already-open analyzer tab when the same recent file is selected', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load two har files/i }));

    await waitFor(() => {
      expect(getHarTab('2937373-VBS_slowness_issue.har')).toHaveClass('active');
    });

    const analysisToolbar = screen.getByRole('region', { name: /analysis toolbar/i });
    await user.click(within(analysisToolbar).getByRole('button', { name: /^upload$/i }));

    const uploadDialog = screen.getByRole('dialog', { name: /^upload$/i });
    await user.click(within(uploadDialog).getByRole('button', { name: /open recent existing har/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /^upload$/i })).not.toBeInTheDocument();
      expect(getHarTab('2336486-Performance_issue.har')).toHaveClass('active');
    });
    expect(getHarTab('2937373-VBS_slowness_issue.har')).not.toHaveClass('active');
    expect(screen.getAllByTitle('2336486-Performance_issue.har')).toHaveLength(1);
  });

  it('uses one analyzer file tab row for HAR and console log files', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load har and log files/i }));

    await waitFor(() => {
      expect(getHarTab('server.log')).toHaveClass('active');
    });

    await user.click(screen.getByRole('button', { name: /open tools/i }));
    expect(
      within(screen.getByRole('menu', { name: /tools/i })).getByRole('menuitemradio', { name: /analyzer/i })
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('button', { name: /^har$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^console$/i })).not.toBeInTheDocument();

    const tabRow = screen.getByLabelText(/analyzer files/i);
    expect(within(tabRow).getByTitle('network.har')).toBeInTheDocument();
    expect(within(tabRow).getByTitle('server.log')).toBeInTheDocument();
    expect(within(tabRow).getByText('HAR')).toHaveClass('analyzer-file-type-har');
    expect(within(tabRow).getByText('LOG')).toHaveClass('analyzer-file-type-log');

    await user.click(getHarTab('network.har'));

    expect(getHarTab('network.har')).toHaveClass('active');
    expect(getHarTab('server.log')).not.toHaveClass('active');
  });

  it('shows a useful visual empty state when every analyzer tab is closed', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load har and log files/i }));

    await waitFor(() => {
      expect(getHarTab('server.log')).toHaveClass('active');
    });

    await user.click(screen.getByRole('button', { name: /close server\.log/i }));
    await waitFor(() => {
      expect(getHarTab('network.har')).toHaveClass('active');
    });

    await user.click(screen.getByRole('button', { name: /close network\.har/i }));

    expect(screen.getByRole('region', { name: /no analyzer tabs open/i })).toBeVisible();
    expect(screen.queryByLabelText(/analyzer files/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open network\.har/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open server\.log/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open network\.har/i }));

    expect(getHarTab('network.har')).toHaveClass('active');
    expect(screen.getByText('HAR tab content mock')).toBeInTheDocument();
  });

  it('routes non-HAR and non-log uploads into a basic analyzer tab with AI Diagnosis handoff', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load text diagnostic/i }));

    const tabRow = await screen.findByLabelText(/analyzer files/i);
    expect(within(tabRow).getByTitle('forms-trace.trc')).toBeInTheDocument();
    expect(within(tabRow).getByText('TRACE')).toHaveClass('analyzer-file-type-text');
    expect(screen.getByRole('heading', { name: /forms trace/i })).toBeInTheDocument();
    expect(screen.getByText(/preview ready/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ask ai diagnosis about this file/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ask ai diagnosis about this file/i }));

    expect(screen.getByRole('region', { name: /ai diagnosis/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /ai diagnosis/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('routes PDF customer evidence into a document analyzer tab', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load customer pdf/i }));

    const tabRow = await screen.findByLabelText(/analyzer files/i);
    expect(within(tabRow).getByTitle('customer-evidence.pdf')).toBeInTheDocument();
    expect(within(tabRow).getByText('PDF')).toHaveClass('analyzer-file-type-document');
    const summary = screen.getByLabelText(/pdf document summary/i);
    expect(within(summary).getByText('customer-evidence.pdf')).toBeInTheDocument();
    expect(within(summary).getByText('application/pdf')).toBeInTheDocument();
    expect(screen.queryByLabelText(/file classification/i)).not.toBeInTheDocument();
    expect(screen.getByTitle('PDF preview for customer-evidence.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ask ai diagnosis about this file/i }));

    expect(screen.getByRole('region', { name: /ai diagnosis/i })).toBeVisible();
    const attachmentCall = vi.mocked(globalThis.fetch).mock.calls.find(([input]) =>
      String(input).includes('/api/support-workbench/session/support-session-1/attachments')
    );
    const uploadedFiles = ((attachmentCall?.[1] as RequestInit).body as FormData).getAll('files') as File[];
    expect(uploadedFiles.map(file => file.name)).toContain('customer-evidence.pdf');
  });

  it('routes Word DOCX customer evidence into a document analyzer tab with extracted text', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load customer docx/i }));

    const tabRow = await screen.findByLabelText(/analyzer files/i);
    expect(within(tabRow).getByTitle('customer-notes.docx')).toBeInTheDocument();
    expect(within(tabRow).getByText('DOC')).toHaveClass('analyzer-file-type-document');
    const summary = screen.getByLabelText(/word document summary/i);
    expect(within(summary).getByText('customer-notes.docx')).toBeInTheDocument();
    expect(within(summary).getByText('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBeInTheDocument();
    expect(await screen.findByText(/Customer escalation notes from uploaded DOCX/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ask ai diagnosis about this file/i }));

    expect(screen.getByRole('region', { name: /ai diagnosis/i })).toBeVisible();
    const attachmentCall = vi.mocked(globalThis.fetch).mock.calls.find(([input]) =>
      String(input).includes('/api/support-workbench/session/support-session-1/attachments')
    );
    const uploadedFiles = ((attachmentCall?.[1] as RequestInit).body as FormData).getAll('files') as File[];
    expect(uploadedFiles.map(file => file.name)).toContain('customer-notes.docx');
  });

  it('automatically opens a log analyzer tab when a readable ZIP has one log child', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load zip with log/i }));

    await waitFor(() => {
      expect(getHarTab('6368374-repojvm_node7.log')).toHaveClass('active');
    });
    const tabRow = screen.getByLabelText(/analyzer files/i);
    expect(within(tabRow).getByTitle('sr-bundle.zip')).toBeInTheDocument();
    expect(within(tabRow).getByText('LOG')).toHaveClass('analyzer-file-type-log');
    expect(screen.getByText('Console tab content mock')).toBeInTheDocument();
  });

  it('keeps a ZIP tab selectable after auto-opening its child and does not reopen a closed child tab', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load zip with log/i }));

    await waitFor(() => {
      expect(getHarTab('6368374-repojvm_node7.log')).toHaveClass('active');
    });

    await user.click(getHarTab('sr-bundle.zip'));
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 50));
    });

    expect(getHarTab('sr-bundle.zip')).toHaveClass('active');
    expect(getHarTab('6368374-repojvm_node7.log')).not.toHaveClass('active');
    expect(screen.getByRole('heading', { name: /archive/i })).toBeInTheDocument();

    await user.click(getHarTab('6368374-repojvm_node7.log'));
    await waitFor(() => {
      expect(getHarTab('6368374-repojvm_node7.log')).toHaveClass('active');
    });

    await user.click(screen.getByRole('button', { name: /close 6368374-repojvm_node7\.log/i }));
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 50));
    });

    expect(queryHarTab('6368374-repojvm_node7.log')).toBeUndefined();
    expect(getHarTab('sr-bundle.zip')).toHaveClass('active');
  });

  it('can send all readable ZIP children to AI Diagnosis as chat attachments', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load zip with log/i }));

    await waitFor(() => {
      expect(getHarTab('6368374-repojvm_node7.log')).toHaveClass('active');
    });

    await user.click(getHarTab('sr-bundle.zip'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send all files to ai diagnosis/i })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: /send all files to ai diagnosis/i }));

    await waitFor(() => {
      const attachmentCalls = vi.mocked(globalThis.fetch).mock.calls.filter(([input]) =>
        String(input).includes('/api/support-workbench/session/support-session-1/attachments')
      );
      expect(attachmentCalls.length).toBeGreaterThanOrEqual(2);
      const lastBody = attachmentCalls.at(-1)?.[1]?.body;
      expect(lastBody).toBeInstanceOf(FormData);
      const uploadedFiles = (lastBody as FormData).getAll('files') as File[];
      expect(uploadedFiles.map(file => file.name)).toEqual(['6368374-repojvm_node7.log']);
    });

    expect(screen.getByRole('region', { name: /ai diagnosis/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /ai diagnosis/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('presents large ZIP files as AI Diagnosis handoff bundles instead of empty archives', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load large zip/i }));
    await waitFor(() => {
      expect(getHarTab('large-incident-bundle.zip')).toBeInTheDocument();
    });
    await user.click(getHarTab('large-incident-bundle.zip'));

    expect(await screen.findByRole('heading', { name: /archive/i })).toBeInTheDocument();
    expect(screen.getAllByText('large-incident-bundle.zip').length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByText('large-bundle/server-diagnostic.log')).toBeInTheDocument();
    });
    expect(screen.getByText('large-bundle/forms-trace.trc')).toBeInTheDocument();
    expect(screen.getByText('2 entries')).toBeInTheDocument();
    expect(screen.getByText('2 AI-ready')).toBeInTheDocument();
    expect(screen.getAllByText(/large bundle/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/extracted child files/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /send all files to ai diagnosis/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open in ai diagnosis/i }));

    expect(screen.getByRole('region', { name: /ai diagnosis/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /ai diagnosis/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('extracts large ZIP children before opening AI Diagnosis instead of syncing the full archive', async () => {
    const user = userEvent.setup();
    const attachmentRequests: RequestInit[] = [];

    vi.mocked(globalThis.fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/support-workbench/session') && !url.includes('/attachments')) {
        return {
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
        } as Response;
      }

      if (url.includes('/api/support-workbench/session/support-session-1/attachments')) {
        attachmentRequests.push(init ?? {});
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            accepted: true,
            attachments: [{ id: 'attachment-large-child', originalName: 'large-bundle-child.log' }],
            snapshot: {
              sessionId: 'support-session-1',
            },
          }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      } as Response;
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: /load large zip/i }));
    await waitFor(() => {
      expect(getHarTab('large-incident-bundle.zip')).toBeInTheDocument();
    });
    await user.click(getHarTab('large-incident-bundle.zip'));
    await screen.findByRole('button', { name: /open in ai diagnosis/i });

    await user.click(screen.getByRole('button', { name: /open in ai diagnosis/i }));

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /ai diagnosis/i })).toBeVisible();
    });
    expect(screen.getByRole('button', { name: /ai diagnosis/i })).toHaveAttribute('aria-pressed', 'true');
    const uploadedNames = attachmentRequests.flatMap(request =>
      (request.body as FormData).getAll('files').map(file => (file as File).name)
    );
    expect(uploadedNames).toEqual([
      'large-bundle__server-diagnostic.log',
      'large-bundle__forms-trace.trc',
    ]);
    expect(uploadedNames).not.toContain('large-incident-bundle.zip');
  });

  it('opens a large SR ZIP with one nested ZIP down to its readable log child', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load nested sr zip/i }));

    await waitFor(() => {
      expect(getHarTab('forms-runtime.log')).toHaveClass('active');
    });
    expect(getHarTab('V1045122-01.zip')).toBeInTheDocument();
    expect(screen.getByText('Console tab content mock')).toBeInTheDocument();
  });

  it('unpacks nested ZIP children before opening AI Diagnosis from the outer SR ZIP', async () => {
    const user = userEvent.setup();
    const attachmentRequests: RequestInit[] = [];

    vi.mocked(globalThis.fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/support-workbench/session') && !url.includes('/attachments')) {
        return {
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
        } as Response;
      }

      if (url.includes('/api/support-workbench/session/support-session-1/attachments')) {
        attachmentRequests.push(init ?? {});
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            accepted: true,
            attachments: [{ id: 'attachment-nested-child', originalName: 'forms-runtime.log' }],
            snapshot: {
              sessionId: 'support-session-1',
            },
          }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      } as Response;
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: /load nested sr zip/i }));
    await waitFor(() => {
      expect(getHarTab('V1045122-01.zip')).toBeInTheDocument();
    });
    await user.click(getHarTab('V1045122-01.zip'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open in ai diagnosis/i })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: /open in ai diagnosis/i }));

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /ai diagnosis/i })).toBeVisible();
    });
    const lastUploadBody = attachmentRequests.at(-1)?.body as FormData;
    const uploadedNames = lastUploadBody.getAll('files').map(file => (file as File).name);
    expect(uploadedNames).toEqual(['V1045122-01__diagnostics__forms-runtime.log']);
  });

  it('mounts the compare workspace inside a persistent shell wrapper', () => {
    render(<App />);

    const compareWrapper = screen.getByTestId('har-compare').closest('.compare-wrapper');

    expect(compareWrapper).not.toBeNull();
  });

  it('resets the persistent compare shell scroll when returning to Compare', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load mock har/i }));
    await user.click(screen.getByRole('button', { name: /open tools/i }));
    await user.click(within(screen.getByRole('menu', { name: /tools/i })).getByRole('menuitemradio', { name: /har compare/i }));

    const compareWrapper = screen.getByTestId('har-compare').closest('.compare-wrapper') as HTMLDivElement | null;
    expect(compareWrapper).not.toBeNull();

    const scrollToMock = vi.fn(({ top }: ScrollToOptions) => {
      compareWrapper!.scrollTop = Number(top ?? 0);
    });
    Object.defineProperty(compareWrapper as HTMLDivElement, 'scrollTo', {
      configurable: true,
      value: scrollToMock,
    });

    compareWrapper!.scrollTop = 420;
    scrollToMock.mockClear();

    await user.click(screen.getByRole('button', { name: /open tools/i }));
    await user.click(within(screen.getByRole('menu', { name: /tools/i })).getByRole('menuitemradio', { name: /analyzer/i }));
    await user.click(screen.getByRole('button', { name: /open tools/i }));
    await user.click(within(screen.getByRole('menu', { name: /tools/i })).getByRole('menuitemradio', { name: /har compare/i }));

    expect(scrollToMock).toHaveBeenCalledWith({
      top: 0,
      behavior: 'auto',
    });
    expect(compareWrapper!.scrollTop).toBe(0);
  });

  it('navigates to the documentation page and back from the header control', async () => {
    const user = userEvent.setup();
    render(<App />);
    const pocBadge = screen.getByText(/proof of concept/i);

    expect(screen.getByText('Drop any file to get started')).toBeInTheDocument();
    expect(pocBadge).toBeInTheDocument();
    expect(pocBadge.closest('.app-header-center')).not.toBeNull();
    expect(pocBadge.closest('.app-header-actions')).toBeNull();

    await user.click(screen.getByRole('button', { name: /documentation/i }));
    expect(screen.getByRole('heading', { name: /support analyzer workbench documentation/i })).toBeInTheDocument();
    expect(screen.getByText(/proof of concept/i)).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /back to analyzer/i })[0]);
    expect(screen.getByText('Drop any file to get started')).toBeInTheDocument();
  });

  it('renders documentation directly when the docs route is loaded first', () => {
    setPath('/docs');
    render(<App />);
    const pocBadge = screen.getByText(/proof of concept/i);

    expect(screen.getByRole('heading', { name: /support analyzer workbench documentation/i })).toBeInTheDocument();
    expect(pocBadge).toBeInTheDocument();
    expect(pocBadge.closest('.app-header-center')).not.toBeNull();
    expect(pocBadge.closest('.app-header-actions')).toBeNull();
    expect(screen.getByRole('heading', { name: /common scenarios/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /documentation section navigation/i })).toBeInTheDocument();
  });

  it('opens the dedicated MCP services page from documentation', async () => {
    const user = userEvent.setup();
    setPath('/docs');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /mcp access/i }));

    expect(window.location.pathname).toBe('/docs/mcp');
    expect(screen.getByRole('heading', { name: /support analyzer mcp service access/i })).toBeInTheDocument();
    expect(screen.getByText(/remote VCAP service/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /available mcp services/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /docs index/i }));
    expect(window.location.pathname).toBe('/docs');
    expect(screen.getByRole('heading', { name: /support analyzer workbench documentation/i })).toBeInTheDocument();
  });

  it('renders the dedicated MCP services page directly', () => {
    setPath('/docs/mcp');
    render(<App />);

    expect(screen.getByRole('heading', { name: /support analyzer mcp service access/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy client config/i })).toBeInTheDocument();
    expect(screen.getByText(/vcap experimental deployment/i)).toBeInTheDocument();
  });

  it('updates the docs hash and active nav item when a sidebar link is clicked', async () => {
    const user = userEvent.setup();
    setPath('/docs');
    render(<App />);

    const docsNav = screen.getByRole('navigation', { name: /documentation section navigation/i });
    const targetLink = within(docsNav).getByRole('link', { name: /supported files and routing/i });
    await user.click(targetLink);

    expect(window.location.hash).toBe('#supported-file-types');
    expect(targetLink).toHaveAttribute('aria-current', 'location');
  });

  it('highlights the matching sidebar link when docs loads with a hash', () => {
    setPath('/docs#supported-file-types');
    render(<App />);

    const docsNav = screen.getByRole('navigation', { name: /documentation section navigation/i });
    expect(within(docsNav).getByRole('link', { name: /supported files and routing/i })).toHaveAttribute('aria-current', 'location');
  });

  it('updates the visible page when browser history emits popstate', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /documentation/i }));
    expect(screen.getByRole('heading', { name: /support analyzer workbench documentation/i })).toBeInTheDocument();

    act(() => {
      setPath('/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.getByText('Drop any file to get started')).toBeInTheDocument();
  });

  it('updates the active docs link when browser history changes hashes', async () => {
    const user = userEvent.setup();
    setPath('/docs');
    render(<App />);

    const docsNav = screen.getByRole('navigation', { name: /documentation section navigation/i });
    await user.click(within(docsNav).getByRole('link', { name: /supported files and routing/i }));
    expect(within(docsNav).getByRole('link', { name: /supported files and routing/i })).toHaveAttribute('aria-current', 'location');

    act(() => {
      setPath('/docs#what-this-product-is');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(within(docsNav).getByRole('link', { name: /what this product is/i })).toHaveAttribute('aria-current', 'location');
  });
});
