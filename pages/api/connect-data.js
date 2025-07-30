// app/api/connect-data/route.js
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import helmet from 'helmet';

const prisma = new PrismaClient();

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown',
  trustProxy: true,
});

export default async function handler(req, res) {
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameAncestors: ["'self'", 'https://www.google.com', 'https://www.recaptcha.net'],
        frameSrc: ['https://www.google.com', 'https://www.recaptcha.net'],
      },
    },
  })(req, res, () => {});
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}, method: ${req.method}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { stack: err.stack, ip });
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip, session });
    return res.status(401).json({ detail: 'Not authenticated' });
  }

  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`, { ip });
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    logger.info(`Fetching connect-data for user: ${session.user.id}`, { ip });
    const [creators, aiRank, rankings] = await Promise.all([
      prisma.users.findMany({
        where: { tweet_points: { gt: 0 } }, // Changed from tweetPoints
        orderBy: { tweet_points: 'desc' }, // Changed from tweetPoints
        take: 10,
        select: {
          id: true,
          email: true,
          profile_picture: true, // Changed from profilePicture
          google_name: true, // Changed from googleName
          tweet_points: true, // Changed from tweetPoints
          tier: true,
        },
      }),
      prisma.users.findMany({
        where: { ai_points: { gt: 0 } }, // Changed from aiPoints
        orderBy: { ai_points: 'desc' }, // Changed from aiPoints
        take: 10,
        select: {
          id: true,
          email: true,
          profile_picture: true, // Changed from profilePicture
          google_name: true, // Changed from googleName
          ai_points: true, // Changed from aiPoints
          tier: true,
        },
      }),
      prisma.users.findMany({
        where: { points: { gt: 0 } },
        orderBy: { points: 'desc' },
        take: 100,
        select: {
          id: true,
          email: true,
          profile_picture: true, // Changed from profilePicture
          google_name: true, // Changed from googleName
          points: true,
          tier: true,
        },
      }),
    ]);

    logger.info('Fetched connect-data successfully', {
      creatorsCount: creators.length,
      aiRankCount: aiRank.length,
      rankingsCount: rankings.length,
      userId: session.user.id,
      ip,
    });

    return res.status(200).json({
      success: true,
      creators: creators.map((user) => ({ ...user, isCreator: true, points: user.tweet_points })), // Changed from tweetPoints
      aiRank: aiRank.map((user) => ({ ...user, isAiRank: true, points: user.ai_points })), // Changed from aiPoints
      rankings,
    });
  } catch (error) {
    logger.error('Error fetching connect-data', {
      message: error.message,
      stack: error.stack,
      userId: session.user.id,
      ip,
    });
    return res.status(500).json({ detail: `Error fetching leaderboard data: ${error.message}` });
  }
}