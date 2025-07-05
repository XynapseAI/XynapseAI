// lib/detectLargeFlow.js
import { fetchBlockchainData } from './blockchainData';
import { getNametag } from './nametags';
import { logger } from '../utils/logger'; // Using a logger for better insights

/**
 * Detects large value transactions for a given wallet address within the last 24 hours.
 *
 * @param {string} walletAddress The blockchain address to analyze.
 * @param {string} chain The blockchain chain (e.g., 'ethereum').
 * @param {number} largeValueThreshold The USD value threshold for a transaction to be considered 'large'.
 * @param {number} txLimit - The number of transactions to fetch for analysis.
 * @param {number} ethPriceUsd - The current price of Ethereum in USD.
 * @returns {Promise<object>} An object containing the wallet address and a list of detected large flows.
 */
export async function detectLargeFlow(walletAddress, chain = 'ethereum', largeValueThreshold = 1000000, txLimit = 500, ethPriceUsd = 2000) {
    logger.info(`Detecting large flows for ${walletAddress} on ${chain} with threshold $${largeValueThreshold}...`);

    const txData = await fetchBlockchainData(walletAddress, 'transactions', false, txLimit, chain);

    if (!txData || txData.length === 0) {
        logger.info(`No transactions found for ${walletAddress} to detect large flows.`);
        return { wallet: walletAddress, large_flows: [], error: "No transactions found" };
    }

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago in milliseconds

    const largeFlowsFound = [];

    for (const tx of txData) {
        let txTime;
        try {
            txTime = new Date(tx.block_time);
        } catch {
            logger.warn(`Invalid block_time for tx ${tx.hash}: ${tx.block_time}. Skipping.`);
            continue;
        }

        let valueUsd = 0;
        try {
            const valueWei = BigInt(String(tx.value));
            valueUsd = Number(valueWei) / 1e18 * ethPriceUsd; // Use dynamic ethPriceUsd
        } catch (e) {
            logger.warn(`Error converting transaction value ${tx.value} to USD for hash ${tx.hash}: ${e.message}. Defaulting to 0.`);
            continue;
        }

        if (txTime > last24h && valueUsd >= largeValueThreshold) {
            const fromNametag = await getNametag(tx.from);
            const toNametag = await getNametag(tx.to);

            largeFlowsFound.push({
                from: tx.from,
                to: tx.to,
                value_usd: valueUsd,
                tx_hash: tx.hash,
                block_time: tx.block_time,
                from_nametag: fromNametag,
                to_nametag: toNametag,
            });
        }
    }

    logger.info(`Detected ${largeFlowsFound.length} large flows for ${walletAddress}.`);
    return { wallet: walletAddress, large_flows: largeFlowsFound };
}