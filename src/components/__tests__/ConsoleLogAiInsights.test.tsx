import React from 'react';
import { render, screen } from '@testing-library/react';
import ConsoleLogAiInsights from '../ConsoleLogAiInsights';
import type { ConsoleLogFile } from '../../types/consolelog';

const captured = vi.hoisted(() => ({
  surfaceProps: null as null | { emptyDescription: string },
}));

vi.mock('../../hooks/useConsoleLogInsights', () => ({
  useConsoleLogInsights: vi.fn(() => ({
    insights: null,
    isGenerating: false,
    error: null,
    generate: vi.fn(),
    cancel: vi.fn(),
  })),
}));

vi.mock('../AiInsightsSurface', () => ({
  default: (props: { emptyDescription: string }) => {
    captured.surfaceProps = props;
    return <div data-testid="ai-insights-surface">{props.emptyDescription}</div>;
  },
}));

const logData: ConsoleLogFile = {
  metadata: {
    fileName: 'console.log',
    uploadedAt: '2026-04-28T00:00:00.000Z',
    totalEntries: 0,
  },
  entries: [],
};

describe('ConsoleLogAiInsights', () => {
  beforeEach(() => {
    captured.surfaceProps = null;
  });

  it('describes empty-state guidance as suggested next steps instead of fixes', () => {
    render(<ConsoleLogAiInsights logData={logData} backendUrl="http://localhost:4000" />);

    expect(screen.getByTestId('ai-insights-surface')).toHaveTextContent('suggested next steps');
    expect(captured.surfaceProps?.emptyDescription).not.toMatch(/fix/i);
  });
});
