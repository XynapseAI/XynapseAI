// lib/detectLargeFlow.js
import { logger } from '../utils/serverLogger.js';
import { fetchBlockchainData } from './blockchainData.js';

const DEFAULT_ETH_PRICE_USD = 2000;

export async function detectLargeFlow(walletAddress, chain = 'ethereum', thresholdUsd = 1000000, txLimit = 500, ethPriceUsd = DEFAULT_ETH_PRICE_USD) {
    logger.info(`Detecting large flows for ${walletAddress} on ${chain} with threshold $${thresholdUsd} using ETH price $${ethPriceUsd}...`);
    const txData = await fetchBlockchainData(walletAddress, 'transactions', false, txLimit, chain);
    
    if (!txData || txData.length === 0) {
        logger.info(`No transactions found for ${walletAddress}.`);
        return { wallet: walletAddress, large_flows: [] };
    }

    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentTxs = txData.filter(tx => {
        try {
            return new Date(tx.block_time) >= last24Hours;
        } catch {
            logger.warn(`Invalid block_time for tx in wallet ${walletAddress}: ${tx.block_time}. Skipping.`);
            return false;
        }
    });

    const largeFlows = [];
    for (const tx of recentTxs) {
        try {
            const valueEth = parseInt(String(tx.value), 16) / 1e18;
            const valueUsd = valueEth * ethPriceUsd;
            if (valueUsd >= thresholdUsd) {
                largeFlows.push({
                    tx_hash: tx.hash,
                    from: tx.from,
                    to: tx.to,
                    value_wei: tx.value,
                    value_eth: valueEth.toFixed(6),
                    value_usd: valueUsd.toFixed(2),
                    block_time: tx.block_time,
                    eth_price_usd: ethPriceUsd
                });
            }
        } catch (e) {
            logger.warn(`Error processing transaction ${tx.hash} for ${walletAddress}: ${e.message}. Skipping.`);
        }
    }

    logger.info(`Detected ${largeFlows.length} large flows for ${walletAddress} within last 24 hours.`);
    return {
        wallet: walletAddress,
        large_flows: largeFlows
    };
}