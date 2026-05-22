// src/components/Toolbar.tsx
import React from 'react';
import { ConsoleLogEntry } from '../types/consolelog';
import { Entry } from '../types/har';
import {
  UploadIcon,
  FileIcon,
} from './Icons';

interface ToolbarProps {
  onUploadNew: () => void;
  showUploadButton?: boolean;
  filteredEntries?: ConsoleLogEntry[];
  totalEntries?: number;
  currentFileName?: string;
  // HAR export props
  harEntries?: Entry[];
  totalHarEntries?: number;
}

const Toolbar: React.FC<ToolbarProps> = ({
  onUploadNew,
  showUploadButton = true,
  currentFileName = '',
  filteredEntries = [],
  totalEntries = 0,
  harEntries,
  totalHarEntries = 0,
}) => {
  // Determine which mode we're in
  const isHarMode = harEntries !== undefined;
  const visibleHarCount = harEntries?.length ?? 0;
  const visibleConsoleCount = filteredEntries.length;
  const countLabel = isHarMode
    ? visibleHarCount === totalHarEntries
      ? `${totalHarEntries} request${totalHarEntries === 1 ? '' : 's'}`
      : `${visibleHarCount} of ${totalHarEntries} requests`
    : visibleConsoleCount === totalEntries
      ? `${totalEntries} entr${totalEntries === 1 ? 'y' : 'ies'}`
      : `${visibleConsoleCount} of ${totalEntries} entries`;

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        {currentFileName && (
          <>
            <div className="current-file">
              <FileIcon />
              <span className="file-name">{currentFileName}</span>
            </div>
            <span className="request-count-pill">{countLabel}</span>
          </>
        )}
      </div>

      <div className="toolbar-right">
        {showUploadButton && (
          <button className="btn-toolbar btn-upload" onClick={onUploadNew}>
            <UploadIcon />
            <span>Upload</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default Toolbar;
