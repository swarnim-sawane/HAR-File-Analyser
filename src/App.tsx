// src/App.tsx

import React, { useState, useEffect } from 'react';
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

interface RecentFile {
  name: string;
  timestamp: number;
  data: File;
}


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

  // Main navigation
  const [activeTool, setActiveTool] = useState<'har' | 'console'>('har');
  const [activeTab, setActiveTab] = useState<'analyzer' | 'sanitizer'>('analyzer');

  const MAX_RECENT_FILES = 5;
  const HAR_RECENT_FILES_KEY = 'har_analyzer_recent_files';
  const LOG_RECENT_FILES_KEY = 'console_log_recent_files';

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
  const handleHarFileUpload = async (file: File) => {
    await harState.loadHarFile(file);
    setHarCurrentFileName(file.name);
    setHarShowUploader(false);

    const newRecentFile: RecentFile = {
      name: file.name,
      timestamp: Date.now(),
      data: file,
    };

    setHarRecentFiles(prev => {
      const filtered = prev.filter(f => f.name !== file.name);
      const updated = [newRecentFile, ...filtered].slice(0, MAX_RECENT_FILES);
      localStorage.setItem(HAR_RECENT_FILES_KEY, JSON.stringify(updated.map(f => ({
        name: f.name,
        timestamp: f.timestamp,
      }))));
      return updated;
    });
  };

  // Console log file handlers
  const handleLogFileUpload = async (file: File) => {
    await logState.loadLogFile(file);
    setLogCurrentFileName(file.name);
    setLogShowUploader(false);

    const newRecentFile: RecentFile = {
      name: file.name,
      timestamp: Date.now(),
      data: file,
    };

    setLogRecentFiles(prev => {
      const filtered = prev.filter(f => f.name !== file.name);
      const updated = [newRecentFile, ...filtered].slice(0, MAX_RECENT_FILES);
      localStorage.setItem(LOG_RECENT_FILES_KEY, JSON.stringify(updated.map(f => ({
        name: f.name,
        timestamp: f.timestamp,
      }))));
      return updated;
    });
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
            onClick={() => setActiveTool('har')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            </svg>
            HAR
          </button>
          <button
            className={`tool-tab ${activeTool === 'console' ? 'active' : ''}`}
            onClick={() => setActiveTool('console')}
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
                  onClick={() => setActiveTab('analyzer')}
                >
                  Analyzer
                </button>
                <button
                  className={`main-tab ${activeTab === 'sanitizer' ? 'active' : ''}`}
                  onClick={() => setActiveTab('sanitizer')}
                >
                  Sanitizer
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
                      onLoadRecent={handleHarFileUpload}
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
                ) : (
                  <div className="sanitizer-wrapper">
                    <HarSanitizer />
                  </div>
                )}
              </>
            ) : null}
          </>
        )}

        {/* Console Log Analyzer Tool */}
        {activeTool === 'console' && (
          <>
            {logState.isLoading && (
              <div className="loading-overlay">
                <div className="spinner"></div>
                <p>Loading console log file...</p>
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
                  onFileUpload={handleLogFileUpload}
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
                  }}
                  onLoadRecent={handleLogFileUpload}
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

                  <aside className="sidebar-left">
                    <ConsoleLogFilterPanel
                      filters={logState.filters}
                      onFilterChange={logState.updateFilters}
                    />
                    <ConsoleLogStatistics entries={logState.filteredEntries} />
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
    </div>
  );
};

export default App;
