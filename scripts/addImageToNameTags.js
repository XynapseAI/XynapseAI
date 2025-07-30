import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'; // Thêm dòng này

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 📁 Thư mục chứa các file JSON
const jsonFolder = path.join(__dirname, '../public/nametags');

// 🧠 Mapping từ keyword -> ảnh
const keywordToImage = {
  binance: 'binance.png',
  coinbase: 'coinbase.png',
  bybit: 'bybit.png',
  bitget: 'bitget.png',
  okx: 'okx.png',
  kraken: 'kraken.png',
  uniswap: 'uniswap.png',
  tether: 'tether.png',
  blackrock: 'blackrock.png',
  bitstamp: 'bitstamp.png',
  aave: 'aave.png',
  robinhood: 'robinhood.png',
  circle: 'circle.png',
  sushiswap: 'sushiswap.png',
  upbit: 'upbit.png',
  huobi: 'huobi.png',
  mantle: 'mantle.png',
  mexc: 'mexc.png',
  kucoin: 'kucoin.png',
  arbitrum: 'arbitrum.png',
  chainlink: 'chainlink.png',
  coinone:'coinone.png',
  gate: 'gate.png',
  curve:'curve.png',
  jump: 'jump.png',
  optimism: 'optimism.png',
  polygon: 'polygon.png',
  government:'government.png',
  bitfinex: 'bitfinex.png',
  ceffu: 'ceffu.png',
  bingx:'bingx.png',
  gnosis:'gnosis.png',
  fluid: 'fluid.png',
  ethena: 'ethena.png',
  sui: 'sui.png',
  crypto: 'crypto.png',
  hyperliquid: 'hyperliquid.png',
  balancer: 'balancer.png',
  multichain: 'multichain.png',
  synthetix: 'synthetix.png',
};

const getImageFromNameTag = (nameTag = '') => {
  const lower = nameTag.toLowerCase();
  for (const keyword in keywordToImage) {
    if (lower.includes(keyword)) {
      return `/icons/${keywordToImage[keyword]}`;
    }
  }
  return '/icons/default.png';
};

// 📂 Duyệt toàn bộ các file JSON
fs.readdirSync(jsonFolder).forEach((file) => {
  if (file.endsWith('.json')) {
    const filePath = path.join(jsonFolder, file);
    const raw = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(raw);

    let modified = false;

    for (const [address, info] of Object.entries(json)) {
      const labels = info.Labels || {};
      for (const [key, label] of Object.entries(labels)) {
        const nameTag = label["Name Tag"];
        if (nameTag) {
          const newImage = getImageFromNameTag(nameTag);
          if (
            !label["image"] ||                 
            label["image"] === '/icons/default.png' || 
            label["image"] !== newImage              
          ) {
            label["image"] = newImage;
            modified = true;
          }
        }
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf8');
      console.log(`✅ Updated: ${file}`);
    } else {
      console.log(`⏭️ Skipped (no change): ${file}`);
    }
  }
});
