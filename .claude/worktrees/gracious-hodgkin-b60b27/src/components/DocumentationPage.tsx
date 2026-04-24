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
  ConsoleIcon,
  GlobeIcon,
  NetworkIcon,
  RouteIcon,
  ShieldIcon,
  SparklesIcon,
} from './Icons';

interface DocumentationPageProps {
  onBackToAnalyzer?: () => void;
}

const iconMap = {
  console: ConsoleIcon,
  globe: GlobeIcon,
  network: NetworkIcon,
  route: RouteIcon,
  shield: ShieldIcon,
  sparkles: SparklesIcon,
};

const getHashSectionId = () => window.location.hash.replace(/^#/, '');

const DocumentationPage: React.FC<DocumentationPageProps> = ({ onBackToAnalyzer }) => {
  const pageRef = useRef<HTMLDivElement>(null);
  const sectionIds = useMemo(() => documentationSections.map((section) => section.id), []);
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

  return (
    <div ref={pageRef} className="docs-page">
      <div className="docs-shell">
        <section className="docs-hero" aria-labelledby="documentation-title">
          <div className="docs-hero-copy">
            <p className="docs-eyebrow">{documentationIntro.eyebrow}</p>
            <h1 id="documentation-title">{documentationIntro.title}</h1>
            <p className="docs-lead">{documentationIntro.lead}</p>
          </div>
          <div className="docs-hero-note">
            <strong>Why this page exists</strong>
            <p>{documentationIntro.note}</p>
          </div>
        </section>

        <section className="docs-highlight-strip" aria-label="Documentation highlights">
          {documentationHighlights.map((item) => (
            <div key={item.label} className="docs-highlight-item">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </section>

        <div className="docs-content-shell">
          <aside className="docs-sidebar" aria-labelledby="docs-nav-title">
            <div className="docs-sidebar-panel">
              <div className="docs-sidebar-head">
                <p className="docs-eyebrow">Quick Links</p>
                <h2 id="docs-nav-title">Jump to section</h2>
                <p className="docs-sidebar-copy">Use this panel to move through the guide without losing your reading position.</p>
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
                  <section key={section.id} id={section.id} className="docs-section">
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
