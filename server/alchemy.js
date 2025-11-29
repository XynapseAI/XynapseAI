// worker.js
import 'dotenv/config';
import { Redis } from '@upstash/redis';
import fetch from 'node-fetch';

// Khởi tạo Redis
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const API_KEY = process.env.ALCHEMY_API_KEY || 'demo';

const RPC_URLS = {
    ethereum: 'https://ethereum-rpc.publicnode.com',
    bsc: 'https://bsc-rpc.publicnode.com',
    polygon: 'https://polygon-bor-rpc.publicnode.com',
    arbitrum: 'https://arbitrum-one-rpc.publicnode.com',
    optimism: 'https://optimism-rpc.publicnode.com',
    base: 'https://base-rpc.publicnode.com',
    avalanche: 'https://avalanche-c-chain-rpc.publicnode.com',
    linea: 'https://linea-rpc.publicnode.com',
    gnosis: 'https://gnosis-rpc.publicnode.com',
    celo: 'https://celo-rpc.publicnode.com',
    unichain: 'https://unichain-rpc.publicnode.com',
    bitcoin: 'https://bitcoin-rpc.publicnode.com',
    solana: 'https://solana-rpc.publicnode.com',
};

const PRICE_ID = {
    ethereum: 'ethereum',
    bsc: 'binancecoin',
    polygon: 'matic-network',
    arbitrum: 'ethereum',
    optimism: 'ethereum',
    base: 'ethereum',
    avalanche: 'avalanche-2',
    linea: 'ethereum',
    gnosis: 'xdai',
    celo: 'celo',
    unichain: 'ethereum',
    bitcoin: 'bitcoin',
    solana: 'solana',
};

// Hàm gọi RPC chung
async function fetchRPC(url, method, params = []) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: method, params: params }),
    });
    if (!res.ok) throw new Error(`RPC Status ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
}

// Xử lý logic cho EVM chain
async function processEVMChain(chain, rpcUrl) {
    try {
        console.log(`[${chain}] Updating...`);

        // 1. Lấy Block Number mới nhất
        const latestHex = await fetchRPC(rpcUrl, 'eth_blockNumber');
        const latest = parseInt(latestHex, 16);

        // 2. Lấy 20 Blocks gần nhất (Chạy song song)
        const promises = [];
        for (let i = 0; i < 20; i++) {
            const blockNumHex = '0x' + (latest - i).toString(16);
            promises.push(fetchRPC(rpcUrl, 'eth_getBlockByNumber', [blockNumHex, i === 0])); 
        }
        const results = await Promise.all(promises);

        // 3. Xử lý dữ liệu Blocks
        const formattedBlocks = results.filter(b => b).map(b => ({
            number: parseInt(b.number, 16),
            hash: b.hash,
            timestamp: parseInt(b.timestamp, 16),
            miner: b.miner,
            transactions: b.transactions.map(t => typeof t === 'object' ? t.hash : t), // Chỉ lưu hash trong list blocks để nhẹ
            baseFeePerGas: b.baseFeePerGas ? { type: 'BigNumber', hex: b.baseFeePerGas } : null,
        }));

        // 4. Xử lý dữ liệu Transactions (Từ block mới nhất)
        const latestBlockFull = results[0]; // Block đầu tiên là block mới nhất, đã lấy full tx
        let txs = [];
        if (latestBlockFull && latestBlockFull.transactions) {
            txs = latestBlockFull.transactions.slice(0, 500).map(tx => ({
                ...tx,
                from: tx.from?.toLowerCase() || null,
                to: tx.to?.toLowerCase() || null,
                value: tx.value ? parseInt(tx.value, 16).toString() : "0",
                blockNumber: parseInt(tx.blockNumber, 16)
            }));
        }

        // 5. Lấy giá (Native Price)
        let price = 0;
        try {
            const id = PRICE_ID[chain] || 'ethereum';
            const priceRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
            const priceData = await priceRes.json();
            price = priceData[id]?.usd || 0;
        } catch (e) {
            console.error(`[${chain}] Price error`, e.message);
            const oldPrice = await redis.get(`price:${chain}`);
            price = oldPrice || 0;
        }

        // LƯU VÀO REDIS
        const pipeline = redis.pipeline();
        pipeline.set(`blocks:${chain}`, JSON.stringify(formattedBlocks));
        pipeline.set(`txs:${chain}`, JSON.stringify(txs));
        pipeline.set(`price:${chain}`, price);
        pipeline.set(`stats:${chain}`, JSON.stringify({
            blockNumber: latest,
            gasPrice: parseInt(latestBlockFull.baseFeePerGas || '0', 16).toString()
        }));
        await pipeline.exec();

        console.log(`[${chain}] Updated successfully. Block: ${latest}`);

    } catch (err) {
        console.error(`[${chain}] Error:`, err.message);
    }
}

// Xử lý logic cho Bitcoin
async function processBitcoin(chain, rpcUrl) {
    try {
        console.log(`[${chain}] Updating...`);

        // 1. Lấy Block height mới nhất
        const latest = await fetchRPC(rpcUrl, 'getblockcount');

        // 2. Lấy 20 Blocks gần nhất
        const promises = [];
        for (let i = 0; i < 20; i++) {
            const height = latest - i;
            const hash = await fetchRPC(rpcUrl, 'getblockhash', [height]);
            promises.push(fetchRPC(rpcUrl, 'getblock', [hash, 2])); // verbosity 2 for full tx
        }
        const results = await Promise.all(promises);

        // 3. Xử lý dữ liệu Blocks
        const formattedBlocks = results.filter(b => b).map(b => ({
            number: b.height,
            hash: b.hash,
            timestamp: b.time,
            miner: b.tx[0].vout[0].scriptPubKey.addresses ? b.tx[0].vout[0].scriptPubKey.addresses[0] : 'Unknown',
            transactions: b.tx.map(tx => tx.txid),
        }));

        // 4. Xử lý dữ liệu Transactions (Từ block mới nhất)
        const latestBlockFull = results[0];
        let txs = [];
        if (latestBlockFull && latestBlockFull.tx) {
            txs = latestBlockFull.tx.slice(0, 500).map(tx => ({
                hash: tx.txid,
                from: tx.vin.map(vin => vin.prevout ? vin.prevout.scriptPubKey.addresses[0] : 'Coinbase').join(', '),
                to: tx.vout.map(vout => vout.scriptPubKey.addresses ? vout.scriptPubKey.addresses[0] : 'OP_RETURN').join(', '),
                value: tx.vout.reduce((sum, vout) => sum + vout.value, 0).toString(),
                blockNumber: latestBlockFull.height
            }));
        }

        // 5. Lấy giá
        let price = 0;
        try {
            const id = PRICE_ID[chain];
            const priceRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
            const priceData = await priceRes.json();
            price = priceData[id]?.usd || 0;
        } catch (e) {
            console.error(`[${chain}] Price error`, e.message);
            const oldPrice = await redis.get(`price:${chain}`);
            price = oldPrice || 0;
        }

        // LƯU VÀO REDIS
        const pipeline = redis.pipeline();
        pipeline.set(`blocks:${chain}`, JSON.stringify(formattedBlocks));
        pipeline.set(`txs:${chain}`, JSON.stringify(txs));
        pipeline.set(`price:${chain}`, price);
        pipeline.set(`stats:${chain}`, JSON.stringify({
            blockNumber: latest,
            gasPrice: '0' // Có thể thêm logic lấy fee estimate nếu cần
        }));
        await pipeline.exec();

        console.log(`[${chain}] Updated successfully. Block: ${latest}`);

    } catch (err) {
        console.error(`[${chain}] Error:`, err.message);
    }
}

// Xử lý logic cho Solana
async function processSolana(chain, rpcUrl) {
    try {
        console.log(`[${chain}] Updating...`);

        // 1. Lấy Slot mới nhất
        const latestSlot = await fetchRPC(rpcUrl, 'getSlot');

        // 2. Lấy 20 slots gần nhất (giả sử không skip, hoặc adjust nếu cần)
        const promises = [];
        for (let i = 0; i < 20; i++) {
            const slot = latestSlot - i;
            promises.push(fetchRPC(rpcUrl, 'getBlock', [slot, { transactionDetails: 'full', rewards: true, maxSupportedTransactionVersion: 0 }]));
        }
        const results = await Promise.allSettled(promises); // Use allSettled to handle possible skipped slots
        const validResults = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);

        // 3. Xử lý dữ liệu Blocks
        const formattedBlocks = validResults.map(b => ({
            number: b.blockHeight,
            hash: b.blockhash,
            timestamp: b.blockTime,
            miner: b.rewards ? b.rewards.find(r => r.rewardType === 'fee')?.pubkey || 'Unknown' : 'Unknown',
            transactions: b.transactions ? b.transactions.map(t => t.transaction.signatures[0]) : [],
        }));

        // 4. Xử lý dữ liệu Transactions (Từ block mới nhất)
        const latestBlockFull = validResults[0];
        let txs = [];
        if (latestBlockFull && latestBlockFull.transactions) {
            txs = latestBlockFull.transactions.slice(0, 500).map(tx => ({
                hash: tx.transaction.signatures[0],
                from: tx.transaction.message.accountKeys[0].pubkey, // Fee payer usually first
                to: tx.transaction.message.instructions[0]?.accounts[1] || null, // Simplified, actual to depends on instruction
                value: tx.meta ? tx.meta.postBalances[1] - tx.meta.preBalances[1] : "0", // Simplified value transfer
                blockNumber: latestBlockFull.blockHeight
            }));
        }

        // 5. Lấy giá
        let price = 0;
        try {
            const id = PRICE_ID[chain];
            const priceRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
            const priceData = await priceRes.json();
            price = priceData[id]?.usd || 0;
        } catch (e) {
            console.error(`[${chain}] Price error`, e.message);
            const oldPrice = await redis.get(`price:${chain}`);
            price = oldPrice || 0;
        }

        // LƯU VÀO REDIS
        const pipeline = redis.pipeline();
        pipeline.set(`blocks:${chain}`, JSON.stringify(formattedBlocks));
        pipeline.set(`txs:${chain}`, JSON.stringify(txs));
        pipeline.set(`price:${chain}`, price);
        pipeline.set(`stats:${chain}`, JSON.stringify({
            blockNumber: latestSlot,
            gasPrice: '0'
        }));
        await pipeline.exec();

        console.log(`[${chain}] Updated successfully. Block: ${latestSlot}`);

    } catch (err) {
        console.error(`[${chain}] Error:`, err.message);
    }
}

// Hàm khởi chạy chính
async function runWorker() {
    const chains = Object.keys(RPC_URLS);
    for (const chain of chains) {
        const rpcUrl = RPC_URLS[chain];
        if (['bitcoin'].includes(chain)) {
            processBitcoin(chain, rpcUrl);
        } else if (['solana'].includes(chain)) {
            processSolana(chain, rpcUrl);
        } else {
            processEVMChain(chain, rpcUrl);
        }
    }
    setInterval(() => {
        for (const chain of chains) {
            const rpcUrl = RPC_URLS[chain];
            if (['bitcoin'].includes(chain)) {
                processBitcoin(chain, rpcUrl);
            } else if (['solana'].includes(chain)) {
                processSolana(chain, rpcUrl);
            } else {
                processEVMChain(chain, rpcUrl);
            }
        }
    }, 60000);
}

runWorker();

// const RPC_URLS = {
//     ethereum: `https://eth-mainnet.g.alchemy.com/v2/${API_KEY}`,
//     polygon: `https://polygon-mainnet.g.alchemy.com/v2/${API_KEY}`,
//     arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${API_KEY}`,
//     optimism: `https://opt-mainnet.g.alchemy.com/v2/${API_KEY}`,
//     base: `https://base-mainnet.g.alchemy.com/v2/${API_KEY}`,
//     avalanche: `https://avax-mainnet.g.alchemy.com/v2/${API_KEY}`,
//     zksync: `https://zksync-mainnet.g.alchemy.com/v2/${API_KEY}`,
//     linea: `https://linea-mainnet.g.alchemy.com/v2/${API_KEY}`,
//     gnosis: `https://gnosis-mainnet.g.alchemy.com/v2/${API_KEY}`,
//     celo: `https://celo-mainnet.g.alchemy.com/v2/${API_KEY}`,
//     hyperevm: `https://hyperliquid-mainnet.g.alchemy.com/v2/${API_KEY}`,
//     monad: `https://monad-mainnet.g.alchemy.com/v2/${API_KEY}`,
//     unichain: `https://linea-mainnet.g.alchemy.com/v2/${API_KEY}`,
//     world: `https://worldchain-mainnet.g.alchemy.com/v2/${API_KEY}`,
// };

