// src/components/ConsoleLogTabContent.tsx
// Self-contained console log analyser instance. One is mounted per open file.
// Hidden (display:none) when not active so state is preserved while switching tabs.

import React, { useEffect, useMemo, useState } from 'react';
import { ConsoleLogFile } from '../types/consolelog';
import { useConsoleLogData } from '../hooks/useConsoleLogData';
import { usePagedConsoleLogData } from '../hooks/usePagedConsoleLogData';
import { ConsoleLogAnalyzer } from '../utils/consoleLogAnalyzer';
import ConsoleLogFilterPanel from './ConsoleLogFilterPanel';
import ConsoleLogList from './ConsoleLogList';
import PagedConsoleLogList from './PagedConsoleLogList';
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
  const isBackendPagedLog = Boolean(fileId) && !initialData;
  const logState = useConsoleLogData();
  const pagedLogState = usePagedConsoleLogData({
    fileId: fileId ?? '',
    fileName,
    isActive: isActive && isBackendPagedLog,
  });
  const [activeSubTab, setActiveSubTab] = useState<ConsoleSubTab>('analyzer');
  const [detailsWidth, setDetailsWidth] = useState(450);
  const [showStickyRecent, setShowStickyRecent] = useState(false);

  // ── Load data on first mount ────────────────────────────────────────────────
  // If the file was parsed locally in App.tsx before the tab was created, we just
  // hydrate the hook directly (no network call needed). Otherwise load from backend.
  useEffect(() => {
    if (initialData) {
      logState.loadFromData(initialData);
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
    if (isBackendPagedLog) return null;
    if (logState.filters.groupBy === 'all') return null;
    if (logState.filters.groupBy === 'level')
      return ConsoleLogAnalyzer.groupByLevel(logState.filteredEntries);
    return ConsoleLogAnalyzer.groupBySource(logState.filteredEntries);
  }, [isBackendPagedLog, logState.filteredEntries, logState.filters.groupBy]);

  const hasConsoleData = isBackendPagedLog ? !pagedLogState.isBootstrapping : Boolean(logState.logData);
  const activeFilters = isBackendPagedLog ? pagedLogState.filters : logState.filters;
  const activeFilteredEntries = isBackendPagedLog
    ? pagedLogState.getLoadedEntries()
    : logState.filteredEntries;
  const activeTotalEntries = isBackendPagedLog
    ? pagedLogState.filteredTotalEntries
    : logState.logData?.entries.length ?? 0;
  const activeFileName = isBackendPagedLog
    ? pagedLogState.fileStatus?.fileName ?? fileName
    : logState.logData?.metadata.fileName ?? fileName;
  const activeError = isBackendPagedLog ? pagedLogState.error : logState.error;
  const activeSelectedEntry = isBackendPagedLog ? pagedLogState.selectedEntry : logState.selectedEntry;
  const activeSelectedLoading = isBackendPagedLog
    ? pagedLogState.selectedEntryLoading
    : logState.selectedEntryLoading;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: isActive ? undefined : 'none' }}>
      {/* Loading state while fetching from backend */}
      {(logState.isLoading || (isBackendPagedLog && pagedLogState.isBootstrapping)) && (
        <div className="loading-overlay">
          <div className="spinner" />
          <p>Loading console log entries…</p>
        </div>
      )}

      {activeError && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          <span>{activeError}</span>
          <button onClick={isBackendPagedLog ? pagedLogState.clearData : logState.clearData} className="btn-dismiss">✕</button>
        </div>
      )}

      {hasConsoleData && (
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
                currentFileName={activeFileName}
                filteredEntries={activeFilteredEntries}
                totalEntries={activeTotalEntries}
              />

              <div
                className={`analyzer-layout ${activeSelectedEntry ? 'with-details' : ''}`}
                style={
                  activeSelectedEntry
                    ? ({ ['--details-width' as any]: `${detailsWidth}px` })
                    : undefined
                }
              >
                <aside className="sidebar-left console-sidebar">
                  <div className="console-sidebar-stack">
                    <ConsoleLogFilterPanel
                      filters={activeFilters}
                      onFilterChange={isBackendPagedLog ? pagedLogState.updateFilters : logState.updateFilters}
                      disableGrouping={isBackendPagedLog}
                    />
                    <ConsoleLogStatistics
                      entries={activeFilteredEntries}
                      totalEntries={activeTotalEntries}
                      truncatedAt={isBackendPagedLog ? undefined : (logState.logData?.metadata as any)?.truncatedAt}
                      facets={isBackendPagedLog ? pagedLogState.facets : null}
                      label={isBackendPagedLog ? 'Full-file backend query' : undefined}
                    />
                  </div>
                </aside>

                <div className="content-area">
                  {isBackendPagedLog ? (
                    <PagedConsoleLogList
                      totalEntries={pagedLogState.filteredTotalEntries}
                      facets={pagedLogState.facets}
                      selectedEntry={pagedLogState.selectedEntry}
                      selectedEntryIndex={pagedLogState.selectedEntryIndex}
                      selectedEntryId={pagedLogState.selectedEntryId}
                      isLoadingRows={pagedLogState.isLoadingRows}
                      sortField={pagedLogState.sortField}
                      sortDirection={pagedLogState.sortDirection}
                      getEntryAt={pagedLogState.getEntryAt}
                      getLoadedEntries={pagedLogState.getLoadedEntries}
                      ensureRange={pagedLogState.ensureRange}
                      onSelectEntry={pagedLogState.setSelectedEntry}
                      onSortChange={pagedLogState.updateSort}
                    />
                  ) : (
                    <ConsoleLogList
                      entries={logState.filteredEntries}
                      groupedEntries={logGroupedEntries}
                      selectedEntry={logState.selectedEntry}
                      onSelectEntry={logState.setSelectedEntry}
                    />
                  )}
                </div>

                {activeSelectedEntry && (
                  <aside className="sidebar-right">
                    <div className="resize-handle" onMouseDown={startResize} />
                    <ConsoleLogDetails
                      entry={activeSelectedEntry}
                      isLoading={activeSelectedLoading}
                      onClose={() => {
                        if (isBackendPagedLog) {
                          pagedLogState.setSelectedEntry(null);
                        } else {
                          logState.setSelectedEntry(null);
                        }
                      }}
                    />
                  </aside>
                )}
              </div>
            </>
          )}

          {activeSubTab === 'insights' && (
            isBackendPagedLog ? (
              <div className="ai-insights-state ai-insights-empty">
                <div className="ai-insights-state-copy">
                  <div className="ai-insights-state-meta">
                    <span className="ai-insights-state-kicker">Server-paged log</span>
                  </div>
                  <h2>AI Insights use analyzer evidence first</h2>
                  <p>
                    This log is being queried directly from the backend so filters and counts cover the full file.
                    Full-file AI context generation for server-paged logs should use backend summaries and is not run from partial browser rows.
                  </p>
                </div>
              </div>
            ) : logState.logData ? (
              <ConsoleLogAiInsights
                logData={logState.logData}
                backendUrl={backendUrl}
              />
            ) : null
          )}

          {!isBackendPagedLog && logState.logData && <FloatingAiChat logData={logState.logData} />}
        </>
      )}
    </div>
  );
};

export default ConsoleLogTabContent;
