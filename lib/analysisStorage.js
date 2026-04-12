// lib/analysisStorage.js
import { query } from '../utils/postgres.js';
import { logger } from '../utils/serverLogger.js';
import { fetchBlockchainData } from './blockchainData.js';

async function withRetry(operation, maxAttempts = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (e) {
            if (attempt === maxAttempts) throw e;
            logger.warn(`Attempt ${attempt} failed: ${e.message}. Retrying after ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

/**
 * LẤY DANH SÁCH WALLET ĐÃ PHÂN TÍCH (từ bảng nametags)
 * Không còn dùng wallet_analysis nữa.
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
 * LẤY HIGH-VOLUME WALLETS TỪ BẢNG NAMETAGS
 * (đã được cập nhật hoàn toàn, không còn wallet_analysis)
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