// lib/analysisStorage.js
import { db } from '../utils/firebaseAdmin.js'; // Import Firestore instance
import { loadAllNametags, getNametag } from './nametags.js'; // eslint-disable-line @typescript-eslint/no-unused-vars
import { fetchBlockchainData } from './blockchainData.js'; // Import fetchBlockchainData
import pkg from '../utils/logger.cjs';

const { logger } = pkg;
const WALLET_ANALYSIS_COLLECTION = 'wallet_analysis';
const LARGE_FLOWS_COLLECTION = 'large_flows';
const NAMETAGS_COLLECTION = 'nametags'; // Used for getHighVolumeWallets

/**
 * Saves or updates a wallet's analysis summary in Firestore.
 * @param {object} analysisData - The analysis data for a wallet.
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
        }
    }
}

export async function saveWalletAnalysis(analysisData) {
    if (!analysisData || !analysisData.wallet) {
        logger.error('Invalid analysisData provided to saveWalletAnalysis');
        return;
    }
    const walletAddress = analysisData.wallet.toLowerCase();
    await withRetry(async () => {
        await db.collection(WALLET_ANALYSIS_COLLECTION).doc(walletAddress).set({
            ...analysisData,
            lastAnalysis: new Date().toISOString()
        }, { merge: true });
        logger.info(`Successfully saved analysis for ${walletAddress} to Firestore.`);
    }).catch(e => {
        logger.error(`Error saving analysis for ${walletAddress} to Firestore after retries: ${e.message}`, { stack: e.stack });
    });
}

/**
 * Saves large flow transaction details to Firestore.
 * @param {object} largeFlowData - Contains source wallet and an array of large flows.
 */
export async function saveLargeFlow(largeFlowData) {
    if (!largeFlowData || !Array.isArray(largeFlowData.large_flows)) {
        logger.warn('Invalid or empty largeFlowData provided to saveLargeFlow');
        return;
    }
    try {
        if (largeFlowData.large_flows.length > 0) {
            let batch = db.batch();
            let flowCount = 0;
            for (const flow of largeFlowData.large_flows) {
                if (!flow.tx_hash) {
                    logger.warn(`Skipping flow with missing tx_hash for wallet ${largeFlowData.source_wallet_scanned}`);
                    continue;
                }
                const flowToSave = {
                    source_wallet_scanned: largeFlowData.source_wallet_scanned || 'N/A',
                    from: flow.from,
                    to: flow.to,
                    value_usd: flow.value_usd,
                    tx_hash: flow.tx_hash,
                    block_time: flow.block_time,
                    from_nametag: flow.from_nametag || 'Unknown',
                    to_nametag: flow.to_nametag || 'Unknown',
                    timestamp_recorded: new Date().toISOString()
                };
                batch.set(db.collection(LARGE_FLOWS_COLLECTION).doc(), flowToSave);
                flowCount++;
                if (flowCount % 499 === 0) {
                    await withRetry(() => batch.commit());
                    logger.info(`Committed a batch of ${flowCount} large flows.`);
                    batch = db.batch();
                }
            }
            if (flowCount > 0) {
                await withRetry(() => batch.commit());
                logger.info(`Successfully saved ${flowCount} large flows to Firestore.`);
            } else {
                logger.info("No valid large flows to save in the provided data.");
            }
        } else {
            logger.info("No large flows to save in the provided data.");
        }
    } catch (e) {
        logger.error(`Error saving large flow data to Firestore: ${e.message}`, { stack: e.stack });
    }
}

/**
 * Fetches analyzed wallets with their last analysis timestamps from Firestore.
 * @returns {Promise<object>} An object mapping wallet addresses to their last analysis timestamp (ISO string).
 */
export async function getAnalyzedWalletsWithTimestamps() {
    try {
        const snapshot = await db.collection(WALLET_ANALYSIS_COLLECTION).get();
        const walletsData = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.wallet && data.lastAnalysis) {
                walletsData[data.wallet.toLowerCase()] = data.lastAnalysis;
            }
        });
        logger.info(`Fetched ${Object.keys(walletsData).length} analyzed wallet timestamps from Firestore.`);
        return walletsData;
    } catch (e) {
        logger.error(`Error fetching analyzed wallets with timestamps from Firestore: ${e.message}`);
        return {};
    }
}

/**
 * Identifies high-volume wallet candidates by checking recent activity.
 * This function is potentially time-consuming.
 * @param {string} chain - The blockchain chain (e.g., 'ethereum').
 * @param {number} sampleLimit - Max number of nametagged wallets to sample for activity check.
 * @param {number} activityCheckTxLimit - Number of latest transactions to fetch for activity check.
 * @param {number} recentActivityThreshold - Minimum number of recent transactions to consider high volume.
 * @param {number} apiDelayMs - Delay between API calls (in ms) to avoid rate limits.
 * @param {number} cronRunLimit - Maximum number of high-volume wallets to return for a single cron run.
 * @returns {Promise<string[]>} An array of high-volume wallet addresses.
 */
export async function getHighVolumeWallets(chain = 'ethereum', sampleLimit = 200, activityCheckTxLimit = 100, recentActivityThreshold = 50, apiDelayMs = 500, cronRunLimit) {
    logger.info(`Attempting to identify high-volume wallet candidates from nametags (sampling up to ${sampleLimit})...`);

    let allKnownWallets = [];
    try {
        const snapshot = await db.collection(NAMETAGS_COLLECTION).select('Labels').get(); // Only fetch Labels
        snapshot.forEach(doc => allKnownWallets.push(doc.id.toLowerCase()));
        logger.info(`Loaded ${allKnownWallets.length} nametagged addresses for high-volume check.`);
    } catch (e) {
        logger.error(`Error fetching all nametagged wallets for high-volume check: ${e.message}`);
        return [];
    }

    if (allKnownWallets.length === 0) {
        logger.info("No nametags found in Firestore to identify high-volume wallets.");
        return [];
    }

    const walletsToProcess = [...allKnownWallets]
        .sort(() => 0.5 - Math.random()) // Shuffle for random sample
        .slice(0, Math.min(sampleLimit, allKnownWallets.length)); // Take a limited sample

    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const highVolumeWallets = [];
    for (const wallet of walletsToProcess) {
        if (cronRunLimit && highVolumeWallets.length >= cronRunLimit) { // Check against cronRunLimit if provided
            logger.info(`Reached limit of high-volume wallets for this run (${cronRunLimit}). Stopping further checks.`);
            break;
        }

        const txData = await fetchBlockchainData(wallet, 'transactions', false, activityCheckTxLimit, chain);

        if (Array.isArray(txData) && txData.length > 0) {
            const recentTxsActivity = txData.filter(tx => {
                try {
                    return new Date(tx.block_time) > last24Hours;
                } catch {
                    logger.warn(`Invalid block_time for tx in wallet ${wallet}: ${tx.block_time}. Skipping transaction.`);
                    return false;
                }
            });

            if (recentTxsActivity.length > recentActivityThreshold) {
                highVolumeWallets.push(wallet);
            }
        }
        await new Promise(resolve => setTimeout(resolve, apiDelayMs));
    }

    logger.info(`Identified ${highVolumeWallets.length} high-volume wallets from the sample.`);
    return highVolumeWallets;
}