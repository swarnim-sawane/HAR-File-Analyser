import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  documentationCta,
  documentationHighlights,
  documentationIntro,
  documentationSections,
} from '../content/documentation';
import {
  ArrowLeftIcon,
  ArrowRightLongIcon,
  CodeIcon,
  ConsoleIcon,
  GlobeIcon,
  NetworkIcon,
  RouteIcon,
  ServerIcon,
  ShieldIcon,
  SparklesIcon,
} from './Icons';

interface DocumentationPageProps {
  onBackToAnalyzer?: () => void;
  onOpenMcpServices?: () => void;
}

const iconMap = {
  console: ConsoleIcon,
  globe: GlobeIcon,
  network: NetworkIcon,
  route: RouteIcon,
  shield: ShieldIcon,
  sparkles: SparklesIcon,
};

const guideGroups = [
  {
    title: 'Start',
    ids: ['what-this-product-is', 'workspace-layout', 'supported-file-types'],
  },
  {
    title: 'Analyze',
    ids: ['visual-analysis-har', 'visual-analysis-logs', 'basic-viewers', 'ai-diagnosis'],
  },
  {
    title: 'Operate',
    ids: ['common-scenarios', 'handoff-quality', 'troubleshooting'],
  },
];

const getHashSectionId = () => window.location.hash.replace(/^#/, '');

const DocumentationPage: React.FC<DocumentationPageProps> = ({ onBackToAnalyzer, onOpenMcpServices }) => {
  const pageRef = useRef<HTMLDivElement>(null);
  const sectionIds = useMemo(() => documentationSections.map((section) => section.id), []);
  const sectionById = useMemo(
    () => new Map(documentationSections.map((section) => [section.id, section])),
    []
  );
  const [activeSectionId, setActiveSectionId] = useState<string | null>(() => {
    const initialHash = getHashSectionId();
    return sectionIds.includes(initialHash) ? initialHash : null;
  });

  const scrollToSection = (sectionId: string, behavior: ScrollBehavior = 'auto') => {
    const element = document.getElementById(sectionId);
    if (!element) return;

    element.scrollIntoView({ behavior, block: 'start' });
  };

  useEffect(() => {
    const syncFromLocation = () => {
      const nextHash = getHashSectionId();

      if (sectionIds.includes(nextHash)) {
        setActiveSectionId(nextHash);
        requestAnimationFrame(() => scrollToSection(nextHash));
        return;
      }

      setActiveSectionId(null);
    };

    syncFromLocation();

    window.addEventListener('hashchange', syncFromLocation);
    window.addEventListener('popstate', syncFromLocation);

    return () => {
      window.removeEventListener('hashchange', syncFromLocation);
      window.removeEventListener('popstate', syncFromLocation);
    };
  }, [sectionIds]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;

    const root = pageRef.current;
    if (!root) return;

    const sections = sectionIds
      .map((sectionId) => document.getElementById(sectionId))
      .filter((section): section is HTMLElement => Boolean(section));

    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));

        if (visibleEntries.length === 0) return;

        const nextActiveId = visibleEntries[0].target.id;
        setActiveSectionId((currentActiveId) =>
          currentActiveId === nextActiveId ? currentActiveId : nextActiveId
        );
      },
      {
        root,
        rootMargin: '-18% 0px -58% 0px',
        threshold: [0.1, 0.35, 0.6],
      }
    );

    sections.forEach((section) => observer.observe(section));

    return () => {
      observer.disconnect();
    };
  }, [sectionIds]);

  const handleNavClick = (event: React.MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    event.preventDefault();

    if (!sectionIds.includes(sectionId)) return;

    setActiveSectionId(sectionId);
    window.history.pushState({}, '', `${window.location.pathname}${window.location.search}#${sectionId}`);
    scrollToSection(sectionId, 'smooth');
  };

  const handleMcpGuideClick = () => {
    if (onOpenMcpServices) {
      onOpenMcpServices();
      return;
    }

    window.history.pushState({}, '', '/docs/mcp');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div ref={pageRef} className="docs-page docs-reference-page">
      <div className="docs-shell docs-reference-shell">
        <section className="docs-index-hero" aria-labelledby="documentation-title">
          <div className="docs-index-hero-copy">
            <p className="docs-eyebrow">{documentationIntro.eyebrow}</p>
            <h1 id="documentation-title">{documentationIntro.title}</h1>
            <p>{documentationIntro.lead}</p>
          </div>
          <div className="docs-index-actions">
            <button type="button" className="docs-primary-button" onClick={handleMcpGuideClick}>
              <ServerIcon />
              <span>MCP Access</span>
            </button>
            {onBackToAnalyzer && (
              <button type="button" className="docs-secondary-button" onClick={onBackToAnalyzer}>
                <ArrowLeftIcon />
                <span>Back to Analyzer</span>
              </button>
            )}
          </div>
        </section>

        <section className="docs-index-overview" aria-label="Documentation overview">
          <article className="docs-index-card docs-index-card--wide">
            <p className="docs-eyebrow">Start here</p>
            <h2>Use the right guide for the job</h2>
            <p>{documentationIntro.note}</p>
            <div className="docs-index-stats">
              {documentationHighlights.map((item) => (
                <span key={item.label}>
                  <strong>{item.label}</strong>
                  {item.value}
                </span>
              ))}
            </div>
          </article>

          <article className="docs-index-card docs-integration-card">
            <p className="docs-eyebrow">Developer integrations</p>
            <h2>MCP Server</h2>
            <p>
              Configure an approved LLM client to call analyzer tools, upload evidence, inspect exact rows,
              ask AI Diagnosis, and open workbench links.
            </p>
            <button type="button" className="docs-link-button" onClick={handleMcpGuideClick}>
              <CodeIcon />
              <span>Open MCP setup</span>
              <ArrowRightLongIcon />
            </button>
          </article>
        </section>

        <section className="docs-guide-index" aria-labelledby="docs-guide-index-title">
          <div className="docs-section-heading">
            <p className="docs-eyebrow">Guides</p>
            <h2 id="docs-guide-index-title">Product documentation</h2>
            <p>Pick the workflow you need, or use the table of contents below for the full reference.</p>
          </div>
          <div className="docs-guide-groups">
            {guideGroups.map((group) => (
              <article key={group.title} className="docs-guide-group">
                <h3>{group.title}</h3>
                <div>
                  {group.ids.map((sectionId) => {
                    const section = sectionById.get(sectionId);
                    if (!section) return null;

                    const Icon = iconMap[section.icon];

                    return (
                      <a
                        key={section.id}
                        href={`#${section.id}`}
                        className="docs-guide-link"
                        onClick={(event) => handleNavClick(event, section.id)}
                      >
                        <Icon />
                        <span>
                          <strong>{section.title}</strong>
                          <small>{section.summary}</small>
                        </span>
                      </a>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="docs-content-shell docs-reference-content">
          <aside className="docs-sidebar" aria-labelledby="docs-nav-title">
            <div className="docs-sidebar-panel">
              <div className="docs-sidebar-head">
                <p className="docs-eyebrow">On This Page</p>
                <h2 id="docs-nav-title">Reference</h2>
              </div>
              <nav className="docs-sidebar-nav" aria-label="Documentation section navigation">
                {documentationSections.map((section, index) => {
                  const isActive = activeSectionId === section.id;

                  return (
                    <a
                      key={section.id}
                      className={`docs-sidebar-link ${isActive ? 'is-active' : ''}`}
                      href={`#${section.id}`}
                      aria-current={isActive ? 'location' : undefined}
                      onClick={(event) => handleNavClick(event, section.id)}
                    >
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <strong>{section.title}</strong>
                    </a>
                  );
                })}
              </nav>
            </div>
          </aside>

          <div className="docs-main-column">
            <div className="docs-sections">
              {documentationSections.map((section, index) => {
                const Icon = iconMap[section.icon];

                return (
                  <section key={section.id} id={section.id} className="docs-section docs-reference-section">
                    <div className="docs-section-header">
                      <div className="docs-section-marker">
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <Icon />
                      </div>
                      <div className="docs-section-copy">
                        <h2>{section.title}</h2>
                        <p>{section.summary}</p>
                      </div>
                    </div>

                    <div className="docs-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.content}</ReactMarkdown>
                    </div>
                  </section>
                );
              })}
            </div>

            <section className="docs-cta" aria-labelledby="docs-cta-title">
              <div>
                <p className="docs-eyebrow">Next Step</p>
                <h2 id="docs-cta-title">{documentationCta.title}</h2>
                <p>{documentationCta.body}</p>
              </div>
              {onBackToAnalyzer && (
                <button type="button" className="docs-primary-button" onClick={onBackToAnalyzer}>
                  <ArrowLeftIcon />
                  <span>Back to Analyzer</span>
                </button>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentationPage;
