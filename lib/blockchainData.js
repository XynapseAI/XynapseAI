// lib/blockchainData.js
import axios from 'axios';
import { query } from '../utils/postgres.js';
import { isAddress } from 'ethers';
import { logger } from '../utils/clientLogger.js';

const ETHERSCAN_API_BASE_URL = process.env.NEXTAUTH_URL + '/api/etherscan';
// ==================== CACHE CHỈ GIỮ 6 GIỜ (TIẾT KIỆM TÀI NGUYÊN RAILWAY) ====================
const CACHE_VALIDITY_MS = 6 * 60 * 60 * 1000; // 6 hours
// =========================================================================================

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

export async function fetchBlockchainData(walletAddress, action = 'transactions', forceRefresh = false, limit = 200, chain = 'ethereum') {
  if (!isAddress(walletAddress)) {
    logger.error(`Invalid wallet address: ${walletAddress}`);
    return [];
  }

  const lowerWalletAddress = walletAddress.toLowerCase();
  const docId = `${lowerWalletAddress}_${action}_${chain}`;
  const fullUrl = `${ETHERSCAN_API_BASE_URL}`;

  logger.info(`🔗 Calling Etherscan proxy: ${fullUrl} | action=${action} | address=${lowerWalletAddress} | chain=${chain}`);

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
          return data.slice(0, limit);
        }
      }
    } catch (e) {
      logger.error(`Error reading cache from PostgreSQL for ${docId}: ${e.message}`);
    }
  }

  try {
    const payload = { action, address: lowerWalletAddress, chain };

    const response = await withRetry(() =>
      axios.post(fullUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': process.env.INTERNAL_API_TOKEN
        },
        timeout: 30000
      })
    );

    if (response.status !== 200 || !response.data?.success) {
      logger.warn(`Proxy returned success=false or non-200: ${response.status}`);
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
    } catch (e) {
      logger.error(`Error caching data for ${docId}: ${e.message}`);
    }

    return data;
  } catch (e) {
    if (e.response?.status === 404) {
      logger.error(`❌ 404 NOT FOUND - Etherscan proxy endpoint không tồn tại!`);
      logger.error(`   → URL đang gọi: ${fullUrl}`);
      logger.error(`   → Nguyên nhân: NEXTAUTH_URL trong service "cron-worker" trên Railway đang SAI.`);
      logger.error(`   → Fix ngay: Vào Railway → cron-worker → Variables → đặt NEXTAUTH_URL = https://domain-cua-web-app-cua-ban.up.railway.app`);
      logger.error(`   (không có dấu / ở cuối, phải là domain public của web service)`);
    } else if (e.response?.status === 401 || e.response?.status === 403) {
      logger.error(`❌ Authentication error (401/403). Kiểm tra INTERNAL_API_TOKEN trong cron-worker.`);
    } else {
      logger.error(`Etherscan proxy error: ${e.message}`, { status: e.response?.status });
    }

    // fallback stale cache (giữ nguyên)
    try {
      const result = await query(`SELECT data FROM blockchain_cache WHERE id = $1`, [docId]);
      if (result.rows.length > 0) {
        logger.info(`Using stale cache as fallback for ${lowerWalletAddress}`);
        return result.rows[0].data.slice(0, limit);
      }
    } catch { }
    return [];
  }
}