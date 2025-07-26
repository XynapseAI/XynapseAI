import axios from 'axios';
import winston from 'winston';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import helmet from 'helmet';
import axiosRetry from 'axios-retry';
import Cors from 'cors';
import { isAddress } from 'ethers';
import { requireAuth } from './middleware/auth.js';

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

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
    return ip;
  },
  trustProxy: true,
});

const addressLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.body?.address || 'unknown-address',
  message: { error: 'Too many requests for this wallet address.' },
  trustProxy: true,
});

axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => Math.min(retryCount * 2000, 10000),
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED',
  onRetry: (retryCount, error) => {
    logger.log('warn', `Retrying Dune API request (attempt ${retryCount})`, {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
  },
});

const cors = Cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_APP_URL,
      'http://localhost:3000',
      'https://xynapse-ai.vercel.app',
      'https://xynapseai.net',
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

const isValidSolanaAddress = (address) => {
  return address && address.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
};

const validate = [
  body('action')
    .isString()
    .isIn(['top-holders', 'wallet-balances', 'transactions', 'collectibles', 'proxy-image'])
    .withMessage('Invalid action'),
  body('imageUrl')
    .if(body('action').equals('proxy-image'))
    .isString()
    .notEmpty()
    .withMessage('Image URL is required for proxy-image action'),
  body('chain')
    .if(body('action').equals('top-holders'))
    .isString()
    .notEmpty()
    .withMessage('Chain required for top-holders'),
  body('tokenAddress')
    .if(body('action').equals('top-holders'))
    .isString()
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Token address must be a valid EVM address for top-holders'),
  body('address')
    .if(body('action').isIn(['wallet-balances', 'transactions', 'collectibles']))
    .notEmpty()
    .isString()
    .custom((value, { req }) => {
      const { action } = req.body;
      if (action === 'top-holders') return true;
      const isEVM = isAddress(value);
      const isSVM = isValidSolanaAddress(value);
      if (!isEVM && !isSVM) {
        throw new Error('Wallet address must be a valid EVM or Solana address');
      }
      return true;
    }),
  body('decimalPlace')
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage('Decimal place must be a non-negative integer'),
  body('limit')
    .optional({ nullable: true })
    .isInt({ min: 1, max: 500 })
    .withMessage('Limit must be an integer between 1 and 500'),
];

const CHAIN_ID_MAP = {
  abstract: '2741',
  ancient8: '888888888',
  ape_chain: '33139',
  arbitrum: '42161',
  arbitrum_nova: '42170',
  avalanche_c: '43114',
  avalanche_fuji: '43113',
  base: '8453',
  base_sepolia: '84532',
  berachain: '80094',
  blast: '81457',
  bnb: '56',
  bob: '60808',
  boba: '288',
  celo: '42220',
  corn: '21000000',
  cyber: '7560',
  degen: '666666666',
  ethereum: '1',
  fantom: '250',
  flare: '14',
  gnosis: '100',
  ham: '5112',
  hychain: '2911',
  ink: '57073',
  kaia: '8217',
  linea: '59144',
  lisk: '1135',
  mantle: '5000',
  metis: '1088',
  mint: '185',
  mode: '34443',
  omni: '166',
  opbnb: '204',
  optimism: '10',
  polygon: '137',
  proof_of_play: '70700',
  rari: '1380012617',
  redstone: '690',
  scroll: '534352',
  sei: '1329',
  sepolia: '11155111',
  shape: '360',
  soneium: '1868',
  sonic: '146',
  superseed: '5330',
  swellchain: '1923',
  unichain: '130',
  wemix: '1111',
  world: '480',
  xai: '660279',
  zero_network: '543210',
  zkevm: '1101',
  zksync: '324',
  zora: '7777777',
};

const SUPPORTED_SVM_CHAINS = ['solana', 'eclipse'];
const SUPPORTED_CHAIN_IDS = Object.values(CHAIN_ID_MAP).join(',');

// Native token metadata for SVM chains
const NATIVE_TOKEN_METADATA = {
  solana: { symbol: 'SOL', logo: '/solana-logo.png', name: 'Solana' },
  eclipse: { symbol: 'ECL', logo: '/eclipse-logo.png', name: 'Eclipse' },
};

// Function to fetch actual image URL from metadata endpoint
const fetchImageUrl = async (metadataUrl, ip) => {
  try {
    const blockedDomains = ['scontent.xx.fbcdn.net', 'fbcdn.net'];
    if (blockedDomains.some((domain) => metadataUrl.includes(domain))) {
      logger.warn(`Blocked metadata URL: ${metadataUrl} due to restricted domain`, { ip });
      return null;
    }

    const response = await axios.get(metadataUrl, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'image/*,application/json',
      },
    });

    if (response.headers['content-type'].includes('application/json')) {
      const metadata = response.data;
      const imageUrl = metadata.image || metadata.logo || metadata.image_url || null;
      if (imageUrl && blockedDomains.some((domain) => imageUrl.includes(domain))) {
        logger.warn(`Blocked image URL from metadata: ${imageUrl}`, { ip });
        return null;
      }
      return imageUrl;
    }
    if (response.headers['content-type'].startsWith('image/')) {
      return metadataUrl;
    }
    return null;
  } catch (error) {
    logger.warn(`Failed to fetch image from metadata URL ${metadataUrl}: ${error.message}`, { ip });
    return null;
  }
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

    helmet()(req, res, () => {});

    await Promise.all([
      new Promise((resolve, reject) => limiter(req, res, (err) => (err ? reject(err) : resolve()))),
      new Promise((resolve, reject) => addressLimiter(req, res, (err) => (err ? reject(err) : resolve()))),
    ]);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  if (req.method !== 'POST') {
    logger.log('warn', `Method not allowed: ${req.method}`, { ip });
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  await Promise.all(validate.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.log('warn', `Validation errors: ${JSON.stringify(errors.array())}`, { ip });
    return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
  }

  const { chain, tokenAddress, action, decimalPlace = 18, address, limit = 100 } = req.body;

  if (!process.env.SIM_API_KEY) {
    logger.error('SIM_API_KEY is not configured');
    return res.status(500).json({ detail: 'Server configuration error: Missing SIM_API_KEY' });
  }
  if (!process.env.NEXT_PUBLIC_APP_URL) {
    logger.log('warn', 'NEXT_PUBLIC_APP_URL is not configured, falling back to default');
  }

  if (['wallet-balances', 'transactions', 'collectibles'].includes(action)) {
    try {
      await new Promise((resolve, reject) => {
        logger.info(`Running requireAuth for action: ${action}, address: ${address}`, { ip });
        requireAuth(req, res, (err) => {
          if (err) {
            logger.error(`requireAuth failed: ${err.message}`, { ip, headers: req.headers });
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (err) {
      logger.error(`Authentication error: ${err.message}`, { ip, stack: err.stack });
      return res.status(401).json({ detail: 'Unauthorized: Please log in.' });
    }
  }

  try {
    const isEVMAddress = isAddress(address);
    const isSVMAddress = isValidSolanaAddress(address);
    const chainParam = isEVMAddress ? `chain_ids=${SUPPORTED_CHAIN_IDS}` : `chains=${SUPPORTED_SVM_CHAINS.join(',')}`;

    if (action === 'top-holders' && chain && tokenAddress) {
      const chainId = CHAIN_ID_MAP[chain?.toLowerCase()];
      if (!chainId) {
        logger.log('warn', `Unsupported chain: ${chain}`, { ip });
        return res.status(400).json({ detail: `Unsupported chain: ${chain}` });
      }

      const url = `https://api.sim.dune.com/v1/evm/token-holders/${chainId}/${tokenAddress}?limit=${limit}`;
      logger.info(`Calling Dune Sim API: ${url}`, { ip });
      const response = await axios.get(url, {
        headers: { 'X-Sim-Api-Key': process.env.SIM_API_KEY },
        timeout: 15000,
      });

      logger.info(`Top holders response for chain ${chain} (${chainId}): ${response.data.holders?.length || 0} holders, time: ${Date.now() - startTime}ms`, { ip });
      if (process.env.NODE_ENV === 'development') {
        console.log('Raw top holders response:', {
          totalSupply: response.data.totalSupply,
          holders: response.data.holders?.slice(0, 5),
        });
      }

      let effectiveDecimalPlace = Number(decimalPlace);
      if (isNaN(effectiveDecimalPlace) || effectiveDecimalPlace < 0 || effectiveDecimalPlace > 36) {
        logger.log('warn', `Invalid decimal place: ${decimalPlace}, defaulting to 18`, { ip });
        effectiveDecimalPlace = 18;
      }
      const knownTokens = {
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6, // USDC
        '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
      };
      if (knownTokens[tokenAddress.toLowerCase()] && effectiveDecimalPlace !== knownTokens[tokenAddress.toLowerCase()]) {
        logger.info(`Overriding decimal place for known token ${tokenAddress}: ${effectiveDecimalPlace} -> ${knownTokens[tokenAddress.toLowerCase()]}`, { ip });
        effectiveDecimalPlace = knownTokens[tokenAddress.toLowerCase()];
      }

      const data = response.data.holders?.map((holder) => {
        const rawBalance = Number(holder.balance) || 0;
        const balance = rawBalance / Math.pow(10, effectiveDecimalPlace);
        return {
          address: holder.wallet_address || 'Unknown',
          balance: Number(balance.toFixed(6)),
        };
      }) || [];

      logger.info(`Processed top-holders data: ${data.length} holders`, { ip });
      return res.status(200).json({ success: true, data });
    } else if (action === 'wallet-balances' && address) {
      logger.info(`Processing wallet-balances for address: ${address}`, { ip });
      const url = isEVMAddress
        ? `https://api.sim.dune.com/v1/evm/balances/${address}?${chainParam}&metadata=logo&limit=${limit}`
        : `https://api.sim.dune.com/beta/svm/balances/${address}?${chainParam}&limit=${limit}`;
      logger.info(`Calling Dune Sim API: ${url}`, { ip });
      const response = await axios.get(url, {
        headers: { 'X-Sim-Api-Key': process.env.SIM_API_KEY },
        timeout: 15000,
      });

      logger.info(`Wallet balances response for address ${address}: ${response.data.balances?.length || 0} tokens, time: ${Date.now() - startTime}ms`, { ip });
      if (process.env.NODE_ENV === 'development') {
        console.log('Raw wallet balances response:', {
          wallet_address: response.data.wallet_address,
          balances: response.data.balances?.slice(0, 5),
        });
      }

      const balances = await Promise.all(
        response.data.balances?.map(async (balance) => {
          let logo = isEVMAddress ? balance.token_metadata?.logo || null : balance.uri || null;
          if ((balance.chain === 'solana' || balance.chain === 'eclipse') && balance.address === 'native') {
            logo = balance.chain === 'solana' ? '/solana-logo.png' : '/eclipse-logo.png';
          } else if (isSVMAddress && logo) {
            const imageUrl = await fetchImageUrl(logo, ip);
            logo = imageUrl;
          }
          return {
            chain: balance.chain,
            chain_id: balance.chain_id || (isSVMAddress ? balance.chain : balance.chain_id),
            address: balance.address,
            symbol: balance.symbol || 'Unknown',
            decimals: balance.decimals || 18,
            amount: Number(balance.amount) / Math.pow(10, balance.decimals || 18),
            price_usd: balance.price_usd || 0,
            value_usd: balance.value_usd || 0,
            logo,
            low_liquidity: balance.low_liquidity || false,
            name: balance.name || 'Unknown',
          };
        }) || []
      );

      const data = balances;
      logger.info(`Processed wallet balances data: ${data.length} tokens after processing`, { ip });
      return res.status(200).json({ success: true, data });
    } else if (action === 'transactions' && address) {
      logger.info(`Processing transactions for address: ${address}`, { ip });
      const url = isEVMAddress
        ? `https://api.sim.dune.com/v1/evm/activity/${address}?${chainParam}&limit=${limit}&sort=desc`
        : `https://api.sim.dune.com/beta/svm/transactions/${address}?${chainParam}&limit=${limit}&sort=desc`;
      logger.info(`Calling Dune Sim API: ${url}`, { ip });
      const response = await axios.get(url, {
        headers: { 'X-Sim-Api-Key': process.env.SIM_API_KEY },
        timeout: 15000,
      });

      logger.info(`Transactions response for address ${address}: ${response.data.activity?.length || response.data.transactions?.length || 0} transactions, time: ${Date.now() - startTime}ms`, { ip });
      if (process.env.NODE_ENV === 'development') {
        console.log('Raw transactions response:', {
          wallet_address: response.data.wallet_address || response.data.address,
          transactions: (response.data.activity || response.data.transactions)?.slice(0, 5),
        });
      }

      const data = (isEVMAddress ? response.data.activity : response.data.transactions)?.map((tx) => {
        if (isEVMAddress) {
          const decimals = tx.asset_type === 'native' ? 18 : tx.token_metadata?.decimals || 18;
          return {
            chain: Object.keys(CHAIN_ID_MAP).find((key) => CHAIN_ID_MAP[key] === tx.chain_id) || tx.chain_id || 'Unknown',
            hash: tx.tx_hash || 'Unknown',
            from: tx.from || tx.tx_from || 'Unknown',
            to: tx.to || tx.tx_to || 'None',
            value: Number(tx.value || 0) / Math.pow(10, decimals),
            block_time: tx.block_time || null,
            block_slot: tx.block_number || null,
            token: tx.token_metadata?.symbol || (tx.asset_type === 'native' ? 'Native' : 'Unknown'),
            type: tx.type || 'Unknown',
            token_metadata: {
              symbol: tx.token_metadata?.symbol || (tx.asset_type === 'native' ? NATIVE_TOKEN_METADATA[tx.chain]?.symbol || 'Native' : 'Unknown'),
              logo: tx.token_metadata?.logo || NATIVE_TOKEN_METADATA[tx.chain]?.logo || null,
              name: tx.token_metadata?.name || NATIVE_TOKEN_METADATA[tx.chain]?.name || 'Unknown',
            },
          };
        } else {
          let toAddress = 'None';
          let value = '0';
          let type = 'Unknown';
          const fromAddress = tx.from || tx.address || 'Unknown';
          let tokenSymbol = tx.chain === 'solana' ? 'SOL' : 'ETH';
          let tokenLogo = NATIVE_TOKEN_METADATA[tx.chain]?.logo || null;
          let tokenName = NATIVE_TOKEN_METADATA[tx.chain]?.name || 'Unknown';

          // Check for token transfer
          const tokenRecipient = tx.meta?.postTokenBalances?.find((postBalance) => {
            const preBalance = tx.meta?.preTokenBalances?.find(
              (pre) => pre.mint === postBalance.mint && pre.owner === postBalance.owner
            );
            return (
              preBalance &&
              Number(postBalance.uiTokenAmount.amount) > Number(preBalance.uiTokenAmount.amount)
            );
          });

          if (tokenRecipient) {
            toAddress = tokenRecipient.owner;
            const preBalance = tx.meta?.preTokenBalances?.find(
              (pre) => pre.mint === tokenRecipient.mint && pre.owner === tokenRecipient.owner
            );
            value = (
              (Number(tokenRecipient.uiTokenAmount.amount) - Number(preBalance.uiTokenAmount.amount)) /
              Math.pow(10, tokenRecipient.uiTokenAmount.uiDecimals || 9)
            ).toString();
            type = tokenRecipient.owner === address ? 'receive' : 'send';
            tokenSymbol = tokenRecipient.uiTokenAmount?.uiDecimals ? tokenRecipient.mint : tokenSymbol;
            tokenLogo = null; // Token-specific logo requires additional metadata fetch
            tokenName = 'Unknown Token'; // Token-specific name requires additional metadata fetch
          } else {
            // Check for native token transfer (SOL or Eclipse ETH)
            if (tx.meta?.postBalances && tx.meta?.preBalances && tx.raw_transaction?.transaction?.message?.accountKeys) {
              const deltas = tx.meta.postBalances.map((post, i) => post - (tx.meta.preBalances[i] || 0));
              const recipientIndex = deltas.findIndex(
                (delta, i) => delta > 0 && tx.raw_transaction.transaction.message.accountKeys[i] !== fromAddress
              );
              const senderIndex = deltas.findIndex(
                (delta, i) => delta < 0 && tx.raw_transaction.transaction.message.accountKeys[i] === fromAddress
              );

              if (recipientIndex > -1 && tx.raw_transaction.transaction.message.accountKeys[recipientIndex] === address) {
                toAddress = fromAddress;
                value = (deltas[recipientIndex] / 1e9).toString();
                type = 'receive';
              } else if (senderIndex > -1 && tx.raw_transaction.transaction.message.accountKeys[senderIndex] === address) {
                toAddress = tx.raw_transaction.transaction.message.accountKeys[deltas.findIndex((delta) => delta > 0)] || 'None';
                value = (-deltas[senderIndex] / 1e9).toString();
                type = 'send';
              }
            }
          }

          return {
            chain: tx.chain,
            hash: tx.raw_transaction?.transaction?.signatures?.[0] || 'Unknown',
            from: fromAddress,
            to: toAddress,
            value: value,
            block_time: tx.block_time ? new Date(tx.block_time / 1000).toISOString() : null,
            block_slot: tx.block_slot || null,
            token: tokenSymbol,
            type: type,
            token_metadata: {
              symbol: tokenSymbol,
              logo: tokenLogo,
              name: tokenName,
            },
          };
        }
      }) || [];

      logger.info(`Processed transactions data: ${data.length} transactions`, { ip });
      return res.status(200).json({ success: true, data });
    } else if (action === 'collectibles' && address) {
      logger.info(`Processing collectibles for address: ${address}`, { ip });
      const effectiveLimit = Math.min(limit, 500);
      const url = isEVMAddress
        ? `https://api.sim.dune.com/v1/evm/collectibles/${address}?${chainParam}&limit=${effectiveLimit}`
        : `https://api.sim.dune.com/beta/svm/collectibles/${address}?${chainParam}&limit=${effectiveLimit}`;
      logger.info(`Calling Dune Sim API: ${url}`, { ip });
      try {
        const response = await axios.get(url, {
          headers: { 'X-Sim-Api-Key': process.env.SIM_API_KEY },
          timeout: 15000,
        });

        logger.info(`Collectibles response for address ${address}: ${response.data.entries?.length || response.data.collectibles?.length || 0} collectibles, time: ${Date.now() - startTime}ms`, { ip });
        if (process.env.NODE_ENV === 'development') {
          console.log('Raw collectibles response:', {
            wallet_address: response.data.address || response.data.wallet_address,
            entries: response.data.entries?.slice(0, 5) || response.data.collectibles?.slice(0, 5),
          });
        }

        const data = (response.data.entries || response.data.collectibles || [])
          .filter((nft) => nft.image_url || nft.token_metadata?.logo)
          .map((nft) => ({
            chain: nft.chain,
            chain_id: nft.chain_id || (isSVMAddress ? nft.chain : nft.chain_id),
            contract_address: nft.contract_address,
            token_id: nft.token_id,
            name: nft.name || 'Unknown',
            symbol: nft.symbol || 'Unknown',
            token_standard: nft.token_standard || 'Unknown',
            balance: Number(nft.balance) || 1,
            token_metadata: {
              logo: nft.image_url || nft.token_metadata?.logo || null,
            },
          }));

        logger.info(`Processed collectibles data: ${data.length} collectibles after filtering`, { ip });
        return res.status(200).json({ success: true, data });
      } catch (error) {
        if (error.response?.status === 404 && isSVMAddress) {
          logger.warn(`SVM collectibles not supported for address: ${address}`, { ip });
          return res.status(200).json({ success: true, data: [] });
        }
        throw error;
      }
    } else if (action === 'proxy-image' && req.body.imageUrl) {
      try {
        const imageUrl = req.body.imageUrl;
        logger.info(`Proxying image: ${imageUrl}`, { ip });

        const blockedDomains = ['scontent.xx.fbcdn.net', 'fbcdn.net'];
        if (blockedDomains.some((domain) => imageUrl.includes(domain))) {
          logger.warn(`Blocked image URL: ${imageUrl} due to restricted domain`, { ip });
          return res.status(400).json({ detail: 'Image URL from restricted domain' });
        }

        const response = await axios.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'image/*',
            'Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://xynapseai.net',
          },
        });

        const contentType = response.headers['content-type'];
        if (!contentType.startsWith('image/')) {
          logger.warn(`Invalid content-type for image ${imageUrl}: ${contentType}`, { ip });
          return res.status(400).json({ detail: 'Invalid image content type' });
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(response.data);
      } catch (error) {
        logger.warn(`Failed to proxy image ${req.body.imageUrl}: ${error.message}`, { ip });
        return res.status(400).json({ detail: 'Failed to fetch image', error: error.message });
      }
    }

    logger.log('warn', `Invalid parameters for action: ${action}`, { ip });
    return res.status(400).json({ detail: `Invalid parameters for action: ${action}` });
  } catch (error) {
    logger.error(`Dune Sim API error for action ${action}: ${error.message}`, {
      status: error.response?.status,
      data: error.response?.data,
      stack: error.stack,
      ip,
    });
    const status = error.response?.status || 500;
    const detail =
      status === 429
        ? 'Dune Sim API rate limit exceeded, please try again later.'
        : status === 404
          ? 'Requested data not found.'
          : `Dune Sim API error: ${error.message}`;
    return res.status(status).json({ detail });
  }
}