import { getRuntimeCache } from '../config/database';

const DEFAULT_TTL = 3600; // 1 hour

/**
 * Get cached value
 */
export async function getCached<T>(key: string): Promise<T | null> {
  const runtimeCache = getRuntimeCache();
  
  try {
    const value = await runtimeCache.get(key);
    if (!value) return null;
    
    return JSON.parse(value) as T;
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
}

/**
 * Set cached value
 */
export async function setCached(
  key: string,
  value: any,
  ttl: number = DEFAULT_TTL
): Promise<void> {
  const runtimeCache = getRuntimeCache();
  
  try {
    await runtimeCache.setex(key, ttl, JSON.stringify(value));
  } catch (error) {
    console.error('Cache set error:', error);
  }
}

/**
 * Delete cached value
 */
export async function deleteCached(key: string): Promise<void> {
  const runtimeCache = getRuntimeCache();
  
  try {
    await runtimeCache.del(key);
  } catch (error) {
    console.error('Cache delete error:', error);
  }
}

/**
 * Delete all cached values for a file
 */
export async function deleteFileCached(fileId: string): Promise<void> {
  const runtimeCache = getRuntimeCache();
  
  try {
    const keys = await runtimeCache.keys(`*:${fileId}:*`);
    if (keys.length > 0) {
      await runtimeCache.del(...keys);
    }
  } catch (error) {
    console.error('Cache delete file error:', error);
  }
}

/**
 * Check if key exists
 */
export async function exists(key: string): Promise<boolean> {
  const runtimeCache = getRuntimeCache();
  
  try {
    const result = await runtimeCache.exists(key);
    return result === 1;
  } catch (error) {
    console.error('Cache exists error:', error);
    return false;
  }
}

/**
 * Increment counter
 */
export async function increment(key: string, ttl?: number): Promise<number> {
  const runtimeCache = getRuntimeCache();
  
  try {
    const value = await runtimeCache.incr(key);
    if (ttl) {
      await runtimeCache.expire(key, ttl);
    }
    return value;
  } catch (error) {
    console.error('Cache increment error:', error);
    return 0;
  }
}
