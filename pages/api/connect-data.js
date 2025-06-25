// pages/api/connect-data.js
import { db } from '../../utils/firebaseAdmin';
import { logger } from '../../utils/logger';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    logger.info('Fetching connect-data');
    const [creatorsSnapshot, aiRankSnapshot, rankingsSnapshot] = await Promise.all([
      db.collection('users').orderBy('tweetPoints', 'desc').limit(10).get(),
      db.collection('users').orderBy('aiPoints', 'desc').limit(10).get(),
      db.collection('users').orderBy('points', 'desc').limit(100).get(),
    ]);

    const creators = creatorsSnapshot.docs.map(doc => ({
      id: doc.id,
      twitterHandle: doc.data().twitterHandle,
      twitterPFP: doc.data().twitterPFP,
      tweetPoints: doc.data().tweetPoints,
      tier: doc.data().tier,
    }));

    const aiRank = aiRankSnapshot.docs.map(doc => ({
      id: doc.id,
      twitterHandle: doc.data().twitterHandle,
      twitterPFP: doc.data().twitterPFP,
      aiPoints: doc.data().aiPoints,
      tier: doc.data().tier,
    }));

    const rankings = rankingsSnapshot.docs.map(doc => ({
      id: doc.id,
      twitterHandle: doc.data().twitterHandle,
      twitterPFP: doc.data().twitterPFP,
      points: doc.data().points,
      tier: doc.data().tier,
    }));

    logger.info('Fetched connect-data successfully', { creatorsCount: creators.length, aiRankCount: aiRank.length, rankingsCount: rankings.length });

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