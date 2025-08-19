// utils/indexedDB.js
'use client';

import { get, set, del, keys } from 'idb-keyval';
import { z } from 'zod';
import { logger } from './clientLogger';

const cacheSchema = z.object({
  key: z.string().min(1, 'Cache key must be a non-empty string'),
  data: z.any(),
  ttl: z.number().int().min(0, 'TTL must be a non-negative integer').default(60 * 60 * 1000),
});

export async function cacheData(key, data, ttl = 60 * 60 * 1000) {
  try {
    cacheSchema.parse({ key, data, ttl });

    const cacheEntry = { data, timestamp: Date.now(), ttl };
    await set(key, cacheEntry);
    logger.info(`Cached data in IndexedDB for key: ${key}`, { ttl });
  } catch (error) {
    logger.error(`Error caching data for key: ${key}`, {
      error: error.message,
    });
    throw error;
  }
}

export async function getCachedData(key) {
  try {
    cacheSchema.shape.key.parse(key);

    const cacheEntry = await get(key);
    if (!cacheEntry) {
      logger.info(`No cache found in IndexedDB for key: ${key}`);
      return null;
    }
    const { data, timestamp, ttl } = cacheEntry;
    if (Date.now() - timestamp > ttl) {
      await del(key);
      logger.info(`Cache expired in IndexedDB for key: ${key}`);
      return null;
    }
    logger.info(`Retrieved cache from IndexedDB for key: ${key}`);
    return data;
  } catch (error) {
    logger.error(`Error retrieving cache for key: ${key}`, {
      error: error.message,
    });
    return null;
  }
}

export async function clearCache(key) {
  try {
    cacheSchema.shape.key.parse(key);

    const cacheExists = await get(key);
    if (!cacheExists) {
      logger.info(`No cache found to clear in IndexedDB for key: ${key}`);
      return;
    }
    await del(key);
    logger.info(`Cleared cache in IndexedDB for key: ${key}`);
  } catch (error) {
    logger.error(`Error clearing cache for key: ${key}`, {
      error: error.message,
    });
    throw error;
  }
}

export async function clearAllCaches(userId) {
  try {
    const cacheKeys = await keys();
    const userCacheKeys = cacheKeys.filter((key) => typeof key === 'string' && key.includes(userId));
    if (userCacheKeys.length === 0) {
      logger.info(`No caches found in IndexedDB for userId: ${userId}`);
      return;
    }
    await Promise.all(userCacheKeys.map((key) => del(key)));
    logger.info(`Cleared all caches in IndexedDB for userId: ${userId}`, { keys: userCacheKeys });
  } catch (error) {
    logger.error(`Error clearing all caches for userId: ${userId}`, {
      error: error.message,
    });
    throw error;
  }
}