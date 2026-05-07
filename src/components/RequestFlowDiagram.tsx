import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Entry, FilterOptions } from '../types/har';
import {
  analyzeFlow,
  DomainZone,
  ZoneLink,
  ZoneRequest,
  TYPE_COLOR,
} from '../utils/requestFlowAnalyzer';
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

type ZoneHealthTone = 'error' | 'slow' | 'ok';
type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

const ALL_TYPES = ['document', 'script', 'xhr', 'stylesheet', 'image', 'font', 'other'] as const;
const MIN_ZOOM_PERCENT = 55;
const MAX_ZOOM_PERCENT = 125;
const DEFAULT_ZOOM_PERCENT = 100;
const ZOOM_STEP_PERCENT = 10;

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

function clampZoomPercent(value: number): number {
  return Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, Math.round(value)));
}

const TYPE_LABEL: Record<string, string> = {
  document: 'Document',
  script: 'Script',
  xhr: 'XHR',
  stylesheet: 'Stylesheet',
  image: 'Image',
  font: 'Font',
  other: 'Other',
};

const HEALTH_COLOR: Record<ZoneHealthTone, string> = {
  error: '#f97316',
  slow: '#f59e0b',
  ok: '#10b981',
};

const HEALTH_SURFACE: Record<ZoneHealthTone, string> = {
  error: 'rgba(249, 115, 22, 0.08)',
  slow: 'rgba(245, 158, 11, 0.08)',
  ok: 'rgba(16, 185, 129, 0.08)',
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

function getDomainMonogram(domain: string): string {
  return domain.trim().charAt(0).toUpperCase() || '?';
}

function getZoneHealth(zone: DomainZone): ZoneHealthTone {
  if (zone.stats.failed > 0) return 'error';
  if (zone.requests.some((request) => request.isSlow)) return 'slow';
  return 'ok';
}

function getHealthLabel(tone: ZoneHealthTone): string {
  if (tone === 'error') return 'Errors detected';
  if (tone === 'slow') return 'Latency observed';
  return 'Healthy flow';
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

const ProductBadge: React.FC<{ label: string }> = ({ label }) => (
  <span className="request-flow-product-badge">{label}</span>
);

const JourneyStep: React.FC<{ zone: DomainZone }> = ({ zone }) => {
  const tone = getZoneHealth(zone);

  return (
    <div
      className={`request-flow-journey-step tone-${tone}`}
      style={{ ['--journey-accent' as string]: HEALTH_COLOR[tone] } as React.CSSProperties}
    >
      <span className="request-flow-journey-step-dot" aria-hidden="true" />
      <span className="request-flow-journey-step-label">{zone.product || zone.shortLabel}</span>
    </div>
  );
};

const JourneyLink: React.FC<{ link: ZoneLink }> = ({ link }) => (
  <div className={`request-flow-journey-link ${link.type === 'redirect' ? 'is-redirect' : 'is-cascade'}`}>
    <span className="request-flow-journey-link-icon" aria-hidden="true">
      <svg width="18" height="10" viewBox="0 0 18 10" fill="none" style={{ display: 'block' }}>
        <line x1="0" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <polyline points="9,1.5 13.5,5 9,8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
    <span className="request-flow-journey-link-copy">
      {link.type === 'redirect'
        ? `HTTP ${link.statusCode}`
        : `${link.count} handoff${link.count === 1 ? '' : 's'}`}
    </span>
  </div>
);

const ZoneConnector: React.FC<{ link: ZoneLink; index: number }> = ({ link, index }) => {
  const accent = link.type === 'redirect' ? '#f59e0b' : '#9ca3af';

  return (
    <div
      className={`request-flow-connector ${link.type === 'redirect' ? 'is-redirect' : 'is-cascade'}`}
      style={{
        ['--connector-accent' as string]: accent,
        ['--flow-delay' as string]: `${index * 70}ms`,
      } as React.CSSProperties}
    >
      <svg className="request-flow-connector-svg" viewBox="0 0 120 58" aria-hidden="true">
        <path className="request-flow-connector-line" d="M10 29 H102" />
        <path className="request-flow-connector-glow" d="M10 29 H102" />
        <circle className="request-flow-connector-node" cx="12" cy="29" r="3.5" />
        <path className="request-flow-connector-arrow" d="M98 22 110 29 98 36" />
      </svg>
      <div className="request-flow-connector-copy">
        <span className="request-flow-connector-title">
          {link.type === 'redirect' ? 'Redirect' : 'Cascade'}
        </span>
        <span className="request-flow-connector-meta">
          {link.type === 'redirect'
            ? `HTTP ${link.statusCode}`
            : `${link.count} handoff${link.count !== 1 ? 's' : ''}`}
        </span>
      </div>
    </div>
  );
};

const RequestRow: React.FC<{
  request: ZoneRequest;
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
      className={`request-flow-request-row tone-${statusTone} ${request.isSlow ? 'is-slow' : ''} ${request.failed ? 'is-error' : ''}`}
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

const ZoneCard: React.FC<{
  zone: DomainZone;
  maxTime: number;
  visibleTypes: Set<string>;
  visibleRequestIndexes: Set<number> | null;
  filterMode: RequestFlowFocusMode;
  collapsed: boolean;
  onToggle: () => void;
  onRequestClick: (index: number) => void;
  index: number;
}> = ({
  zone,
  maxTime,
  visibleTypes,
  visibleRequestIndexes,
  filterMode,
  collapsed,
  onToggle,
  onRequestClick,
  index,
}) => {
  const tone = getZoneHealth(zone);
  const visibleRequests = zone.requests.filter((request) => {
    if (visibleRequestIndexes && !visibleRequestIndexes.has(request.index)) return false;
    if (!visibleTypes.has(request.type)) return false;
    return requestMatchesFlowFocus(request, filterMode);
  });

  return (
    <article
      className={`request-flow-zone-card tone-${tone} ${collapsed ? 'is-collapsed' : ''}`}
      style={{
        ['--zone-accent' as string]: HEALTH_COLOR[tone],
        ['--zone-surface' as string]: HEALTH_SURFACE[tone],
        ['--flow-delay' as string]: `${index * 70}ms`,
      } as React.CSSProperties}
    >
      <button
        type="button"
        className="request-flow-zone-header"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <div className="request-flow-zone-heading">
          <span className="request-flow-zone-monogram" aria-hidden="true">
            {getDomainMonogram(zone.domain)}
          </span>

          <div className="request-flow-zone-title-group">
            <div className="request-flow-zone-title-row">
              <strong title={zone.domain}>{zone.shortLabel}</strong>
              {zone.product && <ProductBadge label={zone.product} />}
            </div>
            <div className="request-flow-zone-subtitle-row">
              <span className={`request-flow-zone-health tone-${tone}`}>
                {tone === 'ok' ? <CheckIcon /> : tone === 'slow' ? <FlameIcon /> : <AlertIcon />}
                <span>{getHealthLabel(tone)}</span>
              </span>
              <span className="request-flow-zone-domain" title={zone.domain}>{zone.domain}</span>
            </div>
            <div className="request-flow-zone-meta">
              <span>{zone.stats.total} req</span>
              <span>{formatTime(zone.stats.avgTime)} avg</span>
              {zone.stats.totalBytes > 0 && <span>{formatBytes(zone.stats.totalBytes)}</span>}
              {zone.stats.failed > 0 && <span className="is-danger">{zone.stats.failed} err</span>}
            </div>
          </div>

          <span className="request-flow-zone-chevron" aria-hidden="true">
            {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          </span>
        </div>
      </button>

      {!collapsed && (
        <div className="request-flow-zone-body">
          {visibleRequests.length === 0 ? (
            <div className="request-flow-zone-empty">
              <InfoIcon />
              <span>No requests match the current filters.</span>
            </div>
          ) : (
            visibleRequests.map((request) => (
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
  const stageViewportRef = useRef<HTMLDivElement | null>(null);
  const stageTrackRef = useRef<HTMLDivElement | null>(null);
  const flowData = useMemo(() => analyzeFlow(entries), [entries]);
  const { zones, links, p90, maxRequestTime, totalMs } = flowData;
  const visibleRequestIndexes = useMemo(
    () => getVisibleRequestIndexes(entries, visibleEntries),
    [entries, visibleEntries]
  );

  const [localFocusMode, setLocalFocusMode] = useState<RequestFlowFocusMode>('all');
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set(ALL_TYPES));
  const [collapsedZones, setCollapsedZones] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit');
  const [manualZoomPercent, setManualZoomPercent] = useState(DEFAULT_ZOOM_PERCENT);
  const [fitZoomPercent, setFitZoomPercent] = useState(DEFAULT_ZOOM_PERCENT);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const focusMode = controlledFocusMode ?? localFocusMode;
  const activeFilters = filters ?? DEFAULT_FILTERS;
  const activeZoomPercent = zoomMode === 'fit' ? fitZoomPercent : manualZoomPercent;
  const activeZoom = Number((activeZoomPercent / 100).toFixed(2));

  const linkedZoneIds = new Set(links.flatMap((link) => [link.fromZoneId, link.toZoneId]));
  const linkedZones = zones.filter((zone) => linkedZoneIds.has(zone.id));
  const isolatedZones = zones.filter((zone) => !linkedZoneIds.has(zone.id));
  const journeyLinksByKey = new Map(links.map((link) => [`${link.fromZoneId}->${link.toZoneId}`, link]));

  const allCollapsed = zones.length > 0 && collapsedZones.size === zones.length;
  const totalRequests = entries.length;
  const slowCount = entries.filter((entry) => (entry.time || 0) >= p90 && (entry.time || 0) > 500).length;
  const focusedRequestCount = useMemo(
    () =>
      zones.reduce((count, zone) => {
        const matchingRequests = zone.requests.filter((request) => {
          if (visibleRequestIndexes && !visibleRequestIndexes.has(request.index)) return false;
          if (!visibleTypes.has(request.type)) return false;
          return requestMatchesFlowFocus(request, focusMode);
        });

        return count + matchingRequests.length;
      }, 0),
    [focusMode, visibleRequestIndexes, visibleTypes, zones]
  );
  const zoomLayerStyle = useMemo(
    () =>
      ({
        ['--request-flow-zoom' as string]: activeZoom,
        transform: `scale(${activeZoom})`,
      } as React.CSSProperties),
    [activeZoom]
  );
  const zoomFrameStyle = useMemo(() => {
    if (stageSize.width <= 0 || stageSize.height <= 0) return undefined;

    return {
      width: `${Math.ceil(stageSize.width * activeZoom)}px`,
      height: `${Math.ceil(stageSize.height * activeZoom)}px`,
    } as React.CSSProperties;
  }, [activeZoom, stageSize.height, stageSize.width]);

  const measureStage = useCallback(() => {
    const viewport = stageViewportRef.current;
    const track = stageTrackRef.current;
    if (!viewport || !track) return;

    const contentWidth = Math.ceil(track.scrollWidth || track.getBoundingClientRect().width);
    const contentHeight = Math.ceil(track.scrollHeight || track.getBoundingClientRect().height);
    const availableWidth = Math.max(1, viewport.clientWidth - 24);
    const availableHeight = Math.max(1, viewport.clientHeight - 58);

    if (contentWidth > 0 && contentHeight > 0) {
      const nextFit = clampZoomPercent(
        Math.min(
          DEFAULT_ZOOM_PERCENT,
          (availableWidth / contentWidth) * 100,
          (availableHeight / contentHeight) * 100
        )
      );
      setFitZoomPercent((current) => (current === nextFit ? current : nextFit));
    }

    if (contentWidth > 0 && contentHeight > 0) {
      setStageSize((current) =>
        current.width === contentWidth && current.height === contentHeight
          ? current
          : { width: contentWidth, height: contentHeight }
      );
    }
  }, []);

  useEffect(() => {
    const viewport = stageViewportRef.current;
    const track = stageTrackRef.current;
    if (!viewport || !track) return;

    measureStage();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureStage);
      return () => window.removeEventListener('resize', measureStage);
    }

    const observer = new ResizeObserver(measureStage);
    observer.observe(viewport);
    observer.observe(track);
    window.addEventListener('resize', measureStage);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measureStage);
    };
  }, [measureStage, focusedRequestCount, zones.length]);

  function setManualZoom(nextZoomPercent: number) {
    setZoomMode('manual');
    setManualZoomPercent(clampZoomPercent(nextZoomPercent));
  }

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

  function handleZoomOut() {
    setManualZoom(activeZoomPercent - ZOOM_STEP_PERCENT);
  }

  function handleZoomIn() {
    setManualZoom(activeZoomPercent + ZOOM_STEP_PERCENT);
  }

  function handleFitZoom() {
    measureStage();
    setZoomMode('fit');
  }

  function handleResetZoom() {
    setZoomMode('manual');
    setManualZoomPercent(DEFAULT_ZOOM_PERCENT);
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
      setCollapsedZones(new Set());
      return;
    }

    setCollapsedZones(new Set(zones.map((zone) => zone.id)));
  }

  function toggleZone(zoneId: string) {
    setCollapsedZones((current) => {
      const next = new Set(current);
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      return next;
    });
  }

  function handleRequestClick(index: number) {
    if (onNodeClick && entries[index]) onNodeClick(entries[index]);
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

  let visualIndex = 0;
  const zoomControls = (
    <div className="request-flow-zoom-controls" aria-label="Journey map zoom controls">
      <button
        type="button"
        className="request-flow-zoom-icon-button"
        aria-label="Zoom out journey map"
        title="Zoom out"
        disabled={activeZoomPercent <= MIN_ZOOM_PERCENT}
        onClick={handleZoomOut}
      >
        <ZoomOut aria-hidden="true" size={15} strokeWidth={2.2} />
      </button>

      <output className="request-flow-zoom-value" aria-label="Journey map zoom level" aria-live="polite">
        {activeZoomPercent}%
      </output>

      <button
        type="button"
        className="request-flow-zoom-icon-button"
        aria-label="Zoom in journey map"
        title="Zoom in"
        disabled={activeZoomPercent >= MAX_ZOOM_PERCENT}
        onClick={handleZoomIn}
      >
        <ZoomIn aria-hidden="true" size={15} strokeWidth={2.2} />
      </button>

      <button
        type="button"
        className={`request-flow-zoom-text-button ${zoomMode === 'fit' ? 'is-active' : ''}`}
        aria-label="Fit journey map"
        aria-pressed={zoomMode === 'fit'}
        title="Fit"
        onClick={handleFitZoom}
      >
        <Maximize2 aria-hidden="true" size={14} strokeWidth={2.2} />
      </button>

      <button
        type="button"
        className="request-flow-zoom-text-button"
        aria-label="Reset journey map zoom to 100%"
        title="Reset to 100%"
        onClick={handleResetZoom}
      >
        <RotateCcw aria-hidden="true" size={14} strokeWidth={2.2} />
      </button>
    </div>
  );

  return (
    <section className="request-flow-shell">
      <header className="request-flow-toolbar">
        <div className="request-flow-toolbar-inner">
          <div className="request-flow-toolbar-top">
            <div className="request-flow-summary">
              <h3>Cross domain journey</h3>
            </div>

            <div className="request-flow-summary-grid">
              <SummaryPill icon={<GlobeIcon />} label="Domains" value={`${zones.length}`} />
              <SummaryPill icon={<NetworkIcon />} label="Requests" value={`${totalRequests}`} />
              <SummaryPill icon={<ClockIcon />} label="Session" value={totalMs > 0 ? formatTime(totalMs) : '0ms'} />
              <SummaryPill icon={<FlameIcon />} label="Slow" value={`${slowCount}`} tone={slowCount > 0 ? 'warning' : 'neutral'} />
            </div>
          </div>

          <div className={`request-flow-controls request-flow-filter-panel ${filtersOpen ? 'is-open' : 'is-collapsed'}`}>
            <div className="request-flow-filter-panel-header">
              <div className="request-flow-filter-panel-title-group">
                <span className="request-flow-control-label">Request Filters</span>
                <span className="request-flow-filter-panel-count">
                  Focused <strong>{focusedRequestCount}</strong> / <strong>{totalRequests}</strong>
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

      {(linkedZones.length > 0 || isolatedZones.length > 0) && (
        <div className="request-flow-journey-strip">
          <span className="request-flow-journey-label">
            <NetworkIcon />
            <span>Journey</span>
          </span>

          <div className="request-flow-journey-track">
            {linkedZones.map((zone, index) => {
              const nextZone = linkedZones[index + 1];
              const link = nextZone ? journeyLinksByKey.get(`${zone.id}->${nextZone.id}`) : undefined;

              return (
                <React.Fragment key={zone.id}>
                  <JourneyStep zone={zone} />
                  {link && <JourneyLink link={link} />}
                </React.Fragment>
              );
            })}

            {isolatedZones.length > 0 && (
              <>
                {linkedZones.length > 0 && <span className="request-flow-journey-divider">Independent</span>}
                {isolatedZones.map((zone) => (
                  <JourneyStep key={zone.id} zone={zone} />
                ))}
              </>
            )}
          </div>
        </div>
      )}

      <div className="request-flow-stage" ref={stageViewportRef}>
        <div className="request-flow-stage-controls">
          {zoomControls}
        </div>
        <div className="request-flow-stage-zoom-frame" style={zoomFrameStyle}>
          <div
            className="request-flow-stage-zoom-layer"
            data-testid="request-flow-zoom-layer"
            style={zoomLayerStyle}
          >
            <div className="request-flow-stage-track" ref={stageTrackRef}>
              {linkedZones.map((zone, index) => {
                const nextZone = linkedZones[index + 1];
                const link = nextZone ? journeyLinksByKey.get(`${zone.id}->${nextZone.id}`) : undefined;

                return (
                  <React.Fragment key={`${zone.id}-stage`}>
                    <ZoneCard
                      zone={zone}
                      maxTime={maxRequestTime}
                      visibleTypes={visibleTypes}
                      visibleRequestIndexes={visibleRequestIndexes}
                      filterMode={focusMode}
                      collapsed={collapsedZones.has(zone.id)}
                      onToggle={() => toggleZone(zone.id)}
                      onRequestClick={handleRequestClick}
                      index={visualIndex++}
                    />
                    {link && <ZoneConnector link={link} index={visualIndex++} />}
                  </React.Fragment>
                );
              })}

              {isolatedZones.length > 0 && linkedZones.length > 0 && (
                <div className="request-flow-separator">
                  <span />
                  <div>
                    <GlobeIcon />
                    <strong>Independent</strong>
                    <p>Domains outside the main handoff chain.</p>
                  </div>
                  <span />
                </div>
              )}

              {isolatedZones.map((zone) => (
                <ZoneCard
                  key={zone.id}
                  zone={zone}
                  maxTime={maxRequestTime}
                  visibleTypes={visibleTypes}
                  visibleRequestIndexes={visibleRequestIndexes}
                  filterMode={focusMode}
                  collapsed={collapsedZones.has(zone.id)}
                  onToggle={() => toggleZone(zone.id)}
                  onRequestClick={handleRequestClick}
                  index={visualIndex++}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <footer className="request-flow-footer">
        <div className="request-flow-legend-group">
          <span className="request-flow-legend-title">Status</span>
          <span className="request-flow-legend-item">
            <span className="request-flow-legend-dot tone-success" />
            <span>2xx</span>
          </span>
          <span className="request-flow-legend-item">
            <span className="request-flow-legend-dot tone-warning" />
            <span>3xx</span>
          </span>
          <span className="request-flow-legend-item">
            <span className="request-flow-legend-dot tone-danger" />
            <span>4xx / 5xx</span>
          </span>
        </div>

        <div className="request-flow-legend-group">
          <span className="request-flow-legend-title">Timing</span>
          {[
            { label: 'Fast', color: '#5b8def' },
            { label: '>1s', color: '#fbbf24' },
            { label: '>2s', color: '#f59e0b' },
            { label: '>5s', color: '#ef4444' },
          ].map((item) => (
            <span key={item.label} className="request-flow-legend-item">
              <span className="request-flow-legend-bar" style={{ ['--legend-color' as string]: item.color } as React.CSSProperties} />
              <span>{item.label}</span>
            </span>
          ))}
        </div>

        <div className="request-flow-footer-note">
          <InfoIcon />
          <span>Select any request row to inspect it in the Analyzer.</span>
        </div>
      </footer>
    </section>
  );
};

export default RequestFlowDiagram;
