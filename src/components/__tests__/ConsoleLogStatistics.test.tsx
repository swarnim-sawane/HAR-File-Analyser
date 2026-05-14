import React from 'react';
import { render, screen } from '@testing-library/react';
import ConsoleLogStatistics from '../ConsoleLogStatistics';

describe('ConsoleLogStatistics parser health', () => {
  it('shows backend parser health facets for paged logs', () => {
    render(
      <ConsoleLogStatistics
        entries={[]}
        totalEntries={10}
        label="Full-file backend query"
        facets={{
          levelCounts: { error: 2, log: 8 },
          issueTagCounts: { exception: 2 },
          topSources: [{ source: 'console', count: 10 }],
          parseStatusCounts: { parsed: 6, partial: 2, fallback: 2 },
          parseFormatCounts: { 'catalina-iso': 4, fallback: 2 },
          parseWarningCounts: {
            'Unrecognized log format; captured as raw message.': 2,
          },
        }}
      />,
    );

    expect(screen.getByText('Parser Health')).toBeInTheDocument();
    expect(screen.getByText('parsed')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getAllByText('fallback').length).toBeGreaterThan(0);
    expect(screen.getByText('Unrecognized log format; captured as raw message.')).toBeInTheDocument();
  });
});
