import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConsoleLogDetails from '../ConsoleLogDetails';

describe('ConsoleLogDetails', () => {
  it('shows enriched metadata in the restored overview surface', () => {
    render(
      <ConsoleLogDetails
        entry={
          {
            id: 'entry-overview',
            timestamp: '2026-04-23T10:37:00.000Z',
            level: 'log',
            message: 'Access to fetch has been blocked by CORS policy.',
            source: 'webapp/:1',
            rawText: 'Access to fetch has been blocked by CORS policy.',
            inferredSeverity: 'error',
            issueTags: ['cors', 'network'],
            primaryIssue: 'cors',
          } as any
        }
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/inferred severity:/i)).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('CORS')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
  });

  it('shows a raw event tab for the full captured console block', async () => {
    const user = userEvent.setup();

    render(
      <ConsoleLogDetails
        entry={
          {
            id: 'entry-1',
            timestamp: '2026-04-23T10:37:00.000Z',
            level: 'error',
            message: 'TypeError: Failed to fetch',
            rawText: [
              'TypeError: Failed to fetch',
              'Object',
              '    at fetchHandler (/vbsw/private/fetchHandler:1303:12)',
            ].join('\n'),
            stackTrace: '    at fetchHandler (/vbsw/private/fetchHandler:1303:12)',
            inferredSeverity: 'error',
            issueTags: ['exception', 'network'],
            primaryIssue: 'exception',
          } as any
        }
        onClose={vi.fn()}
      />,
    );

    const rawEventTab = screen.getByRole('tab', { name: /raw event/i });
    await user.click(rawEventTab);

    const rawEventBlock = screen.getByText(/typeerror: failed to fetch/i).closest('pre');
    expect(rawEventBlock).toHaveTextContent('Object');
    expect(rawEventBlock).toHaveTextContent(/fetchHandler/i);
  });

  it('copies the full raw event block from copy all', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText,
      },
    });

    render(
      <ConsoleLogDetails
        entry={
          {
            id: 'entry-2',
            timestamp: '2026-04-23T10:37:00.000Z',
            level: 'error',
            message: 'TypeError: Failed to fetch',
            rawText: [
              'TypeError: Failed to fetch',
              'Object',
              '    at fetchHandler (/vbsw/private/fetchHandler:1303:12)',
            ].join('\n'),
            stackTrace: '    at fetchHandler (/vbsw/private/fetchHandler:1303:12)',
            inferredSeverity: 'error',
            issueTags: ['exception', 'network'],
            primaryIssue: 'exception',
          } as any
        }
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /copy all/i }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Object'));
  });
});
