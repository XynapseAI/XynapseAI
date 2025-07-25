// pages/api/cache.js
import connectRedis from '../../lib/redis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { key, action, ttl = 2 * 60 * 60 } = req.body;

  let client;
  try {
    client = await connectRedis();
    if (action === 'get') {
      const cached = await client.get(key);
      return res.status(200).json({ data: cached ? JSON.parse(cached) : null });
    } else if (action === 'set') {
      const { data } = req.body;
      await client.setEx(key, ttl, JSON.stringify(data));
      return res.status(200).json({ success: true });
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Redis API Error:', error);
    return res.status(500).json({ error: `Redis error: ${error.message}` });
  }
}