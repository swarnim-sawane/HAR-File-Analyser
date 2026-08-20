// src/App.tsx

import React, { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import FileUploader from './components/FileUploader';
import ConsoleLogUploader from './components/ConsoleLogUploader';
import UnifiedUploader from './components/UnifiedUploader';
import HarTabContent from './components/HarTabContent';
import ConsoleLogTabContent from './components/ConsoleLogTabContent';
import { ConsoleLogFile } from './types/consolelog';
import { ConsoleLogParser } from './utils/consoleLogParser';
import './styles/globals.css';
import ThemeSwitcher from './components/ThemeSwitcher';
import { UploadResult, chunkedUploader } from './services/chunkedUploader';
import { apiClient } from './services/apiClient';
import { wsClient } from './services/websocketClient';
import { storeRecentFile, restoreRecentFile, clearRecentFiles } from './services/recentFilesStore';
import HarCompare from './components/HarCompare';
import HarSanitizer from './components/HarSanitizer';
import DocumentationPage from './components/DocumentationPage';
import { ArrowLeftIcon, CloseIcon, FileTextIcon, UploadIcon } from './components/Icons';
import { applyTheme, resolveInitialTheme, ThemeMode } from './theme';
import {
  createLocalConsoleLogUploadResult,
  shouldParseConsoleLogLocally,
} from './utils/consoleLogProcessing';
import type { UploadFileType } from './utils/uploadFileTypes';
import { BACKEND_BASE_URL } from './services/runtimeUrls';
import type { HarPreviewSnapshot } from './services/progressiveHarPreview';
import type { HarPreviewSession } from './services/harPreviewClient';

interface RecentFile {
  name: string;
  timestamp: number;
  data: File;
}

/** A single open HAR file tab */
interface HarFileTab {
  id: string;       // unique tab id (generated)
  fileId: string;   // empty while local preview is provisional
  fileName: string; // display name
  previewId?: string;
  previewSnapshot?: HarPreviewSnapshot;
  generation: number;
}

/** A single open Console Log tab */
interface LogFileTab {
  id: string;
  fileId: string | null;          // null when parsed locally (small files)
  fileName: string;
  localData: ConsoleLogFile | null; // pre-parsed data for small files
}

type AnalyzerFileKind = 'har' | 'log';

interface AnalyzerFileTabRef {
  id: string;
  kind: AnalyzerFileKind;
}

const BACKEND_URL = BACKEND_BASE_URL;

type AppPath = '/' | '/docs';

const normalizePathname = (pathname: string): AppPath =>
  pathname === '/docs' || pathname === '/docs/' ? '/docs' : '/';

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
  const harTabsRef = useRef<HarFileTab[]>([]);
  const [activeHarTabId, setActiveHarTabId] = useState<string | null>(null);
  const [harShowUploader, setHarShowUploader] = useState(true);
  const [harRecentFiles, setHarRecentFiles] = useState<RecentFile[]>([]);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  // Ref to hidden file-input used for the "+" add-tab button in the tab bar
  // Track which tab (if any) is currently generating insights — for the leave guard
  // Sanitize modal state for the "+" add-tab upload flow

  // ── Console Log multi-tab state ──────────────────────────────────────────────
  const [logTabs, setLogTabs] = useState<LogFileTab[]>([]);
  const [activeLogTabId, setActiveLogTabId] = useState<string | null>(null);
  const [fileTabOrder, setFileTabOrder] = useState<AnalyzerFileTabRef[]>([]);
  const [logRecentFiles, setLogRecentFiles] = useState<RecentFile[]>([]);
  const [isLogProcessing, setIsLogProcessing] = useState(false);
  const [logLoadingMessage, setLogLoadingMessage] = useState('Loading console log file...');
  const [showLogLocalFallback, setShowLogLocalFallback] = useState(false);
  const logCancelRef = React.useRef<(() => void) | null>(null);
  const compareWrapperRef = useRef<HTMLDivElement | null>(null);
  const harPreviewSessionsRef = useRef<Map<string, HarPreviewSession>>(new Map());
  const closedHarPreviewIdsRef = useRef<Set<string>>(new Set());

  const MAX_LOG_TABS = 8;

  // ── Main navigation ──────────────────────────────────────────────────────────
  const [activeTool, setActiveTool] = useState<'har' | 'sanitizer' | 'console' | 'compare'>('har');
  const [lastAnalyzerTool, setLastAnalyzerTool] = useState<'har' | 'console'>('har');

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

  useEffect(() => {
    harTabsRef.current = harTabs;
  }, [harTabs]);

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
    if (activeTool === 'har' || activeTool === 'console') {
      setLastAnalyzerTool(activeTool);
    }
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
      openHarTab({ fileId, fileName: fileName || fileId, fileSize: 0, hash: '', jobId: '', success: true, message: '' }, true);
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

  const handleToolChange = (nextTool: 'har' | 'sanitizer' | 'console' | 'compare') => {
    if (nextTool === activeTool) return;
    setActiveTool(nextTool);
  };

  const handleThemeChange = useCallback((nextTheme: ThemeMode) => {
    startTransition(() => {
      setTheme((currentTheme) => (currentTheme === nextTheme ? currentTheme : nextTheme));
    });
  }, []);

  /** Activate an evidence file and route it to its deterministic analyzer. */
  const activateFileTab = useCallback((tab: AnalyzerFileTabRef) => {
    if (tab.kind === 'har') {
      setActiveHarTabId(tab.id);
      setHarShowUploader(false);
      setActiveTool('har');
      return;
    }

    setActiveLogTabId(tab.id);
    setActiveTool('console');
  }, []);



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

  const handleHarPreviewSessionCreated = useCallback((session: HarPreviewSession) => {
    harPreviewSessionsRef.current.set(session.previewId, session);
  }, []);

  const handleHarPreviewSnapshot = useCallback((snapshot: HarPreviewSnapshot) => {
    if (closedHarPreviewIdsRef.current.has(snapshot.previewId)) return;

    const previewTabId = `preview_${snapshot.previewId}`;
    const currentTabs = harTabsRef.current;
    const existingPreview = currentTabs.find((tab) => tab.previewId === snapshot.previewId);
    if (!existingPreview && currentTabs.length >= MAX_HAR_TABS) return;

    setHarTabs((currentTabs) => {
      const existingIndex = currentTabs.findIndex((tab) => tab.previewId === snapshot.previewId);
      if (existingIndex >= 0) {
        const existing = currentTabs[existingIndex];
        if ((existing.previewSnapshot?.revision ?? -1) >= snapshot.revision) return currentTabs;
        const next = [...currentTabs];
        next[existingIndex] = { ...existing, fileName: snapshot.fileName, previewSnapshot: snapshot };
        return next;
      }

      return [...currentTabs, {
        id: previewTabId,
        fileId: '',
        fileName: snapshot.fileName,
        previewId: snapshot.previewId,
        previewSnapshot: snapshot,
        generation: 0,
      }];
    });
    setFileTabOrder((currentOrder) => currentOrder.some((tab) => (
      tab.kind === 'har' && tab.id === previewTabId
    )) ? currentOrder : [...currentOrder, { id: previewTabId, kind: 'har' }]);
    setActiveHarTabId(previewTabId);
    setHarShowUploader(false);
    setActiveTool('har');
    setIsUploadModalOpen(false);
  }, []);

  const handleHarPreviewRemoved = useCallback((
    previewId: string,
    reason: 'completed' | 'cancelled' | 'failed',
  ) => {
    harPreviewSessionsRef.current.delete(previewId);
    if (reason === 'completed') return;

    closedHarPreviewIdsRef.current.add(previewId);
    const tabId = `preview_${previewId}`;
    const remainingHarTabs = harTabsRef.current.filter((tab) => tab.id !== tabId || Boolean(tab.fileId));
    setHarTabs(remainingHarTabs);
    setFileTabOrder((currentOrder) => currentOrder.filter((tab) => (
      tab.kind !== 'har' || tab.id !== tabId
    )));
    setActiveHarTabId((currentTabId) => {
      if (currentTabId !== tabId) return currentTabId;
      const nextTabId = remainingHarTabs[0]?.id ?? null;
      if (!nextTabId) setHarShowUploader(true);
      return nextTabId;
    });
  }, []);

  const handleHarPreviewConsumed = useCallback((tabId: string) => {
    setHarTabs((currentTabs) => currentTabs.map((tab) => (
      tab.id === tabId ? { ...tab, previewSnapshot: undefined } : tab
    )));
  }, []);

  /** Open a new HAR tab for the given upload result.
   *  Pass switchTool=true (default false) to also activate the HAR tool tab. */
  const openHarTab = useCallback((result: UploadResult, switchTool = false) => {
    if (result.previewId && closedHarPreviewIdsRef.current.has(result.previewId)) {
      return;
    }

    const provisionalTab = result.previewId
      ? harTabs.find((tab) => tab.previewId === result.previewId)
      : undefined;
    if (provisionalTab) {
      setHarTabs((currentTabs) => currentTabs.map((tab) => tab.id === provisionalTab.id
        ? {
            ...tab,
            fileId: result.fileId,
            fileName: result.fileName,
            generation: tab.generation + 1,
          }
        : tab));
      setActiveHarTabId(provisionalTab.id);
      setHarShowUploader(false);
      if (switchTool) setActiveTool('har');
      registerRecentHarFile(result.fileName, new File([], result.fileName));
      return;
    }

    const normalizedName = result.fileName.trim().toLowerCase();
    const existingTab = harTabs.find(
      tab => tab.fileName.trim().toLowerCase() === normalizedName
    );
    if (existingTab) {
      setActiveHarTabId(existingTab.id);
      setHarShowUploader(false);
      if (switchTool) activateFileTab({ id: existingTab.id, kind: 'har' });
      return;
    }

    if (harTabs.length >= MAX_HAR_TABS) {
      console.warn(`Max ${MAX_HAR_TABS} HAR tabs open — close one first`);
      return;
    }
    const newTab: HarFileTab = {
      id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fileId: result.fileId,
      fileName: result.fileName,
      generation: 0,
    };
    setHarTabs(prev => [...prev, newTab]);
    setFileTabOrder(prev => [...prev, { id: newTab.id, kind: 'har' }]);
    setActiveHarTabId(newTab.id);
    setHarShowUploader(false);
    if (switchTool) setActiveTool('har');
    registerRecentHarFile(result.fileName, new File([], result.fileName));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activateFileTab, harTabs]);

  const handleHarFileUpload = useCallback(async (result: UploadResult) => {
    openHarTab(result);
  }, [openHarTab]);

  // ── Unified uploader callbacks ────────────────────────────────────────────
  /** Called by UnifiedUploader when a HAR file is ready — switches to HAR tool */
  const handleUnifiedHarUpload = useCallback(async (result: UploadResult) => {
    openHarTab(result, /* switchTool */ true);
  }, [openHarTab]);

  /** Called by UnifiedUploader when a console log is ready — switches to Console tool */
  const handleUnifiedLogUpload = useCallback(async (result: UploadResult, sourceFile: File) => {
    setActiveTool('console');
    await handleLogUploadComplete(result, sourceFile);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRecentHarFile = async (file: File) => {
    // After a page refresh file.data is undefined — restore from IndexedDB by name
    let resolvedFile: File | null =
      file instanceof File && file.size > 0 ? file : null;

    if (!resolvedFile) {
      const name = file instanceof File ? file.name : (file as any)?.name as string | undefined;
      if (name) resolvedFile = await restoreRecentFile('har', name);
    }

    if (!resolvedFile) {
      console.error('Recent HAR file is no longer available. Please upload the original file again.');
      return;
    }

    try {
      const result = await chunkedUploader.uploadFile(resolvedFile, 'har', () => {});
      openHarTab(result);
      registerRecentHarFile(resolvedFile.name, resolvedFile);
    } catch (err) {
      console.error('Failed to re-upload recent HAR file:', err);
    }
  };

  const handleOpenExistingRecentFile = useCallback((file: {
    name: string;
    fileType: UploadFileType;
  }): boolean => {
    const normalizedName = file.name.trim().toLowerCase();

    if (file.fileType === 'har') {
      const existingTab = harTabs.find(
        tab => tab.fileName.trim().toLowerCase() === normalizedName
      );
      if (!existingTab) return false;

      activateFileTab({ id: existingTab.id, kind: 'har' });
      setIsUploadModalOpen(false);
      return true;
    }

    const existingTab = logTabs.find(
      tab => tab.fileName.trim().toLowerCase() === normalizedName
    );
    if (!existingTab) return false;

    activateFileTab({ id: existingTab.id, kind: 'log' });
    setIsUploadModalOpen(false);
    return true;
  }, [activateFileTab, harTabs, logTabs]);

  /** Triggered by an analyzer tab-bar plus button. */
  const handleAddTabClick = () => {
    setIsUploadModalOpen(true);
  };

  // ── Console Log tab management ────────────────────────────────────────────────

  const openLogTab = useCallback((
    opts: { fileId: string | null; fileName: string; localData: ConsoleLogFile | null },
    switchTool = false
  ) => {
    const normalizedName = opts.fileName.trim().toLowerCase();
    const existingTab = logTabs.find(
      tab => tab.fileName.trim().toLowerCase() === normalizedName
    );
    if (existingTab) {
      setActiveLogTabId(existingTab.id);
      if (switchTool) activateFileTab({ id: existingTab.id, kind: 'log' });
      return;
    }

    if (logTabs.length >= MAX_LOG_TABS) {
      console.warn(`Max ${MAX_LOG_TABS} console log tabs open — close one first`);
      return;
    }
    const newTab: LogFileTab = {
      id: `logtab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fileId: opts.fileId,
      fileName: opts.fileName,
      localData: opts.localData,
    };
    setLogTabs(prev => [...prev, newTab]);
    setFileTabOrder(prev => [...prev, { id: newTab.id, kind: 'log' }]);
    setActiveLogTabId(newTab.id);
    if (switchTool) setActiveTool('console');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activateFileTab, logTabs]);

  /** Close a file tab and preserve the combined cross-analyzer order. */
  const closeFileTab = (tab: AnalyzerFileTabRef, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();

    const closedIndex = fileTabOrder.findIndex(candidate => (
      candidate.id === tab.id && candidate.kind === tab.kind
    ));
    const nextOrder = fileTabOrder.filter(candidate => !(
      candidate.id === tab.id && candidate.kind === tab.kind
    ));
    const wasDisplayed = tab.kind === 'har'
      ? activeTool === 'har' && activeHarTabId === tab.id
      : activeTool === 'console' && activeLogTabId === tab.id;

    setFileTabOrder(nextOrder);

    if (tab.kind === 'har') {
      const closingHarTab = harTabs.find(candidate => candidate.id === tab.id);
      if (closingHarTab?.previewId && !closingHarTab.fileId) {
        closedHarPreviewIdsRef.current.add(closingHarTab.previewId);
        harPreviewSessionsRef.current.get(closingHarTab.previewId)?.cancel();
        harPreviewSessionsRef.current.delete(closingHarTab.previewId);
      }
      const nextHarTabs = harTabs.filter(candidate => candidate.id !== tab.id);
      setHarTabs(nextHarTabs);
      if (activeHarTabId === tab.id && !wasDisplayed) {
        setActiveHarTabId(nextHarTabs[0]?.id ?? null);
      }
      if (nextHarTabs.length === 0) setHarShowUploader(true);
    } else {
      const nextLogTabs = logTabs.filter(candidate => candidate.id !== tab.id);
      setLogTabs(nextLogTabs);
      if (activeLogTabId === tab.id && !wasDisplayed) {
        setActiveLogTabId(nextLogTabs[0]?.id ?? null);
      }
    }

    if (!wasDisplayed) return;

    const nextTab = nextOrder[closedIndex] ?? nextOrder[closedIndex - 1];
    if (nextTab) {
      activateFileTab(nextTab);
      return;
    }

    setActiveHarTabId(null);
    setActiveLogTabId(null);
    setHarShowUploader(true);
    setActiveTool('har');
  };

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
    setIsLogProcessing(true);
    logCancelRef.current = null;

    // Small files: parse locally — instant, no backend wait.
    if (sourceFile && shouldParseConsoleLogLocally(result.fileSize)) {
      setLogLoadingMessage('Parsing console log…');
      try {
        const parsed: ConsoleLogFile = await ConsoleLogParser.parseFile(sourceFile);
        openLogTab({ fileId: null, fileName: sourceFile.name, localData: parsed });
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
      openLogTab({ fileId: result.fileId, fileName: result.fileName, localData: null });
      registerRecentLogFile(result.fileName, sourceFile || new File([], result.fileName));
    } catch (err) {
      console.error('Console backend flow failed, falling back to local parse:', err);
      if (sourceFile) {
        setLogLoadingMessage('Backend unavailable, parsing console log locally…');
        try {
          const parsed: ConsoleLogFile = await ConsoleLogParser.parseFile(sourceFile);
          openLogTab({ fileId: null, fileName: sourceFile.name, localData: parsed });
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

  const handleRecentLogFile = async (file: File) => {
    // Resolve the actual file — in-session it is available directly; after a page
    // refresh only the name is available so we restore content from IndexedDB.
    let resolvedFile: File | null =
      file instanceof File && file.size > 0 ? file : null;

    if (!resolvedFile) {
      const name = file instanceof File ? file.name : (file as any)?.name as string | undefined;
      if (name) resolvedFile = await restoreRecentFile('log', name);
    }

    if (!resolvedFile) {
      console.error('Recent log file is no longer available. Please upload the original file again.');
      return;
    }

    try {
      const result = shouldParseConsoleLogLocally(resolvedFile.size)
        ? createLocalConsoleLogUploadResult(resolvedFile)
        : await chunkedUploader.uploadFile(resolvedFile, 'log', () => {});
      await handleLogUploadComplete(result, resolvedFile);
    } catch (err) {
      console.error('Recent log re-upload failed, using local fallback:', err);
      setIsLogProcessing(true);
      setLogLoadingMessage('Re-upload failed, parsing console log locally...');
      try {
        const parsed: ConsoleLogFile = await ConsoleLogParser.parseFile(resolvedFile);
        openLogTab({ fileId: null, fileName: resolvedFile.name, localData: parsed });
        registerRecentLogFile(resolvedFile.name, resolvedFile);
      } catch (parseErr) {
        console.error('Local fallback parse failed:', parseErr);
      }
      setIsLogProcessing(false);
      setLogLoadingMessage('Loading console log file...');
    }
  };

  // Show the unified uploader only when there is truly nothing loaded in either tool.
  // Once any file is open the tool tabs take over and each tool manages its own upload.
  const showUnifiedUploader =
    harTabs.length === 0 &&
    logTabs.length === 0 &&
    !isLogProcessing;

  const analyzerFileTabs = fileTabOrder.flatMap((tabRef) => {
    const fileTab = tabRef.kind === 'har'
      ? harTabs.find(tab => tab.id === tabRef.id)
      : logTabs.find(tab => tab.id === tabRef.id);

    return fileTab ? [{ ...tabRef, fileName: fileTab.fileName }] : [];
  });
  const canOpenAnotherAnalyzerFile =
    harTabs.length < MAX_HAR_TABS || logTabs.length < MAX_LOG_TABS;

  const handleFileTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentTab: AnalyzerFileTabRef
  ) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

    event.preventDefault();
    const currentIndex = analyzerFileTabs.findIndex(tab => (
      tab.id === currentTab.id && tab.kind === currentTab.kind
    ));
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + analyzerFileTabs.length) % analyzerFileTabs.length;
    } else if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % analyzerFileTabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = analyzerFileTabs.length - 1;
    }

    const nextTab = analyzerFileTabs[nextIndex];
    activateFileTab(nextTab);
    requestAnimationFrame(() => {
      document.getElementById(`analyzer-file-tab-${nextTab.kind}-${nextTab.id}`)?.focus();
    });
  };

  const isDocsRoute = pathname === '/docs';
  const headerTitle = isDocsRoute
    ? 'Documentation'
    : showUnifiedUploader
    ? 'File Analyzer'
    : activeTool === 'har' || activeTool === 'console'
    ? 'File Analyzer'
    : activeTool === 'compare'
    ? 'HAR Compare'
    : activeTool === 'sanitizer'
    ? 'HAR Sanitizer'
    : 'File Analyzer';
  const headerSubtitle = isDocsRoute
    ? 'Curated usage guide for HAR and console log analysis'
    : showUnifiedUploader
    ? 'HAR & Console Log Analysis'
    : activeTool === 'har' || activeTool === 'console'
    ? 'HAR & Console Log Analysis'
    : activeTool === 'compare'
    ? 'Side-by-side HAR comparison'
    : activeTool === 'sanitizer'
    ? 'Privacy-safe evidence preparation'
    : 'HAR & Console Log Analysis';
  const headerActionLabel = isDocsRoute ? 'Back to Analyzer' : 'Documentation';
  const handleHeaderAction = () => {
    navigateTo(isDocsRoute ? '/' : '/docs');
  };

  return (
    <div className="app-container">
      <div
        className={isUploadModalOpen
          ? 'sanitize-modal-overlay upload-workbench-modal-overlay'
          : 'background-upload-runtime'}
        onMouseDown={(event) => {
          if (isUploadModalOpen && event.target === event.currentTarget) setIsUploadModalOpen(false);
        }}
      >
        <div
          className={isUploadModalOpen
            ? 'sanitize-modal upload-workbench-modal'
            : 'background-upload-runtime__inner'}
          role={isUploadModalOpen ? 'dialog' : undefined}
          aria-modal={isUploadModalOpen ? true : undefined}
          aria-labelledby={isUploadModalOpen ? 'upload-workbench-modal-title' : undefined}
        >
          {isUploadModalOpen && (
            <div className="sanitize-modal-header upload-workbench-modal-header">
              <div className="sanitize-modal-icon" aria-hidden="true">
                <UploadIcon />
              </div>
              <div>
                <h2 id="upload-workbench-modal-title">Upload</h2>
                <p>Add another HAR file or console log to the analyzer.</p>
              </div>
            </div>
          )}
            <div className={isUploadModalOpen ? 'upload-workbench-modal-body' : 'background-upload-runtime__body'}>
              <UnifiedUploader
                onHarFileUpload={async (result) => {
                  await handleUnifiedHarUpload(result);
                  setIsUploadModalOpen(false);
                }}
                harRecentFiles={harRecentFiles}
                onClearHarRecent={() => {
                  setHarRecentFiles([]);
                  localStorage.removeItem(HAR_RECENT_FILES_KEY);
                  void clearRecentFiles('har');
                }}
                onLogFileUpload={async (result, sourceFile) => {
                  await handleUnifiedLogUpload(result, sourceFile);
                  setIsUploadModalOpen(false);
                }}
                logRecentFiles={logRecentFiles}
                onClearLogRecent={() => {
                  setLogRecentFiles([]);
                  localStorage.removeItem(LOG_RECENT_FILES_KEY);
                  void clearRecentFiles('log');
                }}
                onOpenExistingRecentFile={handleOpenExistingRecentFile}
                onHarPreviewSnapshot={handleHarPreviewSnapshot}
                onHarPreviewSessionCreated={handleHarPreviewSessionCreated}
                onHarPreviewRemoved={handleHarPreviewRemoved}
                workspaceVisible={isUploadModalOpen}
                inputId="unified-file-input-modal"
              />
            </div>
          {isUploadModalOpen && (
            <button
              className="sanitize-modal-close"
              type="button"
              onClick={() => setIsUploadModalOpen(false)}
              aria-label="Close upload dialog"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>

      <header className="app-header">
        <div className="header-brand">
          <svg className="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
            <line x1="12" y1="22.08" x2="12" y2="12"></line>
          </svg>
          <img
            className="header-oracle-logo"
            src="/themes/redwood/oracle.svg"
            alt="Oracle"
          />
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
          <DocumentationPage onBackToAnalyzer={() => navigateTo('/')} />
        ) : (
          <>
        {/* ── Unified uploader — shown when no files are open in either tool ── */}
        <div className={showUnifiedUploader ? 'upload-section' : 'background-upload-runtime'}>
            <UnifiedUploader
              onHarFileUpload={handleUnifiedHarUpload}
              harRecentFiles={harRecentFiles}
              onClearHarRecent={() => {
                setHarRecentFiles([]);
                localStorage.removeItem(HAR_RECENT_FILES_KEY);
              }}
              onLogFileUpload={handleUnifiedLogUpload}
              logRecentFiles={logRecentFiles}
              onClearLogRecent={() => {
                setLogRecentFiles([]);
                localStorage.removeItem(LOG_RECENT_FILES_KEY);
                void clearRecentFiles('log');
              }}
              onOpenExistingRecentFile={handleOpenExistingRecentFile}
              onHarPreviewSnapshot={handleHarPreviewSnapshot}
              onHarPreviewSessionCreated={handleHarPreviewSessionCreated}
              onHarPreviewRemoved={handleHarPreviewRemoved}
              workspaceVisible={showUnifiedUploader}
              inputId="unified-file-input-home"
            />
        </div>

        {/* Tool Selector + all tool content — hidden while the unified home screen is shown */}
        {!showUnifiedUploader && (<>
        <div className="tool-selector">
          <button
            className={`tool-tab ${activeTool === 'har' || activeTool === 'console' ? 'active' : ''}`}
            onClick={() => handleToolChange(lastAnalyzerTool)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 3h9l5 5v13H5z"></path>
              <path d="M14 3v5h5"></path>
              <path d="M8 12h8M8 16h8" strokeLinecap="round"></path>
            </svg>
            Analyzer
          </button>
          <button
            className={`tool-tab ${activeTool === 'compare' ? 'active' : ''}`}
            onClick={() => handleToolChange('compare')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="8" height="11" rx="1"></rect>
              <rect x="13" y="3" width="8" height="11" rx="1"></rect>
              <path d="M7 18h10M12 14v4" strokeLinecap="round"></path>
            </svg>
            Compare
          </button>
          <button
            className={`tool-tab ${activeTool === 'sanitizer' ? 'active' : ''}`}
            onClick={() => handleToolChange('sanitizer')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v4" strokeLinecap="round"></path>
              <path d="M7 10V7.5A2.5 2.5 0 0 1 9.5 5h5A2.5 2.5 0 0 1 17 7.5V10" strokeLinecap="round"></path>
              <rect x="5" y="10" width="14" height="11" rx="2"></rect>
              <circle cx="12" cy="15" r="1.5"></circle>
              <path d="M12 16.5V18" strokeLinecap="round"></path>
            </svg>
            Sanitizer
          </button>
        </div>

        {/* One chronological file rail shared by every deterministic analyzer. */}
        {analyzerFileTabs.length > 0 && (
          <div className="har-file-tabs analyzer-file-tabs">
            <div
              className="har-file-tabs-list"
              role="tablist"
              aria-label="Open analyzer files"
            >
              {analyzerFileTabs.map(tab => {
                const isActive = tab.kind === 'har'
                  ? activeTool === 'har' && tab.id === activeHarTabId
                  : activeTool === 'console' && tab.id === activeLogTabId;
                const analyzerLabel = tab.kind === 'har' ? 'HAR' : 'LOG';

                return (
                  <div
                    key={`${tab.kind}-${tab.id}`}
                    className={`har-file-tab ${isActive ? 'active' : ''}`}
                    title={tab.fileName}
                  >
                    <button
                      id={`analyzer-file-tab-${tab.kind}-${tab.id}`}
                      type="button"
                      className="har-file-tab-select"
                      role="tab"
                      aria-label={`${analyzerLabel} file: ${tab.fileName}`}
                      aria-selected={isActive}
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => activateFileTab(tab)}
                      onKeyDown={(event) => handleFileTabKeyDown(event, tab)}
                    >
                      {tab.kind === 'har' ? (
                        <svg className="har-file-tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                          <path d="M3 2h7l3 3v9H3z" />
                          <path d="M10 2v3h3" />
                        </svg>
                      ) : (
                        <svg className="har-file-tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                          <path d="M3 4l4 4-4 4" />
                          <path d="M8.5 12H13" />
                        </svg>
                      )}
                      <span className={`analyzer-file-tab-kind analyzer-file-tab-kind-${tab.kind}`}>
                        {analyzerLabel}
                      </span>
                      <span className="har-file-tab-name">{tab.fileName}</span>
                    </button>
                    <button
                      type="button"
                      className="har-file-tab-close"
                      aria-label={`Close ${tab.fileName}`}
                      onClick={(event) => closeFileTab(tab, event)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}

              {canOpenAnotherAnalyzerFile && (
                <button
                  type="button"
                  className="har-file-tab-add"
                  onClick={handleAddTabClick}
                  title="Open another analyzer file"
                  aria-label="Open another analyzer file"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>

            <button type="button" className="har-file-tabs-upload" onClick={handleAddTabClick}>
              <UploadIcon />
              <span>Upload New</span>
            </button>
          </div>
        )}


        {/* HAR Analyzer Tool — multi-tab */}
        {activeTool === 'har' && (
          <>
            {/* ── Upload screen when no files are open yet ─────────────── */}
            {harShowUploader && harTabs.length === 0 && (
              <div className="upload-section">
                <FileUploader
                  multiple
                  onFileUpload={handleHarFileUpload}
                  recentFiles={harRecentFiles}
                  onClearRecent={() => {
                    setHarRecentFiles([]);
                    localStorage.removeItem(HAR_RECENT_FILES_KEY);
                    void clearRecentFiles('har');
                  }}
                />
              </div>
            )}

            {/* ── One HarTabContent per open file (all mounted, only active shown) */}
            {harTabs.map(tab => (
              <HarTabContent
                key={`${tab.id}:${tab.generation}`}
                tabId={tab.id}
                fileId={tab.fileId}
                fileName={tab.fileName}
                isActive={tab.id === activeHarTabId}
                backendUrl={BACKEND_URL}
                recentFiles={harRecentFiles}
                onAddNewTab={handleAddTabClick}
                onLoadRecentNewTab={handleRecentHarFile}
                onClearRecent={() => {
                  setHarRecentFiles([]);
                  localStorage.removeItem(HAR_RECENT_FILES_KEY);
                }}
                previewSnapshot={tab.previewSnapshot}
                onPreviewConsumed={() => handleHarPreviewConsumed(tab.id)}
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
        {activeTool === 'console' && (
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

            {/* Upload screen when no tabs are open yet */}
            {logTabs.length === 0 && !isLogProcessing && (
              <div className="upload-section">
                <ConsoleLogUploader
                  onFileUpload={handleLogUploadComplete}
                  recentFiles={logRecentFiles}
                  onClearRecent={() => {
                    setLogRecentFiles([]);
                    localStorage.removeItem(LOG_RECENT_FILES_KEY);
                    void clearRecentFiles('log');
                  }}
                />
              </div>
            )}

            {/* One ConsoleLogTabContent per open file — all mounted, only active shown */}
            {logTabs.map(tab => (
              <ConsoleLogTabContent
                key={tab.id}
                tabId={tab.id}
                fileId={tab.fileId}
                fileName={tab.fileName}
                initialData={tab.localData}
                isActive={tab.id === activeLogTabId}
                backendUrl={BACKEND_URL}
                recentFiles={logRecentFiles}
                onAddNewTab={handleAddTabClick}
                onLoadRecentNewTab={handleRecentLogFile}
                onClearRecent={() => {
                  setLogRecentFiles([]);
                  localStorage.removeItem(LOG_RECENT_FILES_KEY);
                  void clearRecentFiles('log');
                }}
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
          <HarCompare
            openTabs={harTabs.map(t => ({ fileId: t.fileId, fileName: t.fileName }))}
            openLogTabs={logTabs.map(t => ({
              fileId: t.fileId,
              fileName: t.fileName,
              localData: t.localData,
            }))}
          />
        </div>
          </>
        )}
      </main>

    </div>
  );
};

export default App;
