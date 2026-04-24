import React from 'react';
import { render, screen } from '@testing-library/react';
import PerformanceMetrics from '../PerformanceMetrics';

const sampleMetrics = {
  totalRequests: 42,
  totalSize: 204800,   // 200 KB
  totalTime: 3500,     // 3.5 s
  avgTime: 83,         // 83 ms
  statusCounts: { 2: 35, 4: 5, 5: 2 },
};

describe('PerformanceMetrics', () => {
  it('renders without crashing with a set of metrics', () => {
    render(<PerformanceMetrics metrics={sampleMetrics} />);
    expect(screen.getByText('Performance Overview')).toBeInTheDocument();
  });

  it('displays the total request count', () => {
    render(<PerformanceMetrics metrics={sampleMetrics} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Total Requests')).toBeInTheDocument();
  });

  it('renders without crashing when given zero/empty metrics', () => {
    const emptyMetrics = {
      totalRequests: 0,
      totalSize: 0,
      totalTime: 0,
      avgTime: 0,
      statusCounts: {},
    };
    render(<PerformanceMetrics metrics={emptyMetrics} />);
    expect(screen.getByText('Performance Overview')).toBeInTheDocument();
    // totalRequests of 0 — there will be multiple "0" texts (size, time, avg),
    // so just assert the label is present
    expect(screen.getByText('Total Requests')).toBeInTheDocument();
  });
});
