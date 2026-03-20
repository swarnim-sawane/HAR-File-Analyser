// src/App.tsx

import React, { useCallback, useState, useEffect } from 'react';
import FileUploader from './components/FileUploader';
import FilterPanel from './components/FilterPanel';
import RequestList from './components/RequestList';
import RequestDetails from './components/RequestDetails';
import ConsoleLogUploader from './components/ConsoleLogUploader';
import ConsoleLogFilterPanel from './components/ConsoleLogFilterPanel';
import ConsoleLogList from './components/ConsoleLogList';
import ConsoleLogDetails from './components/ConsoleLogDetails';
import ConsoleLogStatistics from './components/ConsoleLogStatistics';
import Toolbar from './components/Toolbar';
import { useHarData } from './hooks/useHarData';
import { useConsoleLogData } from './hooks/useConsoleLogData';
import { HarAnalyzer } from './utils/harAnalyzer';
import { ConsoleLogAnalyzer } from './utils/consoleLogAnalyzer';
import './styles/globals.css';
import DarkModeToggle from './components/DarkModeToggle';
import HarSanitizer from './components/HarSanitizer';
import FloatingAiChat from './components/FloatingAiChat';
import { UploadResult, chunkedUploader } from './services/chunkedUploader';
import { apiClient } from './services/apiClient';
import { wsClient } from './services/websocketClient';
import RequestFlowDiagram from './components/RequestFlowDiagram';
import PerformanceScorecard from './components/PerformanceScorecard';
import AiInsights from './components/AiInsights';

interface RecentFile {
  name: string;
  timestamp: number;
  data: File;
}

type HarTab = 'analyzer' | 'sanitizer' | 'flow' | 'scorecard' | 'insights';

interface PendingLeaveNavigation {
  destination: string;
  nextTool?: 'har' | 'console';
  nextTab?: HarTab;
}

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:4000';

const App: React.FC = () => {
  // HAR Analyzer state
  const harState = useHarData();
  const [harShowUploader, setHarShowUploader] = useState(false);
  const [harRecentFiles, setHarRecentFiles] = useState<RecentFile[]>([]);
  const [harCurrentFileName, setHarCurrentFileName] = useState('');


  // Console Log Analyzer state
  const logState = useConsoleLogData();
  const [logShowUploader, setLogShowUploader] = useState(false);
  const [logRecentFiles, setLogRecentFiles] = useState<RecentFile[]>([]);
  const [logCurrentFileName, setLogCurrentFileName] = useState('');
  const [isLogProcessing, setIsLogProcessing] = useState(false);
  const [logLoadingMessage, setLogLoadingMessage] = useState('Loading console log file...');

  // Main navigation
  const [activeTool, setActiveTool] = useState<'har' | 'console'>('har');
  const [activeTab, setActiveTab] = useState<HarTab>('analyzer');
  const [isInsightsGenerating, setIsInsightsGenerating] = useState(false);
  const [pendingLeaveNavigation, setPendingLeaveNavigation] = useState<PendingLeaveNavigation | null>(null);

  const MAX_RECENT_FILES = 5;
  const HAR_RECENT_FILES_KEY = 'har_analyzer_recent_files';
  const LOG_RECENT_FILES_KEY = 'console_log_recent_files';
  const LOG_STATUS_POLL_INTERVAL_MS = 2000;
  const LOG_STATUS_TIMEOUT_MS = 180000;

  // near other useState()s in App.tsx
  const [detailsWidth, setDetailsWidth] = useState(450); // default matches CSS
  const DETAILS_MIN = 320;
  const DETAILS_MAX = 900;

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = detailsWidth;

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX; // dragging left increases width
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

    // Subscribe to socket room so we get the ready event if processing is still in progress
    wsClient.connect();
    wsClient.subscribeToFile(deepLinkFileId);

    const loadFile = async (fileId: string, fileName?: string) => {
      try {
        const harData = await apiClient.getHarData(fileId);
        await harState.loadHarData(harData);
        setHarCurrentFileName(fileName || fileId);
        setHarShowUploader(false);
        // Remove the ?fileId param from the URL bar without triggering a reload
        const clean = window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', clean);
      } catch {
        // File not ready yet — wait for socket event below
      }
    };

    // Try immediately (file may already be processed by the time user clicks)
    loadFile(deepLinkFileId);

    // Also listen for the backend's ready event in case processing is still running
    const handleStatus = (data: { fileId: string; status: string; fileName?: string }) => {
      if (data.fileId !== deepLinkFileId || data.status !== 'ready') return;
      loadFile(deepLinkFileId, data.fileName);
    };

    wsClient.on('file:status', handleStatus);
    return () => { wsClient.off('file:status', handleStatus); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLeaveInsightsGuardActive =
    activeTool === 'har' && activeTab === 'insights' && isInsightsGenerating;

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

  const getHarTabLabel = (tab: HarTab): string => {
    if (tab === 'insights') return 'AI Insights';
    if (tab === 'analyzer') return 'Analyzer';
    if (tab === 'flow') return 'Request Flow';
    if (tab === 'sanitizer') return 'Sanitizer';
    return 'Scorecard';
  };

  const applyPendingLeaveNavigation = () => {
    if (!pendingLeaveNavigation) return;

    if (pendingLeaveNavigation.nextTool) {
      setActiveTool(pendingLeaveNavigation.nextTool);
    }

    if (pendingLeaveNavigation.nextTab) {
      setActiveTab(pendingLeaveNavigation.nextTab);
    }

    setIsInsightsGenerating(false);
    setPendingLeaveNavigation(null);
  };

  const handleToolChange = (nextTool: 'har' | 'console') => {
    if (nextTool === activeTool) return;
    const destination = nextTool === 'har' ? 'HAR' : 'Console';
    if (isLeaveInsightsGuardActive) {
      setPendingLeaveNavigation({ destination, nextTool });
      return;
    }
    if (activeTool === 'har' && activeTab === 'insights') {
      setIsInsightsGenerating(false);
    }
    setActiveTool(nextTool);
  };

  const handleHarTabChange = (nextTab: HarTab) => {
    if (nextTab === activeTab) return;
    const destination = getHarTabLabel(nextTab);
    if (isLeaveInsightsGuardActive) {
      setPendingLeaveNavigation({ destination, nextTab });
      return;
    }
    if (activeTab === 'insights' && nextTab !== 'insights') {
      setIsInsightsGenerating(false);
    }
    setActiveTab(nextTab);
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

  // HAR file handlers
  const registerRecentHarFile = (fileName: string, fileObj: File) => {
    const newRecentFile: RecentFile = {
      name: fileName,
      timestamp: Date.now(),
      data: fileObj,
    };

    setHarRecentFiles(prev => {
      const filtered = prev.filter(f => f.name !== fileName);
      const updated = [newRecentFile, ...filtered].slice(0, MAX_RECENT_FILES);
      localStorage.setItem(HAR_RECENT_FILES_KEY, JSON.stringify(updated.map(f => ({
        name: f.name,
        timestamp: f.timestamp,
      }))));
      return updated;
    });
  };

  const handleHarFileUpload = async (result: UploadResult) => {
    setHarCurrentFileName(result.fileName);
    setHarShowUploader(false);

    const harData = await apiClient.getHarData(result.fileId);
    await harState.loadHarData(harData);

    // We only have backend metadata here, not the original disk file.
    registerRecentHarFile(result.fileName, new File([], result.fileName));
  };

  const handleRecentHarFile = async (file: File) => {
    try {
      const result = await chunkedUploader.uploadFile(file, 'har', () => {});
      await handleHarFileUpload(result);
      registerRecentHarFile(file.name, file);
    } catch (err) {
      console.error('Failed to re-upload recent file:', err);
    }
  };

  const registerRecentLogFile = (fileName: string, fileObj: File) => {
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

  const waitForLogReady = useCallback((fileId: string): Promise<void> => {
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
        }
      };

      const cleanup = () => {
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        wsClient.off('file:status', handleStatus);
      };

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const pollStatus = async () => {
        try {
          const status = await apiClient.getLogStatus(fileId);
          if (status?.status === 'ready') {
            finish(resolve);
            return;
          }
          if (status?.status === 'error') {
            finish(() => reject(new Error(status.error || 'Console log processing failed')));
          }
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

  // Console log file handlers
  const handleLogUploadComplete = async (result: UploadResult, sourceFile?: File) => {
    setLogCurrentFileName(result.fileName);
    setIsLogProcessing(true);

    try {
      setLogLoadingMessage('Processing console log on server...');
      await waitForLogReady(result.fileId);

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
    if (!(file instanceof File)) {
      console.error('Recent log file is unavailable in memory. Please upload the original file again.');
      return;
    }

    try {
      const result = await chunkedUploader.uploadFile(file, 'log', () => {});
      await handleLogUploadComplete(result, file);
    } catch (err) {
      console.error('Recent log re-upload failed, using local fallback:', err);
      setIsLogProcessing(true);
      setLogLoadingMessage('Re-upload failed, parsing console log locally...');
      const loadedLocally = await logState.loadLogFile(file);
      if (loadedLocally) {
        setLogCurrentFileName(file.name);
        setLogShowUploader(false);
        registerRecentLogFile(file.name, file);
      }
      setIsLogProcessing(false);
      setLogLoadingMessage('Loading console log file...');
    }
  };

  const harGroupedEntries = React.useMemo(() => {
    if (!harState.harData || harState.filters.groupBy === 'all') return null;
    const pages = harState.harData.log.pages || [];
    return HarAnalyzer.groupByPage(harState.filteredEntries, pages);
  }, [harState.harData, harState.filteredEntries, harState.filters.groupBy]);

  const logGroupedEntries = React.useMemo(() => {
    if (logState.filters.groupBy === 'all') return null;
    if (logState.filters.groupBy === 'level') {
      return ConsoleLogAnalyzer.groupByLevel(logState.filteredEntries);
    }
    return ConsoleLogAnalyzer.groupBySource(logState.filteredEntries);
  }, [logState.filteredEntries, logState.filters.groupBy]);

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-brand">
          <svg className="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
            <line x1="12" y1="22.08" x2="12" y2="12"></line>
          </svg>
          <h1>
            {activeTool === 'har' ? 'HAR Analyzer' : 'Console Log Analyzer'}
          </h1>
          <span className="header-divider">
            {activeTool === 'har' ? 'Network Analysis Tool' : 'Console Log Analysis'}
          </span>
        </div>
        <DarkModeToggle />
      </header>

      <main className="main-content">
        {/* Tool Selector */}
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
        </div>


        {/* HAR Analyzer Tool */}
        {activeTool === 'har' && (
          <>
            {harState.harData && !harShowUploader && (
              <div className="main-tabs">
                <button
                  className={`main-tab ${activeTab === 'analyzer' ? 'active' : ''}`}
                  onClick={() => handleHarTabChange('analyzer')}
                >
                  Analyzer
                </button>
                <button
                  className={`main-tab ${activeTab === 'flow' ? 'active' : ''}`}
                  onClick={() => handleHarTabChange('flow')}
                >
                  Request Flow
                </button>
                <button
                  className={`main-tab ${activeTab === 'sanitizer' ? 'active' : ''}`}
                  onClick={() => handleHarTabChange('sanitizer')}
                >
                  Sanitizer
                </button>
                <button
                  className={`main-tab ${activeTab === 'scorecard' ? 'active' : ''}`}
                  onClick={() => handleHarTabChange('scorecard')}
                >
                  Scorecard
                </button>
                <button
                  className={`main-tab ${activeTab === 'insights' ? 'active' : ''}`}
                  onClick={() => handleHarTabChange('insights')}
                >
                  AI Insights
                </button>
              </div>
            )}

            {harState.isLoading && (
              <div className="loading-overlay">
                <div className="spinner"></div>
                <p>Loading HAR file...</p>
              </div>
            )}

            {harState.error && (
              <div className="error-banner">
                <span className="error-icon">⚠️</span>
                <span>{harState.error}</span>
                <button onClick={harState.clearData} className="btn-dismiss">✕</button>
              </div>
            )}

            {(harShowUploader || !harState.harData) && !harState.isLoading ? (
              <div className="upload-section">
                <FileUploader
                  onFileUpload={handleHarFileUpload}
                  recentFiles={harRecentFiles}
                  onClearRecent={() => {
                    setHarRecentFiles([]);
                    localStorage.removeItem(HAR_RECENT_FILES_KEY);
                  }}
                />
              </div>
            ) : harState.harData ? (
              <>
                {activeTab === 'analyzer' ? (
                  <>
                    <Toolbar
                      onUploadNew={() => {
                        setHarShowUploader(true);
                        harState.clearData();
                        setHarCurrentFileName('');
                      }}
                      onLoadRecent={handleRecentHarFile}
                      recentFiles={harRecentFiles}
                      onClearRecent={() => {
                        setHarRecentFiles([]);
                        localStorage.removeItem(HAR_RECENT_FILES_KEY);
                      }}
                      currentFileName={harCurrentFileName}
                      harEntries={harState.filteredEntries}
                      totalHarEntries={harState.harData?.log.entries.length || 0}
                    />


                    <div
                      className={`analyzer-layout ${harState.selectedEntry ? 'with-details' : ''}`}
                      style={harState.selectedEntry ? ({ ['--details-width' as any]: `${detailsWidth}px` }) : undefined}
                    >


                      <aside className="sidebar-left">
                        <FilterPanel
                          filters={harState.filters}
                          onFilterChange={harState.updateFilters}
                        />
                      </aside>
                      <div className="content-area">
                        <RequestList
                          entries={harState.filteredEntries}
                          groupedEntries={harGroupedEntries}
                          selectedEntry={harState.selectedEntry}
                          onSelectEntry={harState.setSelectedEntry}
                          timingType={harState.filters.timingType}
                        />
                      </div>
                      {harState.selectedEntry && (
                        <aside className="sidebar-right">
                          <div className="resize-handle" onMouseDown={startResize} />
                          <RequestDetails
                            entry={harState.selectedEntry}
                            onClose={() => harState.setSelectedEntry(null)}
                          />
                        </aside>
                      )}
                    </div>
                    <FloatingAiChat harData={harState.harData} />
                  </>
                )  : activeTab === 'sanitizer' ? (
                  <div className="sanitizer-wrapper">
                    <HarSanitizer />
                  </div>
                ) : activeTab === 'flow' ? (
                  <div style={{ height: 'calc(100vh - 200px)' }}>
                    <RequestFlowDiagram
                      entries={harState.filteredEntries}
                      onNodeClick={(entry: any) => {
                        harState.setSelectedEntry(entry);
                        setActiveTab('analyzer');
                      }}
                    />
                  </div>
                ) : activeTab === 'scorecard' ? (
                  <div className="scorecard-wrapper">
                    <PerformanceScorecard harData={harState.harData} />
                  </div>
                ) : activeTab === 'insights' ? (
                  <AiInsights
                    harData={harState.harData}
                    backendUrl={BACKEND_URL}
                    onGeneratingChange={setIsInsightsGenerating}
                  />
                ) : null}
              </>
            ) : null}
          </>
        )}

        {/* Console Log Analyzer Tool */}
        {activeTool === 'console' && (
          <>
            {(logState.isLoading || isLogProcessing) && (
              <div className="loading-overlay">
                <div className="spinner"></div>
                <p>{logLoadingMessage}</p>
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
                  }}
                />
              </div>
            ) : logState.logData ? (
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
                      <ConsoleLogStatistics entries={logState.filteredEntries} />
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
            ) : null}
          </>
        )}
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
