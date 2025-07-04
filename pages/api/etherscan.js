import axios from 'axios';
import winston from 'winston';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import helmet from 'helmet';
import axiosRetry from 'axios-retry';
import Cors from 'cors';
import { isAddress } from 'ethers';
import { requireAuth } from './middleware/auth'; // Assuming this middleware is for user authentication

// --- Logger Configuration ---
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
        new winston.transports.Console(),
        ...(process.env.NODE_ENV !== 'production'
            ? [
                new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
                new winston.transports.File({ filename: 'logs/combined.log' }),
            ]
            : []),
    ],
});

// --- Rate Limiting Configuration ---
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // Max 100 requests per minute per IP
    message: { error: 'Too many requests, please try again later.' },
    keyGenerator: (req) => {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
        return ip;
    },
    trustProxy: true,
});

const addressLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // Max 30 requests per minute per wallet address
    keyGenerator: (req) => req.body?.address || 'unknown-address',
    message: { error: 'Too many requests for this wallet address.' },
    trustProxy: true,
});

// --- Axios Retry Configuration ---
axiosRetry(axios, {
    retries: 5,
    retryDelay: (retryCount) => Math.min(retryCount * 2000, 10000), // Exponential backoff, max 10 seconds
    retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED',
    onRetry: (retryCount, error) => {
        logger.warn(`Retrying Etherscan API request (attempt ${retryCount})`, {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message,
        });
    },
});

// --- CORS Configuration ---
const cors = Cors({
    origin: (origin, callback) => {
        const allowedOrigins = [
            process.env.NEXT_PUBLIC_APP_URL,
            'http://localhost:3000',
            'https://xynapse-ai.vercel.app',
        ].filter(Boolean);
        logger.info(`CORS check: Origin ${origin || 'undefined'}, Allowed origins: ${allowedOrigins}`);
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            logger.error(`CORS error: Origin ${origin} not allowed`, { allowedOrigins });
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['POST'],
});

// --- Request Validation Rules ---
const validate = [
    body('action')
        .isString()
        .isIn(['wallet-balances', 'transactions', 'token-supply', 'token-info']) // Added token-supply and token-info for Etherscan specific functionality
        .withMessage('Invalid action'),
    body('chain')
        .isString()
        .notEmpty()
        .withMessage('Chain is required'), // Etherscan API base URL depends on the chain
    body('address')
        .if(body('action').isIn(['wallet-balances', 'transactions']))
        .notEmpty()
        .isString()
        .matches(/^0x[a-fA-F0-9]{40}$/)
        .withMessage('Wallet address must be a valid EVM address'),
    body('tokenAddress')
        .if(body('action').isIn(['token-supply', 'token-info'])) // Only require tokenAddress for token-specific actions
        .isString()
        .matches(/^0x[a-fA-F0-9]{40}$/)
        .withMessage('Token address must be a valid EVM address'),
];

// --- Etherscan API Base URLs ---
const ETHERSCAN_API_URLS = {
    ethereum: 'https://api.etherscan.io/api',
    sepolia: 'https://api-sepolia.etherscan.io/api',
    bnb: 'https://api.bscscan.com/api', // Binance Smart Chain
    polygon: 'https://api.polygonscan.com/api',
    arbitrum: 'https://api.arbiscan.io/api',
    optimism: 'https://api-optimistic.etherscan.io/api',
    // Add more chains as needed, e.g., fantom, avalanche_c
    // fantom: 'https://api.ftmscan.com/api',
    // avalanche_c: 'https://api.snowtrace.io/api',
};

export const config = { api: { bodyParser: { sizeLimit: '10kb' } } };

export default async function handler(req, res) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
    const startTime = Date.now();
    logger.info(`Request to ${req.url} from IP ${ip}, body: ${JSON.stringify(req.body)}`);

    try {
        await new Promise((resolve, reject) => {
            cors(req, res, (err) => (err ? reject(err) : resolve()));
        });

        helmet()(req, res, () => { });

        await Promise.all([
            new Promise((resolve, reject) => limiter(req, res, (err) => (err ? reject(err) : resolve()))),
            new Promise((resolve, reject) => addressLimiter(req, res, (err) => (err ? reject(err) : resolve()))),
        ]);
    } catch (err) {
        logger.error(`Rate limit error: ${err.message}`, { ip });
        return res.status(429).json({ detail: 'Too many requests, please try again later.' });
    }

    if (req.method !== 'POST') {
        logger.warn(`Method not allowed: ${req.method}`, { ip });
        return res.status(405).json({ detail: 'Method not allowed' });
    }

    await Promise.all(validate.map((validation) => validation.run(req)));
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`, { ip });
        return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
    }

    const { chain, action, address, tokenAddress } = req.body;

    if (!process.env.ETHERSCAN_API_KEY) {
        logger.error('ETHERSCAN_API_KEY is not configured');
        return res.status(500).json({ detail: 'Server configuration error: Missing ETHERSCAN_API_KEY' });
    }

    const etherscanBaseUrl = ETHERSCAN_API_URLS[chain?.toLowerCase()];
    if (!etherscanBaseUrl) {
        logger.warn(`Unsupported chain for Etherscan: ${chain}`, { ip });
        return res.status(400).json({ detail: `Unsupported chain for Etherscan: ${chain}` });
    }

    // Authentication for specific actions (similar to sim.js)
    if (['wallet-balances', 'transactions'].includes(action)) {
        const internalToken = req.headers['x-internal-token'];
        if (process.env.NODE_ENV === 'development' && internalToken === process.env.INTERNAL_API_TOKEN) {
            logger.info(`Bypassing auth with internal token for ${action}`, { ip });
        } else {
            try {
                await new Promise((resolve, reject) => {
                    requireAuth(req, res, (err) => (err ? reject(err) : resolve()));
                });
            } catch (err) {
                logger.error(`Authentication error: ${err.message}`, { ip });
                return res.status(401).json({ detail: 'Unauthorized: Please log in.' });
            }
        }
    }

    // Validate EVM address if provided for wallet-related actions
    if (address && !isAddress(address)) {
        logger.warn(`Invalid EVM address: ${address}`, { ip });
        return res.status(400).json({ detail: 'Invalid EVM address' });
    }

    try {
        let apiUrl = '';
        let data = [];

        if (action === 'transactions' && address) {
            // Etherscan: Get a list of 'Normal' Transactions By Address
            apiUrl = `${etherscanBaseUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info(`Calling Etherscan API for transactions: ${apiUrl}`, { ip });
            const response = await axios.get(apiUrl, { timeout: 15000 });

            if (response.data.status === '1' && Array.isArray(response.data.result)) {
                data = response.data.result.map(tx => ({
                    chain: chain,
                    hash: tx.hash,
                    from: tx.from,
                    to: tx.to,
                    value: '0x' + (parseInt(tx.value) || 0).toString(16), // Convert wei to hex string
                    block_time: new Date(parseInt(tx.timeStamp) * 1000).toISOString(), // Convert Unix timestamp to ISO string
                    gasUsed: tx.gasUsed,
                    gasPrice: tx.gasPrice,
                    input: tx.input,
                    isError: tx.isError === '1',
                }));
            } else {
                logger.warn(`Etherscan API returned status ${response.data.status} for transactions: ${response.data.message}`, { ip, address });
            }
            logger.info(`Transactions response for address ${address}: ${data.length} transactions, time: ${Date.now() - startTime}ms`, { ip });
            return res.status(200).json({ success: true, data });

        } else if (action === 'wallet-balances' && address) {
            // Etherscan: Get Ether Balance for a Single Address
            apiUrl = `${etherscanBaseUrl}?module=account&action=balance&address=${address}&tag=latest&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info(`Calling Etherscan API for balance: ${apiUrl}`, { ip });
            const response = await axios.get(apiUrl, { timeout: 15000 });

            if (response.data.status === '1' && typeof response.data.result === 'string') {
                const ethBalanceWei = parseInt(response.data.result);
                // For ERC-20 token balances, Etherscan requires a separate call per token.
                // Fetching all ERC-20 balances for a wallet is not as straightforward as Dune's API.
                // A common approach is to list popular tokens and check balance for each.
                // For simplicity, this example only fetches native coin balance.
                // To get ERC-20 balances, you'd need to use 'tokenbalance' action for each token.

                data = [{
                    chain: chain,
                    chain_id: null, // Etherscan doesn't return chain_id directly for balance
                    address: address,
                    symbol: chain === 'ethereum' ? 'ETH' : (chain === 'bnb' ? 'BNB' : 'Native'),
                    decimals: 18, // Native coin usually 18 decimals
                    amount: ethBalanceWei / Math.pow(10, 18),
                    price_usd: 0, // Etherscan balance API doesn't return price_usd directly
                    value_usd: 0, // Requires external price lookup
                    logo: null,
                }];
            } else {
                logger.warn(`Etherscan API returned status ${response.data.status} for balance: ${response.data.message}`, { ip, address });
            }
            logger.info(`Wallet balances response for address ${address}: ${data.length} tokens, time: ${Date.now() - startTime}ms`, { ip });
            return res.status(200).json({ success: true, data });

        } else if (action === 'token-supply' && tokenAddress) {
            // Etherscan: Get Token TotalSupply
            apiUrl = `${etherscanBaseUrl}?module=stats&action=tokensupply&contractaddress=${tokenAddress}&apikey=${process.env.ETHERSCAN_API_KEY}`;
            logger.info(`Calling Etherscan API for token supply: ${apiUrl}`, { ip });
            const response = await axios.get(apiUrl, { timeout: 15000 });

            if (response.data.status === '1' && typeof response.data.result === 'string') {
                const supply = response.data.result;
                return res.status(200).json({ success: true, data: { tokenAddress, totalSupply: supply } });
            } else {
                logger.warn(`Etherscan API returned status ${response.data.status} for token supply: ${response.data.message}`, { ip, tokenAddress });
                return res.status(404).json({ success: false, detail: 'Token supply not found or invalid token address.' });
            }

        } else if (action === 'token-info' && tokenAddress) {
            // Etherscan: Get ERC20 Token Account Balance for TokenContractAddress
            // This API gives the balance of a specific wallet for a specific token.
            // Etherscan doesn't have a direct 'get token info by address' like Dune.
            // The best way to get general token info (name, symbol, decimals) is via a smart contract call
            // or by querying transaction data where the token is involved.
            // For now, we'll return a placeholder. For actual usage, you'd integrate a web3 library
            // like ethers.js to call contract methods (name(), symbol(), decimals()).
            logger.warn(`'token-info' action not fully supported by Etherscan directly. Requires contract interaction for full details.`, { ip, tokenAddress });
            return res.status(200).json({ success: true, data: { tokenAddress, name: 'Unknown', symbol: 'Unknown', decimals: 0, note: 'Requires contract interaction for full details' } });

        }

        logger.warn(`Invalid parameters for action: ${action}`, { ip });
        return res.status(400).json({ detail: `Invalid parameters for action: ${action}` });

    } catch (error) {
        logger.error(`Etherscan API error for action ${action}: ${error.message}`, {
            status: error.response?.status,
            data: error.response?.data,
            stack: error.stack,
            ip,
        });
        const status = error.response?.status || 500;
        const detail =
            status === 429
                ? 'Etherscan API rate limit exceeded, please try again later.'
                : status === 404
                    ? 'Requested data not found.'
                    : `Etherscan API error: ${error.message}`;
        return res.status(status).json({ detail });
    }
}