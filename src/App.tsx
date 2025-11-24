// src/App.tsx
import React, { useState, useEffect } from 'react';
import FileUploader from './components/FileUploader';
import FilterPanel from './components/FilterPanel';
import RequestList from './components/RequestList';
import RequestDetails from './components/RequestDetails';
import Toolbar from './components/Toolbar';
import { useHarData } from './hooks/useHarData';
import { HarAnalyzer } from './utils/harAnalyzer';
import './styles/globals.css';
import DarkModeToggle from './components/DarkModeToggle';
import HarSanitizer from './components/HarSanitizer';
import AiChat from './components/AiChat';
import FloatingAiChat from './components/FloatingAiChat';


interface RecentFile {
    name: string;
    timestamp: number;
    data: File;
}

const MAX_RECENT_FILES = 5;
const RECENT_FILES_KEY = 'har_analyzer_recent_files';

const App: React.FC = () => {
    const {
        harData,
        filteredEntries,
        selectedEntry,
        filters,
        isLoading,
        error,
        loadHarFile,
        setSelectedEntry,
        updateFilters,
        clearData,
    } = useHarData();

    const [showUploader, setShowUploader] = useState(false);
    const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
    const [currentFileName, setCurrentFileName] = useState<string>('');
    const [activeMainTab, setActiveMainTab] = useState<'analyzer' | 'sanitizer' | 'ai'>('analyzer');

    // Load recent files from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(RECENT_FILES_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                setRecentFiles(parsed);
            }
        } catch (err) {
            console.error('Failed to load recent files:', err);
        }
    }, []);

    // Save recent files to localStorage
    const saveRecentFiles = (files: RecentFile[]) => {
        try {
            // Don't store the actual File object, just metadata
            const metadata = files.map(f => ({
                name: f.name,
                timestamp: f.timestamp,
            }));
            localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(metadata));
        } catch (err) {
            console.error('Failed to save recent files:', err);
        }
    };

    const handleFileUpload = async (file: File) => {
        await loadHarFile(file);
        setCurrentFileName(file.name);
        setShowUploader(false);

        // Add to recent files
        const newRecentFile: RecentFile = {
            name: file.name,
            timestamp: Date.now(),
            data: file,
        };

        setRecentFiles(prev => {
            // Remove duplicate if exists
            const filtered = prev.filter(f => f.name !== file.name);
            // Add new file at the beginning
            const updated = [newRecentFile, ...filtered].slice(0, MAX_RECENT_FILES);
            saveRecentFiles(updated);
            return updated;
        });
    };

    const handleUploadNew = () => {
        setShowUploader(true);
        clearData();
        setCurrentFileName('');
    };

    const handleLoadRecent = (file: File) => {
        loadHarFile(file);
        setCurrentFileName(file.name);
        setShowUploader(false);
    };

    const handleClearRecent = () => {
        setRecentFiles([]);
        localStorage.removeItem(RECENT_FILES_KEY);
    };

    const groupedEntries = React.useMemo(() => {
        if (!harData || filters.groupBy === 'all') return null;
        const pages = harData.log.pages || [];
        return HarAnalyzer.groupByPage(filteredEntries, pages);
    }, [harData, filteredEntries, filters.groupBy]);

    return (
        <div className="app-container">
            <header className="app-header">
                <div className="header-brand">
                    <h1>HAR Analyzer</h1>
                    <span className="header-divider">Network Analysis Tool</span>
                </div>
                <DarkModeToggle />
            </header>




            <main className="main-content">
                {harData && !showUploader && (
                    <div className="main-tabs">
                        <button
                            className={`main-tab ${activeMainTab === 'analyzer' ? 'active' : ''}`}
                            onClick={() => setActiveMainTab('analyzer')}
                        >
                            Analyzer
                        </button>
                        <button
                            className={`main-tab ${activeMainTab === 'sanitizer' ? 'active' : ''}`}
                            onClick={() => setActiveMainTab('sanitizer')}
                        >
                            Sanitizer
                        </button>
                        
                    </div>
                )}
                {isLoading && (
                    <div className="loading-overlay">
                        <div className="spinner"></div>
                        <p>Loading HAR file...</p>
                    </div>
                )}

                {error && (
                    <div className="error-banner">
                        <span className="error-icon">⚠️</span>
                        <span>{error}</span>
                        <button onClick={clearData} className="btn-dismiss">✕</button>
                    </div>
                )}


                {(showUploader || !harData) && !isLoading ? (
                    <div className="upload-section">
                        <FileUploader
                            onFileUpload={handleFileUpload}
                            recentFiles={recentFiles}
                            onClearRecent={handleClearRecent}
                        />
                    </div>
                ) : harData ? (
                    <>
                        {activeMainTab === 'analyzer' ? (

                            <>
                                <Toolbar
                                    onUploadNew={handleUploadNew}
                                    onLoadRecent={handleLoadRecent}
                                    recentFiles={recentFiles}
                                    onClearRecent={handleClearRecent}
                                    currentFileName={currentFileName}
                                />
                                <div className="analyzer-layout">
                                    <aside className="sidebar-left">
                                        <FilterPanel filters={filters} onFilterChange={updateFilters} />
                                    </aside>

                                    <div className="content-area">
                                        <RequestList
                                            entries={filteredEntries}
                                            groupedEntries={groupedEntries}
                                            selectedEntry={selectedEntry}
                                            onSelectEntry={setSelectedEntry}
                                            timingType={filters.timingType}
                                        />
                                    </div>

                                    {selectedEntry && (
                                        <aside className="sidebar-right">
                                            <RequestDetails entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
                                        </aside>
                                    )}
                                </div>
                                <FloatingAiChat harData={harData} />
                            </>
                            
                        ) : activeMainTab === 'sanitizer' ? (
                            <div className="sanitizer-wrapper">
                                <HarSanitizer />
                            </div>
                        ) : (
                            // AI tab
                            <div className="ai-wrapper">
                                <AiChat harData={harData} />
                            </div>
                        )}
                    </>
                ) : null}
            </main>
        </div>
    );
};

export default App;
