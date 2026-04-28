import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConsoleLogList from '../ConsoleLogList';

describe('ConsoleLogList', () => {
  it('renders quick focus controls while promoting inferred failures to primary levels', async () => {
    const user = userEvent.setup();
    const onQuickFocusChange = vi.fn();

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
        quickFocus: 'all',
        onQuickFocusChange,
      }),
    );

    expect(container.querySelector('.request-list-header')).not.toBeNull();
    expect(container.querySelector('.console-quick-focus-bar')).toBeNull();

    expect(screen.getByRole('button', { name: /errors/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /warnings/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^cors$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /network/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exceptions/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^react$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /browser policy/i })).toBeInTheDocument();

    const corsRow = screen.getByText(/blocked by cors policy/i).closest('.request-item');
    expect(corsRow).toHaveAttribute('data-inferred-severity', 'error');
    expect(within(corsRow as HTMLElement).getByText('ERROR')).toBeInTheDocument();
    expect(within(corsRow as HTMLElement).queryByText('LOG')).not.toBeInTheDocument();
    expect(within(corsRow as HTMLElement).queryByText('Error')).not.toBeInTheDocument();
    expect(within(corsRow as HTMLElement).getByText('CORS')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^cors$/i }));
    expect(onQuickFocusChange).toHaveBeenCalledWith('cors');
  });
});
