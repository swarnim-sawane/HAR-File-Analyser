/**
 * Force garbage collection if available
 */
export function forceGC(): void {
  if (global.gc) {
    console.log('Running garbage collection...');
    global.gc();
  } else {
    console.warn('Garbage collection not exposed. Run with --expose-gc flag.');
  }
}

/**
 * Get current memory usage
 */
export function getMemoryUsage(): {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  usagePercent: number;
} {
  const memUsage = process.memoryUsage();
  
  return {
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    rss: Math.round(memUsage.rss / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024),
    usagePercent: (memUsage.heapUsed / memUsage.heapTotal) * 100
  };
}

/**
 * Check if memory usage is acceptable
 */
export function isMemoryHealthy(threshold: number = 80): boolean {
  const usage = getMemoryUsage();
  return usage.usagePercent < threshold;
}

/**
 * Wait for memory to be available
 */
export async function waitForMemory(
  targetPercent: number = 70,
  maxWaitMs: number = 30000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    const usage = getMemoryUsage();
    
    if (usage.usagePercent < targetPercent) {
      return true;
    }
    
    // Force GC and wait
    forceGC();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return false;
}

/**
 * Log memory stats
 */
export function logMemoryStats(): void {
  const usage = getMemoryUsage();
  console.log('Memory Stats:');
  console.log(`  Heap Used: ${usage.heapUsed}MB`);
  console.log(`  Heap Total: ${usage.heapTotal}MB`);
  console.log(`  RSS: ${usage.rss}MB`);
  console.log(`  Usage: ${usage.usagePercent.toFixed(2)}%`);
}
