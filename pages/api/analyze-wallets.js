import { fetchBlockchainData } from '../../lib/blockchainData';
import { getNametag, addNametag } from '../../lib/nametags';
import { db } from '../../utils/firebaseAdmin';
import axios from 'axios';
import { isAddress } from 'ethers';
import { detectLargeFlow } from '../../lib/detectLargeFlow';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { logger } from '../../utils/logger';
import { getSecrets } from '../../lib/vault'; // Thêm import

const GEMINI_API_BASE_URL = process.env.NEXTAUTH_URL + '/api/gemini';
const DEFAULT_GEMINI_TIMEOUT_MS = 60000;
const LARGE_VALUE_THRESHOLD_USD = 1000000;
const DEPOSIT_WALLET_CONFIDENCE_THRESHOLD = 60;

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

async function saveWalletAnalysis(result) {
    try {
        await db.collection('wallet_analysis').doc(result.wallet.toLowerCase()).set({
            ...result,
            lastAnalysis: new Date().toISOString()
        }, { merge: true });
        logger.info(`Saved wallet analysis for ${result.wallet} to Firestore.`);
    } catch (error) {
        logger.error(`Error saving wallet analysis for ${result.wallet}: ${error.message}`);
        throw error;
    }
}

async function saveLargeFlow(largeFlowData) {
    try {
        if (largeFlowData.large_flows && Array.isArray(largeFlowData.large_flows)) {
            const batch = db.batch();
            largeFlowData.large_flows.forEach(flow => {
                const docRef = db.collection('large_flows').doc();
                batch.set(docRef, {
                    ...flow,
                    source_wallet_scanned: largeFlowData.source_wallet_scanned,
                    timestamp_recorded: new Date().toISOString()
                });
            });
            await batch.commit();
            logger.info(`Saved ${largeFlowData.large_flows.length} large flows for ${largeFlowData.source_wallet_scanned} to Firestore.`);
        } else {
            await db.collection('large_flows').add({
                source_wallet_scanned: largeFlowData.source_wallet_scanned || 'N/A',
                error_info: 'No large flows detected or unexpected format.',
                timestamp_recorded: new Date().toISOString()
            });
            logger.info(`Saved no large flows record for ${largeFlowData.source_wallet_scanned} to Firestore.`);
        }
    } catch (error) {
        logger.error(`Error saving large flow data for ${largeFlowData.source_wallet_scanned}: ${error.message}`);
        throw error;
    }
}

async function fetchGeminiAnalysis(walletAddress, txData, isDepositConfidence) {
    if (!txData || txData.length === 0) {
        return 'No transaction data available for Gemini analysis.';
    }

    const secrets = await getSecrets(); // Lấy bí mật từ Vault
    const INTERNAL_API_TOKEN = secrets.INTERNAL_API_TOKEN;
    const RECAPTCHA_TOKEN_FOR_INTERNAL_CALLS = secrets.RECAPTCHA_TOKEN_FOR_INTERNAL_CALLS;

    const totalTransactions = txData.length;
    const incomingTransactions = txData.filter(tx => tx.to.toLowerCase() === walletAddress.toLowerCase()).length;
    const outgoingTransactions = txData.filter(tx => tx.from.toLowerCase() === walletAddress.toLowerCase()).length;
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

async function identifyDepositWallet(walletAddress, primaryTargetWallet, chain = 'ethereum', enableGemini = true) {
    if (!isAddress(walletAddress) || !isAddress(primaryTargetWallet)) {
        logger.error("Invalid wallet address or primary target wallet provided for identifyDepositWallet.");
        return null;
    }

    const lowerWalletAddress = walletAddress.toLowerCase();
    const lowerPrimaryTargetWallet = primaryTargetWallet.toLowerCase();

    logger.info(`Analyzing wallet ${lowerWalletAddress} on ${chain} for deposit characteristics (target: ${lowerPrimaryTargetWallet})...`);

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
        await saveWalletAnalysis(result);
        return result;
    }

    const now = new Date();
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recentTxs7d = txData.filter(tx => new Date(tx.block_time) > last7Days);

    let confidenceScore = 0;
    let reasonParts = [];

    const incomingTxs24h = recentTxs7d.filter(tx =>
        tx.to.toLowerCase() === lowerWalletAddress && new Date(tx.block_time) > last24Hours
    );
    if (incomingTxs24h.length > 50) {
        confidenceScore += 20;
        reasonParts.push("High incoming transaction volume in 24h.");
    } else {
        reasonParts.push(`Low incoming transaction volume in 24h (${incomingTxs24h.length} txs).`);
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
    if (enableGemini && (isDeposit || (nametag && nametag !== 'Unknown'))) {
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
        lastAnalysis: new Date().toISOString()
    };
    await saveWalletAnalysis(result);

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
    const secrets = await getSecrets(); // Lấy bí mật từ Vault
    const INTERNAL_API_TOKEN = secrets.INTERNAL_API_TOKEN; // Gán từ Vault

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
        if (action === 'identify') {
            if (!wallet_address) {
                return res.status(400).json({ error: "Wallet address is required for 'identify' action." });
            }
            const primaryTarget = wallet_address;
            const result = await identifyDepositWallet(wallet_address, primaryTarget, chain, true);
            return res.status(200).json(result);
        } else if (action === 'detect-large-flow') {
            if (!wallet_address) {
                return res.status(400).json({ error: "Wallet address is required for 'detect-large-flow' action." });
            }
            logger.info(`Detecting large flows for ${wallet_address} via API.`);
            const largeFlowResult = await detectLargeFlow(
                wallet_address,
                chain,
                LARGE_VALUE_THRESHOLD_USD
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
            return res.status(400).json({ error: "Invalid action. Supported actions: 'identify', 'detect-large-flow'." });
        }
    } catch (error) {
        logger.error(`Error in analyze-wallets API for action '${action}': ${error.message}`, error.stack);
        return res.status(500).json({ error: `An error occurred: ${error.message}` });
    }
}