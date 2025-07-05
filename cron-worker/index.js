// cron-worker/index.js
import 'dotenv/config';
import { getHighVolumeWallets } from '../lib/analysisStorage.js';
import pkg from '../utils/logger.cjs';
import { db } from '../utils/firebaseAdmin.js'; 
import axios from 'axios';

const { logger } = pkg;
// This token needs to be secret and shared with Railway as an env var
const INTERNAL_CRON_TOKEN = process.env.INTERNAL_CRON_TOKEN; 
const ANALYZE_WALLETS_API_URL = process.env.NEXTAUTH_URL + '/api/analyze-wallets'; // Use Vercel app URL

async function runHighVolumeWalletAnalysis() {
    logger.info('Starting high-volume wallet analysis cron job...');
    try {
        // Fetch current ETH price for API calls (similar to analyze-wallets.js)
        let currentEthPriceUsd = 2000; // Default
        try {
            const priceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
            currentEthPriceUsd = priceResponse.data.ethereum.usd;
            logger.info(`Fetched current ETH price: $${currentEthPriceUsd} for cron job.`);
        } catch (priceError) {
            logger.warn(`Could not fetch ETH price for cron job: ${priceError.message}. Using default price: $${currentEthPriceUsd}`);
        }

        const highVolumeWallets = await getHighVolumeWallets(
            'ethereum', // chain
            800,          // sampleLimit
            100,          // activityCheckTxLimit
            50,           // recentActivityThreshold
            500,          // apiDelayMs
            400            // cronRunLimit - process a limited number per run
        );

        logger.info(`Triggering analysis for ${highVolumeWallets.length} high-volume wallets.`);
        for (const wallet of highVolumeWallets) {
            try {
                await axios.post(ANALYZE_WALLETS_API_URL, {
                    action: 'identify',
                    wallet_address: wallet,
                    chain: 'ethereum'
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Internal-Token': INTERNAL_CRON_TOKEN // Use a specific token for cron
                    },
                    timeout: 120000 // Allow more time for API call if needed
                });
                logger.info(`Triggered analysis for wallet: ${wallet}`);
            } catch (apiError) {
                logger.error(`Error triggering analysis for ${wallet}: ${apiError.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000)); // Small delay between calls
        }

        // You could also trigger large flow detection for some wallets here
        // Example: For each high-volume wallet, also detect large flows
        for (const wallet of highVolumeWallets) {
             try {
                await axios.post(ANALYZE_WALLETS_API_URL, {
                    action: 'detect-large-flow',
                    wallet_address: wallet,
                    chain: 'ethereum'
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Internal-Token': INTERNAL_CRON_TOKEN
                    },
                    timeout: 120000
                });
                logger.info(`Triggered large flow detection for wallet: ${wallet}`);
            } catch (apiError) {
                logger.error(`Error triggering large flow detection for ${wallet}: ${apiError.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000)); // Small delay
        }


        logger.info('High-volume wallet analysis cron job finished.');
    } catch (error) {
        logger.error(`Error in high-volume wallet analysis cron job: ${error.message}`, error.stack);
    }
}

// This is a simple way to run it immediately for testing,
// in production Railway will handle scheduling.
// If you want it to run indefinitely as a worker, you'd put it in a loop
// or use a dedicated cron scheduler like 'node-cron' within this file.
// For Railway's cron job feature, it will execute this file on a schedule.

// If running as a standalone worker/service that Railway keeps alive:
// setInterval(runHighVolumeWalletAnalysis, 6 * 60 * 60 * 1000); // Run every 6 hours

// If this file is executed as a one-off cron job by Railway:
runHighVolumeWalletAnalysis();