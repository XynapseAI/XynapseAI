// cron-worker/index.js
import 'dotenv/config';
import { getHighVolumeWallets } from '../lib/analysisStorage.js';
import pkg from '../utils/logger.cjs';
import { db } from '../utils/firebaseAdmin.js';
import axios from 'axios';
import fs from 'fs/promises';
import { isAddress } from 'ethers';
import { fetchBlockchainData } from '../lib/blockchainData.js';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { logger } = pkg;
const ANALYZE_WALLETS_API_URL = process.env.NEXTAUTH_URL + '/api/analyze-wallets';
const WALLET_FILE_PATH = process.env.WALLET_FILE_PATH || path.join(__dirname, 'wallets.json');
const PENDING_WALLETS_COLLECTION = 'pending_wallets_to_analyze';
const ETH_PRICE_COLLECTION = 'eth_price';
const API_KEYS_COLLECTION = 'api_keys';
const MAX_WALLETS_PER_RUN = 200;
const DEFAULT_ETH_PRICE_USD = 2000;
const PRICE_CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 giờ
const API_KEY_DURATION_MS = 24 * 60 * 60 * 1000; // 24 giờ
const CRON_USER_AGENT = 'CronWorker/1.0';
const HMAC_SECRET = process.env.HMAC_SECRET || crypto.randomBytes(32).toString('hex'); // Tạo secret ngẫu nhiên nếu không có

async function generateApiKey() {
    try {
        const apiKey = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + API_KEY_DURATION_MS);
        await db.collection(API_KEYS_COLLECTION).doc(apiKey).set({
            createdAt: new Date().toISOString(),
            expiresAt: expiresAt.toISOString(),
            active: true
        });
        logger.info(`Generated new API key: ${apiKey}, expires at ${expiresAt}`);
        return apiKey;
    } catch (error) {
        logger.error(`Error generating API key: ${error.message}`, { stack: error.stack });
        return null;
    }
}

async function getValidApiKey() {
    try {
        const snapshot = await db.collection(API_KEYS_COLLECTION)
            .where('active', '==', true)
            .where('expiresAt', '>=', new Date().toISOString())
            .limit(1)
            .get();
        
        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            logger.info(`Using existing API key: ${doc.id}`);
            return doc.id;
        }

        logger.info('No valid API key found, generating new one...');
        return await generateApiKey();
    } catch (error) {
        logger.error(`Error getting valid API key: ${error.message}`, { stack: error.stack });
        return null;
    }
}

function generateHmacSignature(payload, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
}

async function readWalletFile() {
    try {
        logger.info(`Attempting to read wallet file at: ${WALLET_FILE_PATH}`);
        const fileContent = await fs.readFile(WALLET_FILE_PATH, 'utf-8');
        let wallets = [];
        if (WALLET_FILE_PATH.endsWith('.json')) {
            wallets = JSON.parse(fileContent);
        } else if (WALLET_FILE_PATH.endsWith('.csv')) {
            const lines = fileContent.trim().split('\n');
            const headers = lines[0].split(',');
            wallets = lines.slice(1).map(line => {
                const [address, name] = line.split(',');
                return { address, name };
            });
        } else {
            throw new Error('Unsupported file format. Use JSON or CSV.');
        }
        const validWallets = wallets
            .filter(wallet => isAddress(wallet.address))
            .map(wallet => ({
                address: wallet.address.toLowerCase(),
                name: wallet.name || 'Unknown'
            }));
        if (validWallets.length === 0) {
            logger.warn('No valid wallet addresses found in the file.');
        } else {
            logger.info(`Loaded ${validWallets.length} valid wallet addresses from ${WALLET_FILE_PATH}: ${validWallets.map(w => w.address).join(', ')}`);
        }
        return validWallets;
    } catch (error) {
        logger.error(`Error reading wallet file ${WALLET_FILE_PATH}: ${error.message}`, { stack: error.stack });
        return [];
    }
}

async function findDepositWallets(primaryWallets, chain = 'ethereum', txLimit = 500) {
    const depositWallets = new Set();
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    for (const primaryWallet of primaryWallets) {
        logger.info(`Fetching transactions for primary wallet ${primaryWallet.address} (${primaryWallet.name}) to find deposit wallets...`);
        const txData = await fetchBlockchainData(primaryWallet.address, 'transactions', false, txLimit, chain);
        if (!txData || txData.length === 0) {
            logger.info(`No transactions found for primary wallet ${primaryWallet.address}.`);
            continue;
        }

        const recentIncomingTxs = txData.filter(tx => {
            try {
                return tx.to.toLowerCase() === primaryWallet.address.toLowerCase() && new Date(tx.block_time) >= last24Hours;
            } catch {
                logger.warn(`Invalid block_time for tx in wallet ${primaryWallet.address}: ${tx.block_time}. Skipping.`);
                return false;
            }
        });

        recentIncomingTxs.forEach(tx => {
            if (isAddress(tx.from)) {
                depositWallets.add(tx.from.toLowerCase());
            }
        });
        logger.info(`Found ${recentIncomingTxs.length} incoming transactions within last 24 hours for ${primaryWallet.address}, ${depositWallets.size} unique deposit wallets.`);
    }
    return Array.from(depositWallets);
}

async function getPendingWallets() {
    try {
        const snapshot = await db.collection(PENDING_WALLETS_COLLECTION).get();
        const pendingWallets = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (isAddress(data.address)) {
                pendingWallets.push({
                    address: data.address.toLowerCase(),
                    primaryWallet: data.primaryWallet,
                    primaryWalletName: data.primaryWalletName
                });
            }
        });
        logger.info(`Loaded ${pendingWallets.length} pending wallets from Firestore.`);
        return pendingWallets;
    } catch (error) {
        logger.error(`Error fetching pending wallets from Firestore: ${error.message}`, { stack: error.stack });
        return [];
    }
}

async function savePendingWallets(wallets) {
    try {
        const batch = db.batch();
        for (const wallet of wallets) {
            batch.set(db.collection(PENDING_WALLETS_COLLECTION).doc(wallet.address), {
                address: wallet.address,
                primaryWallet: wallet.primaryWallet,
                primaryWalletName: wallet.primaryWalletName,
                timestamp: new Date().toISOString()
            });
        }
        await batch.commit();
        logger.info(`Saved ${wallets.length} pending wallets to Firestore.`);
    } catch (error) {
        logger.error(`Error saving pending wallets to Firestore: ${error.message}`, { stack: error.stack });
    }
}

async function getEthPrice() {
    try {
        const priceDoc = await db.collection(ETH_PRICE_COLLECTION).doc('current').get();
        const now = Date.now();
        if (priceDoc.exists) {
            const { price, timestamp } = priceDoc.data();
            if (now - new Date(timestamp).getTime() < PRICE_CACHE_DURATION_MS) {
                logger.info(`Using cached ETH price: $${price}`);
                return price;
            }
        }

        logger.info('Fetching ETH price from CoinGecko...');
        const priceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', {
            timeout: 10000
        });
        const newPrice = priceResponse.data.ethereum.usd;
        await db.collection(ETH_PRICE_COLLECTION).doc('current').set({
            price: newPrice,
            timestamp: new Date().toISOString()
        });
        logger.info(`Fetched and cached ETH price: $${newPrice}`);
        return newPrice;
    } catch (error) {
        logger.warn(`Failed to fetch or save ETH price: ${error.message}. Using default: $${DEFAULT_ETH_PRICE_USD}`);
        return DEFAULT_ETH_PRICE_USD;
    }
}

async function withRetry(operation, maxAttempts = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (e) {
            if (attempt === maxAttempts) {
                throw e;
            }
            logger.warn(`Attempt ${attempt} failed: ${e.message}. Retrying after ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

async function runHighVolumeWalletAnalysis() {
    logger.info('Cron job started at: ' + new Date().toISOString());
    logger.info(`Environment variables - ANALYZE_WALLETS_API_URL: ${ANALYZE_WALLETS_API_URL}, WALLET_FILE_PATH: ${WALLET_FILE_PATH}`);

    if (!ANALYZE_WALLETS_API_URL) {
        logger.error('Missing environment variable: NEXTAUTH_URL');
        return;
    }

    try {
        // Bước 1: Lấy hoặc tạo API key
        const apiKey = await getValidApiKey();
        if (!apiKey) {
            logger.error('Failed to get or generate API key. Aborting cron job.');
            return;
        }

        // Bước 2: Lấy giá ETH một lần cho toàn bộ cron job
        const currentEthPriceUsd = await getEthPrice();
        logger.info(`Using ETH price $${currentEthPriceUsd} for all analyses.`);

        // Bước 3: Đọc ví từ file (Ví 1)
        logger.info('Reading primary wallets from file...');
        const primaryWallets = await readWalletFile();
        if (primaryWallets.length === 0) {
            logger.warn('No primary wallets to analyze. Skipping to high-volume wallets.');
        }

        // Bước 4: Tìm và phân tích Ví 2 (có giao dịch đến Ví 1 trong 24h)
        let walletsToAnalyze = [];
        if (primaryWallets.length > 0) {
            logger.info('Finding deposit wallets (Ví 2) sending to primary wallets...');
            const depositWallets = await findDepositWallets(primaryWallets);
            const pendingWallets = await getPendingWallets();

            // Kết hợp danh sách Ví 2 mới và Ví 2 chưa phân tích
            const allDepositWallets = [
                ...pendingWallets,
                ...depositWallets.map(address => ({
                    address,
                    primaryWallet: primaryWallets.find(w => depositWallets.includes(address))?.address || primaryWallets[0].address,
                    primaryWalletName: primaryWallets.find(w => depositWallets.includes(address))?.name || primaryWallets[0].name
                }))
            ].filter((v, i, a) => a.findIndex(t => t.address === v.address) === i); // Loại bỏ trùng lặp

            // Lấy tối đa MAX_WALLETS_PER_RUN ví để phân tích
            walletsToAnalyze = allDepositWallets.slice(0, MAX_WALLETS_PER_RUN);
            const remainingWallets = allDepositWallets.slice(MAX_WALLETS_PER_RUN);

            // Lưu các ví chưa phân tích vào Firestore
            if (remainingWallets.length > 0) {
                await savePendingWallets(remainingWallets);
            }

            logger.info(`Selected ${walletsToAnalyze.length} deposit wallets to analyze: ${walletsToAnalyze.map(w => w.address).join(', ')}`);
        }

        // Bước 5: Phân tích Ví 2
        if (walletsToAnalyze.length > 0) {
            logger.info('Triggering analysis for deposit wallets (Ví 2)...');
            for (const wallet of walletsToAnalyze) {
                try {
                    const identifyPayload = {
                        action: 'identify',
                        wallet_address: wallet.address,
                        chain: 'ethereum',
                        primary_target_wallet: wallet.primaryWallet,
                        eth_price_usd: currentEthPriceUsd
                    };
                    const identifySignature = generateHmacSignature(identifyPayload, HMAC_SECRET);

                    logger.info(`Sending identify request for deposit wallet: ${wallet.address} (to ${wallet.primaryWalletName})`);
                    const identifyResponse = await withRetry(() => axios.post(ANALYZE_WALLETS_API_URL, identifyPayload, {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-API-Key': apiKey,
                            'X-HMAC-Signature': identifySignature,
                            'User-Agent': CRON_USER_AGENT
                        },
                        timeout: 120000
                    }));
                    logger.info(`Identify response for deposit wallet ${wallet.address}: ${JSON.stringify(identifyResponse.data)}`);

                    const largeFlowPayload = {
                        action: 'detect-large-flow',
                        wallet_address: wallet.address,
                        chain: 'ethereum',
                        eth_price_usd: currentEthPriceUsd
                    };
                    const largeFlowSignature = generateHmacSignature(largeFlowPayload, HMAC_SECRET);

                    logger.info(`Sending detect-large-flow request for deposit wallet: ${wallet.address}`);
                    const largeFlowResponse = await withRetry(() => axios.post(ANALYZE_WALLETS_API_URL, largeFlowPayload, {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-API-Key': apiKey,
                            'X-HMAC-Signature': largeFlowSignature,
                            'User-Agent': CRON_USER_AGENT
                        },
                        timeout: 120000
                    }));
                    logger.info(`Large flow response for deposit wallet ${wallet.address}: ${JSON.stringify(largeFlowResponse.data)}`);

                    // Xóa ví khỏi pending_wallets sau khi phân tích thành công
                    await db.collection(PENDING_WALLETS_COLLECTION).doc(wallet.address).delete();
                } catch (apiError) {
                    logger.error(`Error analyzing deposit wallet ${wallet.address}: ${apiError.message}`, { stack: apiError.stack });
                    if (apiError.response) {
                        logger.error(`Response details: ${JSON.stringify(apiError.response.data)}`);
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } else {
            logger.info('No deposit wallets to analyze. Proceeding to high-volume wallets.');
        }

        // Bước 6: Phân tích ví high-volume
        logger.info('Fetching high-volume wallets...');
        const highVolumeWallets = await getHighVolumeWallets(
            'ethereum', 200, 500, 20, 1000, 50
        );
        if (highVolumeWallets.length === 0) {
            logger.warn('No high-volume wallets found.');
        } else {
            logger.info(`Found ${highVolumeWallets.length} high-volume wallets: ${highVolumeWallets.join(', ')}`);
        }

        logger.info('Triggering wallet analysis for high-volume wallets...');
        for (const wallet of highVolumeWallets) {
            try {
                const identifyPayload = {
                    action: 'identify',
                    wallet_address: wallet,
                    chain: 'ethereum',
                    primary_target_wallet: wallet,
                    eth_price_usd: currentEthPriceUsd
                };
                const identifySignature = generateHmacSignature(identifyPayload, HMAC_SECRET);

                logger.info(`Sending identify request for high-volume wallet: ${wallet}`);
                const identifyResponse = await withRetry(() => axios.post(ANALYZE_WALLETS_API_URL, identifyPayload, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': apiKey,
                        'X-HMAC-Signature': identifySignature,
                        'User-Agent': CRON_USER_AGENT
                    },
                    timeout: 120000
                }));
                logger.info(`Identify response for high-volume wallet ${wallet}: ${JSON.stringify(identifyResponse.data)}`);

                const largeFlowPayload = {
                    action: 'detect-large-flow',
                    wallet_address: wallet,
                    chain: 'ethereum',
                    eth_price_usd: currentEthPriceUsd
                };
                const largeFlowSignature = generateHmacSignature(largeFlowPayload, HMAC_SECRET);

                logger.info(`Sending detect-large-flow request for high-volume wallet: ${wallet}`);
                const largeFlowResponse = await withRetry(() => axios.post(ANALYZE_WALLETS_API_URL, largeFlowPayload, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': apiKey,
                        'X-HMAC-Signature': largeFlowSignature,
                        'User-Agent': CRON_USER_AGENT
                    },
                    timeout: 120000
                }));
                logger.info(`Large flow response for high-volume wallet ${wallet}: ${JSON.stringify(largeFlowResponse.data)}`);
            } catch (apiError) {
                logger.error(`Error analyzing high-volume wallet ${wallet}: ${apiError.message}`, { stack: apiError.stack });
                if (apiError.response) {
                    logger.error(`Response details: ${JSON.stringify(apiError.response.data)}`);
                }
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        logger.info('Cron job finished at: ' + new Date().toISOString());
    } catch (error) {
        logger.error(`Cron job failed: ${error.message}`, { stack: error.stack });
    }
}

runHighVolumeWalletAnalysis();