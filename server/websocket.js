// server/websocket.js
import WebSocket from 'ws';
import { createClient } from 'redis';
import { logger } from '../utils/serverLogger.js';

const MEMPOOL_WS_URL = 'wss://mempool.space/api/v1/ws';
const CACHE_TTL = 30 * 60; 
const PING_INTERVAL = 30000;
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 5000;
const MIN_USD_THRESHOLD = 1000000;
const BTC_PRICE_CACHE_TTL = 5 * 60 * 1000;
const BTC_PRICE_RETRY_ATTEMPTS = 3;
const BTC_PRICE_RETRY_DELAY = 2000;

let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl && process.env.NODE_ENV === 'production') {
      const errorMessage = 'FATAL: REDIS_URL is not defined in the production environment.';
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    const finalRedisUrl = redisUrl || 'redis://localhost:6379';
    const safeLogUrl = finalRedisUrl.includes('@') ? `redis://${finalRedisUrl.split('@')[1]}` : finalRedisUrl;
    logger.info(`Attempting to connect to Redis at: ${safeLogUrl}`);

    redisClient = createClient({ url: finalRedisUrl });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }));
    
    await redisClient.connect();
    logger.info('Redis connected for WebSocket server');

  } else if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info('Redis reconnected for WebSocket server');
  }
  return redisClient;
}

async function storeInRedis(key, data) {
  try {
    const client = await getRedisClient();
    const serializedData = JSON.stringify(data);
    await client.setEx(key, CACHE_TTL, serializedData);
    logger.info(`Stored data in Redis: ${key}`, { transactionCount: data.data.length });
  } catch (error) {
    logger.error('Failed to store in Redis:', { key, error: error.message, stack: error.stack });
  }
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
      const response = await axios.get('https://mempool.space/api/v1/prices', { timeout: 10000 });
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
  logger.error('All BTC price fetch attempts failed, using cached or fallback price');
  return btcPriceCache.price || 0;
}

function startWebSocketServer() {
  let ws;
  let reconnectAttempts = 0;
  let pingInterval = null;
  const mempoolTxCache = new Set();

  const connect = () => {
    ws = new WebSocket(MEMPOOL_WS_URL);

    ws.on('open', () => {
      logger.info('Connected to mempool WebSocket');
      reconnectAttempts = 0;
      ws.send(JSON.stringify({ "track-mempool-txids": true }));
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ ping: true }));
        }
      }, PING_INTERVAL);
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
          .slice(0, 10)
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
            const response = await axios.get(`https://mempool.space/api/tx/${txid}`, { timeout: 10000 });
            const tx = response.data;
            if (!tx.vout || !Array.isArray(tx.vout)) {
              logger.warn(`Invalid transaction data for txid ${txid}`);
              continue;
            }
            const totalValueSatoshi = tx.vout.reduce((sum, output) => sum + (output.value || 0), 0);
            const totalValueUSD = (totalValueSatoshi / 1e8) * btcPrice;

            if (totalValueUSD >= MIN_USD_THRESHOLD) {
              mempoolTxCache.add(txid);
              transactions.push({
                txid: tx.txid,
                value_usd: totalValueUSD,
                value_btc: totalValueSatoshi / 1e8,
                timestamp: tx.firstSeen || Math.floor(Date.now() / 1000),
                inputs: tx.vin?.map((vin) => ({
                  address: vin.prevout?.scriptpubkey_address || 'unknown',
                  nameTag: null,
                  image: null,
                })) || [],
                outputs: tx.vout?.map((vout) => ({
                  address: vout.scriptpubkey_address || 'unknown',
                  nameTag: null,
                  image: null,
                })) || [],
                fee: tx.fee || 0,
                size: tx.size || 0,
                status: tx.status || {},
              });
            } else {
                logger.debug(`Transaction ${txid} below USD threshold`, { totalValueUSD });
            }
          } catch (txError) {
            logger.error(`Failed to fetch tx ${txid}:`, { error: txError.message });
          }
        }

        if (transactions.length > 0) {
          const cacheKey = 'mempool-transactions';
          let allTxs = [];
          try {
            const client = await getRedisClient();
            const existing = await client.get(cacheKey);
            if(existing) {
                allTxs = JSON.parse(existing).data;
            }
          } catch (redisError) {
            logger.error('Failed to fetch existing transactions from Redis:', { error: redisError.message });
          }
          
          allTxs = [...transactions, ...allTxs].slice(0, 100).sort((a, b) => b.timestamp - a.timestamp);
          await storeInRedis(cacheKey, { success: true, data: allTxs });
          logger.info(`Processed and stored ${transactions.length} new transactions`);
        }
      } catch (error) {
        logger.error('WebSocket message processing error:', {
          error: error.message,
          stack: error.stack,
        });
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
    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;
    setTimeout(() => {
      logger.info(`Reconnecting to mempool WebSocket (attempt ${reconnectAttempts})`);
      connect();
    }, delay);
  };

  connect();

  return () => {
    if (ws) ws.close();
    if (pingInterval) clearInterval(pingInterval);
  };
}

export { startWebSocketServer };