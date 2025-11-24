// src/components/Toolbar.tsx
import React, { useState } from 'react';

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
  currentFileName?: string;
}

const Toolbar: React.FC<ToolbarProps> = ({
  onUploadNew,
  onLoadRecent,
  recentFiles,
  onClearRecent,
  currentFileName,
}) => {
  const [showRecent, setShowRecent] = useState(false);

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

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        {currentFileName && (
          <div className="current-file">
            <span className="file-icon">📄</span>
            <span className="file-name">{currentFileName}</span>
          </div>
        )}
      </div>

      <div className="toolbar-right">
        <button className="btn-toolbar btn-upload" onClick={onUploadNew}>
          <span>📁</span>
          Upload New
        </button>

        {recentFiles.length > 0 && (
          <div className="recent-files-dropdown">
            <button 
              className="btn-toolbar btn-recent"
              onClick={() => setShowRecent(!showRecent)}
            >
              <span></span>
              Recent Files
              <span className="dropdown-icon">{showRecent ? '▲' : '▼'}</span>
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
                    Clear All
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
                      <span className="recent-file-name">{file.name}</span>
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
