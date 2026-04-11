import { query } from '../utils/postgres.js';
import { logger } from '../utils/serverLogger.js';
import { fetchBlockchainData } from './blockchainData.js';

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
 * LƯU VÀO BẢNG NAMETAGS (thay vì wallet_analysis)
 */
export async function saveWalletAnalysis(analysisData) {
    if (!analysisData || !analysisData.wallet) {
        logger.error('Invalid analysisData provided to saveWalletAnalysis');
        return;
    }

    const walletAddress = analysisData.wallet.toLowerCase();

    await withRetry(async () => {
        await query(
            `INSERT INTO nametags (address, nametag, image, description, subcategory)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (address) DO UPDATE SET
               nametag     = EXCLUDED.nametag,
               image       = EXCLUDED.image,
               description = EXCLUDED.description,
               subcategory = EXCLUDED.subcategory`,
            [
                walletAddress,
                analysisData.nametag || 'Unknown',
                analysisData.image || '/icons/default.png',
                // fallback cho description (có thể là reason hoặc gemini_analysis từ API)
                analysisData.description || analysisData.reason || analysisData.gemini_analysis || '',
                analysisData.subcategory || 'Others'
            ]
        );
        logger.info(`✅ Saved nametag for ${walletAddress} to table nametags`);
    }).catch(e => {
        logger.error(`Error saving nametag for ${walletAddress}: ${e.message}`, { stack: e.stack });
    });
}

/**
 * Giữ nguyên hàm save large flow (không thay đổi)
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
 * Cập nhật hàm get analyzed wallets để phù hợp với bảng nametags
 * (không có last_analysis nên dùng thời gian hiện tại)
 */
export async function getAnalyzedWalletsWithTimestamps() {
    try {
        const result = await query(`SELECT address FROM nametags`);
        const walletsData = {};
        const now = new Date().toISOString();

        result.rows.forEach(row => {
            if (row.address) {
                walletsData[row.address.toLowerCase()] = now;
            }
        });
        logger.info(`Fetched ${Object.keys(walletsData).length} nametagged addresses from PostgreSQL.`);
        return walletsData;
    } catch (e) {
        logger.error(`Error fetching nametags: ${e.message}`);
        return {};
    }
}

/**
 * Giữ nguyên hàm getHighVolumeWallets (đã dùng nametags)
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
        .sort(() => 0.5 - Math.random())
        .slice(0, Math.min(sampleLimit, allKnownWallets.length));

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