import axios from 'axios';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Missing token ID' });
  }

  try {
    const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${id}`, {
      params: {
        localization: false,
        tickers: false,
        market_data: false,
        community_data: false,
        developer_data: false,
      },
    });
    return res.status(200).json({ data: { [id]: response.data } });
  } catch (error) {
    return res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch token information',
    });
  }
}