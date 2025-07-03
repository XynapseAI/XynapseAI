// pages/api/cron/daily-analysis.js
import { detectLargeFlow } from '../../../lib/detectLargeFlow';
import { saveWalletAnalysis, saveLargeFlow, getAnalyzedWalletsWithTimestamps } from '../../../lib/analysisStorage'; // Đảm bảo import getAnalyzedWalletsWithTimestamps
import { getHighVolumeWallets } from '../../../lib/analysisStorage'; // Nếu bạn dùng nó để lấy nguồn ví
import { logger } from '../../../utils/logger';

// --- CONFIGURATION ---
const WALLETS_PER_CRON_RUN = 20; // Số lượng ví tối đa xử lý trong MỘT lần chạy Cron Job
const REANALYSIS_THRESHOLD_HOURS = 24; // Phân tích lại ví nếu lần cuối cùng đã quá X giờ
const LARGE_VALUE_THRESHOLD_USD = 1000000; // Ngưỡng USD cho giao dịch lớn

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, detail: 'Method Not Allowed' });
    }

    if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
        logger.warn('Unauthorized access attempt to daily-analysis cron API (bad secret)');
        return res.status(401).json({ success: false, detail: 'Unauthorized: Invalid secret.' });
    }

    logger.info('Starting scheduled wallet analysis triggered by cron job.');
    const startTime = process.hrtime.bigint(); // Để đo thời gian thực thi

    try {
        const analyzedWalletsMap = await getAnalyzedWalletsWithTimestamps();
        // Lấy tất cả các ví tiềm năng từ nguồn của bạn (ví dụ: high-volume, hoặc danh sách cố định)
        const potentialWallets = await getHighVolumeWallets('ethereum'); // Giả định hàm này không quá chậm

        const walletsNeedingAnalysis = [];
        const now = new Date();
        const reanalysisThresholdMs = REANALYSIS_THRESHOLD_HOURS * 60 * 60 * 1000;

        for (const wallet of potentialWallets) {
            const lastAnalysisTimeStr = analyzedWalletsMap[wallet];
            let shouldReanalyze = false;

            if (!lastAnalysisTimeStr) {
                // Ví chưa bao giờ được phân tích
                shouldReanalyze = true;
            } else {
                try {
                    const lastAnalysisDate = new Date(lastAnalysisTimeStr);
                    if (now.getTime() - lastAnalysisDate.getTime() > reanalysisThresholdMs) {
                        shouldReanalyze = true; // Quá thời gian threshold, cần phân tích lại
                    }
                } catch (error) { // 'error' is caught here
                    // Make sure you actually use `error.message` or `error` itself
                    logger.warn(`Invalid timestamp for wallet ${wallet}: ${lastAnalysisTimeStr}. Reanalyzing. Error: ${error.message}`);
                    shouldReanalyze = true; 
                }
            }

            if (shouldReanalyze) {
                walletsNeedingAnalysis.push(wallet);
                // Giới hạn số lượng ví để xử lý trong một lần chạy
                if (walletsNeedingAnalysis.length >= WALLETS_PER_CRON_RUN) {
                    break; // Đủ số lượng ví cho lần chạy này
                }
            }
        }

        if (walletsNeedingAnalysis.length === 0) {
            logger.info('No wallets require analysis for this cron run.');
            const endTime = process.hrtime.bigint();
            logger.info(`Cron job finished in ${(Number(endTime - startTime) / 1_000_000).toFixed(2)} ms.`);
            return res.status(200).json({ success: true, detail: 'No wallets to analyze.' });
        }

        logger.info(`Starting analysis for ${walletsNeedingAnalysis.length} wallets in this run.`);
        let analyzedCount = 0;

        for (const walletAddress of walletsNeedingAnalysis) {
            const currentExecutionTime = Number(process.hrtime.bigint() - startTime) / 1_000_000_000; // Thời gian đã trôi qua (giây)
            if (currentExecutionTime > 9) { // Còn dưới 1 giây để hoàn thành và trả về, đảm bảo không timeout
                logger.warn(`Approaching timeout (current: ${currentExecutionTime.toFixed(2)}s). Stopping analysis for remaining wallets.`);
                break; // Dừng nếu gần hết thời gian
            }

            logger.info(`Analyzing wallet: ${walletAddress}`);
            try {
                const largeFlowsResult = await detectLargeFlow(walletAddress, 'ethereum', LARGE_VALUE_THRESHOLD_USD);

                if (largeFlowsResult.large_flows && largeFlowsResult.large_flows.length > 0) {
                    await saveLargeFlow({ source_wallet_scanned: walletAddress, large_flows: largeFlowsResult.large_flows });
                    logger.info(`Saved ${largeFlowsResult.large_flows.length} large flows for ${walletAddress}.`);
                } else {
                    logger.info(`No large flows detected for ${walletAddress}.`);
                }

                const analysisSummary = {
                    wallet: walletAddress,
                    chain: 'ethereum',
                    status: 'completed',
                    numLargeFlows: largeFlowsResult.large_flows.length,
                    lastAnalysis: new Date().toISOString() // Cập nhật timestamp phân tích cuối cùng
                };
                await saveWalletAnalysis(analysisSummary);
                analyzedCount++;
                logger.info(`Saved wallet analysis summary for ${walletAddress}.`);

                // Có thể thêm độ trễ nhỏ Ở ĐÂY nếu bạn sợ rate limit TỪ CÁC API BÊN NGOÀI
                // nhưng hãy cân nhắc kỹ vì nó ăn vào 10s timeout
                // await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay per wallet
            } catch (walletAnalysisError) {
                logger.error(`Error analyzing wallet ${walletAddress}: ${walletAnalysisError.message}`);
                // Có thể lưu trạng thái lỗi vào Firestore nếu muốn theo dõi
            }
        }

        const endTime = process.hrtime.bigint();
        logger.info(`Cron job completed for ${analyzedCount} wallets in ${(Number(endTime - startTime) / 1_000_000).toFixed(2)} ms.`);
        return res.status(200).json({ success: true, detail: `Analysis completed for ${analyzedCount} wallets.` });

    } catch (error) {
        logger.error(`Overall error during scheduled wallet analysis: ${error.message}`);
        const endTime = process.hrtime.bigint();
        logger.error(`Cron job failed after ${(Number(endTime - startTime) / 1_000_000).toFixed(2)} ms.`);
        return res.status(500).json({ success: false, detail: 'Internal Server Error during cron analysis', error: error.message });
    }
}