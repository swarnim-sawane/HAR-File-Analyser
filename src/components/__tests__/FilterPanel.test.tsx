import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FilterPanel from '../FilterPanel';
import { FilterOptions } from '../../types/har';

const defaultFilters: FilterOptions = {
  statusCodes: {
    '0': false,
    '1xx': false,
    '2xx': true,
    '3xx': false,
    '4xx': false,
    '5xx': false,
  },
  searchTerm: '',
  timingType: 'relative',
};

describe('FilterPanel', () => {
  it('renders without crashing', () => {
    const onFilterChange = vi.fn();
    render(<FilterPanel filters={defaultFilters} onFilterChange={onFilterChange} />);
    expect(screen.getByText('Filter by HTTP Status Codes')).toBeInTheDocument();
  });

  it('renders a search input and triggers onFilterChange with new searchTerm on input', async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(<FilterPanel filters={defaultFilters} onFilterChange={onFilterChange} />);

    const searchInput = screen.getByPlaceholderText(/filter by url/i);
    expect(searchInput).toBeInTheDocument();

    await user.type(searchInput, 'api');
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ searchTerm: 'a' }));
    // Called once per character typed
    expect(onFilterChange).toHaveBeenCalledTimes(3);
  });

  it('renders at least 5 of the 6 status code checkboxes', () => {
    const onFilterChange = vi.fn();
    render(<FilterPanel filters={defaultFilters} onFilterChange={onFilterChange} />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(5);
  });

  it('2xx checkbox is checked when filters.statusCodes["2xx"] is true', () => {
    const onFilterChange = vi.fn();
    render(<FilterPanel filters={defaultFilters} onFilterChange={onFilterChange} />);
    // The 2xx label contains the text "2xx" and is associated with a checkbox
    const label2xx = screen.getByText('2xx').closest('label');
    const checkbox2xx = label2xx?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox2xx).toBeDefined();
    expect(checkbox2xx.checked).toBe(true);
  });

  it('1xx checkbox is unchecked when filters.statusCodes["1xx"] is false', () => {
    const onFilterChange = vi.fn();
    render(<FilterPanel filters={defaultFilters} onFilterChange={onFilterChange} />);
    const label1xx = screen.getByText('1xx').closest('label');
    const checkbox1xx = label1xx?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox1xx).toBeDefined();
    expect(checkbox1xx.checked).toBe(false);
  });

  it('clicking a checkbox triggers onFilterChange', async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(<FilterPanel filters={defaultFilters} onFilterChange={onFilterChange} />);

    const label4xx = screen.getByText('4xx').closest('label');
    const checkbox4xx = label4xx?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await user.click(checkbox4xx);

    expect(onFilterChange).toHaveBeenCalledOnce();
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCodes: expect.objectContaining({ '4xx': true }),
      })
    );
  });
});
