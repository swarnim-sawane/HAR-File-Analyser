import path from 'path';
import type { McpEvidenceClassification } from './types';

const LOG_EXTENSIONS = new Set(['.log', '.out', '.err', '.trace', '.trc']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff']);
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx']);
const STRUCTURED_EXTENSIONS = new Set(['.json', '.xml', '.yaml', '.yml', '.toml']);
const TABLE_EXTENSIONS = new Set(['.csv', '.tsv']);
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.properties',
  '.conf',
  '.config',
  '.ini',
  '.sql',
  '.java',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.html',
  '.css',
  '.sh',
]);

export function classifyEvidenceFile(fileName: string, sample?: Buffer): McpEvidenceClassification {
  const extension = path.extname(fileName).toLowerCase();
  const sampleText = sample?.toString('utf8', 0, Math.min(sample.length, 2048)) ?? '';
  const trimmed = sampleText.trimStart();

  if (['.har', '.oc', '.ocp'].includes(extension) || looksHarShaped(trimmed)) {
    return classification('har', 'HAR', mediaTypeFor(extension), 'high', [
      extension === '.ocp' ? 'OCP Analysis Portal capture maps to HAR analyzer' : 'HAR-shaped capture detected',
    ]);
  }

  if (extension === '.zip') {
    return classification('archive', 'ZIP', 'application/zip', 'high', ['ZIP archive accepted as support evidence']);
  }

  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return classification(
      'document',
      extension === '.pdf' ? 'PDF' : 'DOC',
      extension === '.pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'high',
      ['Customer document evidence detected']
    );
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return classification('image', 'IMG', mediaTypeFor(extension), 'high', ['Screenshot or image evidence detected']);
  }

  if (TABLE_EXTENSIONS.has(extension)) {
    return classification('table', extension === '.tsv' ? 'TSV' : 'CSV', mediaTypeFor(extension), 'high', [
      'Delimited table evidence detected',
    ]);
  }

  if (LOG_EXTENSIONS.has(extension) || looksLogLike(trimmed)) {
    return classification('log', 'LOG', 'text/plain', 'high', ['Timestamp, severity, or log extension detected']);
  }

  if (STRUCTURED_EXTENSIONS.has(extension)) {
    return classification('structured', extension.slice(1).toUpperCase(), mediaTypeFor(extension), 'medium', [
      'Structured diagnostic/config file detected',
    ]);
  }

  if (TEXT_EXTENSIONS.has(extension) || looksTextLike(sample)) {
    return classification('text', 'TEXT', 'text/plain', 'medium', ['Readable text evidence detected']);
  }

  return classification('binary', 'BIN', 'application/octet-stream', 'low', [
    'Unsupported binary accepted as metadata-only evidence',
  ]);
}

function classification(
  analyzerKind: McpEvidenceClassification['analyzerKind'],
  displayKind: string,
  mediaType: string,
  confidence: McpEvidenceClassification['confidence'],
  reasons: string[]
): McpEvidenceClassification {
  return {
    analyzerKind,
    displayKind,
    mediaType,
    confidence,
    reasons,
  };
}

function looksHarShaped(sample: string): boolean {
  return /"log"\s*:\s*\{/.test(sample) && /"entries"\s*:\s*\[/.test(sample);
}

function looksLogLike(sample: string): boolean {
  return /\b(error|warn|warning|fatal|severe|exception)\b/i.test(sample) ||
    /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\b/.test(sample) ||
    /\b[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\b/.test(sample);
}

function looksTextLike(sample?: Buffer): boolean {
  if (!sample || sample.length === 0) return false;
  const inspected = sample.subarray(0, Math.min(sample.length, 512));
  let printable = 0;
  for (const byte of inspected) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
      printable += 1;
    }
  }
  return printable / inspected.length > 0.85;
}

function mediaTypeFor(extension: string): string {
  switch (extension) {
    case '.json':
    case '.har':
    case '.oc':
    case '.ocp':
      return 'application/json';
    case '.xml':
      return 'application/xml';
    case '.yaml':
    case '.yml':
      return 'application/yaml';
    case '.toml':
      return 'application/toml';
    case '.csv':
      return 'text/csv';
    case '.tsv':
      return 'text/tab-separated-values';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'text/plain';
  }
}
