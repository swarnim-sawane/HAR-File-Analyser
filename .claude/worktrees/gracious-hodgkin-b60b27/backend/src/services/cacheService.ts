import { getRedis } from '../config/database';

const DEFAULT_TTL = 3600; // 1 hour

/**
 * Get cached value
 */
export async function getCached<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  
  try {
    const value = await redis.get(key);
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
  const redis = getRedis();
  
  try {
    await redis.setex(key, ttl, JSON.stringify(value));
  } catch (error) {
    console.error('Cache set error:', error);
  }
}

/**
 * Delete cached value
 */
export async function deleteCached(key: string): Promise<void> {
  const redis = getRedis();
  
  try {
    await redis.del(key);
  } catch (error) {
    console.error('Cache delete error:', error);
  }
}

/**
 * Delete all cached values for a file
 */
export async function deleteFileCached(fileId: string): Promise<void> {
  const redis = getRedis();
  
  try {
    const keys = await redis.keys(`*:${fileId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error('Cache delete file error:', error);
  }
}

/**
 * Check if key exists
 */
export async function exists(key: string): Promise<boolean> {
  const redis = getRedis();
  
  try {
    const result = await redis.exists(key);
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
  const redis = getRedis();
  
  try {
    const value = await redis.incr(key);
    if (ttl) {
      await redis.expire(key, ttl);
    }
    return value;
  } catch (error) {
    console.error('Cache increment error:', error);
    return 0;
  }
}
