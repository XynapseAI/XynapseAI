import { createClient } from 'redis';
import { logger } from '../utils/clientLogger';

let redisClient = null;
let isConnecting = false;

async function getRedisClient() {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  if (isConnecting) {
    // Wait for ongoing connection
    while (isConnecting) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (redisClient && redisClient.isOpen) {
      return redisClient;
    }
  }

  isConnecting = true;
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 100, 3000), // Reconnect with exponential backoff
      },
    });

    redisClient.on('error', (err) => {
      logger.error('Redis Client Error:', { error: err.message, stack: err.stack });
    });

    redisClient.on('end', () => {
      logger.info('Redis connection closed');
      redisClient = null;
    });

    redisClient.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });

    await redisClient.connect();
    logger.info('Redis connected successfully');
    return redisClient;
  } catch (error) {
    logger.error('Failed to connect to Redis:', { error: error.message, stack: error.stack });
    redisClient = null;
    throw error;
  } finally {
    isConnecting = false;
  }
}

export { getRedisClient, redisClient };