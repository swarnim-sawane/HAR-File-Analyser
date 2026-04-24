import React from 'react';
import { render, screen, within } from '@testing-library/react';
import AiInsightsSurface from '../AiInsightsSurface';
import type { InsightsResult } from '../../hooks/useInsights';

vi.mock('../Icons', () => {
  const makeIcon = (name: string) => () => <svg data-testid={name} />;

  return {
    AlertIcon: makeIcon('AlertIcon'),
    CheckIcon: makeIcon('CheckIcon'),
    ChevronDownIcon: makeIcon('ChevronDownIcon'),
    ChevronRightIcon: makeIcon('ChevronRightIcon'),
    ClockIcon: makeIcon('ClockIcon'),
    ConsoleIcon: makeIcon('ConsoleIcon'),
    FileTextIcon: makeIcon('FileTextIcon'),
    InfoIcon: makeIcon('InfoIcon'),
    LayersIcon: makeIcon('LayersIcon'),
    NetworkIcon: makeIcon('NetworkIcon'),
    RefreshIcon: makeIcon('RefreshIcon'),
    RouteIcon: makeIcon('RouteIcon'),
    ShieldIcon: makeIcon('ShieldIcon'),
    SparklesIcon: makeIcon('SparklesIcon'),
  };
});

const sampleInsights: InsightsResult = {
  overallHealth: 'warning',
  summary: 'The review surfaced one critical blocker and one recommended follow-up action.',
  detectedProducts: [{ product: 'Oracle Fusion HCM', shortName: 'HCM' }],
  sections: [
    {
      type: 'critical_issues',
      title: 'Blocking requests need attention',
      findings: [
        {
          severity: 'critical',
          title: 'Request chain ends on an error page',
          product: 'Fusion HCM',
          component: 'Login',
          what: 'The flow lands on a server error page after authentication.',
          why: 'Users cannot complete the login journey.',
          evidence: 'GET /login/error.jsp -> 500',
          fix: 'Trace the failing backend dependency and recover the redirect target.',
        },
      ],
    },
    {
      type: 'recommendations',
      title: 'Recommended next steps',
      findings: [
        {
          severity: 'low',
          title: 'Improve request instrumentation',
          product: 'Fusion HCM',
          component: 'Observability',
          what: 'A few slow requests do not include enough context to diagnose easily.',
          why: 'Teams need clearer evidence to prioritize follow-up.',
          evidence: 'Several requests exceed 3s without component-specific markers.',
          fix: 'Add component-level identifiers to the request metadata.',
        },
      ],
    },
  ],
};

const baseProps = {
  error: null,
  generate: vi.fn(),
  cancel: vi.fn(),
  expanded: new Set<string>(),
  onToggleCard: vi.fn(),
  loadingMessage: 'Review in progress',
  loadingHint: 'We are mapping health, findings, and next steps.',
  emptyDescription: 'Generate AI insights to review this session.',
  productsLabel: 'Detected products',
} as const;

const healthExpectations: Array<{
  overallHealth: InsightsResult['overallHealth'];
  expectedIcon: string;
  expectedLabel: string;
  expectsOpticalAlignmentHook: boolean;
}> = [
  { overallHealth: 'warning', expectedIcon: 'InfoIcon', expectedLabel: 'Warning', expectsOpticalAlignmentHook: false },
  { overallHealth: 'critical', expectedIcon: 'AlertIcon', expectedLabel: 'Critical', expectsOpticalAlignmentHook: false },
  { overallHealth: 'degraded', expectedIcon: 'ClockIcon', expectedLabel: 'Degraded', expectsOpticalAlignmentHook: true },
  { overallHealth: 'healthy', expectedIcon: 'CheckIcon', expectedLabel: 'Healthy', expectsOpticalAlignmentHook: false },
];

describe('AiInsightsSurface icon clarity', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'redwood';
    document.documentElement.style.colorScheme = 'light';
  });

  it('uses source-specific and action-oriented icons in the HAR loaded state', () => {
    const { container } = render(
      <AiInsightsSurface
        {...baseProps}
        insights={sampleInsights}
        isGenerating={false}
        variant="har"
      />
    );

    expect(screen.getAllByText('AI HAR Review')).toHaveLength(2);
    expect(screen.getByText(/using oca gpt-5\.4/i)).toBeInTheDocument();

    const railKicker = container.querySelector('.ai-insights-rail-kicker');
    const heroKicker = container.querySelector('.ai-insights-kicker');
    const reviewAreasCard = screen.getByText('Review Areas').closest('.ai-insights-metric-card');
    const recommendationsSection = container.querySelector('#ai-insights-section-recommendations');
    const regenerateButton = screen.getByRole('button', { name: /regenerate/i });

    expect(railKicker).not.toBeNull();
    expect(heroKicker).not.toBeNull();
    expect(reviewAreasCard).not.toBeNull();
    expect(recommendationsSection).not.toBeNull();

    expect(within(railKicker as HTMLElement).getByTestId('NetworkIcon')).toBeInTheDocument();
    expect(within(heroKicker as HTMLElement).getByTestId('NetworkIcon')).toBeInTheDocument();
    expect(within(reviewAreasCard as HTMLElement).getByTestId('FileTextIcon')).toBeInTheDocument();
    expect(within(recommendationsSection as HTMLElement).getByTestId('RouteIcon')).toBeInTheDocument();
    expect(within(regenerateButton).getByTestId('RefreshIcon')).toBeInTheDocument();
    expect(screen.queryByTestId('SparklesIcon')).not.toBeInTheDocument();
  });

  it('uses the console source icon and updated review label while loading', () => {
    const { container } = render(
      <AiInsightsSurface
        {...baseProps}
        insights={null}
        isGenerating
        variant="console"
      />
    );

    const stateIcon = container.querySelector('.ai-insights-state-icon');

    expect(stateIcon).not.toBeNull();
    expect(screen.getByText('AI Console Review')).toBeInTheDocument();
    expect(within(stateIcon as HTMLElement).getByTestId('ConsoleIcon')).toBeInTheDocument();
    expect(screen.queryByTestId('SparklesIcon')).not.toBeInTheDocument();
  });

  it('keeps the generate action text-only while preserving the source icon in the empty state', () => {
    const { container } = render(
      <AiInsightsSurface
        {...baseProps}
        insights={null}
        isGenerating={false}
        variant="har"
      />
    );

    const stateIcon = container.querySelector('.ai-insights-state-icon');
    const generateButton = screen.getByRole('button', { name: /generate ai insights/i });

    expect(stateIcon).not.toBeNull();
    expect(screen.getByText('AI HAR Review')).toBeInTheDocument();
    expect(screen.getByText(/using oca gpt-5\.4/i)).toBeInTheDocument();
    expect(within(stateIcon as HTMLElement).getByTestId('NetworkIcon')).toBeInTheDocument();
    expect(generateButton.querySelector('svg')).toBeNull();
    expect(screen.queryByTestId('SparklesIcon')).not.toBeInTheDocument();
  });

  it.each(healthExpectations)(
    'keeps the %s health icon centered through the dedicated slot markup',
    ({ overallHealth, expectedIcon, expectedLabel, expectsOpticalAlignmentHook }) => {
      const { container } = render(
        <AiInsightsSurface
          {...baseProps}
          insights={{ ...sampleInsights, overallHealth }}
          isGenerating={false}
          variant="console"
        />
      );

      const healthCard = container.querySelector('.ai-insights-health-card');
      const healthIcon = container.querySelector('.ai-insights-health-icon');
      const healthGlyph = container.querySelector('.ai-insights-health-icon-glyph');

      expect(healthCard).not.toBeNull();
      expect(healthIcon).not.toBeNull();
      expect(healthGlyph).not.toBeNull();
      expect(within(healthCard as HTMLElement).getByText('Overall health')).toBeInTheDocument();
      expect(within(healthCard as HTMLElement).getByText(expectedLabel)).toBeInTheDocument();
      expect(within(healthGlyph as HTMLElement).getByTestId(expectedIcon)).toBeInTheDocument();
      expect((healthGlyph as HTMLElement).classList.contains('ai-insights-health-icon-glyph--degraded')).toBe(expectsOpticalAlignmentHook);
    }
  );
});
