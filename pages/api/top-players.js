// pages/api/top-players.js
import { db } from '../../utils/firebaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    const usersSnapshot = await db.collection('users')
      .orderBy('points', 'desc')
      .limit(10)
      .get();
    const topPlayers = usersSnapshot.docs.map(doc => ({
      walletAddress: doc.data().walletAddress || doc.id,
      points: doc.data().points,
      tier: doc.data().tier,
    }));
    return res.status(200).json({ success: true, players: topPlayers });
  } catch (error) {
    return res.status(500).json({ detail: `Failed to fetch top players: ${error.message}` });
  }
}