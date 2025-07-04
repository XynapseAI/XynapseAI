import axios from 'axios';

export default async function handler(req, res) {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/asset_platforms', {
      headers: {
        accept: 'application/json',
        ...(process.env.COINGECKO_API_KEY && { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY }),
      },
    });
    res.status(200).json(response.data);
  } catch (error) {
    console.error('Error fetching CoinGecko platforms:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to fetch asset platforms',
    });
  }
}