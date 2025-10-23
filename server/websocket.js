// server/websocket.js
import { WebSocket, WebSocketServer } from 'ws'; // Import both WebSocket and WebSocketServer
import { createClient } from 'redis';
import { logger } from '../utils/serverLogger.js';

const MEMPOOL_WS_URL = 'wss://mempool.space/api/v1/ws';
const CACHE_TTL = 6 * 24 * 60 * 60; // 6 days (5 days + 1 day margin)
const PING_INTERVAL = 60000; // 60 seconds
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 5000;
const MIN_USD_THRESHOLD = 1000000;
const BTC_PRICE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const BTC_PRICE_RETRY_ATTEMPTS = 3;
const BTC_PRICE_RETRY_DELAY = 3000;
const MAX_CACHE_SIZE = 1000; // Giữ ở mức trung bình để tránh cache quá lớn, nhưng đủ cho 5 ngày với pagination
const MAX_AGE_SECONDS = 5 * 24 * 60 * 60; // 5 days
const MAX_PROCESSED_TX_CACHE_SIZE = 200;
const MAX_NEW_TX_PER_BATCH = 20;

let redisClient;

async function getRedisClient() {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl && process.env.NODE_ENV === 'production') {
      const errorMessage = 'FATAL: REDIS_URL is not defined in production.';
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    const finalRedisUrl = redisUrl || 'redis://localhost:6379';
    const safeLogUrl = finalRedisUrl.includes('@') ? `redis://${finalRedisUrl.split('@')[1]}` : finalRedisUrl;
    logger.info(`Connecting to Redis at: ${safeLogUrl}`);

    redisClient = createClient({ 
      url: finalRedisUrl,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
        connectTimeout: 10000,
        keepAlive: 1000,
      },
      disablePipeline: true,
    });
    redisClient.on('error', (err) => {
      logger.error('Redis Client Error', { error: err.message });
      if (err.message.includes('Socket closed unexpectedly')) {
        redisClient = null;
      }
    });

    await redisClient.connect();
    logger.info('Redis connected');
  } else if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected');
  }
  return redisClient;
}

let btcPriceCache = {
  price: 0,
  lastFetched: 0,
};

async function fetchBtcPrice() {
  const now = Date.now();
  if (now - btcPriceCache.lastFetched < BTC_PRICE_CACHE_TTL && btcPriceCache.price > 0) {
    logger.debug('Using cached BTC price:', { price: btcPriceCache.price });
    return btcPriceCache.price;
  }

  const { default: axios } = await import('axios');
  for (let attempt = 1; attempt <= BTC_PRICE_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await axios.get('https://mempool.space/api/v1/prices', { timeout: 5000 });
      const btcPrice = response.data.USD || 0;
      if (!btcPrice) {
        logger.warn(`BTC price fetch attempt ${attempt} returned no price`);
        continue;
      }
      btcPriceCache = { price: btcPrice, lastFetched: now };
      logger.debug(`Fetched BTC price: $${btcPrice}`);
      return btcPrice;
    } catch (error) {
      logger.error(`BTC price fetch attempt ${attempt} failed:`, { error: error.message });
      if (attempt < BTC_PRICE_RETRY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, BTC_PRICE_RETRY_DELAY));
      }
    }
  }
  logger.error('All BTC price fetch attempts failed');
  return btcPriceCache.price || 0;
}

function startWebSocketServer(httpServer) {
  let ws;
  let reconnectAttempts = 0;
  let pingInterval = null;
  const mempoolTxCache = new Set();

  const wss = new WebSocketServer({ server: httpServer }); // Use WebSocketServer for server
  logger.info('WebSocket server initialized on HTTP server');

  const connect = () => {
    ws = new WebSocket(MEMPOOL_WS_URL, { // Use WebSocket for client
      headers: { 'User-Agent': 'xynapse-bot/1.0' },
      perMessageDeflate: false,
    });

    ws.on('open', () => {
      logger.info('Connected to mempool WebSocket');
      reconnectAttempts = 0;
      ws.send(JSON.stringify({ "track-mempool-txids": true }));
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
          logger.debug('Sent WebSocket ping');
        }
      }, PING_INTERVAL);
    });

    ws.on('pong', () => {
      logger.debug('Received WebSocket pong');
    });

    ws.on('message', async (data) => {
      try {
        const message = Buffer.isBuffer(data) ? data.toString('utf8') : data.toString();
        let parsed;
        try {
          parsed = JSON.parse(message);
        } catch (parseError) {
          logger.error('Failed to parse WebSocket message:', { message, error: parseError.message });
          return;
        }

        if (parsed.conversions || parsed.pong || parsed.loadingIndicators) {
          return;
        }

        if (!parsed['mempool-txids']?.added?.length) {
          return;
        }

        const newTxs = parsed['mempool-txids'].added
          .slice(0, MAX_NEW_TX_PER_BATCH)
          .filter((txid) => !mempoolTxCache.has(txid));

        if (newTxs.length === 0) return;

        const btcPrice = await fetchBtcPrice();
        if (!btcPrice) {
          logger.warn('BTC price not available, skipping transaction processing');
          return;
        }

        const transactions = [];
        const { default: axios } = await import('axios');
        for (const txid of newTxs) {
          try {
            const response = await axios.get(`https://mempool.space/api/tx/${txid}`, { timeout: 5000 });
            const tx = response.data;
            if (!tx.vout || !Array.isArray(tx.vout)) {
              logger.warn(`Invalid transaction data for txid ${txid}`);
              continue;
            }
            const totalValueSatoshi = tx.vout.reduce((sum, output) => sum + (output.value || 0), 0);
            const totalValueUSD = (totalValueSatoshi / 1e8) * btcPrice;

            if (totalValueUSD >= MIN_USD_THRESHOLD) {
              mempoolTxCache.add(txid);
              if (mempoolTxCache.size > MAX_PROCESSED_TX_CACHE_SIZE) {
                const iterator = mempoolTxCache.values();
                mempoolTxCache.delete(iterator.next().value);
              }
              // Tối ưu: Chỉ lưu address cho inputs/outputs, bỏ nameTag/image null để giảm size JSON
              transactions.push({
                txid: tx.txid,
                value_usd: totalValueUSD,
                value_btc: totalValueSatoshi / 1e8,
                timestamp: tx.firstSeen || Math.floor(Date.now() / 1000),
                inputs: tx.vin?.map((vin) => ({
                  address: vin.prevout?.scriptpubkey_address || 'unknown',
                })) || [],
                outputs: tx.vout?.map((vout) => ({
                  address: vout.scriptpubkey_address || 'unknown',
                })) || [],
                fee: tx.fee || 0,
                size: tx.size || 0,
                status: tx.status || {},
              });
            }
          } catch (txError) {
            logger.error(`Failed to fetch tx ${txid}:`, { error: txError.message });
          }
        }

        if (transactions.length > 0) {
          const cacheTimesKey = 'mempool-tx:times';
          const cacheDataPrefix = 'mempool-tx:data:';
          const client = await getRedisClient();
          const now = Math.floor(Date.now() / 1000);
          const pipeline = client.multi();
          for (const tx of transactions) {
            const txKey = `${cacheDataPrefix}${tx.txid}`;
            pipeline.setNX(txKey, JSON.stringify(tx));
            pipeline.expire(txKey, CACHE_TTL);
            pipeline.zAdd(cacheTimesKey, { score: tx.timestamp, value: tx.txid }, { NX: true });
          }
          await pipeline.exec();

          // Cleanup old transactions
          const minScore = now - MAX_AGE_SECONDS;
          const oldTxids = await client.zRangeByScore(cacheTimesKey, '-inf', minScore);
          if (oldTxids.length > 0) {
            const delPipeline = client.multi();
            for (const txid of oldTxids) {
              delPipeline.del(`${cacheDataPrefix}${txid}`);
            }
            delPipeline.zRem(cacheTimesKey, oldTxids);
            await delPipeline.exec();
          }

          // Enforce max cache size
          const total = await client.zCard(cacheTimesKey);
          if (total > MAX_CACHE_SIZE) {
            const toRemove = total - MAX_CACHE_SIZE;
            const oldestTxids = await client.zRange(cacheTimesKey, 0, toRemove - 1);
            if (oldestTxids.length > 0) {
              const delPipeline = client.multi();
              for (const txid of oldestTxids) {
                delPipeline.del(`${cacheDataPrefix}${txid}`);
              }
              delPipeline.zRem(cacheTimesKey, oldestTxids);
              await delPipeline.exec();
            }
          }

          logger.info(`Processed and stored ${transactions.length} new transactions`);
        }
      } catch (error) {
        logger.error('WebSocket message processing error:', { error: error.message });
      }
    });

    ws.on('error', (error) => {
      logger.error('Mempool WebSocket error:', { error: error.message });
      clearInterval(pingInterval);
      reconnect();
    });

    ws.on('close', () => {
      logger.info('Mempool WebSocket closed');
      clearInterval(pingInterval);
      reconnect();
    });
  };

  const reconnect = () => {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error('Max reconnection attempts reached for WebSocket');
      return;
    }
    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts), 60000);
    reconnectAttempts++;
    logger.info(`Scheduling WebSocket reconnect (attempt ${reconnectAttempts}) in ${delay}ms`);
    setTimeout(connect, delay);
  };

  connect();

  return () => {
    if (ws) ws.close();
    if (pingInterval) clearInterval(pingInterval);
    wss.close();
    logger.info('WebSocket server closed');
  };
}

export { startWebSocketServer };