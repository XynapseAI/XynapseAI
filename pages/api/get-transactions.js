import { query } from '../../utils/postgres.js';
import { fetchBlockchainData } from '../../lib/blockchainData.js';
import { isAddress } from 'ethers';
import pkg from '../../utils/logger.cjs';
import crypto from 'crypto';

const { logger } = pkg;
const VALID_CHAINS = ['ethereum', 'bsc', 'polygon'];
const HMAC_SECRET = process.env.HMAC_SECRET || crypto.randomBytes(32).toString('hex');

/**
 * Retries an operation with exponential backoff.
 * @param {Function} operation - The async operation to retry.
 * @param {number} maxAttempts - Maximum number of attempts.
 * @param {number} delayMs - Delay between attempts in milliseconds.
 * @returns {Promise<any>} The result of the operation.
 */
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
      delayMs *= 2; // Exponential backoff
    }
  }
}

/**
 * Verifies HMAC signature for the request payload.
 * @param {Object} payload - The request payload.
 * @param {string} signature - The HMAC signature from the client.
 * @param {string} secret - The HMAC secret key.
 * @returns {boolean} Whether the signature is valid.
 */
async function verifyHmacSignature(payload, signature, secret) {
  try {
    const hmac = crypto.createHmac('sha256', secret);
    // Ensure consistent JSON serialization
    const payloadString = JSON.stringify(payload, Object.keys(payload).sort());
    hmac.update(payloadString);
    const expectedSignature = hmac.digest('hex');
    logger.debug(`Payload: ${payloadString}, Signature: ${signature}, Expected: ${expectedSignature}`);
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'));
  } catch (error) {
    logger.error(`HMAC verification error: ${error.message}`, { stack: error.stack });
    return false;
  }
}

/**
 * Verifies the API key against the database.
 * @param {string} apiKey - The API key to verify.
 * @returns {Promise<boolean>} Whether the API key is valid and active.
 */
async function verifyApiKey(apiKey) {
  try {
    const result = await withRetry(() =>
      query(
        `SELECT active, expires_at FROM api_keys WHERE api_key = $1`,
        [apiKey]
      )
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

/**
 * Fetches nametags for a batch of addresses from the nametags table.
 * @param {string[]} addresses - Array of wallet addresses.
 * @returns {Promise<Object>} Nametags mapped by address.
 */
async function getNametagsBatch(addresses) {
  const uniqueAddresses = [...new Set(addresses.map(addr => addr.toLowerCase()).filter(isAddress))];
  const nametags = {};

  if (uniqueAddresses.length === 0) {
    logger.info('No valid addresses provided for nametag fetch.');
    return nametags;
  }

  try {
    const batchSize = 100;
    for (let i = 0; i < uniqueAddresses.length; i += batchSize) {
      const batchAddresses = uniqueAddresses.slice(i, i + batchSize);
      const result = await withRetry(() =>
        query(
          `SELECT address, nametag, image FROM nametags WHERE address = ANY($1)`,
          [batchAddresses]
        )
      );

      result.rows.forEach(row => {
        const nametag = row.nametag || 'Unknown';
        let image = row.image || '/icons/default.png';
        if (nametag !== 'Unknown' && !image) {
          const shortName = nametag.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
          image = `/icons/${shortName}.png`;
        }
        nametags[row.address.toLowerCase()] = {
          address: row.address.toLowerCase(),
          name: nametag,
          image,
          description: '',
          subcategory: 'Others'
        };
      });
    }

    // Assign default values for addresses not found
    uniqueAddresses.forEach(addr => {
      if (!nametags[addr]) {
        nametags[addr] = {
          address: addr,
          name: 'Unknown',
          image: '/icons/default.png',
          description: '',
          subcategory: 'Others'
        };
      }
    });

    logger.info(`Fetched ${Object.keys(nametags).length} nametags, Unknown: ${Object.values(nametags).filter(tag => tag.name === 'Unknown').length}`);
    return nametags;
  } catch (error) {
    logger.error(`Error fetching nametags: ${error.message}`, { stack: error.stack });
    return uniqueAddresses.reduce((acc, addr) => ({
      ...acc,
      [addr]: {
        address: addr,
        name: 'Unknown',
        image: '/icons/default.png',
        description: '',
        subcategory: 'Others'
      }
    }), {});
  }
}

/**
 * API handler for fetching transactions.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    logger.error(`Method not allowed: ${req.method}`);
    return res.status(405).json({ error: 'Method not allowed. Only POST is supported.' });
  }

  const { wallet_address, chain = 'ethereum' } = req.body;

  if (!isAddress(wallet_address)) {
    logger.error(`Invalid wallet address: ${wallet_address}`);
    return res.status(400).json({ error: 'Wallet address is required and must be a valid EVM address.' });
  }
  if (!VALID_CHAINS.includes(chain)) {
    logger.error(`Invalid chain: ${chain}. Supported chains: ${VALID_CHAINS.join(', ')}`);
    return res.status(400).json({ error: `Invalid chain: ${chain}. Supported chains: ${VALID_CHAINS.join(', ')}` });
  }

  const lowerWalletAddress = wallet_address.toLowerCase();
  const apiKey = req.headers['x-api-key'] || process.env.INTERNAL_API_TOKEN;
  const signature = req.headers['x-hmac-signature'];

  try {
    if (!apiKey) {
      logger.error('Missing API key in request headers or environment variables');
      return res.status(401).json({ error: 'Unauthorized: Missing API key.' });
    }
    if (!(await verifyApiKey(apiKey))) {
      logger.error(`Invalid API key: ${apiKey}`);
      return res.status(401).json({ error: 'Unauthorized: Invalid API key.' });
    }
    if (!signature || !(await verifyHmacSignature(req.body, signature, HMAC_SECRET))) {
      logger.warn(`Unauthorized: Invalid HMAC signature for wallet ${lowerWalletAddress}`);
      return res.status(401).json({ error: 'Unauthorized: Invalid HMAC signature.' });
    }

    logger.info(`Fetching transactions for ${lowerWalletAddress} on ${chain}...`);
    const txData = await fetchBlockchainData(lowerWalletAddress, 'transactions', false, 100, chain);

    const uniqueTxData = Array.from(new Map(txData.map((tx) => [tx.hash, tx])).values());

    const incomingTxs = uniqueTxData
      .filter((tx) => tx.to.toLowerCase() === lowerWalletAddress)
      .slice(0, 50);
    const outgoingTxs = uniqueTxData
      .filter((tx) => tx.from.toLowerCase() === lowerWalletAddress)
      .slice(0, 50);

    logger.info(`Fetching nametags for ${lowerWalletAddress} and related addresses...`);
    const allAddresses = [
      lowerWalletAddress,
      ...incomingTxs.map((tx) => tx.from.toLowerCase()),
      ...outgoingTxs.map((tx) => tx.to.toLowerCase()),
    ];
    const nametags = await getNametagsBatch(allAddresses);

    const incomingTxsWithNametags = incomingTxs.map((tx) => ({
      hash: tx.hash,
      from: tx.from.toLowerCase(),
      to: tx.to.toLowerCase(),
      value: (parseInt(String(tx.value), 16) / 1e18).toFixed(6),
      block_time: tx.block_time,
      type: 'incoming',
      from_nametag: nametags[tx.from.toLowerCase()]?.name || 'Unknown',
      from_image: nametags[tx.from.toLowerCase()]?.image || '/icons/default.png',
      to_nametag: nametags[tx.to.toLowerCase()]?.name || 'Unknown',
      to_image: nametags[tx.to.toLowerCase()]?.image || '/icons/default.png',
    }));

    const outgoingTxsWithNametags = outgoingTxs.map((tx) => ({
      hash: tx.hash,
      from: tx.from.toLowerCase(),
      to: tx.to.toLowerCase(),
      value: (parseInt(String(tx.value), 16) / 1e18).toFixed(6),
      block_time: tx.block_time,
      type: 'outgoing',
      from_nametag: nametags[tx.from.toLowerCase()]?.name || 'Unknown',
      from_image: nametags[tx.from.toLowerCase()]?.image || '/icons/default.png',
      to_nametag: nametags[tx.to.toLowerCase()]?.name || 'Unknown',
      to_image: nametags[tx.to.toLowerCase()]?.image || '/icons/default.png',
    }));

    const walletInfo = {
      address: lowerWalletAddress,
      nametag: nametags[lowerWalletAddress]?.name || 'Unknown',
      image: nametags[lowerWalletAddress]?.image || '/icons/default.png',
    };

    logger.info(`Fetched ${incomingTxsWithNametags.length} incoming and ${outgoingTxsWithNametags.length} outgoing transactions for ${lowerWalletAddress}`);
    return res.status(200).json({
      incoming: incomingTxsWithNametags,
      outgoing: outgoingTxsWithNametags,
      wallet: walletInfo,
    });
  } catch (err) {
    logger.error(`Error fetching transactions for ${lowerWalletAddress}: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ error: `Failed to fetch transactions: ${err.message}` });
  }
}