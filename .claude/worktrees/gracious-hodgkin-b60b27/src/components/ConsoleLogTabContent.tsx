// src/components/ConsoleLogTabContent.tsx
// Self-contained console log analyser instance. One is mounted per open file.
// Hidden (display:none) when not active so state is preserved while switching tabs.

import React, { useEffect, useMemo, useState } from 'react';
import { ConsoleLogFile } from '../types/consolelog';
import { useConsoleLogData } from '../hooks/useConsoleLogData';
import { ConsoleLogAnalyzer } from '../utils/consoleLogAnalyzer';
import ConsoleLogFilterPanel from './ConsoleLogFilterPanel';
import ConsoleLogList from './ConsoleLogList';
import ConsoleLogDetails from './ConsoleLogDetails';
import ConsoleLogStatistics from './ConsoleLogStatistics';
import ConsoleLogAiInsights from './ConsoleLogAiInsights';
import Toolbar from './Toolbar';
import FloatingAiChat from './FloatingAiChat';
import { ChevronDownIcon, ClockIcon, FileIcon, TrashIcon, UploadIcon } from './Icons';

interface RecentFile {
  name: string;
  timestamp: number;
  data: File;
}

export interface ConsoleLogTabContentProps {
  tabId: string;
  /** Backend file ID — present for large files processed server-side */
  fileId: string | null;
  fileName: string;
  /** Pre-parsed data — present for small files parsed locally before tab creation */
  initialData: ConsoleLogFile | null;
  isActive: boolean;
  backendUrl: string;
  recentFiles: RecentFile[];
  /** Clicking "Upload New" in the toolbar should open a new tab, not replace this one */
  onAddNewTab: () => void;
  onLoadRecentNewTab: (file: File) => void;
  onClearRecent: () => void;
}

type ConsoleSubTab = 'analyzer' | 'insights';

const DETAILS_MIN = 320;
const DETAILS_MAX = 900;

const ConsoleLogTabContent: React.FC<ConsoleLogTabContentProps> = ({
  fileId,
  fileName,
  initialData,
  isActive,
  backendUrl,
  recentFiles,
  onAddNewTab,
  onLoadRecentNewTab,
  onClearRecent,
}) => {
  const logState = useConsoleLogData();
  const [activeSubTab, setActiveSubTab] = useState<ConsoleSubTab>('analyzer');
  const [detailsWidth, setDetailsWidth] = useState(450);
  const [showStickyRecent, setShowStickyRecent] = useState(false);

  // ── Load data on first mount ────────────────────────────────────────────────
  // If the file was parsed locally in App.tsx before the tab was created, we just
  // hydrate the hook directly (no network call needed). Otherwise load from backend.
  useEffect(() => {
    if (initialData) {
      logState.loadFromData(initialData);
    } else if (fileId) {
      void logState.loadLogFromBackend(fileId, fileName);
    }
    // Run only once on mount — deps intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Details panel drag-to-resize ────────────────────────────────────────────
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = detailsWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      setDetailsWidth(Math.max(DETAILS_MIN, Math.min(DETAILS_MAX, startWidth + delta)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const formatRecentDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const logGroupedEntries = useMemo(() => {
    if (logState.filters.groupBy === 'all') return null;
    if (logState.filters.groupBy === 'level')
      return ConsoleLogAnalyzer.groupByLevel(logState.filteredEntries);
    return ConsoleLogAnalyzer.groupBySource(logState.filteredEntries);
  }, [logState.filteredEntries, logState.filters.groupBy]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: isActive ? undefined : 'none' }}>
      {/* Loading state while fetching from backend */}
      {logState.isLoading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <p>Loading console log entries…</p>
        </div>
      )}

      {logState.error && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          <span>{logState.error}</span>
          <button onClick={logState.clearData} className="btn-dismiss">✕</button>
        </div>
      )}

      {logState.logData && (
        <>
          {/* ── Console sub-tabs ─────────────────────────────────────────── */}
          <div className="console-sticky-header">
            <div className="main-tabs console-main-tabs">
              {(['analyzer', 'insights'] as ConsoleSubTab[]).map((tab) => (
                <button
                  key={tab}
                  className={`main-tab ${activeSubTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveSubTab(tab)}
                >
                  {tab === 'analyzer' ? 'Analyzer' : 'AI Insights'}
                </button>
              ))}
            </div>
            <div className="console-sticky-actions">
              <button className="btn-toolbar btn-upload console-sticky-upload" onClick={onAddNewTab}>
                <UploadIcon />
                <span>Upload New</span>
              </button>
              {recentFiles.length > 0 && (
                <div className={`recent-files-dropdown ${showStickyRecent ? 'active' : ''}`}>
                  <button
                    className="btn-toolbar btn-recent console-sticky-recent"
                    onClick={() => setShowStickyRecent(!showStickyRecent)}
                  >
                    <ClockIcon />
                    <span>Recent Files</span>
                    <ChevronDownIcon />
                  </button>

                  {showStickyRecent && (
                    <div className="dropdown-menu">
                      <div className="dropdown-header">
                        <span>Recent Files</span>
                        <button
                          className="btn-clear-recent"
                          onClick={() => {
                            onClearRecent();
                            setShowStickyRecent(false);
                          }}
                        >
                          <TrashIcon />
                          <span>Clear All</span>
                        </button>
                      </div>
                      <div className="dropdown-content">
                        {recentFiles.map((file, index) => (
                          <button
                            key={index}
                            className="recent-file-item"
                            onClick={() => {
                              const fileToPass =
                                file.data instanceof File
                                  ? file.data
                                  : new File([], file.name);
                              onLoadRecentNewTab(fileToPass);
                              setShowStickyRecent(false);
                            }}
                          >
                            <div className="recent-file-info">
                              <FileIcon />
                              <span className="recent-file-name">{file.name}</span>
                            </div>
                            <span className="recent-file-time">{formatRecentDate(file.timestamp)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {activeSubTab === 'analyzer' && (
            <>
              <Toolbar
                onUploadNew={onAddNewTab}
                onLoadRecent={onLoadRecentNewTab}
                recentFiles={recentFiles}
                onClearRecent={onClearRecent}
                showUploadButton={false}
                showRecentButton={false}
                currentFileName={logState.logData.metadata.fileName}
                filteredEntries={logState.filteredEntries}
                totalEntries={logState.logData.entries.length}
              />

              <div
                className={`analyzer-layout ${logState.selectedEntry ? 'with-details' : ''}`}
                style={
                  logState.selectedEntry
                    ? ({ ['--details-width' as any]: `${detailsWidth}px` })
                    : undefined
                }
              >
                <aside className="sidebar-left console-sidebar">
                  <div className="console-sidebar-stack">
                    <ConsoleLogFilterPanel
                      filters={logState.filters}
                      onFilterChange={logState.updateFilters}
                    />
                    <ConsoleLogStatistics
                      entries={logState.filteredEntries}
                      totalEntries={logState.logData.metadata.totalEntries}
                      truncatedAt={(logState.logData.metadata as any).truncatedAt}
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
            </>
          )}

          {/* Always mounted so useConsoleLogInsights auto-fires on data load,
              generating results before the user visits the AI Insights tab. */}
          <div style={{ display: activeSubTab === 'insights' ? undefined : 'none' }}>
            <ConsoleLogAiInsights
              logData={logState.logData}
              backendUrl={backendUrl}
            />
          </div>

          <FloatingAiChat logData={logState.logData} />
        </>
      )}
    </div>
  );
};

export default ConsoleLogTabContent;
