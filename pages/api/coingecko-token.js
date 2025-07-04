import axios from 'axios';
import { getSecrets } from '../../lib/vault'; // Thêm import

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Token ID is required' });
  }

  try {
    const secrets = await getSecrets(); // Lấy bí mật từ Vault
    const COINGECKO_API_KEY = secrets.COINGECKO_API_KEY;

    const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${id}`, {
      params: {
        localization: false,
        tickers: false,
        market_data: true,
        community_data: false,
        developer_data: false,
        sparkline: false,
      },
      headers: {
        accept: 'application/json',
        ...(COINGECKO_API_KEY && { 'x-cg-demo-api-key': COINGECKO_API_KEY }),
      },
    });
    res.status(200).json({
      id: response.data.id,
      symbol: response.data.symbol,
      name: response.data.name,
      image: response.data.image?.thumb,
      current_price: response.data.market_data?.current_price?.usd,
      market_cap: response.data.market_data?.market_cap?.usd,
      total_volume: response.data.market_data?.total_volume?.usd,
      high_24h: response.data.market_data?.high_24h?.usd,
      price_change_percentage_24h: response.data.market_data?.price_change_percentage_24h,
      circulating_supply: response.data.market_data?.circulating_supply,
      total_supply: response.data.market_data?.total_supply,
      max_supply: response.data.market_data?.max_supply,
      market_cap_rank: response.data.market_cap_rank,
      platforms: response.data.platforms || {},
    });
  } catch (error) {
    console.error('Error fetching CoinGecko token:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to fetch token details',
    });
  }
}