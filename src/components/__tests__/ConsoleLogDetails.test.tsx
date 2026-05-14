import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConsoleLogDetails from '../ConsoleLogDetails';
import type { ConsoleLogEntry } from '../../types/consolelog';

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

    expect(screen.getAllByText('ERROR').length).toBeGreaterThan(0);
    expect(screen.queryByText(/inferred severity:/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('CORS').length).toBeGreaterThan(0);
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

  it('shows analyzer confidence, parser provenance, and parser warnings', () => {
    const baseEntry: ConsoleLogEntry = {
      id: 'entry-3',
      index: 0,
      timestamp: '2026-05-09T17:20:53.443Z',
      level: 'error',
      originalLevel: 'log',
      message: 'JPX Namespace /sitedef does not have a writable MetadataStore',
      source: 'oracle.adf.model.log.Jpx@2240',
      rawText: 'raw JPX event',
      inferredSeverity: 'error',
      issueTags: ['exception'],
      primaryIssue: 'exception',
      classificationReasons: [
        {
          ruleId: 'javascript.exception',
          label: 'JavaScript exception pattern',
          tag: 'exception',
          severity: 'error',
          evidence: 'JPX Namespace /sitedef does not have a writable MetadataStore',
        },
      ],
      parseStatus: 'partial',
      parseFormat: 'generic-level',
      parseConfidence: 'medium',
      parseWarnings: ['Timestamp was not present in the parsed log line.'],
    };

    render(
      <ConsoleLogDetails
        entry={baseEntry}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Analyzer confidence/i)).toBeInTheDocument();
    expect(screen.getByText('MEDIUM')).toBeInTheDocument();
    expect(screen.getByText('Parse status')).toBeInTheDocument();
    expect(screen.getByText('partial')).toBeInTheDocument();
    expect(screen.getByText('Parse format')).toBeInTheDocument();
    expect(screen.getByText('generic-level')).toBeInTheDocument();
    expect(screen.getByText(/Timestamp was not present/i)).toBeInTheDocument();
  });
});
