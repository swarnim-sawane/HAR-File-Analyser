export type AnalyzerFileKind =
  | 'har'
  | 'log'
  | 'text'
  | 'structured'
  | 'table'
  | 'image'
  | 'document'
  | 'archive'
  | 'binary';

export type UploadFileType = AnalyzerFileKind;
export type BasicAnalyzerFileKind = Exclude<AnalyzerFileKind, 'har' | 'log'>;
export type ClassificationConfidence = 'high' | 'medium' | 'low';

export interface UploadFileClassification {
  analyzerKind: AnalyzerFileKind;
  displayKind: string;
  extension: string;
  mediaType: string;
  classificationConfidence: ClassificationConfidence;
  classificationReasons: string[];
  visualStatus: string;
  suggestedToolName: string;
}

const HAR_FILE_EXTENSIONS = ['.har', '.oc'] as const;
const LOG_FILE_EXTENSIONS = ['.log', '.txt', '.out'] as const;
const TEXT_FILE_EXTENSIONS = [
  '.trc',
  '.tdump',
  '.dmp',
  '.dump',
  '.trace',
  '.stack',
  '.md',
  '.sql',
  '.properties',
  '.conf',
  '.cfg',
  '.ini',
  '.env',
  '.java',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.scss',
  '.html',
  '.htm',
  '.sh',
  '.cmd',
  '.bat',
  '.ps1',
] as const;
const STRUCTURED_FILE_EXTENSIONS = ['.json', '.xml', '.yaml', '.yml', '.toml', '.jws', '.jpr'] as const;
const TABLE_FILE_EXTENSIONS = ['.csv', '.tsv'] as const;
const IMAGE_FILE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff'] as const;
const DOCUMENT_FILE_EXTENSIONS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'] as const;
const ARCHIVE_FILE_EXTENSIONS = ['.zip'] as const;

const DOCUMENT_MEDIA_TYPE_MAP: Record<string, string> = {
  'application/pdf': 'PDF document',
  'application/msword': 'Word document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
  'application/vnd.ms-powerpoint': 'PowerPoint document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint document',
  'application/vnd.ms-excel': 'Excel workbook',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel workbook',
};

export const HAR_FILE_INPUT_ACCEPT = `${HAR_FILE_EXTENSIONS.join(',')},application/json`;
// Empty accept means the unified picker allows all files. Classification decides
// whether a deep analyzer, basic preview, or metadata-only view should open.
export const UNIFIED_FILE_INPUT_ACCEPT = '';

function getExtension(fileName: string): string {
  const normalizedName = fileName.trim().toLowerCase();
  const lastDot = normalizedName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === normalizedName.length - 1) return '';
  return normalizedName.slice(lastDot);
}

function hasKnownExtension(fileName: string, extensions: readonly string[]): boolean {
  const normalizedName = fileName.trim().toLowerCase();

  return extensions.some((extension) => normalizedName.endsWith(extension));
}

function isJsonUploadCandidate(file: Pick<File, 'name' | 'type'>): boolean {
  return file.name.toLowerCase().endsWith('.json') || file.type === 'application/json';
}

function looksLikeHarSnippet(snippet: string): boolean {
  return /"log"\s*:\s*\{/.test(snippet) && /"entries"\s*:/.test(snippet);
}

function looksLikeAccessLogSnippet(snippet: string): boolean {
  return /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+HTTP\/\d(?:\.\d)?"/.test(snippet) ||
    /^\S+\s+\S+\s+\S+\s+\[[^\]]+\]\s+"(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/m.test(snippet);
}

function looksLikeOdlSnippet(snippet: string): boolean {
  return /\[[^\]]+\]\s+\[[^\]]+\]\s+\[(?:ERROR|WARNING|WARN|INCIDENT_ERROR|NOTIFICATION|TRACE|INFO|SEVERE)\]/i.test(snippet) ||
    /\b(?:oracle\.adf|ADFC-|ADF_FACES|ODL)\b/i.test(snippet);
}

function looksLikeCatalinaSnippet(snippet: string): boolean {
  return /\b(?:org\.apache\.catalina|StandardWrapperValve|Tomcat|catalina)\b/i.test(snippet) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{4}\s+(?:SEVERE|WARNING|INFO|FINE)/m.test(snippet);
}

function looksLikeBrowserConsoleSnippet(snippet: string): boolean {
  return /\b(?:TypeError|ReferenceError|SyntaxError|Unhandled Promise|Failed to load resource)\b/i.test(snippet) ||
    /(?:^|\s)(?:[\w.-]+\.(?:js|mjs|ts|tsx|jsx|css):\d+|\S+:\d+:\d+)\b/m.test(snippet);
}

function looksLikeJvmLogSnippet(snippet: string): boolean {
  return /\b(?:Full GC|Pause Young|Pause Old|\[gc\]|OutOfMemoryError|Java HotSpot|Garbage-First|G1 Evacuation)\b/i.test(snippet);
}

function looksLikeGenericLogSnippet(snippet: string): boolean {
  return /^\s*(?:\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}|\[[^\]]+\])?.*\b(?:ERROR|WARN|WARNING|INFO|DEBUG|TRACE|SEVERE|FATAL)\b/m.test(snippet);
}

function looksLikeThreadDumpSnippet(snippet: string): boolean {
  return /\bjava\.lang\.Thread\.State\b/.test(snippet) ||
    /^"[^"]+"\s+#?\d+.*\b(?:RUNNABLE|WAITING|BLOCKED|TIMED_WAITING)\b/m.test(snippet);
}

function looksLikeFormsTraceSnippet(snippet: string): boolean {
  return /\b(?:FRM-\d+|Forms Runtime|oracle\.forms|FORMS_TRACE|forms trace)\b/i.test(snippet);
}

function looksLikeJdbcDumpSnippet(snippet: string): boolean {
  return /\b(?:JDBC|Connection leak|leaked connection|oracle\.jdbc|weblogic\.jdbc)\b/i.test(snippet);
}

function getDocumentDisplayKind(extension: string, mediaType: string): string {
  if (mediaType && DOCUMENT_MEDIA_TYPE_MAP[mediaType]) {
    return DOCUMENT_MEDIA_TYPE_MAP[mediaType];
  }

  switch (extension) {
    case '.pdf':
      return 'PDF document';
    case '.doc':
    case '.docx':
      return 'Word document';
    case '.ppt':
    case '.pptx':
      return 'PowerPoint document';
    case '.xls':
    case '.xlsx':
      return 'Excel workbook';
    default:
      return 'Document';
  }
}

function createClassification(
  analyzerKind: AnalyzerFileKind,
  displayKind: string,
  file: File,
  options: {
    extension?: string;
    confidence?: ClassificationConfidence;
    reasons: string[];
    visualStatus?: string;
    suggestedToolName?: string;
  }
): UploadFileClassification {
  return {
    analyzerKind,
    displayKind,
    extension: options.extension ?? getExtension(file.name),
    mediaType: file.type || 'application/octet-stream',
    classificationConfidence: options.confidence ?? 'medium',
    classificationReasons: options.reasons,
    visualStatus: options.visualStatus ?? (analyzerKind === 'binary' ? 'Metadata ready' : 'Preview ready'),
    suggestedToolName: options.suggestedToolName ?? 'triage_text_diagnostics',
  };
}

function classifyLogSnippet(file: File, extension: string, snippet: string): UploadFileClassification {
  if (looksLikeOdlSnippet(snippet)) {
    return createClassification('log', 'ADF / ODL log', file, {
      extension,
      confidence: 'high',
      reasons: ['ODL/ADF markers detected in log text'],
      visualStatus: 'Visual ready',
      suggestedToolName: 'analyze_adf_logs',
    });
  }

  if (looksLikeAccessLogSnippet(snippet)) {
    return createClassification('log', 'Access log', file, {
      extension,
      confidence: 'high',
      reasons: ['HTTP access log pattern detected'],
      visualStatus: 'Visual ready',
      suggestedToolName: 'analyze_access_logs',
    });
  }

  if (looksLikeCatalinaSnippet(snippet)) {
    return createClassification('log', 'Tomcat / Catalina log', file, {
      extension,
      confidence: 'high',
      reasons: ['Tomcat/Catalina markers detected'],
      visualStatus: 'Visual ready',
      suggestedToolName: 'read_logs',
    });
  }

  if (looksLikeBrowserConsoleSnippet(snippet)) {
    return createClassification('log', 'Browser console log', file, {
      extension,
      confidence: 'high',
      reasons: ['Browser console error or source location detected'],
      visualStatus: 'Visual ready',
      suggestedToolName: 'read_logs',
    });
  }

  if (looksLikeJvmLogSnippet(snippet)) {
    return createClassification('log', 'JVM / GC log', file, {
      extension,
      confidence: 'high',
      reasons: ['JVM/GC markers detected'],
      visualStatus: 'Visual ready',
      suggestedToolName: 'analyze_jvm_logs',
    });
  }

  if (looksLikeGenericLogSnippet(snippet) || hasKnownExtension(file.name, LOG_FILE_EXTENSIONS)) {
    return createClassification('log', 'Generic log', file, {
      extension,
      confidence: hasKnownExtension(file.name, LOG_FILE_EXTENSIONS) ? 'medium' : 'low',
      reasons: hasKnownExtension(file.name, LOG_FILE_EXTENSIONS)
        ? ['Log extension detected']
        : ['Timestamp or severity markers detected'],
      visualStatus: 'Visual ready',
      suggestedToolName: 'read_logs',
    });
  }

  return createClassification('text', 'Text file', file, {
    extension,
    confidence: 'low',
    reasons: ['Readable plain text without a known log pattern'],
    suggestedToolName: 'triage_text_diagnostics',
  });
}

export function isHarFileCandidate(file: Pick<File, 'name' | 'type'>): boolean {
  return hasKnownExtension(file.name, HAR_FILE_EXTENSIONS) || isJsonUploadCandidate(file);
}

export async function classifyUploadFile(file: File): Promise<UploadFileClassification> {
  const extension = getExtension(file.name);
  const normalizedType = (file.type || '').toLowerCase();

  if (hasKnownExtension(file.name, HAR_FILE_EXTENSIONS)) {
    return createClassification('har', 'HAR', file, {
      extension,
      confidence: 'high',
      reasons: ['HAR capture extension detected'],
      visualStatus: 'Visual ready',
      suggestedToolName: 'analyze_har_file',
    });
  }

  if (normalizedType.startsWith('image/') || hasKnownExtension(file.name, IMAGE_FILE_EXTENSIONS)) {
    return createClassification('image', 'Image', file, {
      extension,
      confidence: 'high',
      reasons: ['Image media type or extension detected'],
      suggestedToolName: 'triage_text_diagnostics',
    });
  }

  if (
    hasKnownExtension(file.name, DOCUMENT_FILE_EXTENSIONS) ||
    Boolean(normalizedType && DOCUMENT_MEDIA_TYPE_MAP[normalizedType])
  ) {
    const displayKind = getDocumentDisplayKind(extension, normalizedType);
    return createClassification('document', displayKind, file, {
      extension,
      confidence: 'high',
      reasons: [`${displayKind.replace(' document', '')} extension or media type detected`],
      visualStatus: displayKind === 'PDF document' ? 'PDF preview ready' : 'Document preview ready',
      suggestedToolName: 'triage_customer_evidence',
    });
  }

  if (hasKnownExtension(file.name, ARCHIVE_FILE_EXTENSIONS) || normalizedType.includes('zip')) {
    return createClassification('archive', 'Archive', file, {
      extension,
      confidence: 'high',
      reasons: ['Archive extension or media type detected'],
      visualStatus: 'Bundle summary ready',
      suggestedToolName: 'analyze_incident',
    });
  }

  if (hasKnownExtension(file.name, TABLE_FILE_EXTENSIONS) || normalizedType === 'text/csv') {
    return createClassification('table', extension === '.tsv' ? 'TSV table' : 'CSV table', file, {
      extension,
      confidence: 'high',
      reasons: ['Delimited table extension detected'],
      suggestedToolName: 'triage_text_diagnostics',
    });
  }

  let snippet = '';
  const shouldReadSnippet =
    isJsonUploadCandidate(file) ||
    normalizedType.startsWith('text/') ||
    hasKnownExtension(file.name, LOG_FILE_EXTENSIONS) ||
    hasKnownExtension(file.name, TEXT_FILE_EXTENSIONS) ||
    hasKnownExtension(file.name, STRUCTURED_FILE_EXTENSIONS);

  if (shouldReadSnippet) {
    try {
      snippet = await file.slice(0, 65536).text();
    } catch {
      snippet = '';
    }
  }

  if (isJsonUploadCandidate(file)) {
    if (looksLikeHarSnippet(snippet)) {
      return createClassification('har', 'HAR', file, {
        extension,
        confidence: 'high',
        reasons: ['HAR-shaped JSON detected'],
        visualStatus: 'Visual ready',
        suggestedToolName: 'analyze_har_file',
      });
    }

    return createClassification('structured', 'JSON', file, {
      extension,
      confidence: 'high',
      reasons: ['JSON extension or media type detected'],
      suggestedToolName: 'triage_text_diagnostics',
    });
  }

  if (looksLikeThreadDumpSnippet(snippet) || extension === '.tdump') {
    return createClassification('text', 'Thread dump', file, {
      extension,
      confidence: looksLikeThreadDumpSnippet(snippet) ? 'high' : 'medium',
      reasons: looksLikeThreadDumpSnippet(snippet) ? ['Thread dump stack markers detected'] : ['Thread dump extension detected'],
      suggestedToolName: 'analyze_thread_dumps',
    });
  }

  if (looksLikeFormsTraceSnippet(snippet) || extension === '.trc' || extension === '.trace') {
    return createClassification('text', 'Forms trace', file, {
      extension,
      confidence: looksLikeFormsTraceSnippet(snippet) ? 'high' : 'medium',
      reasons: looksLikeFormsTraceSnippet(snippet) ? ['Oracle Forms trace markers detected'] : ['Trace extension detected'],
      suggestedToolName: 'review_forms_traces',
    });
  }

  if (looksLikeJdbcDumpSnippet(snippet)) {
    return createClassification('text', 'JDBC dump', file, {
      extension,
      confidence: 'high',
      reasons: ['JDBC connection markers detected'],
      suggestedToolName: 'analyze_jdbc_leaks',
    });
  }

  if (hasKnownExtension(file.name, LOG_FILE_EXTENSIONS) || looksLikeGenericLogSnippet(snippet)) {
    return classifyLogSnippet(file, extension, snippet);
  }

  if (hasKnownExtension(file.name, STRUCTURED_FILE_EXTENSIONS)) {
    const displayKind =
      extension === '.xml' ? 'XML' :
      extension === '.yaml' || extension === '.yml' ? 'YAML' :
      extension === '.toml' ? 'TOML' :
      extension === '.jws' || extension === '.jpr' ? 'JDeveloper workspace' :
      'Structured file';

    return createClassification('structured', displayKind, file, {
      extension,
      confidence: 'high',
      reasons: ['Structured data extension detected'],
      suggestedToolName: extension === '.jws' || extension === '.jpr' ? 'triage_text_diagnostics' : 'triage_text_diagnostics',
    });
  }

  if (hasKnownExtension(file.name, TEXT_FILE_EXTENSIONS) || normalizedType.startsWith('text/')) {
    return createClassification('text', 'Text file', file, {
      extension,
      confidence: normalizedType.startsWith('text/') ? 'medium' : 'high',
      reasons: normalizedType.startsWith('text/') ? ['Plain text media type detected'] : ['Text/source/config extension detected'],
      suggestedToolName: 'triage_text_diagnostics',
    });
  }

  return createClassification('binary', 'Binary attachment', file, {
    extension,
    confidence: extension ? 'medium' : 'low',
    reasons: extension ? ['No visual parser matched this extension'] : ['No extension or media type matched a visual parser'],
    visualStatus: 'Metadata ready',
    suggestedToolName: 'triage_text_diagnostics',
  });
}

export async function detectUploadFileType(file: File): Promise<UploadFileType> {
  return (await classifyUploadFile(file)).analyzerKind;
}
