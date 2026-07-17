// src/components/HarTabContent.tsx
// Self-contained HAR analyzer instance. One is mounted per open file.
// Hidden (display:none) when not active so state is preserved while switching tabs.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import FilterPanel from './FilterPanel';
import RequestList from './RequestList';
import RequestDetails from './RequestDetails';
import { useHarData } from '../hooks/useHarData';
import FloatingAiChat from './FloatingAiChat';
import RequestFlowDiagram from './RequestFlowDiagram';
import RequestFlowGraphView from './RequestFlowGraphView';
import RequestFlowTraceView from './RequestFlowTraceView';
import PerformanceScorecard from './PerformanceScorecard';
import AiInsights from './AiInsights';
import { apiClient } from '../services/apiClient';
import { analyzeRequestFlowFocus } from '../utils/requestFlowFocus';
import { AlertIcon, CloseIcon, NetworkIcon, RouteIcon, ServerIcon } from './Icons';
import type { Entry, FilterOptions } from '../types/har';
import type { RequestFlowFocusMode } from '../types/requestFlow';

type HarTab = 'analyzer' | 'flow' | 'scorecard' | 'insights';
type FlowViewMode = 'diagram' | 'nodes' | 'trace';
type StatusBucket = keyof FilterOptions['statusCodes'];

function getStatusBucket(status: number): StatusBucket {
  if (status === 0) return '0';
  if (status >= 100 && status < 200) return '1xx';
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  return '5xx';
}

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
}) => {
  const harState = useHarData();
  const [activeTab, setActiveTab] = useState<HarTab>('analyzer');
  const [flowViewMode, setFlowViewMode] = useState<FlowViewMode>('nodes');
  const [requestFlowFocusMode, setRequestFlowFocusMode] = useState<RequestFlowFocusMode>('all');
  const [issueFocusEnabled, setIssueFocusEnabled] = useState(true);
  const [detailsWidth, setDetailsWidth] = useState(450);
  const [isLoadingFile, setIsLoadingFile] = useState(true);
  const [selectedEntryScrollSignal, setSelectedEntryScrollSignal] = useState(0);
  const flowViewRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const autoSelectedFocusKeyRef = useRef<string | null>(null);
  const manualSelectionSuppressedRef = useRef(false);
  const flowSessionEntries = useMemo(
    () => harState.harData?.log.entries ?? [],
    [harState.harData],
  );
  const requestFlowIssueFocus = useMemo(
    () => analyzeRequestFlowFocus(flowSessionEntries),
    [flowSessionEntries]
  );
  const focusEntry = requestFlowIssueFocus ? flowSessionEntries[requestFlowIssueFocus.anchorIndex] ?? null : null;
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
      .then(data => {
        if (!data?.log) {
          const keys = data ? Object.keys(data).slice(0, 10).join(', ') : 'null/undefined';
          console.error(`HAR data for ${fileId} missing log property. Top-level keys: [${keys}]`);
          return;
        }
        return harState.loadHarData(data);
      })
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

  const focusFlowView = (index: number) => {
    flowViewRefs.current[index]?.focus();
  };

  const requestSelectedEntryScroll = () => {
    setSelectedEntryScrollSignal((signal) => signal + 1);
  };

  const selectedEntry = harState.selectedEntry;
  const setSelectedEntry = harState.setSelectedEntry;

  const revealEntryInAnalyzerFilters = (entry: Entry) => {
    const statusBucket = getStatusBucket(entry.response.status);
    const nextStatusCodes = harState.filters.statusCodes[statusBucket]
      ? harState.filters.statusCodes
      : {
          ...harState.filters.statusCodes,
          [statusBucket]: true,
        };
    const hasBlockingSearch = harState.filters.searchTerm.trim().length > 0;

    if (nextStatusCodes !== harState.filters.statusCodes || hasBlockingSearch) {
      harState.updateFilters({
        statusCodes: nextStatusCodes,
        searchTerm: hasBlockingSearch ? '' : harState.filters.searchTerm,
      });
    }
  };

  useEffect(() => {
    if (!issueFocusEnabled || !requestFlowIssueFocus || !focusEntry) return;
    if (selectedEntry || manualSelectionSuppressedRef.current) return;

    const focusKey = `${fileId}:${requestFlowIssueFocus.anchorIndex}:${Math.round(requestFlowIssueFocus.score)}`;
    if (autoSelectedFocusKeyRef.current === focusKey) return;

    autoSelectedFocusKeyRef.current = focusKey;
    setSelectedEntry(focusEntry);
    requestSelectedEntryScroll();
  }, [
    fileId,
    focusEntry,
    selectedEntry,
    setSelectedEntry,
    issueFocusEnabled,
    requestFlowIssueFocus,
  ]);

  const selectEntryManually = (entry: Entry) => {
    manualSelectionSuppressedRef.current = true;
    harState.setSelectedEntry(entry);
  };

  const openEntryFromFlow = (entry: Entry) => {
    revealEntryInAnalyzerFilters(entry);
    selectEntryManually(entry);
    requestSelectedEntryScroll();
    setActiveTab('analyzer');
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
    <div
      className={`har-tab-content ${isActive ? 'is-active' : ''} ${activeTab === 'flow' ? 'is-flow-active' : ''}`}
      style={{ display: isActive ? undefined : 'none' }}
    >

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
          <span className="error-icon" aria-hidden="true"><AlertIcon /></span>
          <span>{harState.error}</span>
          <button onClick={harState.clearData} className="btn-dismiss" aria-label="Dismiss error"><CloseIcon /></button>
        </div>
      )}

      {harState.harData && (
        <>
          {activeTab === 'analyzer' && (
            <>
              <div
                className={`analyzer-layout ${harState.selectedEntry ? 'with-details' : ''}`}
                style={harState.selectedEntry ? ({ ['--details-width' as any]: `${detailsWidth}px` }) : undefined}
              >
                <aside className="sidebar-left">
                  <FilterPanel
                    filters={harState.filters}
                    onFilterChange={harState.updateFilters}
                    fileSummary={{
                      name: fileName,
                      meta: harState.filteredEntries.length === harState.harData.log.entries.length
                        ? `HAR - ${harState.harData.log.entries.length} request${harState.harData.log.entries.length === 1 ? '' : 's'}`
                        : `HAR - ${harState.filteredEntries.length} of ${harState.harData.log.entries.length} requests`,
                    }}
                  />
                </aside>
                <div className="content-area">
                  <RequestList
                    entries={harState.filteredEntries}
                    selectedEntry={harState.selectedEntry}
                    onSelectEntry={selectEntryManually}
                    focusEntry={focusEntry}
                    focusPath={requestFlowIssueFocus}
                    scrollToSelectedSignal={selectedEntryScrollSignal}
                  />
                </div>
                {harState.selectedEntry && (
                  <aside className="sidebar-right">
                    <div className="resize-handle" onMouseDown={startResize} />
                    <RequestDetails
                      entry={harState.selectedEntry}
                      onClose={() => harState.setSelectedEntry(null)}
                      focusPath={harState.selectedEntry === focusEntry ? requestFlowIssueFocus : null}
                      searchTerm={harState.filters.searchTerm}
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
                    entries={flowSessionEntries}
                    visibleEntries={harState.filteredEntries}
                    filters={harState.filters}
                    onFiltersChange={harState.updateFilters}
                    focusMode={requestFlowFocusMode}
                    onFocusModeChange={setRequestFlowFocusMode}
                    issueFocusPath={requestFlowIssueFocus}
                    issueFocusEnabled={issueFocusEnabled}
                    onNodeClick={openEntryFromFlow}
                  />
                ) : flowViewMode === 'trace' ? (
                  <RequestFlowTraceView
                    entries={harState.filteredEntries}
                    onNodeClick={openEntryFromFlow}
                  />
                ) : (
                  <RequestFlowGraphView
                    entries={flowSessionEntries}
                    visibleEntries={harState.filteredEntries}
                    filters={harState.filters}
                    onFiltersChange={harState.updateFilters}
                    focusMode={requestFlowFocusMode}
                    onFocusModeChange={setRequestFlowFocusMode}
                    issueFocusPath={requestFlowIssueFocus}
                    issueFocusEnabled={issueFocusEnabled}
                    onIssueFocusEnabledChange={setIssueFocusEnabled}
                    onNodeClick={openEntryFromFlow}
                  />
                )}
              </div>
            </div>
          )}

          {activeTab === 'scorecard' && (
            <div className="scorecard-wrapper">
              <PerformanceScorecard harData={harState.harData} onSelectRequest={openEntryFromFlow} />
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
