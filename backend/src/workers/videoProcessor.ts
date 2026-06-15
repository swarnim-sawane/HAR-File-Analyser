import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { File, FormData } from 'undici';
import { getMongoDb, getRedis } from '../config/database';
import { publishToFile } from '../utils/socketHelper';

const execFileAsync = promisify(execFile);
const DEFAULT_KEYFRAME_LIMIT = 12;
const DEFAULT_SCENE_THRESHOLD = 0.1;
const DEFAULT_SCENE_MIN_GAP_SECONDS = 5;
const DEFAULT_KEYFRAME_EXTRACTION_TIMEOUT_MS = 180000;
const DEFAULT_AUDIO_EXTRACTION_TIMEOUT_MS = 300000;
const DEFAULT_TRANSCRIPTION_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const DEFAULT_LOCAL_WHISPER_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_FAST_TRANSCRIPT_MAX_SECONDS = 180;
const DEFAULT_FAST_TRANSCRIPT_WINDOW_SECONDS = 45;
const DEFAULT_FAST_SCENE_DETECT_FPS = 1;

interface VideoJobData {
  fileId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileType: string;
  hash: string;
  uploadedAt: string;
}

interface VideoMetadata {
  durationSeconds: number | null;
  ffprobeAvailable: boolean;
  streams: Array<{
    codecType?: string;
    codecName?: string;
    width?: number;
    height?: number;
  }>;
}

interface VideoKeyframe {
  fileName: string;
  relativePath: string;
  timestampSeconds: number | null;
}

interface VideoKeyframeExtraction {
  keyframes: VideoKeyframe[];
  sceneChangesDetected: number;
  selectedTimestamps: number[];
}

interface VideoVisionResult {
  status: 'ready' | 'not_configured' | 'error';
  summary: string;
  findings: Array<{
    title: string;
    evidence: string;
    action?: string;
    severity?: string;
    frameRefs?: string[];
  }>;
  nextSteps: string[];
  model?: string;
  error?: string;
}

interface VideoTranscriptSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
  speaker?: string;
}

interface VideoTranscriptResult {
  status: 'ready' | 'not_configured' | 'no_audio' | 'error';
  summary?: string;
  segments: VideoTranscriptSegment[];
  model?: string;
  audioFileName?: string;
  sampled?: boolean;
  coverageSeconds?: number;
  coverageNote?: string;
  sampleWindows?: VideoAudioWindow[];
  error?: string;
}

interface VideoTranscriptCacheCandidate {
  provider: string;
  model: string;
}

interface VideoEvidenceTimelineItem {
  kind: 'statement' | 'visual' | 'correlation';
  timestampSeconds: number | null;
  endTimestampSeconds?: number | null;
  title: string;
  detail: string;
  transcript?: string;
  frameRefs?: string[];
  transcriptRefs?: string[];
  confidence: 'high' | 'medium' | 'low';
}

interface VideoProcessingTiming {
  stage: string;
  label: string;
  durationMs: number;
  status: 'complete' | 'partial' | 'error';
}

interface VideoAudioWindow {
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  sampleStartSeconds: number;
  sampleEndSeconds: number;
}

interface TranscribeAudioOptions {
  sampleWindows?: VideoAudioWindow[];
}

interface VideoMultimodalResult {
  status: 'ready' | 'partial' | 'not_configured' | 'error';
  summary: string;
  findings: Array<{
    title: string;
    evidence: string;
    action?: string;
    frameRefs?: string[];
    transcriptRefs?: string[];
    confidence?: string;
  }>;
  nextSteps: string[];
  model?: string;
  error?: string;
}

interface VideoSupportHandoff {
  status: 'ready' | 'partial';
  title: string;
  summary: string;
  verdict: string;
  confirmedFacts: string[];
  evidenceCards: Array<{
    claim: string;
    evidence: string;
    timestampSeconds: number | null;
    frameRefs: string[];
    transcriptRefs: string[];
    transcript?: string;
    confidence: 'high' | 'medium' | 'low';
    nextStep?: string;
  }>;
  gaps: string[];
  nextSteps: string[];
  timings: VideoProcessingTiming[];
}

async function probeVideo(filePath: string): Promise<VideoMetadata> {
  try {
    const output = await execFileAsync(
      process.env.FFPROBE_PATH || 'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,codec_name,width,height',
        '-of',
        'json',
        filePath,
      ],
      { timeout: 15000 }
    );
    const stdout = typeof output === 'string'
      ? output
      : typeof (output as { stdout?: unknown }).stdout === 'string'
        ? (output as { stdout: string }).stdout
        : '';
    const parsed = JSON.parse(stdout || '{}') as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
      }>;
    };
    const duration = Number.parseFloat(parsed.format?.duration ?? '');

    return {
      durationSeconds: Number.isFinite(duration) ? duration : null,
      ffprobeAvailable: true,
      streams: (parsed.streams ?? []).map(stream => ({
        codecType: stream.codec_type,
        codecName: stream.codec_name,
        width: stream.width,
        height: stream.height,
      })),
    };
  } catch (error) {
    console.warn('Video ffprobe metadata unavailable:', error instanceof Error ? error.message : error);
    return {
      durationSeconds: null,
      ffprobeAvailable: false,
      streams: [],
    };
  }
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['-version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function getPositiveIntEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getPositiveFloatEnv(name: string, fallback: number): number {
  const value = Number.parseFloat(process.env[name] ?? '');
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getBooleanEnv(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(process.env[name]?.trim() ?? '');
}

function getBooleanEnvDefault(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return fallback;
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

function videoLog(fileId: string, stage: string, details: Record<string, unknown> = {}): void {
  console.info(`[video:${fileId}] ${stage}`, {
    at: new Date().toISOString(),
    ...details,
  });
}

function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0';
  return seconds.toFixed(3).replace(/\.?0+$/, '');
}

function formatTranscriptRef(segment: VideoTranscriptSegment): string {
  return `${formatTimestamp(segment.startSeconds)}s-${formatTimestamp(segment.endSeconds)}s`;
}

function normalizeWhitespace(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function uniqueStrings(values: Array<string | undefined | null>, limit = 12): string[] {
  return Array.from(new Set(
    values
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.trim())
      .filter(Boolean)
  )).slice(0, limit);
}

function recordTiming(
  timings: VideoProcessingTiming[],
  stage: string,
  label: string,
  startedAt: number,
  status: VideoProcessingTiming['status'] = 'complete'
): void {
  timings.push({
    stage,
    label,
    durationMs: elapsedMs(startedAt),
    status,
  });
}

function hasAudioStream(metadata: VideoMetadata): boolean {
  return metadata.streams.some(stream => stream.codecType === 'audio');
}

function isFastVideoAnalysisEnabled(): boolean {
  return getBooleanEnvDefault('VIDEO_FAST_MODE_ENABLED', true);
}

function normalizeTranscriptSecond(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
  }
  return null;
}

function normalizeTranscriptSegments(parsed: any): VideoTranscriptSegment[] {
  const rawSegments = Array.isArray(parsed?.segments) ? parsed.segments : [];
  if (rawSegments.length === 0 && typeof parsed?.text === 'string' && parsed.text.trim()) {
    return [{
      startSeconds: 0,
      endSeconds: 0,
      text: parsed.text.trim(),
    }];
  }

  return rawSegments
    .map((segment: Record<string, unknown>) => {
      const startSeconds = normalizeTranscriptSecond(
        segment.startSeconds ?? segment.start_seconds ?? segment.start ?? segment.startMs
      );
      const rawEndSeconds = normalizeTranscriptSecond(
        segment.endSeconds ?? segment.end_seconds ?? segment.end ?? segment.endMs
      );
      const text = typeof segment.text === 'string' ? segment.text.trim() : '';
      if (startSeconds == null || !text) return null;
      const endSeconds = rawEndSeconds == null
        ? startSeconds
        : rawEndSeconds > 1000 && rawEndSeconds > startSeconds * 100
          ? rawEndSeconds / 1000
          : rawEndSeconds;

      return {
        startSeconds,
        endSeconds: Math.max(startSeconds, endSeconds),
        text,
        speaker: typeof segment.speaker === 'string' && segment.speaker.trim()
          ? segment.speaker.trim()
          : undefined,
      };
    })
    .filter((segment: VideoTranscriptSegment | null): segment is VideoTranscriptSegment => Boolean(segment))
    .slice(0, getPositiveIntEnv('VIDEO_TRANSCRIPT_SEGMENT_LIMIT', 240));
}

function transcriptSummary(parsed: Record<string, unknown>, segments: VideoTranscriptSegment[]): string {
  if (typeof parsed.summary === 'string' && parsed.summary.trim()) return parsed.summary.trim();
  if (typeof parsed.text === 'string' && parsed.text.trim()) return parsed.text.trim().slice(0, 600);
  return `${segments.length} transcript segment${segments.length === 1 ? '' : 's'} extracted.`;
}

function transcriptTitle(segment: VideoTranscriptSegment): string {
  const prefix = segment.speaker ? `${segment.speaker}: ` : '';
  const compact = segment.text.replace(/\s+/g, ' ').trim();
  const clipped = compact.length > 78 ? `${compact.slice(0, 75).trim()}...` : compact;
  return `${prefix}${clipped}`;
}

function nearestKeyframe(
  keyframes: VideoKeyframe[],
  timestampSeconds: number,
  maxDistanceSeconds = 20
): VideoKeyframe | null {
  if (keyframes.length === 0) return null;
  const candidates = keyframes
    .filter(frame => frame.timestampSeconds != null && Number.isFinite(frame.timestampSeconds))
    .map(frame => ({
      frame,
      distance: Math.abs((frame.timestampSeconds ?? 0) - timestampSeconds),
    }))
    .sort((a, b) => a.distance - b.distance);

  const nearest = candidates[0];
  return nearest && nearest.distance <= maxDistanceSeconds ? nearest.frame : null;
}

function parseFrameNumbers(text: string): number[] {
  const numbers = new Set<number>();
  const matches = text.matchAll(/\bframes?\s*0*(\d+)(?:\s*(?:-|to|through)\s*0*(\d+))?/gi);

  for (const match of matches) {
    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : start;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    for (let value = low; value <= high && value <= low + 8; value += 1) {
      numbers.add(value);
    }
  }

  return Array.from(numbers);
}

function frameRefsFromFinding(finding: VideoVisionResult['findings'][number]): string[] {
  const explicit = Array.isArray(finding.frameRefs) ? finding.frameRefs : [];
  const parsed = parseFrameNumbers([finding.title, finding.evidence, ...explicit].join(' '))
    .map(number => `Frame ${number}`);
  return Array.from(new Set([...explicit, ...parsed])).slice(0, 6);
}

function timestampForFrameRefs(frameRefs: string[], keyframes: VideoKeyframe[]): number | null {
  const frameNumbers = frameRefs.flatMap(parseFrameNumbers);
  for (const frameNumber of frameNumbers) {
    const frame = keyframes[frameNumber - 1];
    if (frame?.timestampSeconds != null) return frame.timestampSeconds;
  }
  return null;
}

function keyframeLabel(keyframes: VideoKeyframe[], frame: VideoKeyframe): string {
  const index = keyframes.findIndex(candidate => candidate.fileName === frame.fileName);
  return index >= 0 ? `Frame ${index + 1}` : frame.fileName;
}

function keyframeForFrameRef(frameRef: string, keyframes: VideoKeyframe[]): VideoKeyframe | null {
  const frameNumber = parseFrameNumbers(frameRef)[0];
  if (frameNumber != null && keyframes[frameNumber - 1]) return keyframes[frameNumber - 1];

  return keyframes.find(frame => frame.fileName === frameRef) ?? null;
}

function findingForKeyframe(
  frame: VideoKeyframe,
  keyframes: VideoKeyframe[],
  findings: VideoVisionResult['findings']
): VideoVisionResult['findings'][number] | null {
  const label = keyframeLabel(keyframes, frame);
  return findings.find(finding => {
    const refs = frameRefsFromFinding(finding);
    return refs.includes(label) || refs.includes(frame.fileName);
  }) ?? null;
}

function buildEvidenceTimeline(
  transcript: VideoTranscriptResult,
  vision: VideoVisionResult,
  keyframes: VideoKeyframe[]
): VideoEvidenceTimelineItem[] {
  const transcriptEvents: VideoEvidenceTimelineItem[] = transcript.segments.map(segment => {
    const frame = nearestKeyframe(keyframes, segment.startSeconds);
    return {
      kind: 'statement',
      timestampSeconds: segment.startSeconds,
      endTimestampSeconds: segment.endSeconds,
      title: transcriptTitle(segment),
      detail: segment.text,
      transcript: segment.text,
      frameRefs: frame ? [frame.fileName] : [],
      transcriptRefs: [formatTranscriptRef(segment)],
      confidence: frame ? 'high' : 'medium',
    };
  });

  const visualEvents: VideoEvidenceTimelineItem[] = vision.findings.map(finding => {
    const frameRefs = frameRefsFromFinding(finding);
    return {
      kind: 'visual',
      timestampSeconds: timestampForFrameRefs(frameRefs, keyframes),
      title: finding.title,
      detail: finding.evidence,
      frameRefs,
      confidence: 'medium',
    };
  });

  const correlationEvents: VideoEvidenceTimelineItem[] = transcript.segments.flatMap(segment => {
    const frame = nearestKeyframe(keyframes, segment.startSeconds);
    if (!frame) return [];

    const finding = findingForKeyframe(frame, keyframes, vision.findings);
    if (!finding) return [];

    const frameRef = keyframeLabel(keyframes, frame);
    const frameTime = frame.timestampSeconds ?? segment.startSeconds;
    const distanceSeconds = Math.abs(frameTime - segment.startSeconds);
    const transcriptRef = formatTranscriptRef(segment);

    return [{
      kind: 'correlation' as const,
      timestampSeconds: Math.min(segment.startSeconds, frameTime),
      endTimestampSeconds: Math.max(segment.endSeconds, frameTime),
      title: `Spoken context aligns with ${finding.title}`,
      detail: `Transcript window ${transcriptRef} says "${normalizeWhitespace(segment.text, 140)}" while ${frameRef} shows ${normalizeWhitespace(finding.evidence, 180)}`,
      transcript: segment.text,
      frameRefs: uniqueStrings([frameRef, frame.fileName]),
      transcriptRefs: [transcriptRef],
      confidence: distanceSeconds <= 12 ? 'high' : 'medium',
    }];
  });

  return [...transcriptEvents, ...visualEvents, ...correlationEvents]
    .sort((left, right) => {
      const leftTime = left.timestampSeconds ?? Number.POSITIVE_INFINITY;
      const rightTime = right.timestampSeconds ?? Number.POSITIVE_INFINITY;
      if (leftTime !== rightTime) return leftTime - rightTime;
      const order = { statement: 0, visual: 1, correlation: 2 };
      return order[left.kind] - order[right.kind];
    })
    .slice(0, getPositiveIntEnv('VIDEO_EVIDENCE_TIMELINE_LIMIT', 120));
}

function parseSceneTimestamps(stderr: string): number[] {
  const timestamps: number[] = [];
  const pattern = /pts_time:\s*([0-9]+(?:\.[0-9]+)?)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(stderr)) !== null) {
    const seconds = Number.parseFloat(match[1]);
    if (Number.isFinite(seconds) && seconds >= 0) {
      timestamps.push(seconds);
    }
  }

  return timestamps;
}

function selectKeyframeTimestamps(
  sceneTimestamps: number[],
  durationSeconds: number | null,
  maxFrames = getPositiveIntEnv('VIDEO_KEYFRAME_LIMIT', DEFAULT_KEYFRAME_LIMIT),
  minGapSeconds = getPositiveFloatEnv('VIDEO_KEYFRAME_MIN_GAP_SECONDS', DEFAULT_SCENE_MIN_GAP_SECONDS)
): number[] {
  const durationLimit = durationSeconds != null && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : Number.POSITIVE_INFINITY;
  const uniqueCandidates = [0, ...sceneTimestamps]
    .filter(seconds => Number.isFinite(seconds) && seconds >= 0 && seconds <= durationLimit + 0.5)
    .map(seconds => Math.max(0, Number(seconds.toFixed(3))))
    .sort((a, b) => a - b)
    .filter((seconds, index, sorted) => index === 0 || Math.abs(seconds - sorted[index - 1]) >= 0.25);

  const selected: number[] = [];
  for (const seconds of uniqueCandidates) {
    const last = selected[selected.length - 1];
    if (last == null || seconds - last >= minGapSeconds) {
      selected.push(seconds);
    }
  }

  if (selected.length === 0) return [0];
  if (selected.length <= maxFrames) return selected;
  if (maxFrames === 1) return [selected[0]];

  const distributed: number[] = [];
  const firstTimestamp = selected[0];
  const lastTimestamp = selected[selected.length - 1];
  for (let index = 0; index < maxFrames; index += 1) {
    const target = firstTimestamp + ((lastTimestamp - firstTimestamp) * index) / (maxFrames - 1);
    const seconds = selected.reduce((best, candidate) => {
      if (distributed.includes(candidate)) return best;
      return Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best;
    }, selected.find(candidate => !distributed.includes(candidate)) ?? selected[0]);

    if (!distributed.includes(seconds)) {
      distributed.push(seconds);
    }
  }

  return distributed.sort((a, b) => a - b);
}

function selectDistributedValues(values: number[], limit: number): number[] {
  const uniqueValues = Array.from(new Set(
    values
      .filter(value => Number.isFinite(value) && value >= 0)
      .map(value => Number(value.toFixed(3)))
  )).sort((a, b) => a - b);

  if (uniqueValues.length <= limit) return uniqueValues;
  if (limit <= 1) return [uniqueValues[0]];

  const selected: number[] = [];
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index * (uniqueValues.length - 1)) / (limit - 1));
    const value = uniqueValues[sourceIndex];
    if (!selected.includes(value)) selected.push(value);
  }

  return selected;
}

function buildFastAudioWindows(metadata: VideoMetadata, keyframes: VideoKeyframe[]): VideoAudioWindow[] {
  const maxCoverageSeconds = getPositiveIntEnv('VIDEO_FAST_TRANSCRIPT_MAX_SECONDS', DEFAULT_FAST_TRANSCRIPT_MAX_SECONDS);
  const windowSeconds = Math.min(
    maxCoverageSeconds,
    getPositiveIntEnv('VIDEO_FAST_TRANSCRIPT_WINDOW_SECONDS', DEFAULT_FAST_TRANSCRIPT_WINDOW_SECONDS)
  );
  const durationSeconds = metadata.durationSeconds != null && Number.isFinite(metadata.durationSeconds)
    ? Math.max(0, metadata.durationSeconds)
    : null;
  const maxWindowCount = Math.max(1, Math.floor(maxCoverageSeconds / Math.max(1, windowSeconds)));

  if (durationSeconds != null && durationSeconds <= maxCoverageSeconds) {
    return [{
      sourceStartSeconds: 0,
      sourceEndSeconds: durationSeconds,
      sampleStartSeconds: 0,
      sampleEndSeconds: durationSeconds,
    }];
  }

  const fallbackCenters = durationSeconds == null
    ? [0]
    : [0, durationSeconds * 0.33, durationSeconds * 0.66, Math.max(0, durationSeconds - windowSeconds)];
  const keyframeCenters = keyframes
    .map(frame => frame.timestampSeconds)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const centers = selectDistributedValues(keyframeCenters.length > 0 ? keyframeCenters : fallbackCenters, maxWindowCount);
  const rawWindows = centers.map(center => {
    const unclampedStart = center <= windowSeconds / 2 ? 0 : center - windowSeconds / 2;
    const maxStart = durationSeconds == null ? unclampedStart : Math.max(0, durationSeconds - windowSeconds);
    const sourceStartSeconds = Math.max(0, Math.min(unclampedStart, maxStart));
    const sourceEndSeconds = durationSeconds == null
      ? sourceStartSeconds + windowSeconds
      : Math.min(durationSeconds, sourceStartSeconds + windowSeconds);

    return {
      sourceStartSeconds: Number(sourceStartSeconds.toFixed(3)),
      sourceEndSeconds: Number(sourceEndSeconds.toFixed(3)),
    };
  }).filter(window => window.sourceEndSeconds - window.sourceStartSeconds > 0.25);

  const merged = rawWindows
    .sort((left, right) => left.sourceStartSeconds - right.sourceStartSeconds)
    .reduce<Array<{ sourceStartSeconds: number; sourceEndSeconds: number }>>((accumulator, current) => {
      const previous = accumulator[accumulator.length - 1];
      if (!previous || current.sourceStartSeconds - previous.sourceEndSeconds > 2) {
        accumulator.push({ ...current });
        return accumulator;
      }
      previous.sourceEndSeconds = Math.max(previous.sourceEndSeconds, current.sourceEndSeconds);
      return accumulator;
    }, []);

  const windows: VideoAudioWindow[] = [];
  let sampleCursor = 0;
  for (const window of merged) {
    if (sampleCursor >= maxCoverageSeconds) break;
    const remainingBudget = maxCoverageSeconds - sampleCursor;
    const sourceDuration = Math.min(window.sourceEndSeconds - window.sourceStartSeconds, remainingBudget);
    if (sourceDuration <= 0.25) continue;
    windows.push({
      sourceStartSeconds: window.sourceStartSeconds,
      sourceEndSeconds: Number((window.sourceStartSeconds + sourceDuration).toFixed(3)),
      sampleStartSeconds: Number(sampleCursor.toFixed(3)),
      sampleEndSeconds: Number((sampleCursor + sourceDuration).toFixed(3)),
    });
    sampleCursor += sourceDuration;
  }

  return windows;
}

function remapSampleTranscriptToSource(
  transcript: VideoTranscriptResult,
  sampleWindows: VideoAudioWindow[]
): VideoTranscriptResult {
  if (transcript.status !== 'ready' || sampleWindows.length === 0) return transcript;

  const remappedSegments = transcript.segments.map(segment => {
    const window = sampleWindows.find(candidate =>
      segment.startSeconds >= candidate.sampleStartSeconds - 0.25
      && segment.startSeconds <= candidate.sampleEndSeconds + 0.25
    ) ?? sampleWindows[0];
    const mappedStart = window.sourceStartSeconds + Math.max(0, segment.startSeconds - window.sampleStartSeconds);
    const mappedEnd = window.sourceStartSeconds + Math.max(0, segment.endSeconds - window.sampleStartSeconds);

    return {
      ...segment,
      startSeconds: Number(mappedStart.toFixed(3)),
      endSeconds: Number(Math.max(mappedStart, mappedEnd).toFixed(3)),
    };
  });
  const coverageSeconds = Number(
    sampleWindows.reduce((total, window) => total + Math.max(0, window.sourceEndSeconds - window.sourceStartSeconds), 0).toFixed(3)
  );

  return {
    ...transcript,
    sampled: true,
    coverageSeconds,
    coverageNote: `Fast transcript sampled ${Math.round(coverageSeconds)} seconds around key visual moments. Full-session audio was not required for the first diagnosis pass.`,
    segments: remappedSegments,
    sampleWindows,
  };
}

async function updateFileStatus(fileId: string, status: string, extra?: Record<string, unknown>): Promise<void> {
  const redis = getRedis();
  const metadata = await redis.get(`file:${fileId}:metadata`);
  if (metadata) {
    const data = JSON.parse(metadata);
    data.status = status;
    if (extra) {
      Object.assign(data, extra);
    }
    await redis.setex(`file:${fileId}:metadata`, 86400, JSON.stringify(data));
  }

  await publishToFile(fileId, 'file:status', { status, ...extra });
}

async function updateVideoFile(
  fileId: string,
  status: string,
  extra?: Record<string, unknown>
): Promise<void> {
  const db = getMongoDb();
  await db.collection('video_files').updateOne(
    { fileId },
    {
      $set: {
        status,
        updatedAt: new Date(),
        ...(extra ?? {}),
      },
    }
  );

  await updateFileStatus(fileId, status, extra);
}

async function addTimelineEvent(
  fileId: string,
  stage: string,
  title: string,
  detail: string,
  timestampSeconds: number | null = null
): Promise<void> {
  const db = getMongoDb();
  const event = {
    fileId,
    stage,
    title,
    detail,
    timestampSeconds,
    createdAt: new Date(),
  };

  await db.collection('video_timeline').insertOne(event);
  await publishToFile(fileId, 'video:timeline', event);
}

export async function markVideoEvidenceJobFailed(
  data: VideoJobData,
  errorMessage: string,
  jobName?: string
): Promise<void> {
  const isAnalysisJob = jobName === 'analyze_video_evidence';
  const title = isAnalysisJob ? 'Video analysis failed' : 'Video preparation failed';
  videoLog(data.fileId, 'job:failed', {
    jobName: jobName || 'unknown',
    error: errorMessage,
  });

  await updateVideoFile(data.fileId, 'error', {
    error: errorMessage,
    ...(isAnalysisJob ? { analysisCompletedAt: new Date() } : {}),
  });
  await addTimelineEvent(
    data.fileId,
    'error',
    title,
    errorMessage
  );
}

export async function processVideoFile(data: VideoJobData): Promise<void> {
  const { fileId, fileName, filePath, fileSize } = data;
  const startedAt = Date.now();
  console.log(`Processing video evidence: ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
  videoLog(fileId, 'prepare:start', {
    fileName,
    fileSize,
    fileType: data.fileType,
  });

  try {
    await updateFileStatus(fileId, 'preparing');
    await addTimelineEvent(
      fileId,
      'uploaded',
      'Video uploaded',
      'Recording accepted into the evidence workspace.'
    );

    const metadata = await probeVideo(filePath);
    videoLog(fileId, 'prepare:metadata', {
      durationSeconds: metadata.durationSeconds,
      streams: metadata.streams.length,
      ffprobeAvailable: metadata.ffprobeAvailable,
      durationMs: elapsedMs(startedAt),
    });
    await addTimelineEvent(
      fileId,
      'prepared',
      metadata.ffprobeAvailable ? 'Video metadata prepared' : 'Video prepared without stream metadata',
      metadata.ffprobeAvailable
        ? 'Duration and stream metadata are ready for the evidence analysis pass.'
        : 'The backend could not access ffprobe, so deep video metadata will be populated when ffprobe is configured.'
    );

    const db = getMongoDb();
    await db.collection('video_files').updateOne(
      { fileId },
      {
        $set: {
          fileId,
          fileName,
          filePath,
          fileSize,
          fileType: data.fileType,
          hash: data.hash,
          metadata,
          uploadedAt: new Date(data.uploadedAt),
          processedAt: new Date(),
          status: 'ready',
        },
      },
      { upsert: true }
    );

    await updateFileStatus(fileId, 'ready', {
      metadata,
      ffprobeAvailable: metadata.ffprobeAvailable,
      durationSeconds: metadata.durationSeconds,
    });
    console.log(`Video evidence preparation complete: ${fileId}`);
    videoLog(fileId, 'prepare:complete', {
      durationMs: elapsedMs(startedAt),
      status: 'ready',
    });
  } catch (error) {
    console.error(`Video evidence preparation failed for ${fileId}:`, error);
    videoLog(fileId, 'prepare:error', {
      durationMs: elapsedMs(startedAt),
      error: error instanceof Error ? error.message : String(error),
    });
    await updateFileStatus(fileId, 'error', { error: (error as Error).message });
    throw error;
  }
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return trimmed;
}

function isGenericVisionTitle(value: string): boolean {
  return /^(visual finding|finding|observed screen state)$/i.test(value.trim());
}

function titleFromEvidence(evidence: string): string {
  const firstSentence = evidence
    .trim()
    .replace(/^frames?\s+[\d,\-\s]+(?:and\s+\d+\s+)?(?:show|shows|showing)\s+/i, '')
    .split(/(?<=[.!?])\s+/)[0]
    .replace(/[.!?]+$/, '')
    .trim();

  if (!firstSentence) return 'Observed screen state';
  return firstSentence.length > 92 ? `${firstSentence.slice(0, 89).trim()}...` : firstSentence;
}

function parseVisionPayload(text: string): VideoVisionResult {
  const candidate = extractJsonCandidate(text);
  if (!candidate) throw new Error('No JSON content returned from video vision model');
  const parsed = JSON.parse(candidate);
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const nextSteps = Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [];

  return {
    status: 'ready',
    summary: typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : 'AI reviewed the extracted video frames.',
    findings: findings.map((finding: Record<string, unknown>) => {
      const titleCandidate = finding.title ?? finding.observation ?? finding.issue ?? finding.summary;
      const evidence = typeof finding.evidence === 'string' ? finding.evidence : '';
      const normalizedTitle = typeof titleCandidate === 'string' ? titleCandidate.trim() : '';

      return {
        title: normalizedTitle && !isGenericVisionTitle(normalizedTitle)
          ? normalizedTitle
          : titleFromEvidence(evidence),
        evidence,
        action: typeof finding.action === 'string' ? finding.action : undefined,
        severity: typeof finding.severity === 'string' ? finding.severity : undefined,
        frameRefs: Array.isArray(finding.frameRefs)
          ? finding.frameRefs.filter((value: unknown): value is string => typeof value === 'string')
          : undefined,
      };
    }),
    nextSteps: nextSteps.filter((value: unknown): value is string => typeof value === 'string'),
  };
}

function parseMultimodalPayload(text: string, fallbackSummary: string): VideoMultimodalResult {
  const candidate = extractJsonCandidate(text);
  if (!candidate) throw new Error('No JSON content returned from multimodal model');
  const parsed = JSON.parse(candidate);
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const nextSteps = Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [];

  return {
    status: 'ready',
    summary: typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : fallbackSummary,
    findings: findings.map((finding: Record<string, unknown>) => ({
      title: typeof finding.title === 'string' && finding.title.trim()
        ? finding.title.trim()
        : titleFromEvidence(typeof finding.evidence === 'string' ? finding.evidence : ''),
      evidence: typeof finding.evidence === 'string' ? finding.evidence : '',
      action: typeof finding.action === 'string' ? finding.action : undefined,
      frameRefs: Array.isArray(finding.frameRefs)
        ? finding.frameRefs.filter((value: unknown): value is string => typeof value === 'string')
        : undefined,
      transcriptRefs: Array.isArray(finding.transcriptRefs)
        ? finding.transcriptRefs.filter((value: unknown): value is string => typeof value === 'string')
        : undefined,
      confidence: typeof finding.confidence === 'string' ? finding.confidence : undefined,
    })),
    nextSteps: nextSteps.filter((value: unknown): value is string => typeof value === 'string'),
  };
}

function parseTranscriptPayload(text: string): { summary: string; segments: VideoTranscriptSegment[] } {
  const candidate = extractJsonCandidate(text);
  if (!candidate) throw new Error('No JSON content returned from audio transcription model');
  const parsed = JSON.parse(candidate) as Record<string, unknown>;
  const segments = normalizeTranscriptSegments(parsed);

  return {
    summary: transcriptSummary(parsed, segments),
    segments,
  };
}

async function readOcaStreamContent(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('OCA returned no response body.');

  const decoder = new TextDecoder();
  let buf = '';
  let accumulatedContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed?.choices?.[0]?.delta?.content;
        const message = parsed?.choices?.[0]?.message?.content;
        const content = typeof delta === 'string' ? delta
          : typeof message === 'string' ? message
          : '';
        if (content) accumulatedContent += content;
      } catch {
        // Skip malformed streaming chunks.
      }
    }
  }

  return accumulatedContent;
}

async function analyzeKeyframesWithVision(
  data: VideoJobData,
  keyframes: VideoKeyframe[],
  metadata: VideoMetadata
): Promise<VideoVisionResult> {
  const ocaBaseUrl = process.env.OCA_BASE_URL;
  const ocaToken = process.env.OCA_TOKEN;
  const model = process.env.OCA_MODEL || 'oca/gpt-5.4';

  if (!ocaBaseUrl || !ocaToken) {
    return {
      status: 'not_configured',
      summary: 'Key screens were extracted, but OCA vision is not configured for this backend.',
      findings: [],
      nextSteps: ['Configure OCA_BASE_URL and OCA_TOKEN, then re-run video analysis.'],
      model,
      error: 'OCA is not configured.',
    };
  }

  const keyframeDir = path.join(path.dirname(data.filePath), `${data.fileId}_keyframes`);
  const selectedFrames = keyframes.slice(0, Number.parseInt(process.env.VIDEO_VISION_FRAME_LIMIT || '8', 10));
  const frameContent = await Promise.all(selectedFrames.map(async (frame, index) => {
    const bytes = await fs.readFile(path.join(keyframeDir, frame.fileName));
    return [
      {
        type: 'text',
        text: `Frame ${index + 1}: ${frame.fileName}${frame.timestampSeconds == null ? '' : ` at ~${frame.timestampSeconds}s`}`,
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${bytes.toString('base64')}`,
        },
      },
    ];
  }));

  const messages = [
    {
      role: 'system',
      content: 'You are a support engineer analyzing customer screen recordings. Return strict JSON only with keys summary, findings, and nextSteps. Findings must cite visible frame evidence and practical support actions. Do not invent network facts not visible in the frames.',
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            `Analyze key screens extracted from ${data.fileName}.`,
            `Video duration: ${metadata.durationSeconds == null ? 'unknown' : `${Math.round(metadata.durationSeconds)} seconds`}.`,
            `Streams: ${metadata.streams.length}.`,
            'Focus on visible UI state, buttons, error messages, forms, loading states, and the customer action flow.',
          ].join('\n'),
        },
        ...frameContent.flat(),
      ],
    },
  ];

  try {
    const upstream = await fetch(`${ocaBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ocaToken}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.1,
        max_tokens: 1800,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      throw new Error(`OCA vision request failed (${upstream.status}): ${errText.slice(0, 200)}`);
    }

    const content = await readOcaStreamContent(upstream);
    return {
      ...parseVisionPayload(content),
      model,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI vision analysis failed.';
    return {
      status: 'error',
      summary: 'Key screens were extracted, but AI vision analysis did not complete.',
      findings: [],
      nextSteps: ['Review the extracted key screens manually and retry AI vision after checking OCA connectivity.'],
      model,
      error: message,
    };
  }
}

function getTranscriptionAudioFormat(): 'mp3' | 'wav' {
  return process.env.VIDEO_TRANSCRIPTION_AUDIO_FORMAT?.toLowerCase() === 'wav' ? 'wav' : 'mp3';
}

function getAudioMediaType(audioPath: string): string {
  return audioPath.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
}

function getAudioInputFormat(audioPath: string): 'mp3' | 'wav' {
  return audioPath.toLowerCase().endsWith('.wav') ? 'wav' : 'mp3';
}

function appendPath(baseUrl: string, suffix: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedSuffix = suffix.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedSuffix}`;
}

function getLiteLlmTranscriptionUrl(): string | null {
  if (process.env.LITELLM_TRANSCRIPTION_URL) {
    return process.env.LITELLM_TRANSCRIPTION_URL;
  }

  const baseUrl = process.env.LITELLM_BASE_URL || (process.env.OCA_TRANSCRIPTION_URL ? undefined : process.env.OCA_BASE_URL);
  if (!baseUrl) return null;
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/v1')
    ? appendPath(trimmed, 'audio/transcriptions')
    : appendPath(trimmed, 'v1/audio/transcriptions');
}

function getTranscriptionProvider(): string {
  return (process.env.VIDEO_TRANSCRIPTION_PROVIDER || 'auto').trim().toLowerCase();
}

function allowsTranscriptionProvider(activeProvider: string, provider: string): boolean {
  return activeProvider === 'auto' || activeProvider === provider;
}

function getLocalWhisperModel(mode: 'fast' | 'full' = 'full'): string {
  if (mode === 'fast') {
    return process.env.WHISPER_FAST_MODEL?.trim() || process.env.WHISPER_MODEL?.trim() || 'base';
  }
  return process.env.WHISPER_MODEL?.trim() || 'base';
}

function isLocalWhisperEnabled(activeProvider: string): boolean {
  return activeProvider === 'local-whisper'
    || activeProvider === 'whisper'
    || getBooleanEnv('VIDEO_LOCAL_WHISPER_ENABLED');
}

function isTranscriptCacheEnabled(): boolean {
  return !/^(0|false|no|off)$/i.test(process.env.VIDEO_TRANSCRIPT_CACHE_ENABLED?.trim() ?? 'true');
}

function getWhisperSubprocessEnv(): NodeJS.ProcessEnv {
  const ffmpegPath = process.env.FFMPEG_PATH?.trim();
  const ffmpegDir = ffmpegPath ? path.dirname(ffmpegPath) : null;
  const existingPath = process.env.PATH || process.env.Path || '';
  const pathValue = ffmpegDir && !existingPath.split(path.delimiter).includes(ffmpegDir)
    ? `${ffmpegDir}${path.delimiter}${existingPath}`
    : existingPath;

  return {
    ...process.env,
    PATH: pathValue,
    Path: pathValue,
    PYTHONUTF8: process.env.PYTHONUTF8 || '1',
    PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
  };
}

function getTranscriptCacheCandidates(options: {
  transcriptionProvider: string;
  hasOcaChatTranscription: boolean;
  hasLiteLlmTranscription: boolean;
  hasDedicatedTranscription: boolean;
  hasLocalWhisperTranscription: boolean;
  chatModel: string;
  liteLlmModel: string;
  dedicatedModel: string;
  localWhisperModel: string;
}): VideoTranscriptCacheCandidate[] {
  const candidates: VideoTranscriptCacheCandidate[] = [];

  if ((options.transcriptionProvider === 'local-whisper' || options.transcriptionProvider === 'whisper') && options.hasLocalWhisperTranscription) {
    candidates.push({ provider: 'local-whisper', model: options.localWhisperModel });
    return candidates;
  }

  if (options.hasOcaChatTranscription) candidates.push({ provider: 'oca-chat', model: options.chatModel });
  if (options.hasLiteLlmTranscription) candidates.push({ provider: 'litellm', model: options.liteLlmModel });
  if (options.hasDedicatedTranscription) candidates.push({ provider: 'dedicated', model: options.dedicatedModel });
  if (options.hasLocalWhisperTranscription) candidates.push({ provider: 'local-whisper', model: options.localWhisperModel });

  return candidates;
}

async function getCachedTranscript(
  data: VideoJobData,
  audioFormat: string,
  candidates: VideoTranscriptCacheCandidate[]
): Promise<VideoTranscriptResult | null> {
  if (!isTranscriptCacheEnabled() || !data.hash || candidates.length === 0) return null;

  const db = getMongoDb();
  const candidateModels = candidates.map(candidate => candidate.model);
  const cached = await db.collection('video_transcripts').findOne({
    sourceHash: data.hash,
    audioFormat,
    model: { $in: candidateModels },
    schemaVersion: 1,
  });

  if (!cached) return null;
  const segments = normalizeTranscriptSegments(cached);
  if (segments.length === 0) return null;

  return {
    status: 'ready',
    summary: transcriptSummary(cached, segments),
    segments,
    model: typeof cached.model === 'string' ? cached.model : candidateModels[0],
    audioFileName: typeof cached.audioFileName === 'string' ? cached.audioFileName : undefined,
  };
}

async function cacheTranscriptResult(
  data: VideoJobData,
  audioFormat: string,
  provider: string,
  result: VideoTranscriptResult
): Promise<VideoTranscriptResult> {
  if (!isTranscriptCacheEnabled() || !data.hash || result.status !== 'ready' || result.segments.length === 0 || !result.model) {
    return result;
  }

  const db = getMongoDb();
  await db.collection('video_transcripts').updateOne(
    {
      sourceHash: data.hash,
      audioFormat,
      model: result.model,
      schemaVersion: 1,
    },
    {
      $set: {
        sourceHash: data.hash,
        audioFormat,
        model: result.model,
        provider,
        summary: result.summary,
        segments: result.segments,
        audioFileName: result.audioFileName,
        schemaVersion: 1,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  return result;
}

function ffmpegConcatFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

async function extractAudioTrack(
  data: VideoJobData,
  metadata: VideoMetadata,
  sampleWindows: VideoAudioWindow[] = []
): Promise<string | null> {
  if (!hasAudioStream(metadata)) return null;

  const startedAt = Date.now();
  const audioDir = path.join(path.dirname(data.filePath), `${data.fileId}_audio`);
  await fs.rm(audioDir, { recursive: true, force: true });
  await fs.mkdir(audioDir, { recursive: true });
  const audioFormat = getTranscriptionAudioFormat();
  const isSampled = sampleWindows.length > 0;
  const audioPath = path.join(audioDir, `${isSampled ? 'audio_sample' : 'audio'}.${audioFormat}`);
  const outputArgs = audioFormat === 'wav'
    ? ['-f', 'wav', audioPath]
    : ['-codec:a', 'libmp3lame', '-b:a', '48k', audioPath];

  videoLog(data.fileId, 'audio:extract:start', {
    audioFormat,
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    outputPath: audioPath,
    sampled: isSampled,
    sampleWindows,
  });

  if (isSampled) {
    const segmentPaths: string[] = [];
    for (const [index, window] of sampleWindows.entries()) {
      const segmentPath = path.join(audioDir, `sample_${String(index + 1).padStart(3, '0')}.${audioFormat}`);
      segmentPaths.push(segmentPath);
      const segmentDuration = Math.max(0.25, window.sourceEndSeconds - window.sourceStartSeconds);
      const segmentArgs = audioFormat === 'wav'
        ? ['-f', 'wav', segmentPath]
        : ['-codec:a', 'libmp3lame', '-b:a', '48k', segmentPath];
      await execFileAsync(
        process.env.FFMPEG_PATH || 'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-y',
          '-ss',
          formatTimestamp(window.sourceStartSeconds),
          '-t',
          formatTimestamp(segmentDuration),
          '-i',
          data.filePath,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          ...segmentArgs,
        ],
        { timeout: getPositiveIntEnv('VIDEO_AUDIO_EXTRACTION_TIMEOUT_MS', DEFAULT_AUDIO_EXTRACTION_TIMEOUT_MS) }
      );
    }

    if (segmentPaths.length === 1) {
      await fs.rename(segmentPaths[0], audioPath);
    } else {
      const concatListPath = path.join(audioDir, 'sample_concat.txt');
      await fs.writeFile(
        concatListPath,
        segmentPaths.map(segmentPath => `file '${ffmpegConcatFilePath(segmentPath)}'`).join('\n'),
        'utf8'
      );
      await execFileAsync(
        process.env.FFMPEG_PATH || 'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatListPath,
          ...outputArgs,
        ],
        { timeout: getPositiveIntEnv('VIDEO_AUDIO_EXTRACTION_TIMEOUT_MS', DEFAULT_AUDIO_EXTRACTION_TIMEOUT_MS) }
      );
    }

    videoLog(data.fileId, 'audio:extract:done', {
      audioFormat,
      outputPath: audioPath,
      sampled: true,
      sampleWindows,
      durationMs: elapsedMs(startedAt),
    });
    return audioPath;
  }

  await execFileAsync(
    process.env.FFMPEG_PATH || 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-i',
      data.filePath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      ...outputArgs,
    ],
    { timeout: getPositiveIntEnv('VIDEO_AUDIO_EXTRACTION_TIMEOUT_MS', DEFAULT_AUDIO_EXTRACTION_TIMEOUT_MS) }
  );

  videoLog(data.fileId, 'audio:extract:done', {
    audioFormat,
    outputPath: audioPath,
    sampled: false,
    durationMs: elapsedMs(startedAt),
  });
  return audioPath;
}

async function transcribeAudioWithOcaChat(
  data: VideoJobData,
  audioPath: string,
  audioBytes: Buffer,
  ocaBaseUrl: string,
  ocaToken: string
): Promise<VideoTranscriptResult> {
  const model = process.env.OCA_AUDIO_TRANSCRIPTION_MODEL || process.env.OCA_MODEL || 'oca/gpt-5.4';
  const audioFormat = getAudioInputFormat(audioPath);
  const audioBase64 = audioBytes.toString('base64');

  const upstream = await fetch(`${ocaBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ocaToken}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: [
            'You transcribe support screen-recording audio for Oracle support engineers.',
            'Return strict JSON only with keys summary and segments.',
            'segments must be an array of { startSeconds, endSeconds, speaker, text }.',
            'Use seconds from the start of the recording when the audio model can infer timing.',
            'Do not invent application facts; only transcribe and summarize the spoken discussion.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `Transcribe the audio track extracted from ${data.fileName}.`,
                'Create useful timestamped segments for support diagnosis.',
                'If speaker names are not clear, use Customer, Engineer, or Speaker.',
              ].join('\n'),
            },
            {
              type: 'input_audio',
              input_audio: {
                data: audioBase64,
                format: audioFormat,
              },
            },
          ],
        },
      ],
      stream: true,
      temperature: 0,
      max_tokens: getPositiveIntEnv('VIDEO_TRANSCRIPTION_MAX_TOKENS', 3000),
    }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    throw new Error(`OCA multimodal audio transcription failed (${upstream.status}): ${errText.slice(0, 200)}`);
  }

  const content = await readOcaStreamContent(upstream);
  const parsed = parseTranscriptPayload(content);
  return {
    status: 'ready',
    summary: parsed.summary,
    segments: parsed.segments,
    model,
    audioFileName: path.basename(audioPath),
  };
}

async function transcribeAudioWithDedicatedEndpoint(
  data: VideoJobData,
  audioPath: string,
  audioBytes: Buffer,
  transcriptionUrl: string,
  token: string
): Promise<VideoTranscriptResult> {
  const model = process.env.OCA_TRANSCRIPTION_MODEL || 'oca/transcribe';
  const mediaType = getAudioMediaType(audioPath);
  const upstream = await fetch(transcriptionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      fileName: `${data.fileId}${path.extname(audioPath)}`,
      mediaType,
      contentBase64: audioBytes.toString('base64'),
      responseFormat: 'verbose_json',
      timestampGranularity: 'segment',
    }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    throw new Error(`Transcription request failed (${upstream.status}): ${errText.slice(0, 200)}`);
  }

  const parsed = await upstream.json() as Record<string, unknown>;
  const segments = normalizeTranscriptSegments(parsed);
  return {
    status: 'ready',
    summary: transcriptSummary(parsed, segments),
    segments,
    model,
    audioFileName: path.basename(audioPath),
  };
}

async function transcribeAudioWithLiteLlm(
  audioPath: string,
  audioBytes: Buffer,
  transcriptionUrl: string,
  token: string
): Promise<VideoTranscriptResult> {
  const model = process.env.LITELLM_TRANSCRIPTION_MODEL || process.env.OCA_TRANSCRIPTION_MODEL || 'whisper';
  const mediaType = getAudioMediaType(audioPath);
  const fileName = `audio${path.extname(audioPath)}`;
  const formData = new FormData();
  formData.append('file', new File([new Uint8Array(audioBytes)], fileName, { type: mediaType }));
  formData.append('model', model);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  const upstream = await fetch(transcriptionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData as any,
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    throw new Error(`LiteLLM transcription request failed (${upstream.status}): ${errText.slice(0, 200)}`);
  }

  const parsed = await upstream.json() as Record<string, unknown>;
  const segments = normalizeTranscriptSegments(parsed);
  return {
    status: 'ready',
    summary: transcriptSummary(parsed, segments),
    segments,
    model,
    audioFileName: path.basename(audioPath),
  };
}

async function transcribeAudioWithLocalWhisper(
  audioPath: string,
  mode: 'fast' | 'full' = 'full'
): Promise<VideoTranscriptResult> {
  const model = getLocalWhisperModel(mode);
  const outputDir = path.join(path.dirname(audioPath), '_whisper');
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const whisperCommand = process.env.WHISPER_COMMAND?.trim();
  const command = whisperCommand || process.env.PYTHON_PATH?.trim() || 'python';
  const usePythonModule = !whisperCommand || getBooleanEnv('WHISPER_USE_PYTHON_MODULE');
  const args = [
    ...(usePythonModule ? ['-m', 'whisper'] : []),
    audioPath,
    '--model',
    model,
    '--task',
    'transcribe',
    '--output_format',
    'json',
    '--output_dir',
    outputDir,
    '--fp16',
    'False',
  ];
  const language = process.env.WHISPER_LANGUAGE?.trim();
  if (language) {
    args.push('--language', language);
  }
  const device = process.env.WHISPER_DEVICE?.trim();
  if (device) {
    args.push('--device', device);
  }

  await execFileAsync(command, args, {
    timeout: getPositiveIntEnv('VIDEO_LOCAL_WHISPER_TIMEOUT_MS', DEFAULT_LOCAL_WHISPER_TIMEOUT_MS),
    maxBuffer: 5 * 1024 * 1024,
    env: getWhisperSubprocessEnv(),
  });

  const outputFiles = await fs.readdir(outputDir);
  const transcriptFile = outputFiles.find(fileName => fileName.toLowerCase().endsWith('.json'));
  if (!transcriptFile) {
    throw new Error('Local Whisper completed without producing a JSON transcript.');
  }

  const transcriptContent = await fs.readFile(path.join(outputDir, transcriptFile), 'utf8');
  const parsed = JSON.parse(String(transcriptContent)) as Record<string, unknown>;
  const segments = normalizeTranscriptSegments(parsed);
  return {
    status: 'ready',
    summary: transcriptSummary(parsed, segments),
    segments,
    model: `local-whisper:${model}`,
    audioFileName: path.basename(audioPath),
  };
}

async function transcribeAudio(
  data: VideoJobData,
  metadata: VideoMetadata,
  options: TranscribeAudioOptions = {}
): Promise<VideoTranscriptResult> {
  if (!hasAudioStream(metadata)) {
    videoLog(data.fileId, 'audio:detect:no-audio', {
      streams: metadata.streams.length,
    });
    return {
      status: 'no_audio',
      summary: 'No audio stream was detected in the recording.',
      segments: [],
      error: 'The uploaded video does not contain an audio stream.',
    };
  }

  const ocaBaseUrl = process.env.OCA_BASE_URL;
  const ocaToken = process.env.OCA_TOKEN;
  const transcriptionUrl = process.env.OCA_TRANSCRIPTION_URL;
  const transcriptionToken = process.env.OCA_TRANSCRIPTION_TOKEN || process.env.OCA_TOKEN;
  const liteLlmTranscriptionUrl = getLiteLlmTranscriptionUrl();
  const liteLlmToken = process.env.LITELLM_API_KEY || process.env.OCA_TRANSCRIPTION_TOKEN || process.env.OCA_TOKEN;
  const chatModel = process.env.OCA_AUDIO_TRANSCRIPTION_MODEL || process.env.OCA_MODEL || 'oca/gpt-5.4';
  const liteLlmModel = process.env.LITELLM_TRANSCRIPTION_MODEL || process.env.OCA_TRANSCRIPTION_MODEL || 'whisper';
  const dedicatedModel = process.env.OCA_TRANSCRIPTION_MODEL || 'oca/transcribe';
  const sampleWindows = options.sampleWindows ?? [];
  const transcriptionMode: 'fast' | 'full' = sampleWindows.length > 0 ? 'fast' : 'full';
  const localWhisperModel = `local-whisper:${getLocalWhisperModel(transcriptionMode)}`;
  const transcriptionProvider = getTranscriptionProvider();
  const fallbackModel = isLocalWhisperEnabled(transcriptionProvider)
    ? localWhisperModel
    : process.env.OCA_TRANSCRIPTION_MODEL || liteLlmModel;
  const isOcaChatAudioEnabled = getBooleanEnv('OCA_CHAT_AUDIO_ENABLED');
  const hasOcaChatTranscription = Boolean(
    allowsTranscriptionProvider(transcriptionProvider, 'oca-chat') && isOcaChatAudioEnabled && ocaBaseUrl && ocaToken
  );
  const hasLiteLlmTranscription = Boolean(
    allowsTranscriptionProvider(transcriptionProvider, 'litellm') && liteLlmTranscriptionUrl && liteLlmToken
  );
  const hasDedicatedTranscription = Boolean(
    allowsTranscriptionProvider(transcriptionProvider, 'dedicated') && transcriptionUrl && transcriptionToken
  );
  const hasLocalWhisperTranscription = isLocalWhisperEnabled(transcriptionProvider);
  const audioFormat = getTranscriptionAudioFormat();

  videoLog(data.fileId, 'audio:transcribe:plan', {
    provider: transcriptionProvider,
    hasOcaChatTranscription,
    hasLiteLlmTranscription,
    hasDedicatedTranscription,
    hasLocalWhisperTranscription,
    audioFormat,
    liteLlmModel,
    localWhisperModel,
    transcriptionMode,
    sampled: sampleWindows.length > 0,
    sampleWindows,
  });

  if (!hasOcaChatTranscription && !hasLiteLlmTranscription && !hasDedicatedTranscription && !hasLocalWhisperTranscription) {
    videoLog(data.fileId, 'audio:transcribe:not-configured', {
      provider: transcriptionProvider,
      model: liteLlmModel,
    });
    return {
      status: 'not_configured',
      summary: 'Audio was detected, but transcription is not configured for this backend.',
      segments: [],
      model: liteLlmModel,
      error: ocaBaseUrl && ocaToken
        ? 'OCA chat audio is disabled by default because this OCA endpoint may reject input_audio. The backend will use the OCA LiteLLM /v1/audio/transcriptions endpoint when available; otherwise configure LITELLM_TRANSCRIPTION_URL, OCA_TRANSCRIPTION_URL, or VIDEO_LOCAL_WHISPER_ENABLED=true.'
        : 'Configure OCA_BASE_URL and OCA_TOKEN for the OCA LiteLLM /v1/audio/transcriptions endpoint, configure LITELLM_TRANSCRIPTION_URL/OCA_TRANSCRIPTION_URL with a token, or enable local Whisper with VIDEO_LOCAL_WHISPER_ENABLED=true.',
    };
  }

  try {
    const finalizeTranscriptResult = async (
      provider: string,
      result: VideoTranscriptResult
    ): Promise<VideoTranscriptResult> => {
      const finalResult = sampleWindows.length > 0
        ? remapSampleTranscriptToSource(result, sampleWindows)
        : result;

      if (sampleWindows.length > 0) {
        return finalResult;
      }

      return await cacheTranscriptResult(data, audioFormat, provider, finalResult);
    };

    const transcriptCacheCandidates = getTranscriptCacheCandidates({
      transcriptionProvider,
      hasOcaChatTranscription,
      hasLiteLlmTranscription,
      hasDedicatedTranscription,
      hasLocalWhisperTranscription,
      chatModel,
      liteLlmModel,
      dedicatedModel,
      localWhisperModel,
    });
    const cachedTranscript = await getCachedTranscript(data, audioFormat, transcriptCacheCandidates);
    if (cachedTranscript) {
      videoLog(data.fileId, 'audio:transcribe:cache-hit', {
        model: cachedTranscript.model,
        segments: cachedTranscript.segments.length,
        audioFormat,
      });
      return cachedTranscript;
    }
    videoLog(data.fileId, 'audio:transcribe:cache-miss', {
      candidateModels: transcriptCacheCandidates.map(candidate => candidate.model),
      audioFormat,
      transcriptionMode,
    });

    const audioPath = await extractAudioTrack(data, metadata, sampleWindows);
    if (!audioPath) {
      return {
        status: 'no_audio',
        summary: 'No audio stream was detected in the recording.',
        segments: [],
        model: chatModel,
      };
    }

    const audioBytes = await fs.readFile(audioPath);
    const maxAudioBytes = getPositiveIntEnv('VIDEO_TRANSCRIPTION_MAX_AUDIO_BYTES', DEFAULT_TRANSCRIPTION_MAX_AUDIO_BYTES);
    if (audioBytes.length > maxAudioBytes) {
      throw new Error(`Extracted audio is larger than VIDEO_TRANSCRIPTION_MAX_AUDIO_BYTES (${maxAudioBytes} bytes).`);
    }

    videoLog(data.fileId, 'audio:read:done', {
      audioFileName: path.basename(audioPath),
      audioBytes: audioBytes.length,
      maxAudioBytes,
    });

    const failures: string[] = [];
    if ((transcriptionProvider === 'local-whisper' || transcriptionProvider === 'whisper') && hasLocalWhisperTranscription) {
      const providerStartedAt = Date.now();
      videoLog(data.fileId, 'audio:transcribe:provider:start', {
        provider: 'local-whisper',
        model: getLocalWhisperModel(transcriptionMode),
        transcriptionMode,
      });
      const result = await transcribeAudioWithLocalWhisper(audioPath, transcriptionMode);
      videoLog(data.fileId, 'audio:transcribe:provider:done', {
        provider: 'local-whisper',
        model: getLocalWhisperModel(transcriptionMode),
        segments: result.segments.length,
        durationMs: elapsedMs(providerStartedAt),
      });
      return await finalizeTranscriptResult('local-whisper', result);
    }

    if (hasOcaChatTranscription && ocaBaseUrl && ocaToken) {
      const providerStartedAt = Date.now();
      videoLog(data.fileId, 'audio:transcribe:provider:start', {
        provider: 'oca-chat',
        model: chatModel,
      });
      try {
        const result = await transcribeAudioWithOcaChat(data, audioPath, audioBytes, ocaBaseUrl, ocaToken);
        videoLog(data.fileId, 'audio:transcribe:provider:done', {
          provider: 'oca-chat',
          model: chatModel,
          segments: result.segments.length,
          durationMs: elapsedMs(providerStartedAt),
        });
        return await finalizeTranscriptResult('oca-chat', result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'OCA multimodal audio transcription failed.';
        videoLog(data.fileId, 'audio:transcribe:provider:error', {
          provider: 'oca-chat',
          model: chatModel,
          durationMs: elapsedMs(providerStartedAt),
          error: message,
        });
        failures.push(message);
      }
    }

    if (liteLlmTranscriptionUrl && liteLlmToken) {
      const providerStartedAt = Date.now();
      videoLog(data.fileId, 'audio:transcribe:provider:start', {
        provider: 'litellm',
        model: liteLlmModel,
        transcriptionUrl: liteLlmTranscriptionUrl,
      });
      try {
        const result = await transcribeAudioWithLiteLlm(audioPath, audioBytes, liteLlmTranscriptionUrl, liteLlmToken);
        videoLog(data.fileId, 'audio:transcribe:provider:done', {
          provider: 'litellm',
          model: liteLlmModel,
          segments: result.segments.length,
          durationMs: elapsedMs(providerStartedAt),
        });
        return await finalizeTranscriptResult('litellm', result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'LiteLLM transcription failed.';
        videoLog(data.fileId, 'audio:transcribe:provider:error', {
          provider: 'litellm',
          model: liteLlmModel,
          durationMs: elapsedMs(providerStartedAt),
          error: message,
        });
        failures.push(message);
      }
    }

    if (transcriptionUrl && transcriptionToken) {
      const providerStartedAt = Date.now();
      videoLog(data.fileId, 'audio:transcribe:provider:start', {
        provider: 'dedicated',
        model: process.env.OCA_TRANSCRIPTION_MODEL || 'oca/transcribe',
        transcriptionUrl,
      });
      try {
        const result = await transcribeAudioWithDedicatedEndpoint(data, audioPath, audioBytes, transcriptionUrl, transcriptionToken);
        videoLog(data.fileId, 'audio:transcribe:provider:done', {
          provider: 'dedicated',
          model: process.env.OCA_TRANSCRIPTION_MODEL || 'oca/transcribe',
          segments: result.segments.length,
          durationMs: elapsedMs(providerStartedAt),
        });
        return await finalizeTranscriptResult('dedicated', result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Dedicated transcription failed.';
        videoLog(data.fileId, 'audio:transcribe:provider:error', {
          provider: 'dedicated',
          model: process.env.OCA_TRANSCRIPTION_MODEL || 'oca/transcribe',
          durationMs: elapsedMs(providerStartedAt),
          error: message,
        });
        failures.push(message);
      }
    }

    if (hasLocalWhisperTranscription) {
      const providerStartedAt = Date.now();
      videoLog(data.fileId, 'audio:transcribe:provider:start', {
        provider: 'local-whisper',
        model: getLocalWhisperModel(transcriptionMode),
        transcriptionMode,
      });
      try {
        const result = await transcribeAudioWithLocalWhisper(audioPath, transcriptionMode);
        videoLog(data.fileId, 'audio:transcribe:provider:done', {
          provider: 'local-whisper',
          model: getLocalWhisperModel(transcriptionMode),
          segments: result.segments.length,
          durationMs: elapsedMs(providerStartedAt),
        });
        return await finalizeTranscriptResult('local-whisper', result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Local Whisper transcription failed.';
        videoLog(data.fileId, 'audio:transcribe:provider:error', {
          provider: 'local-whisper',
          model: getLocalWhisperModel(transcriptionMode),
          durationMs: elapsedMs(providerStartedAt),
          error: message,
        });
        failures.push(message);
      }
    }

    throw new Error(failures.join(' | ') || 'Audio transcription is not configured.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Audio transcription failed.';
    videoLog(data.fileId, 'audio:transcribe:error', {
      model: hasOcaChatTranscription ? chatModel : fallbackModel,
      error: message,
    });
    return {
      status: 'error',
      summary: 'Audio was detected, but transcription did not complete.',
      segments: [],
      model: hasOcaChatTranscription ? chatModel : fallbackModel,
      error: message,
    };
  }
}

function formatTranscriptContext(segments: VideoTranscriptSegment[]): string {
  return segments.slice(0, 80).map(segment => {
    const range = `${formatTimestamp(segment.startSeconds)}s-${formatTimestamp(segment.endSeconds)}s`;
    return `${range}${segment.speaker ? ` ${segment.speaker}` : ''}: ${segment.text}`;
  }).join('\n');
}

async function synthesizeAudioVisualEvidence(
  data: VideoJobData,
  transcript: VideoTranscriptResult,
  vision: VideoVisionResult,
  keyframes: VideoKeyframe[],
  timeline: VideoEvidenceTimelineItem[]
): Promise<VideoMultimodalResult> {
  const model = process.env.OCA_MODEL || 'oca/gpt-5.4';
  const fallbackSummary = transcript.status === 'ready'
    ? 'Transcript and key-screen evidence are available for support review.'
    : vision.summary;

  if (transcript.status !== 'ready' || transcript.segments.length === 0) {
    return {
      status: 'partial',
      summary: transcript.summary || 'Visual analysis completed without transcript evidence.',
      findings: vision.findings.map(finding => ({
        title: finding.title,
        evidence: finding.evidence,
        action: finding.action,
        frameRefs: frameRefsFromFinding(finding),
        confidence: 'medium',
      })),
      nextSteps: vision.nextSteps,
      model,
      error: transcript.error,
    };
  }

  const ocaBaseUrl = process.env.OCA_BASE_URL;
  const ocaToken = process.env.OCA_TOKEN;
  if (!ocaBaseUrl || !ocaToken) {
    return {
      status: 'not_configured',
      summary: fallbackSummary,
      findings: [],
      nextSteps: ['Configure OCA_BASE_URL and OCA_TOKEN to correlate transcript and visual findings.'],
      model,
      error: 'OCA is not configured.',
    };
  }

  const visualContext = vision.findings.map((finding, index) => {
    const refs = frameRefsFromFinding(finding).join(', ') || 'frame not cited';
    return `${index + 1}. ${finding.title} (${refs}): ${finding.evidence}`;
  }).join('\n');
  const timelineContext = timeline.slice(0, 80).map(item => {
    const timestamp = item.timestampSeconds == null ? 'unknown' : `${formatTimestamp(item.timestampSeconds)}s`;
    return `${timestamp} [${item.kind}] ${item.title}: ${item.detail}`;
  }).join('\n');

  const messages = [
    {
      role: 'system',
      content: 'You are a senior Oracle support engineer correlating a screen recording transcript with extracted key-screen evidence. Return strict JSON only with keys summary, findings, and nextSteps. Findings must cite both transcriptRefs and frameRefs when both are relevant. Do not invent facts outside the transcript and visual observations.',
    },
    {
      role: 'user',
      content: [
        `Recording: ${data.fileName}`,
        'Transcript segments:',
        formatTranscriptContext(transcript.segments),
        '',
        'Visual findings:',
        visualContext || 'No visual findings were returned.',
        '',
        'Deterministic timeline:',
        timelineContext || 'No timeline events were built.',
        '',
        `Keyframes: ${keyframes.map((frame, index) => `Frame ${index + 1}=${frame.fileName}@${frame.timestampSeconds ?? 'unknown'}s`).join(', ')}`,
      ].join('\n'),
    },
  ];

  try {
    const upstream = await fetch(`${ocaBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ocaToken}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.1,
        max_tokens: 1800,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      throw new Error(`OCA multimodal request failed (${upstream.status}): ${errText.slice(0, 200)}`);
    }

    const content = await readOcaStreamContent(upstream);
    return {
      ...parseMultimodalPayload(content, fallbackSummary),
      model,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Audio-visual synthesis failed.';
    return {
      status: 'error',
      summary: fallbackSummary,
      findings: [],
      nextSteps: ['Review transcript and visual findings separately, then retry audio-visual synthesis after checking OCA connectivity.'],
      model,
      error: message,
    };
  }
}

function timestampFromTranscriptRefs(transcriptRefs: string[] | undefined): number | null {
  const first = transcriptRefs?.[0];
  if (!first) return null;
  const match = first.match(/([0-9]+(?:\.[0-9]+)?)s?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampFromFrameRefs(frameRefs: string[] | undefined, keyframes: VideoKeyframe[]): number | null {
  for (const ref of frameRefs ?? []) {
    const frame = keyframeForFrameRef(ref, keyframes);
    if (frame?.timestampSeconds != null) return frame.timestampSeconds;
  }
  return null;
}

function normalizeConfidence(value: string | undefined): 'high' | 'medium' | 'low' {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

function buildSupportHandoff(
  data: VideoJobData,
  transcript: VideoTranscriptResult,
  vision: VideoVisionResult,
  keyframes: VideoKeyframe[],
  evidenceTimeline: VideoEvidenceTimelineItem[],
  multimodal: VideoMultimodalResult,
  timings: VideoProcessingTiming[]
): VideoSupportHandoff {
  const correlationEvents = evidenceTimeline.filter(event => event.kind === 'correlation');
  const nextSteps = uniqueStrings([
    ...multimodal.nextSteps,
    ...vision.nextSteps,
    transcript.status !== 'ready' ? 'Collect or enable audio transcript if the spoken customer context is important.' : undefined,
  ], 8);

  const multimodalCards = multimodal.findings.map(finding => ({
    claim: finding.title,
    evidence: finding.evidence,
    timestampSeconds: timestampFromTranscriptRefs(finding.transcriptRefs) ?? timestampFromFrameRefs(finding.frameRefs, keyframes),
    frameRefs: uniqueStrings(finding.frameRefs ?? [], 6),
    transcriptRefs: uniqueStrings(finding.transcriptRefs ?? [], 4),
    confidence: normalizeConfidence(finding.confidence),
    nextStep: finding.action,
  }));

  const deterministicCards = correlationEvents.map(event => ({
    claim: event.title,
    evidence: event.detail,
    timestampSeconds: event.timestampSeconds,
    frameRefs: uniqueStrings(event.frameRefs ?? [], 6),
    transcriptRefs: uniqueStrings(event.transcriptRefs ?? [], 4),
    transcript: event.transcript,
    confidence: event.confidence,
    nextStep: nextSteps[0],
  }));

  const visualFallbackCards = vision.findings.slice(0, 4).map(finding => {
    const frameRefs = frameRefsFromFinding(finding);
    return {
      claim: finding.title,
      evidence: finding.evidence,
      timestampSeconds: timestampFromFrameRefs(frameRefs, keyframes),
      frameRefs,
      transcriptRefs: [],
      confidence: 'medium' as const,
      nextStep: finding.action ?? nextSteps[0],
    };
  });

  const evidenceCards = (multimodalCards.length > 0 ? multimodalCards : deterministicCards.length > 0 ? deterministicCards : visualFallbackCards)
    .slice(0, 8);

  const confirmedFacts = uniqueStrings([
    keyframes.length > 0 ? `${keyframes.length} key screen${keyframes.length === 1 ? '' : 's'} were extracted from the recording.` : undefined,
    vision.status === 'ready' ? `Visual review: ${vision.summary}` : undefined,
    transcript.status === 'ready' ? `Transcript review: ${transcript.summary ?? `${transcript.segments.length} transcript segment(s) extracted.`}` : undefined,
    multimodal.status === 'ready' ? `Audio+visual correlation: ${multimodal.summary}` : undefined,
  ], 6);

  const gaps = uniqueStrings([
    vision.status !== 'ready' ? `Visual AI did not complete: ${vision.error ?? vision.summary}` : undefined,
    transcript.status !== 'ready' ? `Audio transcript is unavailable: ${transcript.error ?? transcript.summary ?? transcript.status}` : undefined,
    transcript.sampled ? 'Transcript is a fast sampled pass around visual moments, not full-session transcription.' : undefined,
    correlationEvents.length === 0 ? 'No deterministic transcript-to-frame correlation was found.' : undefined,
  ], 6);

  return {
    status: multimodal.status === 'ready' || evidenceCards.length > 0 ? 'ready' : 'partial',
    title: `Engineer handoff for ${data.fileName}`,
    summary: multimodal.summary || vision.summary || 'Video evidence was prepared for support review.',
    verdict: multimodal.status === 'ready'
      ? 'Audio and visual evidence are correlated.'
      : transcript.status === 'ready' && vision.status === 'ready'
        ? 'Transcript and visual evidence are available; final correlation is partial.'
        : 'Use available visual evidence and collect missing context before concluding.',
    confirmedFacts,
    evidenceCards,
    gaps,
    nextSteps,
    timings,
  };
}

async function detectSceneChangeTimestamps(data: VideoJobData): Promise<number[]> {
  const threshold = getPositiveFloatEnv('VIDEO_SCENE_THRESHOLD', DEFAULT_SCENE_THRESHOLD);
  const sceneDetectFps = getPositiveFloatEnv('VIDEO_SCENE_DETECT_FPS', DEFAULT_FAST_SCENE_DETECT_FPS);
  const { stderr } = await execFileAsync(
    process.env.FFMPEG_PATH || 'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-i',
      data.filePath,
      '-vf',
      `fps=${sceneDetectFps},select='gt(scene,${threshold})',showinfo`,
      '-an',
      '-f',
      'null',
      '-',
    ],
    { timeout: DEFAULT_KEYFRAME_EXTRACTION_TIMEOUT_MS }
  );

  return parseSceneTimestamps(stderr || '');
}

async function extractKeyframes(data: VideoJobData, metadata: VideoMetadata): Promise<VideoKeyframeExtraction> {
  const keyframeDir = path.join(path.dirname(data.filePath), `${data.fileId}_keyframes`);
  await fs.rm(keyframeDir, { recursive: true, force: true });
  await fs.mkdir(keyframeDir, { recursive: true });
  const sceneTimestamps = await detectSceneChangeTimestamps(data);
  const selectedTimestamps = selectKeyframeTimestamps(sceneTimestamps, metadata.durationSeconds);

  for (const [index, timestampSeconds] of selectedTimestamps.entries()) {
    await execFileAsync(
      process.env.FFMPEG_PATH || 'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-y',
        '-ss',
        formatTimestamp(timestampSeconds),
        '-i',
        data.filePath,
        '-frames:v',
        '1',
        '-vf',
        'scale=960:-1',
        path.join(keyframeDir, `frame_${String(index + 1).padStart(3, '0')}.jpg`),
      ],
      { timeout: DEFAULT_KEYFRAME_EXTRACTION_TIMEOUT_MS }
    );
  }

  const files = (await fs.readdir(keyframeDir))
    .filter(fileName => /^frame_\d+\.jpg$/i.test(fileName))
    .sort();

  return {
    keyframes: files.map((fileName, index) => ({
      fileName,
      relativePath: path.join(`${data.fileId}_keyframes`, fileName),
      timestampSeconds: selectedTimestamps[index] ?? null,
    })),
    sceneChangesDetected: sceneTimestamps.length,
    selectedTimestamps,
  };
}

export async function analyzeVideoEvidence(data: VideoJobData): Promise<void> {
  const { fileId, fileName } = data;
  const analysisStartedAtMs = Date.now();
  const timings: VideoProcessingTiming[] = [];
  console.log(`Analyzing video evidence: ${fileName}`);
  videoLog(fileId, 'analysis:start', {
    fileName,
    fileSize: data.fileSize,
    fileType: data.fileType,
    provider: getTranscriptionProvider(),
    localWhisperEnabled: isLocalWhisperEnabled(getTranscriptionProvider()),
  });

  await updateVideoFile(fileId, 'analyzing', {
    analysisStartedAt: new Date(),
    error: null,
  });
  await addTimelineEvent(
    fileId,
    'analyzing',
    'Video analysis started',
    'Checking backend video tooling before extracting timeline evidence.'
  );

  const ffprobeCommand = process.env.FFPROBE_PATH || 'ffprobe';
  const ffmpegCommand = process.env.FFMPEG_PATH || 'ffmpeg';
  const toolsStartedAt = Date.now();
  const [ffprobeAvailable, ffmpegAvailable] = await Promise.all([
    commandAvailable(ffprobeCommand),
    commandAvailable(ffmpegCommand),
  ]);
  const missingTools = [
    ...(!ffprobeAvailable ? ['ffprobe'] : []),
    ...(!ffmpegAvailable ? ['ffmpeg'] : []),
  ];
  videoLog(fileId, 'tools:checked', {
    ffprobeCommand,
    ffmpegCommand,
    ffprobeAvailable,
    ffmpegAvailable,
    missingTools,
  });
  recordTiming(timings, 'tools', 'Video tooling check', toolsStartedAt, missingTools.length > 0 ? 'error' : 'complete');

  if (missingTools.length > 0) {
    const detail = `Install or expose ${missingTools.join(' and ')} on the backend host, then retry video analysis. Without these tools the server cannot read video duration, audio streams, or extract key screens for AI vision.`;
    videoLog(fileId, 'analysis:blocked', {
      missingTools,
      durationMs: elapsedMs(analysisStartedAtMs),
    });
    await updateVideoFile(fileId, 'analysis_blocked', {
      error: detail,
      analysisCompletedAt: new Date(),
      analysis: {
        status: 'blocked',
        missingTools,
        ffprobeAvailable,
        ffmpegAvailable,
        timings,
      },
    });
    await addTimelineEvent(
      fileId,
      'analysis_blocked',
      'Video analysis needs backend tools',
      detail
    );
    return;
  }

  try {
    const metadataStartedAt = Date.now();
    const metadata = await probeVideo(data.filePath);
    videoLog(fileId, 'metadata:ready', {
      durationSeconds: metadata.durationSeconds,
      streams: metadata.streams.length,
      hasAudio: hasAudioStream(metadata),
      ffprobeAvailable: metadata.ffprobeAvailable,
      durationMs: elapsedMs(metadataStartedAt),
    });
    recordTiming(timings, 'metadata', 'Video metadata', metadataStartedAt);
    await addTimelineEvent(
      fileId,
      'metadata_ready',
      'Video stream metadata read',
      metadata.durationSeconds
        ? `Duration is ${Math.round(metadata.durationSeconds)} seconds across ${metadata.streams.length} stream(s).`
        : `Video stream metadata was read across ${metadata.streams.length} stream(s).`
    );

    const keyframeStartedAt = Date.now();
    const keyframeExtraction = await extractKeyframes(data, metadata);
    const { keyframes } = keyframeExtraction;
    videoLog(fileId, 'keyframes:ready', {
      keyframeCount: keyframes.length,
      sceneChangesDetected: keyframeExtraction.sceneChangesDetected,
      selectedTimestamps: keyframeExtraction.selectedTimestamps,
      durationMs: elapsedMs(keyframeStartedAt),
    });
    recordTiming(timings, 'keyframes', 'Key screen extraction', keyframeStartedAt);
    await addTimelineEvent(
      fileId,
      'keyframes_ready',
      'Key screens extracted',
      `${keyframes.length} non-redundant key screen${keyframes.length === 1 ? '' : 's'} selected from visual inflection points for evidence review.`
    );
    await updateVideoFile(fileId, 'analyzing', {
      metadata,
      analysis: {
        status: 'analyzing',
        keyframes,
        keyframeCount: keyframes.length,
        keyframeStrategy: 'scene-change',
        sceneChangesDetected: keyframeExtraction.sceneChangesDetected,
        selectedTimestamps: keyframeExtraction.selectedTimestamps,
        timings,
        note: 'Key screens are available while visual diagnosis and audio correlation continue.',
      },
    });

    const visionStartedAt = Date.now();
    const vision = await analyzeKeyframesWithVision(data, keyframes, metadata);
    videoLog(fileId, 'vision:complete', {
      status: vision.status,
      model: vision.model,
      findings: vision.findings.length,
      durationMs: elapsedMs(visionStartedAt),
      error: vision.error,
    });
    recordTiming(timings, 'vision', 'AI visual review', visionStartedAt, vision.status === 'ready' ? 'complete' : 'partial');
    if (vision.status === 'ready') {
      await addTimelineEvent(
        fileId,
        'vision_ready',
        'AI visual findings ready',
        vision.summary
      );
    } else {
      await addTimelineEvent(
        fileId,
        'vision_unavailable',
        vision.status === 'not_configured' ? 'AI vision not configured' : 'AI vision did not complete',
        vision.error || vision.summary
      );
    }

    const fastModeEnabled = isFastVideoAnalysisEnabled();
    if (fastModeEnabled) {
      const partialStatus = vision.status === 'ready' ? 'fast_visual_ready' : 'analyzing';
      await updateVideoFile(fileId, partialStatus, {
        metadata,
        analysis: {
          status: partialStatus,
          keyframes,
          keyframeCount: keyframes.length,
          keyframeStrategy: 'scene-change',
          sceneChangesDetected: keyframeExtraction.sceneChangesDetected,
          selectedTimestamps: keyframeExtraction.selectedTimestamps,
          vision,
          timings,
          note: vision.status === 'ready'
            ? 'Fast visual findings are ready. Audio sampling and correlation are still running in the background.'
            : 'Key screens are ready. The worker is continuing with transcript and correlation where available.',
        },
      });
      await addTimelineEvent(
        fileId,
        'fast_visual_ready',
        vision.status === 'ready' ? 'Fast visual findings ready' : 'Fast visual pass completed',
        vision.status === 'ready'
          ? 'Key screens and visual AI findings are available while sampled audio correlation continues.'
          : 'Key screens are available while the worker continues the remaining evidence pass.'
      );
    }

    const sampleWindows = fastModeEnabled && hasAudioStream(metadata)
      ? buildFastAudioWindows(metadata, keyframes)
      : [];
    if (sampleWindows.length > 0) {
      videoLog(fileId, 'audio:sample-windows:ready', {
        windows: sampleWindows,
        coverageSeconds: sampleWindows.reduce((total, window) => total + window.sourceEndSeconds - window.sourceStartSeconds, 0),
      });
      await addTimelineEvent(
        fileId,
        'audio_sample_ready',
        'Fast audio sample selected',
        `${sampleWindows.length} audio window${sampleWindows.length === 1 ? '' : 's'} selected around visual evidence for the first transcript pass.`
      );
    }

    const transcriptionStartedAt = Date.now();
    const transcript = await transcribeAudio(data, metadata, { sampleWindows });
    videoLog(fileId, 'audio:transcribe:complete', {
      status: transcript.status,
      model: transcript.model,
      segments: transcript.segments.length,
      sampled: transcript.sampled,
      coverageSeconds: transcript.coverageSeconds,
      durationMs: elapsedMs(transcriptionStartedAt),
      error: transcript.error,
    });
    recordTiming(timings, 'transcript', 'Audio transcription', transcriptionStartedAt, transcript.status === 'ready' ? 'complete' : 'partial');
    if (transcript.status === 'ready') {
      await addTimelineEvent(
        fileId,
        transcript.sampled ? 'fast_transcript_ready' : 'transcript_ready',
        transcript.sampled ? 'Fast sampled transcript extracted' : 'Audio transcript extracted',
        transcript.sampled
          ? `${transcript.segments.length} timestamped segment${transcript.segments.length === 1 ? '' : 's'} extracted from ${Math.round(transcript.coverageSeconds ?? 0)} seconds sampled around key screens.`
          : `${transcript.segments.length} timestamped segment${transcript.segments.length === 1 ? '' : 's'} extracted from the recording audio.`
      );
    } else {
      await addTimelineEvent(
        fileId,
        'transcript_unavailable',
        transcript.status === 'no_audio' ? 'No audio transcript available' : 'Audio transcript unavailable',
        transcript.error || transcript.summary || 'Transcript evidence is not available for this recording.'
      );
    }

    const correlationStartedAt = Date.now();
    const evidenceTimeline = buildEvidenceTimeline(transcript, vision, keyframes);
    recordTiming(timings, 'timeline', 'Evidence timeline correlation', correlationStartedAt, evidenceTimeline.some(item => item.kind === 'correlation') ? 'complete' : 'partial');
    const multimodalStartedAt = Date.now();
    const multimodal = await synthesizeAudioVisualEvidence(data, transcript, vision, keyframes, evidenceTimeline);
    videoLog(fileId, 'multimodal:complete', {
      status: multimodal.status,
      model: multimodal.model,
      findings: multimodal.findings.length,
      timelineEvents: evidenceTimeline.length,
      durationMs: elapsedMs(multimodalStartedAt),
      error: multimodal.error,
    });
    recordTiming(timings, 'synthesis', 'AI audio+visual synthesis', multimodalStartedAt, multimodal.status === 'ready' ? 'complete' : 'partial');
    if (multimodal.status === 'ready') {
      await addTimelineEvent(
        fileId,
        'multimodal_ready',
        'Audio and visual evidence correlated',
        multimodal.summary
      );
    } else {
      await addTimelineEvent(
        fileId,
        'multimodal_partial',
        'Audio and visual correlation partial',
        multimodal.error || multimodal.summary
      );
    }

    const handoffStartedAt = Date.now();
    const handoff = buildSupportHandoff(data, transcript, vision, keyframes, evidenceTimeline, multimodal, timings);
    recordTiming(timings, 'handoff', 'Engineer handoff build', handoffStartedAt, handoff.status === 'ready' ? 'complete' : 'partial');
    handoff.timings = timings;
    await addTimelineEvent(
      fileId,
      'support_handoff_ready',
      'Engineer handoff prepared',
      `${handoff.evidenceCards.length} source-grounded evidence card${handoff.evidenceCards.length === 1 ? '' : 's'} prepared with ${handoff.gaps.length} known gap${handoff.gaps.length === 1 ? '' : 's'}.`
    );

    const finalStatus = vision.status === 'ready' ? 'vision_ready' : 'analysis_ready';
    await updateVideoFile(fileId, finalStatus, {
      analysisCompletedAt: new Date(),
      metadata,
      analysis: {
        status: finalStatus,
        keyframes,
        keyframeCount: keyframes.length,
        keyframeStrategy: 'scene-change',
        sceneChangesDetected: keyframeExtraction.sceneChangesDetected,
        selectedTimestamps: keyframeExtraction.selectedTimestamps,
        vision,
        transcript,
        evidenceTimeline,
        multimodal,
        handoff,
        timings,
        note: vision.status === 'ready'
          ? multimodal.status === 'ready'
            ? transcript.sampled
              ? 'Fast key screens, sampled transcript, and audio-visual correlation are ready for support review.'
              : 'Key screens, transcript, and audio-visual correlation are ready for support review.'
            : 'Key screens were extracted and reviewed by AI vision. Transcript correlation is partial or unavailable.'
          : 'Key screens are extracted. AI vision can be retried when provider connectivity is available.',
      },
    });
    await addTimelineEvent(
      fileId,
      finalStatus,
      vision.status === 'ready' ? 'Video visual diagnosis ready' : 'Video evidence timeline ready',
      vision.status === 'ready'
        ? 'The video has key-screen evidence and AI visual findings for support review.'
        : 'The video has been prepared into metadata and key-screen evidence for support review.'
    );
    videoLog(fileId, 'analysis:complete', {
      finalStatus,
      durationMs: elapsedMs(analysisStartedAtMs),
      transcriptStatus: transcript.status,
      visionStatus: vision.status,
      multimodalStatus: multimodal.status,
      handoffStatus: handoff.status,
      keyframeCount: keyframes.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Video analysis failed';
    videoLog(fileId, 'analysis:error', {
      durationMs: elapsedMs(analysisStartedAtMs),
      error: message,
    });
    await updateVideoFile(fileId, 'error', {
      error: message,
      analysisCompletedAt: new Date(),
    });
    await addTimelineEvent(
      fileId,
      'error',
      'Video analysis failed',
      message
    );
    throw error;
  }
}
