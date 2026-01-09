// src/components/FilterPanel.tsx
import React from 'react';
import { FilterOptions } from '../types/har';

interface FilterPanelProps {
  filters: FilterOptions;
  onFilterChange: (filters: Partial<FilterOptions>) => void;
}

const FilterPanel: React.FC<FilterPanelProps> = ({ filters, onFilterChange }) => {
  const handleStatusCodeChange = (code: keyof FilterOptions['statusCodes']) => {
    onFilterChange({
      statusCodes: {
        ...filters.statusCodes,
        [code]: !filters.statusCodes[code],
      },
    });
  };

  const handleGroupByChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ groupBy: e.target.value as 'pages' | 'all' });
  };

  const handleTimingTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ timingType: e.target.value as 'relative' | 'independent' });
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ searchTerm: e.target.value });
  };

  return (
    <div className="filter-panel">
      <div className="filter-section">
        <h3>Filter by HTTP Status Codes</h3>
        <div className="checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.statusCodes['0']}
              onChange={() => handleStatusCodeChange('0')}
            />
            <span className="status-badge status-0">0</span>
          </label>
          
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.statusCodes['1xx']}
              onChange={() => handleStatusCodeChange('1xx')}
            />
            <span className="status-badge status-1xx">1xx</span>
          </label>
          
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.statusCodes['2xx']}
              onChange={() => handleStatusCodeChange('2xx')}
            />
            <span className="status-badge status-2xx">2xx</span>
          </label>
          
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.statusCodes['3xx']}
              onChange={() => handleStatusCodeChange('3xx')}
            />
            <span className="status-badge status-3xx">3xx</span>
          </label>
          
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.statusCodes['4xx']}
              onChange={() => handleStatusCodeChange('4xx')}
            />
            <span className="status-badge status-4xx">4xx</span>
          </label>
          
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.statusCodes['5xx']}
              onChange={() => handleStatusCodeChange('5xx')}
            />
            <span className="status-badge status-5xx">5xx</span>
          </label>
        </div>
      </div>

      <div className="filter-section">
        <h3>Terms to Filter By</h3>
        <input
          type="text"
          placeholder="Filter by URL, method, status..."
          value={filters.searchTerm}
          onChange={handleSearchChange}
          className="search-input"
        />
      </div>

      <div className="filter-section">
        <h3>Group By</h3>
        <div className="radio-group">
          <label className="radio-label">
            <input
              type="radio"
              name="groupBy"
              value="pages"
              checked={filters.groupBy === 'pages'}
              onChange={handleGroupByChange}
            />
            <span>Pages</span>
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="groupBy"
              value="all"
              checked={filters.groupBy === 'all'}
              onChange={handleGroupByChange}
            />
            <span>All Entries</span>
          </label>
        </div>
      </div>

      <div className="filter-section">
        <h3>Timing Type</h3>
        <div className="radio-group">
          <label className="radio-label">
            <input
              type="radio"
              name="timingType"
              value="relative"
              checked={filters.timingType === 'relative'}
              onChange={handleTimingTypeChange}
            />
            <span>Relative</span>
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="timingType"
              value="independent"
              checked={filters.timingType === 'independent'}
              onChange={handleTimingTypeChange}
            />
            <span>Independent</span>
          </label>
        </div>
      </div>
    </div>
  );
};

export default FilterPanel;
