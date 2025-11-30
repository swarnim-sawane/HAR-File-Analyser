// src/components/ConsoleLogFilterPanel.tsx

import React from 'react';
import { ConsoleFilterOptions } from '../types/consolelog';

interface ConsoleLogFilterPanelProps {
  filters: ConsoleFilterOptions;
  onFilterChange: (filters: Partial<ConsoleFilterOptions>) => void;
}

const ConsoleLogFilterPanel: React.FC<ConsoleLogFilterPanelProps> = ({
  filters,
  onFilterChange
}) => {
  const handleLevelChange = (level: keyof ConsoleFilterOptions['levels']) => {
    onFilterChange({
      levels: {
        ...filters.levels,
        [level]: !filters.levels[level],
      },
    });
  };

  const handleSelectAll = () => {
    const allSelected = Object.values(filters.levels).every(v => v);
    const newLevels = {
      log: !allSelected,
      info: !allSelected,
      warn: !allSelected,
      error: !allSelected,
      debug: !allSelected,
      trace: !allSelected,
      verbose: !allSelected,
    };
    onFilterChange({ levels: newLevels });
  };

  const handleGroupByChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({ groupBy: e.target.value as 'all' | 'level' | 'source' });
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ searchTerm: e.target.value });
  };

  const levelConfig = [
    { key: 'error', label: 'Error', color: '#ef4444' },
    { key: 'warn', label: 'Warning', color: '#f59e0b' },
    { key: 'info', label: 'Info', color: '#3b82f6' },
    { key: 'log', label: 'Log', color: '#6b7280' },
    { key: 'debug', label: 'Debug', color: '#8b5cf6' },
    { key: 'trace', label: 'Trace', color: '#ec4899' },
    { key: 'verbose', label: 'Verbose', color: '#06b6d4' },
  ];

  const allSelected = Object.values(filters.levels).every(v => v);

  return (
    <div className="filter-panel pro-filter-panel">
      <div className="filter-section">
        <div className="filter-section-header">
          <h3>Log Levels</h3>
          <button className="btn-select-all" onClick={handleSelectAll}>
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
        </div>
        
        <div className="checkbox-list">
          {levelConfig.map(({ key, label, color }) => (
            <label key={key} className="checkbox-item">
              <input
                type="checkbox"
                checked={filters.levels[key as keyof ConsoleFilterOptions['levels']]}
                onChange={() => handleLevelChange(key as keyof ConsoleFilterOptions['levels'])}
              />
              <span className="checkbox-custom"></span>
              <span 
                className="level-indicator"
                style={{ backgroundColor: color }}
              ></span>
              <span className="checkbox-label">{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="filter-section">
        <h3>Search</h3>
        <input
          type="text"
          value={filters.searchTerm}
          onChange={handleSearchChange}
          placeholder="Search logs..."
          className="search-input"
        />
      </div>

      <div className="filter-section">
        <h3>Group By</h3>
        <select
          value={filters.groupBy}
          onChange={handleGroupByChange}
          className="select-input"
        >
          <option value="all">All Entries</option>
          <option value="level">Log Level</option>
          <option value="source">Source File</option>
        </select>
      </div>
    </div>
  );
};

export default ConsoleLogFilterPanel;
