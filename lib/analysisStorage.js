// lib/analysisStorage.js
import { db } from '../utils/firebaseAdmin'; // Import Firestore instance
import { loadAllNametags, getNametag } from './nametags'; // eslint-disable-line @typescript-eslint/no-unused-vars
import { fetchBlockchainData } from './blockchainData'; // Import fetchBlockchainData
import { logger } from '../utils/logger'; // Using a logger for better insights

const WALLET_ANALYSIS_COLLECTION = 'wallet_analysis';
const LARGE_FLOWS_COLLECTION = 'large_flows';
const NAMETAGS_COLLECTION = 'nametags'; // Used for getHighVolumeWallets

/**
 * Saves or updates a wallet's analysis summary in Firestore.
 * @param {object} analysisData - The analysis data for a wallet.
 */
export async function saveWalletAnalysis(analysisData) {
    const walletAddress = analysisData.wallet.toLowerCase();
    try {
        await db.collection(WALLET_ANALYSIS_COLLECTION).doc(walletAddress).set({
            ...analysisData,
            lastAnalysis: new Date().toISOString() // Using 'lastAnalysis' for consistency with filtering logic
        }, { merge: true }); // Merge to update existing document
        logger.info(`Saved analysis for ${walletAddress} to Firestore.`);
    } catch (e) {
        logger.error(`Error saving analysis for ${walletAddress} to Firestore: ${e.message}`);
    }
}

/**
 * Saves large flow transaction details to Firestore.
 * @param {object} largeFlowData - Contains source wallet and an array of large flows.
 */
export async function saveLargeFlow(largeFlowData) {
    try {
        if (largeFlowData && Array.isArray(largeFlowData.large_flows) && largeFlowData.large_flows.length > 0) {
            const batch = db.batch(); // Use Firestore batch for efficiency
            let flowCount = 0;
            for (const flow of largeFlowData.large_flows) {
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
                // Ensure a unique ID for each large flow, or add if it's truly new
                // For simplicity, we'll just add. If you need to prevent duplicates,
                // you'd typically check by tx_hash or generate a deterministic ID.
                batch.set(db.collection(LARGE_FLOWS_COLLECTION).doc(), flowToSave);
                flowCount++;

                // Commit batch every 500 operations (Firestore limit)
                if (flowCount % 499 === 0) {
                    await batch.commit();
                    logger.info(`Committed a batch of ${flowCount} large flows.`);
                    // Create new batch for remaining operations
                    batch = db.batch();
                }
            }
            if (flowCount > 0) {
                await batch.commit(); // Commit any remaining operations
                logger.info(`Saved ${flowCount} large flows to Firestore.`);
            } else {
                 logger.info("No large flows to save in the provided data.");
            }
        } else {
            // Log if no large flows detected, but don't save an error doc every time
            // if it's just a case of no large flows being present.
            logger.info("No large flows detected or unexpected format for this scan cycle.");
            // If you still want to log an entry for "no large flows"
            // await db.collection(LARGE_FLOWS_COLLECTION).add({
            //     source_wallet_scanned: largeFlowData.source_wallet_scanned || 'N/A',
            //     error_info: "No large flows detected or unexpected format for this scan cycle.",
            //     timestamp_recorded: new Date().toISOString()
            // });
        }
    } catch (e) {
        logger.error(`Error saving large flow data to Firestore: ${e.message}`);
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
            // Ensure 'lastAnalysis' is the field storing the timestamp in saveWalletAnalysis
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
 * @returns {Promise<string[]>} An array of high-volume wallet addresses.
 */
export async function getHighVolumeWallets(chain = 'ethereum', sampleLimit = 200, activityCheckTxLimit = 100, recentActivityThreshold = 50, apiDelayMs = 500) {
    logger.info(`Attempting to identify high-volume wallet candidates from nametags (sampling up to ${sampleLimit})...`);

    // We assume nametags are already loaded into GLOBAL_NAMETAGS_CACHE or fetched on demand by getNametag.
    // Calling loadAllNametags() here would refetch everything which might be slow.
    // Instead, we'll get ALL wallet addresses from the nametags collection directly if the cache isn't available
    // or rely on a pre-computed list. For a cron job, a pre-defined list of potential targets might be better.

    // For this example, we'll fetch addresses from the 'nametags' collection directly,
    // as GLOBAL_NAMETAGS_CACHE might be empty on cold starts for getHighVolumeWallets itself.
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

    const highVolumeWallets = [];
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    for (const wallet of walletsToProcess) {
        // This is the most time-consuming part: fetching transactions for each sampled wallet.
        // Consider if this can be pre-calculated or done less frequently.
        const txData = await fetchBlockchainData(wallet, 'transactions', false, activityCheckTxLimit, chain);

        if (txData && txData.length > 0) {
            const recentTxsActivity = txData.filter(tx => new Date(tx.block_time) > last24Hours);

            if (recentTxsActivity.length > recentActivityThreshold) {
                highVolumeWallets.push(wallet);
            }
        }
        // Add a small delay to avoid overwhelming external APIs.
        // BE CAREFUL: This delay adds directly to the function's execution time!
        await new Promise(resolve => setTimeout(resolve, apiDelayMs));

        if (highVolumeWallets.length >= WALLETS_PER_CRON_RUN_LIMIT) { // Use the limit from the cron job config
            logger.info(`Reached limit of high-volume wallets for this run (${WALLETS_PER_CRON_RUN_LIMIT}). Stopping further checks.`);
            break;
        }
    }
    logger.info(`Identified ${highVolumeWallets.length} high-volume wallets from the sample.`);
    return highVolumeWallets;
}

// NOTE: This constant needs to be defined in pages/api/cron/daily-analysis.js or passed as a parameter.
// For now, it's commented out as it should come from the calling function.
// const WALLETS_PER_CRON_RUN_LIMIT = 5; // Placeholder, to be defined in the cron API route