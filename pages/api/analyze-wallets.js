// pages/api/analyze-wallets.js
import { fetchBlockchainData } from '../../lib/blockchainData';
import { getNametag, addNametag } from '../../lib/nametags'; // loadAllNametags is not directly needed here
import { saveWalletAnalysis, saveLargeFlow } from '../../lib/analysisStorage'; // getAnalyzedWallets, getHighVolumeWallets are not needed here
import axios from 'axios';
import { isAddress } from 'ethers';
import { detectLargeFlow } from '../../lib/detectLargeFlow';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { logger } from '../../utils/logger';
import { db } from '../../utils/firebaseAdmin'; // Only db is needed for admin check

// --- CONFIGURATION CONSTANTS (or from environment variables) ---
const GEMINI_API_BASE_URL = process.env.NEXTAUTH_URL + '/api/gemini';
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;
const RECAPTCHA_TOKEN_FOR_INTERNAL_CALLS = process.env.RECAPTCHA_TOKEN_FOR_INTERNAL_CALLS;
const DEFAULT_GEMINI_TIMEOUT_MS = 60000; // 60 seconds for Gemini API calls
const LARGE_VALUE_THRESHOLD_USD = 1000000; // Consistent threshold for large flows
const DEPOSIT_WALLET_CONFIDENCE_THRESHOLD = 70; // Confidence score for deposit wallet identification

// --- HELPER FUNCTIONS ---

/**
 * Checks if the current user (by UID) has admin privileges in Firestore.
 * @param {string} uid - The user ID.
 * @returns {Promise<boolean>} True if the user is an admin, false otherwise.
 */
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

/**
 * Calls the Gemini API to get a natural language analysis of a wallet's behavior.
 * @param {string} walletAddress - The wallet address being analyzed.
 * @param {Array} txData - Transaction data for the wallet.
 * @param {number} isDepositConfidence - Confidence score for deposit wallet identification.
 * @returns {Promise<string>} Gemini's analysis in Markdown, or an error message.
 */
async function fetchGeminiAnalysis(walletAddress, txData, isDepositConfidence) {
    if (!txData || txData.length === 0) {
        return 'No transaction data available for Gemini analysis.';
    }

    const totalTransactions = txData.length;
    const incomingTransactions = txData.filter(tx => tx.to.toLowerCase() === walletAddress.toLowerCase()).length;
    const outgoingTransactions = txData.filter(tx => tx.from.toLowerCase() === walletAddress.toLowerCase()).length;
    // Assuming 1 ETH = $2000 for estimation. Replace with actual price if available.
    const totalValueUsd = txData.reduce((sum, tx) => sum + (parseInt(tx.value, 16) / 1e18 * 2000), 0);
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
            deepSearch: false, // Or true, depending on your Gemini API config
            recaptchaToken: RECAPTCHA_TOKEN_FOR_INTERNAL_CALLS // For internal calls
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
 * Identifies if a wallet is a deposit wallet based on transaction patterns.
 * @param {string} walletAddress - The blockchain address to analyze.
 * @param {string} primaryTargetWallet - A known "main" wallet (e.g., an exchange's hot wallet) to check outgoing transactions against.
 * @param {string} chain - The blockchain chain (e.g., 'ethereum').
 * @param {boolean} enableGemini - Whether to enable Gemini AI analysis.
 * @returns {Promise<object>} An object containing the analysis result.
 */
export async function identifyDepositWallet(walletAddress, primaryTargetWallet, chain = 'ethereum', enableGemini = true) {
    if (!isAddress(walletAddress) || !isAddress(primaryTargetWallet)) {
        logger.error("Invalid wallet address or primary target wallet provided for identifyDepositWallet.");
        return null;
    }

    const lowerWalletAddress = walletAddress.toLowerCase();
    const lowerPrimaryTargetWallet = primaryTargetWallet.toLowerCase();

    logger.info(`Analyzing wallet ${lowerWalletAddress} on ${chain} for deposit characteristics (target: ${lowerPrimaryTargetWallet})...`);

    // IMPORTANT: Set forceRefresh to `false` to utilize the cache.
    // This is crucial for a fast user-facing API.
    const txData = await fetchBlockchainData(lowerWalletAddress, 'transactions', false, 500, chain);

    // Nametag lookup will utilize in-memory cache first, then Firestore.
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
            lastAnalysis: new Date().toISOString() // Ensure this is present for `saveWalletAnalysis`
        };
        await saveWalletAnalysis(result);
        return result;
    }

    const now = new Date();
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recentTxs7d = txData.filter(tx => new Date(tx.block_time) > last7Days);

    let confidenceScore = 0;
    let reasonParts = [];

    // Rule 1: High incoming transaction volume in 24h
    const incomingTxs24h = recentTxs7d.filter(tx =>
        tx.to.toLowerCase() === lowerWalletAddress && new Date(tx.block_time) > last24Hours
    );
    if (incomingTxs24h.length > 50) {
        confidenceScore += 20;
        reasonParts.push("High incoming transaction volume in 24h.");
    } else {
        reasonParts.push(`Low incoming transaction volume in 24h (${incomingTxs24h.length} txs).`);
    }

    // Rule 2: Few unique senders (suggests a limited set of sources, e.g., other exchange hot wallets)
    const uniqueSendersToWallet = new Set(incomingTxs24h.map(tx => tx.from.toLowerCase())).size;
    if (uniqueSendersToWallet > 0 && uniqueSendersToWallet < 20) { // Adjusted threshold for 'few'
        confidenceScore += 20;
        reasonParts.push(`Few unique senders (${uniqueSendersToWallet}) to this wallet in 24h.`);
    } else if (uniqueSendersToWallet === 0) {
        reasonParts.push("No incoming transactions in 24h to check unique senders.");
    } else {
        reasonParts.push(`Many unique senders (${uniqueSendersToWallet}) to this wallet in 24h.`);
    }

    // Rule 3: Significant portion of outgoing transactions sent back to the primary target wallet
    const outgoingToPrimaryTarget = recentTxs7d.filter(tx =>
        tx.from.toLowerCase() === lowerWalletAddress && tx.to.toLowerCase() === lowerPrimaryTargetWallet
    );
    const totalOutgoingTxs = recentTxs7d.filter(tx => tx.from.toLowerCase() === lowerWalletAddress).length;

    if (totalOutgoingTxs > 0 && outgoingToPrimaryTarget.length / totalOutgoingTxs >= 0.5) {
        confidenceScore += 30;
        reasonParts.push(`Significant portion of outgoing transactions sent back to target wallet ${lowerPrimaryTargetWallet}.`);
    } else if (outgoingToPrimaryTarget.length > 0) {
        confidenceScore += 15;
        reasonParts.push(`Some outgoing transactions sent back to target wallet ${lowerPrimaryTargetWallet}.`);
    } else {
        reasonParts.push(`No outgoing transactions sent back to target wallet ${lowerPrimaryTargetWallet}.`);
    }

    // Rule 4: Absence of complex incoming smart contract interactions (simple deposits)
    const hasComplexIncomingInteraction = recentTxs7d.some(tx =>
        tx.to.toLowerCase() === lowerWalletAddress && tx.input !== '0x' && tx.input.length > 2
    );
    if (!hasComplexIncomingInteraction) {
        confidenceScore += 15;
        reasonParts.push("No complex incoming smart contract interactions.");
    } else {
        reasonParts.push("Has complex incoming smart contract interactions.");
    }

    // Rule 5: Sends to very few unique outgoing destinations, typically just the primary target
    const nonContractOutgoingTxs7d = recentTxs7d.filter(tx => tx.from.toLowerCase() === lowerWalletAddress);
    const uniqueOutgoingDestinations = new Set(nonContractOutgoingTxs7d.map(tx => tx.to.toLowerCase())).size;

    if (uniqueOutgoingDestinations === 1 && nonContractOutgoingTxs7d[0]?.to.toLowerCase() === lowerPrimaryTargetWallet) {
        confidenceScore += 15;
        reasonParts.push("Sends exclusively to the primary target wallet.");
    } else if (uniqueOutgoingDestinations >= 1 && uniqueOutgoingDestinations <= 3) {
        confidenceScore += 5;
        reasonParts.push(`Sends to few unique destinations (${uniqueOutgoingDestinations}).`);
    } else {
        reasonParts.push(`Sends to many unique destinations (${uniqueOutgoingDestinations}).`);
    }

    const finalReason = reasonParts.join(" ");
    confidenceScore = Math.min(confidenceScore, 100); // Cap confidence at 100%
    const isDeposit = confidenceScore >= DEPOSIT_WALLET_CONFIDENCE_THRESHOLD;

    let geminiAnalysis = "Gemini analysis skipped.";
    // Only call Gemini if explicitly enabled AND it's a potential deposit wallet OR it's an unknown nametag.
    if (enableGemini && (isDeposit || (nametag === 'Unknown'))) { // Change here: run Gemini for unknowns as well
        geminiAnalysis = await fetchGeminiAnalysis(lowerWalletAddress, txData, confidenceScore);
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
        lastAnalysis: new Date().toISOString() // Ensure this is saved
    };
    await saveWalletAnalysis(result);

    // Auto-tagging logic
    if (isDeposit && nametag === 'Unknown') { // Only tag if confidently a deposit wallet and currently unknown
        const newNametagValue = `Auto-detected Deposit Wallet (Conf: ${confidenceScore.toFixed(0)}%)`;
        await addNametag(lowerWalletAddress, {
            'auto_tag': { // Use a specific key for auto-tags
                'Name Tag': newNametagValue,
                'Description': 'Automatically detected as a deposit wallet based on transaction patterns.',
                'Subcategory': 'Exchange/Service',
                'image': '/icons/default.png'
            }
        });
        result.nametag = newNametagValue; // Update result with new nametag
    }

    return result;
}

// --- NEXT.JS API ROUTE HANDLER ---
export default async function handler(req, res) {
    // Always check session and admin privileges first
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
        logger.warn('Unauthorized access attempt to analyze-wallets API (no session)');
        return res.status(401).json({ detail: 'Unauthorized: Please log in.' });
    }

    const isAdminUser = await checkAdminStatus(session.user.id);
    if (!isAdminUser) {
        logger.warn(`Forbidden access attempt to analyze-wallets API by non-admin user: ${session.user.id}`);
        return res.status(403).json({ detail: 'Forbidden: Admin access required.' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ detail: 'Method not allowed. Only POST is supported.' });
    }

    const { action, wallet_address, chain = 'ethereum' } = req.body; // Removed scan_source_address as fetch-periodic is removed

    try {
        if (action === 'identify') {
            if (!wallet_address) {
                return res.status(400).json({ error: "Wallet address is required for 'identify' action." });
            }
            // For 'identify', if no primary target is provided, assume the wallet itself is the target
            // This might happen if you are just analyzing an arbitrary wallet.
            const primaryTarget = wallet_address; 
            const result = await identifyDepositWallet(wallet_address, primaryTarget, chain, true);
            return res.status(200).json(result);
        } else if (action === 'detect-large-flow') { // New action for direct large flow detection
            if (!wallet_address) {
                return res.status(400).json({ error: "Wallet address is required for 'detect-large-flow' action." });
            }
            logger.info(`Detecting large flows for ${wallet_address} via API.`);
            const largeFlowResult = await detectLargeFlow(
                wallet_address,
                chain,
                LARGE_VALUE_THRESHOLD_USD // Use the defined threshold
            );

            if (largeFlowResult && largeFlowResult.large_flows && largeFlowResult.large_flows.length > 0) {
                await saveLargeFlow({
                    source_wallet_scanned: wallet_address,
                    large_flows: largeFlowResult.large_flows
                });
                logger.info(`Saved ${largeFlowResult.large_flows.length} large flows for ${wallet_address}.`);
            } else {
                logger.info(`No large flows detected for ${wallet_address}.`);
            }
            return res.status(200).json(largeFlowResult);

        } else {
            // Remove 'fetch-periodic' action as it's too heavy for a direct API call.
            return res.status(400).json({ error: "Invalid action. Supported actions: 'identify', 'detect-large-flow'." });
        }
    } catch (error) {
        logger.error(`Error in analyze-wallets API for action '${action}': ${error.message}`, error.stack);
        return res.status(500).json({ error: `An error occurred: ${error.message}` });
    }
}