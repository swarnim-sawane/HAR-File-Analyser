import { Request, Response, NextFunction } from 'express';
import os from 'os';

export function resourceMonitor(
  req: Request,
  res: Response,
  next: NextFunction
): void | Response {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
  const usagePercent = (heapUsedMB / heapTotalMB) * 100;
  
  // Reject requests if memory is critical (>90%)
  if (usagePercent > 90) {
    console.error(`CRITICAL: Memory usage at ${Math.round(usagePercent)}%`);
    return res.status(503).json({
      error: 'Service temporarily overloaded. Please try again in a moment.',
      retryAfter: 30
    });
  }
  
  // Add resource info to response headers
  res.setHeader('X-Memory-Usage', `${Math.round(heapUsedMB)}MB`);
  res.setHeader('X-CPU-Load', os.loadavg()[0].toFixed(2));
  
  // Log high memory usage
  if (usagePercent > 75) {
    console.warn(`High memory usage: ${Math.round(usagePercent)}%`);
  }
  
  next();
}
