// pages/api/coingecko/info.js
import axios from 'axios';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Phương thức không được phép' });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Thiếu ID token' });
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
    console.error('Error fetching CoinGecko info:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Không thể tải thông tin token',
    });
  }
}