// pages/api/analyze-wallets.js
import { fetchBlockchainData } from '../../lib/blockchainData.js';
import { getNametag, addNametag } from '../../lib/nametags.js';
import { db } from '../../utils/firebaseAdmin.js';
import axios from 'axios';
import { isAddress } from 'ethers';
import { detectLargeFlow } from '../../lib/detectLargeFlow.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { logger } from '../../utils/logger.cjs';
import { saveWalletAnalysis as saveAnalysisToFirestore, saveLargeFlow as saveLargeFlowToFirestore } from '../../lib/analysisStorage';
import fs from 'fs/promises';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

const ALLOWED_USER_AGENT = 'CronWorker/1.0';
const HMAC_SECRET = process.env.HMAC_SECRET || crypto.randomBytes(32).toString('hex');
const API_KEYS_COLLECTION = 'api_keys';
const RATE_LIMIT_REQUESTS = 100; // 100 yêu cầu mỗi phút
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 phút
const DEFAULT_GEMINI_TIMEOUT_MS = 60000;
const LARGE_VALUE_THRESHOLD_USD = 1000000;
const DEPOSIT_WALLET_CONFIDENCE_THRESHOLD = 60;
const DEFAULT_ETH_PRICE_USD = 2000;
const WALLET_FILE_PATH = process.env.WALLET_FILE_PATH || './cron-worker/wallets.json';

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
        const fileContent = await fs.readFile(WALLET_FILE_PATH, 'utf-8');
        const wallets = JSON.parse(fileContent);
        return wallets
            .filter(wallet => isAddress(wallet.address))
            .map(wallet => ({
                address: wallet.address.toLowerCase(),
                name: wallet.name || 'Unknown'
            }));
    } catch (error) {
        logger.error(`Error reading wallet file ${WALLET_FILE_PATH}: ${error.message}`);
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
Provide a concise analysis (30-60 words) in Markdown to confirm if this is a deposit wallet for exchanges. Focus on key patterns.
`;
    try {
        logger.info(`Calling Gemini for analysis of ${walletAddress}...`);
        const response = await axios.post(`${process.env.NEXTAUTH_URL}/api/gemini`, {
            prompt: prompt,
            deepSearch: false
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': await getValidApiKey(),
                'X-HMAC-Signature': generateHmacSignature({ prompt, deepSearch: false }, HMAC_SECRET),
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
        logger.error(`Error fetching Gemini analysis for ${walletAddress}: ${e.message}`);
        if (axios.isAxiosError(e) && e.response) {
            logger.error(`Response details: ${JSON.stringify(e.response.data)}`);
        }
        return 'Unable to fetch Gemini analysis.';
    }
}

async function identifyDepositWallet(walletAddress, primaryTargetWallet, chain = 'ethereum', enableGemini = true, currentEthPriceUsd = DEFAULT_ETH_PRICE_USD) {
    if (!isAddress(walletAddress) || !isAddress(primaryTargetWallet)) {
        logger.error("Invalid wallet address or primary target wallet provided for identifyDepositWallet.");
        return null;
    }

    const lowerWalletAddress = walletAddress.toLowerCase();
    const lowerPrimaryTargetWallet = primaryTargetWallet.toLowerCase();

    logger.info(`Analyzing potential deposit wallet: ${lowerWalletAddress} on ${chain} for sending to ${lowerPrimaryTargetWallet}...`);

    const txData = await fetchBlockchainData(lowerWalletAddress, 'transactions', false, 500, chain);
    const nametag = await getNametag(lowerWalletAddress);

    if (!txData || txData.length === 0) {
        const result = {
            wallet: lowerWalletAddress,
            is_deposit: false,
            deposit_confidence_percentage: 0,
            nametag: nametag,
            gemini_analysis: "No transactions found to analyze.",
            reason: "No transactions found",
            metrics: {},
            lastAnalysis: new Date().toISOString()
        };
        await saveAnalysisToFirestore(result);
        return result;
    }

    const now = new Date();
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recentTxs7d = txData.filter(tx => {
        try {
            return new Date(tx.block_time) > last7Days;
        } catch {
            logger.warn(`Invalid block_time for tx in wallet ${lowerWalletAddress}: ${tx.block_time}. Skipping transaction.`);
            return false;
        }
    });

    let confidenceScore = 0;
    let reasonParts = [];

    const incomingTxs24h = recentTxs7d.filter(tx =>
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
        reasonParts.push("No incoming transactions in 24h to check unique senders.");
    } else {
        reasonParts.push(`Many unique senders (${uniqueSendersToWallet}) to this wallet in 24h.`);
    }

    const outgoingToPrimaryTarget = recentTxs7d.filter(tx =>
        tx.from.toLowerCase() === lowerWalletAddress && tx.to.toLowerCase() === lowerPrimaryTargetWallet
    );
    const totalOutgoingTxs = recentTxs7d.filter(tx => tx.from.toLowerCase() === lowerWalletAddress).length;

    if (totalOutgoingTxs > 0 && outgoingToPrimaryTarget.length / totalOutgoingTxs >= 0.3) {
        confidenceScore += 30;
        reasonParts.push(`Significant portion of outgoing transactions sent back to target wallet ${lowerPrimaryTargetWallet}.`);
    } else if (outgoingToPrimaryTarget.length > 0) {
        confidenceScore += 15;
        reasonParts.push(`Some outgoing transactions sent back to target wallet ${lowerPrimaryTargetWallet}.`);
    } else {
        reasonParts.push(`No outgoing transactions sent back to target wallet ${lowerPrimaryTargetWallet}.`);
    }

    const hasComplexIncomingInteraction = recentTxs7d.some(tx =>
        tx.to.toLowerCase() === lowerWalletAddress && tx.input !== '0x' && tx.input.length > 2
    );
    if (!hasComplexIncomingInteraction) {
        confidenceScore += 15;
        reasonParts.push("No complex incoming smart contract interactions.");
    } else {
        reasonParts.push("Has complex incoming smart contract interactions.");
    }

    const nonContractOutgoingTxs7d = recentTxs7d.filter(tx => tx.from.toLowerCase() === lowerWalletAddress);
    const uniqueOutgoingDestinations = new Set(nonContractOutgoingTxs7d.map(tx => tx.to.toLowerCase())).size;

    if (uniqueOutgoingDestinations === 1 && nonContractOutgoingTxs7d[0]?.to.toLowerCase() === lowerPrimaryTargetWallet) {
        confidenceScore += 15;
        reasonParts.push("Sends exclusively to the primary target wallet.");
    } else if (uniqueOutgoingDestinations >= 1 && uniqueOutgoingDestinations <= 5) {
        confidenceScore += 5;
        reasonParts.push(`Sends to few unique destinations (${uniqueOutgoingDestinations}).`);
    } else {
        reasonParts.push(`Sends to many unique destinations (${uniqueOutgoingDestinations}).`);
    }

    const finalReason = reasonParts.join(" ");
    confidenceScore = Math.min(confidenceScore, 100);
    const isDeposit = confidenceScore >= DEPOSIT_WALLET_CONFIDENCE_THRESHOLD;

    let geminiAnalysis = "Gemini analysis skipped.";
    if (enableGemini && isDeposit) {
        geminiAnalysis = await fetchGeminiAnalysis(lowerWalletAddress, txData, confidenceScore, currentEthPriceUsd);
    }

    const metrics = {
        incoming_txs_24h: incomingTxs24h.length,
        unique_senders_to_wallet_24h: uniqueSendersToWallet,
        total_outgoing_txs_7d: totalOutgoingTxs,
        outgoing_to_primary_target_7d: outgoingToPrimaryTarget.length,
        unique_outgoing_destinations_7d: uniqueOutgoingDestinations,
        has_complex_incoming_interaction_7d: hasComplexIncomingInteraction,
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

    // Tự động gắn nhãn ví deposit dựa trên primaryTargetWallet
    if (isDeposit && nametag === 'Unknown') {
        const primaryWallets = await readWalletFile();
        const primaryWallet = primaryWallets.find(w => w.address.toLowerCase() === lowerPrimaryTargetWallet);
        const shortName = primaryWallet
            ? primaryWallet.name.split(' ')[0]
            : 'Auto-detected';
        const newNametagValue = `${shortName} Deposit Wallet`;
        await addNametag(lowerWalletAddress, {
            'auto_tag': {
                'Name Tag': newNametagValue,
                'Description': `Automatically detected as a deposit wallet sending to ${primaryWallet?.name || 'unknown'} wallet.`,
                'Subcategory': 'Exchange/Service',
                'image': '/icons/default.png'
            }
        });
        result.nametag = newNametagValue;
    }

    await saveAnalysisToFirestore(result);
    return result;
}

export default async function handler(req, res) {
    limiter(req, res, async () => {
        // const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        // if (!ALLOWED_IPS.includes(clientIp)) {
        //     logger.warn(`Unauthorized IP: ${clientIp}`);
        //     return res.status(403).json({ detail: 'Unauthorized: Invalid IP address.' });
        // }

        // Kiểm tra User-Agent
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
            } else {
                return res.status(400).json({ error: "Invalid action. Supported actions: 'identify', 'detect-large-flow'." });
            }
        } catch (error) {
            logger.error(`Error in analyze-wallets API for action '${action}': ${error.message}`, { stack: error.stack });
            return res.status(500).json({ error: `An error occurred: ${error.message}` });
        }
    });
}