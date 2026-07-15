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
          srGuidance: 'Collect access logs and diagnostic bundles for the operations team.',
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
    expect(screen.getByText(/ai-assisted review/i)).toBeInTheDocument();

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
    expect(screen.getByText(/ai-assisted review/i)).toBeInTheDocument();
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

  it('labels actionable guidance as suggestions and ops handoff content', () => {
    render(
      <AiInsightsSurface
        {...baseProps}
        insights={sampleInsights}
        isGenerating={false}
        variant="har"
        expanded={new Set(['critical_issues-0'])}
      />
    );

    expect(screen.getByText('Suggestion')).toBeInTheDocument();
    expect(screen.getByText('Operations Handoff')).toBeInTheDocument();
    expect(screen.queryByText('Fix')).not.toBeInTheDocument();
    expect(screen.queryByText('SR Data')).not.toBeInTheDocument();
  });

  it('shows a source-specific completed fallback when console insights have no findings', () => {
    render(
      <AiInsightsSurface
        {...baseProps}
        insights={{
          overallHealth: 'warning',
          summary:
            'No high-confidence, evidence-backed console findings were identified in the analyzed log context.',
          sections: [],
          detectedProducts: [{ product: 'Visual Builder Cloud Service', shortName: 'VBCS' }],
        }}
        isGenerating={false}
        variant="console"
      />
    );

    expect(screen.getByText('No high-confidence console findings')).toBeInTheDocument();
    expect(screen.getByText(/log was parsed/i)).toBeInTheDocument();
    expect(screen.getByText(/generic or unsupported ai statements/i)).toBeInTheDocument();
    expect(screen.getByText('VBCS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();

    expect(screen.queryByText('Overall health')).not.toBeInTheDocument();
    expect(screen.queryByText('Jump to section')).not.toBeInTheDocument();
    expect(screen.queryByText('Review Areas')).not.toBeInTheDocument();
    expect(screen.queryByText(/HAR context/i)).not.toBeInTheDocument();
  });

  it('shows analyzer evidence instead of no-findings wording when empty AI results still have log signals', () => {
    render(
      <AiInsightsSurface
        {...baseProps}
        insights={{
          overallHealth: 'warning',
          summary:
            'No high-confidence, evidence-backed console findings were identified in the analyzed log context.',
          sections: [],
        }}
        isGenerating={false}
        variant="console"
        observedSignals={{
          errorCount: 12,
          warningCount: 4,
          topIssueTags: [{ tag: 'exception', count: 12 }],
          topRepeatedSignal: {
            count: 12,
            source: 'oracle.adf.model.log.Jpx@2240',
            message:
              'JPX Namespace /sitedef does not have a writable MetadataStore, forcing mMergedJpxPersisted to DISABLE',
          },
        }}
      />
    );

    expect(screen.getByText('Analyzer signals found')).toBeInTheDocument();
    expect(screen.getByText(/AI did not produce a validated root cause/i)).toBeInTheDocument();
    expect(screen.getByText('12 errors')).toBeInTheDocument();
    expect(screen.getByText('4 warnings')).toBeInTheDocument();
    expect(screen.getByText(/oracle\.adf\.model\.log\.Jpx@2240/i)).toBeInTheDocument();
    expect(screen.getByText(/writable MetadataStore/i)).toBeInTheDocument();
    expect(screen.queryByText('No high-confidence console findings')).not.toBeInTheDocument();
  });

  it('renders analyzer evidence as its own section instead of a critical issue label', () => {
    render(
      <AiInsightsSurface
        {...baseProps}
        insights={{
          overallHealth: 'warning',
          summary: 'Repeated server-side analyzer evidence was found.',
          sections: [
            {
              type: 'analyzer_evidence',
              title: 'Analyzer Evidence',
              findings: [
                {
                  severity: 'medium',
                  title: 'Repeated ADF metadata-store error signal',
                  product: 'Visual Builder',
                  component: 'ADF metadata store',
                  what: 'The analyzer found 3022 server error signals.',
                  why: 'This is analyzer evidence, not an AI-confirmed root cause.',
                  evidence: 'JPX Namespace /sitedef does not have a writable MetadataStore',
                  fix: 'Review the metadata-store configuration and surrounding server logs.',
                },
              ],
            },
          ],
        }}
        isGenerating={false}
        variant="console"
      />,
    );

    expect(screen.getAllByText('Analyzer Evidence').length).toBeGreaterThan(0);
    expect(screen.getByText(/3022 server error signals/i)).toBeInTheDocument();
    expect(screen.queryByText('Critical Issues')).not.toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
