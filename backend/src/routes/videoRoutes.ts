import express, { Request, Response } from 'express';
import { Queue } from 'bullmq';
import { createReadStream } from 'fs';
import path from 'path';
import { promises as fs } from 'fs';
import { getMongoDb, getRedis } from '../config/database';
import { VIDEO_QUEUE_NAME } from '../config/queueNames';
import { publishToFile } from '../utils/socketHelper';

const router = express.Router();
let videoQueue: Queue | null = null;

function getVideoQueue(): Queue {
  if (!videoQueue) {
    videoQueue = new Queue(VIDEO_QUEUE_NAME, { connection: getRedis() });
  }
  return videoQueue;
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function buildMongoStatus(file: any) {
  return {
    fileId: file.fileId,
    fileName: file.fileName,
    fileSize: file.fileSize,
    status: file.status,
    durationSeconds: file.metadata?.durationSeconds ?? null,
    ffprobeAvailable: file.metadata?.ffprobeAvailable ?? null,
    streams: file.metadata?.streams ?? [],
    uploadedAt: normalizeDate(file.uploadedAt),
    processedAt: normalizeDate(file.processedAt),
    error: file.error,
    mediaUrl: `/api/video/${encodeURIComponent(file.fileId)}/media`,
    analysis: normalizeVideoAnalysis(file.fileId, file.analysis),
  };
}

function buildRedisStatus(fileId: string, metadata: any) {
  return {
    fileId,
    fileName: metadata.fileName,
    fileSize: metadata.fileSize,
    status: metadata.status,
    durationSeconds: metadata.durationSeconds ?? metadata.metadata?.durationSeconds ?? null,
    ffprobeAvailable: metadata.ffprobeAvailable ?? metadata.metadata?.ffprobeAvailable ?? null,
    streams: metadata.metadata?.streams ?? [],
    uploadedAt: metadata.uploadedAt ?? null,
    processedAt: metadata.processedAt ?? null,
    error: metadata.error,
    mediaUrl: `/api/video/${encodeURIComponent(fileId)}/media`,
    analysis: normalizeVideoAnalysis(fileId, metadata.analysis),
  };
}

function normalizeVideoAnalysis(fileId: string, analysis: any) {
  if (!analysis || typeof analysis !== 'object') return undefined;

  const keyframes = Array.isArray(analysis.keyframes)
    ? analysis.keyframes.map((frame: any) => {
        const fileName = typeof frame.fileName === 'string' ? path.basename(frame.fileName) : '';
        return {
          ...frame,
          fileName,
          url: fileName ? `/api/video/${encodeURIComponent(fileId)}/keyframes/${encodeURIComponent(fileName)}` : undefined,
        };
      }).filter((frame: any) => frame.fileName)
    : [];

  return {
    ...analysis,
    keyframes,
    keyframeCount: typeof analysis.keyframeCount === 'number' ? analysis.keyframeCount : keyframes.length,
  };
}

router.get('/:fileId/status', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const db = getMongoDb();
    const file = await db.collection('video_files').findOne({ fileId });

    if (file) {
      return res.json(buildMongoStatus(file));
    }

    const redis = getRedis();
    const metadata = await redis.get(`file:${fileId}:metadata`);
    if (metadata) {
      return res.json(buildRedisStatus(fileId, JSON.parse(metadata)));
    }

    return res.status(404).json({ error: 'Video file not found' });
  } catch (error) {
    console.error('Failed to fetch video status:', error);
    res.status(500).json({ error: 'Failed to fetch video status' });
  }
});

router.get('/:fileId/timeline', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const db = getMongoDb();
    const events = await db.collection('video_timeline')
      .find({ fileId })
      .sort({ createdAt: 1 })
      .toArray();

    res.json({
      fileId,
      events: events.map(event => ({
        fileId: event.fileId,
        stage: event.stage,
        title: event.title,
        detail: event.detail,
        timestampSeconds: event.timestampSeconds ?? null,
        createdAt: normalizeDate(event.createdAt) ?? new Date().toISOString(),
      })),
    });
  } catch (error) {
    console.error('Failed to fetch video timeline:', error);
    res.status(500).json({ error: 'Failed to fetch video timeline' });
  }
});

router.get('/:fileId/media', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const db = getMongoDb();
    const file = await db.collection('video_files').findOne({ fileId });
    if (!file?.filePath) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    const mediaPath = path.resolve(file.filePath);
    const stat = await fs.stat(mediaPath);
    const contentType = typeof file.fileType === 'string' && file.fileType.includes('/')
      ? file.fileType
      : 'video/mp4';
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);

    if (!range) {
      res.setHeader('Content-Length', stat.size);
      return createReadStream(mediaPath).pipe(res);
    }

    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.status(416).end();
    }

    const start = match[1] ? Number.parseInt(match[1], 10) : 0;
    const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.status(416).end();
    }

    const safeEnd = Math.min(end, stat.size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${safeEnd}/${stat.size}`);
    res.setHeader('Content-Length', safeEnd - start + 1);
    return createReadStream(mediaPath, { start, end: safeEnd }).pipe(res);
  } catch (error) {
    return res.status(404).json({ error: 'Video media not found' });
  }
});

router.get('/:fileId/keyframes/:frameName', async (req: Request, res: Response) => {
  try {
    const { fileId, frameName } = req.params;
    const safeFrameName = path.basename(frameName);
    if (!/^frame_\d+\.jpe?g$/i.test(safeFrameName)) {
      return res.status(400).json({ error: 'Invalid keyframe name' });
    }

    const db = getMongoDb();
    const file = await db.collection('video_files').findOne({ fileId });
    if (!file?.filePath) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    const keyframeDir = path.resolve(path.dirname(file.filePath), `${fileId}_keyframes`);
    const keyframePath = path.resolve(keyframeDir, safeFrameName);
    if (!keyframePath.startsWith(keyframeDir + path.sep)) {
      return res.status(400).json({ error: 'Invalid keyframe path' });
    }

    await fs.access(keyframePath);
    res.type('jpg');
    res.sendFile(keyframePath);
  } catch (error) {
    res.status(404).json({ error: 'Keyframe not found' });
  }
});

router.post('/:fileId/analyze', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const db = getMongoDb();
    const videoFiles = db.collection('video_files');
    const timeline = db.collection('video_timeline');
    const file = await videoFiles.findOne({ fileId });

    if (!file) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    const now = new Date();
    const job = await getVideoQueue().add('analyze_video_evidence', {
      fileId,
      fileName: file.fileName,
      filePath: file.filePath,
      fileSize: file.fileSize,
      fileType: file.fileType || 'video',
      hash: file.hash,
      uploadedAt: normalizeDate(file.uploadedAt) || now.toISOString(),
    }, {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100,
    });

    await videoFiles.updateOne(
      { fileId },
      {
        $set: {
          status: 'analysis_queued',
          analysisRequestedAt: now,
          analysisMode: typeof req.body?.mode === 'string' ? req.body.mode : 'evidence',
          analysisJobId: String(job.id),
        },
      }
    );

    const event = {
      fileId,
      stage: 'analysis_queued',
      title: 'Video evidence analysis queued',
      detail: 'The backend worker will inspect media-tool availability, extract video metadata, and prepare key-screen evidence where available.',
      timestampSeconds: null,
      createdAt: now,
    };
    await timeline.insertOne(event);

    const redis = getRedis();
    const metadata = await redis.get(`file:${fileId}:metadata`);
    if (metadata) {
      const parsed = JSON.parse(metadata);
      parsed.status = 'analysis_queued';
      parsed.analysisRequestedAt = now.toISOString();
      parsed.analysisJobId = String(job.id);
      await redis.setex(`file:${fileId}:metadata`, 86400, JSON.stringify(parsed));
    }

    await publishToFile(fileId, 'file:status', {
      status: 'analysis_queued',
      analysisRequestedAt: now.toISOString(),
      analysisJobId: String(job.id),
    });
    await publishToFile(fileId, 'video:timeline', event);

    res.status(202).json({
      accepted: true,
      fileId,
      status: 'analysis_queued',
      jobId: String(job.id),
    });
  } catch (error) {
    console.error('Failed to request video analysis:', error);
    res.status(500).json({ error: 'Failed to request video analysis' });
  }
});

export default router;
