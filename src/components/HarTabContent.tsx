// src/components/HarTabContent.tsx
// Self-contained HAR analyzer instance. One is mounted per open file.
// Hidden (display:none) when not active so state is preserved while switching tabs.

import React, { useEffect, useRef, useState } from 'react';
import FilterPanel from './FilterPanel';
import RequestList from './RequestList';
import RequestDetails from './RequestDetails';
import Toolbar from './Toolbar';
import { useHarData } from '../hooks/useHarData';
import FloatingAiChat from './FloatingAiChat';
import RequestFlowDiagram from './RequestFlowDiagram';
import RequestFlowGraphView from './RequestFlowGraphView';
import RequestFlowTraceView from './RequestFlowTraceView';
import PerformanceScorecard from './PerformanceScorecard';
import AiInsights from './AiInsights';
import { apiClient } from '../services/apiClient';
import { ChevronDownIcon, ClockIcon, FileIcon, NetworkIcon, RouteIcon, ServerIcon, TrashIcon, UploadIcon } from './Icons';

type HarTab = 'analyzer' | 'flow' | 'scorecard' | 'insights';
type FlowViewMode = 'diagram' | 'nodes' | 'trace';

interface RecentFile {
  name: string;
  timestamp: number;
  data: File;
}

export interface HarTabContentProps {
  tabId: string;
  fileId: string;
  fileName: string;
  isActive: boolean;
  backendUrl: string;
  recentFiles: RecentFile[];
  onAddNewTab: () => void;          // "Upload new" in toolbar -> create new tab
  onLoadRecentNewTab: (file: File) => void;
  onClearRecent: () => void;
}

const HarTabContent: React.FC<HarTabContentProps> = ({
  tabId,
  fileId,
  fileName,
  isActive,
  backendUrl,
  recentFiles,
  onAddNewTab,
  onLoadRecentNewTab,
  onClearRecent,
}) => {
  const harState = useHarData();
  const [activeTab, setActiveTab] = useState<HarTab>('analyzer');
  const [flowViewMode, setFlowViewMode] = useState<FlowViewMode>('nodes');
  const [detailsWidth, setDetailsWidth] = useState(450);
  const [isLoadingFile, setIsLoadingFile] = useState(true);
  const [showStickyRecent, setShowStickyRecent] = useState(false);
  const flowViewRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const DETAILS_MIN = 320;
  const DETAILS_MAX = 900;
  const flowViewOptions: Array<{ value: FlowViewMode; label: string; description: string; icon: React.ReactNode }> = [
    {
      value: 'diagram',
      label: 'Journey Map',
      description: 'Current cross-domain journey view',
      icon: <RouteIcon />,
    },
    {
      value: 'nodes',
      label: 'Scattered View',
      description: 'Original scattered request node view',
      icon: <NetworkIcon />,
    },
    // {
    //   value: 'trace',
    //   label: 'System Trace',
    //   description: 'Inferred primary request chain from the visible HAR entries',
    //   icon: <ServerIcon />,
    // },
  ];

  // Load file data when the tab is first created.
  useEffect(() => {
    if (!fileId) return;
    setIsLoadingFile(true);
    apiClient.getHarData(fileId)
      .then(data => harState.loadHarData(data))
      .catch(err => {
        console.error(`Failed to load HAR tab ${tabId}:`, err);
      })
      .finally(() => setIsLoadingFile(false));
  // Only run on mount — fileId is immutable per tab.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

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

  const focusFlowView = (index: number) => {
    flowViewRefs.current[index]?.focus();
  };

  const moveFlowView = (index: number) => {
    const nextOption = flowViewOptions[index];
    if (!nextOption) return;
    setFlowViewMode(nextOption.value);
    focusFlowView(index);
  };

  const handleFlowViewKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const lastIndex = flowViewOptions.length - 1;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveFlowView(currentIndex === lastIndex ? 0 : currentIndex + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveFlowView(currentIndex === 0 ? lastIndex : currentIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveFlowView(0);
        break;
      case 'End':
        event.preventDefault();
        moveFlowView(lastIndex);
        break;
      default:
        break;
    }
  };

  return (
    // Keep mounted but hidden — preserves hook state (filters, selected entry, etc.)
    <div style={{ display: isActive ? undefined : 'none' }}>

      {/* Sub-tabs: only show once data is loaded */}
      {harState.harData && (
        <div className="har-sticky-header">
          <div className="main-tabs har-main-tabs">
            {(['analyzer', 'flow', 'scorecard', 'insights'] as HarTab[]).map(tab => (
              <button
                key={tab}
                className={`main-tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'analyzer' ? 'Analyzer'
                  : tab === 'flow' ? 'Request Flow'
                  : tab === 'scorecard' ? 'Scorecard'
                  : 'AI Insights'}
              </button>
            ))}
          </div>
          <div className="har-sticky-actions">
            <button className="btn-toolbar btn-upload har-sticky-upload" onClick={onAddNewTab}>
              <UploadIcon />
              <span>Upload New</span>
            </button>
            {recentFiles.length > 0 && (
              <div className={`recent-files-dropdown ${showStickyRecent ? 'active' : ''}`}>
                <button
                  className="btn-toolbar btn-recent har-sticky-recent"
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
      )}

      {(isLoadingFile || harState.isLoading) && (
        <div className="loading-overlay">
          <div className="spinner" />
          <p>Loading HAR file...</p>
        </div>
      )}

      {harState.error && (
        <div className="error-banner">
          <span className="error-icon">âš ï¸</span>
          <span>{harState.error}</span>
          <button onClick={harState.clearData} className="btn-dismiss">âœ•</button>
        </div>
      )}

      {harState.harData && (
        <>
          {activeTab === 'analyzer' && (
            <>
              <Toolbar
                onUploadNew={onAddNewTab}
                onLoadRecent={onLoadRecentNewTab}
                recentFiles={recentFiles}
                onClearRecent={onClearRecent}
                showUploadButton={false}
                showRecentButton={false}
                currentFileName={fileName}
                harEntries={harState.filteredEntries}
                totalHarEntries={harState.harData.log.entries.length}
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
            </>
          )}

          {activeTab === 'flow' && (
            <div className="flow-tab-shell">
              <div className="flow-view-toggle-bar">
                <span className="flow-view-toggle-kicker">View</span>

                <div className="flow-view-toggle" role="radiogroup" aria-label="Request Flow View">
                  {flowViewOptions.map((option, index) => {
                    const isActive = flowViewMode === option.value;

                    return (
                      <button
                        key={option.value}
                        ref={(element) => {
                          flowViewRefs.current[index] = element;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        tabIndex={isActive ? 0 : -1}
                        title={option.description}
                        className={`flow-view-toggle-option ${isActive ? 'is-active' : ''}`}
                        onClick={() => setFlowViewMode(option.value)}
                        onKeyDown={(event) => handleFlowViewKeyDown(event, index)}
                      >
                        <span className="flow-view-toggle-option-icon" aria-hidden="true">{option.icon}</span>
                        <span className="flow-view-toggle-option-label">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flow-tab-panel">
                {flowViewMode === 'diagram' ? (
                  <RequestFlowDiagram
                    entries={harState.filteredEntries}
                    onNodeClick={(entry: any) => {
                      harState.setSelectedEntry(entry);
                      setActiveTab('analyzer');
                    }}
                  />
                ) : flowViewMode === 'trace' ? (
                  <RequestFlowTraceView
                    entries={harState.filteredEntries}
                    onNodeClick={(entry) => {
                      harState.setSelectedEntry(entry);
                      setActiveTab('analyzer');
                    }}
                  />
                ) : (
                  <RequestFlowGraphView
                    entries={harState.filteredEntries}
                    onNodeClick={(entry) => {
                      harState.setSelectedEntry(entry);
                      setActiveTab('analyzer');
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {activeTab === 'scorecard' && (
            <div className="scorecard-wrapper">
              <PerformanceScorecard harData={harState.harData} />
            </div>
          )}

          {/* Always mounted so useInsights auto-fires as soon as HAR data loads,
              generating results in the background before the user visits the tab. */}
          <div style={{ display: activeTab === 'insights' ? undefined : 'none' }}>
            <AiInsights
              harData={harState.harData}
              backendUrl={backendUrl}
            />
          </div>

          <FloatingAiChat harData={harState.harData} />
        </>
      )}
    </div>
  );
};

export default HarTabContent;
