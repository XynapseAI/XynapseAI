// pages/api/cron/daily-analysis.js

import { getHighVolumeWallets, saveLargeFlow } from '../../../lib/analysisStorage';
import { detectLargeFlow }  from '../../../lib/detectLargeFlow';
import { identifyDepositWallet } from '../analyze-wallets';
import { logger } from '../../../utils/logger';
import axios from 'axios';

const WALLETS_PER_CRON_RUN_LIMIT = 5;
const LARGE_VALUE_THRESHOLD_USD = 1000000;
const MAX_V2_WALLETS_TO_ANALYZE_PER_RUN = 10;

async function getEthPriceUsd() {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        if (response.data && response.data.ethereum && response.data.ethereum.usd) {
            logger.info(`Fetched current ETH price: $${response.data.ethereum.usd}`);
            return response.data.ethereum.usd;
        }
    } catch (error) {
        logger.error(`Error fetching ETH price from CoinGecko: ${error.message}. Using fallback price.`);
    }
    return 2000;
}

export default async function handler(req, res) {
    // Chỉ giữ lại kiểm tra INTERNAL_API_TOKEN
    // Bỏ qua logic Vercel Cron Secret vì bạn sẽ không dùng Vercel nữa
    if (req.headers['x-internal-token'] !== process.env.INTERNAL_API_TOKEN) {
        logger.warn('Unauthorized access attempt to daily-analysis cron job: Invalid Internal API Token');
        return res.status(401).json({ detail: 'Unauthorized: Invalid Internal API Token' });
    }

    try {
        const chain = 'ethereum';
        const currentEthPriceUsd = await getEthPriceUsd();

        logger.info("daily-analysis: Bắt đầu xác định high-volume wallets (Ví 1).");
        const highVolumeWallets = await getHighVolumeWallets(
            chain,
            200, // sampleLimit
            100, // activityCheckTxLimit
            50,  // recentActivityThreshold
            500, // apiDelayMs
            WALLETS_PER_CRON_RUN_LIMIT
        );
        logger.info(`daily-analysis: Đã xác định ${highVolumeWallets.length} Ví 1 wallets.`);

        const allAnalysisResults = [];
        let analyzedV2Count = 0;

        for (const wallet1 of highVolumeWallets) {
            logger.info(`daily-analysis: Bắt đầu phân tích cho Ví 1: ${wallet1}`);

            const largeFlowResult = await detectLargeFlow(
                wallet1,
                chain,
                LARGE_VALUE_THRESHOLD_USD,
                500, // txLimit
                currentEthPriceUsd
            );

            if (largeFlowResult.large_flows.length > 0) {
                await saveLargeFlow({
                    source_wallet_scanned: wallet1,
                    large_flows: largeFlowResult.large_flows,
                });
                logger.info(`daily-analysis: Đã lưu ${largeFlowResult.large_flows.length} large flows cho Ví 1: ${wallet1}`);

                for (const flow of largeFlowResult.large_flows) {
                    if (analyzedV2Count >= MAX_V2_WALLETS_TO_ANALYZE_PER_RUN) {
                        logger.info(`daily-analysis: Đã đạt giới hạn Ví 2 wallets cho lần chạy này (${MAX_V2_WALLETS_TO_ANALYZE_PER_RUN}). Bỏ qua phân tích Ví 2 thêm.`);
                        break;
                    }

                    const potentialV2Wallet = flow.from;
                    logger.info(`daily-analysis: Đang phân tích Ví 2 tiềm năng: ${potentialV2Wallet} (gửi đến Ví 1: ${wallet1})`);
                    const depositResultForV2 = await identifyDepositWallet(
                        potentialV2Wallet,
                        wallet1,
                        chain,
                        true,
                        currentEthPriceUsd
                    );

                    allAnalysisResults.push({
                        ví1_address: wallet1,
                        large_flow_tx: flow.tx_hash,
                        potential_ví2_address: potentialV2Wallet,
                        ví2_analysis_result: depositResultForV2
                    });
                    analyzedV2Count++;
                }
            } else {
                logger.info(`daily-analysis: Không phát hiện large flows cho Ví 1: ${wallet1}. Bỏ qua phân tích Ví 2 cho ví này.`);
            }

            if (largeFlowResult.large_flows.length > 0 && analyzedV2Count >= MAX_V2_WALLETS_TO_ANALYZE_PER_RUN) {
                logger.info(`daily-analysis: Đã đạt giới hạn Ví 2 tổng thể, dừng vòng lặp Ví 1.`);
                break;
            }
        }

        logger.info(`daily-analysis: Cron job hoàn tất. Đã phân tích ${highVolumeWallets.length} Ví 1 wallets và ${analyzedV2Count} Ví 2 wallets tiềm năng.`);
        return res.status(200).json({ success: true, results: allAnalysisResults });
    } catch (error) {
        logger.error(`Error in daily-analysis cron job: ${error.message}`, { stack: error.stack });
        return res.status(500).json({ error: `Cron job failed: ${error.message}` });
    }
}