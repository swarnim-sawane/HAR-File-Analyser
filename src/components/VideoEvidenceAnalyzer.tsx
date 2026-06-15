import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, VideoStatusResponse, VideoTimelineEvent } from '../services/apiClient';
import { wsClient } from '../services/websocketClient';

interface VideoEvidenceAnalyzerProps {
  fileId: string;
  fileName: string;
  fileSize: number;
  mediaType: string;
  isActive: boolean;
  backendUrl: string;
}

const VIDEO_STAGES = [
  { key: 'preparing', label: 'Preparing video' },
  { key: 'ready', label: 'Ready to analyze' },
  { key: 'queued', label: 'Queued' },
  { key: 'analyzing', label: 'Analyzing media' },
  { key: 'tools', label: 'Video tools verified' },
  { key: 'keyframes', label: 'Key screens ready' },
  { key: 'fast', label: 'Fast findings ready' },
  { key: 'complete', label: 'AI vision diagnosis' },
] as const;

type VideoStageKey = typeof VIDEO_STAGES[number]['key'];
type VideoFinding = NonNullable<NonNullable<VideoStatusResponse['analysis']>['vision']>['findings'][number];
type VideoTimelineItem = NonNullable<NonNullable<VideoStatusResponse['analysis']>['evidenceTimeline']>[number];
type VideoHandoff = NonNullable<NonNullable<VideoStatusResponse['analysis']>['handoff']>;
type ProcessingTransparency = {
  phase: string;
  tone: 'idle' | 'active' | 'ready' | 'blocked';
  elapsedLabel: string | null;
  message: string;
  available: string[];
  running: string[];
  expectation: string;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return 'Duration pending';
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (minutes <= 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`;
}

function resolveVideoAssetUrl(url: string | undefined, backendUrl: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;

  try {
    return new URL(url, backendUrl).toString();
  } catch {
    return url;
  }
}

function getTimelineMarkerPercent(timestampSeconds: number | null | undefined, durationSeconds: number | null | undefined): number | null {
  if (
    timestampSeconds == null
    || durationSeconds == null
    || !Number.isFinite(timestampSeconds)
    || !Number.isFinite(durationSeconds)
    || durationSeconds <= 0
  ) {
    return null;
  }

  return Math.max(0, Math.min(100, (timestampSeconds / durationSeconds) * 100));
}

function shouldRefreshVideoStatusForEvent(stage?: string): boolean {
  return [
    'metadata_ready',
    'keyframes_ready',
    'fast_visual_ready',
    'vision_ready',
    'audio_transcript_ready',
    'multimodal_ready',
    'video_ready',
  ].includes(stage ?? '');
}

function getStatusCopy(status?: string): string {
  switch (status) {
    case 'preparing':
    case 'processing':
      return 'Preparing video';
    case 'analysis_requested':
      return 'Analysis request needs retry';
    case 'analysis_queued':
      return 'Queued for video analysis';
    case 'analyzing':
      return 'Analyzing video evidence';
    case 'fast_visual_ready':
      return 'Fast visual findings ready';
    case 'analysis_blocked':
      return 'Video analysis blocked';
    case 'analysis_ready':
      return 'Video evidence ready';
    case 'vision_ready':
      return 'AI visual diagnosis ready';
    case 'ready':
      return 'Ready for evidence analysis';
    case 'error':
      return 'Video analysis needs attention';
    default:
      return 'Preparing video';
  }
}

function getStageKey(status?: string): VideoStageKey {
  switch (status) {
    case 'ready':
      return 'ready';
    case 'analysis_requested':
      return 'ready';
    case 'analysis_queued':
      return 'queued';
    case 'analyzing':
      return 'analyzing';
    case 'analysis_blocked':
      return 'tools';
    case 'analysis_ready':
      return 'keyframes';
    case 'fast_visual_ready':
      return 'fast';
    case 'vision_ready':
      return 'complete';
    case 'preparing':
    case 'processing':
    default:
      return 'preparing';
  }
}

function getActionLabel(status?: string, isRequesting = false): string {
  if (isRequesting) return 'Requesting...';
  if (status === 'analysis_requested') return 'Start Video Analysis';
  if (status === 'analysis_blocked') return 'Retry Video Analysis';
  if (status === 'vision_ready') return 'Re-run Video Analysis';
  if (status === 'analysis_ready') return 'Re-run Video Analysis';
  if (status === 'analysis_queued') return 'Analysis Queued';
  if (status === 'fast_visual_ready') return 'Refining Audio...';
  if (status === 'analyzing') return 'Analyzing...';
  return 'Analyze Video Evidence';
}

function getPendingHeading(status?: string): string {
  if (status === 'analysis_blocked') return 'Backend video tools required';
  if (status === 'analysis_requested') return 'Analysis can be restarted';
  if (status === 'ready') return 'Ready for visual analysis';
  if (status === 'analysis_queued') return 'Waiting for worker pickup';
  if (status === 'fast_visual_ready') return 'Fast findings are ready';
  if (status === 'analyzing') return 'Visual evidence is being prepared';
  return 'Preparing evidence review';
}

function getProgressDetail(status?: string): string {
  switch (status) {
    case 'preparing':
    case 'processing':
      return 'Registering the video and reading basic file metadata.';
    case 'ready':
      return 'The recording is ready. Start analysis when you want the worker to inspect it.';
    case 'analysis_requested':
      return 'The previous request did not queue a worker job. Start analysis again to continue.';
    case 'analysis_queued':
      return 'The analysis job is queued and waiting for the backend worker.';
    case 'analyzing':
      return 'Checking video tooling, selecting key screens, and preparing AI evidence.';
    case 'fast_visual_ready':
      return 'Key screens and visual findings are visible now. Sampled audio correlation is still running.';
    case 'analysis_blocked':
      return 'The backend needs media tooling before it can extract transcript or key-screen evidence.';
    case 'analysis_ready':
      return 'Key screens and metadata are ready; AI diagnosis may still be completing.';
    case 'vision_ready':
      return 'Visual findings, evidence timeline, and support handoff are ready for review.';
    case 'error':
      return 'The analyzer hit an error. Check the activity trail for the failing operation.';
    default:
      return 'Waiting for the backend to report the current video evidence state.';
  }
}

function getVisionVerdict(summary?: string): { label: string; tone: 'neutral' | 'success' | 'warning'; detail: string } {
  const normalizedSummary = summary?.toLowerCase() ?? '';
  if (/\b(no\s+(?:explicit\s+|visible\s+)?(?:error|failure)|no\s+failed\s+loading|no\s+visible\s+failed|without\s+(?:a\s+)?visible\s+(?:error|failure))\b/.test(normalizedSummary)) {
    return {
      label: 'No visible failure captured',
      tone: 'success',
      detail: 'The recording shows user flow evidence, but no explicit error screen.',
    };
  }
  if (/\b(error|failed|failure|blocked|exception|denied)\b/.test(normalizedSummary)) {
    return {
      label: 'Failure visible in recording',
      tone: 'warning',
      detail: 'Use the cited frames below to match this with logs or HAR evidence.',
    };
  }
  return {
    label: 'Evidence review ready',
    tone: 'neutral',
    detail: 'Review the visual conclusion and cited frames before support handoff.',
  };
}

function getKeyframeNumber(fileName?: string): number | null {
  if (!fileName) return null;
  const match = fileName.match(/frame[_-](\d+)/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getFindingSearchText(finding: VideoFinding): string {
  return [
    finding.title,
    finding.evidence,
    finding.action,
    ...(finding.frameRefs ?? []),
  ].filter(Boolean).join(' ');
}

function getFindingFrameRefs(finding: VideoFinding): string[] {
  const refs = new Set<string>();
  const text = getFindingSearchText(finding);
  const frameMatches = text.matchAll(/\bframes?\s*0*(\d+)(?:\s*(?:-|to|through)\s*0*(\d+))?/gi);

  for (const match of frameMatches) {
    if (match[2]) {
      refs.add(`Frames ${Number(match[1])}-${Number(match[2])}`);
    } else {
      refs.add(`Frame ${Number(match[1])}`);
    }
  }

  return Array.from(refs).slice(0, 4);
}

function findingMentionsFrame(finding: VideoFinding, frameNumber: number): boolean {
  const text = getFindingSearchText(finding);
  const exactPattern = new RegExp(`\\bframe[_\\s-]*0*${frameNumber}\\b`, 'i');
  if (exactPattern.test(text)) return true;

  const rangeMatches = text.matchAll(/\bframes?\s*0*(\d+)\s*(?:-|to|through)\s*0*(\d+)\b/gi);
  for (const match of rangeMatches) {
    const start = Number.parseInt(match[1], 10);
    const end = Number.parseInt(match[2], 10);
    if (Number.isFinite(start) && Number.isFinite(end) && frameNumber >= Math.min(start, end) && frameNumber <= Math.max(start, end)) {
      return true;
    }
  }

  return false;
}

function getTimelineKindLabel(kind: VideoTimelineItem['kind']): string {
  switch (kind) {
    case 'statement':
      return 'Transcript';
    case 'visual':
      return 'Screen';
    case 'correlation':
      return 'Correlation';
    default:
      return 'Evidence';
  }
}

function truncateText(text: string | undefined, maxLength: number): string {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function formatElapsedMs(durationMs: number | undefined): string {
  if (durationMs == null || !Number.isFinite(durationMs)) return 'pending';
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`;
}

function formatElapsedRunTime(startedAtMs: number | null): string | null {
  if (startedAtMs == null || !Number.isFinite(startedAtMs)) return null;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  return `Running for ${formatDuration(elapsedSeconds)}`;
}

function getAnalysisStartedAtMs(timeline: VideoTimelineEvent[]): number | null {
  const startEvent = timeline.find(event => [
    'analysis_requested',
    'analysis_queued',
    'analyzing',
  ].includes(event.stage));
  if (!startEvent) return null;

  const parsed = Date.parse(startEvent.createdAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasTimingStage(
  timings: Array<{ stage: string; status: string }>,
  stage: string,
  status: string = 'complete'
): boolean {
  return timings.some(timing => timing.stage === stage && timing.status === status);
}

function buildProcessingTransparency(options: {
  status?: string;
  timeline: VideoTimelineEvent[];
  keyframeCount: number;
  visionReady: boolean;
  transcriptReady: boolean;
  transcriptSampled: boolean;
  multimodalReady: boolean;
  handoffReady: boolean;
  processingTimings: Array<{ stage: string; status: string }>;
}): ProcessingTransparency {
  const {
    status,
    timeline,
    keyframeCount,
    visionReady,
    transcriptReady,
    transcriptSampled,
    multimodalReady,
    handoffReady,
    processingTimings,
  } = options;
  const available: string[] = [];
  const running: string[] = [];

  if (keyframeCount > 0) {
    available.push(`${keyframeCount} key screen${keyframeCount === 1 ? '' : 's'} ready`);
  }
  if (visionReady) available.push('Visual findings ready');
  if (transcriptReady) available.push(transcriptSampled ? 'Sampled transcript ready' : 'Transcript ready');
  if (multimodalReady) available.push('Audio + visual correlation ready');
  if (handoffReady) available.push('Engineer handoff ready');
  if (available.length === 0 && status) available.push('Recording accepted');

  const phaseByStatus: Record<string, ProcessingTransparency['phase']> = {
    preparing: 'Preparing recording',
    processing: 'Preparing recording',
    ready: 'Ready for analysis',
    analysis_requested: 'Waiting for retry',
    analysis_queued: 'Queued for worker',
    analyzing: keyframeCount > 0 ? 'Reviewing evidence' : 'Selecting key screens',
    fast_visual_ready: 'Refining audio evidence',
    analysis_blocked: 'Action needed',
    analysis_ready: 'Evidence prepared',
    vision_ready: 'Ready for support review',
    error: 'Needs attention',
  };

  if (status === 'analysis_queued') {
    running.push('Worker pickup');
  } else if (status === 'analyzing') {
    if (keyframeCount === 0) running.push('Key screen selection');
    if (!visionReady) running.push('AI visual review');
    if (!transcriptReady && !hasTimingStage(processingTimings, 'transcript')) running.push('Audio processing');
  } else if (status === 'fast_visual_ready') {
    running.push('Sampled audio transcription', 'Audio + visual correlation');
  }

  const isActive = ['analysis_queued', 'analyzing', 'fast_visual_ready'].includes(status ?? '');
  const isBlocked = ['analysis_blocked', 'analysis_requested', 'error'].includes(status ?? '');
  const tone: ProcessingTransparency['tone'] = isBlocked
    ? 'blocked'
    : status === 'vision_ready' || status === 'analysis_ready'
      ? 'ready'
      : isActive
        ? 'active'
        : 'idle';

  const message = status === 'fast_visual_ready'
    ? 'You can start reviewing the screen evidence while audio correlation continues.'
    : status === 'vision_ready' || status === 'analysis_ready'
      ? 'The main evidence pass is ready. Review the handoff and cited moments before sharing conclusions.'
      : status === 'analysis_blocked'
        ? 'Processing is blocked until the required backend media tools are available.'
        : status === 'analysis_queued'
          ? 'The job is waiting for the backend worker. No action is needed unless it remains queued unusually long.'
          : 'Results appear progressively as each stage finishes.';

  const expectation = isActive
    ? 'First analysis can take a few minutes for long recordings. Results appear as each stage finishes.'
    : status === 'vision_ready' || status === 'analysis_ready'
      ? 'Cached re-runs of the same recording should be faster than the first pass.'
      : 'The analyzer will report each stage instead of leaving the screen idle.';

  return {
    phase: phaseByStatus[status ?? ''] ?? 'Preparing evidence review',
    tone,
    elapsedLabel: formatElapsedRunTime(getAnalysisStartedAtMs(timeline)),
    message,
    available,
    running,
    expectation,
  };
}

function parseFrameNumberFromRefs(frameRefs: string[] | undefined): number | null {
  if (!frameRefs?.length) return null;

  for (const ref of frameRefs) {
    const match = ref.match(/\bframe\s*0*(\d+)\b/i);
    if (!match) continue;
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function findClosestKeyframeIndex(
  keyframes: Array<{ fileName: string; timestampSeconds?: number | null }>,
  timestampSeconds: number
): number {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  keyframes.forEach((frame, index) => {
    if (frame.timestampSeconds == null || !Number.isFinite(frame.timestampSeconds)) return;
    const distance = Math.abs(frame.timestampSeconds - timestampSeconds);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  return closestIndex;
}

function sanitizeDownloadFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'video-evidence';
}

function appendMarkdownList(lines: string[], items: string[], emptyText: string): void {
  if (items.length === 0) {
    lines.push(`- ${emptyText}`);
    return;
  }

  items.forEach(item => lines.push(`- ${item}`));
}

function buildSupportHandoffMarkdown(fileName: string, handoff: VideoHandoff): string {
  const lines: string[] = [
    `# ${handoff.title || `Engineer handoff for ${fileName}`}`,
    '',
    `File: ${fileName}`,
    `Status: ${handoff.status}`,
    `Verdict: ${handoff.verdict}`,
    '',
    '## Summary',
    handoff.summary,
    '',
    '## Confirmed Facts',
  ];

  appendMarkdownList(lines, handoff.confirmedFacts, 'No confirmed facts were produced.');

  lines.push('', '## Source-Grounded Evidence');
  if (handoff.evidenceCards.length === 0) {
    lines.push('- No evidence cards were produced.');
  } else {
    handoff.evidenceCards.forEach((card, index) => {
      const refs = [
        ...card.frameRefs,
        ...card.transcriptRefs,
        `${card.confidence} confidence`,
      ].filter(Boolean).join('; ');

      lines.push(
        '',
        `### ${index + 1}. ${card.claim}`,
        `Time: ${card.timestampSeconds == null ? 'Not timestamped' : formatDuration(card.timestampSeconds)}`,
        `Evidence: ${card.evidence}`,
        refs ? `Refs: ${refs}` : 'Refs: Not cited'
      );

      if (card.transcript) lines.push(`Transcript: "${card.transcript}"`);
      if (card.nextStep) lines.push(`Next step: ${card.nextStep}`);
    });
  }

  lines.push('', '## Known Gaps');
  appendMarkdownList(lines, handoff.gaps, 'No explicit gaps were reported.');

  lines.push('', '## Next Support Actions');
  appendMarkdownList(lines, handoff.nextSteps, 'No next support actions were produced.');

  if (handoff.timings.length > 0) {
    lines.push('', '## Processing Timings');
    handoff.timings.forEach(timing => {
      lines.push(`- ${timing.label}: ${formatElapsedMs(timing.durationMs)} (${timing.status})`);
    });
  }

  return `${lines.join('\n')}\n`;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand('copy');
    if (!copied) throw new Error('Copy command was rejected by the browser.');
  } finally {
    document.body.removeChild(textarea);
  }
}

function downloadTextFile(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

const VideoEvidenceAnalyzer: React.FC<VideoEvidenceAnalyzerProps> = ({
  fileId,
  fileName,
  fileSize,
  mediaType,
  isActive,
  backendUrl,
}) => {
  const [status, setStatus] = useState<VideoStatusResponse | null>(null);
  const [timeline, setTimeline] = useState<VideoTimelineEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRequestingAnalysis, setIsRequestingAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKeyframeIndex, setSelectedKeyframeIndex] = useState(0);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const [handoffCopyState, setHandoffCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const mediaRef = useRef<HTMLVideoElement | null>(null);

  const visibleStatus = getStatusCopy(status?.status);
  const canRequestAnalysis = Boolean(
    status &&
    !['preparing', 'processing', 'analysis_queued', 'analyzing', 'fast_visual_ready'].includes(status.status)
  );

  const loadVideoEvidence = useCallback(async () => {
    if (!fileId) return;

    try {
      setError(null);
      const [nextStatus, nextTimeline] = await Promise.all([
        apiClient.getVideoStatus(fileId),
        apiClient.getVideoTimeline(fileId).catch(() => ({ events: [] })),
      ]);
      setStatus(nextStatus);
      setTimeline(nextTimeline.events);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Video evidence status could not be loaded.';
      setError(message);
    }
  }, [fileId]);

  useEffect(() => {
    if (!isActive) return undefined;

    setIsLoading(true);
    void loadVideoEvidence().finally(() => setIsLoading(false));

    const interval = window.setInterval(() => {
      void loadVideoEvidence();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [isActive, loadVideoEvidence]);

  useEffect(() => {
    if (!isActive || !fileId) return undefined;

    wsClient.connect();
    wsClient.subscribeToFile(fileId);

    const handleStatus = (payload: Partial<VideoStatusResponse> & { metadata?: { durationSeconds?: number | null; ffprobeAvailable?: boolean | null } }) => {
      if (payload.fileId !== fileId) return;

      setStatus(previous => {
        if (!previous) return previous;

        return {
          ...previous,
          status: payload.status ?? previous.status,
          durationSeconds: payload.durationSeconds ?? payload.metadata?.durationSeconds ?? previous.durationSeconds,
          ffprobeAvailable: payload.ffprobeAvailable ?? payload.metadata?.ffprobeAvailable ?? previous.ffprobeAvailable,
          analysis: payload.analysis
            ? {
                ...(previous.analysis ?? {}),
                ...payload.analysis,
              }
            : previous.analysis,
          error: payload.error ?? previous.error,
        };
      });
    };

    const handleTimeline = (event: VideoTimelineEvent) => {
      if (event.fileId !== fileId) return;

      setTimeline(previous => {
        const eventKey = `${event.stage}:${event.createdAt}:${event.title}`;
        if (previous.some(item => `${item.stage}:${item.createdAt}:${item.title}` === eventKey)) {
          return previous;
        }
        return [...previous, event];
      });

      if (shouldRefreshVideoStatusForEvent(event.stage)) {
        void loadVideoEvidence();
      }
    };

    wsClient.on('file:status', handleStatus);
    wsClient.on('video:timeline', handleTimeline);

    return () => {
      wsClient.off('file:status', handleStatus);
      wsClient.off('video:timeline', handleTimeline);
    };
  }, [fileId, isActive, loadVideoEvidence]);

  const stageStates = useMemo(() => {
    const activeKey = getStageKey(status?.status);
    const activeIndex = Math.max(0, VIDEO_STAGES.findIndex(stage => stage.key === activeKey));

    return VIDEO_STAGES.map((stage, index) => ({
      stage: stage.key === 'tools' && status?.status === 'analysis_blocked'
        ? 'Video tools needed'
        : stage.label,
      state: index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'pending',
    }));
  }, [status?.status]);
  const analysisProgress = useMemo(() => {
    const progressedStages = stageStates.filter(item => item.state !== 'pending').length;
    return Math.min(100, Math.round((progressedStages / VIDEO_STAGES.length) * 100));
  }, [stageStates]);
  const activeStage = stageStates.find(item => item.state === 'active') ?? stageStates[0];
  const completedStageCount = stageStates.filter(item => item.state === 'complete').length;
  const recentTimeline = timeline.slice(-3).reverse();
  const shouldOpenTechnicalTrail = status?.status === 'analysis_blocked' || status?.status === 'error';

  const handleRequestAnalysis = async () => {
    setIsRequestingAnalysis(true);
    setError(null);
    try {
      await apiClient.requestVideoAnalysis(fileId);
      await loadVideoEvidence();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Video evidence analysis could not be requested.';
      setError(message);
    } finally {
      setIsRequestingAnalysis(false);
    }
  };

  const keyframes = status?.analysis?.keyframes ?? [];
  const vision = status?.analysis?.vision;
  const transcript = status?.analysis?.transcript;
  const evidenceTimeline = status?.analysis?.evidenceTimeline ?? [];
  const multimodal = status?.analysis?.multimodal;
  const handoff = status?.analysis?.handoff;
  const processingTimings = handoff?.timings ?? status?.analysis?.timings ?? [];
  const handoffMarkdown = useMemo(
    () => handoff ? buildSupportHandoffMarkdown(fileName, handoff) : '',
    [fileName, handoff]
  );
  const compactProcessingTimings = processingTimings.slice(-4);
  const processingTransparency = useMemo(() => buildProcessingTransparency({
    status: status?.status,
    timeline,
    keyframeCount: keyframes.length,
    visionReady: vision?.status === 'ready',
    transcriptReady: transcript?.status === 'ready',
    transcriptSampled: Boolean(transcript?.sampled),
    multimodalReady: multimodal?.status === 'ready',
    handoffReady: handoff?.status === 'ready',
    processingTimings,
  }), [
    handoff?.status,
    keyframes.length,
    multimodal?.status,
    processingTimings,
    status?.status,
    timeline,
    transcript?.sampled,
    transcript?.status,
    vision?.status,
  ]);
  const hasVisionFindings = Boolean(vision?.findings.length);
  const hasVisionNextSteps = Boolean(vision?.nextSteps.length);
  const hasEvidenceTimeline = evidenceTimeline.length > 0;
  const hasMultimodalFindings = Boolean(multimodal?.findings.length);
  const hasHandoffCards = Boolean(handoff?.evidenceCards.length);
  const keyframeStrategyLabel = status?.analysis?.keyframeStrategy === 'scene-change'
    ? `${keyframes.length} inflection point${keyframes.length === 1 ? '' : 's'}`
    : `${keyframes.length} frame${keyframes.length === 1 ? '' : 's'}`;
  const evidenceCount = vision?.findings.length ?? 0;
  const nextStepCount = vision?.nextSteps.length ?? 0;
  const primaryNextStep = handoff?.nextSteps[0] ?? multimodal?.nextSteps[0] ?? vision?.nextSteps[0];
  const selectedKeyframe = keyframes[selectedKeyframeIndex] ?? keyframes[0];
  const visualVerdict = getVisionVerdict(vision?.summary);
  const selectedFrameNumber = getKeyframeNumber(selectedKeyframe?.fileName);
  const frameLinkedFindingCount = useMemo(() => {
    if (!vision) return 0;
    return vision.findings.filter(finding => getFindingFrameRefs(finding).length > 0).length;
  }, [vision]);
  const selectedFrameFindings = useMemo(() => {
    if (!vision || selectedFrameNumber == null) return [];
    return vision.findings.filter(finding => findingMentionsFrame(finding, selectedFrameNumber));
  }, [selectedFrameNumber, vision]);
  const keyframeMoments = useMemo(() => keyframes.map((frame, index) => {
    const frameNumber = getKeyframeNumber(frame.fileName) ?? index + 1;
    const linkedFindings = vision
      ? vision.findings.filter(finding => findingMentionsFrame(finding, frameNumber))
      : [];
    const primaryFinding = linkedFindings[0];

    return {
      frame,
      frameNumber,
      linkedFindings,
      title: primaryFinding?.title ?? `Screen change ${index + 1}`,
      detail: primaryFinding?.evidence ?? 'Visual inflection point selected from the recording.',
    };
  }), [keyframes, vision]);
  const selectedMoment = keyframeMoments[selectedKeyframeIndex] ?? keyframeMoments[0];
  const mediaSourceUrl = resolveVideoAssetUrl(status?.mediaUrl, backendUrl);
  const durationSeconds = status?.durationSeconds ?? null;
  const hasMediaReview = Boolean(mediaSourceUrl) || keyframes.length > 0;
  const timelineKeyframes = useMemo(() => {
    let lastPercent: number | null = null;
    let lane = 0;

    return keyframes
      .map((frame, index) => ({
        frame,
        index,
        percent: getTimelineMarkerPercent(frame.timestampSeconds, durationSeconds),
      }))
      .filter((item): item is { frame: typeof keyframes[number]; index: number; percent: number } => item.percent != null)
      .map(item => {
        if (lastPercent != null && Math.abs(item.percent - lastPercent) < 2.2) {
          lane = (lane + 1) % 3;
        } else {
          lane = 0;
        }
        lastPercent = item.percent;

        return {
          ...item,
          lane,
        };
      });
  }, [durationSeconds, keyframes]);

  const seekToKeyframe = useCallback((index: number) => {
    const frame = keyframes[index];
    setSelectedKeyframeIndex(index);
    if (frame?.timestampSeconds == null || !Number.isFinite(frame.timestampSeconds)) return;

    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = Math.max(0, frame.timestampSeconds);
    setCurrentVideoTime(frame.timestampSeconds);
  }, [keyframes]);

  const seekToTimestamp = useCallback((timestampSeconds: number) => {
    if (!Number.isFinite(timestampSeconds)) return;

    if (keyframes.length > 0) {
      setSelectedKeyframeIndex(findClosestKeyframeIndex(keyframes, timestampSeconds));
    }

    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = Math.max(0, timestampSeconds);
    setCurrentVideoTime(timestampSeconds);
    media.closest('.video-evidence-media-review')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [keyframes]);

  const seekToEvidence = useCallback((timestampSeconds: number | null | undefined, frameRefs?: string[]) => {
    if (timestampSeconds != null && Number.isFinite(timestampSeconds)) {
      seekToTimestamp(timestampSeconds);
      return;
    }

    const frameNumber = parseFrameNumberFromRefs(frameRefs);
    if (frameNumber == null) return;

    const frameIndex = keyframes.findIndex((frame, index) => {
      const currentFrameNumber = getKeyframeNumber(frame.fileName) ?? index + 1;
      return currentFrameNumber === frameNumber;
    });

    if (frameIndex >= 0) {
      seekToKeyframe(frameIndex);
      mediaRef.current?.closest('.video-evidence-media-review')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  }, [keyframes, seekToKeyframe, seekToTimestamp]);

  const canSeekToEvidence = useCallback((timestampSeconds: number | null | undefined, frameRefs?: string[]) => {
    if (timestampSeconds != null && Number.isFinite(timestampSeconds)) return Boolean(mediaSourceUrl) || keyframes.length > 0;
    const frameNumber = parseFrameNumberFromRefs(frameRefs);
    if (frameNumber == null) return false;
    return keyframes.some((frame, index) => (getKeyframeNumber(frame.fileName) ?? index + 1) === frameNumber);
  }, [keyframes, mediaSourceUrl]);

  const handleCopyHandoff = useCallback(async () => {
    if (!handoffMarkdown) return;

    try {
      await copyTextToClipboard(handoffMarkdown);
      setHandoffCopyState('copied');
    } catch {
      setHandoffCopyState('failed');
    }
  }, [handoffMarkdown]);

  const handleDownloadHandoff = useCallback(() => {
    if (!handoffMarkdown) return;
    downloadTextFile(`${sanitizeDownloadFileName(fileName)}-support-handoff.md`, handoffMarkdown);
  }, [fileName, handoffMarkdown]);

  useEffect(() => {
    if (handoffCopyState === 'idle') return undefined;
    const timeout = window.setTimeout(() => setHandoffCopyState('idle'), 2600);
    return () => window.clearTimeout(timeout);
  }, [handoffCopyState]);

  useEffect(() => {
    if (selectedKeyframeIndex >= keyframes.length) {
      setSelectedKeyframeIndex(0);
    }
  }, [keyframes.length, selectedKeyframeIndex]);

  const keyframeReview = hasMediaReview ? (
    <section className="video-evidence-media-review video-evidence-cockpit" aria-label="Primary video evidence review">
      <div className="video-evidence-review-header">
        <div>
          <span>Case Review Cockpit</span>
          <h3>Recording Review</h3>
          <p>{keyframes.length > 0 ? keyframeStrategyLabel : 'Media playback ready'}</p>
        </div>
        <div className="video-evidence-review-stats" aria-label="Recording review summary">
          <span>
            <strong>{formatDuration(status?.durationSeconds)}</strong>
            duration
          </span>
          <span>
            <strong>{keyframes.length}</strong>
            key moments
          </span>
          <span className={`is-${visualVerdict.tone}`}>
            <strong>{vision ? visualVerdict.label : visibleStatus}</strong>
            AI readout
          </span>
        </div>
      </div>

      <div className={`video-evidence-cockpit-grid ${selectedKeyframe ? 'has-selected-frame' : 'is-player-only'}`}>
        <div className="video-evidence-player-workbench">
          {mediaSourceUrl && (
            <div className="video-evidence-player-card" aria-label="Video playback with evidence markers">
              <video
                ref={mediaRef}
                className="video-evidence-media-player"
                src={mediaSourceUrl}
                aria-label="Customer session media player"
                controls
                preload="metadata"
                playsInline
                onTimeUpdate={(event) => setCurrentVideoTime(event.currentTarget.currentTime)}
              />
              {timelineKeyframes.length > 0 && (
                <div className="video-evidence-player-timeline" aria-label="Extracted frame markers on recording timeline">
                  <div className="video-evidence-player-rail" aria-hidden="true">
                    <span
                      className="video-evidence-player-progress"
                      style={{
                        width: `${getTimelineMarkerPercent(currentVideoTime, durationSeconds) ?? 0}%`,
                      }}
                    />
                  </div>
                  {timelineKeyframes.map(({ frame, index, percent, lane }) => {
                    const isActive = index === selectedKeyframeIndex;
                    return (
                      <button
                        key={`timeline:${frame.fileName}`}
                        type="button"
                        className={`video-evidence-timeline-marker ${isActive ? 'is-active' : ''}`}
                        style={{
                          '--video-evidence-marker-left': `${percent}%`,
                          '--video-evidence-marker-order': index,
                          '--video-evidence-marker-lane': lane,
                        } as React.CSSProperties}
                        onClick={() => seekToKeyframe(index)}
                        aria-label={`Seek to frame ${index + 1} at ${formatDuration(frame.timestampSeconds)}`}
                        title={`Frame ${index + 1} - ${formatDuration(frame.timestampSeconds)}`}
                      >
                        <span aria-hidden="true" />
                        <small>Frame {index + 1} - {formatDuration(frame.timestampSeconds)}</small>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="video-evidence-moment-board">
            <div className="video-evidence-section-label">
              <span>Key Moments</span>
              <small>{keyframeMoments.length > 0 ? `${keyframeMoments.length} captured` : 'waiting for screen changes'}</small>
            </div>
            {keyframeMoments.length > 0 ? (
              <div className="video-evidence-moment-strip" aria-label="Video key moments">
                {keyframeMoments.map(({ frame, title, detail, linkedFindings }, index) => (
                  <button
                    type="button"
                    className={`video-evidence-moment-card ${index === selectedKeyframeIndex ? 'is-active' : ''}`}
                    key={frame.fileName}
                    onClick={() => seekToKeyframe(index)}
                    aria-label={`Show ${frame.fileName}${frame.timestampSeconds != null ? ` and seek to ${formatDuration(frame.timestampSeconds)}` : ''}`}
                    style={{ '--video-evidence-order': index } as React.CSSProperties}
                  >
                    <span className="video-evidence-moment-thumb">
                      <img
                        src={resolveVideoAssetUrl(frame.url, backendUrl)}
                        alt={`Thumbnail ${frame.fileName}`}
                        loading="lazy"
                      />
                      <span>{String(index + 1).padStart(2, '0')}</span>
                    </span>
                    <span className="video-evidence-moment-copy">
                      <strong>{title}</strong>
                      <small>{frame.timestampSeconds != null ? formatDuration(frame.timestampSeconds) : frame.fileName}</small>
                      <em>{truncateText(detail, 104)}</em>
                    </span>
                    <span className="video-evidence-moment-count">
                      {linkedFindings.length} finding{linkedFindings.length === 1 ? '' : 's'}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="video-evidence-media-empty">
                <strong>Waiting for key moments</strong>
                <span>As frames are identified, they will appear on the timeline and in this review board without waiting for the final AI summary.</span>
              </div>
            )}
          </div>
        </div>

        <aside className="video-evidence-ai-review" aria-label="AI review sidebar">
          <div className={`video-evidence-ai-verdict is-${visualVerdict.tone}`}>
            <span>AI Review</span>
            <strong>{vision ? visualVerdict.label : 'Analysis in progress'}</strong>
            <p>{vision ? visualVerdict.detail : getProgressDetail(status?.status)}</p>
          </div>

          {selectedKeyframe && selectedMoment && (
            <div className="video-evidence-current-moment">
              <div className="video-evidence-section-label">
                <span>Selected Moment</span>
                <small>Frame {selectedKeyframeIndex + 1} of {keyframes.length}</small>
              </div>
              <figure className="video-evidence-screen-stage">
                <div className="video-evidence-screen-frame">
                  <div className="video-evidence-screen-meta-puck">
                    <span>{selectedMoment.title}</span>
                    {selectedKeyframe.timestampSeconds != null && <strong>{formatDuration(selectedKeyframe.timestampSeconds)}</strong>}
                  </div>
                  <img
                    src={resolveVideoAssetUrl(selectedKeyframe.url, backendUrl)}
                    alt={`Key screen ${selectedKeyframe.fileName} selected preview`}
                  />
                </div>
                <figcaption>
                  <span>{selectedKeyframe.fileName}</span>
                  {selectedKeyframe.timestampSeconds != null && (
                    <strong>{formatDuration(selectedKeyframe.timestampSeconds)}</strong>
                  )}
                </figcaption>
              </figure>
            </div>
          )}

          {selectedKeyframe && (
            <div className="video-evidence-frame-context">
              <div className="video-evidence-section-label">
                <span>Moment Context</span>
                <small>{selectedFrameFindings.length} linked finding{selectedFrameFindings.length === 1 ? '' : 's'}</small>
              </div>
              {selectedFrameFindings.length > 0 ? (
                <ul>
                  {selectedFrameFindings.map(finding => (
                    <li key={`${selectedKeyframe.fileName}:${finding.title}`}>
                      <strong>{finding.title}</strong>
                      <span>{truncateText(finding.evidence, 160)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No direct finding is tied to this exact frame. Use it as surrounding visual context for the cited flow.
                </p>
              )}
            </div>
          )}

          <div className="video-evidence-next-action-card">
            <span>Recommended Handoff</span>
            <strong>{handoff ? handoff.verdict : primaryNextStep ? 'Next support action is ready' : 'Awaiting AI next step'}</strong>
            <p>{primaryNextStep ?? handoff?.summary ?? 'The support handoff will appear here once visual diagnosis produces a concrete follow-up.'}</p>
          </div>
        </aside>
      </div>
    </section>
  ) : null;

  return (
    <section className="video-evidence-analyzer" aria-label="Video Evidence" hidden={!isActive}>
      <div className="video-evidence-summary">
        <div className="video-evidence-summary-main">
          <span className="video-evidence-badge">Video Evidence</span>
          <h2 title={fileName}>{fileName}</h2>
          <p>{visibleStatus}</p>
        </div>
        <div className="video-evidence-meta" aria-label="Video metadata">
          <span>{formatBytes(fileSize || status?.fileSize || 0)}</span>
          <span>{status?.durationSeconds ? formatDuration(status.durationSeconds) : formatDuration(null)}</span>
          <span>{mediaType || 'video/*'}</span>
          <span>{backendUrl.replace(/^https?:\/\//, '')}</span>
        </div>
        <button
          type="button"
          className="video-evidence-primary-action"
          onClick={handleRequestAnalysis}
          disabled={!canRequestAnalysis || isRequestingAnalysis}
        >
          {getActionLabel(status?.status, isRequestingAnalysis)}
        </button>
      </div>

      <div className={`video-evidence-progress-rail is-${status?.status ?? 'pending'}`} aria-label="Video analysis progress">
        <div className="video-evidence-operation-strip">
          <span className="video-evidence-operation-orb" aria-hidden="true" />
          <div className="video-evidence-progress-copy">
            <span>Analysis Progress</span>
            <strong>{activeStage?.stage ?? visibleStatus}</strong>
            <p>{getProgressDetail(status?.status)}</p>
          </div>
          <div className="video-evidence-progress-meter" aria-label={`${analysisProgress}% complete`}>
            <strong>{analysisProgress}%</strong>
            <span>{completedStageCount}/{VIDEO_STAGES.length} checks complete</span>
          </div>
        </div>
        <div className="video-evidence-progress-track" aria-hidden="true">
          <span style={{ width: `${analysisProgress}%` }} />
        </div>
        <div className="video-evidence-progress-steps">
          {stageStates.map(item => (
            <span key={item.stage} className={`is-${item.state}`}>{item.stage}</span>
          ))}
        </div>
        {compactProcessingTimings.length > 0 && (
          <div className="video-evidence-live-timings" aria-label="Live video processing timings">
            {compactProcessingTimings.map(timing => (
              <span className={`is-${timing.status}`} key={`${timing.stage}:${timing.label}`}>
                <strong>{timing.label}</strong>
                <em>{formatElapsedMs(timing.durationMs)}</em>
              </span>
            ))}
          </div>
        )}
        <div className="video-evidence-activity-strip" aria-label="Recent video analysis activity">
          <div className="video-evidence-section-label">
            <span>Live Activity</span>
            <small>{recentTimeline.length > 0 ? `${recentTimeline.length} recent event${recentTimeline.length === 1 ? '' : 's'}` : 'waiting for events'}</small>
          </div>
          <div className="video-evidence-activity-list">
            {recentTimeline.length > 0 ? recentTimeline.map(event => (
              <article key={`${event.stage}:${event.createdAt}`}>
                <span>{event.timestampSeconds == null ? 'File' : formatDuration(event.timestampSeconds)}</span>
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                </div>
              </article>
            )) : (
              <article className="is-muted">
                <span>Pending</span>
                <div>
                  <strong>{getPendingHeading(status?.status)}</strong>
                  <p>{getProgressDetail(status?.status)}</p>
                </div>
              </article>
            )}
          </div>
        </div>
      </div>

      <section
        className={`video-evidence-processing-transparency is-${processingTransparency.tone}`}
        aria-label="Processing transparency"
      >
        <div className="video-evidence-processing-current">
          <span className="video-evidence-processing-dot" aria-hidden="true" />
          <div>
            <span>Current phase</span>
            <strong>{processingTransparency.phase}</strong>
            {processingTransparency.elapsedLabel && <small>{processingTransparency.elapsedLabel}</small>}
          </div>
        </div>
        <p>{processingTransparency.message}</p>
        <div className="video-evidence-processing-groups">
          <div>
            <span>Available now</span>
            <div>
              {processingTransparency.available.map(item => <em key={`available:${item}`}>{item}</em>)}
            </div>
          </div>
          <div>
            <span>Still running</span>
            <div>
              {processingTransparency.running.length > 0
                ? processingTransparency.running.map(item => <em key={`running:${item}`}>{item}</em>)
                : <em>Nothing pending</em>}
            </div>
          </div>
        </div>
        <small>{processingTransparency.expectation}</small>
      </section>

      {(error || status?.error) && (
        <div className="video-evidence-alert" role="status">
          {error || status?.error}
        </div>
      )}

      {keyframeReview}

      {vision ? (
        <div className="video-evidence-analysis-grid">
          <section className="video-evidence-vision" aria-label="AI visual findings">
            <div className="video-evidence-card-topline">
              <span>AI Visual Findings</span>
              <small>{vision.status === 'ready' ? 'ready' : vision.status}</small>
            </div>
            <div className="video-evidence-command-strip" aria-label="Video review summary">
              <div className={`video-evidence-command-card is-${visualVerdict.tone}`}>
                <span>Verdict</span>
                <strong>{visualVerdict.label}</strong>
                <small>{visualVerdict.detail}</small>
              </div>
              <div className="video-evidence-command-card">
                <span>Visual Evidence</span>
                <strong>{evidenceCount}</strong>
                <small>cited observations</small>
              </div>
              <div className="video-evidence-command-card">
                <span>Action Plan</span>
                <strong>{nextStepCount}</strong>
                <small>support next steps</small>
              </div>
            </div>
            <div className={`video-evidence-vision-summary is-${vision.status}`}>
              <span>Visual Conclusion</span>
              <h3>What the recording proves</h3>
              <p>{vision.summary}</p>
              {vision.error && <small>{vision.error}</small>}
            </div>
            {handoff && (
              <section className={`video-evidence-handoff-panel is-${handoff.status}`} aria-label="Engineer handoff">
                <div className="video-evidence-section-label video-evidence-handoff-topline">
                  <div>
                    <span>Engineer Handoff</span>
                    <small>{handoff.status}</small>
                  </div>
                  <div className="video-evidence-handoff-actions">
                    <button type="button" onClick={handleCopyHandoff}>
                      {handoffCopyState === 'copied' ? 'Copied' : 'Copy SR Handoff'}
                    </button>
                    <button type="button" onClick={handleDownloadHandoff}>
                      Download Markdown
                    </button>
                  </div>
                </div>
                {handoffCopyState === 'failed' && (
                  <div className="video-evidence-copy-status" role="status">
                    Clipboard access was blocked. Use Download Markdown instead.
                  </div>
                )}
                <div className="video-evidence-handoff-hero">
                  <span>{handoff.title}</span>
                  <h3>{handoff.verdict}</h3>
                  <p>{handoff.summary}</p>
                </div>
                {handoff.confirmedFacts.length > 0 && (
                  <div className="video-evidence-handoff-list">
                    <span>Confirmed Facts</span>
                    <ul>
                      {handoff.confirmedFacts.map(fact => <li key={fact}>{fact}</li>)}
                    </ul>
                  </div>
                )}
                {hasHandoffCards && (
                  <div className="video-evidence-handoff-cards">
                    {handoff.evidenceCards.map((card, index) => (
                      <article key={`${card.claim}:${index}`}>
                        <div>
                          {canSeekToEvidence(card.timestampSeconds, card.frameRefs) ? (
                            <button
                              type="button"
                              onClick={() => seekToEvidence(card.timestampSeconds, card.frameRefs)}
                              aria-label={`Jump to evidence ${index + 1}${card.timestampSeconds == null ? '' : ` at ${formatDuration(card.timestampSeconds)}`}`}
                            >
                              {card.timestampSeconds == null ? 'Jump' : formatDuration(card.timestampSeconds)}
                            </button>
                          ) : (
                            <span>{card.timestampSeconds == null ? 'Evidence' : formatDuration(card.timestampSeconds)}</span>
                          )}
                          <strong>{card.claim}</strong>
                        </div>
                        <p>{card.evidence}</p>
                        {(card.frameRefs.length > 0 || card.transcriptRefs.length > 0 || card.confidence) && (
                          <div className="video-evidence-correlation-tags">
                            {card.frameRefs.map(ref => <span key={`${card.claim}:frame:${ref}`}>{ref}</span>)}
                            {card.transcriptRefs.map(ref => <span key={`${card.claim}:transcript:${ref}`}>{ref}</span>)}
                            <span>{card.confidence} confidence</span>
                          </div>
                        )}
                        {card.transcript && <blockquote>{card.transcript}</blockquote>}
                        {card.nextStep && <small>{card.nextStep}</small>}
                      </article>
                    ))}
                  </div>
                )}
                {(handoff.gaps.length > 0 || handoff.nextSteps.length > 0) && (
                  <div className="video-evidence-handoff-columns">
                    {handoff.gaps.length > 0 && (
                      <div>
                        <span>Known Gaps</span>
                        <ul>
                          {handoff.gaps.map(gap => <li key={gap}>{gap}</li>)}
                        </ul>
                      </div>
                    )}
                    {handoff.nextSteps.length > 0 && (
                      <div>
                        <span>Next Support Actions</span>
                        <ul>
                          {handoff.nextSteps.map(step => <li key={step}>{step}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
            {multimodal && (
              <section className={`video-evidence-correlation-panel is-${multimodal.status}`} aria-label="Audio and visual correlation">
                <div className="video-evidence-section-label">
                  <span>Audio + Visual Correlation</span>
                  <small>{multimodal.status}</small>
                </div>
                <h3>Combined support readout</h3>
                <p>{multimodal.summary}</p>
                {multimodal.error && <small>{multimodal.error}</small>}
                {hasMultimodalFindings && (
                  <div className="video-evidence-correlation-findings">
                    {multimodal.findings.map((finding, index) => (
                      <article key={`${finding.title}:${index}`}>
                        <div>
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          <strong>{finding.title}</strong>
                        </div>
                        <p>{finding.evidence}</p>
                        {(finding.frameRefs?.length || finding.transcriptRefs?.length || finding.confidence) && (
                          <div className="video-evidence-correlation-tags">
                            {finding.frameRefs?.map(ref => <span key={`${finding.title}:frame:${ref}`}>{ref}</span>)}
                            {finding.transcriptRefs?.map(ref => <span key={`${finding.title}:transcript:${ref}`}>{ref}</span>)}
                            {finding.confidence && <span>{finding.confidence} confidence</span>}
                          </div>
                        )}
                        {finding.action && <small>{finding.action}</small>}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
            <div className="video-evidence-diagnostic-board" aria-label="Video diagnosis depth">
              <article>
                <span>Capture Coverage</span>
                <strong>{keyframeStrategyLabel}</strong>
                <p>
                  {status?.analysis?.sceneChangesDetected
                    ? `${status.analysis.sceneChangesDetected} visual changes detected before selecting review frames.`
                    : 'Review frames were selected from the available video evidence.'}
                </p>
              </article>
              <article>
                <span>Grounding</span>
                <strong>{frameLinkedFindingCount}/{evidenceCount}</strong>
                <p>
                  {transcript?.status === 'ready'
                    ? transcript.sampled
                      ? `${transcript.segments.length} transcript segment${transcript.segments.length === 1 ? '' : 's'} from ${Math.round(transcript.coverageSeconds ?? 0)}s sampled audio.`
                      : `${transcript.segments.length} transcript segment${transcript.segments.length === 1 ? '' : 's'} also available.`
                    : 'observations include explicit frame references or frame ranges.'}
                </p>
              </article>
              <article>
                <span>Next Verification</span>
                <strong>{primaryNextStep ? 'Ready' : 'Review needed'}</strong>
                <p>{primaryNextStep ?? 'No explicit follow-up was returned by the visual diagnosis.'}</p>
              </article>
            </div>
            {processingTimings.length > 0 && (
              <section className="video-evidence-processing-timings" aria-label="Video processing timings">
                <div className="video-evidence-section-label">
                  <span>Processing Timings</span>
                  <small>{processingTimings.length} stage{processingTimings.length === 1 ? '' : 's'}</small>
                </div>
                <div>
                  {processingTimings.map(timing => (
                    <article className={`is-${timing.status}`} key={`${timing.stage}:${timing.label}`}>
                      <span>{timing.label}</span>
                      <strong>{formatElapsedMs(timing.durationMs)}</strong>
                    </article>
                  ))}
                </div>
              </section>
            )}
            <div className="video-evidence-reasoning-lane" aria-label="AI reasoning path">
              <div>
                <span>01</span>
                <strong>Screen states scanned</strong>
                <p>{keyframes.length} key screens selected from visual inflection points.</p>
              </div>
              <div>
                <span>02</span>
                <strong>Evidence grounded</strong>
                <p>{evidenceCount} observations cite visible UI states, text, or app screens.</p>
              </div>
              <div>
                <span>03</span>
                <strong>Support handoff prepared</strong>
                <p>{nextStepCount} next steps focus the follow-up evidence request.</p>
              </div>
            </div>
            {hasEvidenceTimeline && (
              <section className="video-evidence-evidence-timeline" aria-label="Audio visual evidence timeline">
                <div className="video-evidence-section-label">
                  <span>Evidence Timeline</span>
                  <small>{evidenceTimeline.length} event{evidenceTimeline.length === 1 ? '' : 's'}</small>
                </div>
                {transcript?.sampled && transcript.coverageNote && (
                  <div className="video-evidence-sampling-note">
                    {transcript.coverageNote}
                  </div>
                )}
                <div className="video-evidence-evidence-events">
                  {evidenceTimeline.map((event, index) => (
                    <article className={`is-${event.kind}`} key={`${event.kind}:${event.timestampSeconds}:${index}`}>
                      {canSeekToEvidence(event.timestampSeconds, event.frameRefs) ? (
                        <button
                          type="button"
                          className="video-evidence-event-jump"
                          onClick={() => seekToEvidence(event.timestampSeconds, event.frameRefs)}
                          aria-label={`Jump to timeline event ${index + 1}${event.timestampSeconds == null ? '' : ` at ${formatDuration(event.timestampSeconds)}`}`}
                        >
                          {event.timestampSeconds == null ? 'Jump' : formatDuration(event.timestampSeconds)}
                        </button>
                      ) : (
                        <time>{event.timestampSeconds == null ? 'Time pending' : formatDuration(event.timestampSeconds)}</time>
                      )}
                      <div>
                        <div className="video-evidence-event-heading">
                          <span>{getTimelineKindLabel(event.kind)}</span>
                          <strong>{event.title}</strong>
                        </div>
                        <p>{event.detail}</p>
                        {(event.transcript || event.frameRefs?.length || event.transcriptRefs?.length || event.confidence) && (
                          <div className="video-evidence-event-evidence">
                            {event.transcript && <span>{event.transcript}</span>}
                            {event.frameRefs?.map(ref => <small key={`${event.title}:${ref}`}>{ref}</small>)}
                            {event.transcriptRefs?.map(ref => <small key={`${event.title}:transcript:${ref}`}>{ref}</small>)}
                            <small>{event.confidence} confidence</small>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {hasVisionFindings && (
              <div className="video-evidence-finding-list">
                <div className="video-evidence-section-label">
                  <span>Observed Evidence</span>
                  <small>{evidenceCount} item{evidenceCount === 1 ? '' : 's'}</small>
                </div>
                {vision.findings.map((finding, index) => (
                  <article
                    className="video-evidence-finding"
                    key={`${finding.title}:${index}`}
                    style={{ '--video-evidence-order': index } as React.CSSProperties}
                  >
                    <span className="video-evidence-finding-index">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <h4>{finding.title}</h4>
                      {getFindingFrameRefs(finding).length > 0 && (
                        <div className="video-evidence-frame-tags" aria-label="Finding frame references">
                          {getFindingFrameRefs(finding).map(ref => <span key={`${finding.title}:${ref}`}>{ref}</span>)}
                        </div>
                      )}
                      <p>{finding.evidence}</p>
                    </div>
                    {finding.action && (
                      <strong>
                        <span>Follow-up</span>
                        {finding.action}
                      </strong>
                    )}
                  </article>
                ))}
              </div>
            )}
            {hasVisionNextSteps && (
              <div className="video-evidence-next-steps">
                <div className="video-evidence-section-label">
                  <span>Next Steps</span>
                  <small>{nextStepCount} action{nextStepCount === 1 ? '' : 's'}</small>
                </div>
                <ul>
                  {vision.nextSteps.map(step => <li key={step}>{step}</li>)}
                </ul>
              </div>
            )}
          </section>

        </div>
      ) : null}

      <details className="video-evidence-technical-drawer" open={shouldOpenTechnicalTrail}>
        <summary>
          <span>Technical Processing Trail</span>
          <small>{timeline.length} event{timeline.length === 1 ? '' : 's'} - {isLoading ? 'refreshing' : status?.status ?? 'pending'}</small>
        </summary>

        <div className="video-evidence-layout">
          <div className="video-evidence-stage-panel">
            <div className="video-evidence-panel-heading">
              <h3>Evidence Pipeline</h3>
              <span>{isLoading ? 'Refreshing' : status?.status ?? 'pending'}</span>
            </div>
            <div className="video-evidence-stages" aria-label="Video evidence stages">
              {stageStates.map(item => (
                <div
                  key={item.stage}
                  className={`video-evidence-stage is-${item.state}`}
                >
                  <span className="video-evidence-stage-dot" aria-hidden="true" />
                  <span>{item.stage}</span>
                </div>
              ))}
            </div>
            {status?.ffprobeAvailable === false && (
              <div className="video-evidence-capability-note">
                Video was accepted. Install or expose `ffprobe` and `ffmpeg` on the backend host for exact duration, stream metadata, and key-screen extraction.
              </div>
            )}
          </div>

          <div className="video-evidence-timeline-panel">
            <div className="video-evidence-panel-heading">
              <h3>Evidence Timeline</h3>
              <span>{timeline.length} event{timeline.length === 1 ? '' : 's'}</span>
            </div>
            {timeline.length === 0 ? (
              <div className="video-evidence-empty-timeline">
                Preparation events will appear here as transcript, screen-change, and key-screen passes are added.
              </div>
            ) : (
              <div className="video-evidence-timeline-list">
                {timeline.map((event, index) => (
                  <article className="video-evidence-timeline-event" key={`${event.stage}:${event.createdAt}:${index}`}>
                    <span className="video-evidence-time">
                      {event.timestampSeconds == null ? 'File' : formatDuration(event.timestampSeconds)}
                    </span>
                    <div>
                      <h4>{event.title}</h4>
                      <p>{event.detail}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </details>

    </section>
  );
};

export default VideoEvidenceAnalyzer;
