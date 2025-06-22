// scripts/update-leaderboard-flags.js
require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');
const winston = require('winston');

const prisma = new PrismaClient();

// Logger setup (nhất quán với wallet-history.js)
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

// Thời gian lưu trữ bản ghi WalletHistory (mặc định 30 ngày)
const WALLET_HISTORY_RETENTION_DAYS = parseInt(process.env.WALLET_HISTORY_RETENTION_DAYS) || 30;
const WALLET_HISTORY_DELETE_BATCH_SIZE = parseInt(process.env.WALLET_HISTORY_DELETE_BATCH_SIZE) || 1000;

// Hàm xóa bản ghi WalletHistory cũ
async function cleanOldWalletHistory() {
  try {
    const retentionDate = new Date(Date.now() - WALLET_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    logger.info(`Cleaning WalletHistory records older than ${retentionDate.toISOString()}`);

    let deletedCount = 0;
    let hasMore = true;

    while (hasMore) {
      const records = await prisma.walletHistory.findMany({
        where: {
          createdAt: { lt: retentionDate },
        },
        take: WALLET_HISTORY_DELETE_BATCH_SIZE,
        select: { id: true },
      });

      if (records.length === 0) {
        hasMore = false;
        break;
      }

      const deleteResult = await prisma.walletHistory.deleteMany({
        where: {
          id: { in: records.map((r) => r.id) },
        },
      });

      deletedCount += deleteResult.count;
      logger.info(`Deleted ${deleteResult.count} WalletHistory records in batch`);

      // Tránh vòng lặp vô hạn
      if (records.length < WALLET_HISTORY_DELETE_BATCH_SIZE) {
        hasMore = false;
      }
    }

    logger.info(`Cleaned ${deletedCount} WalletHistory records older than ${WALLET_HISTORY_RETENTION_DAYS} days`);
    return deletedCount;
  } catch (error) {
    logger.error('Error cleaning WalletHistory records:', { error: error.message });
    throw error;
  }
}

// Hàm cập nhật cờ leaderboard
async function updateLeaderboardFlags() {
  try {
    logger.info('Starting leaderboard flags update');

    // Reset all flags
    const resetResult = await prisma.user.updateMany({
      data: { isCreator: false, isAiRank: false },
    });
    logger.info(`Reset flags for ${resetResult.count} users`);

    // Update isCreator
    const topCreators = await prisma.user.findMany({
      orderBy: { tweetPoints: 'desc' },
      take: 10,
      select: { id: true },
    });
    const creatorUpdateResult = await prisma.user.updateMany({
      where: { id: { in: topCreators.map((u) => u.id) } },
      data: { isCreator: true },
    });
    logger.info(`Updated isCreator flag for ${creatorUpdateResult.count} users`);

    // Update isAiRank
    const topAiRank = await prisma.user.findMany({
      orderBy: { aiPoints: 'desc' },
      take: 10,
      select: { id: true },
    });
    const aiRankUpdateResult = await prisma.user.updateMany({
      where: { id: { in: topAiRank.map((u) => u.id) } },
      data: { isAiRank: true },
    });
    logger.info(`Updated isAiRank flag for ${aiRankUpdateResult.count} users`);

    // Clean old WalletHistory records
    const deletedRecords = await cleanOldWalletHistory();
    logger.info('Leaderboard flags and WalletHistory cleanup completed', {
      timestamp: new Date().toISOString(),
      deletedWalletHistoryRecords: deletedRecords,
    });
  } catch (error) {
    logger.error('Error updating leaderboard flags or cleaning WalletHistory:', { error: error.message });
  } finally {
    await prisma.$disconnect();
    logger.info('Prisma disconnected');
  }
}

// Chạy mỗi giờ (0 * * * *)
cron.schedule('0 * * * *', () => {
  logger.info('Running leaderboard flags and WalletHistory cleanup...');
  updateLeaderboardFlags();
});