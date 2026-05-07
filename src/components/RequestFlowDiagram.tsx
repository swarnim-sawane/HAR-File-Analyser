import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Entry, FilterOptions } from '../types/har';
import { TYPE_COLOR } from '../utils/requestFlowAnalyzer';
import { analyzeJourney } from '../utils/requestJourneyAnalyzer';
import type { JourneyIssue, JourneyPhase, JourneyRequest } from '../utils/requestJourneyAnalyzer';
import type { RequestFlowFocusMode } from '../types/requestFlow';
import {
  getVisibleRequestIndexes,
  requestMatchesFlowFocus,
} from '../utils/requestFlowFilters';
import {
  AlertIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CodeIcon,
  FileIcon,
  FileTextIcon,
  FlameIcon,
  GlobeIcon,
  ImageIcon,
  InfoIcon,
  LayersIcon,
  NetworkIcon,
  PackageIcon,
  SearchIcon,
  SparklesIcon,
} from './Icons';

interface RequestFlowDiagramProps {
  entries: Entry[];
  visibleEntries?: Entry[];
  filters?: FilterOptions;
  onFiltersChange?: (filters: Partial<FilterOptions>) => void;
  focusMode?: RequestFlowFocusMode;
  onFocusModeChange?: (mode: RequestFlowFocusMode) => void;
  onNodeClick?: (entry: Entry) => void;
}

type PhaseTone = 'danger' | 'warning' | 'info' | 'ok';
type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

const ALL_TYPES = ['document', 'script', 'xhr', 'stylesheet', 'image', 'font', 'other'] as const;

const DEFAULT_FILTERS: FilterOptions = {
  statusCodes: {
    '0': false,
    '1xx': false,
    '2xx': true,
    '3xx': true,
    '4xx': true,
    '5xx': true,
  },
  searchTerm: '',
  timingType: 'relative',
};

const STATUS_FILTERS: Array<{ code: keyof FilterOptions['statusCodes']; label: string }> = [
  { code: '0', label: '0' },
  { code: '1xx', label: '1xx' },
  { code: '2xx', label: '2xx' },
  { code: '3xx', label: '3xx' },
  { code: '4xx', label: '4xx' },
  { code: '5xx', label: '5xx' },
];

const TYPE_LABEL: Record<string, string> = {
  document: 'Document',
  script: 'Script',
  xhr: 'XHR',
  stylesheet: 'Stylesheet',
  image: 'Image',
  font: 'Font',
  other: 'Other',
};

const PHASE_ACCENT: Record<PhaseTone, string> = {
  danger: '#ef4444',
  warning: '#f59e0b',
  info: '#5b8def',
  ok: '#10b981',
};

function formatTime(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
  return `${Math.round(ms)}ms`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${bytes} B`;
}

function getPathLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || '/'}${parsed.search || ''}`;
  } catch {
    return url;
  }
}

function getStatusTone(status: number): StatusTone {
  if (status === 0) return 'neutral';
  if (status < 300) return 'success';
  if (status < 400) return 'warning';
  return 'danger';
}

function getStatusColor(status: number): string {
  if (status === 0) return '#94a3b8';
  if (status < 300) return '#10b981';
  if (status < 400) return '#f59e0b';
  return '#ef4444';
}

function getTimeBarColor(ms: number): string {
  if (ms > 5000) return '#ef4444';
  if (ms > 2000) return '#f59e0b';
  if (ms > 1000) return '#fbbf24';
  return '#5b8def';
}

function getTypeIcon(type: string): React.ReactNode {
  switch (type) {
    case 'document':
      return <FileTextIcon />;
    case 'script':
      return <CodeIcon />;
    case 'xhr':
    case 'fetch':
      return <NetworkIcon />;
    case 'stylesheet':
      return <LayersIcon />;
    case 'image':
      return <ImageIcon />;
    case 'font':
      return <FileIcon />;
    default:
      return <PackageIcon />;
  }
}

function getFilterIcon(mode: RequestFlowFocusMode): React.ReactNode {
  if (mode === 'errors') return <AlertIcon />;
  if (mode === 'slow') return <FlameIcon />;
  return <SparklesIcon />;
}

function getPhaseTone(phase: JourneyPhase): PhaseTone {
  if (phase.stats.errorCount > 0) return 'danger';
  if (phase.stats.status0Count > 0 || phase.stats.slowCount > 0) return 'warning';
  if (phase.kind === 'persistent' || phase.issues.some((issue) => issue.level === 'info')) return 'info';
  return 'ok';
}

function getTopIssue(phase: JourneyPhase): JourneyIssue | null {
  return (
    phase.issues.find((issue) => issue.level === 'danger') ||
    phase.issues.find((issue) => issue.level === 'warning') ||
    phase.issues.find((issue) => issue.level === 'info') ||
    null
  );
}

function formatPhaseRange(phase: JourneyPhase): string {
  return `+${formatTime(phase.startMs)} - +${formatTime(phase.endMs)}`;
}

function formatConfidence(confidence: JourneyPhase['confidence']): string {
  return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence`;
}

function compactDomainLabel(domain: string): string {
  if (/identity\.oraclecloud\.com/i.test(domain)) return 'IDCS';
  if (/login\.oci\.oraclecloud\.com/i.test(domain)) return 'login.oci';
  if (/static\.oracle\.com/i.test(domain)) return 'static.oracle';
  if (/consent\.truste\.com/i.test(domain)) return 'consent.truste';
  if (/oracleoutsourcing\.com/i.test(domain)) return 'App host';
  return domain;
}

function getPrimaryDomainLabel(phase: JourneyPhase): string {
  const labels = Array.from(new Set(phase.domains.map(compactDomainLabel)));
  if (labels.length === 0) return 'Unknown domain';
  if (labels.length === 1) return labels[0];
  return labels.slice(0, 2).join(' + ');
}

function getPhaseSignal(phase: JourneyPhase): string {
  const logout404 = phase.issues.find((issue) => /logout endpoint returned 404/i.test(issue.title));
  if (logout404) return '404 logout';
  if (phase.stats.errorCount > 0) return `${phase.stats.errorCount} error${phase.stats.errorCount === 1 ? '' : 's'}`;
  if (phase.stats.status0Count > 0) return `${phase.stats.status0Count} cancelled`;
  if (phase.kind === 'callback') return 'callback';
  if (phase.kind === 'persistent') return 'keeps open';
  if (phase.kind === 'static' && phase.stats.bytes > 0) return formatBytes(phase.stats.bytes);
  if (phase.stats.redirectCount > 0) return 'redirect';
  return `${phase.stats.requestCount} req`;
}

function getPhaseStoryLabel(phase: JourneyPhase, nextPhase?: JourneyPhase): string {
  const domainLabel = getPrimaryDomainLabel(phase);
  const nextDomainLabel = nextPhase ? getPrimaryDomainLabel(nextPhase) : '';
  const signal = getPhaseSignal(phase);

  if (phase.kind === 'initial' && nextDomainLabel) return `${domainLabel} -> ${nextDomainLabel}`;
  return `${domainLabel} | ${signal}`;
}

function getConnectorLabel(currentPhase: JourneyPhase, nextPhase: JourneyPhase): string {
  if (nextPhase.kind === 'auth') return 'redirect';
  if (nextPhase.kind === 'callback') return 'callback';
  if (nextPhase.kind === 'app-boot') return 'returns';
  if (nextPhase.kind === 'static') return 'loads assets';
  if (nextPhase.kind === 'persistent') return 'keeps open';
  if (nextPhase.kind === 'logout') return 'logout';
  if (nextPhase.kind === 'consent') return 'background';
  if (currentPhase.stats.redirectCount > 0) return 'redirect';
  return 'then';
}

const SummaryPill: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'neutral' | 'warning';
}> = ({ icon, label, value, tone = 'neutral' }) => (
  <div className={`request-flow-summary-pill tone-${tone}`}>
    <span className="request-flow-summary-pill-icon" aria-hidden="true">{icon}</span>
    <div className="request-flow-summary-pill-copy">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  </div>
);

const ViewChip: React.FC<{
  mode: RequestFlowFocusMode;
  active: boolean;
  onClick: () => void;
}> = ({ mode, active, onClick }) => (
  <button
    type="button"
    className={`request-flow-view-chip ${active ? 'is-active' : ''}`}
    onClick={onClick}
  >
    <span className="request-flow-view-chip-icon" aria-hidden="true">{getFilterIcon(mode)}</span>
    <span>{mode === 'all' ? 'All' : mode === 'errors' ? 'Errors' : 'Slow'}</span>
  </button>
);

const TypePill: React.FC<{
  type: string;
  active: boolean;
  onClick: () => void;
}> = ({ type, active, onClick }) => {
  const accent = TYPE_COLOR[type] ?? TYPE_COLOR.other;

  return (
    <button
      type="button"
      className={`request-flow-type-pill ${active ? 'is-active' : ''}`}
      style={{ ['--type-accent' as string]: accent } as React.CSSProperties}
      onClick={onClick}
    >
      <span className="request-flow-type-pill-icon" aria-hidden="true">{getTypeIcon(type)}</span>
      <span>{TYPE_LABEL[type] ?? type}</span>
    </button>
  );
};

const RequestRow: React.FC<{
  request: JourneyRequest;
  maxTime: number;
  onClick: () => void;
}> = ({ request, maxTime, onClick }) => {
  const statusTone = getStatusTone(request.status);
  const statusColor = getStatusColor(request.status);
  const typeAccent = TYPE_COLOR[request.type] ?? TYPE_COLOR.other;
  const barColor = getTimeBarColor(request.time);
  const barPct = Math.max(6, Math.min(100, (request.time / Math.max(maxTime, 1)) * 100));

  return (
    <button
      type="button"
      className={`request-flow-request-row tone-${statusTone} ${request.isSlow ? 'is-slow' : ''} ${request.failed ? 'is-error' : ''} ${request.status0Warning ? 'is-warning' : ''} ${request.isPersistent ? 'is-persistent' : ''}`}
      title={request.url}
      onClick={onClick}
      style={{
        ['--request-bar-width' as string]: `${barPct}%`,
        ['--request-bar-color' as string]: barColor,
        ['--request-status-color' as string]: statusColor,
        ['--request-type-color' as string]: typeAccent,
      } as React.CSSProperties}
    >
      <div className="request-flow-request-copy">
        <div className="request-flow-request-head">
          <span className="request-flow-request-method">{request.method}</span>
          <span className={`request-flow-request-status tone-${statusTone}`}>{request.status}</span>
          <span className="request-flow-request-path">{getPathLabel(request.url)}</span>
        </div>
        <div className="request-flow-request-subcopy">
          <span className="request-flow-request-type">
            <span className="request-flow-request-type-icon" aria-hidden="true">{getTypeIcon(request.type)}</span>
            <span>{TYPE_LABEL[request.type] ?? request.type}</span>
          </span>
          <span className="request-flow-request-start">+{formatTime(request.startMs)}</span>
          <span className="request-flow-request-domain">{request.domainLabel}</span>
          {request.redirectTarget && <span className="request-flow-request-redirect">Redirect</span>}
          {request.status0Warning && <span className="request-flow-request-redirect">Cancelled</span>}
          {request.isPersistent && <span className="request-flow-request-redirect">Persistent</span>}
          {request.size > 0 && <span className="request-flow-request-bytes">{formatBytes(request.size)}</span>}
        </div>
      </div>

      <div className="request-flow-request-side">
        <div className="request-flow-request-bar" aria-hidden="true">
          <div className="request-flow-request-bar-fill" />
        </div>
        <span className="request-flow-request-time">{formatTime(request.time)}</span>
        {request.isSlow && (
          <span className="request-flow-request-flag" aria-hidden="true">
            <FlameIcon />
          </span>
        )}
      </div>
    </button>
  );
};

const PhaseCard: React.FC<{
  phase: JourneyPhase;
  maxTime: number;
  visibleTypes: Set<string>;
  visibleRequestIndexes: Set<number> | null;
  filterMode: RequestFlowFocusMode;
  revealed: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onReveal: () => void;
  onRequestClick: (index: number) => void;
  index: number;
}> = ({
  phase,
  maxTime,
  visibleTypes,
  visibleRequestIndexes,
  filterMode,
  revealed,
  collapsed,
  onToggle,
  onReveal,
  onRequestClick,
  index,
}) => {
  const tone = getPhaseTone(phase);
  const topIssue = getTopIssue(phase);
  const titleId = `${phase.id}-title`;
  const visibleRequests = phase.requests.filter((request) => {
    if (visibleRequestIndexes && !visibleRequestIndexes.has(request.index)) return false;
    if (!visibleTypes.has(request.type)) return false;
    return requestMatchesFlowFocus(request, filterMode);
  });
  const hiddenByFilters = visibleRequests.length === 0 && phase.requests.length > 0 && !revealed;
  const requestsToRender = revealed ? phase.requests : visibleRequests;
  const hiddenRequestCopy = `${phase.requests.length} request${phase.requests.length === 1 ? '' : 's'} in this phase ${phase.requests.length === 1 ? 'is' : 'are'} hidden by current filters.`;

  return (
    <article
      className={`request-flow-phase-card tone-${tone} ${collapsed ? 'is-collapsed' : ''}`}
      aria-labelledby={titleId}
      style={{
        ['--phase-accent' as string]: PHASE_ACCENT[tone],
        ['--flow-delay' as string]: `${index * 45}ms`,
      } as React.CSSProperties}
    >
      <div className="request-flow-phase-marker" aria-hidden="true">
        <span className="request-flow-phase-marker-dot">{index + 1}</span>
      </div>

      <button
        type="button"
        className="request-flow-phase-header"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <div className="request-flow-phase-heading">
          <div className="request-flow-phase-title-row">
            <strong id={titleId}>{phase.title}</strong>
            <span className={`request-flow-phase-state tone-${tone}`}>
              {tone === 'ok' ? <CheckIcon /> : tone === 'danger' ? <AlertIcon /> : tone === 'warning' ? <FlameIcon /> : <InfoIcon />}
              <span>{tone === 'ok' ? 'No issue' : tone === 'danger' ? 'Action needed' : tone === 'warning' ? 'Review' : 'Context'}</span>
            </span>
          </div>

          <div className="request-flow-phase-meta">
            <span>{formatPhaseRange(phase)}</span>
            <span>{formatTime(phase.durationMs)}</span>
            <span>{formatConfidence(phase.confidence)}</span>
          </div>
        </div>

        <span className="request-flow-phase-chevron" aria-hidden="true">
          {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
        </span>
      </button>

      <div className="request-flow-phase-summary-row">
        <p>{phase.summary}</p>

        <div className={`request-flow-phase-issue tone-${topIssue?.level ?? 'ok'}`}>
          {topIssue ? (
            <>
              {topIssue.level === 'danger' ? <AlertIcon /> : topIssue.level === 'warning' ? <FlameIcon /> : <InfoIcon />}
              <span>{topIssue.title}</span>
            </>
          ) : (
            <>
              <CheckIcon />
              <span>No actionable issue in this phase</span>
            </>
          )}
        </div>
      </div>

      <div className="request-flow-phase-domain-list" aria-label={`${phase.title} domains`}>
        {phase.domains.slice(0, 5).map((domain) => (
          <span key={domain} className="request-flow-phase-domain-chip" title={domain}>
            {domain}
          </span>
        ))}
        {phase.domains.length > 5 && (
          <span className="request-flow-phase-domain-chip">+{phase.domains.length - 5}</span>
        )}
      </div>

      <div className="request-flow-phase-stats" aria-label={`${phase.title} metrics`}>
        <span><strong>{phase.stats.requestCount}</strong> req</span>
        <span><strong>{phase.stats.redirectCount}</strong> redirects</span>
        <span><strong>{phase.stats.errorCount}</strong> errors</span>
        <span><strong>{phase.stats.status0Count}</strong> cancelled</span>
        <span><strong>{formatBytes(phase.stats.bytes)}</strong></span>
      </div>

      {!collapsed && (
        <div className={`request-flow-phase-body ${hiddenByFilters ? 'is-filter-hidden' : ''}`}>
          {hiddenByFilters ? (
            <div className="request-flow-phase-empty request-flow-phase-empty--filters">
              <InfoIcon />
              <span>{hiddenRequestCopy}</span>
              <button
                type="button"
                className="request-flow-phase-reveal-button"
                aria-label={`Show ${phase.title} requests`}
                onClick={onReveal}
              >
                Show phase requests
              </button>
            </div>
          ) : requestsToRender.length === 0 ? (
            <div className="request-flow-phase-empty">
              <InfoIcon />
              <span>No request evidence is available for this phase.</span>
            </div>
          ) : (
            requestsToRender.map((request) => (
              <RequestRow
                key={`${request.index}-${request.url}-${request.startMs}`}
                request={request}
                maxTime={maxTime}
                onClick={() => onRequestClick(request.index)}
              />
            ))
          )}
        </div>
      )}
    </article>
  );
};

const PhaseOverview: React.FC<{
  phases: JourneyPhase[];
  activePhaseId: string | null;
  onPhaseSelect: (phaseId: string) => void;
}> = ({ phases, activePhaseId, onPhaseSelect }) => (
  <nav className="request-flow-phase-overview" aria-label="Journey phase overview">
    <div className="request-flow-phase-overview-track">
      {phases.map((phase, index) => {
        const tone = getPhaseTone(phase);
        const nextPhase = phases[index + 1];
        const storyText = getPhaseStoryLabel(phase, nextPhase);

        return (
          <React.Fragment key={phase.id}>
            <button
              type="button"
              className={`request-flow-phase-overview-step tone-${tone} ${activePhaseId === phase.id ? 'is-active' : ''}`}
              aria-label={`Go to ${phase.title} phase`}
              aria-current={activePhaseId === phase.id ? 'step' : undefined}
              onClick={() => onPhaseSelect(phase.id)}
            >
              <span className="request-flow-phase-overview-index" aria-hidden="true">{index + 1}</span>
              <span className="request-flow-phase-overview-copy">
                <strong>{phase.title}</strong>
                <span>{storyText}</span>
              </span>
            </button>

            {index < phases.length - 1 && (
              <span className="request-flow-phase-overview-connector" aria-hidden="true">
                <span>{getConnectorLabel(phase, phases[index + 1])}</span>
              </span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  </nav>
);

const RequestFlowDiagram: React.FC<RequestFlowDiagramProps> = ({
  entries,
  visibleEntries,
  filters,
  onFiltersChange,
  focusMode: controlledFocusMode,
  onFocusModeChange,
  onNodeClick,
}) => {
  const searchInputId = useId();
  const filterPanelId = useId();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const phaseRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const journeyData = useMemo(() => analyzeJourney(entries), [entries]);
  const { phases, totalMs } = journeyData;
  const phaseIds = useMemo(() => phases.map((phase) => phase.id), [phases]);
  const maxRequestTime = useMemo(
    () => Math.max(1, ...phases.flatMap((phase) => phase.requests.map((request) => request.time))),
    [phases]
  );
  const visibleRequestIndexes = useMemo(
    () => getVisibleRequestIndexes(entries, visibleEntries),
    [entries, visibleEntries]
  );

  const [localFocusMode, setLocalFocusMode] = useState<RequestFlowFocusMode>('all');
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set(ALL_TYPES));
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [revealedPhaseIds, setRevealedPhaseIds] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activePhaseId, setActivePhaseId] = useState<string | null>(phaseIds[0] ?? null);
  const focusMode = controlledFocusMode ?? localFocusMode;
  const activeFilters = filters ?? DEFAULT_FILTERS;
  const allCollapsed = phases.length > 0 && collapsedPhases.size === phases.length;
  const attentionCount = phases.reduce(
    (count, phase) => count + phase.issues.filter((issue) => issue.level !== 'info').length,
    0
  );
  const focusedRequestCount = useMemo(
    () =>
      phases.reduce((count, phase) => {
        const matchingRequests = phase.requests.filter((request) => {
          if (visibleRequestIndexes && !visibleRequestIndexes.has(request.index)) return false;
          if (!visibleTypes.has(request.type)) return false;
          return requestMatchesFlowFocus(request, focusMode);
        });

        return count + matchingRequests.length;
      }, 0),
    [focusMode, phases, visibleRequestIndexes, visibleTypes]
  );

  useEffect(() => {
    setActivePhaseId((current) => (current && phaseIds.includes(current) ? current : phaseIds[0] ?? null));
    setRevealedPhaseIds((current) => {
      const next = new Set(Array.from(current).filter((phaseId) => phaseIds.includes(phaseId)));
      return next.size === current.size ? current : next;
    });
  }, [phaseIds]);

  useEffect(() => {
    const root = stageRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const phaseId = visibleEntry?.target.getAttribute('data-phase-id');

        if (phaseId) setActivePhaseId(phaseId);
      },
      {
        root,
        threshold: [0.24, 0.42, 0.68],
      }
    );

    phaseIds.forEach((phaseId) => {
      const element = phaseRefs.current.get(phaseId);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [phaseIds]);

  function toggleType(type: string) {
    setVisibleTypes((current) => {
      const next = new Set(current);
      if (next.has(type) && next.size > 1) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  function handleFocusModeChange(mode: RequestFlowFocusMode) {
    if (onFocusModeChange) {
      onFocusModeChange(mode);
      return;
    }

    setLocalFocusMode(mode);
  }

  function toggleFilters() {
    setFiltersOpen((current) => !current);
  }

  const handleStatusCodeChange = useCallback(
    (code: keyof FilterOptions['statusCodes']) => {
      onFiltersChange?.({
        statusCodes: {
          ...activeFilters.statusCodes,
          [code]: !activeFilters.statusCodes[code],
        },
      });
    },
    [activeFilters.statusCodes, onFiltersChange]
  );

  const handleSearchTermChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onFiltersChange?.({ searchTerm: event.target.value });
    },
    [onFiltersChange]
  );

  function toggleCollapseAll() {
    if (allCollapsed) {
      setCollapsedPhases(new Set());
      return;
    }

    setCollapsedPhases(new Set(phases.map((phase) => phase.id)));
  }

  function togglePhase(phaseId: string) {
    setCollapsedPhases((current) => {
      const next = new Set(current);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  }

  function revealPhaseRequests(phaseId: string) {
    setRevealedPhaseIds((current) => {
      if (current.has(phaseId)) return current;
      const next = new Set(current);
      next.add(phaseId);
      return next;
    });
  }

  function handleRequestClick(index: number) {
    if (onNodeClick && entries[index]) onNodeClick(entries[index]);
  }

  function registerPhaseElement(phaseId: string, element: HTMLDivElement | null) {
    if (element) {
      phaseRefs.current.set(phaseId, element);
      return;
    }

    phaseRefs.current.delete(phaseId);
  }

  function handlePhaseOverviewSelect(phaseId: string) {
    setActivePhaseId(phaseId);
    phaseRefs.current.get(phaseId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (entries.length === 0) {
    return (
      <div className="request-flow-empty-state">
        <div className="request-flow-empty-icon" aria-hidden="true">
          <GlobeIcon />
        </div>
        <strong>No requests to display</strong>
        <span>Load a HAR trace to explore the journey across domains and request groups.</span>
      </div>
    );
  }

  return (
    <section className="request-flow-shell">
      <header className="request-flow-toolbar">
        <div className="request-flow-toolbar-inner">
          <div className="request-flow-toolbar-top">
            <div className="request-flow-summary">
              <h3>Cross domain journey</h3>
            </div>

            <div className="request-flow-summary-grid">
              <SummaryPill icon={<GlobeIcon />} label="Domains" value={`${journeyData.domainCount}`} />
              <SummaryPill icon={<NetworkIcon />} label="Requests" value={`${journeyData.requestCount}`} />
              <SummaryPill icon={<ClockIcon />} label="Session" value={totalMs > 0 ? formatTime(totalMs) : '0ms'} />
              <SummaryPill icon={<AlertIcon />} label="Issues" value={`${attentionCount}`} tone={attentionCount > 0 ? 'warning' : 'neutral'} />
            </div>
          </div>

          <div className={`request-flow-controls request-flow-filter-panel ${filtersOpen ? 'is-open' : 'is-collapsed'}`}>
            <div className="request-flow-filter-panel-header">
              <div className="request-flow-filter-panel-title-group">
                <span className="request-flow-control-label">Request Filters</span>
                <span className="request-flow-filter-panel-count">
                  Focused <strong>{focusedRequestCount}</strong> / <strong>{journeyData.requestCount}</strong>
                </span>
              </div>

              <div className="request-flow-filter-panel-actions">
                <button
                  type="button"
                  className={`request-flow-filter-toggle-button ${filtersOpen ? 'is-active' : ''}`}
                  aria-controls={filterPanelId}
                  aria-expanded={filtersOpen}
                  aria-label={filtersOpen ? 'Hide request filters' : 'Show request filters'}
                  onClick={toggleFilters}
                >
                  <span aria-hidden="true"><LayersIcon /></span>
                  <span>Filters</span>
                </button>

                <button type="button" className="request-flow-collapse-button" onClick={toggleCollapseAll}>
                  <span aria-hidden="true">{allCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}</span>
                  <span>{allCollapsed ? 'Expand All' : 'Collapse All'}</span>
                </button>
              </div>
            </div>

            <div className="request-flow-filter-grid" id={filterPanelId} hidden={!filtersOpen}>
              <div className="request-flow-filter-section request-flow-filter-section-status">
                <span className="request-flow-control-label">Status</span>
                <div className="request-flow-status-filter-list" aria-label="Status filters">
                  {STATUS_FILTERS.map((item) => (
                    <label key={item.code} className="request-flow-status-filter-toggle">
                      <input
                        type="checkbox"
                        checked={activeFilters.statusCodes[item.code]}
                        disabled={!onFiltersChange}
                        onChange={() => handleStatusCodeChange(item.code)}
                      />
                      <span className={`status-badge status-${item.code}`}>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="request-flow-filter-section request-flow-search-filter" htmlFor={searchInputId}>
                <span className="request-flow-control-label">Search</span>
                <span className="request-flow-search-filter-box">
                  <SearchIcon />
                  <input
                    id={searchInputId}
                    type="search"
                    value={activeFilters.searchTerm}
                    disabled={!onFiltersChange}
                    placeholder="URL, status, headers..."
                    onChange={handleSearchTermChange}
                  />
                </span>
              </label>

              <div className="request-flow-filter-section request-flow-filter-section-view">
                <span className="request-flow-control-label">Focus</span>
                <div className="request-flow-view-list">
                  {(['all', 'errors', 'slow'] as const).map((mode) => (
                    <ViewChip
                      key={mode}
                      mode={mode}
                      active={focusMode === mode}
                      onClick={() => handleFocusModeChange(mode)}
                    />
                  ))}
                </div>
              </div>

              <div className="request-flow-filter-section request-flow-filter-section-types">
                <span className="request-flow-control-label">Resource Types</span>
                <div className="request-flow-type-list">
                  {ALL_TYPES.map((type) => (
                    <TypePill
                      key={type}
                      type={type}
                      active={visibleTypes.has(type)}
                      onClick={() => toggleType(type)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {phases.length > 1 && (
        <PhaseOverview
          phases={phases}
          activePhaseId={activePhaseId}
          onPhaseSelect={handlePhaseOverviewSelect}
        />
      )}

      <div className="request-flow-stage request-flow-stage--journey" ref={stageRef}>
        <div className="request-flow-phase-timeline" role="list" aria-label="Journey phases">
          {phases.map((phase, index) => (
            <div
              key={phase.id}
              role="listitem"
              data-phase-id={phase.id}
              ref={(element) => registerPhaseElement(phase.id, element)}
            >
              <PhaseCard
                phase={phase}
                maxTime={maxRequestTime}
                visibleTypes={visibleTypes}
                visibleRequestIndexes={visibleRequestIndexes}
                filterMode={focusMode}
                revealed={revealedPhaseIds.has(phase.id)}
                collapsed={collapsedPhases.has(phase.id)}
                onToggle={() => togglePhase(phase.id)}
                onReveal={() => revealPhaseRequests(phase.id)}
                onRequestClick={handleRequestClick}
                index={index}
              />
            </div>
          ))}
        </div>
      </div>

      <footer className="request-flow-footer">
        <div className="request-flow-legend-group">
          <span className="request-flow-legend-title">Phase cues</span>
          <span className="request-flow-legend-item">
            <span className="request-flow-legend-dot tone-danger" />
            <span>Action needed</span>
          </span>
          <span className="request-flow-legend-item">
            <span className="request-flow-legend-dot tone-warning" />
            <span>Review</span>
          </span>
          <span className="request-flow-legend-item">
            <span className="request-flow-legend-dot tone-success" />
            <span>No issue</span>
          </span>
        </div>

        <div className="request-flow-footer-note">
          <InfoIcon />
          <span>Phases are inferred from HAR timing, redirects, initiators, status codes, and URL patterns.</span>
        </div>
      </footer>
    </section>
  );
};

export default RequestFlowDiagram;
