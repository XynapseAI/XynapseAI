import { query } from '../utils/postgres.js'; // Import PostgreSQL query function
import pkg from '../utils/logger.cjs';

const { logger } = pkg;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

/**
 * Saves or updates a wallet's analysis summary in PostgreSQL.
 * @param {object} analysisData - The analysis data for a wallet.
 */
// export async function saveWalletAnalysis(analysisData) {
//     if (!analysisData || !analysisData.wallet) {
//         logger.error('Invalid analysisData provided to saveWalletAnalysis');
//         return;
//     }
//     const walletAddress = analysisData.wallet.toLowerCase();
//     await withRetry(async () => {
//         await query(
//             `INSERT INTO wallet_analysis (wallet, is_deposit, deposit_confidence_percentage, nametag, image, reason, metrics, gemini_analysis, last_analysis)
//              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
//              ON CONFLICT (wallet) DO UPDATE SET
//                is_deposit = EXCLUDED.is_deposit,
//                deposit_confidence_percentage = EXCLUDED.deposit_confidence_percentage,
//                nametag = EXCLUDED.nametag,
//                image = EXCLUDED.image,
//                reason = EXCLUDED.reason,
//                metrics = EXCLUDED.metrics,
//                gemini_analysis = EXCLUDED.gemini_analysis,
//                last_analysis = EXCLUDED.last_analysis`,
//             [
//                 walletAddress,
//                 analysisData.is_deposit,
//                 analysisData.deposit_confidence_percentage,
//                 analysisData.nametag,
//                 analysisData.image,
//                 analysisData.reason,
//                 analysisData.metrics,
//                 analysisData.gemini_analysis,
//                 new Date(analysisData.lastAnalysis)
//             ]
//         );
//         logger.info(`Successfully saved analysis for ${walletAddress} to PostgreSQL.`);
//     }).catch(e => {
//         logger.error(`Error saving analysis for ${walletAddress} to PostgreSQL after retries: ${e.message}`, { stack: e.stack });
//     });
// }

/**
 * Saves large flow transaction details to PostgreSQL.
 * @param {object} largeFlowData - Contains source wallet and an array of large flows.
 */
export async function saveLargeFlow(largeFlowData) {
    if (!largeFlowData || !Array.isArray(largeFlowData.large_flows)) {
        logger.warn('Invalid or empty largeFlowData provided to saveLargeFlow');
        return;
    }
    try {
        if (largeFlowData.large_flows.length > 0) {
            let flowCount = 0;
            for (const flow of largeFlowData.large_flows) {
                if (!flow.tx_hash) {
                    logger.warn(`Skipping flow with missing tx_hash for wallet ${largeFlowData.source_wallet_scanned}`);
                    continue;
                }
                await query(
                    `INSERT INTO large_flows (source_wallet_scanned, from_address, to_address, value_usd, tx_hash, block_time, from_nametag, to_nametag, timestamp_recorded)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    [
                        largeFlowData.source_wallet_scanned || 'N/A',
                        flow.from,
                        flow.to,
                        flow.value_usd,
                        flow.tx_hash,
                        new Date(flow.block_time),
                        flow.from_nametag || 'Unknown',
                        flow.to_nametag || 'Unknown',
                        new Date()
                    ]
                );
                flowCount++;
            }
            logger.info(`Successfully saved ${flowCount} large flows to PostgreSQL.`);
        } else {
            logger.info("No large flows to save in the provided data.");
        }
    } catch (e) {
        logger.error(`Error saving large flow data to PostgreSQL: ${e.message}`, { stack: e.stack });
    }
}

/**
 * Fetches analyzed wallets with their last analysis timestamps from PostgreSQL.
 * @returns {Promise<object>} An object mapping wallet addresses to their last analysis timestamp (ISO string).
 */
export async function getAnalyzedWalletsWithTimestamps() {
  try {
    const result = await query(
      `SELECT address, created_at FROM nametags` // Giả định bảng nametags có cột created_at
    );
    const walletsData = {};
    result.rows.forEach(row => {
      if (row.address && row.created_at) {
        walletsData[row.address.toLowerCase()] = row.created_at.toISOString();
      }
    });
    logger.info(`Fetched ${Object.keys(walletsData).length} analyzed wallet timestamps from nametags.`);
    return walletsData;
  } catch (e) {
    logger.error(`Error fetching analyzed wallets with timestamps from nametags: ${e.message}`);
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
        const result = await query(`SELECT address FROM nametags`);
        allKnownWallets = result.rows.map(row => row.address.toLowerCase());
        logger.info(`Loaded ${allKnownWallets.length} nametagged addresses for high-volume check.`);
    } catch (e) {
        logger.error(`Error fetching all nametagged wallets for high-volume check: ${e.message}`);
        return [];
    }

    if (allKnownWallets.length === 0) {
        logger.info("No nametags found in PostgreSQL to identify high-volume wallets.");
        return [];
    }

    const walletsToProcess = [...allKnownWallets]
        .sort(() => 0.5 - Math.random()) // Shuffle for random sample
        .slice(0, Math.min(sampleLimit, allKnownWallets.length)); // Take a limited sample

    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const highVolumeWallets = [];
    for (const wallet of walletsToProcess) {
        if (cronRunLimit && highVolumeWallets.length >= cronRunLimit) {
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