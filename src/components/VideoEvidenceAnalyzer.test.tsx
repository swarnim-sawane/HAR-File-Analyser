import React from 'react';
import { readFileSync } from 'node:fs';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import VideoEvidenceAnalyzer from './VideoEvidenceAnalyzer';
import { apiClient } from '../services/apiClient';
import { wsClient } from '../services/websocketClient';

const globalsCss = readFileSync('src/styles/globals.css', 'utf8');

vi.mock('../services/apiClient', () => ({
  apiClient: {
    getVideoStatus: vi.fn(),
    getVideoTimeline: vi.fn(),
    requestVideoAnalysis: vi.fn(),
  },
}));

vi.mock('../services/websocketClient', () => ({
  wsClient: {
    connect: vi.fn(),
    subscribeToFile: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe('VideoEvidenceAnalyzer', () => {
  beforeEach(() => {
    vi.mocked(apiClient.getVideoStatus).mockReset();
    vi.mocked(apiClient.getVideoTimeline).mockReset();
    vi.mocked(apiClient.requestVideoAnalysis).mockReset();
    vi.mocked(wsClient.connect).mockReset();
    vi.mocked(wsClient.subscribeToFile).mockReset();
    vi.mocked(wsClient.on).mockReset();
    vi.mocked(wsClient.off).mockReset();
  });

  it('shows a terminal blocked state instead of an endless evidence timeline stage', async () => {
    vi.mocked(apiClient.getVideoStatus).mockResolvedValue({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      fileSize: 7340032,
      status: 'analysis_blocked',
      durationSeconds: null,
      ffprobeAvailable: false,
      uploadedAt: '2026-06-11T10:00:00.000Z',
      processedAt: '2026-06-11T10:00:03.000Z',
      error: 'Video analysis needs ffprobe and ffmpeg on the backend host.',
    });
    vi.mocked(apiClient.getVideoTimeline).mockResolvedValue({
      events: [{
        fileId: 'video-file-id',
        stage: 'analysis_blocked',
        title: 'Video analysis needs backend tools',
        detail: 'Install or expose ffprobe and ffmpeg on the backend host, then retry video analysis.',
        timestampSeconds: null,
        createdAt: '2026-06-11T10:00:04.000Z',
      }],
    });

    render(
      <VideoEvidenceAnalyzer
        fileId="video-file-id"
        fileName="customer-session.mp4"
        fileSize={7340032}
        mediaType="video/mp4"
        isActive
        backendUrl="http://localhost:4000"
      />
    );

    expect(await screen.findByText('Video analysis blocked')).toBeInTheDocument();
    expect(screen.queryByText('Building evidence timeline')).not.toBeInTheDocument();
    const stageList = screen.getByLabelText(/video evidence stages/i);
    expect(within(stageList).getByText('Video tools needed')).toBeInTheDocument();
    expect(screen.getAllByText(/Install or expose ffprobe and ffmpeg/i).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry video analysis/i })).toBeEnabled();
    });
  });

  it('keeps legacy analysis_requested videos retryable because no worker job was queued', async () => {
    vi.mocked(apiClient.getVideoStatus).mockResolvedValue({
      fileId: 'legacy-video-id',
      fileName: 'customer-session.mp4',
      fileSize: 7340032,
      status: 'analysis_requested',
      durationSeconds: null,
      ffprobeAvailable: false,
      uploadedAt: '2026-06-11T10:00:00.000Z',
      processedAt: '2026-06-11T10:00:03.000Z',
    });
    vi.mocked(apiClient.getVideoTimeline).mockResolvedValue({
      events: [{
        fileId: 'legacy-video-id',
        stage: 'analysis_requested',
        title: 'Analyze Video Evidence requested',
        detail: 'Legacy request recorded before backend analysis jobs existed.',
        timestampSeconds: null,
        createdAt: '2026-06-11T10:00:04.000Z',
      }],
    });

    render(
      <VideoEvidenceAnalyzer
        fileId="legacy-video-id"
        fileName="customer-session.mp4"
        fileSize={7340032}
        mediaType="video/mp4"
        isActive
        backendUrl="http://localhost:4000"
      />
    );

    expect(await screen.findByText('Analysis request needs retry')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start video analysis/i })).toBeEnabled();
  });

  it('lays keyframe markers onto the player when live status events arrive', async () => {
    vi.mocked(apiClient.getVideoStatus).mockResolvedValue({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      fileSize: 7340032,
      status: 'analyzing',
      durationSeconds: 120,
      ffprobeAvailable: true,
      uploadedAt: '2026-06-11T10:00:00.000Z',
      processedAt: '2026-06-11T10:00:03.000Z',
      mediaUrl: '/api/video/video-file-id/media',
    });
    vi.mocked(apiClient.getVideoTimeline).mockResolvedValue({ events: [] });

    render(
      <VideoEvidenceAnalyzer
        fileId="video-file-id"
        fileName="customer-session.mp4"
        fileSize={7340032}
        mediaType="video/mp4"
        isActive
        backendUrl="http://localhost:4000"
      />
    );

    expect(await screen.findByText('Media playback ready')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /seek to frame 1/i })).not.toBeInTheDocument();

    const statusHandler = vi.mocked(wsClient.on).mock.calls.find(([eventName]) => eventName === 'file:status')?.[1];
    expect(statusHandler).toEqual(expect.any(Function));

    act(() => {
      statusHandler?.({
        fileId: 'video-file-id',
        status: 'analyzing',
        metadata: { durationSeconds: 120, ffprobeAvailable: true },
        analysis: {
          keyframeCount: 1,
          keyframeStrategy: 'scene-change',
          keyframes: [
            { fileName: 'frame_001.jpg', url: '/api/video/video-file-id/keyframes/frame_001.jpg', timestampSeconds: 42 },
          ],
          timings: [
            { stage: 'metadata', label: 'Video metadata', durationMs: 820, status: 'complete' },
            { stage: 'keyframes', label: 'Key screen extraction', durationMs: 1520, status: 'complete' },
          ],
        },
      });
    });

    expect(await screen.findByRole('button', { name: /seek to frame 1 at 42s/i })).toBeInTheDocument();
    expect(screen.getByText('1 inflection point')).toBeInTheDocument();
    expect(screen.getByLabelText('Live video processing timings')).toBeInTheDocument();
    expect(screen.getByText('Video metadata')).toBeInTheDocument();
    expect(screen.getByText('1.5s')).toBeInTheDocument();
  });

  it('shows a subtle processing transparency strip while long audio work continues', async () => {
    const startedAt = new Date(Date.now() - 134000).toISOString();

    vi.mocked(apiClient.getVideoStatus).mockResolvedValue({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      fileSize: 7340032,
      status: 'fast_visual_ready',
      durationSeconds: 566,
      ffprobeAvailable: true,
      uploadedAt: '2026-06-11T10:00:00.000Z',
      processedAt: '2026-06-11T10:00:03.000Z',
      mediaUrl: '/api/video/video-file-id/media',
      analysis: {
        keyframeCount: 2,
        keyframeStrategy: 'scene-change',
        keyframes: [
          { fileName: 'frame_001.jpg', url: '/api/video/video-file-id/keyframes/frame_001.jpg', timestampSeconds: 0 },
          { fileName: 'frame_002.jpg', url: '/api/video/video-file-id/keyframes/frame_002.jpg', timestampSeconds: 20 },
        ],
        vision: {
          status: 'ready',
          summary: 'Key screens show the customer flow but audio correlation is still running.',
          findings: [
            {
              title: 'Oracle page appears loaded',
              evidence: 'Frame 2 shows the Oracle page after authentication.',
              frameRefs: ['Frame 2'],
            },
          ],
          nextSteps: ['Wait for sampled audio correlation before final handoff.'],
        },
        timings: [
          { stage: 'metadata', label: 'Video metadata', durationMs: 820, status: 'complete' },
          { stage: 'keyframes', label: 'Key screen extraction', durationMs: 1520, status: 'complete' },
          { stage: 'vision', label: 'AI visual review', durationMs: 4200, status: 'complete' },
        ],
      },
    });
    vi.mocked(apiClient.getVideoTimeline).mockResolvedValue({
      events: [
        {
          fileId: 'video-file-id',
          stage: 'analyzing',
          title: 'Video analysis started',
          detail: 'Checking backend video tooling before extracting timeline evidence.',
          timestampSeconds: null,
          createdAt: startedAt,
        },
        {
          fileId: 'video-file-id',
          stage: 'fast_visual_ready',
          title: 'Fast visual findings ready',
          detail: 'Key screens and visual AI findings are available while sampled audio correlation continues.',
          timestampSeconds: null,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    render(
      <VideoEvidenceAnalyzer
        fileId="video-file-id"
        fileName="customer-session.mp4"
        fileSize={7340032}
        mediaType="video/mp4"
        isActive
        backendUrl="http://localhost:4000"
      />
    );

    expect(await screen.findByLabelText('Processing transparency')).toBeInTheDocument();
    expect(screen.getByText('Refining audio evidence')).toBeInTheDocument();
    expect(screen.getByText(/Running for/i)).toBeInTheDocument();
    expect(screen.getByText('You can start reviewing the screen evidence while audio correlation continues.')).toBeInTheDocument();
    expect(screen.getByText('Available now')).toBeInTheDocument();
    expect(screen.getByText('2 key screens ready')).toBeInTheDocument();
    expect(screen.getByText('Visual findings ready')).toBeInTheDocument();
    expect(screen.getByText('Still running')).toBeInTheDocument();
    expect(screen.getByText('Sampled audio transcription')).toBeInTheDocument();
    expect(screen.getByText('Audio + visual correlation')).toBeInTheDocument();
    expect(screen.getByText('First analysis can take a few minutes for long recordings. Results appear as each stage finishes.')).toBeInTheDocument();
  });

  it('renders extracted keyframes and AI visual findings when available', async () => {
    const user = userEvent.setup();

    vi.mocked(apiClient.getVideoStatus).mockResolvedValue({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      fileSize: 7340032,
      status: 'vision_ready',
      durationSeconds: 566,
      ffprobeAvailable: true,
      uploadedAt: '2026-06-11T10:00:00.000Z',
      processedAt: '2026-06-11T10:00:03.000Z',
      mediaUrl: '/api/video/video-file-id/media',
      analysis: {
        keyframeCount: 2,
        keyframeStrategy: 'scene-change',
        sceneChangesDetected: 5,
        selectedTimestamps: [0, 20],
        keyframes: [
          { fileName: 'frame_001.jpg', url: '/api/video/video-file-id/keyframes/frame_001.jpg', timestampSeconds: 0 },
          { fileName: 'frame_002.jpg', url: '/api/video/video-file-id/keyframes/frame_002.jpg', timestampSeconds: 20 },
        ],
        vision: {
          status: 'ready',
          summary: 'Customer sees a red error modal after clicking submit.',
          findings: [
            {
              title: 'Error modal blocks the customer flow',
              evidence: 'Frames 1 through 2 show the modal after submit.',
              action: 'Match this moment with HAR failures around the same timestamp.',
            },
          ],
          nextSteps: ['Compare timestamp with HAR failures'],
        },
      },
    });
    vi.mocked(apiClient.getVideoTimeline).mockResolvedValue({ events: [] });

    render(
      <VideoEvidenceAnalyzer
        fileId="video-file-id"
        fileName="customer-session.mp4"
        fileSize={7340032}
        mediaType="video/mp4"
        isActive
        backendUrl="http://localhost:4000"
      />
    );

    expect(await screen.findByText('AI visual diagnosis ready')).toBeInTheDocument();
    expect(screen.getByText('Analysis Progress')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getAllByText('2 inflection points').length).toBeGreaterThan(0);
    expect(screen.getByText('Case Review Cockpit')).toBeInTheDocument();
    expect(screen.getByText('Key Moments')).toBeInTheDocument();
    expect(screen.getByLabelText('AI review sidebar')).toBeInTheDocument();
    expect(screen.getByText('Verdict')).toBeInTheDocument();
    expect(screen.getAllByText('Failure visible in recording').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Video diagnosis depth')).toBeInTheDocument();
    expect(screen.getByText('Capture Coverage')).toBeInTheDocument();
    expect(screen.getByText('Grounding')).toBeInTheDocument();
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getByLabelText('AI reasoning path')).toBeInTheDocument();
    expect(screen.getByText('Frames 1-2')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /key screen frame_001\.jpg selected preview/i })).toHaveAttribute(
      'src',
      'http://localhost:4000/api/video/video-file-id/keyframes/frame_001.jpg'
    );
    const mediaPlayer = screen.getByLabelText('Customer session media player') as HTMLVideoElement;
    expect(mediaPlayer).toHaveAttribute('src', 'http://localhost:4000/api/video/video-file-id/media');
    expect(screen.getByRole('button', { name: /seek to frame 1 at 0s/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /seek to frame 2 at 20s/i }));
    expect(mediaPlayer.currentTime).toBe(20);
    await user.click(screen.getByRole('button', { name: /show frame_002\.jpg/i }));
    expect(mediaPlayer.currentTime).toBe(20);
    expect(screen.getByRole('img', { name: /key screen frame_002\.jpg selected preview/i })).toHaveAttribute(
      'src',
      'http://localhost:4000/api/video/video-file-id/keyframes/frame_002.jpg'
    );
    const selectedContext = screen.getByText('Moment Context').closest('.video-evidence-frame-context');
    expect(selectedContext).not.toBeNull();
    expect(within(selectedContext as HTMLElement).getByText('Error modal blocks the customer flow')).toBeInTheDocument();
    expect(within(selectedContext as HTMLElement).getByText('Frames 1 through 2 show the modal after submit.')).toBeInTheDocument();
    expect(screen.getAllByText('0s').length).toBeGreaterThan(0);
    expect(screen.getByText('What the recording proves')).toBeInTheDocument();
    expect(screen.getByText('Customer sees a red error modal after clicking submit.')).toBeInTheDocument();
    expect(screen.getAllByText('Error modal blocks the customer flow').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Compare timestamp with HAR failures').length).toBeGreaterThan(0);
    expect(document.querySelector('.video-evidence-media-review')).not.toBeNull();
    expect(document.querySelector('.video-evidence-analysis-grid')).not.toBeNull();
    const progress = screen.getByLabelText('Video analysis progress');
    const review = screen.getByLabelText('Primary video evidence review');
    expect(progress.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(wsClient.subscribeToFile).toHaveBeenCalledWith('video-file-id');
    expect(wsClient.on).toHaveBeenCalledWith('file:status', expect.any(Function));
    expect(wsClient.on).toHaveBeenCalledWith('video:timeline', expect.any(Function));
    expect(document.querySelector('.video-evidence-technical-drawer')).not.toHaveAttribute('open');
  });

  it('does not mark no-error visual summaries as visible failures because they mention failed loading', async () => {
    vi.mocked(apiClient.getVideoStatus).mockResolvedValue({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      fileSize: 7340032,
      status: 'vision_ready',
      durationSeconds: 120,
      ffprobeAvailable: true,
      uploadedAt: '2026-06-11T10:00:00.000Z',
      processedAt: '2026-06-11T10:00:03.000Z',
      analysis: {
        keyframeCount: 1,
        keyframeStrategy: 'scene-change',
        keyframes: [
          { fileName: 'frame_001.jpg', url: '/api/video/video-file-id/keyframes/frame_001.jpg', timestampSeconds: 0 },
        ],
        vision: {
          status: 'ready',
          summary: 'No explicit error message or failed loading state is shown in the provided frames.',
          findings: [
            {
              title: 'Oracle page appears loaded',
              evidence: 'Frame 1 shows the Oracle page visible after authentication.',
            },
          ],
          nextSteps: ['Ask the customer to reproduce the actual failing step.'],
        },
      },
    });
    vi.mocked(apiClient.getVideoTimeline).mockResolvedValue({ events: [] });

    render(
      <VideoEvidenceAnalyzer
        fileId="video-file-id"
        fileName="customer-session.mp4"
        fileSize={7340032}
        mediaType="video/mp4"
        isActive
        backendUrl="http://localhost:4000"
      />
    );

    expect((await screen.findAllByText('No visible failure captured')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Failure visible in recording')).not.toBeInTheDocument();
  });

  it('renders transcript-grounded audio and visual correlation when available', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    vi.mocked(apiClient.getVideoStatus).mockResolvedValue({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      fileSize: 7340032,
      status: 'vision_ready',
      durationSeconds: 90,
      ffprobeAvailable: true,
      uploadedAt: '2026-06-11T10:00:00.000Z',
      processedAt: '2026-06-11T10:00:03.000Z',
      analysis: {
        keyframeCount: 2,
        keyframeStrategy: 'scene-change',
        keyframes: [
          { fileName: 'frame_001.jpg', url: '/api/video/video-file-id/keyframes/frame_001.jpg', timestampSeconds: 0 },
          { fileName: 'frame_002.jpg', url: '/api/video/video-file-id/keyframes/frame_002.jpg', timestampSeconds: 18 },
        ],
        vision: {
          status: 'ready',
          summary: 'Frame 2 shows the Oracle mobile flow after Okta launch.',
          findings: [
            {
              title: 'Mobile Oracle screen visible',
              evidence: 'Frame 2 shows the Oracle mobile flow.',
              frameRefs: ['Frame 2'],
            },
          ],
          nextSteps: ['Verify Okta tile target URL.'],
        },
        transcript: {
          status: 'ready',
          summary: 'Customer says Oracle Financials fails after selecting the Okta tile.',
          sampled: true,
          coverageSeconds: 90,
          coverageNote: 'Fast transcript sampled 90 seconds around key visual moments.',
          segments: [
            {
              startSeconds: 12,
              endSeconds: 17,
              speaker: 'Customer',
              text: 'When I tap Oracle Financials from Okta it fails on the phone.',
            },
          ],
        },
        evidenceTimeline: [
          {
            kind: 'statement',
            timestampSeconds: 12,
            endTimestampSeconds: 17,
            title: 'Customer: When I tap Oracle Financials from Okta it fails on the phone.',
            detail: 'When I tap Oracle Financials from Okta it fails on the phone.',
            transcript: 'When I tap Oracle Financials from Okta it fails on the phone.',
            frameRefs: ['frame_002.jpg'],
            confidence: 'high',
          },
          {
            kind: 'visual',
            timestampSeconds: 18,
            title: 'Mobile Oracle screen visible',
            detail: 'Frame 2 shows the Oracle mobile flow.',
            frameRefs: ['Frame 2'],
            confidence: 'medium',
          },
        ],
        multimodal: {
          status: 'ready',
          summary: 'Audio and visual evidence point to mobile Okta launch troubleshooting.',
          findings: [
            {
              title: 'Spoken issue aligns with mobile Oracle screen',
              evidence: 'Transcript at 12s says Oracle Financials fails from Okta; Frame 2 shows the mobile Oracle flow.',
              action: 'Compare the Okta tile URL with desktop and mobile Safari behavior.',
              frameRefs: ['Frame 2'],
              transcriptRefs: ['12s-17s'],
              confidence: 'high',
            },
          ],
          nextSteps: ['Verify Okta tile target URL and mobile app assignment.'],
        },
        handoff: {
          status: 'ready',
          title: 'Engineer handoff for customer-session.mp4',
          summary: 'Audio and visual evidence point to mobile Okta launch troubleshooting.',
          verdict: 'Audio and visual evidence are correlated.',
          confirmedFacts: [
            'Visual review: Frame 2 shows the Oracle mobile flow after Okta launch.',
            'Transcript review: Customer says Oracle Financials fails after selecting the Okta tile.',
          ],
          evidenceCards: [
            {
              claim: 'Spoken issue aligns with mobile Oracle screen',
              evidence: 'Transcript at 12s says Oracle Financials fails from Okta; Frame 2 shows the mobile Oracle flow.',
              timestampSeconds: 12,
              frameRefs: ['Frame 2'],
              transcriptRefs: ['12s-17s'],
              transcript: 'When I tap Oracle Financials from Okta it fails on the phone.',
              confidence: 'high',
              nextStep: 'Compare the Okta tile URL with desktop and mobile Safari behavior.',
            },
          ],
          gaps: ['Transcript is a fast sampled pass around visual moments, not full-session transcription.'],
          nextSteps: ['Verify Okta tile target URL and mobile app assignment.'],
          timings: [
            { stage: 'keyframes', label: 'Key screen extraction', durationMs: 1250, status: 'complete' },
            { stage: 'transcript', label: 'Audio transcription', durationMs: 64250, status: 'complete' },
          ],
        },
      },
    } as any);
    vi.mocked(apiClient.getVideoTimeline).mockResolvedValue({ events: [] });

    render(
      <VideoEvidenceAnalyzer
        fileId="video-file-id"
        fileName="customer-session.mp4"
        fileSize={7340032}
        mediaType="video/mp4"
        isActive
        backendUrl="http://localhost:4000"
      />
    );

    expect(await screen.findByText('Audio + Visual Correlation')).toBeInTheDocument();
    expect(screen.getAllByText('Audio and visual evidence point to mobile Okta launch troubleshooting.').length).toBeGreaterThan(0);
    expect(screen.getByText('Fast transcript sampled 90 seconds around key visual moments.')).toBeInTheDocument();
    expect(screen.getAllByText('Spoken issue aligns with mobile Oracle screen').length).toBeGreaterThan(0);
    expect(screen.getByText('Engineer Handoff')).toBeInTheDocument();
    expect(screen.getAllByText('Audio and visual evidence are correlated.').length).toBeGreaterThan(0);
    expect(screen.getByText('Confirmed Facts')).toBeInTheDocument();
    expect(screen.getByText('Known Gaps')).toBeInTheDocument();
    expect(screen.getByText('Processing Timings')).toBeInTheDocument();
    expect(screen.getAllByText('Key screen extraction').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.3s').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1m 04s').length).toBeGreaterThan(0);
    expect(screen.getAllByText('12s-17s').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Evidence Timeline').length).toBeGreaterThan(0);
    expect(screen.getAllByText('12s').length).toBeGreaterThan(0);
    expect(screen.getAllByText('When I tap Oracle Financials from Okta it fails on the phone.').length).toBeGreaterThan(0);
    expect(screen.getByText('Transcript')).toBeInTheDocument();
    expect(screen.getAllByText('Frame 2').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /download markdown/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /copy sr handoff/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('# Engineer handoff for customer-session.mp4'));
    });
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /jump to evidence 1 at 12s/i }));
    expect(screen.getByRole('img', { name: /key screen frame_002\.jpg selected preview/i })).toBeInTheDocument();
  });

  it('keeps the video evidence page reachable inside the fixed-height analyzer shell', () => {
    expect(globalsCss).toMatch(/\.video-evidence-analyzer\s*\{[\s\S]*flex:\s*1 1 auto/);
    expect(globalsCss).toMatch(/\.video-evidence-analyzer\s*\{[\s\S]*min-height:\s*0/);
    expect(globalsCss).toMatch(/\.video-evidence-analyzer\s*\{[\s\S]*overflow-y:\s*auto/);
    expect(globalsCss).toMatch(/\.video-evidence-analyzer\s*\{[\s\S]*padding-bottom:\s*96px/);
  });

  it('prevents long AI findings from forcing horizontal page overflow', () => {
    expect(globalsCss).toMatch(/\.video-evidence-cockpit-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.5fr\)\s*minmax\(340px,\s*0\.5fr\)/);
    expect(globalsCss).toMatch(/\.video-evidence-review-header\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/);
    expect(globalsCss).toMatch(/\.video-evidence-analysis-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(globalsCss).toMatch(/\.video-evidence-activity-list p\s*\{[\s\S]*-webkit-line-clamp:\s*2/);
    expect(globalsCss).toMatch(/\.video-evidence-screen-stage\s*\{[\s\S]*border:\s*1px solid rgba\(14,\s*116,\s*144,\s*0\.22\)/);
    expect(globalsCss).toMatch(/\.video-evidence-moment-card\.is-active\s*\{[\s\S]*border-color:\s*#0e7490/);
    expect(globalsCss).toMatch(/\.video-evidence-timeline-marker\s*\{[\s\S]*top:\s*calc\(14px \+ \(var\(--video-evidence-marker-lane,\s*0\) \* 11px\)\)/);
    expect(globalsCss).toMatch(/@keyframes videoEvidenceMarkerIn/);
    expect(globalsCss).toMatch(/\.video-evidence-moment-strip\s*\{[\s\S]*grid-auto-columns:\s*minmax\(228px,\s*272px\)/);
    expect(globalsCss).toMatch(/\.video-evidence-ai-review\s*\{[\s\S]*max-height:\s*calc\(100vh - 150px\)/);
    expect(globalsCss).toMatch(/\.video-evidence-diagnostic-board\s*\{[\s\S]*grid-template-columns:/);
    expect(globalsCss).toMatch(/\.video-evidence-correlation-panel\s*\{[\s\S]*border:/);
    expect(globalsCss).toMatch(/\.video-evidence-evidence-timeline\s*\{[\s\S]*display:\s*grid/);
    expect(globalsCss).toMatch(/\.video-evidence-reasoning-lane\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(globalsCss).toMatch(/\.video-evidence-frame-context li span,\s*\.video-evidence-frame-context p\s*\{[\s\S]*overflow-wrap:/);
    expect(globalsCss).toMatch(/@keyframes videoEvidenceLiftIn/);
    expect(globalsCss).toMatch(/@keyframes videoEvidenceProgressSweep/);
    expect(globalsCss).toMatch(/\.video-evidence-technical-drawer\s*\{[\s\S]*overflow:\s*hidden/);
    expect(globalsCss).toMatch(/\.video-evidence-review-grid\s*\{[\s\S]*min-width:\s*0/);
    expect(globalsCss).toMatch(/\.video-evidence-review-grid\s*\{[\s\S]*overflow-x:\s*hidden/);
    expect(globalsCss).toMatch(/\.video-evidence-review-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*0\.82fr\)/);
    expect(globalsCss).toMatch(/\.video-evidence-vision\s*\{[\s\S]*overflow:\s*hidden/);
    expect(globalsCss).toMatch(/\.video-evidence-finding > div\s*\{[\s\S]*min-width:\s*0/);
    expect(globalsCss).toMatch(/\.video-evidence-finding h4[\s\S]*\.video-evidence-finding p[\s\S]*\{[\s\S]*overflow-wrap:\s*anywhere/);
    expect(globalsCss).toMatch(/@media \(max-width:\s*1320px\)\s*\{[\s\S]*\.video-evidence-media-review-grid,\s*[\s\S]*\.video-evidence-cockpit-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  });
});
