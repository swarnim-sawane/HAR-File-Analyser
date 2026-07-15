export type UploadFileType = 'har' | 'log';

const HAR_FILE_EXTENSIONS = ['.har', '.oc'] as const;
const LOG_FILE_EXTENSIONS = ['.log', '.txt'] as const;

export const HAR_FILE_INPUT_ACCEPT = `${HAR_FILE_EXTENSIONS.join(',')},application/json`;
export const UNIFIED_FILE_INPUT_ACCEPT = `${HAR_FILE_EXTENSIONS.join(',')},${LOG_FILE_EXTENSIONS.join(',')},.json,application/json,text/plain`;

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

export function isHarFileCandidate(file: Pick<File, 'name' | 'type'>): boolean {
  return hasKnownExtension(file.name, HAR_FILE_EXTENSIONS) || isJsonUploadCandidate(file);
}

function isLogFileCandidate(file: Pick<File, 'name' | 'type'>): boolean {
  return hasKnownExtension(file.name, LOG_FILE_EXTENSIONS);
}

export async function detectUploadFileType(file: File): Promise<UploadFileType> {
  if (hasKnownExtension(file.name, HAR_FILE_EXTENSIONS)) return 'har';
  if (isLogFileCandidate(file)) return 'log';

  if (isJsonUploadCandidate(file)) {
    try {
      const snippet = await file.slice(0, 8192).text();

      if (looksLikeHarSnippet(snippet)) return 'har';
    } catch {
      // Ignore read errors here and let the caller handle the fallback path.
    }

    return 'log';
  }

  return 'log';
}
