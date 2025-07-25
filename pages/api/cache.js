import connectRedis from '../../lib/redis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { key, action, data, ttl } = req.body;
  if (!key || !action) {
    return res.status(400).json({ error: 'Key and action are required' });
  }

  // Giới hạn TTL tối đa là 24 giờ
  const maxTTL = 24 * 60 * 60; // 24 giờ
  const effectiveTTL = ttl ? Math.min(ttl / 1000, maxTTL) : 60; // Chuyển từ ms sang giây

  let client;
  try {
    client = await connectRedis();
    if (action === 'get') {
      const cached = await client.get(key);
      return res.status(200).json({ data: cached ? JSON.parse(cached) : null });
    } else if (action === 'set') {
      if (!data) {
        return res.status(400).json({ error: 'Data is required for set action' });
      }
      await client.setEx(key, effectiveTTL, JSON.stringify(data));
      return res.status(200).json({ success: true });
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Redis API Error:', error);
    return res.status(500).json({ error: `Redis error: ${error.message}` });
  }
}