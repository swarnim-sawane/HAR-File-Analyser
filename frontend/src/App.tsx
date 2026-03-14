import React, { useState, useEffect } from 'react';
import FileUploader from './components/FileUploader';
import ConsoleLogUploader from './components/ConsoleLogUploader';
import FilterPanel from './components/FilterPanel';
import ConsoleLogFilterPanel from './components/ConsoleLogFilterPanel';
import ConsoleLogStatistics from './components/ConsoleLogStatistics';
import RequestList from './components/RequestList';
import RequestDetails from './components/RequestDetails';
import ConsoleLogList from './components/ConsoleLogList';
import ConsoleLogDetails from './components/ConsoleLogDetails';
import FloatingAiChat from './components/FloatingAiChat';
import DarkModeToggle from './components/DarkModeToggle';
import { useHarData } from './hooks/useHarData';
import { useConsoleLogData } from './hooks/useConsoleLogData';
import { UploadResult } from './services/chunkedUploader';
import { HarEntry } from '../../shared/types/har';
import { LogEntry } from '../../shared/types/consolelog';
import { wsClient } from './services/websocketClient';
import './styles/globals.css';

interface RecentFile {
  name: string;
  timestamp: number;
  data: File;
}

type ActiveTool = 'har' | 'console';

const App: React.FC = () => {
  const [activeTool, setActiveTool] = useState<ActiveTool>('har');

  const [harFileId, setHarFileId] = useState<string | null>(null);
  const [harFileName, setHarFileName] = useState('');
  const [consoleFileId, setConsoleFileId] = useState<string | null>(null);
  const [consoleFileName, setConsoleFileName] = useState('');

  const [showUploader, setShowUploader] = useState(false);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [selectedHarEntry, setSelectedHarEntry] = useState<HarEntry | null>(null);
  const [selectedLogEntry, setSelectedLogEntry] = useState<LogEntry | null>(null);

  const harData = useHarData(harFileId);
  const logData = useConsoleLogData(consoleFileId);

  const [detailsWidth, setDetailsWidth] = useState(450);
  const DETAILS_MIN = 320;
  const DETAILS_MAX = 900;

  const MAX_RECENT_FILES = 5;
  const RECENT_FILES_KEY = activeTool === 'har' ? 'har_analyzer_recent_files' : 'console_log_recent_files';

  useEffect(() => {
    try {
      const savedHarFileId = localStorage.getItem('har_current_file_id');
      const savedHarFileName = localStorage.getItem('har_current_file_name');
      const savedConsoleFileId = localStorage.getItem('console_current_file_id');
      const savedConsoleFileName = localStorage.getItem('console_current_file_name');

      if (savedHarFileId) {
        setHarFileId(savedHarFileId);
        console.log('📂 Restored HAR session:', savedHarFileId);
      }
      if (savedHarFileName) setHarFileName(savedHarFileName);

      if (savedConsoleFileId) {
        setConsoleFileId(savedConsoleFileId);
        console.log('📂 Restored Console session:', savedConsoleFileId);
      }
      if (savedConsoleFileName) setConsoleFileName(savedConsoleFileName);
    } catch (err) {
      console.error('Failed to restore sessions:', err);
    }
  }, []);

  useEffect(() => {
    console.log('Initializing WebSocket connection...');
    wsClient.connect();
    return () => {
      console.log('Disconnecting WebSocket...');
      wsClient.disconnect();
    };
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_FILES_KEY);
      if (stored) setRecentFiles(JSON.parse(stored));
    } catch (err) {
      console.error('Failed to load recent files:', err);
    }
  }, [activeTool]);

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

  const handleFileUpload = async (result: UploadResult) => {
    console.log(`${activeTool.toUpperCase()} upload complete:`, result);

    if (activeTool === 'har') {
      setHarFileId(result.fileId);
      setHarFileName(result.fileName);
      localStorage.setItem('har_current_file_id', result.fileId);
      localStorage.setItem('har_current_file_name', result.fileName);
    } else {
      setConsoleFileId(result.fileId);
      setConsoleFileName(result.fileName);
      localStorage.setItem('console_current_file_id', result.fileId);
      localStorage.setItem('console_current_file_name', result.fileName);
    }

    setShowUploader(false);
    setSelectedHarEntry(null);
    setSelectedLogEntry(null);
  };

  const handleUploadNew = () => {
    setShowUploader(true);

    if (activeTool === 'har') {
      setHarFileId(null);
      setHarFileName('');
      localStorage.removeItem('har_current_file_id');
      localStorage.removeItem('har_current_file_name');
      setSelectedHarEntry(null);
    } else {
      setConsoleFileId(null);
      setConsoleFileName('');
      localStorage.removeItem('console_current_file_id');
      localStorage.removeItem('console_current_file_name');
      setSelectedLogEntry(null);
    }
  };

  const handleClearRecent = () => {
    setRecentFiles([]);
    localStorage.removeItem(RECENT_FILES_KEY);
  };

  const renderProcessingStatus = () => {
    const currentData = activeTool === 'har' ? harData : logData;
    if (!currentData.status) return null;

    const { status, progress, fileName } = currentData.status;
    if (status === 'ready') return null;

    const statusMessages: Record<string, string> = {
      uploading: 'Uploading file...',
      processing: 'Processing...',
      parsing: 'Parsing file...',
      indexing: 'Indexing data...',
      analyzing: 'Analyzing data...'
    };

    return (
      <div className="processing-banner">
        <div className="processing-content">
          <div className="processing-spinner"></div>
          <div className="processing-info">
            <h4>{fileName}</h4>
            <p className="status-text">{statusMessages[status] || 'Processing...'}</p>
            {progress !== undefined && (
              <>
                <div className="progress-bar-outer">
                  <div className="progress-bar-inner" style={{ width: `${progress}%` }}></div>
                </div>
                <p className="progress-percentage">{Math.round(progress)}%</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const currentFileId = activeTool === 'har' ? harFileId : consoleFileId;
  const currentFileName = activeTool === 'har' ? harFileName : consoleFileName;
  const currentData = activeTool === 'har' ? harData : logData;
  const selectedEntry = activeTool === 'har' ? selectedHarEntry : selectedLogEntry;
  const hasData = currentFileId && currentData.entries.length > 0;

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
        <div className="tool-selector">
          <button
            className={`tool-tab ${activeTool === 'har' ? 'active' : ''}`}
            onClick={() => {
              setActiveTool('har');
              setShowUploader(false);
              setSelectedHarEntry(null);
              setSelectedLogEntry(null);
              console.log('🔄 Switched to HAR tab, fileId:', harFileId);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            </svg>
            HAR
          </button>
          <button
            className={`tool-tab ${activeTool === 'console' ? 'active' : ''}`}
            onClick={() => {
              setActiveTool('console');
              setShowUploader(false);
              setSelectedHarEntry(null);
              setSelectedLogEntry(null);
              console.log('🔄 Switched to Console tab, fileId:', consoleFileId);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
            Console
          </button>
        </div>

        {renderProcessingStatus()}

        {(showUploader || !currentFileId) ? (
          <div className="upload-section">
            {activeTool === 'har' ? (
              <FileUploader
                onFileUpload={handleFileUpload}
                recentFiles={recentFiles}
                onClearRecent={handleClearRecent}
              />
            ) : (
              <ConsoleLogUploader
                onFileUpload={handleFileUpload}
                recentFiles={recentFiles}
                onClearRecent={handleClearRecent}
              />
            )}
          </div>
        ) : currentFileId && !hasData ? (
          /* File uploaded/restored but not yet ready — show processing state */
          <div className="processing-placeholder">
            <div className="processing-placeholder-icon">
              {currentData.status?.status === 'error' ? '❌' : '📊'}
            </div>
            <h2 className="processing-placeholder-title">
              {currentData.status?.status === 'error'
                ? 'Processing Failed'
                : currentData.status
                  ? 'Processing Your File'
                  : 'Loading...'}
            </h2>
            {currentData.status?.status !== 'error' && (
              <div className="processing-placeholder-spinner"></div>
            )}
            <p className="processing-placeholder-sub">
              {currentData.status?.status === 'error'
                ? 'An error occurred. Please try uploading the file again.'
                : currentData.status?.fileName
                  ? `${currentData.status.fileName} is being processed. This may take a moment.`
                  : 'Connecting to server...'}
            </p>
            {currentData.status?.status === 'error' && (
              <button className="btn-toolbar" onClick={handleUploadNew} style={{ marginTop: 16 }}>
                Upload New File
              </button>
            )}
          </div>
        ) : hasData ? (
          <>
            <div className="toolbar">
              <div className="toolbar-left">
                <button className="btn-toolbar" onClick={handleUploadNew}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                  Upload New
                </button>
                {currentFileName && (
                  <span className="current-file">
                    📄 {currentFileName}
                  </span>
                )}
              </div>
              <div className="toolbar-right">
                <span className="entry-count">
                  {activeTool === 'har' && harData.filteredEntries
                    ? `${harData.filteredEntries.length} / ${harData.entries.length} requests`
                    : activeTool === 'console' && logData.totalEntries > 0
                      ? `${logData.entries.length} / ${logData.totalEntries.toLocaleString()} entries`
                      : activeTool === 'har'
                        ? `${harData.entries.length} requests`
                        : `${logData.entries.length} entries`
                  }
                </span>
              </div>
            </div>

            {/* ✅ FIXED: Both tools get sidebar now */}
            <div
              className={`analyzer-layout ${selectedEntry ? 'with-details' : ''}`}
              style={{
                ...(selectedEntry ? { ['--details-width' as any]: `${detailsWidth}px` } : {}),
                gridTemplateColumns: selectedEntry
                  ? `280px 1fr ${detailsWidth}px`
                  : '280px 1fr'
              }}
            >
              {/* ✅ LEFT SIDEBAR: Filter panels for both HAR and Console */}
              <aside className="sidebar-left">
                {activeTool === 'har' && harData.filters && harData.updateFilters ? (
                  <FilterPanel
                    filters={harData.filters}
                    onFilterChange={harData.updateFilters}
                  />
                ) : activeTool === 'console' && logData.filters && logData.updateFilters ? (
                  <>
                    <ConsoleLogFilterPanel
                      filters={logData.filters}
                      onFilterChange={logData.updateFilters}
                    />
                    <ConsoleLogStatistics entries={logData.filteredEntries} />
                  </>
                ) : null}
              </aside>

              {/* Content Area */}
              <div className="content-area">
                {activeTool === 'har' ? (
                  <RequestList
                    entries={harData.filteredEntries || harData.entries}
                    selectedEntry={selectedHarEntry}
                    onSelectEntry={setSelectedHarEntry}
                    hasMore={harData.hasMore}
                    onLoadMore={harData.loadMore}
                    loading={harData.loading}
                  />
                ) : (
                  <ConsoleLogList
                    logs={logData.filteredEntries}
                    selectedLog={selectedLogEntry}
                    onSelectLog={setSelectedLogEntry}
                    hasMore={logData.hasMore}
                    onLoadMore={logData.loadMore}
                    loading={logData.loading}
                  />
                )}
              </div>

              {/* ✅ RIGHT SIDEBAR: Details Panel */}
              {selectedEntry && (
                <aside className="sidebar-right">
                  <div className="resize-handle" onMouseDown={startResize} />
                  {activeTool === 'har' && selectedHarEntry ? (
                    <RequestDetails
                      entry={selectedHarEntry}
                      onClose={() => setSelectedHarEntry(null)}
                    />
                  ) : activeTool === 'console' && selectedLogEntry ? (
                    <ConsoleLogDetails
                      entry={selectedLogEntry}
                      onClose={() => setSelectedLogEntry(null)}
                    />
                  ) : null}
                </aside>
              )}
            </div>

            <FloatingAiChat
              fileId={currentFileId}
              fileType={activeTool}
            />
          </>
        ) : null}
      </main>
    </div>
  );
};

export default App;
