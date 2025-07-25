// lib/redis.js
import { createClient } from 'redis';

let redisClient = null;

async function connectRedis() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    redisClient.on('error', (err) => console.error('Redis Client Error:', err));
    redisClient.on('end', () => {
      console.log('Redis connection closed');
      redisClient = null; // Reset client khi kết nối bị đóng
    });

    try {
      await redisClient.connect();
      console.log('Redis connected successfully');
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      redisClient = null;
      throw error;
    }
  }

  if (!redisClient.isOpen) {
    await redisClient.connect();
  }

  return redisClient;
}

export default connectRedis;