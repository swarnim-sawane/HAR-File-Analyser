// src/App.tsx

import React, { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import UnifiedUploader from './components/UnifiedUploader';
import HarTabContent from './components/HarTabContent';
import ConsoleLogTabContent from './components/ConsoleLogTabContent';
import BasicFileAnalyzer from './components/BasicFileAnalyzer';
import { ConsoleLogFile } from './types/consolelog';
import { ConsoleLogParser } from './utils/consoleLogParser';
import './styles/globals.css';
import ThemeSwitcher from './components/ThemeSwitcher';
import { chunkedUploader, UploadResult } from './services/chunkedUploader';
import { apiClient } from './services/apiClient';
import { wsClient } from './services/websocketClient';
import { storeRecentFile, clearRecentFiles } from './services/recentFilesStore';
import HarCompare from './components/HarCompare';
import HarSanitizer from './components/HarSanitizer';
import DocumentationPage from './components/DocumentationPage';
import { ArrowLeftIcon, CloseIcon, FileTextIcon, UploadIcon } from './components/Icons';
import { applyTheme, resolveInitialTheme, ThemeMode } from './theme';
import {
  createLocalConsoleLogUploadResult,
  shouldParseConsoleLogLocally,
} from './utils/consoleLogProcessing';
import {
  createSupportWorkbenchSession,
  uploadSupportWorkbenchAttachments,
} from './services/supportWorkbenchClient';
import {
  AnalyzerFileKind,
  BasicAnalyzerFileKind,
  classifyUploadFile,
  UploadFileClassification,
} from './utils/uploadFileTypes';

interface RecentFile {
  name: string;
  timestamp: number;
  data: File;
}

/** A single open HAR file tab */
interface HarFileTab {
  id: string;       // unique tab id (generated)
  fileId: string;   // backend file id (used to load data)
  fileName: string; // display name
  fileSize: number;
  createdAt: number;
}

/** A single open Console Log tab */
interface LogFileTab {
  id: string;
  fileId: string | null;          // null when parsed locally (small files)
  fileName: string;
  fileSize: number;
  localData: ConsoleLogFile | null; // pre-parsed data for small files
  createdAt: number;
}

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:4000';

const SUPPORT_WORKBENCH_URL =
  import.meta.env.VITE_SUPPORT_WORKBENCH_URL ||
  'http://localhost:4173';
const SUPPORT_WORKBENCH_DIRECT_SYNC_LIMIT_BYTES = 32 * 1024 * 1024;

type AppPath = '/' | '/docs';
type WorkspaceMode = 'analyzer' | 'support';
type SupportUploadStatus = 'idle' | 'creating' | 'uploading' | 'ready' | 'error';
type SupportSyncOptions = {
  throwOnError?: boolean;
};
type CaseFileSummary = {
  name: string;
  size: number;
  kind: string;
  visualStatus: string;
  mediaType: string;
  extension: string;
  classificationConfidence: UploadFileClassification['classificationConfidence'];
  classificationReasons: string[];
  suggestedToolName: string;
};
type CaseFileAnalyzerKind = AnalyzerFileKind;
type CaseFileItem = CaseFileSummary & {
  id: string;
  analyzerKind: CaseFileAnalyzerKind;
  fileId: string | null;
  localData?: ConsoleLogFile | null;
  sourceFile?: File | null;
  createdAt: number;
  updatedAt: number;
};
type AnalyzerTabReference = {
  fileId: string | null;
  fileName: string;
  caseFileId?: string;
};
type AnalyzerFileTab = AnalyzerTabReference & {
  id: string;
  kind: CaseFileAnalyzerKind;
  displayKind: string;
  extension: string;
  createdAt: number;
};

interface BasicFileTab {
  id: string;
  caseFileId: string;
  fileName: string;
  fileSize: number;
  file: File;
  analyzerKind: BasicAnalyzerFileKind;
  displayKind: string;
  mediaType: string;
  extension: string;
  classificationConfidence: UploadFileClassification['classificationConfidence'];
  classificationReasons: string[];
  visualStatus: string;
  suggestedToolName: string;
  autoOpenedArchiveEntryKey?: string | null;
  createdAt: number;
}

const normalizePathname = (pathname: string): AppPath =>
  pathname === '/docs' || pathname === '/docs/' ? '/docs' : '/';

const buildSupportWorkbenchUrl = (baseUrl: string, sessionId: string | null, theme: ThemeMode): string => {
  try {
    const url = new URL(baseUrl);
    if (sessionId) {
      url.searchParams.set('sessionId', sessionId);
    }
    url.searchParams.set('embedded', '1');
    url.searchParams.set('theme', theme);
    return url.toString();
  } catch {
    const separator = baseUrl.includes('?') ? '&' : '?';
    const params = [
      ...(sessionId ? [`sessionId=${encodeURIComponent(sessionId)}`] : []),
      'embedded=1',
      `theme=${encodeURIComponent(theme)}`,
    ];
    return `${baseUrl}${separator}${params.join('&')}`;
  }
};

const formatCaseFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
};

const getSupportFileSyncKey = (file: File): string =>
  [
    file.name.trim().toLowerCase(),
    file.size,
    file.type.trim().toLowerCase(),
    file.lastModified,
  ].join('\u0000');

const shouldDirectSyncToSupportWorkbench = (
  file: File,
  classification?: Pick<UploadFileClassification, 'analyzerKind'>,
): boolean => {
  if (classification?.analyzerKind === 'archive' && file.size > SUPPORT_WORKBENCH_DIRECT_SYNC_LIMIT_BYTES) {
    return false;
  }

  return file.size <= SUPPORT_WORKBENCH_DIRECT_SYNC_LIMIT_BYTES;
};

const classifyCaseFileKind = (fileName: string, mediaType?: string): string => {
  const normalizedName = fileName.toLowerCase();
  const normalizedType = mediaType?.toLowerCase() ?? '';

  if (normalizedName.endsWith('.har') || normalizedName.endsWith('.oc')) return 'HAR';
  if (normalizedName.endsWith('.log') || normalizedName.endsWith('.txt')) return 'Log';
  if (normalizedName.endsWith('.json') || normalizedType.includes('json')) return 'JSON';
  if (normalizedName.endsWith('.zip') || normalizedType.includes('zip')) return 'ZIP';
  if (normalizedType.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(fileName)) return 'Image';
  if (normalizedName.endsWith('.pdf') || normalizedType === 'application/pdf') return 'PDF';
  if (/\.(doc|docx)$/i.test(fileName) || normalizedType.includes('wordprocessingml') || normalizedType === 'application/msword') return 'Word';
  if (/\.(ppt|pptx)$/i.test(fileName) || normalizedType.includes('presentationml') || normalizedType === 'application/vnd.ms-powerpoint') return 'PowerPoint';
  if (/\.(xls|xlsx)$/i.test(fileName) || normalizedType.includes('spreadsheetml') || normalizedType === 'application/vnd.ms-excel') return 'Excel';
  return 'File';
};

const getCaseFileExtension = (fileName: string): string => {
  const normalizedName = fileName.trim().toLowerCase();
  const lastDot = normalizedName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === normalizedName.length - 1) return '';
  return normalizedName.slice(lastDot);
};

const isBasicAnalyzerKind = (kind: CaseFileAnalyzerKind): kind is BasicAnalyzerFileKind =>
  kind !== 'har' && kind !== 'log';

const getAnalyzerFileTypeLabel = (
  analyzerKind: CaseFileAnalyzerKind,
  displayKind: string,
  extension: string
): string => {
  if (analyzerKind === 'har') return 'HAR';
  if (analyzerKind === 'log') return 'LOG';
  if (analyzerKind === 'table') return extension === '.tsv' ? 'TSV' : 'CSV';
  if (analyzerKind === 'image') return 'IMG';
  if (analyzerKind === 'document') {
    if (extension === '.pdf') return 'PDF';
    if (extension === '.doc' || extension === '.docx') return 'DOC';
    if (extension === '.ppt' || extension === '.pptx') return 'PPT';
    if (extension === '.xls' || extension === '.xlsx') return 'XLS';
    return 'DOC';
  }
  if (analyzerKind === 'archive') return extension === '.zip' ? 'ZIP' : 'ARCH';
  if (analyzerKind === 'binary') return 'BIN';
  if (analyzerKind === 'structured') {
    const structuredLabel = extension.replace('.', '').toUpperCase();
    return structuredLabel || 'DATA';
  }

  const normalizedDisplayKind = displayKind.toLowerCase();
  if (normalizedDisplayKind.includes('trace')) return 'TRACE';
  if (normalizedDisplayKind.includes('thread')) return 'THREAD';
  if (normalizedDisplayKind.includes('jdbc')) return 'JDBC';
  return 'TEXT';
};

const buildCaseFileId = (
  analyzerKind: CaseFileAnalyzerKind,
  fileName: string,
  fileId?: string | null,
  sourceIdentity?: string | null
): string => `${analyzerKind}:${fileId || sourceIdentity || fileName}`;

const createSourceIdentity = (sourceFile?: File): string | null =>
  sourceFile ? `${sourceFile.name}:${sourceFile.size}:${sourceFile.lastModified}` : null;

const createCaseFileSummary = (
  result: UploadResult,
  sourceFile?: File,
  visualStatus = 'Visual ready',
  classification?: UploadFileClassification
): CaseFileSummary => ({
  name: sourceFile?.name || result.fileName,
  size: sourceFile?.size || result.fileSize || 0,
  kind: classification?.displayKind || classifyCaseFileKind(sourceFile?.name || result.fileName, sourceFile?.type),
  visualStatus: classification?.visualStatus || visualStatus,
  mediaType: classification?.mediaType || sourceFile?.type || 'application/octet-stream',
  extension: classification?.extension || getCaseFileExtension(sourceFile?.name || result.fileName),
  classificationConfidence: classification?.classificationConfidence || 'high',
  classificationReasons: classification?.classificationReasons || ['Deep visual analyzer matched'],
  suggestedToolName: classification?.suggestedToolName || (sourceFile?.name.toLowerCase().endsWith('.har') ? 'analyze_har_file' : 'read_logs'),
});

const caseFileMatchesAnalyzerTarget = (
  file: CaseFileItem,
  analyzerKind: CaseFileAnalyzerKind,
  target: AnalyzerTabReference
): boolean => (
  (target.caseFileId ? file.id === target.caseFileId : file.analyzerKind === analyzerKind) &&
  (
    Boolean(target.caseFileId && file.id === target.caseFileId) ||
    Boolean(file.fileId && target.fileId && file.fileId === target.fileId) ||
    file.name === target.fileName
  )
);

const buildAnalyzerFileTabs = (
  harTabs: HarFileTab[],
  logTabs: LogFileTab[],
  basicTabs: BasicFileTab[]
): AnalyzerFileTab[] => [
  ...harTabs.map(tab => ({
    id: tab.id,
    kind: 'har' as const,
    fileId: tab.fileId,
    fileName: tab.fileName,
    displayKind: 'HAR',
    extension: '.har',
    createdAt: tab.createdAt,
  })),
  ...logTabs.map(tab => ({
    id: tab.id,
    kind: 'log' as const,
    fileId: tab.fileId,
    fileName: tab.fileName,
    displayKind: 'Log',
    extension: getCaseFileExtension(tab.fileName),
    createdAt: tab.createdAt,
  })),
  ...basicTabs.map(tab => ({
    id: tab.id,
    kind: tab.analyzerKind,
    fileId: null,
    fileName: tab.fileName,
    caseFileId: tab.caseFileId,
    displayKind: tab.displayKind,
    extension: tab.extension,
    createdAt: tab.createdAt,
  })),
].sort((a, b) => a.createdAt - b.createdAt);

const App: React.FC = () => {
  const [theme, setTheme] = useState<ThemeMode>(() =>
    resolveInitialTheme({
      doc: typeof document !== 'undefined' ? document : undefined,
      storage: typeof window !== 'undefined' ? window.localStorage : null,
      matchMedia: typeof window !== 'undefined' ? window.matchMedia.bind(window) : undefined,
    })
  );
  const [pathname, setPathname] = useState<AppPath>(() => normalizePathname(window.location.pathname));
  // ── HAR multi-tab state ──────────────────────────────────────────────────────
  const [harTabs, setHarTabs] = useState<HarFileTab[]>([]);
  const [activeHarTabId, setActiveHarTabId] = useState<string | null>(null);
  const [harRecentFiles, setHarRecentFiles] = useState<RecentFile[]>([]);

  // ── Console Log multi-tab state ──────────────────────────────────────────────
  const [logTabs, setLogTabs] = useState<LogFileTab[]>([]);
  const [activeLogTabId, setActiveLogTabId] = useState<string | null>(null);
  const [logRecentFiles, setLogRecentFiles] = useState<RecentFile[]>([]);
  const [isLogProcessing, setIsLogProcessing] = useState(false);
  const [logLoadingMessage, setLogLoadingMessage] = useState('Loading console log file...');
  const [showLogLocalFallback, setShowLogLocalFallback] = useState(false);
  const [basicTabs, setBasicTabs] = useState<BasicFileTab[]>([]);
  const [activeBasicTabId, setActiveBasicTabId] = useState<string | null>(null);
  const logCancelRef = React.useRef<(() => void) | null>(null);
  const compareWrapperRef = useRef<HTMLDivElement | null>(null);

  const MAX_LOG_TABS = 8;
  const MAX_BASIC_TABS = 12;

  // ── Main navigation ──────────────────────────────────────────────────────────
  const [activeTool, setActiveTool] = useState<'har' | 'sanitizer' | 'console' | 'basic' | 'compare'>('har');
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceMode>('analyzer');
  const [supportSessionId, setSupportSessionId] = useState<string | null>(null);
  const [supportUploadStatus, setSupportUploadStatus] = useState<SupportUploadStatus>('idle');
  const [supportUploadError, setSupportUploadError] = useState<string | null>(null);
  const [caseFiles, setCaseFiles] = useState<CaseFileItem[]>([]);
  const [activeCaseFileId, setActiveCaseFileId] = useState<string | null>(null);
  const [isToolMenuOpen, setIsToolMenuOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const supportSessionPromiseRef = useRef<Promise<string> | null>(null);
  const supportFileSyncPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const syncedSupportFileKeysRef = useRef<Set<string>>(new Set());
  const toolMenuRef = useRef<HTMLDivElement | null>(null);

  const MAX_HAR_TABS = 8;
  const MAX_RECENT_FILES = 5;
  const HAR_RECENT_FILES_KEY = 'har_analyzer_recent_files';
  const LOG_RECENT_FILES_KEY = 'console_log_recent_files';
  const LOG_STATUS_POLL_INTERVAL_MS = 2000;
  const LOG_STATUS_TIMEOUT_MS = 180000;

  useLayoutEffect(() => {
    applyTheme(theme, {
      doc: document,
      storage: window.localStorage,
    });
  }, [theme]);

  useLayoutEffect(() => {
    if (activeTool !== 'compare') return;

    const compareWrapper = compareWrapperRef.current;
    if (!compareWrapper) return;

    if (typeof compareWrapper.scrollTo === 'function') {
      compareWrapper.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }

    compareWrapper.scrollTop = 0;
  }, [activeTool]);

  useEffect(() => {
    const handlePopState = () => {
      setPathname(normalizePathname(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = useCallback((nextPath: AppPath) => {
    const normalizedPath = normalizePathname(nextPath);
    if (normalizedPath === pathname) return;

    window.history.pushState({}, '', normalizedPath);
    setPathname(normalizedPath);
    window.scrollTo?.(0, 0);
  }, [pathname]);

  // ── Deep-link handler: ?fileId=<id> pre-loads a file uploaded by the MCP tool ──
  useEffect(() => {
    if (pathname !== '/') return;

    const params = new URLSearchParams(window.location.search);
    const deepLinkFileId = params.get('fileId');
    if (!deepLinkFileId) return;

    wsClient.connect();
    wsClient.subscribeToFile(deepLinkFileId);

    const tryOpenTab = (fileId: string, fileName?: string) => {
      openHarTab({ fileId, fileName: fileName || fileId, fileSize: 0, hash: '', jobId: '', success: true, message: '' });
      const clean = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', clean);
    };

    // Try immediately
    apiClient.getHarData(deepLinkFileId)
      .then(() => tryOpenTab(deepLinkFileId))
      .catch(() => { /* wait for socket */ });

    const handleStatus = (data: { fileId: string; status: string; fileName?: string }) => {
      if (data.fileId !== deepLinkFileId || data.status !== 'ready') return;
      tryOpenTab(deepLinkFileId, data.fileName);
    };
    wsClient.on('file:status', handleStatus);
    return () => { wsClient.off('file:status', handleStatus); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Show "Parse locally instead" button after 10s of waiting for backend
  useEffect(() => {
    if (!isLogProcessing) {
      setShowLogLocalFallback(false);
      return;
    }
    const timer = setTimeout(() => setShowLogLocalFallback(true), 10000);
    return () => clearTimeout(timer);
  }, [isLogProcessing]);

  const handleToolChange = (nextTool: 'har' | 'sanitizer' | 'console' | 'basic' | 'compare') => {
    if (nextTool === activeTool) return;
    setActiveTool(nextTool);
  };

  const handleThemeChange = useCallback((nextTheme: ThemeMode) => {
    startTransition(() => {
      setTheme((currentTheme) => (currentTheme === nextTheme ? currentTheme : nextTheme));
    });
  }, []);

  const registerCaseFile = useCallback((
    result: UploadResult,
    sourceFile: File | undefined,
    analyzerKind: CaseFileAnalyzerKind,
    visualStatus = 'Visual ready',
    localData?: ConsoleLogFile | null,
    classification?: UploadFileClassification
  ): string => {
    const summary = createCaseFileSummary(result, sourceFile, visualStatus, classification);
    const id = buildCaseFileId(analyzerKind, summary.name, result.fileId, createSourceIdentity(sourceFile));
    const now = Date.now();
    const nextItem: CaseFileItem = {
      ...summary,
      id,
      analyzerKind,
      fileId: result.fileId || null,
      localData: localData ?? null,
      sourceFile: sourceFile ?? null,
      createdAt: now,
      updatedAt: now,
    };

    setCaseFiles(prev => {
      const existingIndex = prev.findIndex(item => item.id === id);
      if (existingIndex === -1) return [...prev, nextItem];

      const existing = prev[existingIndex];
      const updated = [...prev];
      updated[existingIndex] = {
        ...existing,
        ...nextItem,
        createdAt: existing.createdAt,
        localData: localData ?? existing.localData ?? null,
        sourceFile: sourceFile ?? existing.sourceFile ?? null,
      };
      return updated;
    });
    setActiveCaseFileId(id);
    return id;
  }, []);

  const getCaseFileIdForAnalyzerTab = (
    analyzerKind: CaseFileAnalyzerKind,
    tab: AnalyzerTabReference
  ): string => (
    caseFiles.find(file => caseFileMatchesAnalyzerTarget(file, analyzerKind, tab))?.id ??
    buildCaseFileId(analyzerKind, tab.fileName, tab.fileId)
  );

  const activateAnalyzerFileTab = (tab: AnalyzerFileTab | null) => {
    if (!tab) return;

    if (tab.kind === 'har') {
      setActiveTool('har');
      setActiveHarTabId(tab.id);
    } else if (tab.kind === 'log') {
      setActiveTool('console');
      setActiveLogTabId(tab.id);
    } else {
      setActiveTool('basic');
      setActiveBasicTabId(tab.id);
    }

    setActiveCaseFileId(getCaseFileIdForAnalyzerTab(tab.kind, tab));
  };

  /** Switch to a different open HAR file tab */
  const handleHarFileTabSwitch = (tabId: string) => {
    setActiveTool('har');
    if (tabId !== activeHarTabId) setActiveHarTabId(tabId);
    const tab = harTabs.find(item => item.id === tabId);
    if (!tab) return;
    setActiveCaseFileId(getCaseFileIdForAnalyzerTab('har', tab));
  };



  // Load recent files for both tools
  useEffect(() => {
    try {
      const harStored = localStorage.getItem(HAR_RECENT_FILES_KEY);
      if (harStored) setHarRecentFiles(JSON.parse(harStored));

      const logStored = localStorage.getItem(LOG_RECENT_FILES_KEY);
      if (logStored) setLogRecentFiles(JSON.parse(logStored));
    } catch (err) {
      console.error('Failed to load recent files:', err);
    }
  }, []);

  // ── HAR file / tab management ─────────────────────────────────────────────────

  const registerRecentHarFile = (fileName: string, fileObj: File) => {
    // Persist content to IndexedDB (skip empty stub files created by openHarTab)
    if (fileObj && fileObj.size > 0) {
      void storeRecentFile('har', fileObj);
    }
    setHarRecentFiles(prev => {
      const filtered = prev.filter(f => f.name !== fileName);
      const updated = [{ name: fileName, timestamp: Date.now(), data: fileObj }, ...filtered].slice(0, MAX_RECENT_FILES);
      localStorage.setItem(HAR_RECENT_FILES_KEY, JSON.stringify(updated.map(f => ({ name: f.name, timestamp: f.timestamp }))));
      return updated;
    });
  };

  /** Open a new HAR tab for the given upload result.
   *  Pass switchTool=true (default false) to also activate the HAR tool tab. */
  const openHarTab = useCallback((result: UploadResult, switchTool = false, sourceFile?: File) => {
    registerCaseFile(result, sourceFile, 'har');
    if (harTabs.length >= MAX_HAR_TABS) {
      console.warn(`Max ${MAX_HAR_TABS} HAR tabs open — close one first`);
      return;
    }
    const newTab: HarFileTab = {
      id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fileId: result.fileId,
      fileName: result.fileName,
      fileSize: sourceFile?.size || result.fileSize || 0,
      createdAt: Date.now(),
    };
    setHarTabs(prev => [...prev, newTab]);
    setActiveHarTabId(newTab.id);
    if (switchTool) setActiveTool('har');
    registerRecentHarFile(result.fileName, new File([], result.fileName));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harTabs.length, registerCaseFile]);

  const ensureSupportWorkbenchSession = useCallback(async (): Promise<string> => {
    if (supportSessionId) return supportSessionId;

    if (!supportSessionPromiseRef.current) {
      setSupportUploadStatus('creating');
      supportSessionPromiseRef.current = createSupportWorkbenchSession()
        .then((response) => {
          setSupportSessionId(response.session.id);
          return response.session.id;
        })
        .finally(() => {
          supportSessionPromiseRef.current = null;
        });
    }

    return supportSessionPromiseRef.current;
  }, [supportSessionId]);

  const syncFilesToSupportWorkbench = useCallback(async (files: File[], options: SupportSyncOptions = {}) => {
    const uploadableFiles = files.filter((file) => file instanceof File);
    if (uploadableFiles.length === 0) return;

    const startFileSync = (file: File): Promise<void> => {
      const syncKey = getSupportFileSyncKey(file);
      if (syncedSupportFileKeysRef.current.has(syncKey)) {
        return Promise.resolve();
      }

      const existingSync = supportFileSyncPromisesRef.current.get(syncKey);
      if (existingSync) {
        return existingSync;
      }

      const syncPromise = (async () => {
        const sessionId = await ensureSupportWorkbenchSession();
        setSupportUploadStatus('uploading');
        await uploadSupportWorkbenchAttachments(sessionId, [file]);
        syncedSupportFileKeysRef.current.add(syncKey);
      })().finally(() => {
        supportFileSyncPromisesRef.current.delete(syncKey);
      });

      supportFileSyncPromisesRef.current.set(syncKey, syncPromise);
      return syncPromise;
    };

    try {
      setSupportUploadError(null);
      await Promise.all(uploadableFiles.map(startFileSync));
      setSupportUploadStatus('ready');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to sync file to Support Workbench:', err);
      setSupportUploadError(message);
      setSupportUploadStatus('error');
      if (options.throwOnError) {
        throw err;
      }
    }
  }, [ensureSupportWorkbenchSession]);

  // ── Unified uploader callbacks ────────────────────────────────────────────
  /** Called by UnifiedUploader when a HAR file is ready — switches to HAR tool */
  const handleUnifiedHarUpload = useCallback(async (result: UploadResult, sourceFile: File) => {
    setActiveWorkspace('analyzer');
    if (shouldDirectSyncToSupportWorkbench(sourceFile)) {
      void syncFilesToSupportWorkbench([sourceFile]);
    }
    openHarTab(result, /* switchTool */ true, sourceFile);
  }, [openHarTab, syncFilesToSupportWorkbench]);

  /** Called by UnifiedUploader when a console log is ready — switches to Console tool */
  const handleUnifiedLogUpload = useCallback(async (result: UploadResult, sourceFile: File) => {
    setActiveWorkspace('analyzer');
    if (shouldDirectSyncToSupportWorkbench(sourceFile)) {
      void syncFilesToSupportWorkbench([sourceFile]);
    }
    setActiveTool('console');
    await handleLogUploadComplete(result, sourceFile);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncFilesToSupportWorkbench]);

  const openBasicTab = useCallback((
    sourceFile: File,
    classification: UploadFileClassification,
    caseFileId: string
  ) => {
    if (!isBasicAnalyzerKind(classification.analyzerKind)) return;

    const existingTab = basicTabs.find(tab =>
      tab.caseFileId === caseFileId ||
      (
        tab.fileName.trim().toLowerCase() === sourceFile.name.trim().toLowerCase() &&
        tab.fileSize === sourceFile.size &&
        tab.analyzerKind === classification.analyzerKind
      )
    );

    if (existingTab) {
      setActiveTool('basic');
      setActiveBasicTabId(existingTab.id);
      setActiveCaseFileId(existingTab.caseFileId);
      return;
    }

    if (basicTabs.length >= MAX_BASIC_TABS) {
      console.warn(`Max ${MAX_BASIC_TABS} basic analyzer tabs open - close one first`);
      return;
    }

    const newTab: BasicFileTab = {
      id: `basictab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      caseFileId,
      fileName: sourceFile.name,
      fileSize: sourceFile.size,
      file: sourceFile,
      analyzerKind: classification.analyzerKind,
      displayKind: classification.displayKind,
      mediaType: classification.mediaType,
      extension: classification.extension,
      classificationConfidence: classification.classificationConfidence,
      classificationReasons: classification.classificationReasons,
      visualStatus: classification.visualStatus,
      suggestedToolName: classification.suggestedToolName,
      autoOpenedArchiveEntryKey: null,
      createdAt: Date.now(),
    };

    setBasicTabs(prev => [...prev, newTab]);
    setActiveBasicTabId(newTab.id);
    setActiveTool('basic');
  }, [basicTabs]);

  const handleUnifiedBasicUpload = useCallback(async (
    sourceFile: File,
    classification: UploadFileClassification
  ) => {
    if (!isBasicAnalyzerKind(classification.analyzerKind)) return;

    setActiveWorkspace('analyzer');
    if (shouldDirectSyncToSupportWorkbench(sourceFile, classification)) {
      void syncFilesToSupportWorkbench([sourceFile]);
    }

    const localResult: UploadResult = {
      success: true,
      fileId: '',
      jobId: 'local-basic-preview',
      fileName: sourceFile.name,
      fileSize: sourceFile.size,
      hash: '',
      message: 'Preview registered locally',
    };
    const caseFileId = registerCaseFile(
      localResult,
      sourceFile,
      classification.analyzerKind,
      classification.visualStatus,
      null,
      classification,
    );
    openBasicTab(sourceFile, classification, caseFileId);
  }, [openBasicTab, registerCaseFile, syncFilesToSupportWorkbench]);

  const handleArchiveChildOpen = useCallback(async (sourceFile: File) => {
    const classification = await classifyUploadFile(sourceFile);

    if (classification.analyzerKind === 'har') {
      const result = await chunkedUploader.uploadFile(sourceFile, 'har');
      await handleUnifiedHarUpload(result, sourceFile);
      return;
    }

    if (classification.analyzerKind === 'log') {
      const result = shouldParseConsoleLogLocally(sourceFile.size)
        ? createLocalConsoleLogUploadResult(sourceFile)
        : await chunkedUploader.uploadFile(sourceFile, 'log');
      await handleUnifiedLogUpload(result, sourceFile);
      return;
    }

    if (isBasicAnalyzerKind(classification.analyzerKind)) {
      await handleUnifiedBasicUpload(sourceFile, classification);
    }
  }, [handleUnifiedBasicUpload, handleUnifiedHarUpload, handleUnifiedLogUpload]);

  const handleArchiveEntriesUploadToAi = useCallback(async (files: File[]) => {
    await syncFilesToSupportWorkbench(files);
    setActiveWorkspace('support');
  }, [syncFilesToSupportWorkbench]);

  const handleArchiveAutoOpen = useCallback((tabId: string, entryKey: string) => {
    setBasicTabs(prev => prev.map(tab =>
      tab.id === tabId
        ? { ...tab, autoOpenedArchiveEntryKey: entryKey }
        : tab
    ));
  }, []);

  /** Close a HAR file tab; activate the nearest remaining tab */
  const closeHarTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const mixedTabs = buildAnalyzerFileTabs(harTabs, logTabs, basicTabs);
    const closingIndex = mixedTabs.findIndex(tab => tab.kind === 'har' && tab.id === tabId);
    const nextMixedTab =
      mixedTabs.filter(tab => !(tab.kind === 'har' && tab.id === tabId))[Math.max(0, closingIndex)] ??
      mixedTabs.filter(tab => !(tab.kind === 'har' && tab.id === tabId))[Math.max(0, closingIndex - 1)] ??
      null;
    const wasActive = activeTool === 'har' && activeHarTabId === tabId;

    setHarTabs(prev => prev.filter(t => t.id !== tabId));

    if (wasActive) {
      setActiveHarTabId(null);
      activateAnalyzerFileTab(nextMixedTab);
    }
  };

  /** Triggered by the Upload button in the workspace toolbar and the analyzer tab-bar plus button. */
  const handleAddTabClick = () => {
    setIsUploadModalOpen(true);
  };

  // ── Console Log tab management ────────────────────────────────────────────────

  const openLogTab = useCallback((
    opts: { fileId: string | null; fileName: string; fileSize: number; localData: ConsoleLogFile | null },
    switchTool = false
  ) => {
    if (logTabs.length >= MAX_LOG_TABS) {
      console.warn(`Max ${MAX_LOG_TABS} console log tabs open — close one first`);
      return;
    }
    const newTab: LogFileTab = {
      id: `logtab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fileId: opts.fileId,
      fileName: opts.fileName,
      fileSize: opts.fileSize,
      localData: opts.localData,
      createdAt: Date.now(),
    };
    setLogTabs(prev => [...prev, newTab]);
    setActiveLogTabId(newTab.id);
    if (switchTool) setActiveTool('console');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logTabs.length]);

  const closeLogTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const mixedTabs = buildAnalyzerFileTabs(harTabs, logTabs, basicTabs);
    const closingIndex = mixedTabs.findIndex(tab => tab.kind === 'log' && tab.id === tabId);
    const remainingTabs = mixedTabs.filter(tab => !(tab.kind === 'log' && tab.id === tabId));
    const nextMixedTab =
      remainingTabs[Math.max(0, closingIndex)] ??
      remainingTabs[Math.max(0, closingIndex - 1)] ??
      null;
    const wasActive = activeTool === 'console' && activeLogTabId === tabId;

    setLogTabs(prev => prev.filter(t => t.id !== tabId));

    if (wasActive) {
      setActiveLogTabId(null);
      activateAnalyzerFileTab(nextMixedTab);
    }
  };

  const closeBasicTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const mixedTabs = buildAnalyzerFileTabs(harTabs, logTabs, basicTabs);
    const closingIndex = mixedTabs.findIndex(tab => isBasicAnalyzerKind(tab.kind) && tab.id === tabId);
    const remainingTabs = mixedTabs.filter(tab => !(isBasicAnalyzerKind(tab.kind) && tab.id === tabId));
    const nextMixedTab =
      remainingTabs[Math.max(0, closingIndex)] ??
      remainingTabs[Math.max(0, closingIndex - 1)] ??
      null;
    const wasActive = activeTool === 'basic' && activeBasicTabId === tabId;

    setBasicTabs(prev => prev.filter(t => t.id !== tabId));

    if (wasActive) {
      setActiveBasicTabId(null);
      activateAnalyzerFileTab(nextMixedTab);
    }
  };

  const handleLogTabSwitch = (tabId: string) => {
    setActiveTool('console');
    if (tabId !== activeLogTabId) setActiveLogTabId(tabId);
    const tab = logTabs.find(item => item.id === tabId);
    if (!tab) return;
    setActiveCaseFileId(getCaseFileIdForAnalyzerTab('log', tab));
  };

  const handleBasicTabSwitch = (tabId: string) => {
    setActiveTool('basic');
    if (tabId !== activeBasicTabId) setActiveBasicTabId(tabId);
    const tab = basicTabs.find(item => item.id === tabId);
    if (!tab) return;
    setActiveCaseFileId(tab.caseFileId);
  };

  const handleOpenExistingRecentFile = useCallback((file: { name: string; fileType: CaseFileAnalyzerKind }): boolean => {
    const normalizedName = file.name.trim().toLowerCase();
    const matchingHarTab = file.fileType === 'har'
      ? harTabs.find(tab => tab.fileName.trim().toLowerCase() === normalizedName)
      : null;
    const matchingLogTab = file.fileType === 'log'
      ? logTabs.find(tab => tab.fileName.trim().toLowerCase() === normalizedName)
      : null;

    if (!matchingHarTab && !matchingLogTab) return false;

    if (pathname !== '/') {
      navigateTo('/');
    }

    setActiveWorkspace('analyzer');
    setIsUploadModalOpen(false);

    if (matchingHarTab) {
      setActiveTool('har');
      setActiveHarTabId(matchingHarTab.id);
      setActiveCaseFileId(getCaseFileIdForAnalyzerTab('har', matchingHarTab));
      return true;
    }

    setActiveTool('console');
    setActiveLogTabId(matchingLogTab!.id);
    setActiveCaseFileId(getCaseFileIdForAnalyzerTab('log', matchingLogTab!));
    return true;
  }, [caseFiles, harTabs, logTabs, navigateTo, pathname]);

  const registerRecentLogFile = (fileName: string, fileObj: File) => {
    // Persist actual file content to IndexedDB for cross-session restore
    if (fileObj && fileObj.size > 0) {
      void storeRecentFile('log', fileObj);
    }
    const newRecentFile: RecentFile = {
      name: fileName,
      timestamp: Date.now(),
      data: fileObj,
    };
    setLogRecentFiles(prev => {
      const filtered = prev.filter(f => f.name !== fileName);
      const updated = [newRecentFile, ...filtered].slice(0, MAX_RECENT_FILES);
      localStorage.setItem(LOG_RECENT_FILES_KEY, JSON.stringify(updated.map(f => ({
        name: f.name,
        timestamp: f.timestamp,
      }))));
      return updated;
    });
  };

  const waitForLogReady = useCallback((
    fileId: string,
    cancelRef?: React.MutableRefObject<(() => void) | null>
  ): Promise<void> => {
    wsClient.connect();
    wsClient.subscribeToFile(fileId);

    return new Promise((resolve, reject) => {
      let settled = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const handleStatus = (data: { fileId: string; status: string; error?: string }) => {
        if (data.fileId !== fileId) return;
        if (data.status === 'ready') {
          finish(resolve);
          return;
        }
        if (data.status === 'error') {
          finish(() => reject(new Error(data.error || 'Console log processing failed')));
          return;
        }
        if (data.status === 'parsing') setLogLoadingMessage('Parsing log entries on server...');
        if (data.status === 'analyzing') setLogLoadingMessage('Analyzing log statistics...');
      };

      const cleanup = () => {
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        wsClient.off('file:status', handleStatus);
        if (cancelRef) cancelRef.current = null;
      };

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      if (cancelRef) {
        cancelRef.current = () => finish(() => reject(new Error('Cancelled by user')));
      }

      const pollStatus = async () => {
        try {
          const status = await apiClient.getLogStatus(fileId);
          if (status?.status === 'ready') {
            finish(resolve);
            return;
          }
          if (status?.status === 'error') {
            finish(() => reject(new Error(status.error || 'Console log processing failed')));
            return;
          }
          if (status?.status === 'parsing') setLogLoadingMessage('Parsing log entries on server...');
          if (status?.status === 'analyzing') setLogLoadingMessage('Analyzing log statistics...');
        } catch (err: any) {
          const statusCode = err?.response?.status;
          if (statusCode && statusCode !== 404) {
            console.warn('Log status polling failed:', err);
          }
        }
      };

      wsClient.on('file:status', handleStatus);
      pollTimer = setInterval(pollStatus, LOG_STATUS_POLL_INTERVAL_MS);
      timeoutTimer = setTimeout(() => {
        finish(() => reject(new Error('Timed out waiting for console log processing')));
      }, LOG_STATUS_TIMEOUT_MS);

      void pollStatus();
    });
  }, []);

  // Console log upload handler — creates a new tab after loading.
  // The loading overlay lives in App.tsx (shown during the wait), then the resulting
  // data or fileId is handed off to a new ConsoleLogTabContent that owns it permanently.
  const handleLogUploadComplete = async (result: UploadResult, sourceFile?: File) => {
    registerCaseFile(result, sourceFile, 'log', 'Visual processing');
    setIsLogProcessing(true);
    logCancelRef.current = null;

    // Small files: parse locally — instant, no backend wait.
    if (sourceFile && shouldParseConsoleLogLocally(result.fileSize)) {
      setLogLoadingMessage('Parsing console log…');
      try {
        const parsed: ConsoleLogFile = await ConsoleLogParser.parseFile(sourceFile);
        openLogTab({ fileId: null, fileName: sourceFile.name, fileSize: sourceFile.size || result.fileSize || 0, localData: parsed });
        registerCaseFile(result, sourceFile, 'log', 'Visual ready', parsed);
        registerRecentLogFile(sourceFile.name, sourceFile);
      } catch (err) {
        console.error('Local parse failed:', err);
      } finally {
        setIsLogProcessing(false);
        setLogLoadingMessage('Loading console log file...');
      }
      return;
    }

    // Large files: wait for the backend worker, then open tab with fileId.
    try {
      setLogLoadingMessage('Processing console log on server…');
      await waitForLogReady(result.fileId, logCancelRef);
      openLogTab({ fileId: result.fileId, fileName: result.fileName, fileSize: sourceFile?.size || result.fileSize || 0, localData: null });
      registerCaseFile(result, sourceFile, 'log');
      registerRecentLogFile(result.fileName, sourceFile || new File([], result.fileName));
    } catch (err) {
      console.error('Console backend flow failed, falling back to local parse:', err);
      if (sourceFile) {
        setLogLoadingMessage('Backend unavailable, parsing console log locally…');
        try {
          const parsed: ConsoleLogFile = await ConsoleLogParser.parseFile(sourceFile);
          openLogTab({ fileId: null, fileName: sourceFile.name, fileSize: sourceFile.size || result.fileSize || 0, localData: parsed });
          registerCaseFile(result, sourceFile, 'log', 'Visual ready', parsed);
          registerRecentLogFile(sourceFile.name, sourceFile);
        } catch (parseErr) {
          console.error('Local parse fallback also failed:', parseErr);
        }
      }
    } finally {
      setIsLogProcessing(false);
      setLogLoadingMessage('Loading console log file...');
    }
  };

  // Show the unified uploader only when there is truly nothing loaded in either tool.
  // Once any file is open the tool tabs take over and each tool manages its own upload.
  const showUnifiedUploader =
    harTabs.length === 0 &&
    logTabs.length === 0 &&
    caseFiles.length === 0 &&
    !isLogProcessing;

  useEffect(() => {
    if (showUnifiedUploader && activeWorkspace === 'support') {
      setActiveWorkspace('analyzer');
    }
  }, [activeWorkspace, showUnifiedUploader]);

  useEffect(() => {
    if (!isToolMenuOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsToolMenuOpen(false);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (toolMenuRef.current?.contains(event.target)) return;
      setIsToolMenuOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isToolMenuOpen]);

  const isDocsRoute = pathname === '/docs';
  const canSwitchWorkspaces = !isDocsRoute && !showUnifiedUploader;
  const activeCaseFile =
    (activeCaseFileId ? caseFiles.find(file => file.id === activeCaseFileId) : null) ??
    caseFiles[caseFiles.length - 1] ??
    null;
  const caseFilesLabel = `${caseFiles.length} file${caseFiles.length === 1 ? '' : 's'}`;
  const analyzerFileTabs = buildAnalyzerFileTabs(harTabs, logTabs, basicTabs);
  const isAnalyzerToolActive = activeTool === 'har' || activeTool === 'console' || activeTool === 'basic';
  const supportWorkbenchFrameUrl = buildSupportWorkbenchUrl(SUPPORT_WORKBENCH_URL, supportSessionId, theme);
  const headerTitle = isDocsRoute
    ? 'Documentation'
    : 'Support Analyzer Workbench';
  const headerSubtitle = isDocsRoute
    ? 'Curated usage guide for HAR and console log analysis'
    : showUnifiedUploader
    ? 'Upload case files once for visual and AI diagnosis'
    : canSwitchWorkspaces && activeWorkspace === 'support'
    ? 'AI Diagnosis mode'
    : activeTool === 'compare'
    ? 'Visual Analysis: HAR Compare'
    : activeTool === 'sanitizer'
    ? 'Visual Analysis: HAR Sanitizer'
    : activeTool === 'basic'
    ? 'Visual Analysis: file preview'
    : 'Visual Analysis: analyzer';
  const headerActionLabel = isDocsRoute ? 'Back to Analyzer' : 'Documentation';
  const handleHeaderAction = () => {
    if (isDocsRoute) {
      setActiveWorkspace('analyzer');
      navigateTo('/');
      return;
    }

    navigateTo(isDocsRoute ? '/' : '/docs');
  };

  const handleWorkspaceChange = (workspace: WorkspaceMode) => {
    setActiveWorkspace(workspace);
    if (pathname !== '/') {
      navigateTo('/');
    }
  };

  const handleBasicFileAiDiagnosis = useCallback(async (tab: BasicFileTab) => {
    setActiveCaseFileId(tab.caseFileId);
    await syncFilesToSupportWorkbench([tab.file], { throwOnError: true });
    handleWorkspaceChange('support');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncFilesToSupportWorkbench]);

  const handleAnalyzerToolSelect = () => {
    setActiveWorkspace('analyzer');
    setIsToolMenuOpen(false);

    if (pathname !== '/') {
      navigateTo('/');
    }

    if (activeCaseFile?.analyzerKind === 'log' && logTabs.length > 0) {
      setActiveTool('console');
      return;
    }

    if (activeCaseFile && isBasicAnalyzerKind(activeCaseFile.analyzerKind) && basicTabs.length > 0) {
      setActiveTool('basic');
      return;
    }

    if (harTabs.length > 0) {
      setActiveTool('har');
      return;
    }

    if (logTabs.length > 0) {
      setActiveTool('console');
      return;
    }

    if (basicTabs.length > 0) {
      setActiveTool('basic');
    }
  };

  const handleToolMenuSelect = (nextTool: 'compare' | 'sanitizer') => {
    setActiveWorkspace('analyzer');
    setIsToolMenuOpen(false);

    if (pathname !== '/') {
      navigateTo('/');
    }

    handleToolChange(nextTool);
  };

  const openCaseFileInAnalyzer = (file: CaseFileItem) => {
    setActiveWorkspace('analyzer');
    setActiveCaseFileId(file.id);

    if (pathname !== '/') {
      navigateTo('/');
    }

    if (isBasicAnalyzerKind(file.analyzerKind)) {
      const existingTab = basicTabs.find(tab => tab.caseFileId === file.id);
      if (existingTab) {
        handleBasicTabSwitch(existingTab.id);
        return;
      }

      if (!file.sourceFile || basicTabs.length >= MAX_BASIC_TABS) return;

      const classification: UploadFileClassification = {
        analyzerKind: file.analyzerKind,
        displayKind: file.kind,
        extension: file.extension,
        mediaType: file.mediaType,
        classificationConfidence: file.classificationConfidence,
        classificationReasons: file.classificationReasons,
        visualStatus: file.visualStatus,
        suggestedToolName: file.suggestedToolName,
      };
      openBasicTab(file.sourceFile, classification, file.id);
      return;
    }

    if (file.analyzerKind === 'har') {
      const existingTab = harTabs.find(tab => caseFileMatchesAnalyzerTarget(file, 'har', tab));
      if (existingTab) {
        handleHarFileTabSwitch(existingTab.id);
        return;
      }
      if (!file.fileId || harTabs.length >= MAX_HAR_TABS) return;

      const newTab: HarFileTab = {
        id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        fileId: file.fileId,
        fileName: file.name,
        fileSize: file.size,
        createdAt: Date.now(),
      };
      setHarTabs(prev => [...prev, newTab]);
      setActiveHarTabId(newTab.id);
      setActiveTool('har');
      return;
    }

    const existingTab = logTabs.find(tab => caseFileMatchesAnalyzerTarget(file, 'log', tab));
    if (existingTab) {
      handleLogTabSwitch(existingTab.id);
      return;
    }
    if ((!file.fileId && !file.localData) || logTabs.length >= MAX_LOG_TABS) return;

    const newTab: LogFileTab = {
      id: `logtab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fileId: file.fileId,
      fileName: file.name,
      fileSize: file.size,
      localData: file.localData ?? null,
      createdAt: Date.now(),
    };
    setLogTabs(prev => [...prev, newTab]);
    setActiveLogTabId(newTab.id);
    setActiveTool('console');
  };

  return (
    <div className="app-container">
      {/* Shared upload modal for adding files after a case is open. */}
      {isUploadModalOpen && (
        <div className="sanitize-modal-overlay upload-workbench-modal-overlay">
          <div
            className="sanitize-modal upload-workbench-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-workbench-modal-title"
          >
            <div className="sanitize-modal-header upload-workbench-modal-header">
              <div className="sanitize-modal-icon">
                <UploadIcon />
              </div>
              <div>
                <h2 id="upload-workbench-modal-title">Upload</h2>
                <p>Add files to the current workspace.</p>
              </div>
            </div>
            <div className="upload-workbench-modal-body">
              <UnifiedUploader
                onHarFileUpload={async (result, sourceFile) => {
                  await handleUnifiedHarUpload(result, sourceFile);
                  setIsUploadModalOpen(false);
                }}
                harRecentFiles={harRecentFiles}
                onClearHarRecent={() => {
                  setHarRecentFiles([]);
                  localStorage.removeItem(HAR_RECENT_FILES_KEY);
                }}
                onLogFileUpload={async (result, sourceFile) => {
                  await handleUnifiedLogUpload(result, sourceFile);
                  setIsUploadModalOpen(false);
                }}
                onBasicFileUpload={async (sourceFile, classification) => {
                  await handleUnifiedBasicUpload(sourceFile, classification);
                  setIsUploadModalOpen(false);
                }}
                logRecentFiles={logRecentFiles}
                onClearLogRecent={() => {
                  setLogRecentFiles([]);
                  localStorage.removeItem(LOG_RECENT_FILES_KEY);
                  void clearRecentFiles('log');
                }}
                recentPreviewLimit={3}
                onOpenExistingRecentFile={handleOpenExistingRecentFile}
              />
            </div>
            <button
              className="sanitize-modal-close"
              type="button"
              onClick={() => setIsUploadModalOpen(false)}
              aria-label="Close upload dialog"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      )}

      <header className="app-header">
        <div className="header-brand">
          <svg className="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
            <line x1="12" y1="22.08" x2="12" y2="12"></line>
          </svg>
          <div className="header-title-group">
            <h1>{headerTitle}</h1>
          </div>
          <span className="header-divider">{headerSubtitle}</span>
        </div>
        <div className="app-header-center">
          <span className="header-poc-badge">Proof of Concept</span>
        </div>
        <div className="app-header-actions">
          <button type="button" className="app-header-action-button" onClick={handleHeaderAction}>
            {isDocsRoute ? <ArrowLeftIcon /> : <FileTextIcon />}
            <span>{headerActionLabel}</span>
          </button>
          <ThemeSwitcher theme={theme} onChange={handleThemeChange} />
        </div>
      </header>

      <main className="main-content">
        {isDocsRoute ? (
          <DocumentationPage
            onBackToAnalyzer={() => {
              setActiveWorkspace('analyzer');
              navigateTo('/');
            }}
          />
        ) : (
          <>
        {canSwitchWorkspaces && activeCaseFile && (
          <section className="analysis-toolbar" aria-label="Analysis toolbar">
            <div className="analysis-toolbar-primary">
              <div className="tool-menu-shell" ref={toolMenuRef}>
                <button
                  type="button"
                  className="tool-menu-button"
                  aria-label="Open tools"
                  aria-haspopup="menu"
                  aria-expanded={isToolMenuOpen}
                  title="Open tools"
                  onClick={() => setIsToolMenuOpen(open => !open)}
                >
                  <span className="tool-menu-icon" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span>Tools</span>
                </button>
                {isToolMenuOpen && (
                  <div className="tool-menu-popover" role="menu" aria-label="Tools">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={isAnalyzerToolActive}
                      className={`tool-menu-item ${isAnalyzerToolActive ? 'is-active' : ''}`}
                      onClick={handleAnalyzerToolSelect}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      </svg>
                      <span>Analyzer</span>
                      {isAnalyzerToolActive && <span className="tool-menu-state">Active</span>}
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={activeTool === 'compare'}
                      className={`tool-menu-item ${activeTool === 'compare' ? 'is-active' : ''}`}
                      onClick={() => handleToolMenuSelect('compare')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <rect x="3" y="3" width="8" height="11" rx="1" />
                        <rect x="13" y="3" width="8" height="11" rx="1" />
                        <path d="M7 18h10M12 14v4" strokeLinecap="round" />
                      </svg>
                      <span>HAR Compare</span>
                      {activeTool === 'compare' && <span className="tool-menu-state">Active</span>}
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={activeTool === 'sanitizer'}
                      className={`tool-menu-item ${activeTool === 'sanitizer' ? 'is-active' : ''}`}
                      onClick={() => handleToolMenuSelect('sanitizer')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M12 3v4" strokeLinecap="round" />
                        <path d="M7 10V7.5A2.5 2.5 0 0 1 9.5 5h5A2.5 2.5 0 0 1 17 7.5V10" strokeLinecap="round" />
                        <rect x="5" y="10" width="14" height="11" rx="2" />
                        <circle cx="12" cy="15" r="1.5" />
                        <path d="M12 16.5V18" strokeLinecap="round" />
                      </svg>
                      <span>HAR Sanitizer</span>
                      {activeTool === 'sanitizer' && <span className="tool-menu-state">Active</span>}
                    </button>
                  </div>
                )}
              </div>
              <span className="analysis-file-count">{caseFilesLabel}</span>
            </div>
            <div className="analysis-switcher case-files-mode-controls" aria-label="Analysis mode">
              <button
                type="button"
                className={`analysis-switcher-option ${activeWorkspace === 'analyzer' ? 'is-active' : ''}`}
                aria-pressed={activeWorkspace === 'analyzer'}
                onClick={() => handleWorkspaceChange('analyzer')}
              >
                Visual Analysis
              </button>
              <button
                type="button"
                className={`analysis-switcher-option ${activeWorkspace === 'support' ? 'is-active' : ''}`}
                aria-pressed={activeWorkspace === 'support'}
                onClick={() => handleWorkspaceChange('support')}
              >
                AI Diagnosis
              </button>
            </div>
            <div className="analysis-toolbar-actions">
              <button type="button" className="btn-toolbar btn-upload analysis-upload-button" onClick={handleAddTabClick}>
                <UploadIcon />
                <span>Upload</span>
              </button>
            </div>
          </section>
        )}
        <section
          className="workspace-pane analyzer-workspace"
          aria-label="Visual Analysis"
          hidden={activeWorkspace !== 'analyzer'}
        >
        {/* ── Unified uploader — shown when no files are open in either tool ── */}
        {showUnifiedUploader && (
          <div className="upload-section">
            <UnifiedUploader
              onHarFileUpload={handleUnifiedHarUpload}
              harRecentFiles={harRecentFiles}
              onClearHarRecent={() => {
                setHarRecentFiles([]);
                localStorage.removeItem(HAR_RECENT_FILES_KEY);
              }}
              onLogFileUpload={handleUnifiedLogUpload}
              onBasicFileUpload={handleUnifiedBasicUpload}
              logRecentFiles={logRecentFiles}
              onClearLogRecent={() => {
                setLogRecentFiles([]);
                localStorage.removeItem(LOG_RECENT_FILES_KEY);
                void clearRecentFiles('log');
              }}
            />
          </div>
        )}

        {/* Tool content hidden while the unified home screen is shown */}
        {!showUnifiedUploader && (<>
        {isAnalyzerToolActive && analyzerFileTabs.length > 0 && (
          <div className="har-file-tabs analyzer-file-tabs" aria-label="Analyzer files">
            {analyzerFileTabs.map(tab => {
              const isActive =
                (tab.kind === 'har' && activeTool === 'har' && tab.id === activeHarTabId) ||
                (tab.kind === 'log' && activeTool === 'console' && tab.id === activeLogTabId) ||
                (isBasicAnalyzerKind(tab.kind) && activeTool === 'basic' && tab.id === activeBasicTabId);
              const typeLabel = getAnalyzerFileTypeLabel(tab.kind, tab.displayKind, tab.extension);
              const handleTabClick = () => {
                if (tab.kind === 'har') {
                  handleHarFileTabSwitch(tab.id);
                  return;
                }

                if (tab.kind === 'log') {
                  handleLogTabSwitch(tab.id);
                  return;
                }

                handleBasicTabSwitch(tab.id);
              };
              const handleCloseTab = (event: React.MouseEvent) => {
                if (tab.kind === 'har') {
                  closeHarTab(tab.id, event);
                  return;
                }

                if (tab.kind === 'log') {
                  closeLogTab(tab.id, event);
                  return;
                }

                closeBasicTab(tab.id, event);
              };

              return (
                <button
                  key={`${tab.kind}:${tab.id}`}
                  className={`har-file-tab analyzer-file-tab ${isActive ? 'active' : ''}`}
                  onClick={handleTabClick}
                  title={tab.fileName}
                >
                  <svg className="har-file-tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    {tab.kind === 'har' ? (
                      <>
                        <path d="M3 2h7l3 3v9H3z" />
                        <path d="M10 2v3h3" />
                      </>
                    ) : tab.kind === 'log' ? (
                      <>
                        <polyline points="4 11 7 8 4 5" />
                        <line x1="9" y1="12" x2="13" y2="12" />
                      </>
                    ) : tab.kind === 'table' ? (
                      <>
                        <path d="M2.5 3.5h11v9h-11z" />
                        <path d="M2.5 6.5h11M6 3.5v9" />
                      </>
                    ) : tab.kind === 'image' ? (
                      <>
                        <path d="M2.5 3h11v10h-11z" />
                        <circle cx="6" cy="6" r="1" />
                        <path d="M4 11l2.5-2.5L8.5 10l1.5-2 2.5 3" />
                      </>
                    ) : tab.kind === 'archive' ? (
                      <>
                        <path d="M3 3.5h10v9H3z" />
                        <path d="M5 3.5v9M7 3.5v9" />
                      </>
                    ) : (
                      <>
                        <path d="M3 2h7l3 3v9H3z" />
                        <path d="M10 2v3h3" />
                        <path d="M5 8h6M5 10.5h4" />
                      </>
                    )}
                  </svg>
                  <span
                    className={`analyzer-file-type analyzer-file-type-${tab.kind}`}
                  >
                    {typeLabel}
                  </span>
                  <span className="har-file-tab-name">{tab.fileName}</span>
                  <span
                    className="har-file-tab-close"
                    role="button"
                    aria-label={`Close ${tab.fileName}`}
                    onClick={handleCloseTab}
                  >
                    x
                  </span>
                </button>
              );
            })}

            {analyzerFileTabs.length < MAX_HAR_TABS + MAX_LOG_TABS + MAX_BASIC_TABS && (
              <button
                className="har-file-tab-add"
                onClick={handleAddTabClick}
                title="Open another analyzer file"
                aria-label="Open another analyzer file"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        )}

        {isAnalyzerToolActive && analyzerFileTabs.length === 0 && !isLogProcessing && (
          <div className="analyzer-empty-state" role="region" aria-label="No analyzer tabs open">
            <div className="analyzer-empty-panel">
              <div className="analyzer-empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" />
                  <path d="M8 9h8M8 13h5" strokeLinecap="round" />
                </svg>
              </div>
              <div className="analyzer-empty-copy">
                <h2>No analyzer tabs open</h2>
                <p>Open an uploaded file or add another file.</p>
              </div>
              {caseFiles.length > 0 && (
                <div className="analyzer-empty-files" aria-label="Uploaded files">
                  {caseFiles.map(file => (
                    <button
                      key={file.id}
                      type="button"
                      className="analyzer-empty-file"
                      onClick={() => openCaseFileInAnalyzer(file)}
                      aria-label={`Open ${file.name}`}
                    >
                      <span className="analyzer-empty-file-kind">{file.kind}</span>
                      <span className="analyzer-empty-file-name" title={file.name}>{file.name}</span>
                      <span className="analyzer-empty-file-size">{formatCaseFileSize(file.size)}</span>
                    </button>
                  ))}
                </div>
              )}
              <button type="button" className="btn-toolbar btn-upload analyzer-empty-upload" onClick={handleAddTabClick}>
                Upload
              </button>
            </div>
          </div>
        )}

        {/* HAR Analyzer Tool — multi-tab */}
        {activeTool === 'har' && analyzerFileTabs.length > 0 && (
          <>
            {/* ── HAR file tab bar ─────────────────────────────────────── */}
            {/* ── One HarTabContent per open file (all mounted, only active shown) */}
            {harTabs.map(tab => (
              <HarTabContent
                key={tab.id}
                tabId={tab.id}
                fileId={tab.fileId}
                fileName={tab.fileName}
                fileSize={tab.fileSize}
                isActive={tab.id === activeHarTabId}
                backendUrl={BACKEND_URL}
              />
            ))}
          </>
        )}

        {/* HAR Sanitizer Tool */}
        {activeTool === 'sanitizer' && (
          <div className="sanitizer-wrapper">
            <HarSanitizer />
          </div>
        )}

        {/* Console Log Analyzer Tool */}
        {activeTool === 'console' && (analyzerFileTabs.length > 0 || isLogProcessing) && (
          <>
            {/* Loading overlay — shown while a new tab is being created (upload + parse) */}
            {isLogProcessing && (
              <div className="loading-overlay">
                <div className="spinner" />
                <p>{logLoadingMessage}</p>
                {showLogLocalFallback && (
                  <button
                    className="btn-local-fallback"
                    onClick={() => logCancelRef.current?.()}
                  >
                    Parse locally instead
                  </button>
                )}
              </div>
            )}

            {/* ── Console file tab bar ─────────────────────────────────── */}
            {/* One ConsoleLogTabContent per open file — all mounted, only active shown */}
            {logTabs.map(tab => (
              <ConsoleLogTabContent
                key={tab.id}
                tabId={tab.id}
                fileId={tab.fileId}
                fileName={tab.fileName}
                fileSize={tab.fileSize}
                initialData={tab.localData}
                isActive={tab.id === activeLogTabId}
                backendUrl={BACKEND_URL}
              />
            ))}
          </>
        )}

        {/* Basic universal file analyzer */}
        {activeTool === 'basic' && analyzerFileTabs.length > 0 && (
          <>
            {basicTabs.map(tab => (
              <BasicFileAnalyzer
                key={tab.id}
                file={tab.file}
                fileName={tab.fileName}
                fileSize={tab.fileSize}
                analyzerKind={tab.analyzerKind}
                displayKind={tab.displayKind}
                mediaType={tab.mediaType}
                extension={tab.extension}
                classificationConfidence={tab.classificationConfidence}
                classificationReasons={tab.classificationReasons}
                visualStatus={tab.visualStatus}
                suggestedToolName={tab.suggestedToolName}
                isActive={tab.id === activeBasicTabId}
                autoOpenedArchiveEntryKey={tab.autoOpenedArchiveEntryKey}
                onArchiveAutoOpen={(entryKey) => handleArchiveAutoOpen(tab.id, entryKey)}
                onAskAiDiagnosis={() => handleBasicFileAiDiagnosis(tab)}
                onOpenArchiveEntry={handleArchiveChildOpen}
                onUploadArchiveEntriesToAi={handleArchiveEntriesUploadToAi}
              />
            ))}
          </>
        )}
        </>)}

        {/* HAR Compare Tool — mounted OUTSIDE the showUnifiedUploader conditional so it
            is never unmounted when the user switches tabs. Hidden via display:none
            when inactive so all loaded files and AI results survive tab switches. */}
        <div
          className="compare-wrapper"
          ref={compareWrapperRef}
          style={{ display: activeTool === 'compare' ? undefined : 'none' }}
        >
          <HarCompare openTabs={harTabs.map(t => ({ fileId: t.fileId, fileName: t.fileName }))} />
        </div>
        </section>

        {canSwitchWorkspaces && (
          <section
            className="workspace-pane support-workbench-workspace"
            aria-label="AI Diagnosis"
            hidden={activeWorkspace !== 'support'}
          >
            <iframe
              className="support-workbench-frame"
              title="AI Diagnosis"
              src={supportWorkbenchFrameUrl}
            />
          </section>
        )}
          </>
        )}
      </main>

    </div>
  );
};

export default App;
