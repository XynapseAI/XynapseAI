import 'dotenv/config';
import { Redis } from '@upstash/redis';
import fetch from 'node-fetch';
import process from 'process'; 

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
    linea: 'https://linea-rpc.publicnode.com',
    unichain: 'https://unichain-rpc.publicnode.com',
    bitcoin: 'https://bitcoin-rpc.publicnode.com',
    solana: 'https://solana-rpc.publicnode.com',
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
    linea: 'ethereum',
    unichain: 'ethereum',
    bitcoin: 'bitcoin',
    solana: 'solana',
    monad: 'monad',
    hyperevm: 'hyperevm',
};

const MAX_BLOCKS = 100; 
const MAX_TXS = 1000; 
const INITIAL_FETCH_COUNT = 20;
const MAX_NEW_FETCH_PER_UPDATE = 5; 
const CACHE_EXPIRE_SECONDS = 600; 
const CONCURRENCY_LIMIT = 2; 

// FIXED: Proper semaphore
function createSemaphore(limit) {
    let active = 0;
    let queue = [];
    return {
        async acquire() {
            return new Promise((resolve) => {
                const task = () => {
                    active++;
                    const release = () => {
                        active--;
                        if (queue.length) {
                            const next = queue.shift();
                            next();
                        }
                    };
                    resolve({ release, run: release }); 
                };
                if (active < limit) task();
                else queue.push(task);
            });
        }
    };
}

// FIXED: Log memory helper
function logMemory(chain = '') {
    const usage = process.memoryUsage();
    console.log(`[${chain}] Memory - RSS: ${(usage.rss / 1024 / 1024).toFixed(2)}MB, Heap: ${(usage.heapUsed / 1024 / 1024).toFixed(2)}MB`);
}

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

// updateAllPrices
async function updateAllPrices() {
    const uniqueIds = [...new Set(Object.values(PRICE_ID))];
    const idsStr = uniqueIds.join(',');
    let priceData = {};
    try {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${idsStr}&vs_currencies=usd`);
        if (!res.ok) throw new Error(`CoinGecko Status ${res.status}`);
        
        const buffer = await res.arrayBuffer();
        const responseSizeKB = buffer.byteLength / 1024;
        
        const decoder = new TextDecoder();
        const jsonString = decoder.decode(buffer);
        priceData = JSON.parse(jsonString);
        
        console.log(`[PRICES] Batch fetched ${uniqueIds.length} IDs, response size: ${responseSizeKB.toFixed(2)} KB`);
    } catch (e) {
        console.error('Price batch fetch error:', e.message);
    }

    const pipeline = redis.pipeline();
    for (const [chain, id] of Object.entries(PRICE_ID)) {
        let price = priceData[id]?.usd || null;
        if (price === null) {
            price = (await redis.get(`price:${chain}`)) || 0;
        }
        pipeline.set(`price:${chain}`, price, { EX: 3600 });
    }
    await pipeline.exec();
    logMemory('PRICES'); // FIXED: Log memory prices
}

async function processEVMChain(chain, rpcUrl) {
    try {
        console.log(`[${chain}] Updating...`);
        logMemory(chain); 

        const latestHex = await fetchRPC(rpcUrl, 'eth_blockNumber');
        const latest = parseInt(latestHex, 16);

        let existingBlocks = JSON.parse(await redis.get(`blocks:${chain}`)) || [];
        let existingTxs = JSON.parse(await redis.get(`txs:${chain}`)) || [];

        const storedLatest = existingBlocks[0]?.number || 0;
        const newBlocksCount = latest - storedLatest;
        if (newBlocksCount <= 0 && existingBlocks.length > 0) {
            console.log(`[${chain}] No new blocks, skipping fetch.`);
            return;
        }

        const semaphore = createSemaphore(CONCURRENCY_LIMIT);

        if (existingBlocks.length === 0) {
            const isBusyChain = ['ethereum', 'bsc'].includes(chain);
            const results = [];
            for (let i = 0; i < INITIAL_FETCH_COUNT; i++) {
                const blockNumHex = '0x' + (latest - i).toString(16);
                const sem = await semaphore.acquire();
                try {
                    const blockData = await fetchRPC(rpcUrl, 'eth_getBlockByNumber', [blockNumHex, true]);
                    results.push(blockData);
                } finally {
                    sem.release(); // FIXED: Call release
                }
            }

            existingBlocks = results.filter(b => b).map(b => ({
                number: parseInt(b.number, 16),
                hash: b.hash,
                timestamp: parseInt(b.timestamp, 16),
                miner: b.miner,
                transactions: b.transactions.map(t => typeof t === 'object' ? t.hash : t),
                baseFeePerGas: b.baseFeePerGas ? { type: 'BigNumber', hex: b.baseFeePerGas } : null,
            }));

            const txPerBlock = isBusyChain ? 30 : 50;
            results.forEach(block => {
                if (block?.transactions) {
                    const blockTxs = block.transactions.slice(0, txPerBlock).map(tx => ({
                        hash: tx.hash,
                        from: tx.from?.toLowerCase() || null,
                        to: tx.to?.toLowerCase() || null,
                        value: tx.value ? BigInt(tx.value).toString() : "0",
                        blockNumber: parseInt(block.number, 16)
                    }));
                    existingTxs = [...blockTxs, ...existingTxs].slice(0, MAX_TXS);
                }
            });
        } else {
            const blocksToFetch = Math.min(newBlocksCount, MAX_NEW_FETCH_PER_UPDATE);
            const results = [];
            for (let i = 0; i < blocksToFetch; i++) {
                const blockNumHex = '0x' + (latest - i).toString(16);
                const sem = await semaphore.acquire();
                try {
                    const blockData = await fetchRPC(rpcUrl, 'eth_getBlockByNumber', [blockNumHex, true]);
                    results.push(blockData);
                } finally {
                    sem.release();
                }
            }

            const newBlocks = results.filter(b => b).map(b => ({
                number: parseInt(b.number, 16),
                hash: b.hash,
                timestamp: parseInt(b.timestamp, 16),
                miner: b.miner,
                transactions: b.transactions.map(t => typeof t === 'object' ? t.hash : t),
                baseFeePerGas: b.baseFeePerGas ? { type: 'BigNumber', hex: b.baseFeePerGas } : null,
            }));

            existingBlocks = [...newBlocks, ...existingBlocks].slice(0, MAX_BLOCKS);

            const isBusyChain = ['ethereum', 'bsc'].includes(chain);
            const txPerBlock = isBusyChain ? 30 : 50;
            results.slice(0, 2).forEach(block => {
                if (block?.transactions) {
                    const blockTxs = block.transactions.slice(0, txPerBlock).map(tx => ({
                        hash: tx.hash,
                        from: tx.from?.toLowerCase() || null,
                        to: tx.to?.toLowerCase() || null,
                        value: tx.value ? BigInt(tx.value).toString() : "0",
                        blockNumber: parseInt(block.number, 16)
                    }));
                    existingTxs = [...blockTxs, ...existingTxs].slice(0, MAX_TXS);
                }
            });
        }

        const blocksJson = JSON.stringify(existingBlocks);
        const txsJson = JSON.stringify(existingTxs);
        console.log(`[${chain}] JSON sizes - Blocks: ${(blocksJson.length / 1024).toFixed(2)} KB, Txs: ${(txsJson.length / 1024).toFixed(2)} KB`);

        const pipeline = redis.pipeline();
        pipeline.set(`blocks:${chain}`, blocksJson, { EX: CACHE_EXPIRE_SECONDS });
        pipeline.set(`txs:${chain}`, txsJson, { EX: CACHE_EXPIRE_SECONDS });
        pipeline.set(`stats:${chain}`, JSON.stringify({
            blockNumber: latest,
            gasPrice: existingBlocks[0]?.baseFeePerGas ? parseInt(existingBlocks[0].baseFeePerGas.hex, 16).toString() : '0'
        }), { EX: CACHE_EXPIRE_SECONDS });
        await pipeline.exec();

        console.log(`[${chain}] Updated. Block: ${latest}, Blocks: ${existingBlocks.length}, Txs: ${existingTxs.length}`);
        logMemory(chain);
    } catch (err) {
        console.error(`[${chain}] Error:`, err.message);
        logMemory(chain + '-ERROR');
    }
}

async function processBitcoin(chain, rpcUrl) {
    try {
        console.log(`[${chain}] Updating...`);
        logMemory(chain);

        const latest = await fetchRPC(rpcUrl, 'getblockcount');

        let existingBlocks = JSON.parse(await redis.get(`blocks:${chain}`)) || [];
        let existingTxs = JSON.parse(await redis.get(`txs:${chain}`)) || [];

        const storedLatest = existingBlocks[0]?.number || 0;
        const newBlocksCount = latest - storedLatest;
        if (newBlocksCount <= 0 && existingBlocks.length > 0) {
            console.log(`[${chain}] No new blocks, skipping.`);
            return;
        }

        const semaphore = createSemaphore(CONCURRENCY_LIMIT);

        if (existingBlocks.length === 0) {
            const results = [];
            for (let i = 0; i < INITIAL_FETCH_COUNT; i++) {
                const height = latest - i;
                const sem = await semaphore.acquire();
                try {
                    const hash = await fetchRPC(rpcUrl, 'getblockhash', [height]);
                    const block = await fetchRPC(rpcUrl, 'getblock', [hash, 2]);
                    results.push(block);
                } finally {
                    sem.release();
                }
            }

            existingBlocks = results.filter(b => b).map(b => ({
                number: b.height,
                hash: b.hash,
                timestamp: b.time,
                miner: b.tx[0].vout[0].scriptPubKey.addresses ? b.tx[0].vout[0].scriptPubKey.addresses[0] : null,
                transactions: b.tx.map(tx => tx.txid),
            }));

            // FIXED: Tx limit 20/block
            for (const block of results) {
                if (block && block.tx) {
                    const limitedTxs = block.tx.slice(0, 20);
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
            const blocksToFetch = Math.min(newBlocksCount, MAX_NEW_FETCH_PER_UPDATE);
            const results = [];
            for (let i = 0; i < blocksToFetch; i++) {
                const height = latest - i;
                const sem = await semaphore.acquire();
                try {
                    const hash = await fetchRPC(rpcUrl, 'getblockhash', [height]);
                    const block = await fetchRPC(rpcUrl, 'getblock', [hash, 2]);
                    results.push(block);
                } finally {
                    sem.release();
                }
            }

            const newBlocks = results.filter(b => b).map(b => ({
                number: b.height,
                hash: b.hash,
                timestamp: b.time,
                miner: b.tx[0].vout[0].scriptPubKey.addresses ? b.tx[0].vout[0].scriptPubKey.addresses[0] : null,
                transactions: b.tx.map(tx => tx.txid),
            }));

            existingBlocks = [...newBlocks, ...existingBlocks].slice(0, MAX_BLOCKS);

            // FIXED: Tx từ 2 blocks, 20/block
            for (const block of results.slice(0, 2)) {
                if (block && block.tx) {
                    const limitedTxs = block.tx.slice(0, 20);
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

        const blocksJson = JSON.stringify(existingBlocks);
        const txsJson = JSON.stringify(existingTxs);
        console.log(`[${chain}] JSON sizes - Blocks: ${(blocksJson.length / 1024).toFixed(2)} KB, Txs: ${(txsJson.length / 1024).toFixed(2)} KB`);

        const pipeline = redis.pipeline();
        pipeline.set(`blocks:${chain}`, blocksJson, { EX: CACHE_EXPIRE_SECONDS });
        pipeline.set(`txs:${chain}`, txsJson, { EX: CACHE_EXPIRE_SECONDS });
        pipeline.set(`stats:${chain}`, JSON.stringify({
            blockNumber: latest,
            gasPrice: '0'
        }), { EX: CACHE_EXPIRE_SECONDS });
        await pipeline.exec();

        console.log(`[${chain}] Updated. Block: ${latest}, Blocks: ${existingBlocks.length}, Txs: ${existingTxs.length}`);
        logMemory(chain);
    } catch (err) {
        console.error(`[${chain}] Error:`, err.message);
        logMemory(chain + '-ERROR');
    }
}

async function processSolana(chain, rpcUrl) {
    try {
        console.log(`[${chain}] Updating...`);
        logMemory(chain);

        const latestSlot = await fetchRPC(rpcUrl, 'getSlot');

        let existingBlocks = JSON.parse(await redis.get(`blocks:${chain}`)) || [];
        let existingTxs = JSON.parse(await redis.get(`txs:${chain}`)) || [];

        const storedLatest = existingBlocks[0]?.number || 0;
        const newSlotsCount = latestSlot - storedLatest;
        if (newSlotsCount <= 0 && existingBlocks.length > 0) {
            console.log(`[${chain}] No new slots, skipping.`);
            return;
        }

        const semaphore = createSemaphore(CONCURRENCY_LIMIT);

        if (existingBlocks.length === 0) {
            const results = [];
            let currentSlot = latestSlot;
            let fetched = 0;
            while (fetched < INITIAL_FETCH_COUNT) {
                const sem = await semaphore.acquire();
                try {
                    const block = await fetchRPC(rpcUrl, 'getBlock', [currentSlot, { transactionDetails: 'full', rewards: true, maxSupportedTransactionVersion: 0 }]);
                    results.push(block);
                } finally {
                    sem.release();
                }
                currentSlot--;
                fetched++;
            }
            const validResults = results.filter(b => b);

            existingBlocks = validResults.map(b => ({
                number: b.blockHeight,
                hash: b.blockhash,
                timestamp: b.blockTime,
                miner: b.rewards ? b.rewards.find(r => r.rewardType === 'fee')?.pubkey || null : null,
                transactions: b.transactions ? b.transactions.map(t => t.transaction.signatures[0]) : [],
            }));

            validResults.forEach(b => {
                if (b.transactions) {
                    const limitedTxs = b.transactions.slice(0, 50);
                    for (const tx of limitedTxs) {
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
            const slotsToFetch = Math.min(newSlotsCount, 2);
            const results = [];
            let currentSlot = latestSlot;
            let toFetch = slotsToFetch;
            while (toFetch > 0) {
                const sem = await semaphore.acquire();
                try {
                    const block = await fetchRPC(rpcUrl, 'getBlock', [currentSlot, { transactionDetails: 'full', rewards: true, maxSupportedTransactionVersion: 0 }]);
                    results.push(block);
                } finally {
                    sem.release();
                }
                currentSlot--;
                toFetch--;
            }
            const newValidResults = results.filter(b => b);

            const newBlocks = newValidResults.map(b => ({
                number: b.blockHeight,
                hash: b.blockhash,
                timestamp: b.blockTime,
                miner: b.rewards ? b.rewards.find(r => r.rewardType === 'fee')?.pubkey || null : null,
                transactions: b.transactions ? b.transactions.map(t => t.transaction.signatures[0]) : [],
            }));

            existingBlocks = [...newBlocks, ...existingBlocks].slice(0, MAX_BLOCKS);

            // FIXED: Txs 1 block, limit 50
            newValidResults.slice(0, 1).forEach(b => {
                if (b.transactions) {
                    const limitedTxs = b.transactions.slice(0, 50);
                    for (const tx of limitedTxs) {
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

        const blocksJson = JSON.stringify(existingBlocks);
        const txsJson = JSON.stringify(existingTxs);
        console.log(`[${chain}] JSON sizes - Blocks: ${(blocksJson.length / 1024).toFixed(2)} KB, Txs: ${(txsJson.length / 1024).toFixed(2)} KB`);

        const pipeline = redis.pipeline();
        pipeline.set(`blocks:${chain}`, blocksJson, { EX: CACHE_EXPIRE_SECONDS });
        pipeline.set(`txs:${chain}`, txsJson, { EX: CACHE_EXPIRE_SECONDS });
        pipeline.set(`stats:${chain}`, JSON.stringify({
            blockNumber: latestSlot,
            gasPrice: '0'
        }), { EX: CACHE_EXPIRE_SECONDS });
        await pipeline.exec();

        console.log(`[${chain}] Updated. Slot: ${latestSlot}, Blocks: ${existingBlocks.length}, Txs: ${existingTxs.length}`);
        logMemory(chain);
    } catch (err) {
        console.error(`[${chain}] Error:`, err.message);
        logMemory(chain + '-ERROR');
    }
}

async function runWorker() {
    const chains = Object.keys(RPC_URLS);
    try {
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
    } catch (err) {
        console.error('runWorker error:', err.message);
    }
    setInterval(async () => {
        try {
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
        } catch (err) {
            console.error('Interval error:', err.message);
        }
    }, 600000);
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