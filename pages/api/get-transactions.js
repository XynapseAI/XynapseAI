import { query } from '../../utils/postgres.js';
import { isAddress } from 'ethers';
import pkg from '../../utils/logger.cjs';
import crypto from 'crypto';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { body, validationResult } from 'express-validator';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha.js';

const { logger } = pkg;
const HMAC_SECRET = process.env.HMAC_SECRET || crypto.randomBytes(32).toString('hex');

// Định nghĩa SUPPORTED_CHAINS trước validateInput
const SUPPORTED_CHAINS = {
  '1': { name: 'ethereum', explorer: 'Etherscan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'ethereum' },
  '56': { name: 'bsc', explorer: 'BscScan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'binance-smart-chain' },
  '204': { name: 'opbnb', explorer: 'opBNB BscScan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'opbnb' },
  '250': { name: 'fantom', explorer: 'FTMScan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'fantom' },
  '10': { name: 'optimism', explorer: 'Optimistic Etherscan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'optimistic-ethereum' },
  '137': { name: 'polygon', explorer: 'PolygonScan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'polygon-pos' },
  '42161': { name: 'arbitrum', explorer: 'Arbiscan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'arbitrum-one' },
  '100': { name: 'gnosis', explorer: 'GnosisScan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'xdai' },
  '8453': { name: 'base', explorer: 'BaseScan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'base' },
  '59144': { name: 'linea', explorer: 'LineaScan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'linea' },
  '534352': { name: 'scroll', explorer: 'ScrollScan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'scroll' },
  '81457': { name: 'blast', explorer: 'BlastScan', apiUrl: 'https://api.etherscan.io/v2/api', apiKey: process.env.ETHERSCAN_API_KEY, coingeckoId: 'blast' },
  'solana': { name: 'solana', explorer: 'Solscan', apiUrl: 'https://public-api.solscan.io', apiKey: process.env.SOLSCAN_API_KEY, coingeckoId: 'solana' },
  'tron': { name: 'tron', explorer: 'TronScan', apiUrl: 'https://api.tronscan.org/api', apiKey: process.env.TRONSCAN_API_KEY, coingeckoId: 'tron' },
};

// Khai báo validateInput sau SUPPORTED_CHAINS
const validateInput = [
  body('wallet_address').isString().notEmpty().withMessage('Wallet address is required'),
  body('chain').isString().isIn(Object.keys(SUPPORTED_CHAINS)).withMessage('Invalid chain'),
  body('limit').isInt({ min: 100, max: 500 }).withMessage('Limit must be between 100 and 500'),
];

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 100, // Giới hạn 100 request mỗi IP
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown',
  trustProxy: true,
});

const chainLogoCache = {};

async function checkIp(ip) {
  try {
    const response = await axios.get(`https://ipinfo.io/${ip}/json?token=${process.env.IPINFO_TOKEN}`);
    const { abuse } = response.data;
    if (abuse && abuse.score > 50) {
      logger.warn(`Suspicious IP detected: ${ip}`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(`IP check failed: ${error.message}`);
    return true; // Không chặn nếu kiểm tra thất bại
  }
}

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
      delayMs *= 2;
    }
  }
}

async function verifyHmacSignature(payload, signature, secret) {
  try {
    const hmac = crypto.createHmac('sha256', secret);
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

async function verifyApiKey(apiKey, req, res) {
  try {
    if (apiKey === 'default-api-key') {
      return { isValid: true, isPremium: false };
    }
    const session = await getServerSession(req, res, authOptions);
    const result = await withRetry(() =>
      query(
        `SELECT is_premium, premium_expires_at, id FROM users WHERE api_key = $1`,
        [apiKey]
      )
    );
    if (result.rows.length === 0) {
      logger.warn(`Invalid API key: ${apiKey}`);
      return { isValid: false, isPremium: false };
    }
    const { is_premium, premium_expires_at, id } = result.rows[0];
    if (session && session.user.id !== id) {
      logger.warn(`API key ${apiKey} does not belong to user ${session.user.id}`);
      return { isValid: false, isPremium: false };
    }
    if (premium_expires_at && new Date(premium_expires_at) < new Date()) {
      logger.warn(`Premium expired for API key: ${apiKey}`);
      return { isValid: true, isPremium: false };
    }
    return { isValid: true, isPremium: is_premium || false };
  } catch (error) {
    logger.error(`Error verifying API key: ${error.message}`, { stack: error.stack });
    return { isValid: false, isPremium: false };
  }
}

async function getChainLogo(coingeckoId) {
  if (chainLogoCache[coingeckoId]) {
    logger.info(`Using cached logo for ${coingeckoId}`);
    return chainLogoCache[coingeckoId];
  }
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/asset_platforms', {
      headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY },
      timeout: 15000,
    });
    const chain = response.data.find(c => c.id === coingeckoId);
    const logo = chain?.image?.thumb || '/icons/default.png';
    chainLogoCache[coingeckoId] = logo;
    logger.info(`Fetched logo for ${coingeckoId}: ${logo}`);
    return logo;
  } catch (error) {
    logger.error(`Error fetching logo for ${coingeckoId}: ${error.message}`);
    return '/icons/default.png';
  }
}

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

async function fetchBlockchainData(walletAddress, dataType, isTestnet, limit, chainId) {
  const chain = SUPPORTED_CHAINS[chainId];
  if (!chain) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }
  const apiKey = chain.apiKey;
  if (!apiKey) {
    throw new Error(`API key missing for ${chain.explorer}`);
  }
  try {
    let transactions = [];
    if (chainId === 'solana') {
      const response = await fetch(`${chain.apiUrl}/account/transactions?account=${walletAddress}&limit=${limit}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Error fetching Solana transactions');
      }
      transactions = data.map(tx => ({
        hash: tx.txHash,
        from: tx.signer,
        to: tx.actions[0]?.destination || '',
        value: tx.actions[0]?.amount ? (tx.actions[0].amount / 1e9).toString() : '0',
        block_time: new Date(tx.blockTime * 1000).toISOString(),
      }));
    } else if (chainId === 'tron') {
      const response = await fetch(`${chain.apiUrl}/transaction?address=${walletAddress}&limit=${limit}`, {
        headers: { 'TRON-PRO-API-KEY': apiKey }
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Error fetching TRON transactions');
      }
      transactions = data.data.map(tx => ({
        hash: tx.hash,
        from: tx.ownerAddress,
        to: tx.toAddress,
        value: tx.amount ? (tx.amount / 1e6).toString() : '0',
        block_time: new Date(tx.timestamp).toISOString(),
      }));
    } else {
      const response = await fetch(
        `${chain.apiUrl}?chainid=${chainId}&module=account&action=txlist&address=${walletAddress}&sort=desc&apikey=${apiKey}&page=1&offset=${limit}`
      );
      const data = await response.json();
      if (data.status !== '1') {
        throw new Error(data.message || 'Error fetching EVM transactions');
      }
      transactions = data.result.map(tx => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value,
        block_time: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
      }));
    }
    return transactions;
  } catch (error) {
    logger.error(`Error fetching data from ${chain.explorer}: ${error.message}`);
    throw error;
  }
}

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';

  // Kiểm tra IP
  if (!(await checkIp(ip))) {
    logger.warn(`Access denied: Suspicious IP address ${ip}`);
    return res.status(403).json({ error: 'Access denied: Suspicious IP address.' });
  }

  // Kiểm tra rate limiting
  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { stack: err.stack, ip });
    return res.status(429).json({ error: 'Too many requests, please try again later.' });
  }

  // Kiểm tra phương thức HTTP
  if (req.method !== 'POST') {
    logger.error(`Method not allowed: ${req.method}`, { ip });
    return res.status(405).json({ error: 'Method not allowed. Only POST is supported.' });
  }

  // Kiểm tra đầu vào
  await Promise.all(validateInput.map(validation => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Input validation error: ${JSON.stringify(errors.array())}`, { ip });
    return res.status(400).json({ error: 'Invalid input data', errors: errors.array() });
  }

  // Kiểm tra reCAPTCHA
  const recaptchaToken = req.headers['x-recaptcha-token'];
  if (!recaptchaToken) {
    logger.error('Missing X-Recaptcha-Token header', { ip });
    return res.status(400).json({ error: 'Missing reCAPTCHA token in header' });
  }
  try {
    const { score } = await verifyRecaptcha(recaptchaToken, 'get_transactions', ip);
    if (score < 0.7) {
      logger.error(`reCAPTCHA score too low: ${score}`, { ip });
      return res.status(403).json({ error: 'reCAPTCHA verification failed: Suspicious activity detected' });
    }
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`, { stack: error.stack, ip });
    return res.status(403).json({ error: `reCAPTCHA verification failed: ${error.message}` });
  }

  const { wallet_address, chain, limit = 100 } = req.body;

  // Kiểm tra địa chỉ ví
  const isValidAddress = ['solana', 'tron'].includes(chain)
    ? /^[A-Za-z0-9]{32,44}$/.test(wallet_address)
    : isAddress(wallet_address);
  if (!isValidAddress) {
    logger.error(`Invalid wallet address: ${wallet_address} for chain ${chain}`, { ip });
    return res.status(400).json({ error: 'Wallet address is required and must be valid for the selected chain.' });
  }
  if (!SUPPORTED_CHAINS[chain]) {
    logger.error(`Invalid chain: ${chain}. Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(', ')}`, { ip });
    return res.status(400).json({ error: `Invalid chain: ${chain}. Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(', ')}` });
  }

  const lowerWalletAddress = wallet_address.toLowerCase();
  const apiKey = req.headers['x-api-key'] || process.env.INTERNAL_API_TOKEN || 'default-api-key';
  const signature = req.headers['x-hmac-signature'];

  try {
    // Kiểm tra API key
    const { isValid, isPremium } = await verifyApiKey(apiKey, req, res);
    if (!isValid) {
      logger.error(`Invalid API key: ${apiKey}`, { ip });
      return res.status(401).json({ error: 'Unauthorized: Invalid API key.' });
    }

    // Kiểm tra HMAC signature
    if (!signature || !(await verifyHmacSignature(req.body, signature, HMAC_SECRET))) {
      logger.warn(`Unauthorized: Invalid HMAC signature for wallet ${lowerWalletAddress}`, { ip });
      return res.status(401).json({ error: 'Unauthorized: Invalid HMAC signature.' });
    }

    // Kiểm tra quyền Premium
    if (!isPremium && chain !== '1') {
      logger.warn(`Non-Premium user attempted to access chain ${chain}`, { ip });
      return res.status(403).json({ error: 'Premium account required to access chains other than Ethereum.' });
    }

    // Kiểm tra limit
    const validLimits = [100, 200, 300, 500];
    const selectedLimit = validLimits.includes(Number(limit)) ? Number(limit) : 100;
    if (!isPremium && selectedLimit > 100) {
      logger.warn(`Non-Premium user attempted to use limit ${selectedLimit}`, { ip });
      return res.status(403).json({ error: 'Premium account required to fetch more than 100 transactions.' });
    }

    logger.info(`Fetching transactions for ${lowerWalletAddress} on ${chain} with limit ${selectedLimit}...`, { ip });
    const txData = await fetchBlockchainData(lowerWalletAddress, 'transactions', false, selectedLimit, chain);

    const uniqueTxData = Array.from(new Map(txData.map((tx) => [tx.hash, tx])).values());

    const incomingTxs = uniqueTxData
      .filter((tx) => tx.to.toLowerCase() === lowerWalletAddress)
      .slice(0, Math.ceil(selectedLimit / 2));
    const outgoingTxs = uniqueTxData
      .filter((tx) => tx.from.toLowerCase() === lowerWalletAddress)
      .slice(0, Math.ceil(selectedLimit / 2));

    const chainLogo = await getChainLogo(SUPPORTED_CHAINS[chain].coingeckoId);

    let incomingTxsWithNametags = [];
    let outgoingTxsWithNametags = [];
    let walletInfo = {
      address: lowerWalletAddress,
      nametag: ['solana', 'tron'].includes(chain) ? lowerWalletAddress.slice(0, 6) + '...' + lowerWalletAddress.slice(-4) : 'Unknown',
      image: '/icons/default.png',
      chainLogo,
      isPremium,
    };

    if (!['solana', 'tron'].includes(chain)) {
      logger.info(`Fetching nametags for ${lowerWalletAddress} and related addresses...`, { ip });
      const allAddresses = [
        lowerWalletAddress,
        ...incomingTxs.map((tx) => tx.from.toLowerCase()),
        ...outgoingTxs.map((tx) => tx.to.toLowerCase()),
      ];
      const nametags = await getNametagsBatch(allAddresses);

      incomingTxsWithNametags = incomingTxs.map((tx) => ({
        hash: tx.hash,
        from: tx.from.toLowerCase(),
        to: tx.to.toLowerCase(),
        value: (parseInt(String(tx.value), 16) / 1e18).toFixed(6),
        block_time: tx.block_time,
        type: 'incoming',
        chainLogo,
        from_nametag: nametags[tx.from.toLowerCase()]?.name || 'Unknown',
        from_image: nametags[tx.from.toLowerCase()]?.image || '/icons/default.png',
        to_nametag: nametags[tx.to.toLowerCase()]?.name || 'Unknown',
        to_image: nametags[tx.to.toLowerCase()]?.image || '/icons/default.png',
      }));

      outgoingTxsWithNametags = outgoingTxs.map((tx) => ({
        hash: tx.hash,
        from: tx.from.toLowerCase(),
        to: tx.to.toLowerCase(),
        value: (parseInt(String(tx.value), 16) / 1e18).toFixed(6),
        block_time: tx.block_time,
        type: 'outgoing',
        chainLogo,
        from_nametag: nametags[tx.from.toLowerCase()]?.name || 'Unknown',
        from_image: nametags[tx.from.toLowerCase()]?.image || '/icons/default.png',
        to_nametag: nametags[tx.to.toLowerCase()]?.name || 'Unknown',
        to_image: nametags[tx.to.toLowerCase()]?.image || '/icons/default.png',
      }));

      walletInfo = {
        address: lowerWalletAddress,
        nametag: nametags[lowerWalletAddress]?.name || 'Unknown',
        image: nametags[lowerWalletAddress]?.image || '/icons/default.png',
        chainLogo,
        isPremium,
      };
    } else {
      incomingTxsWithNametags = incomingTxs.map((tx) => ({
        hash: tx.hash,
        from: tx.from.toLowerCase(),
        to: tx.to.toLowerCase(),
        value: tx.value,
        block_time: tx.block_time,
        type: 'incoming',
        chainLogo,
        from_nametag: tx.from.slice(0, 6) + '...' + tx.from.slice(-4),
        from_image: '/icons/default.png',
        to_nametag: tx.to.slice(0, 6) + '...' + tx.to.slice(-4),
        to_image: '/icons/default.png',
      }));

      outgoingTxsWithNametags = outgoingTxs.map((tx) => ({
        hash: tx.hash,
        from: tx.from.toLowerCase(),
        to: tx.to.toLowerCase(),
        value: tx.value,
        block_time: tx.block_time,
        type: 'outgoing',
        chainLogo,
        from_nametag: tx.from.slice(0, 6) + '...' + tx.from.slice(-4),
        from_image: '/icons/default.png',
        to_nametag: tx.to.slice(0, 6) + '...' + tx.to.slice(-4),
        to_image: '/icons/default.png',
      }));
    }

    logger.info(`Fetched ${incomingTxsWithNametags.length} incoming and ${outgoingTxsWithNametags.length} outgoing transactions for ${lowerWalletAddress}`, { ip });
    return res.status(200).json({
      incoming: incomingTxsWithNametags,
      outgoing: outgoingTxsWithNametags,
      wallet: walletInfo,
    });
  } catch (err) {
    logger.error(`Error fetching transactions for ${lowerWalletAddress}: ${err.message}`, { stack: err.stack, ip });
    return res.status(500).json({ error: `Failed to fetch transactions: ${err.message}` });
  }
}