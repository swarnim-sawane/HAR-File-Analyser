// src/App.tsx

import React, { useCallback, useRef, useState, useEffect } from 'react';
import FileUploader from './components/FileUploader';
import ConsoleLogUploader from './components/ConsoleLogUploader';
import UnifiedUploader from './components/UnifiedUploader';
import ConsoleLogFilterPanel from './components/ConsoleLogFilterPanel';
import ConsoleLogList from './components/ConsoleLogList';
import ConsoleLogDetails from './components/ConsoleLogDetails';
import ConsoleLogStatistics from './components/ConsoleLogStatistics';
import ConsoleLogAiInsights from './components/ConsoleLogAiInsights';
import Toolbar from './components/Toolbar';
import HarTabContent from './components/HarTabContent';
import { useConsoleLogData } from './hooks/useConsoleLogData';
import { ConsoleLogAnalyzer } from './utils/consoleLogAnalyzer';
import './styles/globals.css';
import DarkModeToggle from './components/DarkModeToggle';
import FloatingAiChat from './components/FloatingAiChat';
import { UploadResult, chunkedUploader } from './services/chunkedUploader';
import { apiClient } from './services/apiClient';
import { wsClient } from './services/websocketClient';
import { storeRecentFile, restoreRecentFile, clearRecentFiles } from './services/recentFilesStore';
import HarCompare from './components/HarCompare';
import SanitizeModal from './components/SanitizeModal';
import BatchSanitizeModal from './components/BatchSanitizeModal';

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

interface PendingLeaveNavigation {
  destination: string;
  nextTool?: 'har' | 'console' | 'compare';
  nextTabId?: string; // for switching between HAR file tabs
}

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:4000';

const App: React.FC = () => {
  // ── HAR multi-tab state ──────────────────────────────────────────────────────
  const [harTabs, setHarTabs] = useState<HarFileTab[]>([]);
  const [activeHarTabId, setActiveHarTabId] = useState<string | null>(null);
  const [harShowUploader, setHarShowUploader] = useState(true);
  const [harRecentFiles, setHarRecentFiles] = useState<RecentFile[]>([]);
  // Ref to hidden file-input used for the "+" add-tab button in the tab bar
  const addTabInputRef = useRef<HTMLInputElement>(null);
  // Track which tab (if any) is currently generating insights — for the leave guard
  const tabInsightsRef = useRef<Record<string, boolean>>({});
  const [activeTabGeneratingInsights, setActiveTabGeneratingInsights] = useState(false);
  // Sanitize modal state for the "+" add-tab upload flow
  const [addTabPendingResult, setAddTabPendingResult] = useState<UploadResult | null>(null);
  const [addTabPendingBatch, setAddTabPendingBatch] = useState<UploadResult[] | null>(null);

  // ── Console Log state ────────────────────────────────────────────────────────
  const logState = useConsoleLogData();
  const [logShowUploader, setLogShowUploader] = useState(false);
  const [logRecentFiles, setLogRecentFiles] = useState<RecentFile[]>([]);
  const [logCurrentFileName, setLogCurrentFileName] = useState('');
  const [isLogProcessing, setIsLogProcessing] = useState(false);
  const [logLoadingMessage, setLogLoadingMessage] = useState('Loading console log file...');
  const [showLogLocalFallback, setShowLogLocalFallback] = useState(false);
  const logCancelRef = React.useRef<(() => void) | null>(null);
  type ConsoleTab = 'analyzer' | 'insights';
  const [logActiveTab, setLogActiveTab] = useState<ConsoleTab>('analyzer');
  const [logInsightsGenerating, setLogInsightsGenerating] = useState(false);

  // ── Main navigation ──────────────────────────────────────────────────────────
  const [activeTool, setActiveTool] = useState<'har' | 'console' | 'compare'>('har');
  const [pendingLeaveNavigation, setPendingLeaveNavigation] = useState<PendingLeaveNavigation | null>(null);

  const MAX_HAR_TABS = 8;
  const MAX_RECENT_FILES = 5;
  const HAR_RECENT_FILES_KEY = 'har_analyzer_recent_files';
  const LOG_RECENT_FILES_KEY = 'console_log_recent_files';
  const LOG_STATUS_POLL_INTERVAL_MS = 2000;
  const LOG_STATUS_TIMEOUT_MS = 180000;

  // ── Console log details resize ───────────────────────────────────────────────
  const [detailsWidth, setDetailsWidth] = useState(450);
  const DETAILS_MIN = 320;
  const DETAILS_MAX = 900;

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = detailsWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const next = Math.max(DETAILS_MIN, Math.min(DETAILS_MAX, startWidth + delta));
      setDetailsWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Deep-link handler: ?fileId=<id> pre-loads a file uploaded by the MCP tool ──
  useEffect(() => {
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
  }, []);

  const isLeaveInsightsGuardActive =
    activeTool === 'har' && activeTabGeneratingInsights;

  useEffect(() => {
    if (!pendingLeaveNavigation) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPendingLeaveNavigation(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [pendingLeaveNavigation]);

  // Show "Parse locally instead" button after 10s of waiting for backend
  useEffect(() => {
    if (!isLogProcessing) {
      setShowLogLocalFallback(false);
      return;
    }
    const timer = setTimeout(() => setShowLogLocalFallback(true), 10000);
    return () => clearTimeout(timer);
  }, [isLogProcessing]);

  const applyPendingLeaveNavigation = () => {
    if (!pendingLeaveNavigation) return;
    if (pendingLeaveNavigation.nextTool) {
      setActiveTool(pendingLeaveNavigation.nextTool);
    }
    if (pendingLeaveNavigation.nextTabId) {
      setActiveHarTabId(pendingLeaveNavigation.nextTabId);
    }
    setActiveTabGeneratingInsights(false);
    setPendingLeaveNavigation(null);
  };

  const handleToolChange = (nextTool: 'har' | 'console' | 'compare') => {
    if (nextTool === activeTool) return;
    const destination = nextTool === 'har' ? 'HAR Analyzer' : nextTool === 'compare' ? 'HAR Compare' : 'Console';
    if (isLeaveInsightsGuardActive) {
      setPendingLeaveNavigation({ destination, nextTool });
      return;
    }
    setActiveTool(nextTool);
  };

  /** Switch to a different open HAR file tab */
  const handleHarFileTabSwitch = (tabId: string) => {
    if (tabId === activeHarTabId) return;
    if (isLeaveInsightsGuardActive) {
      const tab = harTabs.find(t => t.id === tabId);
      setPendingLeaveNavigation({ destination: tab?.fileName || 'another file', nextTabId: tabId });
      return;
    }
    setActiveHarTabId(tabId);
  };

  /** Called by each HarTabContent to report its insights state */
  const handleTabInsightsGeneratingChange = useCallback((tabId: string, generating: boolean) => {
    tabInsightsRef.current[tabId] = generating;
    // Only the active tab's state matters for the guard
    if (tabId === activeHarTabId) {
      setActiveTabGeneratingInsights(generating);
    }
  }, [activeHarTabId]);



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
      // Clean up insights tracking
      delete tabInsightsRef.current[tabId];
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
  // Mirrors the HAR flow which reads from disk immediately after upload.
  const LOCAL_PARSE_THRESHOLD = 20 * 1024 * 1024; // 20 MB

  // Console log file handlers
  const handleLogUploadComplete = async (result: UploadResult, sourceFile?: File) => {
    setLogCurrentFileName(result.fileName);
    setIsLogProcessing(true);
    logCancelRef.current = null;

    // Small files: parse locally in the browser — no waiting for the backend worker.
    // The file was already uploaded so the backend can still index it for AI features.
    if (sourceFile && result.fileSize <= LOCAL_PARSE_THRESHOLD) {
      setLogLoadingMessage('Parsing console log...');
      try {
        const loaded = await logState.loadLogFile(sourceFile);
        if (loaded) {
          setLogCurrentFileName(sourceFile.name);
          setLogShowUploader(false);
          registerRecentLogFile(sourceFile.name, sourceFile);
        }
      } finally {
        setIsLogProcessing(false);
        setLogLoadingMessage('Loading console log file...');
      }
      return;
    }

    // Large files: wait for the backend worker (which handles streaming + pagination).
    try {
      setLogLoadingMessage('Processing console log on server...');
      await waitForLogReady(result.fileId, logCancelRef);

      setLogLoadingMessage('Loading parsed console entries...');
      const loadedFromBackend = await logState.loadLogFromBackend(result.fileId, result.fileName);

      if (!loadedFromBackend) {
        throw new Error('Processed console log could not be loaded from backend');
      }

      setLogShowUploader(false);
      registerRecentLogFile(result.fileName, sourceFile || new File([], result.fileName));
    } catch (err) {
      console.error('Console backend flow failed, falling back to local parse:', err);

      if (sourceFile) {
        setLogLoadingMessage('Backend unavailable, parsing console log locally...');
        const loadedLocally = await logState.loadLogFile(sourceFile);
        if (loadedLocally) {
          setLogCurrentFileName(sourceFile.name);
          setLogShowUploader(false);
          registerRecentLogFile(sourceFile.name, sourceFile);
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
      const loadedLocally = await logState.loadLogFile(resolvedFile);
      if (loadedLocally) {
        setLogCurrentFileName(resolvedFile.name);
        setLogShowUploader(false);
        registerRecentLogFile(resolvedFile.name, resolvedFile);
      }
      setIsLogProcessing(false);
      setLogLoadingMessage('Loading console log file...');
    }
  };

  const logGroupedEntries = React.useMemo(() => {
    if (logState.filters.groupBy === 'all') return null;
    if (logState.filters.groupBy === 'level') {
      return ConsoleLogAnalyzer.groupByLevel(logState.filteredEntries);
    }
    return ConsoleLogAnalyzer.groupBySource(logState.filteredEntries);
  }, [logState.filteredEntries, logState.filters.groupBy]);

  // Show the unified uploader only when there is truly nothing loaded in either tool.
  // Once any file is open the tool tabs take over and each tool manages its own upload.
  const showUnifiedUploader =
    harTabs.length === 0 &&
    !logState.logData &&
    !logState.isLoading &&
    !isLogProcessing;

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
          <h1>
            {showUnifiedUploader
              ? 'File Analyzer'
              : activeTool === 'har'
              ? 'HAR Analyzer'
              : activeTool === 'compare'
              ? 'HAR Compare'
              : 'Console Log Analyzer'}
          </h1>
          <span className="header-divider">
            {showUnifiedUploader
              ? 'HAR & Console Log Analysis'
              : activeTool === 'har'
              ? 'Network Analysis Tool'
              : activeTool === 'compare'
              ? 'Side-by-side HAR comparison'
              : 'Console Log Analysis'}
          </span>
        </div>
        <DarkModeToggle />
      </header>

      <main className="main-content">
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
                onInsightsGeneratingChange={handleTabInsightsGeneratingChange}
              />
            ))}
          </>
        )}

        {/* HAR Compare Tool */}
        {activeTool === 'compare' && (
          <HarCompare openTabs={harTabs.map(t => ({ fileId: t.fileId, fileName: t.fileName }))} />
        )}

        {/* Console Log Analyzer Tool */}
        {activeTool === 'console' && (
          <>
            {(logState.isLoading || isLogProcessing) && (
              <div className="loading-overlay">
                <div className="spinner"></div>
                <p>{logLoadingMessage}</p>
                {isLogProcessing && showLogLocalFallback && (
                  <button
                    className="btn-local-fallback"
                    onClick={() => logCancelRef.current?.()}
                  >
                    Parse locally instead
                  </button>
                )}
              </div>
            )}

            {logState.error && (
              <div className="error-banner">
                <span className="error-icon">⚠️</span>
                <span>{logState.error}</span>
                <button onClick={logState.clearData} className="btn-dismiss">✕</button>
              </div>
            )}

            {(logShowUploader || !logState.logData) && !logState.isLoading ? (
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
            ) : logState.logData ? (
              <>
                {/* ── Console sub-tabs ───────────────────────────────────── */}
                <div className="main-tabs">
                  {(['analyzer', 'insights'] as ConsoleTab[]).map((tab) => (
                    <button
                      key={tab}
                      className={`main-tab ${logActiveTab === tab ? 'active' : ''}`}
                      onClick={() => setLogActiveTab(tab)}
                    >
                      {tab === 'analyzer' ? 'Analyzer' : 'AI Insights'}
                    </button>
                  ))}
                </div>

                {logActiveTab === 'analyzer' && (
                  <>
                    <Toolbar
                      onUploadNew={() => {
                        setLogShowUploader(true);
                        logState.clearData();
                        setLogCurrentFileName('');
                        setLogLoadingMessage('Loading console log file...');
                      }}
                      onLoadRecent={handleRecentLogFile}
                      recentFiles={logRecentFiles}
                      onClearRecent={() => {
                        setLogRecentFiles([]);
                        localStorage.removeItem(LOG_RECENT_FILES_KEY);
                        void clearRecentFiles('log');
                      }}
                      currentFileName={logCurrentFileName}
                      filteredEntries={logState.filteredEntries}
                      totalEntries={logState.logData?.entries.length || 0}
                    />

                    <div
                      className={`analyzer-layout ${logState.selectedEntry ? 'with-details' : ''}`}
                      style={logState.selectedEntry ? ({ ['--details-width' as any]: `${detailsWidth}px` }) : undefined}
                    >
                      <aside className="sidebar-left console-sidebar">
                        <div className="console-sidebar-stack">
                          <ConsoleLogFilterPanel
                            filters={logState.filters}
                            onFilterChange={logState.updateFilters}
                          />
                          <ConsoleLogStatistics
                            entries={logState.filteredEntries}
                            totalEntries={logState.logData?.metadata.totalEntries}
                            truncatedAt={logState.logData?.metadata.truncatedAt}
                          />
                        </div>
                      </aside>
                      <div className="content-area">
                        <ConsoleLogList
                          entries={logState.filteredEntries}
                          groupedEntries={logGroupedEntries}
                          selectedEntry={logState.selectedEntry}
                          onSelectEntry={logState.setSelectedEntry}
                        />
                      </div>
                      {logState.selectedEntry && (
                        <aside className="sidebar-right">
                          <div className="resize-handle" onMouseDown={startResize} />
                          <ConsoleLogDetails
                            entry={logState.selectedEntry}
                            onClose={() => logState.setSelectedEntry(null)}
                          />
                        </aside>
                      )}
                    </div>
                    <FloatingAiChat logData={logState.logData} />
                  </>
                )}

                {/* Always mounted so useConsoleLogInsights auto-fires as soon as log
                    data loads, generating results in the background before the
                    user visits the AI Insights tab. */}
                <div style={{ display: logActiveTab === 'insights' ? undefined : 'none' }}>
                  <ConsoleLogAiInsights
                    logData={logState.logData}
                    backendUrl={BACKEND_URL}
                    onGeneratingChange={setLogInsightsGenerating}
                  />
                </div>
              </>
            ) : null}
          </>
        )}
        </>)}
      </main>

      {pendingLeaveNavigation && (
        <div
          className="insights-leave-modal-overlay"
          onClick={() => setPendingLeaveNavigation(null)}
        >
          <div
            className="insights-leave-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="insights-leave-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="insights-leave-modal-header">
              <div className="insights-leave-modal-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 9v4" strokeLinecap="round" />
                  <path d="M12 17h.01" strokeLinecap="round" />
                  <path
                    d="M10.29 3.86L1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="insights-leave-modal-copy">
                <h3 id="insights-leave-title">Cancel AI Insights analysis?</h3>
                <p>
                  AI Insights generation is still running. Leaving now will cancel
                  the current analysis.
                </p>
                <p className="insights-leave-modal-destination">
                  Continue to <strong>{pendingLeaveNavigation.destination}</strong>?
                </p>
              </div>
            </div>
            <div className="insights-leave-modal-actions">
              <button
                type="button"
                className="insights-leave-btn secondary"
                onClick={() => setPendingLeaveNavigation(null)}
                autoFocus
              >
                Stay on Insights
              </button>
              <button
                type="button"
                className="insights-leave-btn danger"
                onClick={applyPendingLeaveNavigation}
              >
                Leave Insights
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
