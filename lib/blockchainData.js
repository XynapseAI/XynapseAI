import axios from 'axios';
import { query } from '../utils/postgres.js';
import { isAddress } from 'ethers';
import pkg from '../utils/logger.cjs';

const { logger } = pkg;
const ETHERSCAN_API_BASE_URL = process.env.NEXTAUTH_URL + '/api/etherscan';

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

async function withRetry(operation, maxAttempts = 3, delayMs = 1000) {
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
        const cachedData = result.rows[0].data;
        logger.info(`Using cached data for ${lowerWalletAddress} (${action}, ${chain}): ${cachedData.length} records.`);
        return cachedData.slice(0, limit);
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

    const response = await axios.post(ETHERSCAN_API_BASE_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': process.env.INTERNAL_API_TOKEN
      },
      timeout: 30000
    });

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

    // Convert data to JSON string before saving
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
    return data;

  } catch (e) {
    logger.error(`Error fetching ${action} for ${lowerWalletAddress} on ${chain}: ${e.message}`);
    if (axios.isAxiosError(e) && e.response) {
      logger.error(`Response details: ${JSON.stringify(e.response.data)}`);
      if (e.response.status === 429) {
        logger.warn(`Rate limit hit for ${lowerWalletAddress} on ${chain}.`);
      }
    }
    return [];
  }
}