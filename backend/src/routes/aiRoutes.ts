import { Router, Request, Response } from 'express';

const router = Router();

// POST /api/ai/chat  — proxies to OCA, streams response back
router.post('/chat', async (req: Request, res: Response) => {
  const { messages, systemPrompt } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  try {
    const ocaResponse = await fetch(
      `${process.env.OCA_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OCA_TOKEN}`,
        },
        body: JSON.stringify({
          model: process.env.OCA_MODEL || 'oca/gpt-5.4',
          messages: allMessages,
          stream: true, // OCA only supports streaming
        }),
      }
    );

    if (!ocaResponse.ok) {
      const err = await ocaResponse.text();
      return res.status(ocaResponse.status).json({ error: err });
    }

    // Pipe OCA's SSE stream directly to client
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = ocaResponse.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) return res.status(500).json({ error: 'No response body' });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.end();
  } catch (err) {
    console.error('OCA proxy error:', err);
    res.status(500).json({ error: 'Failed to reach OCA API' });
  }
});

// GET /api/ai/status — health check for frontend
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const response = await fetch(
      `${process.env.OCA_BASE_URL}/models`,
      {
        headers: { Authorization: `Bearer ${process.env.OCA_TOKEN}` },
      }
    );
    res.json({ connected: response.ok, model: process.env.OCA_MODEL });
  } catch {
    res.json({ connected: false, model: null });
  }
});

export default router;
