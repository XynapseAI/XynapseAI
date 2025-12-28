// @/utils/redis.js
import { createClient } from 'redis';
import { logger } from './serverLogger'; 

let redisClient;
export async function getRedisClient() {
  if (redisClient?.isOpen) return redisClient;
  const maxRetries = 3;
  const delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
      redisClient.on('error', (err) => logger.error('Redis Client Error', { err: err?.message }));
      await redisClient.connect();
      if (process.env.NODE_ENV !== 'production') {
        logger.info('Redis connected');
      }
      return redisClient;
    } catch (err) {
      if (i === maxRetries - 1) throw new Error('Failed to connect to Redis');
      if (process.env.NODE_ENV !== 'production') {
        logger.warn(`Redis connection failed, retrying...`, { attempt: i + 1, err: err?.message });
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}