import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { File, FormData, fetch } from 'undici';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const DEFAULT_SUPPORT_WORKBENCH_API_URL = 'http://localhost:4317';

function supportWorkbenchApiUrl(): string {
  return (process.env.SUPPORT_WORKBENCH_API_URL || DEFAULT_SUPPORT_WORKBENCH_API_URL).replace(/\/$/, '');
}

function cookieHeader(req: Request): Record<string, string> {
  return typeof req.headers.cookie === 'string'
    ? { cookie: req.headers.cookie }
    : {};
}

function forwardSetCookie(response: Awaited<ReturnType<typeof fetch>>, res: Response) {
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    res.setHeader('set-cookie', setCookie);
  }
}

async function relayWorkbenchResponse(response: Awaited<ReturnType<typeof fetch>>, res: Response) {
  forwardSetCookie(response, res);

  const contentType = response.headers.get('content-type');
  if (contentType) {
    res.type(contentType);
  }

  const body = await response.text();
  res.status(response.status).send(body);
}

router.post('/session', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await fetch(`${supportWorkbenchApiUrl()}/api/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...cookieHeader(req),
      },
      body: JSON.stringify({
        cwd: typeof req.body?.cwd === 'string' ? req.body.cwd : undefined,
        sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined,
      }),
    });

    await relayWorkbenchResponse(response, res);
  } catch (error) {
    next(error);
  }
});

const uploadAttachments = upload.array('files');

router.post('/session/:sessionId/attachments', (req: Request, res: Response, next: NextFunction) => {
  uploadAttachments(req, res, (uploadError: unknown) => {
    if (uploadError) {
      next(uploadError);
      return;
    }

    void handleAttachmentUpload(req, res).catch(next);
  });
});

async function handleAttachmentUpload(req: Request, res: Response) {
  const files = Array.isArray(req.files) ? req.files as Express.Multer.File[] : [];
  if (files.length === 0) {
    res.status(400).json({ error: 'At least one attachment is required' });
    return;
  }

  const formData = new FormData();
  for (const file of files) {
    formData.append(
      'files',
      new File([file.buffer], file.originalname, {
        type: file.mimetype || 'application/octet-stream',
      })
    );
  }

  const response = await fetch(
    `${supportWorkbenchApiUrl()}/api/session/${encodeURIComponent(req.params.sessionId)}/attachments`,
    {
      method: 'POST',
      headers: cookieHeader(req),
      body: formData,
    }
  );

  await relayWorkbenchResponse(response, res);
}

export default router;
