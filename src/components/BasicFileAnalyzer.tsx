import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BasicAnalyzerFileKind, ClassificationConfidence } from '../utils/uploadFileTypes';

interface ArchiveEntrySummary {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
  isDirectory: boolean;
}

interface BasicFileAnalyzerProps {
  file: File;
  fileName: string;
  fileSize: number;
  analyzerKind: BasicAnalyzerFileKind;
  displayKind: string;
  mediaType: string;
  extension: string;
  classificationConfidence: ClassificationConfidence;
  classificationReasons: string[];
  visualStatus: string;
  suggestedToolName: string;
  isActive: boolean;
  onAskAiDiagnosis: () => void | Promise<void>;
  onOpenArchiveEntry?: (file: File) => void | Promise<void>;
  onUploadArchiveEntriesToAi?: (files: File[]) => void | Promise<void>;
  autoOpenedArchiveEntryKey?: string | null;
  onArchiveAutoOpen?: (entryKey: string) => void;
}

const TEXT_PREVIEW_LIMIT_BYTES = 512 * 1024;
const ARCHIVE_INDEX_LIMIT_BYTES = 32 * 1024 * 1024;
const ARCHIVE_CENTRAL_DIRECTORY_READ_LIMIT_BYTES = 16 * 1024 * 1024;
const ARCHIVE_BULK_AI_ENTRY_LIMIT_BYTES = 50 * 1024 * 1024;
const ARCHIVE_NESTED_AI_ARCHIVE_LIMIT = 5;
const MAX_TEXT_LINES = 600;
const MAX_TABLE_ROWS = 200;
const OFFICE_TEXT_PART_LIMIT_BYTES = 2 * 1024 * 1024;
const OFFICE_TOTAL_PREVIEW_CHARS = 120000;

const confidenceLabel: Record<ClassificationConfidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function parseDelimitedLine(line: string, delimiter: ',' | '\t'): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function isPdfDocument(extension: string, mediaType: string): boolean {
  return extension === '.pdf' || mediaType.toLowerCase() === 'application/pdf';
}

function isOpenXmlDocument(extension: string): boolean {
  return extension === '.docx' || extension === '.pptx' || extension === '.xlsx';
}

function getDocumentShortLabel(extension: string): string {
  if (extension === '.pdf') return 'PDF';
  if (extension === '.doc' || extension === '.docx') return 'DOC';
  if (extension === '.ppt' || extension === '.pptx') return 'PPT';
  if (extension === '.xls' || extension === '.xlsx') return 'XLS';
  return 'DOC';
}

function decodeXmlEntityText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractVisibleTextFromOfficeXml(xmlText: string): string {
  if (typeof DOMParser !== 'undefined') {
    const parsed = new DOMParser().parseFromString(xmlText, 'application/xml');
    const allElements = Array.from(parsed.getElementsByTagName('*'));
    const hasParseError = allElements.some(element => element.localName === 'parsererror');

    if (!hasParseError) {
      const collectText = (element: Element): string => Array.from(element.getElementsByTagName('*'))
        .filter(child => child.localName === 't' || child.localName === 'v')
        .map(child => child.textContent ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      const paragraphTexts = allElements
        .filter(element => element.localName === 'p' || element.localName === 'si' || element.localName === 'row')
        .map(collectText)
        .filter(Boolean);

      if (paragraphTexts.length > 0) {
        return paragraphTexts.join('\n');
      }

      return allElements
        .filter(element => element.localName === 't' || element.localName === 'v')
        .map(element => element.textContent?.trim() ?? '')
        .filter(Boolean)
        .join('\n');
    }
  }

  return Array.from(xmlText.matchAll(/<(?:\w+:)?(?:t|v)[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:t|v)>/g))
    .map(match => decodeXmlEntityText(match[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function parseArchiveEntriesFromCentralDirectory(
  buffer: ArrayBuffer,
  entryCount: number,
): ArchiveEntrySummary[] {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const entries: ArchiveEntrySummary[] = [];
  let offset = 0;

  for (let index = 0; index < entryCount && offset + 46 <= view.byteLength; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const fileCommentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;

    if (fileNameEnd > view.byteLength) break;

    const name = decoder.decode(new Uint8Array(buffer, fileNameStart, fileNameLength));
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    });
    offset = fileNameEnd + extraFieldLength + fileCommentLength;
  }

  return entries;
}

function parseArchiveEntries(buffer: ArrayBuffer): ArchiveEntrySummary[] {
  const view = new DataView(buffer);
  const minEocdSize = 22;
  const maxCommentSize = 0xffff;
  const scanStart = Math.max(0, view.byteLength - minEocdSize - maxCommentSize);
  let eocdOffset = -1;

  for (let offset = view.byteLength - minEocdSize; offset >= scanStart; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset === -1) return [];

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  if (centralDirectoryOffset + centralDirectorySize > view.byteLength) return [];

  return parseArchiveEntriesFromCentralDirectory(
    buffer.slice(centralDirectoryOffset, centralDirectoryOffset + centralDirectorySize),
    entryCount,
  );
}

async function readArchiveEntries(archiveFile: File): Promise<ArchiveEntrySummary[]> {
  if (archiveFile.size <= ARCHIVE_INDEX_LIMIT_BYTES) {
    return parseArchiveEntries(await archiveFile.arrayBuffer());
  }

  const minEocdSize = 22;
  const maxCommentSize = 0xffff;
  const tailSize = Math.min(archiveFile.size, minEocdSize + maxCommentSize);
  const tailStart = archiveFile.size - tailSize;
  const tailBuffer = await archiveFile.slice(tailStart).arrayBuffer();
  const tailView = new DataView(tailBuffer);
  let eocdOffset = -1;

  for (let offset = tailView.byteLength - minEocdSize; offset >= 0; offset -= 1) {
    if (tailView.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('ZIP directory could not be found.');
  }

  const entryCount = tailView.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = tailView.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = tailView.getUint32(eocdOffset + 16, true);
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error('ZIP64 directory indexing is not supported in the browser preview yet.');
  }
  if (centralDirectorySize > ARCHIVE_CENTRAL_DIRECTORY_READ_LIMIT_BYTES) {
    throw new Error('ZIP directory is too large to index in the browser preview.');
  }
  if (centralDirectoryOffset + centralDirectorySize > archiveFile.size) {
    throw new Error('ZIP directory points outside the archive.');
  }

  const centralDirectoryBuffer = await archiveFile
    .slice(centralDirectoryOffset, centralDirectoryOffset + centralDirectorySize)
    .arrayBuffer();
  return parseArchiveEntriesFromCentralDirectory(centralDirectoryBuffer, entryCount);
}

function inferArchiveChildMediaType(fileName: string): string {
  const normalizedName = fileName.toLowerCase();
  if (normalizedName.endsWith('.json') || normalizedName.endsWith('.har') || normalizedName.endsWith('.oc')) return 'application/json';
  if (normalizedName.endsWith('.zip')) return 'application/x-zip-compressed';
  if (normalizedName.endsWith('.pdf')) return 'application/pdf';
  if (normalizedName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (normalizedName.endsWith('.doc')) return 'application/msword';
  if (normalizedName.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (normalizedName.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (normalizedName.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (normalizedName.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (normalizedName.endsWith('.xml')) return 'application/xml';
  if (normalizedName.endsWith('.csv')) return 'text/csv';
  if (normalizedName.endsWith('.tsv')) return 'text/tab-separated-values';
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/.test(normalizedName)) {
    const extension = normalizedName.split('.').pop() || 'png';
    return `image/${extension === 'jpg' ? 'jpeg' : extension}`;
  }
  if (/\.(log|txt|out|trc|trace|tdump|dmp|dump|properties|conf|cfg|ini|yaml|yml|toml|java|js|ts|tsx|jsx|css|html|htm|sql|md)$/.test(normalizedName)) {
    return 'text/plain';
  }
  return 'application/octet-stream';
}

function isArchiveFileName(fileName: string): boolean {
  return /\.zip$/i.test(fileName);
}

function isAnalyzerSupportedArchiveChild(entry: ArchiveEntrySummary): boolean {
  if (entry.isDirectory) return false;
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) return false;
  return /\.(har|oc|json|log|txt|out|trc|trace|tdump|dmp|dump|stack|csv|tsv|xml|ya?ml|toml|properties|conf|cfg|ini|env|jws|jpr|sql|md|java|js|ts|tsx|jsx|css|html?|png|jpe?g|gif|webp|bmp|tiff?|pdf|docx?|pptx?|xlsx?|zip)$/i.test(entry.name);
}

function isExtractableArchiveChild(entry: ArchiveEntrySummary): boolean {
  return !entry.isDirectory && (entry.compressionMethod === 0 || entry.compressionMethod === 8);
}

function isDirectAiReadyArchiveChild(entry: ArchiveEntrySummary): boolean {
  return isAnalyzerSupportedArchiveChild(entry) &&
    !isArchiveFileName(entry.name) &&
    entry.uncompressedSize <= ARCHIVE_BULK_AI_ENTRY_LIMIT_BYTES;
}

function isNestedArchiveAiCandidate(entry: ArchiveEntrySummary): boolean {
  if (!isArchiveFileName(entry.name) || !isExtractableArchiveChild(entry)) return false;
  // Stored ZIP children can be represented as a Blob slice, so even large SR
  // bundles can be indexed without materializing the full nested archive.
  return entry.compressionMethod === 0 || entry.uncompressedSize <= ARCHIVE_BULK_AI_ENTRY_LIMIT_BYTES;
}

function getArchiveChildFileName(entryName: string, preservePathName = false): string {
  const parts = entryName.split(/[\\/]/).filter(Boolean);
  if (preservePathName) return parts.join('__') || entryName || 'archive-child';
  return parts.pop() || entryName || 'archive-child';
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function inflateZipDeflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Deflated ZIP entries require browser decompression support.');
  }

  const formats = ['deflate-raw', 'deflate'] as const;
  let lastError: unknown = null;

  for (const format of formats) {
    try {
      const stream = new Blob([bytesToArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream(format as CompressionFormat));
      const inflated = await new Response(stream).arrayBuffer();
      return new Uint8Array(inflated);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('ZIP entry could not be decompressed.');
}

async function extractArchiveEntry(
  archiveFile: File,
  entry: ArchiveEntrySummary,
  options: { preservePathName?: boolean } = {}
): Promise<File> {
  const localHeaderOffset = entry.localHeaderOffset;
  const localHeaderBuffer = await archiveFile.slice(localHeaderOffset, localHeaderOffset + 30).arrayBuffer();
  const view = new DataView(localHeaderBuffer);

  if (localHeaderOffset < 0 || view.byteLength < 30) {
    throw new Error('ZIP entry header is outside the archive.');
  }

  if (view.getUint32(0, true) !== 0x04034b50) {
    throw new Error('ZIP entry local header is invalid.');
  }

  const fileNameLength = view.getUint16(26, true);
  const extraFieldLength = view.getUint16(28, true);
  const compressedStart = localHeaderOffset + 30 + fileNameLength + extraFieldLength;
  const compressedEnd = compressedStart + entry.compressedSize;

  if (compressedEnd > archiveFile.size) {
    throw new Error('ZIP entry data is outside the archive.');
  }

  const childFileName = getArchiveChildFileName(entry.name, options.preservePathName);
  const childMediaType = inferArchiveChildMediaType(childFileName);

  if (entry.compressionMethod === 0) {
    return new File([archiveFile.slice(compressedStart, compressedEnd)], childFileName, {
      type: childMediaType,
    });
  }

  const compressedBytes = new Uint8Array(await archiveFile.slice(compressedStart, compressedEnd).arrayBuffer());
  let extractedBytes: Uint8Array;

  if (entry.compressionMethod === 8) {
    extractedBytes = await inflateZipDeflate(compressedBytes);
  } else {
    throw new Error(`ZIP compression method ${entry.compressionMethod} is not supported in the browser preview.`);
  }

  return new File([bytesToArrayBuffer(extractedBytes)], childFileName, {
    type: childMediaType,
  });
}

function prefixNestedArchiveChildFile(nestedArchiveEntry: ArchiveEntrySummary, childFile: File): File {
  const nestedArchiveName = getArchiveChildFileName(nestedArchiveEntry.name, true).replace(/\.zip$/i, '');
  const prefixedName = nestedArchiveName ? `${nestedArchiveName}__${childFile.name}` : childFile.name;

  return new File([childFile], prefixedName, {
    type: childFile.type || inferArchiveChildMediaType(childFile.name),
  });
}

function getOfficePreviewEntries(entries: ArchiveEntrySummary[], extension: string): ArchiveEntrySummary[] {
  if (extension === '.docx') {
    return entries.filter(entry => /^word\/document\.xml$/i.test(entry.name));
  }

  if (extension === '.pptx') {
    return entries
      .filter(entry => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  if (extension === '.xlsx') {
    return entries
      .filter(entry =>
        /^xl\/sharedStrings\.xml$/i.test(entry.name) ||
        /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name)
      )
      .sort((a, b) => {
        if (/sharedStrings\.xml$/i.test(a.name)) return -1;
        if (/sharedStrings\.xml$/i.test(b.name)) return 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });
  }

  return [];
}

async function extractOfficeDocumentPreview(file: File, extension: string): Promise<string> {
  const entries = await readArchiveEntries(file);
  const previewEntries = getOfficePreviewEntries(entries, extension)
    .filter(entry => isExtractableArchiveChild(entry) && entry.uncompressedSize <= OFFICE_TEXT_PART_LIMIT_BYTES);

  if (previewEntries.length === 0) {
    throw new Error('No previewable Office text part was found.');
  }

  const sections: string[] = [];
  let totalChars = 0;

  for (const entry of previewEntries) {
    if (totalChars >= OFFICE_TOTAL_PREVIEW_CHARS) break;

    const partFile = await extractArchiveEntry(file, entry);
    const xmlText = await partFile.text();
    const visibleText = extractVisibleTextFromOfficeXml(xmlText);
    if (!visibleText) continue;

    const sectionText = `[${entry.name}]\n${visibleText}`;
    sections.push(sectionText);
    totalChars += sectionText.length;
  }

  const previewText = sections.join('\n\n').slice(0, OFFICE_TOTAL_PREVIEW_CHARS);
  if (!previewText.trim()) {
    throw new Error('The Office document did not expose readable text in the local preview.');
  }

  return previewText;
}

const BasicFileAnalyzer: React.FC<BasicFileAnalyzerProps> = ({
  file,
  fileName,
  fileSize,
  analyzerKind,
  displayKind,
  mediaType,
  extension,
  classificationConfidence,
  classificationReasons,
  visualStatus,
  suggestedToolName,
  isActive,
  onAskAiDiagnosis,
  onOpenArchiveEntry,
  onUploadArchiveEntriesToAi,
  autoOpenedArchiveEntryKey,
  onArchiveAutoOpen,
}) => {
  const [previewText, setPreviewText] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [structuredMode, setStructuredMode] = useState<'tree' | 'raw'>('tree');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [archiveEntries, setArchiveEntries] = useState<ArchiveEntrySummary[]>([]);
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null);
  const [archiveActionMessage, setArchiveActionMessage] = useState<string | null>(null);
  const [isArchiveBulkUploading, setIsArchiveBulkUploading] = useState(false);
  const [aiDiagnosisMessage, setAiDiagnosisMessage] = useState<string | null>(null);
  const [isAiDiagnosisOpening, setIsAiDiagnosisOpening] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const autoOpenedArchiveEntryRef = useRef<string | null>(autoOpenedArchiveEntryKey ?? null);

  useEffect(() => {
    autoOpenedArchiveEntryRef.current = autoOpenedArchiveEntryKey ?? null;
  }, [autoOpenedArchiveEntryKey]);

  useEffect(() => {
    if (!isActive) return undefined;

    setPreviewText('');
    setPreviewError(null);
    setArchiveEntries([]);
    setArchiveNotice(null);
    setArchiveActionMessage(null);
    setIsArchiveBulkUploading(false);
    setAiDiagnosisMessage(null);
    setIsAiDiagnosisOpening(false);
    setCopyStatus('idle');
    setIsPreviewLoading(false);
    setImageUrl(null);
    setDocumentUrl(null);

    if (analyzerKind === 'image') {
      if (typeof URL.createObjectURL !== 'function') {
        setPreviewError('Image preview is not available in this browser.');
        return undefined;
      }

      const nextImageUrl = URL.createObjectURL(file);
      setImageUrl(nextImageUrl);
      return () => URL.revokeObjectURL(nextImageUrl);
    }

    if (analyzerKind === 'document') {
      if (isPdfDocument(extension, mediaType)) {
        if (typeof URL.createObjectURL !== 'function') {
          setPreviewError('PDF preview is not available in this browser.');
          return undefined;
        }

        const nextDocumentUrl = URL.createObjectURL(file);
        setDocumentUrl(nextDocumentUrl);
        return () => URL.revokeObjectURL(nextDocumentUrl);
      }

      if (isOpenXmlDocument(extension)) {
        let cancelled = false;
        setIsPreviewLoading(true);
        extractOfficeDocumentPreview(file, extension)
          .then((text) => {
            if (!cancelled) setPreviewText(text);
          })
          .catch((error) => {
            if (!cancelled) {
              const message = error instanceof Error ? error.message : 'Document preview text could not be extracted locally.';
              setPreviewError(message);
            }
          })
          .finally(() => {
            if (!cancelled) setIsPreviewLoading(false);
          });

        return () => {
          cancelled = true;
        };
      }

      return undefined;
    }

    if (analyzerKind === 'archive') {
      let cancelled = false;
      setIsPreviewLoading(true);
      readArchiveEntries(file)
        .then((entries) => {
          if (cancelled) return;
          setArchiveEntries(entries);
          setArchiveNotice(
            entries.length === 0
              ? 'Archive metadata was accepted, but entries could not be indexed in the browser preview.'
              : file.size > ARCHIVE_INDEX_LIMIT_BYTES
              ? 'Large ZIP directory indexed without loading the full archive. AI Diagnosis receives extracted child files, not the full bundle.'
              : null
          );
        })
        .catch((error) => {
          if (!cancelled) {
            const message = error instanceof Error ? error.message : 'Archive entries could not be read in the browser preview.';
            setArchiveNotice(message);
          }
        })
        .finally(() => {
          if (!cancelled) setIsPreviewLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }

    if (analyzerKind === 'binary') return undefined;

    let cancelled = false;
    setIsPreviewLoading(true);
    file.slice(0, TEXT_PREVIEW_LIMIT_BYTES).text()
      .then((text) => {
        if (!cancelled) setPreviewText(text);
      })
      .catch(() => {
        if (!cancelled) setPreviewError('Preview text could not be extracted in the browser.');
      })
      .finally(() => {
        if (!cancelled) setIsPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [analyzerKind, extension, file, isActive, mediaType]);

  const structuredPreview = useMemo(() => {
    if (analyzerKind !== 'structured' || !previewText.trim()) {
      return { status: 'Waiting for preview text', text: previewText };
    }

    if (extension === '.json' || mediaType.includes('json')) {
      try {
        return {
          status: 'Valid JSON',
          text: JSON.stringify(JSON.parse(previewText), null, 2),
        };
      } catch (err) {
        return {
          status: `Invalid JSON: ${err instanceof Error ? err.message : 'parse failed'}`,
          text: previewText,
        };
      }
    }

    if (extension === '.xml' || previewText.trim().startsWith('<')) {
      return {
        status: previewText.trim().startsWith('<') ? 'XML text preview' : 'XML validation unavailable',
        text: previewText,
      };
    }

    return {
      status: `${displayKind} raw preview`,
      text: previewText,
    };
  }, [analyzerKind, displayKind, extension, mediaType, previewText]);

  const textLines = useMemo(() => {
    const sourceText = analyzerKind === 'structured' && structuredMode === 'tree'
      ? structuredPreview.text
      : previewText;
    const lines = sourceText.split(/\r?\n/).slice(0, MAX_TEXT_LINES);
    const normalizedSearch = searchTerm.trim().toLowerCase();

    if (!normalizedSearch) return lines.map((line, index) => ({ line, originalLineNumber: index + 1 }));

    return lines
      .map((line, index) => ({ line, originalLineNumber: index + 1 }))
      .filter((entry) => entry.line.toLowerCase().includes(normalizedSearch));
  }, [analyzerKind, previewText, searchTerm, structuredMode, structuredPreview.text]);

  const tablePreview = useMemo(() => {
    if (analyzerKind !== 'table') return { headers: [] as string[], rows: [] as string[][], totalRows: 0 };
    const delimiter: ',' | '\t' = extension === '.tsv' ? '\t' : ',';
    const sourceLines = previewText.split(/\r?\n/).filter(Boolean);
    const [headerLine, ...rowLines] = sourceLines;
    const headers = headerLine ? parseDelimitedLine(headerLine, delimiter) : [];
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const parsedRows = rowLines
      .map((line) => parseDelimitedLine(line, delimiter))
      .filter((row) => !normalizedSearch || row.join(' ').toLowerCase().includes(normalizedSearch));

    return {
      headers,
      rows: parsedRows.slice(0, MAX_TABLE_ROWS),
      totalRows: rowLines.length,
    };
  }, [analyzerKind, extension, previewText, searchTerm]);

  const directAiArchiveEntries = useMemo(
    () => archiveEntries.filter(isDirectAiReadyArchiveChild),
    [archiveEntries]
  );
  const nestedArchiveEntries = useMemo(
    () => archiveEntries.filter(isNestedArchiveAiCandidate).slice(0, ARCHIVE_NESTED_AI_ARCHIVE_LIMIT),
    [archiveEntries]
  );
  const archiveAiHandoffItemCount = directAiArchiveEntries.length + nestedArchiveEntries.length;
  const canPrepareArchiveForAi = archiveAiHandoffItemCount > 0;
  const isLargeArchive = analyzerKind === 'archive' && fileSize > ARCHIVE_INDEX_LIMIT_BYTES;
  const isArchiveIndexSkipped = isLargeArchive && !isPreviewLoading && archiveEntries.length === 0;
  const archiveActionLabel = isArchiveBulkUploading
    ? 'Sending...'
    : isLargeArchive
    ? 'Open in AI Diagnosis'
    : canPrepareArchiveForAi
    ? 'Send all files to AI Diagnosis'
    : 'Ask AI Diagnosis';

  const handleAskAiDiagnosis = async () => {
    if (isAiDiagnosisOpening) return;

    if (analyzerKind === 'archive') {
      if (canPrepareArchiveForAi) {
        await handleUploadArchiveEntriesToAi();
        return;
      }
      setAiDiagnosisMessage(
        archiveEntries.length > 0
          ? 'This ZIP was indexed, but no readable log, trace, document, HAR, or nested ZIP entry is small enough to prepare for AI Diagnosis. Open a listed child file or upload extracted diagnostics.'
          : 'This ZIP could not be indexed in the browser preview. Upload extracted logs or traces for AI Diagnosis.'
      );
      return;
    }

    setIsAiDiagnosisOpening(true);
    setAiDiagnosisMessage('Syncing selected file to AI Diagnosis...');
    try {
      await onAskAiDiagnosis();
      setAiDiagnosisMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'File could not be synced to AI Diagnosis.';
      setAiDiagnosisMessage(`AI Diagnosis sync failed: ${message}`);
    } finally {
      setIsAiDiagnosisOpening(false);
    }
  };

  const handleCopyPreview = async () => {
    try {
      await navigator.clipboard.writeText(previewText);
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus('idle'), 1600);
    } catch {
      setCopyStatus('error');
      window.setTimeout(() => setCopyStatus('idle'), 1600);
    }
  };

  const renderFileSummaryBar = () => (
    <div className="basic-file-compact-summary" aria-label={`${displayKind} summary`}>
      <div className="basic-file-compact-main">
        <h2 className="visually-hidden">{displayKind}</h2>
        <span className="basic-file-compact-badge">{displayKind}</span>
        <span className="basic-file-compact-name" title={fileName}>{fileName}</span>
      </div>
      <div className="basic-file-compact-meta" aria-label="File metadata">
        <span>{formatBytes(fileSize)}</span>
        <span>{mediaType}</span>
        <span>{visualStatus}</span>
        <span>{confidenceLabel[classificationConfidence]}</span>
      </div>
      <button
        type="button"
        className="basic-file-ai-button basic-file-compact-ai-button"
        aria-label="Ask AI Diagnosis about this file"
        onClick={handleAskAiDiagnosis}
        disabled={isAiDiagnosisOpening}
      >
        {isAiDiagnosisOpening ? 'Syncing...' : 'Ask AI Diagnosis'}
      </button>
    </div>
  );

  const handleOpenArchiveEntry = async (entry: ArchiveEntrySummary) => {
    if (entry.isDirectory) return;

    if (!onOpenArchiveEntry) {
      setArchiveActionMessage('Archive child routing is not available in this workspace.');
      return;
    }

    setArchiveActionMessage(`Opening ${entry.name}...`);
    try {
      const childFile = await extractArchiveEntry(file, entry);
      await onOpenArchiveEntry(childFile);
      setArchiveActionMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Archive child could not be opened.';
      setArchiveActionMessage(message);
    }
  };

  const handleUploadArchiveEntriesToAi = async () => {
    if (!canPrepareArchiveForAi) {
      setArchiveActionMessage('No readable ZIP child files are available to send to AI Diagnosis.');
      return;
    }

    if (!onUploadArchiveEntriesToAi) {
      setArchiveActionMessage('AI Diagnosis upload is not available in this workspace.');
      return;
    }

    setIsArchiveBulkUploading(true);
    setArchiveActionMessage(`Preparing ${archiveAiHandoffItemCount} archive item${archiveAiHandoffItemCount === 1 ? '' : 's'} for AI Diagnosis...`);

    try {
      const directResults = await Promise.allSettled(
        directAiArchiveEntries.map(entry => extractArchiveEntry(file, entry, { preservePathName: true }))
      );
      const directFiles = directResults
        .filter((result): result is PromiseFulfilledResult<File> => result.status === 'fulfilled')
        .map(result => result.value);
      let failedCount = directResults.length - directFiles.length;
      const nestedResults = await Promise.allSettled(
        nestedArchiveEntries.map(async (nestedEntry) => {
          const nestedArchiveFile = await extractArchiveEntry(file, nestedEntry, { preservePathName: true });
          const nestedEntries = await readArchiveEntries(nestedArchiveFile);
          const nestedDirectEntries = nestedEntries.filter(isDirectAiReadyArchiveChild);
          const childResults = await Promise.allSettled(
            nestedDirectEntries.map(entry => extractArchiveEntry(nestedArchiveFile, entry, { preservePathName: true }))
          );
          const childFiles = childResults
            .filter((result): result is PromiseFulfilledResult<File> => result.status === 'fulfilled')
            .map(result => prefixNestedArchiveChildFile(nestedEntry, result.value));

          return {
            files: childFiles,
            failedCount: childResults.length - childFiles.length,
          };
        })
      );
      const nestedFiles = nestedResults.flatMap((result) => {
        if (result.status === 'fulfilled') {
          failedCount += result.value.failedCount;
          return result.value.files;
        }

        failedCount += 1;
        return [];
      });
      const extractedFiles = [...directFiles, ...nestedFiles];

      if (extractedFiles.length === 0) {
        if (nestedArchiveEntries.length > 0) {
          setArchiveActionMessage('No AI-ready files were found inside the nested ZIP. Opening the nested archive instead.');
          await handleOpenArchiveEntry(nestedArchiveEntries[0]);
          return;
        }

        throw new Error('ZIP child files could not be extracted for AI Diagnosis.');
      }

      await onUploadArchiveEntriesToAi(extractedFiles);
      setArchiveActionMessage(
        failedCount > 0
          ? `Sent ${extractedFiles.length} file${extractedFiles.length === 1 ? '' : 's'} to AI Diagnosis. ${failedCount} could not be extracted.`
          : `Sent ${extractedFiles.length} file${extractedFiles.length === 1 ? '' : 's'} to AI Diagnosis.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ZIP files could not be sent to AI Diagnosis.';
      setArchiveActionMessage(message);
    } finally {
      setIsArchiveBulkUploading(false);
    }
  };

  useEffect(() => {
    if (!isActive || analyzerKind !== 'archive' || archiveEntries.length === 0) return;

    const supportedEntries = archiveEntries.filter(isAnalyzerSupportedArchiveChild);
    if (supportedEntries.length !== 1) return;

    const entry = supportedEntries[0];
    const autoOpenKey = `${fileName}:${fileSize}:${entry.name}:${entry.compressedSize}:${entry.uncompressedSize}`;
    if ((autoOpenedArchiveEntryKey ?? autoOpenedArchiveEntryRef.current) === autoOpenKey) return;

    autoOpenedArchiveEntryRef.current = autoOpenKey;
    onArchiveAutoOpen?.(autoOpenKey);
    void handleOpenArchiveEntry(entry);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveEntries, analyzerKind, autoOpenedArchiveEntryKey, fileName, fileSize, isActive]);

  const renderTextPreview = () => (
    <div className="basic-file-preview-panel">
      <div className="basic-file-preview-toolbar">
        <label className="basic-file-search">
          <span>Search</span>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Find visible lines"
          />
        </label>
        {analyzerKind === 'structured' && (
          <div className="basic-file-segmented" aria-label="Structured view">
            <button
              type="button"
              className={structuredMode === 'tree' ? 'is-active' : ''}
              onClick={() => setStructuredMode('tree')}
            >
              Tree
            </button>
            <button
              type="button"
              className={structuredMode === 'raw' ? 'is-active' : ''}
              onClick={() => setStructuredMode('raw')}
            >
              Raw
            </button>
          </div>
        )}
        <button type="button" className="basic-file-copy" onClick={handleCopyPreview} disabled={!previewText}>
          {copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Copy failed' : 'Copy'}
        </button>
      </div>
      {analyzerKind === 'structured' && (
        <div className="basic-file-validation" role="status">
          {structuredPreview.status}
        </div>
      )}
      <div className="basic-file-code-view" role="region" aria-label={`${displayKind} preview`}>
        {isPreviewLoading ? (
          <div className="basic-file-preview-message">Extracting preview...</div>
        ) : previewError ? (
          <div className="basic-file-preview-message">{previewError}</div>
        ) : textLines.length === 0 ? (
          <div className="basic-file-preview-message">No matching visible lines.</div>
        ) : (
          textLines.map((entry) => (
            <div className="basic-file-code-line" key={`${entry.originalLineNumber}:${entry.line}`}>
              <span className="basic-file-line-number">{entry.originalLineNumber}</span>
              <span className="basic-file-line-text">{entry.line || ' '}</span>
            </div>
          ))
        )}
      </div>
      {fileSize > TEXT_PREVIEW_LIMIT_BYTES && (
        <p className="basic-file-preview-note">
          Showing the first {formatBytes(TEXT_PREVIEW_LIMIT_BYTES)}. AI Diagnosis receives the attached file through the workspace sync.
        </p>
      )}
    </div>
  );

  const renderTablePreview = () => (
    <div className="basic-file-preview-panel">
      <div className="basic-file-preview-toolbar">
        <label className="basic-file-search">
          <span>Filter</span>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Filter rows"
          />
        </label>
        <span className="basic-file-table-count">
          {tablePreview.totalRows} rows
        </span>
      </div>
      <div className="basic-file-table-wrap">
        {isPreviewLoading ? (
          <div className="basic-file-preview-message">Extracting table preview...</div>
        ) : tablePreview.headers.length === 0 ? (
          <div className="basic-file-preview-message">No table rows were detected.</div>
        ) : (
          <table className="basic-file-table">
            <thead>
              <tr>
                {tablePreview.headers.map((header, index) => (
                  <th key={`${header}:${index}`}>{header || `Column ${index + 1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tablePreview.rows.map((row, rowIndex) => (
                <tr key={`${rowIndex}:${row.join('|')}`}>
                  {tablePreview.headers.map((_, cellIndex) => (
                    <td key={cellIndex}>{row[cellIndex] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  const renderImagePreview = () => (
    <div className="basic-file-preview-panel basic-file-image-panel">
      <div className="basic-file-image-toolbar" role="status">
        <span>OCR not extracted locally</span>
        <strong>Use AI Diagnosis for image text and case context.</strong>
      </div>
      <div className="basic-file-image-stage">
        {imageUrl ? (
          <img src={imageUrl} alt={fileName} />
        ) : (
          <div className="basic-file-preview-message">Preparing image preview...</div>
        )}
      </div>
    </div>
  );

  const renderDocumentSummaryBar = () => (
    <div className="basic-file-document-summary" aria-label={`${displayKind} summary`}>
      <div className="basic-file-document-summary-main">
        <span className="basic-file-document-badge">{getDocumentShortLabel(extension)}</span>
        <span className="basic-file-document-name" title={fileName}>{fileName}</span>
      </div>
      <div className="basic-file-document-summary-meta" aria-label="Document metadata">
        <span>{formatBytes(fileSize)}</span>
        <span>{mediaType}</span>
        <span>{confidenceLabel[classificationConfidence]}</span>
      </div>
      <button
        type="button"
        className="basic-file-ai-button basic-file-document-ai-button"
        onClick={handleAskAiDiagnosis}
        disabled={isAiDiagnosisOpening}
      >
        {isAiDiagnosisOpening ? 'Syncing...' : 'Ask AI Diagnosis about this file'}
      </button>
    </div>
  );

  const renderDocumentPreview = () => {
    if (isPdfDocument(extension, mediaType)) {
      return (
        <div className="basic-file-preview-panel basic-file-document-panel">
          <div className="basic-file-pdf-stage">
            {documentUrl ? (
              <iframe
                className="basic-file-pdf-frame"
                src={documentUrl}
                title={`PDF preview for ${fileName}`}
              />
            ) : (
              <div className="basic-file-preview-message">
                {previewError || 'PDF preview is not available in this browser.'}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (isOpenXmlDocument(extension)) {
      return (
        <div className="basic-file-document-text-panel">
          <div className="basic-file-document-inline-note">
            Extracted text preview from the Office package. Formatting, images, and embedded objects are handled by AI Diagnosis.
          </div>
          {renderTextPreview()}
        </div>
      );
    }

    return (
      <div className="basic-file-preview-panel basic-file-document-panel basic-file-document-metadata-panel">
        <div className="basic-file-document-card">
          <div className="basic-file-document-icon" aria-hidden="true">
            {getDocumentShortLabel(extension)}
          </div>
          <div>
            <h3>Document accepted</h3>
            <p>
              This legacy Office format is synced to the workspace. Use AI Diagnosis for full document inspection and case correlation.
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderArchiveEntryList = () => (
    <div className="basic-file-archive-list" aria-label="Archive entries">
      <div className="basic-file-archive-list-header" aria-hidden="true">
        <span>Name</span>
        <span>Size</span>
        <span>Compression</span>
        <span />
      </div>
      {archiveEntries.slice(0, 150).map((entry) => (
        <button
          type="button"
          className="basic-file-archive-entry"
          key={entry.name}
          onClick={() => handleOpenArchiveEntry(entry)}
          disabled={entry.isDirectory}
          aria-label={entry.isDirectory ? `Folder ${entry.name}` : `Open ${entry.name}`}
        >
          <span className="basic-file-archive-name" title={entry.name}>{entry.name}</span>
          <span>{entry.isDirectory ? 'Folder' : formatBytes(entry.uncompressedSize)}</span>
          <span>{entry.compressionMethod === 0 ? 'Stored' : `Method ${entry.compressionMethod}`}</span>
          <span className="basic-file-archive-action">{entry.isDirectory ? '' : 'Open'}</span>
        </button>
      ))}
    </div>
  );

  const renderArchiveSummaryBar = () => (
    <div className="basic-file-archive-compact-summary" aria-label="Archive summary">
      <div className="basic-file-archive-compact-main">
        <span className="basic-file-archive-badge">ZIP</span>
        <div className="basic-file-archive-title">
          <h2>Archive</h2>
          <span title={fileName}>{fileName}</span>
        </div>
      </div>
      <div className="basic-file-archive-compact-meta" aria-label="Archive metadata">
        <span>{isArchiveIndexSkipped ? 'Index skipped' : `${archiveEntries.length} entries`}</span>
        <span>{formatBytes(fileSize)}</span>
        <span>{isArchiveIndexSkipped ? 'AI needs extracted files' : `${archiveAiHandoffItemCount} AI-ready`}</span>
        {isLargeArchive && <span>Large bundle</span>}
      </div>
      <button
        type="button"
        className="basic-file-archive-ai-button basic-file-archive-compact-ai-button"
        onClick={handleAskAiDiagnosis}
        disabled={isPreviewLoading || isArchiveBulkUploading}
      >
        {archiveActionLabel}
      </button>
    </div>
  );

  const renderArchivePreview = () => (
    <div className="basic-file-preview-panel basic-file-archive-panel">
      {isPreviewLoading ? (
        <div className="basic-file-preview-message">Reading archive index...</div>
      ) : isArchiveIndexSkipped ? (
        <div className="basic-file-preview-message basic-file-large-archive-message">
          <strong>Unpack required</strong>
          <span>Visual child listing could not be indexed for this {formatBytes(fileSize)} ZIP. Unpack it and upload the relevant logs or traces directly.</span>
        </div>
      ) : archiveNotice && archiveEntries.length === 0 ? (
        <div className="basic-file-preview-message">{archiveNotice}</div>
      ) : archiveEntries.length > 0 ? (
        <>
          {archiveNotice && (
            <div className="basic-file-archive-inline-notice" role="status">
              {archiveNotice}
            </div>
          )}
          {renderArchiveEntryList()}
        </>
      ) : (
        <div className="basic-file-preview-message">No archive entries were found.</div>
      )}
    </div>
  );

  const renderBinaryPreview = () => (
    <div className="basic-file-preview-panel basic-file-binary-panel">
      <div className="basic-file-binary-icon" aria-hidden="true">
        01
      </div>
      <div>
        <h3>Metadata-only attachment</h3>
        <p>This file is accepted into the workspace but does not have a visual parser yet.</p>
      </div>
    </div>
  );

  const renderPreview = () => {
    if (analyzerKind === 'table') return renderTablePreview();
    if (analyzerKind === 'image') return renderImagePreview();
    if (analyzerKind === 'document') return renderDocumentPreview();
    if (analyzerKind === 'archive') return renderArchivePreview();
    if (analyzerKind === 'binary') return renderBinaryPreview();
    return renderTextPreview();
  };

  if (analyzerKind === 'document') {
    return (
      <section
        className="basic-file-analyzer basic-file-analyzer-document"
        aria-label={`${displayKind} analyzer`}
        hidden={!isActive}
      >
        {renderDocumentSummaryBar()}

        {aiDiagnosisMessage && (
          <div className="basic-file-ai-status basic-file-document-ai-status" role="status">
            {aiDiagnosisMessage}
          </div>
        )}

        {renderDocumentPreview()}
      </section>
    );
  }

  if (analyzerKind === 'archive') {
    return (
      <section
        className="basic-file-analyzer basic-file-analyzer-archive"
        aria-label={`${displayKind} analyzer`}
        hidden={!isActive}
      >
        {renderArchiveSummaryBar()}

        {aiDiagnosisMessage && (
          <div className="basic-file-ai-status basic-file-archive-ai-status" role="status">
            {aiDiagnosisMessage}
          </div>
        )}

        {archiveActionMessage && (
          <div className="basic-file-archive-message basic-file-archive-status" role="status">
            {archiveActionMessage}
          </div>
        )}

        {renderArchivePreview()}
      </section>
    );
  }

  return (
    <section
      className="basic-file-analyzer"
      aria-label={`${displayKind} analyzer`}
      hidden={!isActive}
    >
      {renderFileSummaryBar()}

      {aiDiagnosisMessage && (
        <div className="basic-file-ai-status" role="status">
          {aiDiagnosisMessage}
        </div>
      )}

      <div className="basic-file-context-strip" aria-label="Classification context">
        <span>{classificationReasons[0] ?? `${displayKind} routed to basic analyzer`}</span>
        <span>{suggestedToolName}</span>
      </div>

      {renderPreview()}
    </section>
  );
};

export default BasicFileAnalyzer;
