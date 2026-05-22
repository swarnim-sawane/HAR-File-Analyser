import {
  classifyUploadFile,
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

    expect(detected).toBe('binary');
  });

  it.each([
    ['adf-diagnostic.log', '[2026-01-01T00:00:01.000+00:00] [AdminServer] [ERROR] [ADFC-64008] [oracle.adf] failed', 'log', 'ADF / ODL log'],
    ['browser-console.txt', 'main.js:42 TypeError: Cannot read properties of undefined', 'log', 'Browser console log'],
    ['access.log', '127.0.0.1 - - [01/Jan/2026:10:00:00 +0000] "GET /ords/status HTTP/1.1" 500 42', 'log', 'Access log'],
    ['catalina.out', '2026-01-01T10:00:00.000+0000 SEVERE [http-nio-8080-exec-1] org.apache.catalina.core.StandardWrapperValve.invoke failed', 'log', 'Tomcat / Catalina log'],
    ['thread.tdump', '"ExecuteThread: 1" #17 prio=5 os_prio=0 tid=0x01 nid=0x02 waiting on condition\n   java.lang.Thread.State: WAITING', 'text', 'Thread dump'],
    ['forms.trc', 'Forms Runtime Diagnostics: FRM-92101 stack trace', 'text', 'Forms trace'],
    ['jdbc-leak.dmp', 'JDBC leak detected: oracle.jdbc.driver.PhysicalConnection retained', 'text', 'JDBC dump'],
    ['gc.log', '[0.134s][info][gc] GC(0) Pause Young (Normal) 10M->4M(64M) 5.2ms', 'log', 'JVM / GC log'],
    ['workspace.jws', '<workspace><hash n="oracle.jdeveloper.model.JProject"/></workspace>', 'structured', 'JDeveloper workspace'],
    ['settings.yaml', 'server:\n  port: 7001', 'structured', 'YAML'],
    ['config.xml', '<server><name>AdminServer</name></server>', 'structured', 'XML'],
    ['rows.csv', 'name,status\nalpha,failed', 'table', 'CSV table'],
    ['screenshot.png', 'not-used', 'image', 'Image'],
    ['customer-evidence.pdf', '%PDF-1.7', 'document', 'PDF document'],
    ['customer-notes.docx', 'not-used', 'document', 'Word document'],
    ['legacy-notes.doc', 'not-used', 'document', 'Word document'],
    ['runbook.pptx', 'not-used', 'document', 'PowerPoint document'],
    ['spreadsheet.xlsx', 'not-used', 'document', 'Excel workbook'],
    ['incident.zip', 'not-used', 'archive', 'Archive'],
    ['heap.bin', 'not-used', 'binary', 'Binary attachment'],
  ] as const)('classifies %s as %s with a useful display kind', async (name, content, analyzerKind, displayKind) => {
    const file = makeFile(content, name, name.endsWith('.png') ? 'image/png' : '');
    const classification = await classifyUploadFile(file);

    expect(classification.analyzerKind).toBe(analyzerKind);
    expect(classification.displayKind).toBe(displayKind);
    expect(classification.classificationReasons.length).toBeGreaterThan(0);
    expect(classification.visualStatus).toMatch(/ready|preview|metadata/i);
  });
});
