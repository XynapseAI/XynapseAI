// app/api/analyze-wallets/route.js
import { fetchBlockchainData } from '../../../lib/blockchainData.js';
import { getNametag, addNametag } from '../../../lib/nametags.js';
import { query } from '../../../utils/postgres.js';
import axios from 'axios';
import { isAddress } from 'ethers';
import { detectLargeFlow } from '../../../lib/detectLargeFlow.js';
import { auth } from '@/lib/auth';
import { logger } from '../../../utils/serverLogger.js';
import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { NextResponse } from 'next/server';
import Bottleneck from 'bottleneck';

const ALLOWED_USER_AGENT = 'CronWorker/1.0';
const HMAC_SECRET = process.env.HMAC_SECRET || crypto.randomBytes(32).toString('hex');
const DEFAULT_GEMINI_TIMEOUT_MS = 120000;
const LARGE_VALUE_THRESHOLD_USD = 500000;
const DEPOSIT_WALLET_CONFIDENCE_THRESHOLD = 60;
const GEMINI_CONFIDENCE_THRESHOLD = 70;
const DEFAULT_ETH_PRICE_USD = 2000;
const WALLET_FILE_PATH = process.env.WALLET_FILE_PATH
  ? path.resolve(process.env.WALLET_FILE_PATH)
  : path.resolve(process.cwd(), 'cron-worker/wallets.json');
const VALID_CHAINS = ['ethereum', 'bsc', 'polygon'];

const limiter = new Bottleneck({ maxConcurrent: 5, minTime: 200 });

// Allowed origins
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://farcaster.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
].filter(Boolean);

// Kiểm tra Origin/Referer
function isAllowedOrigin(origin, referer) {
  try {
    if (origin && (allowedOrigins.includes(origin) || new URL(origin).hostname.endsWith('xynapseai.net'))) {
      logger.info(`Origin allowed: ${origin}`);
      return true;
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin) || new URL(refOrigin).hostname.endsWith('xynapseai.net')) {
        logger.info(`Referer origin allowed: ${refOrigin}`);
        return true;
      }
    }
    if (!origin && !referer) {
      logger.info('Allowing internal/SSR request');
      return true;
    }
    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn('Origin is null, allowing in development mode');
      return true;
    }
    logger.error(`CORS blocked: Origin=${origin || 'null'}, Referer=${referer || 'null'}`);
    return false;
  } catch (err) {
    logger.error(`Error in isAllowedOrigin: ${err.message}`, { origin, referer });
    return false;
  }
}

// CORS wrapper (loại bỏ rate-limiting)
const handlerWrapper = (handler) =>
  limiter.wrap(async (req) => {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const origin = req.headers.get('origin');
    const referer = req.headers.get('referer');
    logger.info(`Request to /api/analyze-wallets from IP ${ip}, Origin: ${origin || 'null'}, Referer: ${referer || 'null'}`);

    if (!isAllowedOrigin(origin, referer)) {
      return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
    }

    const body = await req.json(); // Đọc body một lần
    const res = await handler(req, body);
    const allowOrigin = origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
    res.headers.set('Access-Control-Allow-Origin', allowOrigin);
    res.headers.set('Access-Control-Allow-Methods', 'POST');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-HMAC-Signature');
    return res;
  });

// Các hàm helper giữ nguyên từ file gốc
async function withRetry(operation, maxAttempts = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (e) {
      if (attempt === maxAttempts) throw e;
      logger.warn(`Attempt ${attempt} failed: ${e.message}. Retrying after ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function verifyHmacSignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  const expectedSignature = hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

async function verifyApiKey(apiKey) {
  try {
    const result = await withRetry(() =>
      query(`SELECT active, expires_at FROM api_keys WHERE api_key = $1`, [apiKey])
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
    const result = await withRetry(() =>
      query(`SELECT is_admin FROM admins WHERE uid = $1`, [uid])
    );
    return result.rows.length > 0 && result.rows[0].is_admin === true;
  } catch (error) {
    logger.error(`Error checking admin status for user ${uid}: ${error.message}`);
    return false;
  }
}

async function saveWalletAnalysis(analysis) {
  try {
    await withRetry(() =>
      query(
        `INSERT INTO wallet_analysis (wallet, is_deposit, deposit_confidence_percentage, nametag, image, reason, metrics, gemini_analysis, last_analysis)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (wallet) DO UPDATE SET
           is_deposit = EXCLUDED.is_deposit,
           deposit_confidence_percentage = EXCLUDED.deposit_confidence_percentage,
           nametag = EXCLUDED.nametag,
           image = EXCLUDED.image,
           reason = EXCLUDED.reason,
           metrics = EXCLUDED.metrics,
           gemini_analysis = EXCLUDED.gemini_analysis,
           last_analysis = EXCLUDED.last_analysis`,
        [
          analysis.wallet,
          analysis.is_deposit,
          analysis.deposit_confidence_percentage,
          analysis.nametag,
          analysis.image,
          analysis.reason,
          analysis.metrics,
          analysis.gemini_analysis,
          new Date(analysis.lastAnalysis),
        ]
      )
    );
    logger.info(`Saved wallet analysis for ${analysis.wallet} to PostgreSQL.`);
  } catch (error) {
    logger.error(`Error saving wallet analysis for ${analysis.wallet}: ${error.message}`, { stack: error.stack });
  }
}

async function saveLargeFlow(data) {
  if (!data.large_flows || data.large_flows.length === 0) {
    logger.info(`No large flows to save for ${data.source_wallet_scanned}.`);
    return;
  }
  try {
    const values = data.large_flows.map((flow) => [
      data.source_wallet_scanned || 'N/A',
      flow.from,
      flow.to,
      flow.value_usd,
      flow.tx_hash,
      new Date(flow.block_time),
      flow.from_nametag || 'Unknown',
      flow.to_nametag || 'Unknown',
      new Date(),
    ]);
    const placeholders = values
      .map((_, i) => `(${values.map((_, j) => `$${i * 9 + j + 1}`).join(', ')})`)
      .join(', ');
    const queryText = `
      INSERT INTO large_flows (source_wallet_scanned, from_address, to_address, value_usd, tx_hash, block_time, from_nametag, to_nametag, timestamp_recorded)
      VALUES ${placeholders}
    `;
    await withRetry(() => query(queryText, values.flat()));
    logger.info(`Saved ${data.large_flows.length} large flows for ${data.source_wallet_scanned} to PostgreSQL.`);
  } catch (error) {
    logger.error(`Error saving large flows for ${data.source_wallet_scanned}: ${error.message}`, { stack: error.stack });
  }
}

async function readWalletFile() {
  try {
    logger.info(`Attempting to read wallet file at: ${WALLET_FILE_PATH}`);
    const absolutePath = path.resolve(WALLET_FILE_PATH);
    await fs.access(absolutePath, fs.constants.F_OK);
    const fileContent = await fs.readFile(absolutePath, 'utf-8');
    const wallets = JSON.parse(fileContent);
    const validWallets = wallets
      .filter((wallet) => isAddress(wallet.address))
      .map((wallet) => ({
        address: wallet.address.toLowerCase(),
        name: wallet.name || 'Unknown',
      }));
    logger.info(`Loaded ${validWallets.length} valid wallets: ${JSON.stringify(validWallets)}`);
    return validWallets;
  } catch (error) {
    logger.error(`Error reading wallet file ${WALLET_FILE_PATH}: ${error.message}`, { stack: error.stack });
    return [];
  }
}

async function fetchGeminiAnalysis(walletAddress, txData, isDepositConfidence, currentEthPriceUsd) {
  if (!txData || txData.length === 0) {
    return 'No transaction data available for Gemini analysis.';
  }
  const totalTransactions = txData.length;
  const incomingTransactions = txData.filter((tx) => tx.to.toLowerCase() === walletAddress.toLowerCase()).length;
  const outgoingTransactions = txData.filter((tx) => tx.from.toLowerCase() === walletAddress.toLowerCase()).length;
  const totalValueUsd = txData.reduce((sum, tx) => {
    try {
      return sum + (parseInt(String(tx.value), 16) / 1e18) * currentEthPriceUsd;
    } catch (e) {
      logger.warn(`Error calculating value for Gemini prompt (tx hash: ${tx.hash}): ${e.message}. Skipping this transaction value.`);
      return sum;
    }
  }, 0);
  const uniqueSenders = new Set(txData.filter((tx) => tx.to.toLowerCase() === walletAddress.toLowerCase()).map((tx) => tx.from)).size;

  const prompt = `
    Analyze wallet ${walletAddress} as a potential deposit wallet.
    - Total txs: ${totalTransactions}
    - Incoming txs: ${incomingTransactions}
    - Outgoing txs: ${outgoingTransactions}
    - Total value (USD): ${totalValueUsd.toFixed(2)}
    - Unique senders: ${uniqueSenders}
    Confidence: ${isDepositConfidence.toFixed(0)}%.
    Provide a concise analysis (50-100 words) in Markdown to confirm if this is a deposit wallet for exchanges. Focus on key patterns.
  `;
  try {
    logger.info(`Calling Gemini for analysis of ${walletAddress}...`);
    const response = await axios.post(
      `${process.env.NEXTAUTH_URL}/api/gemini`,
      {
        prompt: prompt,
        deepSearch: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.INTERNAL_API_TOKEN,
          'X-HMAC-Signature': crypto
            .createHmac('sha256', HMAC_SECRET)
            .update(JSON.stringify({ prompt, deepSearch: false }))
            .digest('hex'),
          'User-Agent': 'Server/1.0',
        },
        timeout: DEFAULT_GEMINI_TIMEOUT_MS,
      }
    );

    if (response.status !== 200 || !response.data.answer) {
      logger.error(`Gemini API returned non-200 status or no answer: ${response.status}, ${JSON.stringify(response.data)}`);
      return 'No analysis returned from Gemini.';
    }
    return response.data.answer;
  } catch (e) {
    logger.error(`Error fetching Gemini analysis for ${walletAddress}: ${e.message}`, { stack: e.stack, response: e.response?.data });
    return 'Unable to fetch Gemini analysis.';
  }
}

async function identifyDepositWallet(walletAddress, primaryTargetWallet, chain = 'ethereum', enableGemini = true, currentEthPriceUsd = DEFAULT_ETH_PRICE_USD) {
  if (!isAddress(walletAddress) || !isAddress(primaryTargetWallet)) {
    logger.error(`Invalid wallet address (${walletAddress}) or primary target wallet (${primaryTargetWallet}) provided for identifyDepositWallet.`);
    return null;
  }
  if (!VALID_CHAINS.includes(chain)) {
    logger.error(`Invalid chain: ${chain}. Supported chains: ${VALID_CHAINS.join(', ')}`);
    return null;
  }
  if (typeof currentEthPriceUsd !== 'number' || currentEthPriceUsd <= 0) {
    logger.warn(`Invalid eth_price_usd: ${currentEthPriceUsd}. Using default: ${DEFAULT_ETH_PRICE_USD}`);
    currentEthPriceUsd = DEFAULT_ETH_PRICE_USD;
  }

  const lowerWalletAddress = walletAddress.toLowerCase();
  const lowerPrimaryTargetWallet = primaryTargetWallet.toLowerCase();

  logger.info(`Analyzing potential deposit wallet: ${lowerWalletAddress} on ${chain} for sending to ${lowerPrimaryTargetWallet}...`);

  const txData = await fetchBlockchainData(lowerWalletAddress, 'transactions', false, 500, chain);
  let nametag = (await getNametag(lowerWalletAddress)) || 'Unknown';

  if (!txData || txData.length === 0) {
    logger.info(`No transactions found for wallet ${lowerWalletAddress}. Skipping nametag assignment and PostgreSQL save.`);
    return {
      wallet: lowerWalletAddress,
      is_deposit: false,
      deposit_confidence_percentage: 0,
      nametag: nametag,
      image: '/icons/default.webp',
      gemini_analysis: 'No transactions found to analyze.',
      reason: 'No transactions found',
      metrics: {},
      lastAnalysis: new Date().toISOString(),
    };
  }

  const now = new Date();
  const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const recentTxs30d = txData.filter((tx) => {
    try {
      return new Date(tx.block_time) > last30Days;
    } catch {
      logger.warn(`Invalid block_time for tx in wallet ${lowerWalletAddress}: ${tx.block_time}. Skipping transaction.`);
      return false;
    }
  });

  let confidenceScore = 0;
  let reasonParts = [];

  const incomingTxs24h = recentTxs30d.filter((tx) => tx.to.toLowerCase() === lowerWalletAddress && new Date(tx.block_time) > last24Hours);

  if (incomingTxs24h.length < 20) {
    confidenceScore += 20;
    reasonParts.push(`Low incoming transaction volume in 24h (< 20 txs, found ${incomingTxs24h.length}).`);
  } else {
    reasonParts.push(`High incoming transaction volume in 24h (${incomingTxs24h.length} txs).`);
  }

  const uniqueSendersToWallet = new Set(incomingTxs24h.map((tx) => tx.from.toLowerCase())).size;
  if (uniqueSendersToWallet > 0 && uniqueSendersToWallet < 10) {
    confidenceScore += 20;
    reasonParts.push(`Few unique senders (${uniqueSendersToWallet}) to this wallet in 24h.`);
  } else if (uniqueSendersToWallet === 0) {
    reasonParts.push('No incoming transactions in 24h to check unique senders.');
  } else {
    reasonParts.push(`Many unique senders (${uniqueSendersToWallet}) to this wallet in 24h.`);
  }

  const outgoingToPrimaryTarget = recentTxs30d.filter(
    (tx) => tx.from.toLowerCase() === lowerWalletAddress && tx.to.toLowerCase() === lowerPrimaryTargetWallet
  );
  const totalOutgoingTxs = recentTxs30d.filter((tx) => tx.from.toLowerCase() === lowerWalletAddress).length;

  if (outgoingToPrimaryTarget.length === 0) {
    logger.info(`No outgoing transactions to primary wallet ${lowerPrimaryTargetWallet} for wallet ${lowerWalletAddress} in last 30 days. Skipping nametag assignment and PostgreSQL save.`);
    return {
      wallet: lowerWalletAddress,
      is_deposit: false,
      deposit_confidence_percentage: confidenceScore,
      nametag: nametag,
      image: '/icons/default.webp',
      reason: `No outgoing transactions sent back to target wallet ${lowerPrimaryTargetWallet} in last 30 days.`,
      metrics: {
        incoming_txs_24h: incomingTxs24h.length,
        unique_senders_to_wallet_24h: uniqueSendersToWallet,
        total_outgoing_txs_30d: totalOutgoingTxs,
        outgoing_to_primary_target_30d: outgoingToPrimaryTarget.length,
        unique_outgoing_destinations_30d: 0,
        has_complex_incoming_interaction_30d: false,
      },
      gemini_analysis: 'Skipped due to no outgoing transactions to primary wallet in last 30 days.',
      lastAnalysis: new Date().toISOString(),
    };
  }

  if (totalOutgoingTxs > 0 && outgoingToPrimaryTarget.length / totalOutgoingTxs >= 0.6) {
    confidenceScore += 30;
    reasonParts.push(`Significant portion of outgoing transactions sent back to target wallet ${lowerPrimaryTargetWallet} in last 30 days.`);
  } else if (outgoingToPrimaryTarget.length > 0) {
    confidenceScore += 15;
    reasonParts.push(`Some outgoing transactions sent back to target wallet ${lowerPrimaryTargetWallet} in last 30 days.`);
  }

  const hasComplexIncomingInteraction = recentTxs30d.some(
    (tx) => tx.to.toLowerCase() === lowerWalletAddress && tx.input !== '0x' && tx.input.length > 2
  );
  if (!hasComplexIncomingInteraction) {
    confidenceScore += 15;
    reasonParts.push('No complex incoming smart contract interactions in last 30 days.');
  } else {
    reasonParts.push('Has complex incoming smart contract interactions in last 30 days.');
  }

  const nonContractOutgoingTxs30d = recentTxs30d.filter((tx) => tx.from.toLowerCase() === lowerWalletAddress);
  const uniqueOutgoingDestinations = new Set(nonContractOutgoingTxs30d.map((tx) => tx.to.toLowerCase())).size;

  if (uniqueOutgoingDestinations === 1 && nonContractOutgoingTxs30d[0]?.to.toLowerCase() === lowerPrimaryTargetWallet) {
    confidenceScore += 15;
    reasonParts.push('Sends exclusively to the primary target wallet in last 30 days.');
  } else if (uniqueOutgoingDestinations >= 1 && uniqueOutgoingDestinations <= 5) {
    confidenceScore += 5;
    reasonParts.push(`Sends to few unique destinations (${uniqueOutgoingDestinations}) in last 30 days.`);
  } else {
    reasonParts.push(`Sends to many unique destinations (${uniqueOutgoingDestinations}) in last 30 days.`);
  }

  const finalReason = reasonParts.join(' ');
  confidenceScore = Math.min(confidenceScore, 100);
  const isDeposit = confidenceScore >= DEPOSIT_WALLET_CONFIDENCE_THRESHOLD;

  let geminiAnalysis = 'Gemini analysis skipped.';
  if (enableGemini && isDeposit && confidenceScore < GEMINI_CONFIDENCE_THRESHOLD) {
    logger.info(`Wallet ${lowerWalletAddress} is a deposit wallet with confidence ${confidenceScore}% (< ${GEMINI_CONFIDENCE_THRESHOLD}%). Calling Gemini for analysis.`);
    geminiAnalysis = await fetchGeminiAnalysis(lowerWalletAddress, txData, confidenceScore, currentEthPriceUsd);
  } else if (isDeposit && confidenceScore >= GEMINI_CONFIDENCE_THRESHOLD) {
    geminiAnalysis = 'Gemini analysis skipped due to high confidence.';
    logger.info(`Wallet ${lowerWalletAddress} is a deposit wallet with confidence ${confidenceScore}% (>= ${GEMINI_CONFIDENCE_THRESHOLD}%). Skipping Gemini analysis.`);
  }

  const metrics = {
    incoming_txs_24h: incomingTxs24h.length,
    unique_senders_to_wallet_24h: uniqueSendersToWallet,
    total_outgoing_txs_30d: totalOutgoingTxs,
    outgoing_to_primary_target_30d: outgoingToPrimaryTarget.length,
    unique_outgoing_destinations_30d: uniqueOutgoingDestinations,
    has_complex_incoming_interaction_30d: hasComplexIncomingInteraction,
  };

  const result = {
    wallet: lowerWalletAddress,
    is_deposit: isDeposit,
    deposit_confidence_percentage: confidenceScore,
    nametag: nametag,
    image: '/icons/default.webp',
    reason: finalReason,
    metrics: metrics,
    gemini_analysis: geminiAnalysis,
    lastAnalysis: new Date().toISOString(),
  };

  if (isDeposit && outgoingToPrimaryTarget.length > 0) {
    const primaryWallets = await readWalletFile();
    logger.info(`Looking for primary wallet ${lowerPrimaryTargetWallet} in ${JSON.stringify(primaryWallets.map((w) => ({ address: w.address, name: w.name })))}`);
    const primaryWallet = primaryWallets.find((w) => w.address.toLowerCase() === lowerPrimaryTargetWallet);
    if (!primaryWallet) {
      logger.error(`No primary wallet found for ${lowerPrimaryTargetWallet} in wallets.json`);
      const newNametagValue = `Unknown Deposit Wallet (Conf: ${confidenceScore.toFixed(0)}%)`;
      const newImage = '/icons/default.webp';
      await addNametag(lowerWalletAddress, {
        name: newNametagValue,
        description: `Automatically detected as a deposit wallet, but primary wallet ${lowerPrimaryTargetWallet} not found in wallets.json.`,
        subcategory: 'Exchange/Service',
        image: newImage,
      });
      result.nametag = newNametagValue;
      result.image = newImage;
    } else {
      const shortName = primaryWallet.name.split(' ')[0];
      const newNametagValue = `${shortName} Deposit Wallet`;
      const newImage = `/icons/${shortName.toLowerCase().replace(/[^a-z0-9]/g, '')}.webp`;
      logger.info(`Assigning nametag ${newNametagValue} and image ${newImage} to ${lowerWalletAddress}`);
      await addNametag(lowerWalletAddress, {
        name: newNametagValue,
        description: `Automatically detected as a deposit wallet sending to ${primaryWallet.name} wallet.`,
        subcategory: 'Exchange/Service',
        image: newImage,
      });
      result.nametag = newNametagValue;
      result.image = newImage;
    }
    await saveWalletAnalysis(result);
  } else {
    logger.info(`Wallet ${lowerWalletAddress} does not meet criteria (is_deposit: ${isDeposit}, outgoing_to_primary_target_30d: ${outgoingToPrimaryTarget.length}). Skipping nametag assignment and PostgreSQL save.`);
  }

  return result;
}

export const POST = handlerWrapper(async (req, body) => {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const userAgent = req.headers.get('user-agent');

  if (userAgent !== ALLOWED_USER_AGENT) {
    logger.warn(`Invalid User-Agent: ${userAgent}`, { ip });
    return NextResponse.json({ detail: 'Unauthorized: Invalid User-Agent.' }, { status: 403 });
  }

  const apiKey = req.headers.get('x-api-key');
  const internalApiToken = process.env.INTERNAL_API_TOKEN;

  if (!apiKey || (apiKey !== internalApiToken && !(await verifyApiKey(apiKey)))) {
    logger.warn(`Unauthorized: Invalid or missing API key: ${apiKey}`, { ip });
    return NextResponse.json({ detail: 'Unauthorized: Invalid or missing API key.' }, { status: 401 });
  }

  const signature = req.headers.get('x-hmac-signature');
  if (!signature || !(await verifyHmacSignature(body, signature, HMAC_SECRET))) {
    logger.warn('Unauthorized: Invalid HMAC signature.', { ip });
    return NextResponse.json({ detail: 'Unauthorized: Invalid HMAC signature.' }, { status: 401 });
  }

  let session;
  let isAuthorized = false;

  try {
    session = await auth(); // Không truyền req
  } catch (error) {
    logger.error(`Error during auth: ${error.message}`, { stack: error.stack, ip });
  }

  if (session) {
    const isAdminUser = await checkAdminStatus(session.user.id);
    if (isAdminUser) {
      isAuthorized = true;
    } else {
      logger.warn(`Forbidden access attempt to analyze-wallets API by non-admin user: ${session.user.id}`, { ip });
      return NextResponse.json({ detail: 'Forbidden: Admin access required.' }, { status: 403 });
    }
  } else if (apiKey) {
    isAuthorized = true;
  } else {
    logger.warn('Unauthorized access attempt to analyze-wallets API (no session or API key)', { ip });
    return NextResponse.json({ detail: 'Unauthorized: Please log in or provide a valid API key.' }, { status: 401 });
  }

  if (!isAuthorized) {
    return NextResponse.json({ detail: 'Unauthorized: Access denied.' }, { status: 401 });
  }

  try {
    const { action, wallet_address, chain = 'ethereum', primary_target_wallet, eth_price_usd } = body;

    if (!action) {
      return NextResponse.json({ error: 'Action is required.' }, { status: 400 });
    }
    const currentEthPriceUsd = typeof eth_price_usd === 'number' && eth_price_usd > 0 ? eth_price_usd : DEFAULT_ETH_PRICE_USD;
    if (eth_price_usd !== currentEthPriceUsd) {
      logger.warn(`Invalid eth_price_usd: ${eth_price_usd}. Using default: ${currentEthPriceUsd}`, { ip });
    }
    if (!VALID_CHAINS.includes(chain)) {
      return NextResponse.json({ error: `Invalid chain: ${chain}. Supported chains: ${VALID_CHAINS.join(', ')}` }, { status: 400 });
    }

    if (action === 'identify') {
      if (!wallet_address) {
        return NextResponse.json({ error: "Wallet address is required for 'identify' action." }, { status: 400 });
      }
      const result = await identifyDepositWallet(wallet_address, primary_target_wallet || wallet_address, chain, true, currentEthPriceUsd);
      return NextResponse.json(result);
    } else if (action === 'detect-large-flow') {
      if (!wallet_address) {
        return NextResponse.json({ error: "Wallet address is required for 'detect-large-flow' action." }, { status: 400 });
      }
      logger.info(`Detecting large flows for ${wallet_address} via API.`, { ip });
      const largeFlowResult = await detectLargeFlow(wallet_address, chain, LARGE_VALUE_THRESHOLD_USD, 500, currentEthPriceUsd);
      if (largeFlowResult && largeFlowResult.large_flows && largeFlowResult.large_flows.length > 0) {
        await saveLargeFlow({
          source_wallet_scanned: wallet_address,
          large_flows: largeFlowResult.large_flows,
        });
        logger.info(`Saved ${largeFlowResult.large_flows.length} large flows for ${wallet_address}.`, { ip });
      } else {
        logger.info(`No large flows detected for ${wallet_address}.`, { ip });
      }
      return NextResponse.json(largeFlowResult);
    } else if (action === 'get-transactions') {
      if (!wallet_address) {
        return NextResponse.json({ error: "Wallet address is required for 'get-transactions' action." }, { status: 400 });
      }
      logger.info(`Fetching transactions for ${wallet_address} via API.`, { ip });
      const txData = await fetchBlockchainData(wallet_address, 'transactions', false, 100, chain);

      const incomingTxs = txData
        .filter((tx) => tx.to.toLowerCase() === wallet_address.toLowerCase())
        .slice(0, 50)
        .map((tx) => ({
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: (parseInt(String(tx.value), 16) / 1e18).toFixed(6),
          block_time: tx.block_time,
          type: 'incoming',
        }));

      const outgoingTxs = txData
        .filter((tx) => tx.from.toLowerCase() === wallet_address.toLowerCase())
        .slice(0, 50)
        .map((tx) => ({
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: (parseInt(String(tx.value), 16) / 1e18).toFixed(6),
          block_time: tx.block_time,
          type: 'outgoing',
        }));

      return NextResponse.json({ incoming: incomingTxs, outgoing: outgoingTxs });
    } else if (action === 'debug-wallets') {
      const wallets = await readWalletFile();
      return NextResponse.json({ wallets });
    } else if (action === 'debug-wallet-file') {
      const absolutePath = path.resolve(process.env.WALLET_FILE_PATH);
      await fs.access(absolutePath, fs.constants.F_OK);
      const fileContent = await fs.readFile(absolutePath, 'utf-8');
      logger.info(`Debug: Successfully read wallet file at ${absolutePath}. Content length: ${fileContent.length}`, { ip });
      const wallets = await readWalletFile();
      return NextResponse.json({ path: absolutePath, wallets });
    } else {
      return NextResponse.json(
        { error: `Invalid action: ${action}. Supported actions: 'identify', 'detect-large-flow', 'get-transactions', 'debug-wallets', 'debug-wallet-file'.` },
        { status: 400 }
      );
    }
  } catch (error) {
    logger.error(`Error in analyze-wallets API for action '${body.action}': ${error.message}`, { stack: error.stack, ip });
    return NextResponse.json({ error: `An error occurred: ${error.message}` }, { status: 500 });
  }
});