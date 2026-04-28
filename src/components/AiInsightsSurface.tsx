import React, { useRef } from 'react';
import {
  AlertIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  ConsoleIcon,
  FileTextIcon,
  InfoIcon,
  LayersIcon,
  NetworkIcon,
  RefreshIcon,
  RouteIcon,
  ShieldIcon,
} from './Icons';
import { InsightFinding, InsightHealth, InsightsResult } from '../hooks/useInsights';
import './AiInsights.css';

type Tone = 'critical' | 'degraded' | 'warning' | 'healthy' | 'neutral';

interface AiInsightsSurfaceProps {
  insights: InsightsResult | null;
  isGenerating: boolean;
  error: string | null;
  generate: () => void;
  cancel: () => void;
  expanded: Set<string>;
  onToggleCard: (key: string) => void;
  variant: 'har' | 'console';
  loadingMessage: string;
  loadingHint: string;
  emptyDescription: string;
  productsLabel: string;
}

const HEALTH_META: Record<
  InsightHealth,
  {
    label: string;
    tone: Tone;
    description: string;
    Icon: React.FC;
  }
> = {
  critical: {
    label: 'Critical',
    tone: 'critical',
    description: 'Immediate attention recommended.',
    Icon: AlertIcon,
  },
  degraded: {
    label: 'Degraded',
    tone: 'degraded',
    description: 'Stability is impaired in key flows.',
    Icon: ClockIcon,
  },
  warning: {
    label: 'Warning',
    tone: 'warning',
    description: 'Issues are present but not system-wide.',
    Icon: InfoIcon,
  },
  healthy: {
    label: 'Healthy',
    tone: 'healthy',
    description: 'No major risk patterns detected.',
    Icon: CheckIcon,
  },
};

const SEVERITY_META: Record<
  InsightFinding['severity'],
  {
    label: string;
    tone: Tone;
    Icon: React.FC;
  }
> = {
  critical: { label: 'Critical', tone: 'critical', Icon: AlertIcon },
  high: { label: 'High', tone: 'degraded', Icon: AlertIcon },
  medium: { label: 'Medium', tone: 'warning', Icon: ClockIcon },
  low: { label: 'Low', tone: 'healthy', Icon: CheckIcon },
};

const SECTION_META: Record<
  string,
  {
    kind: string;
    label: string;
    railLabel: string;
    Icon: React.FC;
  }
> = {
  critical_issues: {
    kind: 'Critical Issues',
    label: 'Issues that can block or materially degrade the session.',
    railLabel: 'Blocking and degradation risks',
    Icon: AlertIcon,
  },
  performance: {
    kind: 'Performance',
    label: 'Latency, throughput, and efficiency observations.',
    railLabel: 'Latency and efficiency review',
    Icon: ClockIcon,
  },
  security: {
    kind: 'Security',
    label: 'Security posture and hardening observations.',
    railLabel: 'Security posture review',
    Icon: ShieldIcon,
  },
  recommendations: {
    kind: 'Recommendations',
    label: 'Follow-up actions and optimization opportunities.',
    railLabel: 'Follow-up actions',
    Icon: RouteIcon,
  },
};

const SUMMARY_METRIC_META = [
  { key: 'findings', label: 'Findings', note: 'All sections', Icon: LayersIcon },
  { key: 'critical', label: 'Critical', note: 'Prompt attention', Icon: AlertIcon },
  { key: 'sections', label: 'Review Areas', note: 'Grouped coverage', Icon: FileTextIcon },
] as const;

const MODEL_BADGE_LABEL = 'Using OCA gpt-5.4';

function formatContext(finding: InsightFinding) {
  return [finding.product, finding.component].filter(Boolean).join(' / ');
}

function summarizeSection(findings: InsightFinding[]) {
  const counts = findings.reduce<Record<InsightFinding['severity'], number>>(
    (acc, finding) => {
      acc[finding.severity] += 1;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0 }
  );

  return (Object.keys(counts) as InsightFinding['severity'][])
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${SEVERITY_META[severity].label.toLowerCase()}`)
    .join(' | ');
}

function getSourceTitle(variant: 'har' | 'console') {
  return variant === 'har' ? 'Oracle-aware session review' : 'Console log review';
}

function getSourceKicker(variant: 'har' | 'console') {
  return variant === 'har' ? 'AI HAR Review' : 'AI Console Review';
}

function getSourceIcon(variant: 'har' | 'console') {
  return variant === 'har' ? NetworkIcon : ConsoleIcon;
}

function getSectionId(sectionType: string) {
  return `ai-insights-section-${sectionType}`;
}

const AiInsightsSurface: React.FC<AiInsightsSurfaceProps> = ({
  insights,
  isGenerating,
  error,
  generate,
  cancel,
  expanded,
  onToggleCard,
  variant,
  loadingMessage,
  loadingHint,
  emptyDescription,
  productsLabel,
}) => {
  const SourceIcon = getSourceIcon(variant);
  const sourceKicker = getSourceKicker(variant);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  if (isGenerating) {
    return (
      <div className="ai-insights-state ai-insights-loading">
        <div className="ai-insights-state-icon is-animated" aria-hidden="true">
          <SourceIcon />
        </div>
        <div className="ai-insights-state-copy">
          <div className="ai-insights-state-meta">
            <span className="ai-insights-state-kicker">{sourceKicker}</span>
            <span className="ai-insights-model-badge">{MODEL_BADGE_LABEL}</span>
          </div>
          <h2>{loadingMessage}</h2>
          <p>{loadingHint}</p>
        </div>
        <div className="ai-insights-spinner-wrap" aria-hidden="true">
          <div className="ai-insights-spinner" />
          <div className="ai-insights-spinner-ring" />
        </div>
        <button className="ai-insights-cancel-btn" onClick={cancel} type="button">
          Cancel
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ai-insights-state ai-insights-error">
        <div className="ai-insights-state-icon tone-critical" aria-hidden="true">
          <AlertIcon />
        </div>
        <div className="ai-insights-state-copy">
          <div className="ai-insights-state-meta">
            <span className="ai-insights-state-kicker">{sourceKicker}</span>
            <span className="ai-insights-model-badge">{MODEL_BADGE_LABEL}</span>
          </div>
          <h2>Analysis failed</h2>
          <p>{error}</p>
        </div>
        <button className="ai-insights-generate-btn" onClick={generate} type="button">
          <span className="ai-insights-button-icon" aria-hidden="true">
            <RefreshIcon />
          </span>
          <span>Retry analysis</span>
        </button>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="ai-insights-state ai-insights-empty">
        <div className="ai-insights-state-icon tone-accent" aria-hidden="true">
          <SourceIcon />
        </div>
        <div className="ai-insights-state-copy">
          <div className="ai-insights-state-meta">
            <span className="ai-insights-state-kicker">{sourceKicker}</span>
            <span className="ai-insights-model-badge">{MODEL_BADGE_LABEL}</span>
          </div>
          <h2>AI Insights</h2>
          <p>{emptyDescription}</p>
        </div>
        <button className="ai-insights-generate-btn" onClick={generate} type="button">
          <span>Generate AI Insights</span>
        </button>
      </div>
    );
  }

  const health = HEALTH_META[insights.overallHealth] ?? HEALTH_META.warning;
  const totalFindings = insights.sections.reduce(
    (sum, section) => sum + section.findings.length,
    0
  );
  const criticalCount = insights.sections
    .flatMap((section) => section.findings)
    .filter((finding) => finding.severity === 'critical').length;
  const summaryMetrics = {
    findings: totalFindings,
    critical: criticalCount,
    sections: insights.sections.length,
  };
  const HealthIcon = health.Icon;

  const scrollToSection = (sectionType: string) => {
    sectionRefs.current[sectionType]?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  return (
    <div className="ai-insights">
      <div className="ai-insights-dashboard">
        <aside className="ai-insights-rail">
          <div className="ai-insights-rail-stack">
            <section className="ai-insights-rail-card ai-insights-rail-card-health">
              <span className="ai-insights-rail-kicker">
                <span className="ai-insights-rail-kicker-icon" aria-hidden="true">
                  <SourceIcon />
                </span>
                <span>{sourceKicker}</span>
              </span>
              <div className={`ai-insights-health-card tone-${health.tone}`}>
                <span className="ai-insights-health-icon" aria-hidden="true">
                  <span
                    className={`ai-insights-health-icon-glyph${health.tone === 'degraded' ? ' ai-insights-health-icon-glyph--degraded' : ''}`}
                  >
                    <HealthIcon />
                  </span>
                </span>
                <div>
                  <span>Overall health</span>
                  <strong>{health.label}</strong>
                  <small>{health.description}</small>
                </div>
              </div>
            </section>

            {insights.detectedProducts && insights.detectedProducts.length > 0 && (
              <section className="ai-insights-rail-card ai-insights-rail-card-products">
                <div className="ai-insights-rail-head">
                  <strong>{productsLabel}</strong>
                  <span>{insights.detectedProducts.length} product signals detected</span>
                </div>
                <div className="ai-insights-products-list is-rail">
                  {insights.detectedProducts.map((product) => (
                    <span key={product.shortName} className="ai-insights-product-pill">
                      {product.shortName}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section className="ai-insights-rail-card ai-insights-rail-card-summary">
              <div className="ai-insights-rail-head is-compact">
                <strong>Executive summary</strong>
                <span>Top signals</span>
              </div>
              <div className="ai-insights-rail-metrics">
                {SUMMARY_METRIC_META.map(({ key, label, note, Icon }) => (
                  <article key={key} className="ai-insights-metric-card is-rail is-compact">
                    <span className="ai-insights-metric-icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <div className="ai-insights-metric-copy">
                      <span className="ai-insights-metric-label">{label}</span>
                      <strong>{summaryMetrics[key]}</strong>
                      <span className="ai-insights-metric-note">{note}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </aside>

        <div className="ai-insights-main">
          <section className="ai-insights-hero">
            <div className="ai-insights-hero-copy">
              <div className="ai-insights-hero-meta">
                <span className="ai-insights-kicker">
                  <span className="ai-insights-kicker-icon" aria-hidden="true">
                    <SourceIcon />
                  </span>
                  <span>{sourceKicker}</span>
                </span>
                <span className="ai-insights-model-badge">{MODEL_BADGE_LABEL}</span>
              </div>
              <div className="ai-insights-hero-heading">
                <div>
                  <h2>{getSourceTitle(variant)}</h2>
                  <p>{insights.summary}</p>
                </div>
                <button className="ai-insights-regen-btn" onClick={generate} type="button">
                  <span className="ai-insights-button-icon" aria-hidden="true">
                    <RefreshIcon />
                  </span>
                  <span>Regenerate</span>
                </button>
              </div>
            </div>
          </section>

          <div className="ai-insights-sections">
            {insights.sections.map((section) => {
              const meta = SECTION_META[section.type] ?? {
                kind: 'Insights',
                label: 'Grouped findings generated for this review area.',
                railLabel: 'Grouped review area',
                Icon: InfoIcon,
              };
              const SectionIcon = meta.Icon;
              const sectionSummary = summarizeSection(section.findings);

              return (
                <section
                  key={section.type}
                  id={getSectionId(section.type)}
                  ref={(node) => {
                    sectionRefs.current[section.type] = node;
                  }}
                  className="ai-insights-section-card"
                >
                  <div className="ai-insights-section-header">
                    <span className="ai-insights-section-icon" aria-hidden="true">
                      <SectionIcon />
                    </span>
                    <div className="ai-insights-section-copy">
                      <span className="ai-insights-section-kind">{meta.kind}</span>
                      <h3>{section.title || meta.kind}</h3>
                      <p>
                        {meta.label}
                        {sectionSummary ? ` | ${sectionSummary}` : ''}
                      </p>
                    </div>
                    <span className="ai-insights-count">{section.findings.length}</span>
                  </div>

                  <div className="ai-insights-findings">
                    {section.findings.map((finding, index) => {
                      const key = `${section.type}-${index}`;
                      const isOpen = expanded.has(key);
                      const severity = SEVERITY_META[finding.severity];
                      const SeverityIcon = severity.Icon;
                      const context = formatContext(finding);

                      return (
                        <article
                          key={key}
                          className={`ai-finding-card severity-${finding.severity}${isOpen ? ' open' : ''}`}
                        >
                          <button
                            className="ai-finding-trigger"
                            onClick={() => onToggleCard(key)}
                            type="button"
                            aria-expanded={isOpen}
                          >
                            <div className="ai-finding-summary">
                              <div className="ai-finding-summary-main">
                                <div className="ai-finding-summary-meta">
                                  <span className={`ai-finding-sev-badge tone-${severity.tone}`}>
                                    <SeverityIcon />
                                    <span>{severity.label}</span>
                                  </span>
                                  {context && (
                                    <span className="ai-finding-context">{context}</span>
                                  )}
                                </div>
                                <strong className="ai-finding-title">{finding.title}</strong>
                                {!isOpen && <p className="ai-finding-preview">{finding.what}</p>}
                              </div>
                              <span className="ai-finding-chevron" aria-hidden="true">
                                {isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                              </span>
                            </div>
                          </button>

                          {isOpen && (
                            <div className="ai-finding-body">
                              <div className="ai-finding-detail-grid">
                                <div className="ai-finding-detail-card">
                                  <span className="ai-finding-label">What</span>
                                  <p className="ai-finding-value">{finding.what}</p>
                                </div>
                                <div className="ai-finding-detail-card">
                                  <span className="ai-finding-label">Why</span>
                                  <p className="ai-finding-value">{finding.why}</p>
                                </div>
                                <div className="ai-finding-detail-card is-wide">
                                  <span className="ai-finding-label">Evidence</span>
                                  <code className="ai-finding-evidence">{finding.evidence}</code>
                                </div>
                                <div className="ai-finding-detail-card is-wide tone-fix">
                                  <span className="ai-finding-label">Suggestion</span>
                                  <p className="ai-finding-value">{finding.fix}</p>
                                </div>
                                {finding.srGuidance && (
                                  <div className="ai-finding-detail-card is-wide tone-muted">
                                    <span className="ai-finding-label">Operations Handoff</span>
                                    <p className="ai-finding-value">{finding.srGuidance}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        <aside className="ai-insights-jump-rail">
          <div className="ai-insights-jump-rail-stack">
            <section className="ai-insights-rail-card ai-insights-rail-card-jump">
              <div className="ai-insights-rail-head">
                <strong>Jump to section</strong>
                <span>Move through the review quickly</span>
              </div>
              <div className="ai-insights-rail-nav">
                {insights.sections.map((section) => {
                  const meta = SECTION_META[section.type] ?? {
                    kind: 'Insights',
                    label: 'Grouped findings generated for this review area.',
                    railLabel: 'Grouped review area',
                    Icon: InfoIcon,
                  };
                  const SectionIcon = meta.Icon;

                  return (
                    <button
                      key={section.type}
                      className="ai-insights-rail-nav-item"
                      onClick={() => scrollToSection(section.type)}
                      type="button"
                    >
                      <span className="ai-insights-rail-nav-icon" aria-hidden="true">
                        <SectionIcon />
                      </span>
                      <span className="ai-insights-rail-nav-copy">
                        <strong>{meta.kind}</strong>
                        <span>{meta.railLabel}</span>
                      </span>
                      <span className="ai-insights-rail-nav-count">{section.findings.length}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default AiInsightsSurface;
