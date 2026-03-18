import React, { useEffect, useState } from 'react';
import { HarFile } from '../types/har';
import { useInsights, InsightFinding, InsightHealth } from '../hooks/useInsights';
import './AiInsights.css';

interface Props {
  harData: HarFile;
  backendUrl: string;
  onGeneratingChange?: (isGenerating: boolean) => void;
}

const HEALTH_META: Record<
  InsightHealth,
  { label: string; tone: 'critical' | 'degraded' | 'warning' | 'healthy' }
> = {
  critical: { label: 'Critical', tone: 'critical' },
  degraded: { label: 'Degraded', tone: 'degraded' },
  warning: { label: 'Warning', tone: 'warning' },
  healthy: { label: 'Healthy', tone: 'healthy' },
};

const SEVERITY_LABELS: Record<InsightFinding['severity'], string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const SECTION_LABELS: Record<string, string> = {
  critical_issues: 'Critical Issues',
  performance: 'Performance',
  security: 'Security',
  recommendations: 'Recommendations',
};

const AiInsights: React.FC<Props> = ({
  harData,
  backendUrl,
  onGeneratingChange,
}) => {
  const { insights, isGenerating, error, generate, cancel } = useInsights(
    harData,
    backendUrl
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    onGeneratingChange?.(isGenerating);
  }, [isGenerating, onGeneratingChange]);

  const toggleCard = (key: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (isGenerating) {
    return (
      <div className="ai-insights-loading">
        <div className="ai-insights-spinner-wrap">
          <div className="ai-insights-spinner" />
          <div className="ai-insights-spinner-ring" />
        </div>
        <p className="ai-insights-stage-msg">OCA is analyzing your HAR file...</p>
        <p className="ai-insights-subtle">This takes 15-30 seconds</p>
        <button className="ai-insights-cancel-btn" onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ai-insights-error">
        <div className="ai-insights-state-icon">!</div>
        <h3>Analysis Failed</h3>
        <p>{error}</p>
        <button className="ai-insights-generate-btn" onClick={generate}>
          Retry
        </button>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="ai-insights-empty">
        <div className="ai-insights-state-icon">AI</div>
        <h2>AI Insights</h2>
        <p>Oracle-aware diagnostics powered by OCA internally.</p>
        <button className="ai-insights-generate-btn" onClick={generate}>
          Generate AI Insights
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

  return (
    <div className="ai-insights">
      <div className="ai-insights-header">
        <span className={`ai-insights-health-badge tone-${health.tone}`}>
          {health.label}
        </span>
        <span className="ai-insights-summary">{insights.summary}</span>
        <div className="ai-insights-meta">
          <span>{totalFindings} findings</span>
          {criticalCount > 0 && (
            <span className="ai-insights-critical-count">{criticalCount} critical</span>
          )}
          <button className="ai-insights-regen-btn" onClick={generate}>
            Regenerate
          </button>
        </div>
      </div>

      {insights.detectedProducts && insights.detectedProducts.length > 0 && (
        <div className="ai-insights-products-row">
          <span className="ai-insights-products-label">Oracle Products:</span>
          {insights.detectedProducts.map((product) => (
            <span key={product.shortName} className="ai-insights-product-pill">
              {product.shortName}
            </span>
          ))}
        </div>
      )}

      <div className="ai-insights-sections">
        {insights.sections.map((section) => (
          <div key={section.type} className="ai-insights-section">
            <div className="ai-insights-section-header">
              <span className="ai-insights-section-kind">
                {SECTION_LABELS[section.type] ?? 'Insights'}
              </span>
              <h3>{section.title || SECTION_LABELS[section.type] || 'Section'}</h3>
              <span className="ai-insights-count">{section.findings.length}</span>
            </div>

            <div className="ai-insights-findings">
              {section.findings.map((finding: InsightFinding, index: number) => {
                const key = `${section.type}-${index}`;
                const isOpen = expanded.has(key);

                return (
                  <div
                    key={key}
                    className={`ai-finding-card severity-${finding.severity}${isOpen ? ' open' : ''}`}
                    onClick={() => toggleCard(key)}
                  >
                    <div className="ai-finding-header">
                      <span className="ai-finding-sev-badge">
                        {SEVERITY_LABELS[finding.severity]}
                      </span>
                      {(finding.product || finding.component) && (
                        <span className="ai-finding-product">
                          {finding.product}
                          {finding.component ? ` | ${finding.component}` : ''}
                        </span>
                      )}
                      <span className="ai-finding-title">{finding.title}</span>
                      <span className="ai-finding-chevron">{isOpen ? '^' : 'v'}</span>
                    </div>

                    {isOpen && (
                      <div className="ai-finding-body">
                        <div className="ai-finding-row">
                          <span className="ai-finding-label">What</span>
                          <span className="ai-finding-value">{finding.what}</span>
                        </div>
                        <div className="ai-finding-row">
                          <span className="ai-finding-label">Why</span>
                          <span className="ai-finding-value">{finding.why}</span>
                        </div>
                        <div className="ai-finding-row">
                          <span className="ai-finding-label">Evidence</span>
                          <span className="ai-finding-value">
                            <code className="ai-finding-evidence">{finding.evidence}</code>
                          </span>
                        </div>
                        <div className="ai-finding-fix-row">
                          <span className="ai-finding-label ai-finding-fix-label">Fix</span>
                          <span className="ai-finding-value ai-finding-fix">
                            {finding.fix}
                          </span>
                        </div>
                        {finding.srGuidance && (
                          <div className="ai-finding-sr-row">
                            <span className="ai-finding-label">SR Data</span>
                            <span className="ai-finding-value ai-finding-sr">
                              {finding.srGuidance}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AiInsights;

