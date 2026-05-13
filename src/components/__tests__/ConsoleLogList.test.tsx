import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ConsoleLogList from '../ConsoleLogList';

describe('ConsoleLogList', () => {
  function makeEntry(index: number, level: 'log' | 'info' | 'warn' | 'error' = 'log') {
    return {
      id: `entry-${index}`,
      index,
      timestamp: new Date(Date.UTC(2026, 3, 23, 10, 0, 0) - index * 1000).toISOString(),
      level,
      message: `Console message ${index}`,
      source: `source-${index % 5}.js`,
      rawText: `Console message ${index}`,
      inferredSeverity: level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'none',
      issueTags: [],
    };
  }

  it('keeps middle panel filters removed while promoting inferred failures to primary levels', () => {
    const entries = [
      {
        id: 'cors-entry',
        index: 0,
        timestamp: '2026-04-23T10:37:00.000Z',
        level: 'log',
        message:
          "webapp/:1 Access to fetch at 'https://api.example.com/ords/test' has been blocked by CORS policy.",
        source: 'webapp/',
        rawText:
          "webapp/:1 Access to fetch at 'https://api.example.com/ords/test' has been blocked by CORS policy.",
        inferredSeverity: 'error',
        issueTags: ['cors', 'network'],
        primaryIssue: 'cors',
      },
      {
        id: 'react-entry',
        index: 1,
        timestamp: '2026-04-23T10:38:00.000Z',
        level: 'warn',
        message: 'Warning: Encountered two children with the same key, `VB Studio`.',
        source: 'react-dom.development.js',
        rawText: 'Warning: Encountered two children with the same key, `VB Studio`.',
        inferredSeverity: 'warning',
        issueTags: ['react'],
        primaryIssue: 'react',
      },
    ] as any[];

    const { container } = render(
      React.createElement(ConsoleLogList as any, {
        entries,
        groupedEntries: null,
        selectedEntry: null,
        onSelectEntry: vi.fn(),
      }),
    );

    expect(container.querySelector('.request-list-header')).not.toBeNull();
    expect(container.querySelector('.console-quick-focus-bar')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: /console issue quick filters/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^all\s+\d+$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cors\s+\d+$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^network\s+\d+$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^browser policy\s+\d+$/i })).not.toBeInTheDocument();

    const selectAllCheckbox = screen.getByRole('checkbox', { name: /select all/i });
    expect(selectAllCheckbox.closest('label')).toHaveClass('console-select-all-label');
    expect(selectAllCheckbox).toHaveClass('console-select-all-input');

    const corsRow = screen.getByText(/blocked by cors policy/i).closest('.request-item');
    expect(corsRow).toHaveAttribute('data-inferred-severity', 'error');
    expect(within(corsRow as HTMLElement).getByText('ERROR')).toBeInTheDocument();
    expect(within(corsRow as HTMLElement).queryByText('LOG')).not.toBeInTheDocument();
    expect(within(corsRow as HTMLElement).queryByText('Error')).not.toBeInTheDocument();
    expect(within(corsRow as HTMLElement).getByText('CORS')).toBeInTheDocument();
  });

  it('renders only a bounded window for large console logs', () => {
    const entries = Array.from({ length: 2000 }, (_, index) => makeEntry(index));

    const { container } = render(
      React.createElement(ConsoleLogList as any, {
        entries,
        groupedEntries: null,
        selectedEntry: null,
        onSelectEntry: vi.fn(),
      }),
    );

    const renderedRows = container.querySelectorAll('.console-request-list .request-item');
    expect(renderedRows.length).toBeLessThan(100);
  });

  it('keeps grouped headers and visible grouped entries under virtualization', () => {
    const entries = Array.from({ length: 80 }, (_, index) =>
      makeEntry(index, index < 40 ? 'error' : 'warn'),
    );
    const groupedEntries = new Map<string, typeof entries>([
      ['error', entries.slice(0, 40)],
      ['warn', entries.slice(40)],
    ]);

    render(
      React.createElement(ConsoleLogList as any, {
        entries,
        groupedEntries,
        selectedEntry: null,
        onSelectEntry: vi.fn(),
      }),
    );

    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText(/Console message 0/)).toBeInTheDocument();
  });

  it('allows selecting a virtualized visible row', () => {
    const onSelectEntry = vi.fn();
    const entries = Array.from({ length: 200 }, (_, index) => makeEntry(index));

    render(
      React.createElement(ConsoleLogList as any, {
        entries,
        groupedEntries: null,
        selectedEntry: null,
        onSelectEntry,
      }),
    );

    fireEvent.click(screen.getByText('Console message 0'));
    expect(onSelectEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-0' }));
  });
});
