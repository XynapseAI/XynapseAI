// app/api/alchemy/route.js
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { ethers } from 'ethers';

const redis = Redis.fromEnv();
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

const rpcMap = {
  ethereum: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  polygon: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  optimism: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  base: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  avalanche: `https://avax-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  celo: `https://celo-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  gnosis: `https://gnosis-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  zksync: `https://zksync-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  linea: `https://linea-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  bsc: `https://bnb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  abstract: `https://abstract-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  apechain: `https://apechain-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  hyperevm: `https://hyperliquid-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  monad: `https://monad-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  unichain: `https://linea-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  world: `https://worldchain-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
};

const nativeIdMap = {
  ethereum: '1027', // ETH
  bsc: '1839', // BNB
  arbitrum: '1027', // ETH
  optimism: '1027', // ETH
  polygon: '3890', // MATIC
  base: '1027', // ETH
  avalanche: '5805', // AVAX
  celo: '5568', // CELO
  gnosis: '16547', // xDAI
  zksync: '1027', // ETH
  linea: '1027', // ETH
  monad: '143', // MON
  hyperevm: '999', // HYPER
};

async function fetchNativePrice(chain) {
  if (!process.env.COINMARKETCAP_API_KEY) {
    return null;
  }
  const nativeId = nativeIdMap[chain];
  if (!nativeId) return null;
  const idStr = nativeId;
  const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?id=${idStr}&convert=USD`;
  const config = {
    headers: {
      'Accept': 'application/json',
      'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_API_KEY,
    },
    timeout: 10000,
  };
  try {
    const res = await fetch(url, config);
    const data = await res.json();
    if (data.status?.error_code === 0) {
      const price = data.data[nativeId]?.quote?.USD?.price || null;
      return price;
    }
  } catch (err) {
    console.warn(`CMC native price failed for ${chain}: ${err.message}`);
  }
  return null;
}

const getCachedData = async (key, defaultVal = []) => {
  const cached = await redis.get(key);
  if (cached === null) return defaultVal;
  return typeof cached === 'string' ? JSON.parse(cached) : cached;
};

export async function POST(request) {
  if (!ALCHEMY_API_KEY) {
    return NextResponse.json({ error: 'Alchemy API key required' }, { status: 500 });
  }

  const { action, chain } = await request.json();

  if (!chain) {
    return NextResponse.json({ error: 'Chain required' }, { status: 400 });
  }

  const isEVM = !['bitcoin', 'solana'].includes(chain);

  try {
    if (action === 'native-price') {
      let price = await redis.get(`price:${chain}`);
      if (price === null) {
        price = await fetchNativePrice(chain);
        if (price !== null) {
          await redis.set(`price:${chain}`, price, { EX: 3600 });
        }
      }
      return NextResponse.json({ price: Number(price) || 0 });
    }

    if (action === 'latest-blocks') {
      let blocks = await getCachedData(`blocks:${chain}`);
      if (blocks.length === 0 && isEVM) {
        const rpcUrl = rpcMap[chain];
        if (rpcUrl) {
          const provider = new ethers.JsonRpcProvider(rpcUrl);
          const latestNum = await provider.getBlockNumber();
          const numBlocks = 10;
          const blockPromises = [];
          for (let i = 0; i < numBlocks; i++) {
            const num = latestNum - i;
            blockPromises.push(
              provider.getBlock(num).then(b => ({
                number: b.number,
                timestamp: b.timestamp,
                miner: b.miner,
                transactions: b.transactions.length
              })).catch(() => null)
            );
          }
          let fetchedBlocks = await Promise.all(blockPromises);
          fetchedBlocks = fetchedBlocks.filter(Boolean).slice(0, 10);
          blocks = fetchedBlocks.reverse(); // newest first
          await redis.set(`blocks:${chain}`, JSON.stringify(blocks), { EX: 30 });
        }
      }
      return NextResponse.json(blocks);
    }

    if (action === 'latest-txs') {
      let txs = await getCachedData(`txs:${chain}`);
      if (txs.length === 0 && isEVM) {
        const rpcUrl = rpcMap[chain];
        if (rpcUrl) {
          const provider = new ethers.JsonRpcProvider(rpcUrl);
          const latestBlock = await provider.getBlock('latest', true);
          const fetchedTxs = latestBlock.transactions.slice(0, 20).map(tx => ({
            hash: tx.hash,
            from: tx.from,
            to: tx.to || null,
            value: tx.value ? tx.value.toString() : '0'
          }));
          txs = fetchedTxs;
          await redis.set(`txs:${chain}`, JSON.stringify(txs), { EX: 30 });
        }
      }
      return NextResponse.json(txs);
    }

    if (action === 'chain-stats') {
      let stats = await getCachedData(`stats:${chain}`, { blockNumber: 0, gasPrice: '0' });
      if (stats.blockNumber === 0 && isEVM) {
        const rpcUrl = rpcMap[chain];
        if (rpcUrl) {
          const provider = new ethers.JsonRpcProvider(rpcUrl);
          const blockNumber = await provider.getBlockNumber();
          const feeData = await provider.getFeeData();
          const gasPrice = feeData.gasPrice?.toString() || '0';
          stats = { blockNumber, gasPrice };
          await redis.set(`stats:${chain}`, JSON.stringify(stats), { EX: 30 });
        }
      }
      return NextResponse.json(stats);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('API Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}