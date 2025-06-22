// pages/api/top-players.js
const { db } = require('../../utils/firebaseAdmin');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    console.log('Fetching top players');
    const usersSnapshot = await db.collection('users')
      .orderBy('points', 'desc')
      .limit(10)
      .get();
    const topPlayers = usersSnapshot.docs.map(doc => ({
      walletAddress: doc.data().walletAddress || doc.id,
      points: doc.data().points,
      tier: doc.data().tier,
    }));
    console.log('Top players:', topPlayers);
    return res.status(200).json({ success: true, players: topPlayers });
  } catch (error) {
    console.error('Error fetching top players:', error);
    return res.status(500).json({ detail: `Failed to fetch top players: ${error.message}` });
  }
}