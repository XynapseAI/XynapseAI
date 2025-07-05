// cron-worker/index.js
import 'dotenv/config';
import { getHighVolumeWallets } from '../lib/analysisStorage.js';
import pkg from '../utils/logger.cjs';
import { db } from '../utils/firebaseAdmin.js';
import axios from 'axios';

const { logger } = pkg;
const INTERNAL_CRON_TOKEN = process.env.INTERNAL_CRON_TOKEN;
const ANALYZE_WALLETS_API_URL = process.env.NEXTAUTH_URL + '/api/analyze-wallets';

async function runHighVolumeWalletAnalysis() {
  logger.info('Cron job started at: ' + new Date().toISOString());

  // Kiểm tra biến môi trường
  if (!INTERNAL_CRON_TOKEN || !ANALYZE_WALLETS_API_URL) {
    logger.error('Missing environment variables: INTERNAL_CRON_TOKEN or NEXTAUTH_URL');
    return;
  }

  try {
    // Bước 1: Lấy giá ETH
    logger.info('Fetching ETH price from CoinGecko...');
    let currentEthPriceUsd = 2000;
    try {
      const priceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      currentEthPriceUsd = priceResponse.data.ethereum.usd;
      logger.info(`Fetched ETH price: $${currentEthPriceUsd}`);
    } catch (priceError) {
      logger.warn(`Failed to fetch ETH price: ${priceError.message}. Using default: $${currentEthPriceUsd}`);
    }

    // Bước 2: Lấy ví high-volume
    logger.info('Fetching high-volume wallets...');
    const highVolumeWallets = await getHighVolumeWallets(
      'ethereum', 600, 100, 50, 1000, 300
    );
    logger.info(`Found ${highVolumeWallets.length} high-volume wallets`);

    // Bước 3: Phân tích ví deposit
    logger.info('Triggering wallet analysis...');
    for (const wallet of highVolumeWallets) {
      try {
        logger.info(`Sending identify request for wallet: ${wallet}`);
        await axios.post(ANALYZE_WALLETS_API_URL, {
          action: 'identify',
          wallet_address: wallet,
          chain: 'ethereum'
        }, {
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Token': INTERNAL_CRON_TOKEN
          },
          timeout: 120000
        });
        logger.info(`Successfully analyzed wallet: ${wallet}`);
      } catch (apiError) {
        logger.error(`Error analyzing wallet ${wallet}: ${apiError.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Bước 4: Phát hiện large flow
    logger.info('Triggering large flow detection...');
    for (const wallet of highVolumeWallets) {
      try {
        logger.info(`Sending detect-large-flow request for wallet: ${wallet}`);
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
        logger.info(`Successfully detected large flows for wallet: ${wallet}`);
      } catch (apiError) {
        logger.error(`Error detecting large flows for ${wallet}: ${apiError.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.info('Cron job finished at: ' + new Date().toISOString());
  } catch (error) {
    logger.error(`Cron job failed: ${error.message}`, error.stack);
  }
}

runHighVolumeWalletAnalysis();