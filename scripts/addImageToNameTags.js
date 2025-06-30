const fs = require('fs');
const path = require('path');

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
