// src/App.tsx

import React, { useCallback, useRef, useState, useEffect } from 'react';
import FileUploader from './components/FileUploader';
import ConsoleLogUploader from './components/ConsoleLogUploader';
import UnifiedUploader from './components/UnifiedUploader';
import HarTabContent from './components/HarTabContent';
import ConsoleLogTabContent from './components/ConsoleLogTabContent';
import { ConsoleLogFile } from './types/consolelog';
import { ConsoleLogParser } from './utils/consoleLogParser';
import './styles/globals.css';
import DarkModeToggle from './components/DarkModeToggle';
import { UploadResult, chunkedUploader } from './services/chunkedUploader';
import { apiClient } from './services/apiClient';
import { wsClient } from './services/websocketClient';
import { storeRecentFile, restoreRecentFile, clearRecentFiles } from './services/recentFilesStore';
import HarCompare from './components/HarCompare';
import SanitizeModal from './components/SanitizeModal';
import BatchSanitizeModal from './components/BatchSanitizeModal';
import HarSanitizer from './components/HarSanitizer';
import DocumentationPage from './components/DocumentationPage';
import { ArrowLeftIcon, FileTextIcon } from './components/Icons';

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
}

/** A single open Console Log tab */
interface LogFileTab {
  id: string;
  fileId: string | null;          // null when parsed locally (small files)
  fileName: string;
  localData: ConsoleLogFile | null; // pre-parsed data for small files
}

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:4000';

type AppPath = '/' | '/docs';

const normalizePathname = (pathname: string): AppPath =>
  pathname === '/docs' || pathname === '/docs/' ? '/docs' : '/';

const App: React.FC = () => {
  const [pathname, setPathname] = useState<AppPath>(() => normalizePathname(window.location.pathname));
  // ── HAR multi-tab state ──────────────────────────────────────────────────────
  const [harTabs, setHarTabs] = useState<HarFileTab[]>([]);
  const [activeHarTabId, setActiveHarTabId] = useState<string | null>(null);
  const [harShowUploader, setHarShowUploader] = useState(true);
  const [harRecentFiles, setHarRecentFiles] = useState<RecentFile[]>([]);
  // Ref to hidden file-input used for the "+" add-tab button in the tab bar
  const addTabInputRef = useRef<HTMLInputElement>(null);
  // Track which tab (if any) is currently generating insights — for the leave guard
  // Sanitize modal state for the "+" add-tab upload flow
  const [addTabPendingResult, setAddTabPendingResult] = useState<UploadResult | null>(null);
  const [addTabPendingBatch, setAddTabPendingBatch] = useState<UploadResult[] | null>(null);

  // ── Console Log multi-tab state ──────────────────────────────────────────────
  const [logTabs, setLogTabs] = useState<LogFileTab[]>([]);
  const [activeLogTabId, setActiveLogTabId] = useState<string | null>(null);
  const [logRecentFiles, setLogRecentFiles] = useState<RecentFile[]>([]);
  const [isLogProcessing, setIsLogProcessing] = useState(false);
  const [logLoadingMessage, setLogLoadingMessage] = useState('Loading console log file...');
  const [showLogLocalFallback, setShowLogLocalFallback] = useState(false);
  const logCancelRef = React.useRef<(() => void) | null>(null);
  const addLogTabInputRef = useRef<HTMLInputElement>(null);

  const MAX_LOG_TABS = 8;

  // ── Main navigation ──────────────────────────────────────────────────────────
  const [activeTool, setActiveTool] = useState<'har' | 'sanitizer' | 'console' | 'compare'>('har');

  const MAX_HAR_TABS = 8;
  const MAX_RECENT_FILES = 5;
  const HAR_RECENT_FILES_KEY = 'har_analyzer_recent_files';
  const LOG_RECENT_FILES_KEY = 'console_log_recent_files';
  const LOG_STATUS_POLL_INTERVAL_MS = 2000;
  const LOG_STATUS_TIMEOUT_MS = 180000;
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

  const handleToolChange = (nextTool: 'har' | 'sanitizer' | 'console' | 'compare') => {
    if (nextTool === activeTool) return;
    setActiveTool(nextTool);
  };

  /** Switch to a different open HAR file tab */
  const handleHarFileTabSwitch = (tabId: string) => {
    if (tabId === activeHarTabId) return;
    setActiveHarTabId(tabId);
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
  const openHarTab = useCallback((result: UploadResult, switchTool = false) => {
    if (harTabs.length >= MAX_HAR_TABS) {
      console.warn(`Max ${MAX_HAR_TABS} HAR tabs open — close one first`);
      return;
    }
    const newTab: HarFileTab = {
      id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fileId: result.fileId,
      fileName: result.fileName,
    };
    setHarTabs(prev => [...prev, newTab]);
    setActiveHarTabId(newTab.id);
    setHarShowUploader(false);
    if (switchTool) setActiveTool('har');
    registerRecentHarFile(result.fileName, new File([], result.fileName));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harTabs.length]);

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

  /** Close a HAR file tab; activate the nearest remaining tab */
  const closeHarTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHarTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      const next = prev.filter(t => t.id !== tabId);
      if (activeHarTabId === tabId) {
        // Activate the tab to the left, or the right if it was the first
        const nextActive = next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? null;
        setActiveHarTabId(nextActive);
        if (next.length === 0) setHarShowUploader(true);
      }
      return next;
    });
  };

  /** Triggered by the "+" button in the tab bar — opens the hidden file input */
  const handleAddTabClick = () => {
    addTabInputRef.current?.click();
  };

  const handleAddTabFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    const results: UploadResult[] = [];
    for (const file of files) {
      try {
        const result = await chunkedUploader.uploadFile(file, 'har', () => {});
        // Persist to IndexedDB for cross-session Recent Files restore
        void storeRecentFile('har', file);
        registerRecentHarFile(file.name, file);
        results.push(result);
      } catch (err) {
        console.error('Failed to upload HAR file:', err);
      }
    }

    if (results.length === 0) return;

    // Route through the sanitize modal — same flow as FileUploader
    if (results.length === 1) {
      setAddTabPendingResult(results[0]);
    } else {
      setAddTabPendingBatch(results);
    }
  };

  // ── Console Log tab management ────────────────────────────────────────────────

  const openLogTab = useCallback((
    opts: { fileId: string | null; fileName: string; localData: ConsoleLogFile | null },
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
      localData: opts.localData,
    };
    setLogTabs(prev => [...prev, newTab]);
    setActiveLogTabId(newTab.id);
    if (switchTool) setActiveTool('console');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logTabs.length]);

  const closeLogTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLogTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      const next = prev.filter(t => t.id !== tabId);
      if (activeLogTabId === tabId) {
        const nextActive = next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? null;
        setActiveLogTabId(nextActive);
      }
      return next;
    });
  };

  const handleLogTabSwitch = (tabId: string) => {
    if (tabId === activeLogTabId) return;
    setActiveLogTabId(tabId);
  };

  const handleAddLogTabClick = () => {
    addLogTabInputRef.current?.click();
  };

  const handleAddLogTabFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const result = await chunkedUploader.uploadFile(file, 'log', () => {});
      await handleLogUploadComplete(result, file);
    } catch (err) {
      console.error('Failed to upload console log file:', err);
    }
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

  // Files under this limit are parsed locally (instant, no backend dependency).
  const LOCAL_PARSE_THRESHOLD = 20 * 1024 * 1024; // 20 MB

  // Console log upload handler — creates a new tab after loading.
  // The loading overlay lives in App.tsx (shown during the wait), then the resulting
  // data or fileId is handed off to a new ConsoleLogTabContent that owns it permanently.
  const handleLogUploadComplete = async (result: UploadResult, sourceFile?: File) => {
    setIsLogProcessing(true);
    logCancelRef.current = null;

    // Small files: parse locally — instant, no backend wait.
    if (sourceFile && result.fileSize <= LOCAL_PARSE_THRESHOLD) {
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
      const result = await chunkedUploader.uploadFile(resolvedFile, 'log', () => {});
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

  const isDocsRoute = pathname === '/docs';
  const headerTitle = isDocsRoute
    ? 'Documentation'
    : showUnifiedUploader
    ? 'File Analyzer'
    : activeTool === 'har'
    ? 'HAR Analyzer'
    : activeTool === 'compare'
    ? 'HAR Compare'
    : 'Console Log Analyzer';
  const headerSubtitle = isDocsRoute
    ? 'Curated usage guide for HAR and console log analysis'
    : showUnifiedUploader
    ? 'HAR & Console Log Analysis'
    : activeTool === 'har'
    ? 'Network Analysis Tool'
    : activeTool === 'compare'
    ? 'Side-by-side HAR comparison'
    : 'Console Log Analysis';
  const headerActionLabel = isDocsRoute ? 'Back to Analyzer' : 'Documentation';
  const handleHeaderAction = () => {
    navigateTo(isDocsRoute ? '/' : '/docs');
  };

  return (
    <div className="app-container">
      {/* ── Sanitize modals for the "+" add-tab upload flow ── */}
      {addTabPendingResult && (
        <SanitizeModal
          uploadResult={addTabPendingResult}
          onProceed={(fileId) => {
            openHarTab({ ...addTabPendingResult, fileId });
            setAddTabPendingResult(null);
          }}
          onCancel={() => setAddTabPendingResult(null)}
        />
      )}
      {addTabPendingBatch && (
        <BatchSanitizeModal
          uploadResults={addTabPendingBatch}
          onProceed={(finalResults) => {
            for (const result of finalResults) {
              wsClient.subscribeToFile(result.fileId);
              openHarTab(result);
            }
            setAddTabPendingBatch(null);
          }}
          onCancel={() => setAddTabPendingBatch(null)}
        />
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
        <div className="app-header-actions">
          <span className="header-poc-badge">Proof of Concept</span>
          <button type="button" className="app-header-action-button" onClick={handleHeaderAction}>
            {isDocsRoute ? <ArrowLeftIcon /> : <FileTextIcon />}
            <span>{headerActionLabel}</span>
          </button>
          <DarkModeToggle />
        </div>
      </header>

      <main className="main-content">
        {isDocsRoute ? (
          <DocumentationPage onBackToAnalyzer={() => navigateTo('/')} />
        ) : (
          <>
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
              logRecentFiles={logRecentFiles}
              onClearLogRecent={() => {
                setLogRecentFiles([]);
                localStorage.removeItem(LOG_RECENT_FILES_KEY);
                void clearRecentFiles('log');
              }}
            />
          </div>
        )}

        {/* Tool Selector + all tool content — hidden while the unified home screen is shown */}
        {!showUnifiedUploader && (<>
        <div className="tool-selector">
          <button
            className={`tool-tab ${activeTool === 'har' ? 'active' : ''}`}
            onClick={() => handleToolChange('har')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            </svg>
            HAR
          </button>
          <button
            className={`tool-tab ${activeTool === 'console' ? 'active' : ''}`}
            onClick={() => handleToolChange('console')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
            Console
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


        {/* HAR Analyzer Tool — multi-tab */}
        {activeTool === 'har' && (
          <>
            {/* ── HAR file tab bar ─────────────────────────────────────── */}
            {harTabs.length > 0 && (
              <div className="har-file-tabs">
                {harTabs.map(tab => (
                  <button
                    key={tab.id}
                    className={`har-file-tab ${tab.id === activeHarTabId ? 'active' : ''}`}
                    onClick={() => handleHarFileTabSwitch(tab.id)}
                    title={tab.fileName}
                  >
                    <svg className="har-file-tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M3 2h7l3 3v9H3z" />
                      <path d="M10 2v3h3" />
                    </svg>
                    <span className="har-file-tab-name">{tab.fileName}</span>
                    <span
                      className="har-file-tab-close"
                      role="button"
                      aria-label={`Close ${tab.fileName}`}
                      onClick={(e) => closeHarTab(tab.id, e)}
                    >
                      ×
                    </span>
                  </button>
                ))}

                {/* Add new tab button */}
                {harTabs.length < MAX_HAR_TABS && (
                  <button
                    className="har-file-tab-add"
                    onClick={handleAddTabClick}
                    title="Open another HAR file"
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                    </svg>
                  </button>
                )}

                {/* Hidden file input for the "+" button */}
                <input
                  ref={addTabInputRef}
                  type="file"
                  accept=".har,application/json"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleAddTabFileInput}
                />
              </div>
            )}

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
                key={tab.id}
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

            {/* ── Console file tab bar ─────────────────────────────────── */}
            {logTabs.length > 0 && (
              <div className="har-file-tabs">
                {logTabs.map(tab => (
                  <button
                    key={tab.id}
                    className={`har-file-tab ${tab.id === activeLogTabId ? 'active' : ''}`}
                    onClick={() => handleLogTabSwitch(tab.id)}
                    title={tab.fileName}
                  >
                    <svg className="har-file-tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <polyline points="4 17 10 11 4 5" />
                      <line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                    <span className="har-file-tab-name">{tab.fileName}</span>
                    <span
                      className="har-file-tab-close"
                      role="button"
                      aria-label={`Close ${tab.fileName}`}
                      onClick={(e) => closeLogTab(tab.id, e)}
                    >
                      ×
                    </span>
                  </button>
                ))}

                {logTabs.length < MAX_LOG_TABS && (
                  <button
                    className="har-file-tab-add"
                    onClick={handleAddLogTabClick}
                    title="Open another console log file"
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                    </svg>
                  </button>
                )}

                {/* Hidden file input for the "+" button */}
                <input
                  ref={addLogTabInputRef}
                  type="file"
                  accept=".log,.txt,.json"
                  style={{ display: 'none' }}
                  onChange={handleAddLogTabFileInput}
                />
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
                onAddNewTab={handleAddLogTabClick}
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
        <div style={{ display: activeTool === 'compare' ? 'contents' : 'none' }}>
          <HarCompare openTabs={harTabs.map(t => ({ fileId: t.fileId, fileName: t.fileName }))} />
        </div>
          </>
        )}
      </main>

    </div>
  );
};

export default App;
