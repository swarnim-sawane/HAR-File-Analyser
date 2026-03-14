import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getRedis } from '../config/database';

declare global {
  namespace Express {
    interface Request {
      sessionId?: string;
    }
  }
}

export async function sessionManager(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Get or create session ID
    let sessionId = req.headers['x-session-id'] as string;
    
    if (!sessionId) {
      sessionId = uuidv4();
      res.setHeader('X-Session-Id', sessionId);
    }
    
    req.sessionId = sessionId;
    
    // Track active session in Redis
    const redis = getRedis();
    await redis.setex(`session:${sessionId}:active`, 3600, Date.now().toString());
    
    next();
  } catch (error) {
    console.error('Session manager error:', error);
    next();
  }
}
