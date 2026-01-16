// src/components/Toolbar.tsx
import React, { useState } from 'react';
import { ConsoleLogEntry } from '../types/consolelog';
import { Entry } from '../types/har';
import { ConsoleLogExporter } from '../utils/consoleLogExporter';
import { HarExporter } from '../utils/harExporter';

import { 
  ExportIcon, 
  UploadIcon, 
  FileIcon, 
  ChevronDownIcon,
  ClockIcon,
  TrashIcon,
  FileTextIcon,
  CheckIcon
} from './Icons';

interface RecentFile {
  name: string;
  timestamp: number;
  data: File;
}

interface ToolbarProps {
  onUploadNew: () => void;
  onLoadRecent: (file: File) => void;
  recentFiles: RecentFile[];
  onClearRecent: () => void;
  filteredEntries?: ConsoleLogEntry[];
  totalEntries?: number;
  currentFileName?: string;
  // HAR export props
  harEntries?: Entry[];
  totalHarEntries?: number;
}

const Toolbar: React.FC<ToolbarProps> = ({
  onUploadNew,
  onLoadRecent,
  recentFiles = [],
  onClearRecent,
  currentFileName = '',
  filteredEntries = [],
  totalEntries = 0,
  harEntries,
  totalHarEntries = 0,
}) => {
  const [showRecent, setShowRecent] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Determine which mode we're in
  const isHarMode = harEntries !== undefined && harEntries.length > 0;
  const isConsoleMode = filteredEntries !== undefined && filteredEntries.length > 0;
  const canExport = isHarMode || isConsoleMode;

  const handleExportCSV = () => {
    try {
      if (isHarMode && harEntries) {
        const filename = HarExporter.getExportFilename(
          currentFileName || 'har-export',
          harEntries.length,
          totalHarEntries
        );
        HarExporter.exportToCSV(harEntries, `${filename}.csv`);
      } else if (isConsoleMode && filteredEntries) {
        const filename = ConsoleLogExporter.getExportFilename(
          currentFileName || 'console-logs',
          filteredEntries.length,
          totalEntries
        );
        ConsoleLogExporter.exportToCSV(filteredEntries, `${filename}.csv`);
      }
      setShowExportMenu(false);
    } catch (error) {
      console.error('CSV export error:', error);
      alert('Failed to export CSV: ' + error);
    }
  };

  const handleExportExcel = () => {
    try {
      if (isHarMode && harEntries) {
        const filename = HarExporter.getExportFilename(
          currentFileName || 'har-export',
          harEntries.length,
          totalHarEntries
        );
        HarExporter.exportToExcel(harEntries, `${filename}.csv`);
      } else if (isConsoleMode && filteredEntries) {
        const filename = ConsoleLogExporter.getExportFilename(
          currentFileName || 'console-logs',
          filteredEntries.length,
          totalEntries
        );
        ConsoleLogExporter.exportToExcel(filteredEntries, `${filename}.csv`);
      }
      setShowExportMenu(false);
    } catch (error) {
      console.error('Excel export error:', error);
      alert('Failed to export Excel: ' + error);
    }
  };

  const formatDate = (timestamp: number) => {
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

  const exportCount = isHarMode ? harEntries?.length : filteredEntries?.length;

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        {currentFileName && (
          <div className="current-file">
            <FileIcon />
            <span className="file-name">{currentFileName}</span>
          </div>
        )}
      </div>

      <div className="toolbar-right">
        {canExport && (
          <div className="toolbar-dropdown">
            <button
              className={`btn-toolbar btn-export ${showExportMenu ? 'active' : ''}`}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowExportMenu(!showExportMenu);
              }}
            >
              <ExportIcon />
              <span>Export</span>
              <ChevronDownIcon />
            </button>
            {showExportMenu && (
              <div 
                className={`dropdown-menu export-menu ${showExportMenu ? 'active' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <div className="dropdown-header">
                  <span>Export {exportCount} {isHarMode ? 'requests' : 'entries'}</span>
                </div>
                <button 
                  className="dropdown-item" 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleExportCSV();
                  }}
                  type="button"
                >
                  <FileTextIcon />
                  <div className="item-content">
                    <span className="item-title">Export as CSV</span>
                    <span className="item-description">Comma-separated values</span>
                  </div>
                </button>
                
                {/* <button 
                  className="dropdown-item" 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleExportExcel();
                  }}
                  type="button"
                >
                  <FileTextIcon />
                  <div className="item-content">
                    <span className="item-title">Export as Excel</span>
                    <span className="item-description">Microsoft Excel format</span>
                  </div>
                </button> */}
              </div>
            )}
          </div>
        )}

        <button className="btn-toolbar btn-upload" onClick={onUploadNew}>
          <UploadIcon />
          <span>Upload New</span>
        </button>

        {recentFiles.length > 0 && (
          <div className={`recent-files-dropdown ${showRecent ? 'active' : ''}`}>
            <button
              className="btn-toolbar btn-recent"
              onClick={() => setShowRecent(!showRecent)}
            >
              <ClockIcon />
              <span>Recent Files</span>
              <ChevronDownIcon />
            </button>

            {showRecent && (
              <div className="dropdown-menu">
                <div className="dropdown-header">
                  <span>Recent Files</span>
                  <button
                    className="btn-clear-recent"
                    onClick={() => {
                      onClearRecent();
                      setShowRecent(false);
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
                        onLoadRecent(file.data);
                        setShowRecent(false);
                      }}
                    >
                      <div className="recent-file-info">
                        <FileIcon />
                        <span className="recent-file-name">{file.name}</span>
                      </div>
                      <span className="recent-file-time">{formatDate(file.timestamp)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Toolbar;
