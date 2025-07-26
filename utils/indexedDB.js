// utils/indexedDB.js
import { get, set, del } from 'idb-keyval';

export const cacheData = async (key, data, ttl = 60 * 60 * 1000) => { // Tăng TTL lên 1 giờ
  try {
    const cacheEntry = {
      data,
      timestamp: Date.now(),
      ttl,
    };
    await set(key, cacheEntry);
    console.log(`Cached data for key: ${key}`, cacheEntry);
  } catch (error) {
    console.error(`Error caching data for key: ${key}`, error);
  }
};

export const getCachedData = async (key) => {
  try {
    const cacheEntry = await get(key);
    if (!cacheEntry) {
      console.log(`No cache found for key: ${key}`);
      return null;
    }
    const { data, timestamp, ttl } = cacheEntry;
    if (Date.now() - timestamp > ttl) {
      await del(key);
      console.log(`Cache expired for key: ${key}`);
      return null;
    }
    console.log(`Retrieved cache for key: ${key}`, data);
    return data;
  } catch (error) {
    console.error(`Error retrieving cache for key: ${key}`, error);
    return null;
  }
};

export const clearCache = async (key) => {
  try {
    await del(key);
    console.log(`Cleared cache for key: ${key}`);
  } catch (error) {
    console.error(`Error clearing cache for key: ${key}`, error);
  }
};