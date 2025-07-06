// pages/api/analyze-wallets.js
import { fetchBlockchainData } from '../../lib/blockchainData.js';
import { getNametag, addNametag } from '../../lib/nametags.js';
import { db } from '../../utils/firebaseAdmin.js';
import axios from 'axios';
import { isAddress } from 'ethers';
import { detectLargeFlow } from '../../lib/detectLargeFlow.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import pkg from '../../utils/logger.cjs';
import { saveWalletAnalysis as saveAnalysisToFirestore, saveLargeFlow as saveLargeFlowToFirestore } from '../../lib/analysisStorage';
import fs from 'fs/promises';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import path from 'path';

const { logger } = pkg;
const ALLOWED_USER_AGENT = 'CronWorker/1.0';
const HMAC_SECRET = process.env.HMAC_SECRET || crypto.randomBytes(32).toString('hex');
const API_KEYS_COLLECTION = 'api_keys';
const RATE_LIMIT_REQUESTS = 100; // 100 yêu cầu mỗi phút
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 phút
const DEFAULT_GEMINI_TIMEOUT_MS = 60000;
const LARGE_VALUE_THRESHOLD_USD = 500000;
const DEPOSIT_WALLET_CONFIDENCE_THRESHOLD = 60;
const DEFAULT_ETH_PRICE_USD = 2000;
const WALLET_FILE_PATH = process.env.WALLET_FILE_PATH || path.join(process.cwd(), 'cron-worker', 'wallets.json');

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
    const keyDoc = await db.collection(API_KEYS_COLLECTION).doc(apiKey).get();
    if (!keyDoc.exists) {
      logger.warn(`Invalid API key: ${apiKey}`);
      return false;
    }
    const { active, expiresAt } = keyDoc.data();
    if (!active || new Date(expiresAt) < new Date()) {
      logger.warn(`API key ${apiKey} is inactive or expired`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(`Error verifying API key: ${error.message}`, { stack: error.stack });
    return false;
  }
}

async function readWalletFile() {
  try {
    const absolutePath = path.resolve(process.env.WALLET_FILE_PATH);
    logger.info(`Attempting to read wallet file at resolved path: ${absolutePath}`);
    
    // Kiểm tra file tồn tại
    await fs.access(absolutePath, fs.constants.F_OK);
    logger.info(`File exists at: ${absolutePath}`);
    
    const fileContent = await fs.readFile(absolutePath, 'utf-8');
    logger.debug(`Raw wallet file content: ${fileContent}`);
    
    let wallets = [];
    if (process.env.WALLET_FILE_PATH.endsWith('.json')) {
      wallets = JSON.parse(fileContent);
    } else if (process.env.WALLET_FILE_PATH.endsWith('.csv')) {
      const lines = fileContent.trim().split('\n');
      const headers = lines[0].split(',');
      wallets = lines.slice(1).map(line => {
        const [address, name] = line.split(',');
        return { address, name };
      });
    } else {
      throw new Error('Unsupported file format. Use JSON or CSV.');
    }
    
    const validWallets = wallets
      .filter(wallet => isAddress(wallet.address))
      .map(wallet => ({
        address: wallet.address.toLowerCase(),
        name: wallet.name || 'Unknown'
      }));
    
    if (validWallets.length === 0) {
      logger.warn('No valid wallet addresses found in the file.');
    } else {
      logger.info(`Loaded ${validWallets.length} valid wallet addresses from ${absolutePath}: ${validWallets.map(w => w.address).join(', ')}`);
    }
    
    return validWallets;
  } catch (error) {
    logger.error(`Error reading wallet file ${process.env.WALLET_FILE_PATH} (resolved: ${path.resolve(process.env.WALLET_FILE_PATH)}): ${error.message}`, { stack: error.stack });
    return [];
  }
}

async function checkAdminStatus(uid) {
  if (!uid) return false;
  try {
    const adminDoc = await db.collection('admins').doc(uid).get();
    return adminDoc.exists && adminDoc.data().isAdmin === true;
  } catch (error) {
    logger.error(`Error checking admin status for user ${uid}: ${error.message}`);
    return false;
  }
}

async function fetchGeminiAnalysis(walletAddress, txData, isDepositConfidence, currentEthPriceUsd) {
  if (!txData || txData.length === 0) {
    return 'No transaction data available for Gemini analysis.';
  }
  const totalTransactions = txData.length;
  const incomingTransactions = txData.filter(tx => tx.to.toLowerCase() === walletAddress.toLowerCase()).length;
  const outgoingTransactions = txData.filter(tx => tx.from.toLowerCase() === walletAddress.toLowerCase()).length;
  const totalValueUsd = txData.reduce((sum, tx) => {
    try {
      return sum + (parseInt(String(tx.value), 16) / 1e18 * currentEthPriceUsd);
    } catch (e) {
      logger.warn(`Error calculating value for Gemini prompt (tx hash: ${tx.hash}): ${e.message}. Skipping this transaction value.`);
      return sum;
    }
  }, 0);
  const uniqueSenders = new Set(txData.filter(tx => tx.to.toLowerCase() === walletAddress.toLowerCase()).map(tx => tx.from)).size;

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
    const response = await axios.post(`${process.env.NEXTAUTH_URL}/api/gemini`, {
      prompt: prompt,
      deepSearch: false
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': await verifyApiKey(),
        'X-HMAC-Signature': crypto.createHmac('sha256', HMAC_SECRET).update(JSON.stringify({ prompt, deepSearch: false })).digest('hex'),
        'User-Agent': 'Server/1.0'
      },
      timeout: DEFAULT_GEMINI_TIMEOUT_MS
    });

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

  const lowerWalletAddress = walletAddress.toLowerCase();
  const lowerPrimaryTargetWallet = primaryTargetWallet.toLowerCase();

  logger.info(`Analyzing potential deposit wallet: ${lowerWalletAddress} on ${chain} for sending to ${lowerPrimaryTargetWallet}...`);

  const txData = await fetchBlockchainData(lowerWalletAddress, 'transactions', false, 500, chain);
  let nametag = await getNametag(lowerWalletAddress) || 'Unknown';

  if (!txData || txData.length === 0) {
    logger.info(`No transactions found for wallet ${lowerWalletAddress}. Skipping nametag assignment and Firestore save.`);
    return {
      wallet: lowerWalletAddress,
      is_deposit: false,
      deposit_confidence_percentage: 0,
      nametag: nametag,
      gemini_analysis: 'No transactions found to analyze.',
      reason: 'No transactions found',
      metrics: {},
      lastAnalysis: new Date().toISOString()
    };
  }

  const now = new Date();
  const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const recentTxs30d = txData.filter(tx => {
    try {
      return new Date(tx.block_time) > last30Days;
    } catch {
      logger.warn(`Invalid block_time for tx in wallet ${lowerWalletAddress}: ${tx.block_time}. Skipping transaction.`);
      return false;
    }
  });

  let confidenceScore = 0;
  let reasonParts = [];

  const incomingTxs24h = recentTxs30d.filter(tx =>
    tx.to.toLowerCase() === lowerWalletAddress && new Date(tx.block_time) > last24Hours
  );

  if (incomingTxs24h.length < 20) {
    confidenceScore += 20;
    reasonParts.push(`Low incoming transaction volume in 24h (< 20 txs, found ${incomingTxs24h.length}).`);
  } else {
    reasonParts.push(`High incoming transaction volume in 24h (${incomingTxs24h.length} txs).`);
  }

  const uniqueSendersToWallet = new Set(incomingTxs24h.map(tx => tx.from.toLowerCase())).size;
  if (uniqueSendersToWallet > 0 && uniqueSendersToWallet < 10) {
    confidenceScore += 20;
    reasonParts.push(`Few unique senders (${uniqueSendersToWallet}) to this wallet in 24h.`);
  } else if (uniqueSendersToWallet === 0) {
    reasonParts.push('No incoming transactions in 24h to check unique senders.');
  } else {
    reasonParts.push(`Many unique senders (${uniqueSendersToWallet}) to this wallet in 24h.`);
  }

  const outgoingToPrimaryTarget = recentTxs30d.filter(tx =>
    tx.from.toLowerCase() === lowerWalletAddress && tx.to.toLowerCase() === lowerPrimaryTargetWallet
  );
  const totalOutgoingTxs = recentTxs30d.filter(tx => tx.from.toLowerCase() === lowerWalletAddress).length;

  // Kiểm tra điều kiện bắt buộc: Phải có giao dịch gửi đến primary_target_wallet trong 30 ngày
  if (outgoingToPrimaryTarget.length === 0) {
    logger.info(`No outgoing transactions to primary wallet ${lowerPrimaryTargetWallet} for wallet ${lowerWalletAddress} in last 30 days. Skipping nametag assignment and Firestore save.`);
    return {
      wallet: lowerWalletAddress,
      is_deposit: false,
      deposit_confidence_percentage: confidenceScore,
      nametag: nametag,
      reason: `No outgoing transactions sent back to target wallet ${lowerPrimaryTargetWallet} in last 30 days.`,
      metrics: {
        incoming_txs_24h: incomingTxs24h.length,
        unique_senders_to_wallet_24h: uniqueSendersToWallet,
        total_outgoing_txs_30d: totalOutgoingTxs,
        outgoing_to_primary_target_30d: outgoingToPrimaryTarget.length,
        unique_outgoing_destinations_30d: 0,
        has_complex_incoming_interaction_30d: false
      },
      gemini_analysis: 'Skipped due to no outgoing transactions to primary wallet in last 30 days.',
      lastAnalysis: new Date().toISOString()
    };
  }

  if (totalOutgoingTxs > 0 && outgoingToPrimaryTarget.length / totalOutgoingTxs >= 0.3) {
    confidenceScore += 30;
    reasonParts.push(`Significant portion of outgoing transactions sent back to target wallet ${lowerPrimaryTargetWallet} in last 30 days.`);
  } else if (outgoingToPrimaryTarget.length > 0) {
    confidenceScore += 15;
    reasonParts.push(`Some outgoing transactions sent back to target wallet ${lowerPrimaryTargetWallet} in last 30 days.`);
  }

  const hasComplexIncomingInteraction = recentTxs30d.some(tx =>
    tx.to.toLowerCase() === lowerWalletAddress && tx.input !== '0x' && tx.input.length > 2
  );
  if (!hasComplexIncomingInteraction) {
    confidenceScore += 15;
    reasonParts.push('No complex incoming smart contract interactions in last 30 days.');
  } else {
    reasonParts.push('Has complex incoming smart contract interactions in last 30 days.');
  }

  const nonContractOutgoingTxs30d = recentTxs30d.filter(tx => tx.from.toLowerCase() === lowerWalletAddress);
  const uniqueOutgoingDestinations = new Set(nonContractOutgoingTxs30d.map(tx => tx.to.toLowerCase())).size;

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
  if (enableGemini && isDeposit) {
    geminiAnalysis = await fetchGeminiAnalysis(lowerWalletAddress, txData, confidenceScore, currentEthPriceUsd);
  }

  const metrics = {
    incoming_txs_24h: incomingTxs24h.length,
    unique_senders_to_wallet_24h: uniqueSendersToWallet,
    total_outgoing_txs_30d: totalOutgoingTxs,
    outgoing_to_primary_target_30d: outgoingToPrimaryTarget.length,
    unique_outgoing_destinations_30d: uniqueOutgoingDestinations,
    has_complex_incoming_interaction_30d: hasComplexIncomingInteraction
  };

  const result = {
    wallet: lowerWalletAddress,
    is_deposit: isDeposit,
    deposit_confidence_percentage: confidenceScore,
    nametag: nametag,
    reason: finalReason,
    metrics: metrics,
    gemini_analysis: geminiAnalysis,
    lastAnalysis: new Date().toISOString()
  };

  // Chỉ gắn nhãn và lưu vào Firestore nếu ví đủ điều kiện
  if (isDeposit && outgoingToPrimaryTarget.length > 0) {
    const primaryWallets = await readWalletFile();
    logger.info(`Looking for primary wallet ${lowerPrimaryTargetWallet} in ${JSON.stringify(primaryWallets.map(w => ({ address: w.address, name: w.name })))}`);
    const primaryWallet = primaryWallets.find(w => w.address.toLowerCase() === lowerPrimaryTargetWallet);
    if (!primaryWallet) {
      logger.error(`No primary wallet found for ${lowerPrimaryTargetWallet} in wallets.json`);
      const newNametagValue = `Unknown Deposit Wallet (Conf: ${confidenceScore.toFixed(0)}%)`;
      await addNametag(lowerWalletAddress, {
        auto_tag: {
          'Name Tag': newNametagValue,
          Description: `Automatically detected as a deposit wallet, but primary wallet ${lowerPrimaryTargetWallet} not found in wallets.json.`,
          Subcategory: 'Exchange/Service',
          image: '/icons/default.png'
        }
      });
      result.nametag = newNametagValue;
    } else {
      const shortName = primaryWallet.name.split(' ')[0];
      const newNametagValue = `${shortName} Deposit Wallet (Conf: ${confidenceScore.toFixed(0)}%)`;
      logger.info(`Assigning nametag ${newNametagValue} to ${lowerWalletAddress}`);
      await addNametag(lowerWalletAddress, {
        auto_tag: {
          'Name Tag': newNametagValue,
          Description: `Automatically detected as a deposit wallet sending to ${primaryWallet.name} wallet.`,
          Subcategory: 'Exchange/Service',
          image: '/icons/default.png'
        }
      });
      result.nametag = newNametagValue;
    }
    await saveAnalysisToFirestore(result);
  } else {
    logger.info(`Wallet ${lowerWalletAddress} does not meet criteria (is_deposit: ${isDeposit}, outgoing_to_primary_target_30d: ${outgoingToPrimaryTarget.length}). Skipping nametag assignment and Firestore save.`);
  }

  return result;
}

export default async function handler(req, res) {
  // Áp dụng rate limiting
  limiter(req, res, async () => {
    const userAgent = req.headers['user-agent'];
    if (userAgent !== ALLOWED_USER_AGENT) {
      logger.warn(`Invalid User-Agent: ${userAgent}`);
      return res.status(403).json({ detail: 'Unauthorized: Invalid User-Agent.' });
    }

    // Kiểm tra API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || !(await verifyApiKey(apiKey))) {
      logger.warn('Unauthorized: Invalid or missing API key.');
      return res.status(401).json({ detail: 'Unauthorized: Invalid or missing API key.' });
    }

    // Kiểm tra HMAC signature
    const signature = req.headers['x-hmac-signature'];
    if (!signature || !(await verifyHmacSignature(req.body, signature, HMAC_SECRET))) {
      logger.warn('Unauthorized: Invalid HMAC signature.');
      return res.status(401).json({ detail: 'Unauthorized: Invalid HMAC signature.' });
    }

    // Kiểm tra đăng nhập cho người dùng (nếu không dùng API key)
    const session = await getServerSession(req, res, authOptions);
    let isAuthorized = false;

    if (session) {
      const isAdminUser = await checkAdminStatus(session.user.id);
      if (isAdminUser) {
        isAuthorized = true;
      } else {
        logger.warn(`Forbidden access attempt to analyze-wallets API by non-admin user: ${session.user.id}`);
        return res.status(403).json({ detail: 'Forbidden: Admin access required.' });
      }
    } else if (apiKey) {
      isAuthorized = true; // API key đã được xác thực ở trên
    } else {
      logger.warn('Unauthorized access attempt to analyze-wallets API (no session or API key)');
      return res.status(401).json({ detail: 'Unauthorized: Please log in or provide a valid API key.' });
    }

    if (!isAuthorized) {
      return res.status(401).json({ detail: 'Unauthorized: Access denied.' });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed. Only POST is supported.' });
    }

    const { action, wallet_address, chain = 'ethereum', primary_target_wallet, eth_price_usd } = req.body;

    try {
      const currentEthPriceUsd = eth_price_usd || DEFAULT_ETH_PRICE_USD;
      logger.info(`Using ETH price: $${currentEthPriceUsd} for API call.`);

      if (action === 'identify') {
        if (!wallet_address) {
          return res.status(400).json({ error: "Wallet address is required for 'identify' action." });
        }
        const result = await identifyDepositWallet(
          wallet_address,
          primary_target_wallet || wallet_address,
          chain,
          true,
          currentEthPriceUsd
        );
        return res.status(200).json(result);
      } else if (action === 'detect-large-flow') {
        if (!wallet_address) {
          return res.status(400).json({ error: "Wallet address is required for 'detect-large-flow' action." });
        }
        logger.info(`Detecting large flows for ${wallet_address} via API.`);
        const largeFlowResult = await detectLargeFlow(
          wallet_address,
          chain,
          LARGE_VALUE_THRESHOLD_USD,
          500,
          currentEthPriceUsd
        );
        if (largeFlowResult && largeFlowResult.large_flows && largeFlowResult.large_flows.length > 0) {
          await saveLargeFlowToFirestore({
            source_wallet_scanned: wallet_address,
            large_flows: largeFlowResult.large_flows
          });
          logger.info(`Saved ${largeFlowResult.large_flows.length} large flows for ${wallet_address}.`);
        } else {
          logger.info(`No large flows detected for ${wallet_address}.`);
        }
        return res.status(200).json(largeFlowResult);
      } else if (action === 'debug-wallets') {
        const wallets = await readWalletFile();
        return res.status(200).json({ wallets });
      } else {
        return res.status(400).json({ error: "Invalid action. Supported actions: 'identify', 'detect-large-flow', 'debug-wallets'." });
      }
    } catch (error) {
      logger.error(`Error in analyze-wallets API for action '${action}': ${error.message}`, { stack: error.stack });
      return res.status(500).json({ error: `An error occurred: ${error.message}` });
    }

    if (action === 'debug-wallet-file') {
  try {
    const absolutePath = path.resolve(process.env.WALLET_FILE_PATH);
    await fs.access(absolutePath, fs.constants.F_OK);
    const fileContent = await fs.readFile(absolutePath, 'utf-8');
    logger.info(`Debug: Successfully read wallet file at ${absolutePath}. Content length: ${fileContent.length}`);
    const wallets = await readWalletFile();
    return res.status(200).json({ path: absolutePath, wallets });
  } catch (error) {
    logger.error(`Debug: Failed to read wallet file at ${process.env.WALLET_FILE_PATH}: ${error.message}`, { stack: error.stack });
    return res.status(500).json({ error: `Failed to read wallet file: ${error.message}` });
  }
}
  });
}