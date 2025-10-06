import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsonFolder = path.join(__dirname, '../public/nametags');

const keywordToImage = {
  binance: 'binance.webp',
  coinbase: 'coinbase.webp',
  bybit: 'bybit.webp',
  bitget: 'bitget.webp',
  okx: 'okx.webp',
  kraken: 'kraken.webp',
  uniswap: 'uniswap.webp',
  tether: 'tether.webp',
  blackrock: 'blackrock.webp',
  bitstamp: 'bitstamp.webp',
  aave: 'aave.webp',
  robinhood: 'robinhood.webp',
  circle: 'circle.webp',
  sushiswap: 'sushiswap.webp',
  upbit: 'upbit.webp',
  huobi: 'huobi.webp',
  mantle: 'mantle.webp',
  mexc: 'mexc.webp',
  kucoin: 'kucoin.webp',
  arbitrum: 'arbitrum.webp',
  chainlink: 'chainlink.webp',
  coinone:'coinone.webp',
  gate: 'gate.webp',
  curve:'curve.webp',
  jump: 'jump.webp',
  optimism: 'optimism.webp',
  polygon: 'polygon.webp',
  government:'government.webp',
  bitfinex: 'bitfinex.webp',
  ceffu: 'ceffu.webp',
  bingx:'bingx.webp',
  gnosis:'gnosis.webp',
  fluid: 'fluid.webp',
  ethena: 'ethena.webp',
  sui: 'sui.webp',
  crypto: 'crypto.webp',
  hyperliquid: 'hyperliquid.webp',
  balancer: 'balancer.webp',
  multichain: 'multichain.webp',
  synthetix: 'synthetix.webp',
  wintermute: 'wintermute.webp',
  bsc: 'binance.webp',
  bnb: 'binance.webp',
  opbnb: 'binance.webp',
  tornado: 'tornado.webp',
  beacon: 'beacon.webp',
  ether: 'eth.webp',
  base: 'coinbase.webp',
  gemini: 'gemini.webp',
  polkadot: 'polkadot.webp',
  ethdev: 'eth.webp',
  linea: 'linea.webp',
  bitbank: 'bitbank.webp',
  phemex: 'phemex.webp',
  makerdao: 'makerdao.webp',
  lighter: 'lighter.webp',
  morpho: 'morpho.webp',
  hyperliquid: 'hyperliquid.webp',
  usdt: 'tether.webp',
  deribit: 'deribit.webp',
  worldcoin: 'worldcoin.webp',
  hashnode: 'hashnode.webp',
  starknet: 'starknet.webp',
  justin: 'justinsun.webp',
  cz: 'cz.webp',
  world: 'wlfi.webp',
  vitalik: 'vitalik.webp',
  vaneck: 'vaneck.webp',
  bitmex: 'bitmex.webp',
  purpose: 'purpose.webp',
  mt: 'mtgox.webp',
  microstrategy: 'microstrategy.webp',
  mara: 'mara.webp',
  twenty: 'twenty_one.webp',
  marathon: 'marathon.webp',
  riot: 'riot.webp',
  trump: 'trump.webp',
  metaplanet: 'metaplanet.webp',
  galaxy: 'galaxy.webp',
  cleanspark: 'cleanspark.webp',
  tesla: 'tesla.webp',
  hut: 'hut8.webp',
  revolut: 'revolut.webp',
  bithumb: 'bithumb.webp',
  river: 'river.webp',
  paxos: 'paxos.webp',
  maskex: 'maskex.webp',
  satoshi: 'bitcoin.webp',
  okex: 'okx.webp',
  uk: 'uk.webp',
  coincheck: 'coincheck.webp',
  '1inch': '1inch.webp',
  lido: 'lido.webp',
  gemini: 'gemini.webp',
  avalanche: 'avalanche.webp',
  wormhole: 'wormhole.webp',
  htx: 'htx.webp',
  eigen: 'eigenlayer.webp',
  blast: 'blast.webp',
  immutable: 'immutable.webp',
  kelpdao: 'kelpdao.webp',
  ens: 'ens.webp',
  ishares : 'blackrock.webp',
  fidelity : 'fidelity.webp',
  '21shares' : '21shares.webp',
  bitwise : 'bitwise.webp',
  vaneck : 'vaneck.webp',
  franklin : 'franklin.webp',
  valkyrie : 'valkyrie.webp',
  invesco : 'invesco.webp',
  wisdom : 'wisdom.webp',
  hashdex : 'hashdex.webp',
  grayscale : 'grayscale.webp',
};

const getImageFromNameTag = (nameTag = '') => {
  const lower = nameTag.toLowerCase();
  for (const keyword in keywordToImage) {
    if (lower.includes(keyword)) {
      return `/icons/${keywordToImage[keyword]}`;
    }
  }
  return '/icons/default.webp';
};

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
            label["image"] === '/icons/default.webp' || 
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
