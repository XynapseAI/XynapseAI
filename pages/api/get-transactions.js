// pages/api/get-transactions.js
import { query } from '../../utils/postgres.js';
import { fetchBlockchainData } from '../../lib/blockchainData.js';
import pkg from '../../utils/logger.cjs';
import { isAddress } from 'ethers';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';

const { logger } = pkg;
const ALLOWED_USER_AGENT = 'CronWorker/1.0';
const HMAC_SECRET = process.env.HMAC_SECRET || crypto.randomBytes(32).toString('hex');
const RATE_LIMIT_REQUESTS = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_REQUESTS,
  keyGenerator: (req) => req.headers['x-api-key'] || req.ip,
  message: 'Too many requests, please try again later.'
});

async function verifyHmacSignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  const expectedSignature = hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

async function verifyApiKey(apiKey) {
  try {
    const result = await query(
      `SELECT active, expires_at FROM api_keys WHERE api_key = $1`,
      [apiKey]
    );
    if (result.rows.length === 0) {
      logger.warn(`Invalid API key: ${apiKey}`);
      return false;
    }
    const { active, expires_at } = result.rows[0];
    if (!active || new Date(expires_at) < new Date()) {
      logger.warn(`API key ${apiKey} is inactive or expired`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(`Error verifying API key: ${error.message}`, { stack: error.stack });
    return false;
  }
}

async function checkAdminStatus(uid) {
  if (!uid) return false;
  try {
    const result = await query(
      `SELECT is_admin FROM admins WHERE uid = $1`,
      [uid]
    );
    return result.rows.length > 0 && result.rows[0].is_admin === true;
  } catch (error) {
    logger.error(`Error checking admin status for user ${uid}: ${error.message}`);
    return false;
  }
}

async function getNametag(address) {
  try {
    // Ưu tiên lấy nametag từ bảng wallet_analysis
    const walletAnalysisResult = await query(
      `SELECT nametag FROM wallet_analysis WHERE wallet = $1`,
      [address.toLowerCase()]
    );
    if (walletAnalysisResult.rows.length > 0 && walletAnalysisResult.rows[0].nametag) {
      return walletAnalysisResult.rows[0].nametag;
    }

    // Nếu không tìm thấy trong wallet_analysis, lấy từ bảng nametags
    const nametagsResult = await query(
      `SELECT name AS nametag FROM nametags WHERE address = $1`,
      [address.toLowerCase()]
    );
    if (nametagsResult.rows.length > 0 && nametagsResult.rows[0].nametag) {
      return nametagsResult.rows[0].nametag;
    }

    return 'Unknown';
  } catch (error) {
    logger.error(`Error fetching nametag for address ${address}: ${error.message}`, { stack: error.stack });
    return 'Unknown';
  }
}

export default async function handler(req, res) {
  limiter(req, res, async () => {
    const userAgent = req.headers['user-agent'];
    if (userAgent !== ALLOWED_USER_AGENT) {
      logger.warn(`Invalid User-Agent: ${userAgent}`);
      return res.status(403).json({ detail: 'Unauthorized: Invalid User-Agent.' });
    }

    const apiKey = req.headers['x-api-key'];
    const internalApiToken = process.env.INTERNAL_API_TOKEN;

    // Xác thực API key
    if (!apiKey || (apiKey !== internalApiToken && !(await verifyApiKey(apiKey)))) {
      logger.warn(`Unauthorized: Invalid or missing API key: ${apiKey}`);
      return res.status(401).json({ detail: 'Unauthorized: Invalid or missing API key.' });
    }

    const signature = req.headers['x-hmac-signature'];
    if (!signature || !(await verifyHmacSignature(req.body, signature, HMAC_SECRET))) {
      logger.warn('Unauthorized: Invalid HMAC signature.');
      return res.status(401).json({ detail: 'Unauthorized: Invalid HMAC signature.' });
    }

    const session = await getServerSession(req, res, authOptions);
    let isAuthorized = false;

    if (session) {
      const isAdminUser = await checkAdminStatus(session.user.id);
      if (isAdminUser) {
        isAuthorized = true;
      } else {
        logger.warn(`Forbidden access attempt to get-transactions API by non-admin user: ${session.user.id}`);
        return res.status(403).json({ detail: 'Forbidden: Admin access required.' });
      }
    } else if (apiKey) {
      isAuthorized = true;
    } else {
      logger.warn('Unauthorized access attempt to get-transactions API (no session or API key)');
      return res.status(401).json({ detail: 'Unauthorized: Please log in or provide a valid API key.' });
    }

    if (!isAuthorized) {
      return res.status(401).json({ detail: 'Unauthorized: Access denied.' });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed. Only POST is supported.' });
    }

    const { wallet_address, chain = 'ethereum' } = req.body;

    if (!wallet_address || !isAddress(wallet_address)) {
      logger.error(`Invalid wallet address: ${wallet_address}`);
      return res.status(400).json({ error: 'Invalid wallet address.' });
    }

    try {
      logger.info(`Fetching transactions for ${wallet_address} on ${chain} via API.`);
      const txData = await fetchBlockchainData(wallet_address, 'transactions', false, 100, chain);

      const incomingTxs = txData
        .filter(tx => tx.to.toLowerCase() === wallet_address.toLowerCase())
        .slice(0, 50)
        .map(async (tx) => ({
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: (parseInt(String(tx.value), 16) / 1e18).toFixed(6),
          block_time: tx.block_time,
          type: 'incoming',
          from_nametag: await getNametag(tx.from),
          to_nametag: await getNametag(tx.to)
        }));

      const outgoingTxs = txData
        .filter(tx => tx.from.toLowerCase() === wallet_address.toLowerCase())
        .slice(0, 50)
        .map(async (tx) => ({
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: (parseInt(String(tx.value), 16) / 1e18).toFixed(6),
          block_time: tx.block_time,
          type: 'outgoing',
          from_nametag: await getNametag(tx.from),
          to_nametag: await getNametag(tx.to)
        }));

      // Resolve async mappings
      const resolvedIncomingTxs = await Promise.all(incomingTxs);
      const resolvedOutgoingTxs = await Promise.all(outgoingTxs);

      return res.status(200).json({
        incoming: resolvedIncomingTxs,
        outgoing: resolvedOutgoingTxs
      });
    } catch (error) {
      logger.error(`Error fetching transactions for ${wallet_address}: ${error.message}`, { stack: error.stack });
      return res.status(500).json({ error: `Failed to fetch transactions: ${error.message}` });
    }
  });
}