// src/components/HarTabContent.tsx
// Self-contained HAR analyzer instance. One is mounted per open file.
// Hidden (display:none) when not active so state is preserved while switching tabs.

import React, { useCallback, useEffect, useState } from 'react';
import FilterPanel from './FilterPanel';
import RequestList from './RequestList';
import RequestDetails from './RequestDetails';
import Toolbar from './Toolbar';
import { useHarData } from '../hooks/useHarData';
import { HarAnalyzer } from '../utils/harAnalyzer';
import HarSanitizer from './HarSanitizer';
import FloatingAiChat from './FloatingAiChat';
import RequestFlowDiagram from './RequestFlowDiagram';
import PerformanceScorecard from './PerformanceScorecard';
import AiInsights from './AiInsights';
import { apiClient } from '../services/apiClient';

type HarTab = 'analyzer' | 'sanitizer' | 'flow' | 'scorecard' | 'insights';

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
  onAddNewTab: () => void;          // "Upload new" in toolbar → create new tab
  onLoadRecentNewTab: (file: File) => void;
  onClearRecent: () => void;
  onInsightsGeneratingChange: (tabId: string, generating: boolean) => void;
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
  onInsightsGeneratingChange,
}) => {
  const harState = useHarData();
  const [activeTab, setActiveTab] = useState<HarTab>('analyzer');
  const [isInsightsGenerating, setIsInsightsGenerating] = useState(false);
  const [detailsWidth, setDetailsWidth] = useState(450);
  const [isLoadingFile, setIsLoadingFile] = useState(true);
  const DETAILS_MIN = 320;
  const DETAILS_MAX = 900;

  // Load file data when the tab is first created
  useEffect(() => {
    if (!fileId) return;
    setIsLoadingFile(true);
    apiClient.getHarData(fileId)
      .then(data => harState.loadHarData(data))
      .catch(err => {
        console.error(`Failed to load HAR tab ${tabId}:`, err);
      })
      .finally(() => setIsLoadingFile(false));
  // Only run on mount — fileId is immutable per tab
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // Propagate insights-generating state up to App (for the leave guard)
  useEffect(() => {
    onInsightsGeneratingChange(tabId, isInsightsGenerating);
  }, [tabId, isInsightsGenerating, onInsightsGeneratingChange]);

  const handleInsightsGeneratingChange = useCallback((generating: boolean) => {
    setIsInsightsGenerating(generating);
  }, []);

  const handleTabChange = (nextTab: HarTab) => {
    if (nextTab === activeTab) return;
    if (activeTab === 'insights' && isInsightsGenerating) {
      // Don't switch while insights are running — guard is handled at App level via
      // the pendingLeaveNavigation modal. Sub-tab switches within same file are allowed
      // (the modal only guards switching to a different tool/file).
    }
    if (activeTab === 'insights') setIsInsightsGenerating(false);
    setActiveTab(nextTab);
  };

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

  const harGroupedEntries = React.useMemo(() => {
    if (!harState.harData || harState.filters.groupBy === 'all') return null;
    const pages = harState.harData.log.pages || [];
    return HarAnalyzer.groupByPage(harState.filteredEntries, pages);
  }, [harState.harData, harState.filteredEntries, harState.filters.groupBy]);

  return (
    // Keep mounted but hidden — preserves hook state (filters, selected entry, etc.)
    <div style={{ display: isActive ? undefined : 'none' }}>

      {/* Sub-tabs: only show once data is loaded */}
      {harState.harData && (
        <div className="main-tabs">
          {(['analyzer', 'flow', 'sanitizer', 'scorecard', 'insights'] as HarTab[]).map(tab => (
            <button
              key={tab}
              className={`main-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => handleTabChange(tab)}
            >
              {tab === 'analyzer' ? 'Analyzer'
                : tab === 'flow' ? 'Request Flow'
                : tab === 'sanitizer' ? 'Sanitizer'
                : tab === 'scorecard' ? 'Scorecard'
                : 'AI Insights'}
            </button>
          ))}
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
          <span className="error-icon">⚠️</span>
          <span>{harState.error}</span>
          <button onClick={harState.clearData} className="btn-dismiss">✕</button>
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
          )}

          {activeTab === 'sanitizer' && (
            <div className="sanitizer-wrapper">
              <HarSanitizer />
            </div>
          )}

          {activeTab === 'flow' && (
            <div style={{ height: 'calc(100vh - 200px)' }}>
              <RequestFlowDiagram
                entries={harState.filteredEntries}
                onNodeClick={(entry: any) => {
                  harState.setSelectedEntry(entry);
                  setActiveTab('analyzer');
                }}
              />
            </div>
          )}

          {activeTab === 'scorecard' && (
            <div className="scorecard-wrapper">
              <PerformanceScorecard harData={harState.harData} />
            </div>
          )}

          {activeTab === 'insights' && (
            <AiInsights
              harData={harState.harData}
              backendUrl={backendUrl}
              onGeneratingChange={handleInsightsGeneratingChange}
            />
          )}
        </>
      )}
    </div>
  );
};

export default HarTabContent;
