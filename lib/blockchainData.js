// lib/blockchainData.js
import axios from 'axios';
import { query } from '../utils/postgres.js';
import { isAddress } from 'ethers';
import { logger } from '../utils/clientLogger.js';

const ETHERSCAN_API_BASE_URL = process.env.NEXTAUTH_URL + '/api/etherscan';
const CACHE_VALIDITY_MS = 24 * 60 * 60 * 1000; // Cache valid for 24 hours

const convertWeiToHex = (weiValue) => {
  if (weiValue === null || weiValue === undefined) return '0x0';
  try {
    const bigIntValue = BigInt(weiValue);
    return '0x' + bigIntValue.toString(16);
  } catch (e) {
    logger.warn(`Error converting wei to hex: ${weiValue}, defaulting to 0x0. Error: ${e.message}`);
    return '0x0';
  }
};

async function withRetry(operation, maxAttempts = 5, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (e) {
      if (attempt === maxAttempts) {
        throw e;
      }
      logger.warn(`Attempt ${attempt} failed: ${e.message}. Retrying after ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

export async function fetchBlockchainData(walletAddress, action = 'transactions', forceRefresh = false, limit = 500, chain = 'ethereum') {
  if (!isAddress(walletAddress)) {
    logger.error(`Invalid wallet address: ${walletAddress}`);
    return [];
  }
  const lowerWalletAddress = walletAddress.toLowerCase();
  const docId = `${lowerWalletAddress}_${action}_${chain}`;

  if (!forceRefresh) {
    try {
      const result = await withRetry(() =>
        query(
          `SELECT data, timestamp FROM blockchain_cache WHERE id = $1`,
          [docId]
        )
      );
      if (result.rows.length > 0) {
        const { data, timestamp } = result.rows[0];
        const cacheAge = Date.now() - new Date(timestamp).getTime();
        if (cacheAge < CACHE_VALIDITY_MS) {
          logger.info(`Using cached data for ${lowerWalletAddress} (${action}, ${chain}): ${data.length} records.`);
          return data.slice(0, limit);
        } else {
          logger.info(`Cache for ${lowerWalletAddress} (${action}, ${chain}) is stale (${cacheAge / 1000 / 60} minutes old). Fetching new data.`);
        }
      }
    } catch (e) {
      logger.error(`Error reading cache from PostgreSQL for ${docId}: ${e.message}`);
    }
  }

  try {
    logger.info(`Fetching ${action} for ${lowerWalletAddress} on chain ${chain} via API (limit: ${limit}).`);

    const payload = {
      action: action,
      address: lowerWalletAddress,
      chain: chain
    };

    const response = await withRetry(() =>
      axios.post(ETHERSCAN_API_BASE_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': process.env.INTERNAL_API_TOKEN
        },
        timeout: 30000
      })
    );

    if (response.status !== 200 || !response.data.success) {
      logger.error(`Etherscan API returned error: ${response.data.detail || 'Unknown error'}`);
      return [];
    }

    let data = response.data.data || [];

    if (action === 'transactions') {
      data = data.map(tx => ({
        chain: tx.chain,
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: convertWeiToHex(tx.value),
        block_time: tx.block_time,
        gasUsed: tx.gasUsed,
        gasPrice: tx.gasPrice,
        input: tx.input,
        isError: tx.isError,
      }));
      data.sort((a, b) => new Date(b.block_time).getTime() - new Date(a.block_time).getTime());
      data = data.slice(0, limit);
    }

    try {
      await withRetry(() =>
        query(
          `INSERT INTO blockchain_cache (id, data, timestamp)
           VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET
             data = EXCLUDED.data,
             timestamp = EXCLUDED.timestamp`,
          [docId, JSON.stringify(data), new Date()]
        )
      );
      logger.info(`Fetched and cached ${data.length} ${action} for ${lowerWalletAddress} (${chain}).`);
    } catch (e) {
      logger.error(`Error caching data for ${docId}: ${e.message}`);
    }

    return data;
  } catch (e) {
    logger.error(`Error fetching ${action} for ${lowerWalletAddress} on ${chain}: ${e.message}`);
    if (axios.isAxiosError(e) && e.response) {
      logger.error(`Response details: ${JSON.stringify(e.response.data)}`);
      if (e.response.status === 429) {
        logger.warn(`Rate limit hit for ${lowerWalletAddress} on ${chain}.`);
      }
    }
    // Fallback to stale cache if available
    try {
      const result = await query(
        `SELECT data FROM blockchain_cache WHERE id = $1`,
        [docId]
      );
      if (result.rows.length > 0) {
        logger.info(`Using stale cached data for ${lowerWalletAddress} (${action}, ${chain}) due to API failure.`);
        return result.rows[0].data.slice(0, limit);
      }
    } catch (cacheError) {
      logger.error(`Error fetching stale cache for ${docId}: ${cacheError.message}`);
    }
    return [];
  }
}