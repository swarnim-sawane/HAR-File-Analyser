import express, { Request, Response } from 'express';
import { getRedis } from '../config/database';
import { queryWithContext } from '../services/embeddingService';
import { streamLLMResponse } from '../services/ollamaPool';
import crypto from 'crypto';

const router = express.Router();

// Query HAR/Log with AI
router.post('/query', async (req: Request, res: Response) => {
  try {
    const { fileId, query, fileType } = req.body;
    
    if (!fileId || !query) {
      return res.status(400).json({ error: 'Missing fileId or query' });
    }
    
    const redis = getRedis();
    
    // Generate cache key
    const cacheKey = `query:${fileId}:${crypto.createHash('md5').update(query).digest('hex')}`;
    
    // Check cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({
        response: cached,
        cached: true
      });
    }
    
    // Get relevant context from vector DB
    const context = await queryWithContext(fileId, query, fileType || 'har');
    
    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    let fullResponse = '';
    
    // Stream LLM response
    for await (const token of streamLLMResponse(query, context)) {
      fullResponse += token;
      res.write(`data: ${JSON.stringify({ token })}\n\n`);
    }
    
    // Cache the full response
    await redis.setex(cacheKey, 3600, fullResponse); // 1 hour TTL
    
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    
  } catch (error) {
    console.error('AI query error:', error);
    res.status(500).json({ error: 'Failed to process query' });
  }
});

export default router;
