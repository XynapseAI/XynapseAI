// pages/api/analyze-wallets.js
import { fetchBlockchainData } from '../../lib/blockchainData';
import { getNametag, addNametag } from '../../lib/nametags';
import { db } from '../../utils/firebaseAdmin';
import axios from 'axios';
import { isAddress } from 'ethers';
import { detectLargeFlow } from '../../lib/detectLargeFlow';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { logger } from '../../utils/logger';
import { saveWalletAnalysis as saveAnalysisToFirestore, saveLargeFlow as saveLargeFlowToFirestore } from '../../lib/analysisStorage'; // Import from analysisStorage

const GEMINI_API_BASE_URL = process.env.NEXTAUTH_URL + '/api/gemini';
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;
const RECAPTCHA_TOKEN_FOR_INTERNAL_CALLS = process.env.RECAPTCHA_TOKEN_FOR_INTERNAL_CALLS;
const DEFAULT_GEMINI_TIMEOUT_MS = 60000;
const LARGE_VALUE_THRESHOLD_USD = 1000000;
const DEPOSIT_WALLET_CONFIDENCE_THRESHOLD = 60;
const DEFAULT_ETH_PRICE_USD = 2000; // Fallback ETH price

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
Analyze the transaction behavior of wallet ${walletAddress}.
Summary:
- Total transactions: ${totalTransactions}
- Incoming transactions: ${incomingTransactions}
- Outgoing transactions: ${outgoingTransactions}
- Total value (USD): ${totalValueUsd.toFixed(2)}
- Unique senders: ${uniqueSenders}
Based on automated analysis, this wallet is identified as a deposit wallet with a confidence of ${isDepositConfidence.toFixed(0)}%.
Please provide a brief analysis (150-200 words) in Markdown to confirm if this wallet is indeed a deposit wallet (e.g., used by exchanges), explaining your reasoning.
`;
    try {
        logger.info(`Calling Gemini for analysis of ${walletAddress}...`);
        const response = await axios.post(GEMINI_API_BASE_URL, {
            prompt: prompt,
            deepSearch: false,
            recaptchaToken: RECAPTCHA_TOKEN_FOR_INTERNAL_CALLS
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Internal-Token': INTERNAL_API_TOKEN
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

/**
 * Identifies a deposit wallet based on its transaction characteristics.
 * @param {string} walletAddress The wallet address to analyze (this will be Ví 2).
 * @param {string} primaryTargetWallet The primary wallet this wallet sends to (this will be Ví 1).
 * @param {string} chain The blockchain chain.
 * @param {boolean} enableGemini Whether to enable Gemini AI analysis.
 * @param {number} currentEthPriceUsd The current price of Ethereum in USD.
 * @returns {Promise<object>} Analysis result for the wallet.
 */
export async function identifyDepositWallet(walletAddress, primaryTargetWallet, chain = 'ethereum', enableGemini = true, currentEthPriceUsd = DEFAULT_ETH_PRICE_USD) {
    if (!isAddress(walletAddress) || !isAddress(primaryTargetWallet)) {
        logger.error("Invalid wallet address or primary target wallet provided for identifyDepositWallet.");
        return null;
    }

    const lowerWalletAddress = walletAddress.toLowerCase();
    const lowerPrimaryTargetWallet = primaryTargetWallet.toLowerCase();

    logger.info(`Analyzing potential Ví 2: ${lowerWalletAddress} on ${chain} for deposit characteristics (sends to Ví 1: ${lowerPrimaryTargetWallet})...`);

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
        await saveAnalysisToFirestore(result); // Use imported function
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

    // Changed logic for "low incoming transactions"
    if (incomingTxs24h.length < 20) { // Condition: < 20 transactions
        confidenceScore += 20;
        reasonParts.push(`Low incoming transaction volume in 24h (< 20 txs, found ${incomingTxs24h.length}).`);
    } else {
        reasonParts.push(`High incoming transaction volume in 24h (${incomingTxs24h.length} txs).`);
    }

    // SỬA LỖI TẠI ĐÂY: "unique sendersToWallet" -> "uniqueSendersToWallet"
    const uniqueSendersToWallet = new Set(incomingTxs24h.map(tx => tx.from.toLowerCase())).size;
    // Condition: few unique senders
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

    // Condition: sends significant portion to primary target
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
    // Condition: no complex incoming smart contract interactions
    if (!hasComplexIncomingInteraction) {
        confidenceScore += 15;
        reasonParts.push("No complex incoming smart contract interactions.");
    } else {
        reasonParts.push("Has complex incoming smart contract interactions.");
    }

    const nonContractOutgoingTxs7d = recentTxs7d.filter(tx => tx.from.toLowerCase() === lowerWalletAddress);
    const uniqueOutgoingDestinations = new Set(nonContractOutgoingTxs7d.map(tx => tx.to.toLowerCase())).size;

    // Condition: sends to few unique destinations
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
    if (enableGemini && (isDeposit || (nametag && nametag !== 'Unknown'))) {
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
    await saveAnalysisToFirestore(result); // Use imported function

    if (isDeposit && nametag === 'Unknown') {
        const newNametagValue = `Auto-detected Deposit Wallet (Conf: ${confidenceScore.toFixed(0)}%)`;
        await addNametag(lowerWalletAddress, {
            'auto_tag': {
                'Name Tag': newNametagValue,
                'Description': 'Automatically detected as a deposit wallet based on transaction patterns.',
                'Subcategory': 'Exchange/Service',
                'image': '/icons/default.png'
            }
        });
        result.nametag = newNametagValue;
    }

    return result;
}

export default async function handler(req, res) {
    const session = await getServerSession(req, res, authOptions);
    let isAuthorized = false;

    const internalToken = req.headers['x-internal-token'];
    if (internalToken === INTERNAL_API_TOKEN) {
        logger.info('Accessing analyze-wallets API with internal token.');
        isAuthorized = true;
    } else if (session) {
        const isAdminUser = await checkAdminStatus(session.user.id);
        if (isAdminUser) {
            isAuthorized = true;
        } else {
            logger.warn(`Forbidden access attempt to analyze-wallets API by non-admin user: ${session.user.id}`);
            return res.status(403).json({ detail: 'Forbidden: Admin access required.' });
        }
    } else {
        logger.warn('Unauthorized access attempt to analyze-wallets API (no session or invalid internal token)');
        return res.status(401).json({ detail: 'Unauthorized: Please log in or provide a valid internal token.' });
    }

    if (!isAuthorized) {
        return res.status(401).json({ detail: 'Unauthorized: Access denied.' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ detail: 'Method not allowed. Only POST is supported.' });
    }

    const { action, wallet_address, chain = 'ethereum' } = req.body;

    try {
        // Fetch current ETH price for API calls
        let currentEthPriceUsd = DEFAULT_ETH_PRICE_USD;
        try {
            const priceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
            currentEthPriceUsd = priceResponse.data.ethereum.usd;
            logger.info(`Fetched current ETH price: $${currentEthPriceUsd} for API call.`);
        } catch (priceError) {
            logger.warn(`Could not fetch ETH price for API call: ${priceError.message}. Using default price: $${DEFAULT_ETH_PRICE_USD}`);
        }


        if (action === 'identify') {
            if (!wallet_address) {
                return res.status(400).json({ error: "Wallet address is required for 'identify' action." });
            }
            const result = await identifyDepositWallet(wallet_address, wallet_address, chain, true, currentEthPriceUsd); // Passed wallet_address as primary target
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
                currentEthPriceUsd // Pass the fetched ETH price
            );

            if (largeFlowResult && largeFlowResult.large_flows && largeFlowResult.large_flows.length > 0) {
                await saveLargeFlowToFirestore({ // Use imported function
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
        logger.error(`Error in analyze-wallets API for action '${action}': ${error.message}`, error.stack);
        return res.status(500).json({ error: `An error occurred: ${error.message}` });
    }
}