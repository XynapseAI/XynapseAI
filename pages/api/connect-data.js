import { query } from '../../utils/postgres.js';
import pkg from '../../utils/logger.cjs';

const { logger } = pkg;

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        logger.warn(`Method not allowed: ${req.method}`);
        return res.status(405).json({ detail: 'Method not allowed' });
    }

    try {
        logger.info('Fetching connect-data');
        const [creatorsResult, aiRankResult, rankingsResult] = await Promise.all([
            query(`SELECT id, twitter_handle, twitter_pfp, tweet_points, tier 
                   FROM users 
                   WHERE tweet_points > 0 
                   ORDER BY tweet_points DESC 
                   LIMIT 10`),
            query(`SELECT id, twitter_handle, twitter_pfp, ai_points, tier 
                   FROM users 
                   WHERE ai_points > 0 
                   ORDER BY ai_points DESC 
                   LIMIT 10`),
            query(`SELECT id, twitter_handle, twitter_pfp, points, tier 
                   FROM users 
                   WHERE points > 0 
                   ORDER BY points DESC 
                   LIMIT 100`),
        ]);

        const creators = creatorsResult.rows.map(row => ({
            id: row.id,
            twitterHandle: row.twitter_handle,
            twitterPFP: row.twitter_pfp,
            tweetPoints: row.tweet_points,
            tier: row.tier,
        }));

        const aiRank = aiRankResult.rows.map(row => ({
            id: row.id,
            twitterHandle: row.twitter_handle,
            twitterPFP: row.twitter_pfp,
            aiPoints: row.ai_points,
            tier: row.tier,
        }));

        const rankings = rankingsResult.rows.map(row => ({
            id: row.id,
            twitterHandle: row.twitter_handle,
            twitterPFP: row.twitter_pfp,
            points: row.points,
            tier: row.tier,
        }));

        logger.info('Fetched connect-data successfully', { 
            creatorsCount: creators.length, 
            aiRankCount: aiRank.length, 
            rankingsCount: rankings.length 
        });

        return res.status(200).json({
            success: true,
            creators: creators.map(user => ({ ...user, isCreator: true, points: user.tweetPoints })),
            aiRank: aiRank.map(user => ({ ...user, isAiRank: true, points: user.aiPoints })),
            rankings,
        });
    } catch (error) {
        logger.error('Error in /api/connect-data:', {
            message: error.message,
            stack: error.stack,
        });
        return res.status(500).json({ detail: `Failed to fetch leaderboard data: ${error.message}` });
    }
}