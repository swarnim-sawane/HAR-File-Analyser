// @vitest-environment node

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeVideoEvidence, markVideoEvidenceJobFailed } from './videoProcessor';

type MockCollection = {
  findOne: ReturnType<typeof vi.fn>;
  insertOne: ReturnType<typeof vi.fn>;
  updateOne: ReturnType<typeof vi.fn>;
};

const collections = new Map<string, MockCollection>();
const redisGet = vi.fn();
const redisSetex = vi.fn();
const publishToFile = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(),
    rm: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    rename: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  getMongoDb: () => ({
    collection: (name: string) => getCollection(name),
  }),
  getRedis: () => ({
    get: redisGet,
    setex: redisSetex,
  }),
}));

vi.mock('../utils/socketHelper', () => ({
  publishToFile,
}));

describe('videoProcessor analysis', () => {
  beforeEach(() => {
    collections.clear();
    redisGet.mockReset();
    redisSetex.mockReset();
    publishToFile.mockReset();
    vi.unstubAllEnvs();
    vi.mocked(execFile).mockReset();
    vi.mocked(fs.mkdir).mockReset();
    vi.mocked(fs.rm).mockReset();
    vi.mocked(fs.readdir).mockReset();
    vi.mocked(fs.readFile).mockReset();
    vi.mocked(fs.rename).mockReset();
    vi.mocked(fs.writeFile).mockReset();
    redisGet.mockResolvedValue(JSON.stringify({
      fileName: 'customer-session.mp4',
      fileSize: 7340032,
      fileType: 'video',
      status: 'ready',
    }));
  });

  it('finishes with analysis_blocked when backend video tools are unavailable', async () => {
    vi.mocked(execFile).mockImplementation((command: string, ...args: any[]) => {
      const callback = args.at(-1);
      callback(Object.assign(new Error(`spawn ${command} ENOENT`), { code: 'ENOENT' }), '', '');
      return {} as any;
    });

    await analyzeVideoEvidence({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      filePath: 'C:/processed/customer-session.mp4',
      fileSize: 7340032,
      fileType: 'video',
      hash: 'video-hash',
      uploadedAt: '2026-06-11T10:00:00.000Z',
    });

    expect(getCollection('video_files').updateOne).toHaveBeenCalledWith(
      { fileId: 'video-file-id' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'analysis_blocked',
          error: expect.stringContaining('ffprobe'),
        }),
      })
    );
    expect(getCollection('video_timeline').insertOne).toHaveBeenCalledWith(expect.objectContaining({
      fileId: 'video-file-id',
      stage: 'analysis_blocked',
      title: 'Video analysis needs backend tools',
      detail: expect.stringContaining('ffprobe'),
    }));
    expect(publishToFile).toHaveBeenCalledWith(
      'video-file-id',
      'file:status',
      expect.objectContaining({
        status: 'analysis_blocked',
      })
    );
  });

  it('marks a stalled video analysis job as error so the UI can retry instead of staying stuck', async () => {
    redisGet.mockResolvedValue(JSON.stringify({
      fileName: 'customer-session.mp4',
      fileSize: 7340032,
      fileType: 'video',
      status: 'analyzing',
    }));

    await markVideoEvidenceJobFailed(
      {
        fileId: 'video-file-id',
        fileName: 'customer-session.mp4',
        filePath: 'C:/processed/customer-session.mp4',
        fileSize: 7340032,
        fileType: 'video',
        hash: 'video-hash',
        uploadedAt: '2026-06-11T10:00:00.000Z',
      },
      'job stalled more than allowable limit',
      'analyze_video_evidence'
    );

    expect(getCollection('video_files').updateOne).toHaveBeenCalledWith(
      { fileId: 'video-file-id' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'error',
          error: 'job stalled more than allowable limit',
          analysisCompletedAt: expect.any(Date),
        }),
      })
    );
    expect(getCollection('video_timeline').insertOne).toHaveBeenCalledWith(expect.objectContaining({
      fileId: 'video-file-id',
      stage: 'error',
      title: 'Video analysis failed',
      detail: 'job stalled more than allowable limit',
    }));
    expect(redisSetex).toHaveBeenCalledWith(
      'file:video-file-id:metadata',
      86400,
      expect.stringContaining('"status":"error"')
    );
    expect(publishToFile).toHaveBeenCalledWith(
      'video-file-id',
      'file:status',
      expect.objectContaining({
        status: 'error',
        error: 'job stalled more than allowable limit',
      })
    );
  });

  it('extracts keyframes at scene-change inflection points instead of fixed 20 second intervals', async () => {
    const execCalls: Array<{ command: string; args: readonly string[] }> = [];
    vi.mocked(execFile).mockImplementation((command: string, args: readonly string[], ...rest: any[]) => {
      execCalls.push({ command, args });
      const callback = rest.at(-1);
      if (args.includes('-version')) {
        callback(null, 'version ok', '');
        return {} as any;
      }
      if (args.includes('-show_entries')) {
        callback(null, JSON.stringify({
          format: { duration: '180.0' },
          streams: [{ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 }],
        }), '');
        return {} as any;
      }
      if (args.includes('null')) {
        callback(null, {
          stdout: '',
          stderr: [
          '[Parsed_showinfo_1] n:0 pts:6000 pts_time:6 pos:123',
          '[Parsed_showinfo_1] n:1 pts:26000 pts_time:26 pos:456',
          '[Parsed_showinfo_1] n:2 pts:28000 pts_time:28 pos:789',
          '[Parsed_showinfo_1] n:3 pts:95000 pts_time:95 pos:999',
          ].join('\n'),
        });
        return {} as any;
      }
      callback(null, '', '');
      return {} as any;
    });
    vi.mocked(fs.readdir).mockResolvedValue([
      'frame_001.jpg',
      'frame_002.jpg',
      'frame_003.jpg',
      'frame_004.jpg',
    ] as any);

    await analyzeVideoEvidence({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      filePath: 'C:/processed/customer-session.mp4',
      fileSize: 7340032,
      fileType: 'video',
      hash: 'video-hash',
      uploadedAt: '2026-06-11T10:00:00.000Z',
    });

    const detectionCall = execCalls.find(call => call.args.some(arg => arg.includes('showinfo')));
    expect(detectionCall).toBeDefined();
    expect(detectionCall!.args.join(' ')).toContain('select=');
    expect(detectionCall!.args.join(' ')).toContain('scene');
    expect(execCalls.some(call => call.args.includes('fps=1/20,scale=960:-1'))).toBe(false);

    const extractionTimestamps = execCalls
      .filter(call => call.args.includes('-frames:v') && call.args.includes('-ss'))
      .map(call => call.args[call.args.indexOf('-ss') + 1]);
    expect(extractionTimestamps).toEqual(['0', '6', '26', '95']);

    expect(getCollection('video_files').updateOne).toHaveBeenCalledWith(
      { fileId: 'video-file-id' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'analysis_ready',
          analysis: expect.objectContaining({
            keyframeCount: 4,
            keyframes: [
              expect.objectContaining({ fileName: 'frame_001.jpg', timestampSeconds: 0 }),
              expect.objectContaining({ fileName: 'frame_002.jpg', timestampSeconds: 6 }),
              expect.objectContaining({ fileName: 'frame_003.jpg', timestampSeconds: 26 }),
              expect.objectContaining({ fileName: 'frame_004.jpg', timestampSeconds: 95 }),
            ],
          }),
        }),
      })
    );
  });

  it('spreads selected scene-change keyframes across the full recording when the frame budget is exceeded', async () => {
    vi.stubEnv('VIDEO_KEYFRAME_LIMIT', '3');
    const execCalls: Array<{ command: string; args: readonly string[] }> = [];
    vi.mocked(execFile).mockImplementation((command: string, args: readonly string[], ...rest: any[]) => {
      execCalls.push({ command, args });
      const callback = rest.at(-1);
      if (args.includes('-version')) {
        callback(null, 'version ok', '');
        return {} as any;
      }
      if (args.includes('-show_entries')) {
        callback(null, JSON.stringify({
          format: { duration: '120.0' },
          streams: [{ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 }],
        }), '');
        return {} as any;
      }
      if (args.includes('null')) {
        callback(null, {
          stdout: '',
          stderr: [
            '[Parsed_showinfo_1] n:0 pts:5000 pts_time:5 pos:111',
            '[Parsed_showinfo_1] n:1 pts:10000 pts_time:10 pos:222',
            '[Parsed_showinfo_1] n:2 pts:20000 pts_time:20 pos:333',
            '[Parsed_showinfo_1] n:3 pts:30000 pts_time:30 pos:444',
            '[Parsed_showinfo_1] n:4 pts:60000 pts_time:60 pos:555',
            '[Parsed_showinfo_1] n:5 pts:110000 pts_time:110 pos:666',
          ].join('\n'),
        });
        return {} as any;
      }
      callback(null, '', '');
      return {} as any;
    });
    vi.mocked(fs.readdir).mockResolvedValue(['frame_001.jpg', 'frame_002.jpg', 'frame_003.jpg'] as any);

    await analyzeVideoEvidence({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      filePath: 'C:/processed/customer-session.mp4',
      fileSize: 7340032,
      fileType: 'video',
      hash: 'video-hash',
      uploadedAt: '2026-06-11T10:00:00.000Z',
    });

    const extractionTimestamps = execCalls
      .filter(call => call.args.includes('-frames:v') && call.args.includes('-ss'))
      .map(call => call.args[call.args.indexOf('-ss') + 1]);
    expect(extractionTimestamps).toEqual(['0', '60', '110']);
  });

  it('stores AI vision findings when video tools and OCA are available', async () => {
    vi.stubEnv('OCA_BASE_URL', 'https://oca.example.test');
    vi.stubEnv('OCA_TOKEN', 'test-token');
    vi.stubEnv('OCA_MODEL', 'oca/gpt-5.4');
    vi.mocked(execFile).mockImplementation((command: string, args: readonly string[], ...rest: any[]) => {
      const callback = rest.at(-1);
      if (args.includes('-version')) {
        callback(null, 'version ok', '');
        return {} as any;
      }
      if (args.includes('-show_entries')) {
        callback(null, JSON.stringify({
          format: { duration: '120.5' },
          streams: [{ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 }],
        }), '');
        return {} as any;
      }
      if (args.includes('null')) {
        callback(null, {
          stdout: '',
          stderr: '[Parsed_showinfo_1] n:0 pts:10000 pts_time:10 pos:123',
        });
        return {} as any;
      }
      callback(null, '', '');
      return {} as any;
    });
    vi.mocked(fs.readdir).mockResolvedValue(['frame_001.jpg', 'frame_002.jpg'] as any);
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('fake-jpeg'));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"{\\"summary\\":\\"Customer sees a red error modal\\",\\"findings\\":[{\\"observation\\":\\"Error modal blocks submit\\",\\"evidence\\":\\"Frame 1 shows the modal\\",\\"action\\":\\"Inspect the failed submit request\\"},{\\"title\\":\\"Visual finding\\",\\"evidence\\":\\"Frame 2 shows the disabled Submit button after the error\\"}],\\"nextSteps\\":[\\"Compare timestamp with HAR failures\\"]}"}}]}\n\n'
          ));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
    })));

    await analyzeVideoEvidence({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      filePath: 'C:/processed/customer-session.mp4',
      fileSize: 7340032,
      fileType: 'video',
      hash: 'video-hash',
      uploadedAt: '2026-06-11T10:00:00.000Z',
    });

    expect(getCollection('video_files').updateOne).toHaveBeenCalledWith(
      { fileId: 'video-file-id' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'vision_ready',
          analysis: expect.objectContaining({
            keyframeCount: 2,
            vision: expect.objectContaining({
              status: 'ready',
              summary: 'Customer sees a red error modal',
              findings: [
                expect.objectContaining({ title: 'Error modal blocks submit' }),
                expect.objectContaining({ title: 'the disabled Submit button after the error' }),
              ],
            }),
          }),
        }),
      })
    );
    expect(getCollection('video_timeline').insertOne).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'vision_ready',
      title: 'AI visual findings ready',
    }));
  });

  it('uses OCA chat audio only when explicitly enabled and builds an audio-visual timeline', async () => {
    vi.stubEnv('OCA_BASE_URL', 'https://oca.example.test');
    vi.stubEnv('OCA_TOKEN', 'test-token');
    vi.stubEnv('OCA_MODEL', 'oca/gpt-5.4');
    vi.stubEnv('OCA_CHAT_AUDIO_ENABLED', 'true');
    const execCalls: Array<{ command: string; args: readonly string[] }> = [];

    vi.mocked(execFile).mockImplementation((command: string, args: readonly string[], ...rest: any[]) => {
      execCalls.push({ command, args });
      const callback = rest.at(-1);
      if (args.includes('-version')) {
        callback(null, 'version ok', '');
        return {} as any;
      }
      if (args.includes('-show_entries')) {
        callback(null, JSON.stringify({
          format: { duration: '90.0' },
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
        }), '');
        return {} as any;
      }
      if (args.includes('null')) {
        callback(null, {
          stdout: '',
          stderr: '[Parsed_showinfo_1] n:0 pts:18000 pts_time:18 pos:123',
        });
        return {} as any;
      }
      callback(null, '', '');
      return {} as any;
    });
    vi.mocked(fs.readdir).mockResolvedValue(['frame_001.jpg', 'frame_002.jpg'] as any);
    vi.mocked(fs.readFile).mockImplementation(async (filePath: any) => {
      const value = String(filePath);
      if (value.endsWith('.mp3') || value.endsWith('.wav')) return Buffer.from('fake-audio');
      return Buffer.from('fake-jpeg');
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      const contentText = JSON.stringify(payload.messages?.[1]?.content ?? payload.messages ?? []);
      const hasAudioInput = contentText.includes('input_audio');

      if (hasAudioInput) {
        return {
          ok: true,
          status: 200,
          body: createOcaStream('{"summary":"Customer says Oracle Financials fails after selecting the Okta tile.","segments":[{"startSeconds":12,"endSeconds":17,"speaker":"Customer","text":"When I tap Oracle Financials from Okta it fails on the phone."},{"start":42,"end":48,"speaker":"Engineer","text":"Please try the same production link from Safari."}]}'),
        };
      }

      return {
        ok: true,
        status: 200,
        body: createOcaStream(url.includes('/chat/completions') && contentText.includes('Transcript segments')
          ? '{"summary":"Audio and visual evidence point to mobile Okta launch troubleshooting.","findings":[{"title":"Spoken issue aligns with mobile Oracle screen","evidence":"Transcript at 12s says Oracle Financials fails from Okta; Frame 2 shows the mobile Oracle/Okta flow.","action":"Compare the Okta tile URL with desktop and mobile Safari behavior.","frameRefs":["Frame 2"],"transcriptRefs":["12s-17s"]}],"nextSteps":["Verify Okta tile target URL and mobile app assignment."]}'
          : '{"summary":"Visual review complete","findings":[{"title":"Mobile Oracle screen visible","evidence":"Frame 2 shows the mobile Oracle flow.","frameRefs":["Frame 2"]}],"nextSteps":["Compare with transcript."]}'),
      };
    }));

    await analyzeVideoEvidence({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      filePath: 'C:/processed/customer-session.mp4',
      fileSize: 7340032,
      fileType: 'video',
      hash: 'video-hash',
      uploadedAt: '2026-06-11T10:00:00.000Z',
    });

    expect(execCalls.some(call => call.args.includes('-vn') && call.args.includes('-ar') && call.args.includes('16000'))).toBe(true);
    const ocaAudioCall = vi.mocked(fetch).mock.calls.find(([url, init]) => {
      if (url !== 'https://oca.example.test/chat/completions') return false;
      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      return JSON.stringify(payload.messages?.[1]?.content ?? []).includes('input_audio');
    });
    expect(ocaAudioCall).toBeDefined();
    const ocaAudioPayload = JSON.parse(String(ocaAudioCall![1]?.body));
    expect(ocaAudioPayload).toEqual(expect.objectContaining({
      model: 'oca/gpt-5.4',
      stream: true,
      temperature: 0,
    }));
    expect(JSON.stringify(ocaAudioPayload.messages[1].content)).toContain('"type":"input_audio"');
    expect(JSON.stringify(ocaAudioPayload.messages[1].content)).toContain('"format":"mp3"');
    expect(JSON.stringify(ocaAudioPayload.messages[1].content)).toContain(Buffer.from('fake-audio').toString('base64'));
    expect(getCollection('video_files').updateOne).toHaveBeenCalledWith(
      { fileId: 'video-file-id' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'vision_ready',
          analysis: expect.objectContaining({
            transcript: expect.objectContaining({
              status: 'ready',
              summary: 'Customer says Oracle Financials fails after selecting the Okta tile.',
              segments: [
                expect.objectContaining({
                  startSeconds: 12,
                  endSeconds: 17,
                  speaker: 'Customer',
                  text: 'When I tap Oracle Financials from Okta it fails on the phone.',
                }),
                expect.objectContaining({
                  startSeconds: 42,
                  endSeconds: 48,
                  speaker: 'Engineer',
                }),
              ],
            }),
            evidenceTimeline: expect.arrayContaining([
              expect.objectContaining({
                kind: 'statement',
                timestampSeconds: 12,
                transcript: 'When I tap Oracle Financials from Okta it fails on the phone.',
                frameRefs: ['frame_002.jpg'],
              }),
              expect.objectContaining({
                kind: 'visual',
                frameRefs: ['Frame 2'],
              }),
              expect.objectContaining({
                kind: 'correlation',
                title: 'Spoken context aligns with Mobile Oracle screen visible',
                transcriptRefs: ['12s-17s'],
                frameRefs: expect.arrayContaining(['Frame 2']),
              }),
            ]),
            multimodal: expect.objectContaining({
              status: 'ready',
              summary: 'Audio and visual evidence point to mobile Okta launch troubleshooting.',
              findings: [
                expect.objectContaining({
                  title: 'Spoken issue aligns with mobile Oracle screen',
                  transcriptRefs: ['12s-17s'],
                }),
              ],
            }),
            handoff: expect.objectContaining({
              status: 'ready',
              verdict: 'Audio and visual evidence are correlated.',
              evidenceCards: [
                expect.objectContaining({
                  claim: 'Spoken issue aligns with mobile Oracle screen',
                  frameRefs: ['Frame 2'],
                  transcriptRefs: ['12s-17s'],
                }),
              ],
              timings: expect.arrayContaining([
                expect.objectContaining({ stage: 'keyframes' }),
                expect.objectContaining({ stage: 'transcript' }),
                expect.objectContaining({ stage: 'handoff' }),
              ]),
            }),
            timings: expect.arrayContaining([
              expect.objectContaining({ stage: 'timeline' }),
            ]),
          }),
        }),
      })
    );
  });

  it('falls back to the dedicated transcription endpoint when explicitly enabled OCA chat audio is rejected', async () => {
    vi.stubEnv('OCA_BASE_URL', 'https://oca.example.test');
    vi.stubEnv('OCA_TOKEN', 'test-token');
    vi.stubEnv('OCA_MODEL', 'oca/gpt-5.4');
    vi.stubEnv('OCA_CHAT_AUDIO_ENABLED', 'true');
    vi.stubEnv('OCA_TRANSCRIPTION_URL', 'https://oca.example.test/audio/transcriptions');
    vi.stubEnv('OCA_TRANSCRIPTION_MODEL', 'oca/transcribe-large');
    const execCalls: Array<{ command: string; args: readonly string[] }> = [];

    vi.mocked(execFile).mockImplementation((command: string, args: readonly string[], ...rest: any[]) => {
      execCalls.push({ command, args });
      const callback = rest.at(-1);
      if (args.includes('-version')) {
        callback(null, 'version ok', '');
        return {} as any;
      }
      if (args.includes('-show_entries')) {
        callback(null, JSON.stringify({
          format: { duration: '90.0' },
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
        }), '');
        return {} as any;
      }
      if (args.includes('null')) {
        callback(null, {
          stdout: '',
          stderr: '[Parsed_showinfo_1] n:0 pts:18000 pts_time:18 pos:123',
        });
        return {} as any;
      }
      callback(null, '', '');
      return {} as any;
    });
    vi.mocked(fs.readdir).mockResolvedValue(['frame_001.jpg', 'frame_002.jpg'] as any);
    vi.mocked(fs.readFile).mockImplementation(async (filePath: any) => {
      const value = String(filePath);
      if (value.endsWith('.mp3') || value.endsWith('.wav')) return Buffer.from('fake-audio');
      return Buffer.from('fake-jpeg');
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      const contentText = JSON.stringify(payload.messages?.[1]?.content ?? payload.messages ?? []);
      if (contentText.includes('input_audio')) {
        return {
          ok: false,
          status: 415,
          text: async () => 'input_audio is not supported by this OCA route',
        };
      }

      if (url.includes('/audio/transcriptions')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            summary: 'Customer says Oracle Financials fails after selecting the Okta tile.',
            segments: [
              {
                startSeconds: 12,
                endSeconds: 17,
                speaker: 'Customer',
                text: 'When I tap Oracle Financials from Okta it fails on the phone.',
              },
              {
                start: 42,
                end: 48,
                speaker: 'Engineer',
                text: 'Please try the same production link from Safari.',
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        body: createOcaStream(url.includes('/chat/completions') && contentText.includes('Transcript segments')
          ? '{"summary":"Audio and visual evidence point to mobile Okta launch troubleshooting.","findings":[{"title":"Spoken issue aligns with mobile Oracle screen","evidence":"Transcript at 12s says Oracle Financials fails from Okta; Frame 2 shows the mobile Oracle/Okta flow.","action":"Compare the Okta tile URL with desktop and mobile Safari behavior.","frameRefs":["Frame 2"],"transcriptRefs":["12s-17s"]}],"nextSteps":["Verify Okta tile target URL and mobile app assignment."]}'
          : '{"summary":"Visual review complete","findings":[{"title":"Mobile Oracle screen visible","evidence":"Frame 2 shows the mobile Oracle flow.","frameRefs":["Frame 2"]}],"nextSteps":["Compare with transcript."]}'),
      };
    }));

    await analyzeVideoEvidence({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      filePath: 'C:/processed/customer-session.mp4',
      fileSize: 7340032,
      fileType: 'video',
      hash: 'video-hash',
      uploadedAt: '2026-06-11T10:00:00.000Z',
    });

    expect(execCalls.some(call => call.args.includes('-vn') && call.args.includes('-ar') && call.args.includes('16000'))).toBe(true);
    expect(vi.mocked(fetch).mock.calls.some(([url, init]) => {
      if (url !== 'https://oca.example.test/chat/completions') return false;
      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      return JSON.stringify(payload.messages?.[1]?.content ?? []).includes('input_audio');
    })).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://oca.example.test/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
      })
    );
    expect(getCollection('video_files').updateOne).toHaveBeenCalledWith(
      { fileId: 'video-file-id' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'vision_ready',
          analysis: expect.objectContaining({
            transcript: expect.objectContaining({
              status: 'ready',
              summary: 'Customer says Oracle Financials fails after selecting the Okta tile.',
              segments: [
                expect.objectContaining({
                  startSeconds: 12,
                  endSeconds: 17,
                  speaker: 'Customer',
                  text: 'When I tap Oracle Financials from Okta it fails on the phone.',
                }),
                expect.objectContaining({
                  startSeconds: 42,
                  endSeconds: 48,
                  speaker: 'Engineer',
                }),
              ],
            }),
            evidenceTimeline: expect.arrayContaining([
              expect.objectContaining({
                kind: 'statement',
                timestampSeconds: 12,
                transcript: 'When I tap Oracle Financials from Okta it fails on the phone.',
                frameRefs: ['frame_002.jpg'],
              }),
              expect.objectContaining({
                kind: 'visual',
                frameRefs: ['Frame 2'],
              }),
            ]),
            multimodal: expect.objectContaining({
              status: 'ready',
              summary: 'Audio and visual evidence point to mobile Okta launch troubleshooting.',
              findings: [
                expect.objectContaining({
                  title: 'Spoken issue aligns with mobile Oracle screen',
                  transcriptRefs: ['12s-17s'],
                }),
              ],
            }),
          }),
        }),
      })
    );
    expect(getCollection('video_timeline').insertOne).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'fast_transcript_ready',
      title: 'Fast sampled transcript extracted',
      detail: expect.stringContaining('2 timestamped segment'),
    }));
    expect(getCollection('video_timeline').insertOne).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'multimodal_ready',
      title: 'Audio and visual evidence correlated',
    }));
  });

  it('does not send input_audio to OCA chat by default when LiteLLM transcription rejects audio', async () => {
    vi.stubEnv('OCA_BASE_URL', 'https://oca.example.test');
    vi.stubEnv('OCA_TOKEN', 'test-token');
    vi.stubEnv('OCA_MODEL', 'oca/gpt-5.4');
    const execCalls: Array<{ command: string; args: readonly string[] }> = [];
    vi.mocked(execFile).mockImplementation((command: string, args: readonly string[], ...rest: any[]) => {
      execCalls.push({ command, args });
      const callback = rest.at(-1);
      if (args.includes('-version')) {
        callback(null, 'version ok', '');
        return {} as any;
      }
      if (args.includes('-show_entries')) {
        callback(null, JSON.stringify({
          format: { duration: '90.0' },
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
        }), '');
        return {} as any;
      }
      if (args.includes('null')) {
        callback(null, { stdout: '', stderr: '' });
        return {} as any;
      }
      callback(null, '', '');
      return {} as any;
    });
    vi.mocked(fs.readdir).mockResolvedValue(['frame_001.jpg'] as any);
    vi.mocked(fs.readFile).mockImplementation(async (filePath: any) => {
      const value = String(filePath);
      if (value.endsWith('.mp3') || value.endsWith('.wav')) return Buffer.from('fake-audio');
      return Buffer.from('fake-jpeg');
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://oca.example.test/v1/audio/transcriptions') {
        return {
          ok: false,
          status: 404,
          text: async () => 'transcription model is not configured',
        };
      }

      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      expect(JSON.stringify(payload.messages?.[1]?.content ?? payload.messages ?? [])).not.toContain('input_audio');
      return {
        ok: true,
        status: 200,
        body: createOcaStream('{"summary":"Visual-only analysis complete","findings":[{"title":"Oracle page visible","evidence":"Frame 1 shows Oracle page."}],"nextSteps":["Configure audio transcription for spoken context."]}'),
      };
    }));

    await analyzeVideoEvidence({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      filePath: 'C:/processed/customer-session.mp4',
      fileSize: 7340032,
      fileType: 'video',
      hash: 'video-hash',
      uploadedAt: '2026-06-11T10:00:00.000Z',
    });

    expect(execCalls.some(call => call.args.includes('-vn') && call.args.includes('-ar') && call.args.includes('16000'))).toBe(true);
    expect(getCollection('video_files').updateOne).toHaveBeenCalledWith(
      { fileId: 'video-file-id' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'vision_ready',
          analysis: expect.objectContaining({
            transcript: expect.objectContaining({
              status: 'error',
              segments: [],
              error: expect.stringContaining('LiteLLM transcription request failed (404)'),
            }),
            multimodal: expect.objectContaining({
              status: 'partial',
            }),
          }),
        }),
      })
    );
  });

  it('uses the OCA LiteLLM audio transcription endpoint by default when only OCA API access is configured', async () => {
    vi.stubEnv('OCA_BASE_URL', 'https://oca.example.test/20250206/app/litellm');
    vi.stubEnv('OCA_TOKEN', 'test-token');
    vi.stubEnv('OCA_MODEL', 'gpt-5.5');
    vi.stubEnv('LITELLM_TRANSCRIPTION_MODEL', 'gpt-4o-transcribe');
    const execCalls: Array<{ command: string; args: readonly string[] }> = [];
    vi.mocked(execFile).mockImplementation((command: string, args: readonly string[], ...rest: any[]) => {
      execCalls.push({ command, args });
      const callback = rest.at(-1);
      if (args.includes('-version')) {
        callback(null, 'version ok', '');
        return {} as any;
      }
      if (args.includes('-show_entries')) {
        callback(null, JSON.stringify({
          format: { duration: '90.0' },
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
        }), '');
        return {} as any;
      }
      if (args.includes('null')) {
        callback(null, {
          stdout: '',
          stderr: '[Parsed_showinfo_1] n:0 pts:18000 pts_time:18 pos:123',
        });
        return {} as any;
      }
      callback(null, '', '');
      return {} as any;
    });
    vi.mocked(fs.readdir).mockResolvedValue(['frame_001.jpg', 'frame_002.jpg'] as any);
    vi.mocked(fs.readFile).mockImplementation(async (filePath: any) => {
      const value = String(filePath);
      if (value.endsWith('.mp3') || value.endsWith('.wav')) return Buffer.from('fake-audio');
      return Buffer.from('fake-jpeg');
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://oca.example.test/20250206/app/litellm/v1/audio/transcriptions') {
        const body = init?.body as any;
        expect(init).toEqual(expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }));
        expect(body.get('model')).toBe('gpt-4o-transcribe');
        expect(body.get('response_format')).toBe('verbose_json');
        expect(body.get('timestamp_granularities[]')).toBe('segment');
        expect(body.get('file')).toBeDefined();
        return {
          ok: true,
          status: 200,
          json: async () => ({
            text: 'Customer says Oracle Financials fails from Okta on mobile.',
            segments: [
              {
                start: 12,
                end: 17,
                text: 'Customer says Oracle Financials fails from Okta on mobile.',
              },
            ],
          }),
        };
      }

      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      const contentText = JSON.stringify(payload.messages?.[1]?.content ?? payload.messages ?? []);
      expect(contentText).not.toContain('input_audio');
      return {
        ok: true,
        status: 200,
        body: createOcaStream(contentText.includes('Transcript segments')
          ? '{"summary":"Transcript and screen evidence are correlated.","findings":[{"title":"Mobile Okta issue stated while Oracle screen is visible","evidence":"Transcript at 12s states the issue; Frame 2 shows the mobile flow.","frameRefs":["Frame 2"],"transcriptRefs":["12s-17s"]}],"nextSteps":["Verify the Okta tile target URL."]}'
          : '{"summary":"Visual analysis complete","findings":[{"title":"Mobile Oracle screen visible","evidence":"Frame 2 shows the mobile Oracle flow.","frameRefs":["Frame 2"]}],"nextSteps":["Compare with transcript."]}'),
      };
    }));

    await analyzeVideoEvidence({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      filePath: 'C:/processed/customer-session.mp4',
      fileSize: 7340032,
      fileType: 'video',
      hash: 'video-hash',
      uploadedAt: '2026-06-11T10:00:00.000Z',
    });

    expect(execCalls.some(call => call.args.includes('-vn') && call.args.includes('-ar') && call.args.includes('16000'))).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://oca.example.test/20250206/app/litellm/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
    expect(getCollection('video_files').updateOne).toHaveBeenCalledWith(
      { fileId: 'video-file-id' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'vision_ready',
          analysis: expect.objectContaining({
            transcript: expect.objectContaining({
              status: 'ready',
              summary: 'Customer says Oracle Financials fails from Okta on mobile.',
              segments: [
                expect.objectContaining({
                  startSeconds: 12,
                  endSeconds: 17,
                  text: 'Customer says Oracle Financials fails from Okta on mobile.',
                }),
              ],
            }),
            multimodal: expect.objectContaining({
              status: 'ready',
              summary: 'Transcript and screen evidence are correlated.',
            }),
          }),
        }),
      })
    );
  });

  it('samples bounded audio windows for long recordings instead of transcribing the whole video on cache miss', async () => {
    vi.stubEnv('OCA_BASE_URL', 'https://oca.example.test/20250206/app/litellm');
    vi.stubEnv('OCA_TOKEN', 'test-token');
    vi.stubEnv('OCA_MODEL', 'gpt-5.5');
    vi.stubEnv('LITELLM_TRANSCRIPTION_MODEL', 'gpt-4o-transcribe');
    vi.stubEnv('VIDEO_FAST_TRANSCRIPT_MAX_SECONDS', '90');
    vi.stubEnv('VIDEO_FAST_TRANSCRIPT_WINDOW_SECONDS', '30');
    const execCalls: Array<{ command: string; args: readonly string[] }> = [];

    vi.mocked(execFile).mockImplementation((command: string, args: readonly string[], ...rest: any[]) => {
      execCalls.push({ command, args });
      const callback = rest.at(-1);
      if (args.includes('-version')) {
        callback(null, 'version ok', '');
        return {} as any;
      }
      if (args.includes('-show_entries')) {
        callback(null, JSON.stringify({
          format: { duration: '3600.0' },
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
        }), '');
        return {} as any;
      }
      if (args.includes('null')) {
        callback(null, {
          stdout: '',
          stderr: [
            '[Parsed_showinfo_1] n:0 pts:600000 pts_time:600 pos:123',
            '[Parsed_showinfo_1] n:1 pts:1800000 pts_time:1800 pos:456',
            '[Parsed_showinfo_1] n:2 pts:3000000 pts_time:3000 pos:789',
          ].join('\n'),
        });
        return {} as any;
      }
      callback(null, '', '');
      return {} as any;
    });
    vi.mocked(fs.readdir).mockResolvedValue(['frame_001.jpg', 'frame_002.jpg', 'frame_003.jpg'] as any);
    vi.mocked(fs.readFile).mockImplementation(async (filePath: any) => {
      const value = String(filePath);
      if (value.endsWith('.mp3') || value.endsWith('.wav')) return Buffer.from('fake-audio');
      return Buffer.from('fake-jpeg');
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://oca.example.test/20250206/app/litellm/v1/audio/transcriptions') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            text: 'The customer says the failure appears after the screen changes.',
            segments: [
              {
                start: 35,
                end: 40,
                text: 'The customer says the failure appears after the screen changes.',
              },
            ],
          }),
        };
      }

      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      const contentText = JSON.stringify(payload.messages?.[1]?.content ?? payload.messages ?? []);
      return {
        ok: true,
        status: 200,
        body: createOcaStream(contentText.includes('Transcript segments')
          ? '{"summary":"Sampled transcript and screen evidence are correlated.","findings":[{"title":"Spoken failure window aligns with selected screen","evidence":"Transcript maps to the sampled middle window; Frame 2 shows the screen change.","frameRefs":["Frame 2"],"transcriptRefs":["1790s-1795s"]}],"nextSteps":["Collect exact timestamp if deeper audio is needed."]}'
          : '{"summary":"Visual analysis complete","findings":[{"title":"Screen changes visible","evidence":"Frames 1-3 show different application states.","frameRefs":["Frame 1","Frame 2","Frame 3"]}],"nextSteps":["Correlate with sampled audio."]}'),
      };
    }));

    await analyzeVideoEvidence({
      fileId: 'video-file-id',
      fileName: 'one-hour-customer-session.mp4',
      filePath: 'C:/processed/one-hour-customer-session.mp4',
      fileSize: 120000000,
      fileType: 'video',
      hash: 'video-hash',
      uploadedAt: '2026-06-11T10:00:00.000Z',
    });

    const audioSegmentCalls = execCalls.filter(call => call.args.includes('-vn') && call.args.includes('-ar'));
    expect(audioSegmentCalls.length).toBeGreaterThanOrEqual(2);
    expect(audioSegmentCalls.every(call => call.args.includes('-ss') && call.args.includes('-t'))).toBe(true);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('sample_concat.txt'),
      expect.stringContaining('sample_001.mp3'),
      'utf8'
    );
    expect(getCollection('video_transcripts').updateOne).not.toHaveBeenCalled();
    expect(getCollection('video_files').updateOne).toHaveBeenCalledWith(
      { fileId: 'video-file-id' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'vision_ready',
          analysis: expect.objectContaining({
            transcript: expect.objectContaining({
              status: 'ready',
              sampled: true,
              coverageSeconds: 90,
              segments: [
                expect.objectContaining({
                  startSeconds: 590,
                  endSeconds: 595,
                  text: 'The customer says the failure appears after the screen changes.',
                }),
              ],
            }),
            multimodal: expect.objectContaining({
              status: 'ready',
              summary: 'Sampled transcript and screen evidence are correlated.',
            }),
          }),
        }),
      })
    );
  });

  it('falls back to local OpenAI Whisper when remote transcription is unavailable and local Whisper is enabled', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubEnv('OCA_BASE_URL', 'https://oca.example.test/20250206/app/litellm');
    vi.stubEnv('OCA_TOKEN', 'test-token');
    vi.stubEnv('OCA_MODEL', 'gpt-5.5');
    vi.stubEnv('VIDEO_LOCAL_WHISPER_ENABLED', 'true');
    vi.stubEnv('WHISPER_COMMAND', 'whisper');
    vi.stubEnv('WHISPER_MODEL', 'small');
    vi.stubEnv('WHISPER_LANGUAGE', 'en');
    vi.stubEnv('FFMPEG_PATH', 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe');
    const execCalls: Array<{ command: string; args: readonly string[] }> = [];
    vi.mocked(execFile).mockImplementation((command: string, args: readonly string[], ...rest: any[]) => {
      execCalls.push({ command, args });
      const callback = rest.at(-1);
      if (args.includes('-version')) {
        callback(null, 'version ok', '');
        return {} as any;
      }
      if (args.includes('-show_entries')) {
        callback(null, JSON.stringify({
          format: { duration: '90.0' },
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
        }), '');
        return {} as any;
      }
      if (args.includes('null')) {
        callback(null, {
          stdout: '',
          stderr: '[Parsed_showinfo_1] n:0 pts:18000 pts_time:18 pos:123',
        });
        return {} as any;
      }
      callback(null, '', '');
      return {} as any;
    });
    vi.mocked(fs.readdir).mockImplementation(async (directory: any) => {
      const value = String(directory);
      if (value.includes('_whisper')) return ['audio.json'] as any;
      return ['frame_001.jpg', 'frame_002.jpg'] as any;
    });
    vi.mocked(fs.readFile).mockImplementation(async (filePath: any) => {
      const value = String(filePath);
      if (value.endsWith('audio.json')) {
        return Buffer.from(JSON.stringify({
          text: 'Customer says Oracle Financials fails from Okta on mobile.',
          segments: [
            {
              start: 12,
              end: 17,
              text: 'Customer says Oracle Financials fails from Okta on mobile.',
            },
          ],
        }));
      }
      if (value.endsWith('.mp3') || value.endsWith('.wav')) return Buffer.from('fake-audio');
      return Buffer.from('fake-jpeg');
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://oca.example.test/20250206/app/litellm/v1/audio/transcriptions') {
        return {
          ok: false,
          status: 404,
          text: async () => 'transcription model is not configured',
        };
      }

      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      const contentText = JSON.stringify(payload.messages?.[1]?.content ?? payload.messages ?? []);
      expect(contentText).not.toContain('input_audio');
      return {
        ok: true,
        status: 200,
        body: createOcaStream(contentText.includes('Transcript segments')
          ? '{"summary":"Local transcript and screen evidence are correlated.","findings":[{"title":"Spoken issue aligns with mobile Oracle screen","evidence":"Transcript at 12s states the mobile Okta issue; Frame 2 shows the mobile flow.","frameRefs":["Frame 2"],"transcriptRefs":["12s-17s"]}],"nextSteps":["Verify the Okta tile target URL."]}'
          : '{"summary":"Visual analysis complete","findings":[{"title":"Mobile Oracle screen visible","evidence":"Frame 2 shows the mobile Oracle flow.","frameRefs":["Frame 2"]}],"nextSteps":["Compare with transcript."]}'),
      };
    }));

    await analyzeVideoEvidence({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      filePath: 'C:/processed/customer-session.mp4',
      fileSize: 7340032,
      fileType: 'video',
      hash: 'video-hash',
      uploadedAt: '2026-06-11T10:00:00.000Z',
    });

    const whisperCall = execCalls.find(call => call.command === 'whisper');
    expect(whisperCall).toBeDefined();
    expect(whisperCall!.args).toEqual(expect.arrayContaining([
      '--model',
      'small',
      '--language',
      'en',
      '--output_format',
      'json',
      '--fp16',
      'False',
    ]));
    expect(vi.mocked(execFile).mock.calls.find(([command]) => command === 'whisper')?.[2]).toEqual(expect.objectContaining({
      env: expect.objectContaining({
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      }),
    }));
    const whisperEnv = vi.mocked(execFile).mock.calls.find(([command]) => command === 'whisper')?.[2]?.env as NodeJS.ProcessEnv;
    expect(whisperEnv.PATH || whisperEnv.Path).toContain(path.dirname(process.env.FFMPEG_PATH || 'ffmpeg'));
    expect(getCollection('video_files').updateOne).toHaveBeenCalledWith(
      { fileId: 'video-file-id' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'vision_ready',
          analysis: expect.objectContaining({
            transcript: expect.objectContaining({
              status: 'ready',
              model: 'local-whisper:small',
              summary: 'Customer says Oracle Financials fails from Okta on mobile.',
              segments: [
                expect.objectContaining({
                  startSeconds: 12,
                  endSeconds: 17,
                  text: 'Customer says Oracle Financials fails from Okta on mobile.',
                }),
              ],
            }),
            multimodal: expect.objectContaining({
              status: 'ready',
              summary: 'Local transcript and screen evidence are correlated.',
            }),
          }),
        }),
      })
    );
    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining('[video:video-file-id] analysis:start'),
      expect.objectContaining({
        fileName: 'customer-session.mp4',
      })
    );
    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining('[video:video-file-id] audio:extract:start'),
      expect.objectContaining({
        audioFormat: 'mp3',
      })
    );
    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining('[video:video-file-id] audio:transcribe:provider:start'),
      expect.objectContaining({
        provider: 'litellm',
        model: 'whisper',
      })
    );
    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining('[video:video-file-id] audio:transcribe:provider:error'),
      expect.objectContaining({
        provider: 'litellm',
        error: expect.stringContaining('LiteLLM transcription request failed (404)'),
      })
    );
    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining('[video:video-file-id] audio:transcribe:provider:start'),
      expect.objectContaining({
        provider: 'local-whisper',
        model: 'small',
      })
    );
    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining('[video:video-file-id] audio:transcribe:provider:done'),
      expect.objectContaining({
        provider: 'local-whisper',
        segments: 1,
        durationMs: expect.any(Number),
      })
    );
    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining('[video:video-file-id] analysis:complete'),
      expect.objectContaining({
        finalStatus: 'vision_ready',
      })
    );
    consoleInfo.mockRestore();
  });

  it('reuses a cached transcript for the same video hash and local Whisper model', async () => {
    vi.stubEnv('OCA_BASE_URL', 'https://oca.example.test/20250206/app/litellm');
    vi.stubEnv('OCA_TOKEN', 'test-token');
    vi.stubEnv('OCA_MODEL', 'gpt-5.5');
    vi.stubEnv('VIDEO_TRANSCRIPTION_PROVIDER', 'local-whisper');
    vi.stubEnv('WHISPER_MODEL', 'base');
    vi.stubEnv('WHISPER_LANGUAGE', 'en');
    const execCalls: Array<{ command: string; args: readonly string[] }> = [];
    getCollection('video_transcripts').findOne.mockResolvedValue({
      sourceHash: 'video-hash',
      model: 'local-whisper:base',
      audioFormat: 'mp3',
      language: 'en',
      summary: 'Cached transcript says the user can log in but sees unexpected menu options.',
      segments: [
        {
          startSeconds: 12,
          endSeconds: 18,
          text: 'The user can log in but sees unexpected menu options.',
        },
      ],
    });

    vi.mocked(execFile).mockImplementation((command: string, args: readonly string[], ...rest: any[]) => {
      execCalls.push({ command, args });
      const callback = rest.at(-1);
      if (args.includes('-version')) {
        callback(null, 'version ok', '');
        return {} as any;
      }
      if (args.includes('-show_entries')) {
        callback(null, JSON.stringify({
          format: { duration: '90.0' },
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
        }), '');
        return {} as any;
      }
      if (args.includes('null')) {
        callback(null, {
          stdout: '',
          stderr: '[Parsed_showinfo_1] n:0 pts:18000 pts_time:18 pos:123',
        });
        return {} as any;
      }
      callback(null, '', '');
      return {} as any;
    });
    vi.mocked(fs.readdir).mockResolvedValue(['frame_001.jpg', 'frame_002.jpg'] as any);
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('fake-jpeg'));
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      const contentText = JSON.stringify(payload.messages?.[1]?.content ?? payload.messages ?? []);
      return {
        ok: true,
        status: 200,
        body: createOcaStream(contentText.includes('Transcript segments')
          ? '{"summary":"Cached transcript and screen evidence are correlated.","findings":[{"title":"Cached transcript reused for correlation","evidence":"Transcript at 12s states menu issue; Frame 2 shows the related screen.","frameRefs":["Frame 2"],"transcriptRefs":["12s-18s"]}],"nextSteps":["Verify role configuration."]}'
          : '{"summary":"Visual analysis complete","findings":[{"title":"Oracle screen visible","evidence":"Frame 2 shows Oracle UI.","frameRefs":["Frame 2"]}],"nextSteps":["Compare with transcript."]}'),
      };
    }));

    await analyzeVideoEvidence({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      filePath: 'C:/processed/customer-session.mp4',
      fileSize: 7340032,
      fileType: 'video',
      hash: 'video-hash',
      uploadedAt: '2026-06-11T10:00:00.000Z',
    });

    expect(execCalls.some(call => call.args.includes('-vn'))).toBe(false);
    expect(execCalls.some(call => call.command === 'whisper' || call.args.includes('whisper'))).toBe(false);
    expect(getCollection('video_transcripts').insertOne).not.toHaveBeenCalled();
    expect(getCollection('video_files').updateOne).toHaveBeenCalledWith(
      { fileId: 'video-file-id' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'vision_ready',
          analysis: expect.objectContaining({
            transcript: expect.objectContaining({
              status: 'ready',
              model: 'local-whisper:base',
              summary: 'Cached transcript says the user can log in but sees unexpected menu options.',
              segments: [
                expect.objectContaining({
                  startSeconds: 12,
                  endSeconds: 18,
                  text: 'The user can log in but sees unexpected menu options.',
                }),
              ],
            }),
            multimodal: expect.objectContaining({
              status: 'ready',
              summary: 'Cached transcript and screen evidence are correlated.',
            }),
          }),
        }),
      })
    );
  });

  it('continues visual analysis when OCA audio transcription fails', async () => {
    vi.stubEnv('OCA_BASE_URL', 'https://oca.example.test');
    vi.stubEnv('OCA_TOKEN', 'test-token');
    vi.stubEnv('OCA_CHAT_AUDIO_ENABLED', 'true');
    vi.mocked(execFile).mockImplementation((command: string, args: readonly string[], ...rest: any[]) => {
      const callback = rest.at(-1);
      if (args.includes('-version')) {
        callback(null, 'version ok', '');
        return {} as any;
      }
      if (args.includes('-show_entries')) {
        callback(null, JSON.stringify({
          format: { duration: '90.0' },
          streams: [
            { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
        }), '');
        return {} as any;
      }
      if (args.includes('null')) {
        callback(null, { stdout: '', stderr: '' });
        return {} as any;
      }
      callback(null, '', '');
      return {} as any;
    });
    vi.mocked(fs.readdir).mockResolvedValue(['frame_001.jpg'] as any);
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('fake-jpeg'));
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      const contentText = JSON.stringify(payload.messages?.[1]?.content ?? payload.messages ?? []);
      if (contentText.includes('input_audio')) {
        return {
          ok: false,
          status: 400,
          text: async () => 'audio input rejected',
        };
      }

      return {
        ok: true,
        status: 200,
        body: createOcaStream('{"summary":"Visual-only analysis complete","findings":[{"title":"Oracle page visible","evidence":"Frame 1 shows Oracle page."}],"nextSteps":["Retry audio transcript if OCA audio becomes available."]}'),
      };
    }));

    await analyzeVideoEvidence({
      fileId: 'video-file-id',
      fileName: 'customer-session.mp4',
      filePath: 'C:/processed/customer-session.mp4',
      fileSize: 7340032,
      fileType: 'video',
      hash: 'video-hash',
      uploadedAt: '2026-06-11T10:00:00.000Z',
    });

    expect(getCollection('video_files').updateOne).toHaveBeenCalledWith(
      { fileId: 'video-file-id' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'vision_ready',
          analysis: expect.objectContaining({
            transcript: expect.objectContaining({
              status: 'error',
              segments: [],
              error: expect.stringContaining('OCA multimodal audio transcription failed (400)'),
            }),
            multimodal: expect.objectContaining({
              status: 'partial',
            }),
          }),
        }),
      })
    );
  });
});

function createOcaStream(content: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        `data: {"choices":[{"delta":{"content":${JSON.stringify(content)}}}]}\n\n`
      ));
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

function getCollection(name: string): MockCollection {
  const existing = collections.get(name);
  if (existing) return existing;

  const collection = {
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    updateOne: vi.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
  };
  collections.set(name, collection);
  return collection;
}
