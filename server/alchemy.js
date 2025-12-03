import 'dotenv/config';
import { Redis } from '@upstash/redis';
import fetch from 'node-fetch';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    automaticDeserialization: false,
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
    // Thêm monad và hyperevm sử dụng Alchemy RPC (publicnode không hỗ trợ)
    monad: `https://monad-mainnet.g.alchemy.com/v2/${API_KEY}`,
    hyperevm: `https://hyperliquid-mainnet.g.alchemy.com/v2/${API_KEY}`,
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
    // Thêm PRICE_ID cho monad và hyperevm (CoinGecko IDs)
    monad: 'monad',
    hyperevm: 'hyperevm',
};

const MAX_BLOCKS = 500; // Reduced from 1000 to keep serialized JSON under ~5-6MB and avoid Upstash limit
const MAX_TXS = 2000; // Reduced from 5000 to lower memory usage
const INITIAL_FETCH_COUNT = 10; // Số lượng fetch ban đầu nếu rỗng
const MAX_NEW_FETCH_PER_UPDATE = 10; // New: Limit new blocks fetched per update to prevent OOM from large parallel responses
const CACHE_EXPIRE_SECONDS = 300; // 5 phút cache cho blocks/txs/stats để giảm gọi API lặp lại

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

// Hàm cập nhật tất cả giá một lần
async function updateAllPrices() {
    const uniqueIds = [...new Set(Object.values(PRICE_ID))];
    const idsStr = uniqueIds.join(',');
    let priceData = {};
    try {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${idsStr}&vs_currencies=usd`);
        if (!res.ok) throw new Error(`CoinGecko Status ${res.status}`);
        priceData = await res.json();
    } catch (e) {
        console.error('Price batch fetch error:', e.message);
    }

    const pipeline = redis.pipeline();
    for (const [chain, id] of Object.entries(PRICE_ID)) {
        let price = priceData[id]?.usd || null;
        if (price === null) {
            price = (await redis.get(`price:${chain}`)) || 0;
        }
        pipeline.set(`price:${chain}`, price, { EX: 3600 }); // Cache price 1 giờ
    }
    await pipeline.exec();
}

async function processEVMChain(chain, rpcUrl) {
    try {
        console.log(`[${chain}] Updating...`);

        const latestHex = await fetchRPC(rpcUrl, 'eth_blockNumber');
        const latest = parseInt(latestHex, 16);

        let existingBlocks = JSON.parse(await redis.get(`blocks:${chain}`)) || [];
        let existingTxs = JSON.parse(await redis.get(`txs:${chain}`)) || [];

        // Nếu chưa có dữ liệu → fetch initial 10 blocks
        if (existingBlocks.length === 0) {
            const promises = [];
            for (let i = 0; i < INITIAL_FETCH_COUNT; i++) {
                const blockNumHex = '0x' + (latest - i).toString(16);
                promises.push(fetchRPC(rpcUrl, 'eth_getBlockByNumber', [blockNumHex, true]));
            }
            const results = await Promise.all(promises);

            existingBlocks = results.filter(b => b).map(b => ({
                number: parseInt(b.number, 16),
                hash: b.hash,
                timestamp: parseInt(b.timestamp, 16),
                miner: b.miner,
                transactions: b.transactions.map(t => typeof t === 'object' ? t.hash : t),
                baseFeePerGas: b.baseFeePerGas ? { type: 'BigNumber', hex: b.baseFeePerGas } : null,
            }));

            // Lấy txs từ tất cả 10 blocks initial (but only essential fields to save memory)
            results.forEach(block => {
                if (block?.transactions) {
                    const blockTxs = block.transactions.map(tx => ({
                        hash: tx.hash, // New: Only store essential fields, no ...tx to avoid large 'input' etc.
                        from: tx.from?.toLowerCase() || null,
                        to: tx.to?.toLowerCase() || null,
                        value: tx.value ? BigInt(tx.value).toString() : "0", // Updated: Use BigInt to handle large values accurately
                        blockNumber: parseInt(block.number, 16)
                    }));
                    existingTxs = [...blockTxs, ...existingTxs].slice(0, MAX_TXS);
                }
            });
        } else {
            // Chỉ fetch tối đa 10 blocks mới (không fetch hàng trăm)
            const storedLatest = existingBlocks[0]?.number || 0;
            const newBlocksCount = latest - storedLatest;
            if (newBlocksCount > 0) {
                const blocksToFetch = Math.min(newBlocksCount, MAX_NEW_FETCH_PER_UPDATE); // Updated to use new constant
                const promises = [];
                for (let i = 0; i < blocksToFetch; i++) {
                    const blockNumHex = '0x' + (latest - i).toString(16);
                    promises.push(fetchRPC(rpcUrl, 'eth_getBlockByNumber', [blockNumHex, true]));
                }
                const newResults = await Promise.all(promises);

                const newBlocks = newResults.filter(b => b).map(b => ({
                    number: parseInt(b.number, 16),
                    hash: b.hash,
                    timestamp: parseInt(b.timestamp, 16),
                    miner: b.miner,
                    transactions: b.transactions.map(t => typeof t === 'object' ? t.hash : t),
                    baseFeePerGas: b.baseFeePerGas ? { type: 'BigNumber', hex: b.baseFeePerGas } : null,
                }));

                existingBlocks = [...newBlocks, ...existingBlocks].slice(0, MAX_BLOCKS);

                // Chỉ lấy transaction từ 5 blocks gần nhất để tránh quá tải
                newResults.slice(0, 5).forEach(block => {
                    if (block?.transactions) {
                        const blockTxs = block.transactions.map(tx => ({
                            hash: tx.hash, // New: Only essential fields
                            from: tx.from?.toLowerCase() || null,
                            to: tx.to?.toLowerCase() || null,
                            value: tx.value ? BigInt(tx.value).toString() : "0", // Updated: Use BigInt to handle large values accurately
                            blockNumber: parseInt(block.number, 16)
                        }));
                        existingTxs = [...blockTxs, ...existingTxs].slice(0, MAX_TXS);
                    }
                });
            }
        }

        const pipeline = redis.pipeline();
        pipeline.set(`blocks:${chain}`, JSON.stringify(existingBlocks), { EX: CACHE_EXPIRE_SECONDS });
        pipeline.set(`txs:${chain}`, JSON.stringify(existingTxs), { EX: CACHE_EXPIRE_SECONDS });
        pipeline.set(`stats:${chain}`, JSON.stringify({
            blockNumber: latest,
            gasPrice: existingBlocks[0]?.baseFeePerGas ? parseInt(existingBlocks[0].baseFeePerGas.hex, 16).toString() : '0'
        }), { EX: CACHE_EXPIRE_SECONDS });
        await pipeline.exec();

        console.log(`[${chain}] Updated successfully. Block: ${latest}, Total blocks: ${existingBlocks.length}, Total txs: ${existingTxs.length}`);
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

        // Lấy danh sách blocks hiện tại từ Redis
        let existingBlocks = JSON.parse(await redis.get(`blocks:${chain}`)) || [];
        let existingTxs = JSON.parse(await redis.get(`txs:${chain}`)) || [];

        // Nếu rỗng, fetch initial count
        if (existingBlocks.length === 0) {
            const promises = [];
            for (let i = 0; i < INITIAL_FETCH_COUNT; i++) {
                const height = latest - i;
                const hash = await fetchRPC(rpcUrl, 'getblockhash', [height]);
                promises.push(fetchRPC(rpcUrl, 'getblock', [hash, 2]));
            }
            const results = await Promise.all(promises);

            existingBlocks = results.filter(b => b).map(b => ({
                number: b.height,
                hash: b.hash,
                timestamp: b.time,
                miner: b.tx[0].vout[0].scriptPubKey.addresses ? b.tx[0].vout[0].scriptPubKey.addresses[0] : null,
                transactions: b.tx.map(tx => tx.txid),
            }));

            // Txs từ initial blocks (limit to 100 tx per block to avoid overload)
            for (const block of results) {
                if (block && block.tx) {
                    const limitedTxs = block.tx.slice(0, 100);
                    for (const tx of limitedTxs) {
                        const from = tx.vin[0].coinbase ? 'Coinbase' : (tx.vin.length > 1 ? 'Multiple Inputs' : null);
                        const toAddresses = [];
                        for (const vout of tx.vout) {
                            let addr = 'OP_RETURN';
                            if (vout.scriptPubKey.addresses && vout.scriptPubKey.addresses.length > 0) {
                                addr = vout.scriptPubKey.addresses[0];
                            } else if (vout.scriptPubKey.address) {
                                addr = vout.scriptPubKey.address;
                            }
                            toAddresses.push(addr);
                        }
                        const to = toAddresses.length > 1 ? 'Multiple Outputs' : toAddresses[0];
                        const value = tx.vout.reduce((sum, vout) => sum + vout.value, 0).toString();

                        existingTxs.push({
                            hash: tx.txid,
                            from: from,
                            to: to,
                            value: value,
                            blockNumber: block.height
                        });
                        if (existingTxs.length >= MAX_TXS) break;
                    }
                    if (existingTxs.length >= MAX_TXS) break;
                }
            }
            existingTxs = existingTxs.slice(0, MAX_TXS);
        } else {
            // Chỉ fetch blocks mới, giới hạn tối đa 10 để tránh OOM
            const storedLatest = existingBlocks[0]?.number || 0;
            const newBlocksCount = latest - storedLatest;
            if (newBlocksCount > 0) {
                const blocksToFetch = Math.min(newBlocksCount, MAX_NEW_FETCH_PER_UPDATE); // New: Limit to 10
                const promises = [];
                for (let i = 0; i < blocksToFetch; i++) {
                    const height = latest - i;
                    const hash = await fetchRPC(rpcUrl, 'getblockhash', [height]);
                    promises.push(fetchRPC(rpcUrl, 'getblock', [hash, 2]));
                }
                const newResults = await Promise.all(promises);

                const newBlocks = newResults.filter(b => b).map(b => ({
                    number: b.height,
                    hash: b.hash,
                    timestamp: b.time,
                    miner: b.tx[0].vout[0].scriptPubKey.addresses ? b.tx[0].vout[0].scriptPubKey.addresses[0] : null,
                    transactions: b.tx.map(tx => tx.txid),
                }));

                // Prepend new blocks
                existingBlocks = [...newBlocks, ...existingBlocks].slice(0, MAX_BLOCKS);

                // Txs từ new blocks (limit to recent 5 blocks and 100 tx per block)
                for (const block of newResults.slice(0, 5)) { // Reduced from 10 to 5 for memory
                    if (block && block.tx) {
                        const limitedTxs = block.tx.slice(0, 100);
                        for (const tx of limitedTxs) {
                            const from = tx.vin[0].coinbase ? 'Coinbase' : (tx.vin.length > 1 ? 'Multiple Inputs' : null);
                            const toAddresses = [];
                            for (const vout of tx.vout) {
                                let addr = 'OP_RETURN';
                                if (vout.scriptPubKey.addresses && vout.scriptPubKey.addresses.length > 0) {
                                    addr = vout.scriptPubKey.addresses[0];
                                } else if (vout.scriptPubKey.address) {
                                    addr = vout.scriptPubKey.address;
                                }
                                toAddresses.push(addr);
                            }
                            const to = toAddresses.length > 1 ? 'Multiple Outputs' : toAddresses[0];
                            const value = tx.vout.reduce((sum, vout) => sum + vout.value, 0).toString();

                            existingTxs.unshift({
                                hash: tx.txid,
                                from: from,
                                to: to,
                                value: value,
                                blockNumber: block.height
                            });
                            existingTxs = existingTxs.slice(0, MAX_TXS);
                        }
                    }
                }
            }
        }

        // LƯU VÀO REDIS
        const pipeline = redis.pipeline();
        pipeline.set(`blocks:${chain}`, JSON.stringify(existingBlocks), { EX: CACHE_EXPIRE_SECONDS });
        pipeline.set(`txs:${chain}`, JSON.stringify(existingTxs), { EX: CACHE_EXPIRE_SECONDS });
        pipeline.set(`stats:${chain}`, JSON.stringify({
            blockNumber: latest,
            gasPrice: '0'
        }), { EX: CACHE_EXPIRE_SECONDS });
        await pipeline.exec();

        console.log(`[${chain}] Updated successfully. Block: ${latest}, Total blocks: ${existingBlocks.length}, Total txs: ${existingTxs.length}`);

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

        // Lấy danh sách blocks hiện tại từ Redis
        let existingBlocks = JSON.parse(await redis.get(`blocks:${chain}`)) || [];
        let existingTxs = JSON.parse(await redis.get(`txs:${chain}`)) || [];

        // Nếu rỗng, fetch initial count
        if (existingBlocks.length === 0) {
            const promises = [];
            let currentSlot = latestSlot;
            let fetched = 0;
            while (fetched < INITIAL_FETCH_COUNT) {
                promises.push(fetchRPC(rpcUrl, 'getBlock', [currentSlot, { transactionDetails: 'full', rewards: true, maxSupportedTransactionVersion: 0 }]));
                currentSlot--;
                fetched++;
            }
            const results = await Promise.allSettled(promises);
            const validResults = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);

            existingBlocks = validResults.map(b => ({
                number: b.blockHeight,
                hash: b.blockhash,
                timestamp: b.blockTime,
                miner: b.rewards ? b.rewards.find(r => r.rewardType === 'fee')?.pubkey || null : null,
                transactions: b.transactions ? b.transactions.map(t => t.transaction.signatures[0]) : [],
            }));

            // Txs từ initial blocks
            validResults.forEach(b => {
                if (b.transactions) {
                    for (const tx of b.transactions) {
                        let accountKeys = [];
                        const message = tx.transaction.message;
                        if (message.accountKeys && Array.isArray(message.accountKeys)) {
                            accountKeys = message.accountKeys;
                        } else if (message.staticAccountKeys && Array.isArray(message.staticAccountKeys)) {
                            accountKeys = message.staticAccountKeys;
                        }
                        let from = accountKeys[0] || null;
                        let to = null;
                        if (message.instructions && message.instructions[0]) {
                            const instr = message.instructions[0];
                            if (instr.accounts && instr.accounts.length >= 2) {
                                const toIndex = instr.accounts[1];
                                if (toIndex < accountKeys.length) {
                                    to = accountKeys[toIndex];
                                }
                            }
                        }
                        let value = "0";
                        if (tx.meta && tx.meta.preBalances.length > 1 && tx.meta.postBalances.length > 1) {
                            value = (tx.meta.postBalances[1] - tx.meta.preBalances[1]).toString();
                        }
                        existingTxs.push({
                            hash: tx.transaction.signatures[0],
                            from: from,
                            to: to,
                            value: value,
                            blockNumber: b.blockHeight
                        });
                        if (existingTxs.length >= MAX_TXS) break;
                    }
                    if (existingTxs.length >= MAX_TXS) return;
                }
            });
            existingTxs = existingTxs.slice(0, MAX_TXS);
        } else {
            // Fetch new slots, giới hạn tối đa 10 để tránh OOM từ parallel fetches lớn
            const storedLatest = existingBlocks[0]?.number || 0;
            const newSlotsCount = latestSlot - storedLatest;
            if (newSlotsCount > 0) {
                const slotsToFetch = Math.min(newSlotsCount, MAX_NEW_FETCH_PER_UPDATE); // New: Limit to 10
                const promises = [];
                let currentSlot = latestSlot;
                let toFetch = slotsToFetch;
                while (toFetch > 0) {
                    promises.push(fetchRPC(rpcUrl, 'getBlock', [currentSlot, { transactionDetails: 'full', rewards: true, maxSupportedTransactionVersion: 0 }]));
                    currentSlot--;
                    toFetch--;
                }
                const results = await Promise.allSettled(promises);
                const newValidResults = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);

                const newBlocks = newValidResults.map(b => ({
                    number: b.blockHeight,
                    hash: b.blockhash,
                    timestamp: b.blockTime,
                    miner: b.rewards ? b.rewards.find(r => r.rewardType === 'fee')?.pubkey || null : null,
                    transactions: b.transactions ? b.transactions.map(t => t.transaction.signatures[0]) : [],
                }));

                // Prepend new blocks
                existingBlocks = [...newBlocks, ...existingBlocks].slice(0, MAX_BLOCKS);

                // Txs từ new blocks (limit to recent 1 for performance)
                newValidResults.slice(0, 1).forEach(b => {
                    if (b.transactions) {
                        for (const tx of b.transactions) {
                            let accountKeys = [];
                            const message = tx.transaction.message;
                            if (message.accountKeys && Array.isArray(message.accountKeys)) {
                                accountKeys = message.accountKeys;
                            } else if (message.staticAccountKeys && Array.isArray(message.staticAccountKeys)) {
                                accountKeys = message.staticAccountKeys;
                            }
                            let from = accountKeys[0] || null;
                            let to = null;
                            if (message.instructions && message.instructions[0]) {
                                const instr = message.instructions[0];
                                if (instr.accounts && instr.accounts.length >= 2) {
                                    const toIndex = instr.accounts[1];
                                    if (toIndex < accountKeys.length) {
                                        to = accountKeys[toIndex];
                                    }
                                }
                            }
                            let value = "0";
                            if (tx.meta && tx.meta.preBalances.length > 1 && tx.meta.postBalances.length > 1) {
                                value = (tx.meta.postBalances[1] - tx.meta.preBalances[1]).toString();
                            }
                            existingTxs.unshift({
                                hash: tx.transaction.signatures[0],
                                from: from,
                                to: to,
                                value: value,
                                blockNumber: b.blockHeight
                            });
                            existingTxs = existingTxs.slice(0, MAX_TXS);
                        }
                    }
                });
            }
        }

        // LƯU VÀO REDIS
        const pipeline = redis.pipeline();
        pipeline.set(`blocks:${chain}`, JSON.stringify(existingBlocks), { EX: CACHE_EXPIRE_SECONDS });
        pipeline.set(`txs:${chain}`, JSON.stringify(existingTxs), { EX: CACHE_EXPIRE_SECONDS });
        pipeline.set(`stats:${chain}`, JSON.stringify({
            blockNumber: latestSlot,
            gasPrice: '0'
        }), { EX: CACHE_EXPIRE_SECONDS });
        await pipeline.exec();

        console.log(`[${chain}] Updated successfully. Block: ${latestSlot}, Total blocks: ${existingBlocks.length}, Total txs: ${existingTxs.length}`);

    } catch (err) {
        console.error(`[${chain}] Error:`, err.message);
    }
}

// Hàm khởi chạy chính
async function runWorker() {
    const chains = Object.keys(RPC_URLS);
    await updateAllPrices();
    for (const chain of chains) {
        const rpcUrl = RPC_URLS[chain];
        if (['bitcoin'].includes(chain)) {
            await processBitcoin(chain, rpcUrl);
        } else if (['solana'].includes(chain)) {
            await processSolana(chain, rpcUrl);
        } else {
            await processEVMChain(chain, rpcUrl);
        }
    }
    setInterval(async () => {
        await updateAllPrices();
        for (const chain of chains) {
            const rpcUrl = RPC_URLS[chain];
            if (['bitcoin'].includes(chain)) {
                await processBitcoin(chain, rpcUrl);
            } else if (['solana'].includes(chain)) {
                await processSolana(chain, rpcUrl);
            } else {
                await processEVMChain(chain, rpcUrl);
            }
        }
    }, 300000);
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