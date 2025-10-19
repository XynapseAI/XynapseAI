// app/api/sim/route.js
import { NextResponse } from "next/server";
import axios from "axios";
import axiosRetry from "axios-retry";
import Bottleneck from "bottleneck";
import { z } from "zod";
import { logger } from "../../../utils/serverLogger";
import { getRedisClient } from "../../../lib/redis";
import { isAddress } from "ethers";
import { auth } from "@/lib/auth";
import { query } from "../../../utils/postgres";

const isValidTokenSymbol = (symbol) => {
  if (!symbol || typeof symbol !== 'string') return false;
  const invalidPatterns = [
    /t\.me/i,
    /http/i,
    /www\./i,
    /claim/i,
    /[^a-zA-Z0-9\s\-\+\.]/,
  ];
  return !invalidPatterns.some((pattern) => pattern.test(symbol)) && symbol.length <= 10;
};

// ================= Security Headers =================
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self';",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

// ================= IP Ban Logic =================
async function banIP(ip, durationSeconds = 1800) {
  const redisClient = await getRedisClient();
  await redisClient.setEx(`banned_ip:sim:${ip}`, durationSeconds, 'banned');
  logger.info(`IP banned: ${ip} for ${durationSeconds} seconds`);
}

async function checkIPBan(ip) {
  const redisClient = await getRedisClient();
  const isBanned = await redisClient.get(`banned_ip:sim:${ip}`);
  if (isBanned) {
    logger.error(`IP ban detected: ${ip}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
}

async function trackViolation(ip, reason = 'Unknown') {
  const redisClient = await getRedisClient();
  const key = `violations:sim:${ip}`;
  const maxViolations = 50;
  const windowMs = 15 * 60 * 1000;
  const violations = parseInt(await redisClient.get(key)) || 0;

  if (['CORS blocked', 'Invalid JSON body', 'Validation error', 'Invalid address'].includes(reason)) {
    logger.warn(`Non-critical violation ignored: ${ip}, reason: ${reason}, violations: ${violations}`);
    return;
  }

  if (violations >= maxViolations) {
    await banIP(ip, 1800);
    logger.error(`IP banned due to repeated violations: ${ip}, reason: ${reason}`);
    throw new Error('IP temporarily banned due to excessive violations.');
  }
  await redisClient.multi().incr(key).expire(key, windowMs / 1000).exec();
  logger.warn(`Violation recorded: ${ip}, reason: ${reason}, violations: ${violations + 1}`);
}

// ================= Rate Limiting =================
async function checkRateLimit(ip, address, isSVMAddress) {
  try {
    const redisClient = await getRedisClient();
    if (!redisClient.isOpen) {
      logger.error("Redis client not connected in checkRateLimit", { ip });
      throw new Error("Redis client not connected");
    }

    const ipKey = `rate_limit:sim:ip:${ip}`;
    const addressKey = address ? `rate_limit:sim:address:${isSVMAddress ? address : address.toLowerCase()}` : null;
    const maxRequests = 50;
    const windowMs = 60 * 1000;

    const ipRequests = Number.parseInt(await redisClient.get(ipKey)) || 0;
    if (ipRequests >= maxRequests) {
      logger.warn(`Rate limit exceeded for IP ${ip}: ${ipRequests} requests`, { ip });
      throw new Error("Too many requests, please try again later.");
    }

    let addressRequests = 0;
    if (addressKey) {
      addressRequests = Number.parseInt(await redisClient.get(addressKey)) || 0;
      if (addressRequests >= maxRequests) {
        logger.warn(`Rate limit exceeded for address ${address}: ${addressRequests} requests`, { ip });
        throw new Error("Too many requests for this wallet address.");
      }
    }

    const multi = redisClient
      .multi()
      .incr(ipKey)
      .expire(ipKey, windowMs / 1000);

    if (addressKey) {
      multi.incr(addressKey).expire(addressKey, windowMs / 1000);
    }

    await multi.exec();
    logger.info(`Rate limit check passed for IP ${ip}: ${ipRequests + 1}/${maxRequests} requests`);
  } catch (err) {
    logger.error(`Rate limit check failed: ${err.message}`, { ip });
    throw err;
  }
}

// ================= Bottleneck Configuration =================
const limiterBottleneck = new Bottleneck({
  maxConcurrent: process.env.NODE_ENV === 'production' ? 15 : 5,
  minTime: process.env.NODE_ENV === 'production' ? 300 : 1000,
  reservoir: 50,
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60 * 1000,
});

// ================= Axios Retry Configuration =================
axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => {
    logger.info(`Retry attempt ${retryCount} for Dune API`);
    return Math.min(retryCount * 2000, 10000);
  },
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED',
  onRetry: (retryCount, error) => {
    logger.warn(`Retrying Dune API request (attempt ${retryCount})`, {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
  },
});

const fetchWithRateLimit = limiterBottleneck.wrap(async (url, config) => {
  try {
    const response = await axios.get(url, {
      ...config,
      timeout: 30000,
      responseType: config.responseType || 'json',
    });
    return response;
  } catch (error) {
    logger.error(`Axios error: ${error.message}`, { url, status: error.response?.status });
    throw error;
  }
});

// ================= Allowed Origins =================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
  ...(process.env.VERCEL_ENV === 'production' ? [] : ['https://*.vercel.app']),
].filter((v, i, a) => a.indexOf(v) === i);

const vercelPreviewRegex = /^https:\/\/.*\.vercel\.app$/;

function isAllowedOrigin(origin, referer) {
  if (!origin && !referer) {
    logger.info('No Origin or Referer (likely SSR or server-to-server), allowing request');
    return true;
  }
  const checkOrigin = origin || (referer ? new URL(referer).origin : null);
  if (!checkOrigin) {
    logger.info('No valid Origin or Referer, allowing for SSR compatibility');
    return true;
  }
  if (
    allowedOrigins.some((allowed) =>
      allowed.includes('*') ? new RegExp(allowed.replace('*', '.*')).test(checkOrigin) : allowed === checkOrigin
    )
  ) {
    logger.info(`Origin allowed: ${checkOrigin}`);
    return true;
  }
  if (vercelPreviewRegex.test(checkOrigin)) {
    logger.info(`Origin allowed by Vercel preview regex: ${checkOrigin}`);
    return true;
  }
  logger.error(`CORS error: Origin ${checkOrigin || 'null'} not allowed`);
  return false;
}

// ================= API Key Verification =================
async function verifyApiKey(apiKey, session) {
  try {
    if (apiKey === 'default-api-key') return { isValid: true };
    const result = await query(`SELECT id FROM users WHERE api_key = $1`, [apiKey]);
    if (result.rows.length === 0) {
      logger.warn(`Invalid API key: ${apiKey}`);
      return { isValid: false };
    }
    const { id } = result.rows[0];
    if (session && session.user.id !== id) {
      logger.warn(`API key ${apiKey} does not belong to user ${session.user.id}`);
      return { isValid: false };
    }
    return { isValid: true };
  } catch (error) {
    logger.error(`Error verifying API key: ${error.message}`, { stack: error.stack });
    return { isValid: false };
  }
}

// ================= IP Reputation Check =================
async function checkIp(ip) {
  try {
    const response = await fetchWithRateLimit(`https://ipinfo.io/${ip}/json?token=${process.env.IPINFO_TOKEN}`);
    const { abuse } = response.data;
    if (abuse && abuse.score > 50) {
      logger.warn(`Suspicious IP detected: ${ip}`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(`IP check failed: ${error.message}`);
    return true; // Allow request if IP check fails
  }
}

// ================= Input Validation Schema =================
const bodySchema = z.object({
  action: z.enum(['top-holders', 'wallet-balances', 'transactions', 'collectibles', 'proxy-image'], {
    message: 'Invalid action',
  }),
  imageUrl: z.string().url().optional(),
  chain: z.string().optional(),
  tokenAddress: z.string().optional().refine((val) => !val || /^0x[a-fA-F0-9]{40}$/.test(val), {
    message: 'tokenAddress must be a valid EVM address',
  }),
  address: z.string().optional(),
  addresses: z.array(z.string()).optional(),
  decimalPlace: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).optional(),
  minValueUsd: z.number().min(0).optional(),
}).refine(
  (data) => (data.action === 'proxy-image' ? !!data.imageUrl : true),
  { message: 'imageUrl is required for proxy-image action', path: ['imageUrl'] }
).refine(
  (data) => (data.action === 'top-holders' ? !!data.chain && !!data.tokenAddress : true),
  { message: 'chain and tokenAddress are required for top-holders', path: ['chain', 'tokenAddress'] }
).refine(
  (data) => (['wallet-balances', 'collectibles'].includes(data.action) ? !!data.address : true),
  { message: 'address is required for wallet-balances and collectibles', path: ['address'] }
).refine(
  (data) =>
    data.action === 'transactions'
      ? !!data.address || (Array.isArray(data.addresses) && data.addresses.length > 0)
      : true,
  { message: 'address or addresses array is required for transactions', path: ['address', 'addresses'] }
);

// ================= Constants =================
const IMPORTANT_TOKENS = [
  { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", chain: "ethereum", decimals: 6 },
  { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", chain: "ethereum", decimals: 6 },
  { address: "native", symbol: "ETH", chain: "ethereum", decimals: 18 },
  { address: "0xB8c77482e45F1F44dE1745F52C74426C631bDD52", symbol: "BNB", chain: "bnb", decimals: 18 },
  { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", symbol: "WBTC", chain: "ethereum", decimals: 8 },
];

const CHAIN_ID_MAP = {
  abstract: "2741",
  ancient8: "888888888",
  ape_chain: "33139",
  arbitrum: "42161",
  avalanche_c: "43114",
  base: "8453",
  berachain: "80094",
  blast: "81457",
  bnb: "56",
  celo: "42220",
  ethereum: "1",
  fantom: "250",
  gnosis: "100",
  ink: "57073",
  linea: "59144",
  lisk: "1135",
  mantle: "5000",
  opbnb: "204",
  optimism: "10",
  polygon: "137",
  scroll: "534352",
  sei: "1329",
  soneium: "1868",
  sonic: "146",
  unichain: "130",
  world: "480",
  zksync: "324",
  zora: "7777777",
};

const LIMIT_CONFIG = {
  "top-holders": 100,
  "wallet-balances": 2000,
  transactions: 500,
  collectibles: 200,
};

const SUPPORTED_SVM_CHAINS = ["solana", "eclipse"];
const SUPPORTED_CHAIN_IDS = Object.values(CHAIN_ID_MAP).join(",");

const NATIVE_TOKEN_METADATA = {
  solana: { symbol: "SOL", logo: "/solana-logo.webp", name: "Solana" },
  eclipse: { symbol: "ECL", logo: "/eclipse-logo.webp", name: "Eclipse" },
  ethereum: { symbol: "ETH", logo: "/ethereum-logo.webp", name: "Ethereum" },
  bnb: { symbol: "BNB", logo: "/bnb-logo.webp", name: "BNB" },
  polygon: { symbol: "MATIC", logo: "/polygon-logo.webp", name: "Polygon" },
};

// ================= Helper Functions =================
const isValidSolanaAddress = (address) => {
  return address && address.length >= 32 && address.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
};

async function fetchImageUrl(metadataUrl, ip) {
  try {
    const blockedDomains = ["scontent.xx.fbcdn.net", "fbcdn.net"];
    if (blockedDomains.some((domain) => metadataUrl.includes(domain))) {
      logger.warn(`Blocked metadata URL: ${metadataUrl} due to restricted domain`, { ip });
      return null;
    }

    const response = await fetchWithRateLimit(metadataUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept: "image/*,application/json",
      },
    });

    if (response.headers["content-type"]?.includes("application/json")) {
      const metadata = response.data;
      const imageUrl = metadata.image || metadata.logo || metadata.image_url || null;
      if (imageUrl && blockedDomains.some((domain) => imageUrl.includes(domain))) {
        logger.warn(`Blocked image URL from metadata: ${imageUrl}`, { ip });
        return null;
      }
      return imageUrl;
    }
    if (response.headers["content-type"]?.startsWith("image/")) {
      return metadataUrl;
    }
    return null;
  } catch (error) {
    logger.warn(`Failed to fetch image from metadata URL ${metadataUrl}: ${error.message}`, { ip });
    return null;
  }
}

// ================= Stream Helper =================
function createJsonStream(controller, data, chunkSize = 200) {
  if (!controller || controller.locked) {
    logger.error("Cannot create JSON stream: Controller is closed or invalid");
    return;
  }

  const chunks = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }

  // Send opening array bracket
  if (!controller.locked) {
    controller.enqueue(new TextEncoder().encode('['));
    logger.info("Stream started with opening bracket");
  }

  let index = 0;
  async function sendNextChunk() {
    if (index >= chunks.length) {
      if (!controller.locked) {
        // Send closing array bracket
        controller.enqueue(new TextEncoder().encode(']'));
        controller.close();
        logger.info("Stream closed after sending all chunks");
      }
      return;
    }

    if (controller.desiredSize <= 0) {
      // Backpressure: Wait until buffer is ready
      logger.info("Backpressure detected, waiting...");
      await new Promise((resolve) => setTimeout(resolve, 200));
      sendNextChunk();
      return;
    }

    const chunkData = chunks[index];
    if (!controller.locked) {
      // Send chunk with comma if not the first chunk
      const prefix = index > 0 ? ',' : '';
      const chunkString = prefix + JSON.stringify(chunkData).slice(1, -1); // Remove outer brackets of chunk
      controller.enqueue(new TextEncoder().encode(chunkString));
      logger.info(`Sent chunk ${index + 1}/${chunks.length} with ${chunkData.length} items`);
    }
    index++;
    sendNextChunk();
  }

  sendNextChunk().catch((error) => {
    logger.error(`Error in sendNextChunk: ${error.message}`, { stack: error.stack });
    if (!controller.locked) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ detail: `Stream error: ${error.message}` })));
      controller.close();
    }
  });
}

// ================= Main Handler =================
export async function POST(request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const startTime = Date.now();
  logger.info(`Request to /api/sim from IP ${ip}`, { origin, timestamp: new Date().toISOString() });

  // Check CORS
  if (!isAllowedOrigin(origin, referer)) {
    await trackViolation(ip, 'CORS blocked');
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403, headers: securityHeaders });
  }

  // Check IP ban
  try {
    await checkIPBan(ip);
  } catch (err) {
    return NextResponse.json({ detail: err.message }, { status: 403, headers: securityHeaders });
  }

  // Check IP reputation
  if (!(await checkIp(ip))) {
    await trackViolation(ip, 'Suspicious IP');
    return NextResponse.json({ detail: 'Request blocked due to suspicious IP.' }, { status: 403, headers: securityHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    await trackViolation(ip, 'Invalid JSON body');
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400, headers: securityHeaders });
  }

  // Validate input
  let parsedBody;
  try {
    parsedBody = bodySchema.parse(body);
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    await trackViolation(ip, 'Validation error');
    return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400, headers: securityHeaders });
  }

  const { action, imageUrl, chain, tokenAddress, address, addresses, decimalPlace, limit, minValueUsd } = parsedBody;

  // Verify API key
  const apiKey = request.headers.get('x-api-key') || 'default-api-key';
  const session = await auth();
  const { isValid } = await verifyApiKey(apiKey, session);
  if (!isValid) {
    logger.error(`Invalid API key: ${apiKey}`, { ip });
    await trackViolation(ip, 'Invalid API key');
    return NextResponse.json({ detail: 'Unauthorized: Invalid API key.' }, { status: 401, headers: securityHeaders });
  }

  // Check rate limit
  const isEVMAddress = address ? isAddress(address) : false;
  const isSVMAddress = address ? isValidSolanaAddress(address) : false;
  try {
    await checkRateLimit(ip, address, isSVMAddress);
  } catch (err) {
    return NextResponse.json({ detail: err.message }, { status: 429, headers: securityHeaders });
  }

  // Check SIM_API_KEY
  if (!process.env.SIM_API_KEY) {
    logger.error("SIM_API_KEY is not configured", { ip });
    return NextResponse.json({ detail: "Server configuration error: Missing SIM_API_KEY" }, { status: 500, headers: securityHeaders });
  }

  // Authentication for non-cron requests
  const authHeader = request.headers.get("authorization");
  const isCronRequest = authHeader && authHeader === `Bearer ${process.env.SIM_API_KEY}`;
  if (["wallet-balances", "transactions", "collectibles"].includes(action) && !isCronRequest) {
    if (!session || !session.user?.id) {
      logger.error(`Authentication error: Unauthorized`, { ip });
      await trackViolation(ip, 'Unauthorized access');
      return NextResponse.json({ detail: "Unauthorized: Please log in." }, { status: 401, headers: securityHeaders });
    }
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const effectiveDecimalPlace =
            typeof decimalPlace === "number" && Number.isInteger(decimalPlace) && decimalPlace >= 0 ? decimalPlace : 18;

          let effectiveLimit = LIMIT_CONFIG[action] || 500;
          if (typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= LIMIT_CONFIG[action]) {
            effectiveLimit = limit;
          }

          if (action === "top-holders" && chain && tokenAddress) {
            const chainId = CHAIN_ID_MAP[chain?.toLowerCase()];
            if (!chainId) {
              logger.warn(`Unsupported chain: ${chain}`, { ip });
              controller.enqueue(JSON.stringify({ detail: `Unsupported chain: ${chain}` }));
              controller.close();
              return;
            }

            const url = `https://api.sim.dune.com/v1/evm/token-holders/${chainId}/${tokenAddress}?limit=${effectiveLimit}`;
            logger.info(`Calling Dune Sim API: ${url}`, { ip });
            const response = await fetchWithRateLimit(url, {
              headers: { "X-Sim-Api-Key": process.env.SIM_API_KEY },
            });

            logger.info(
              `Top holders response for chain ${chain} (${chainId}): ${response.data.holders?.length || 0} holders, time: ${Date.now() - startTime}ms`,
              { ip },
            );

            const knownTokens = {
              "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6, // USDC
              "0x6b175474e89094c44da98b954eedeac495271d0f": 18, // DAI
            };
            let finalDecimalPlace = effectiveDecimalPlace;
            if (knownTokens[tokenAddress.toLowerCase()]) {
              finalDecimalPlace = knownTokens[tokenAddress.toLowerCase()];
            }

            const data = response.data.holders?.map((holder) => {
              const rawBalance = Number(holder.balance) || 0;
              const balance = rawBalance / Math.pow(10, finalDecimalPlace);
              return {
                address: holder.wallet_address || "Unknown",
                balance: Number(balance.toFixed(6)),
              };
            }) || [];

            logger.info(`Processed top-holders data: ${data.length} holders`, { ip });
            createJsonStream(controller, data);
            return;
          } else if (action === "wallet-balances" && address) {
            logger.info(`Processing wallet-balances for address: ${address}`, { ip });

            if (isEVMAddress) {
              let allBalances = [];
              let missingImportantTokens = [...IMPORTANT_TOKENS];
              const allChainIds = Object.values(CHAIN_ID_MAP).join(",");

              const fetchNative = async () => {
                let balances = [];
                let nextOffsetNative = null;
                do {
                  const url = `https://api.sim.dune.com/v1/evm/balances/${address}?chain_ids=${allChainIds}&metadata=logo&limit=2000${nextOffsetNative ? `&offset=${nextOffsetNative}` : ''}&filters=native`;
                  logger.info(`Calling Dune Sim API (Native): ${url}`, { ip });
                  const response = await fetchWithRateLimit(url, {
                    headers: { "X-Sim-Api-Key": process.env.SIM_API_KEY },
                  });

                  logger.info(
                    `Wallet balances (Native) response for address ${address}: ${response.data.balances?.length || 0} tokens, time: ${Date.now() - startTime}ms`,
                    { ip },
                  );

                  balances.push(...(response.data.balances || []));
                  nextOffsetNative = response.data.next_offset || null;

                  missingImportantTokens = missingImportantTokens.filter((importantToken) => {
                    if (importantToken.address !== "native") return true;
                    return !balances.some((balance) => {
                      const balanceChain = balance.chain?.toLowerCase();
                      return balanceChain === importantToken.chain && balance.address === "native";
                    });
                  });
                } while (nextOffsetNative && missingImportantTokens.some((token) => token.address === "native"));
                return balances;
              };

              const fetchErc20 = async () => {
                let balances = [];
                let nextOffsetErc20 = null;
                do {
                  const url = `https://api.sim.dune.com/v1/evm/balances/${address}?chain_ids=${allChainIds}&metadata=logo&limit=2000${nextOffsetErc20 ? `&offset=${nextOffsetErc20}` : ''}&filters=erc20`;
                  logger.info(`Calling Dune Sim API (ERC20): ${url}`, { ip });
                  const response = await fetchWithRateLimit(url, {
                    headers: { "X-Sim-Api-Key": process.env.SIM_API_KEY },
                  });

                  logger.info(
                    `Wallet balances (ERC20) response for address ${address}: ${response.data.balances?.length || 0} tokens, time: ${Date.now() - startTime}ms`,
                    { ip },
                  );

                  balances.push(...(response.data.balances || []));
                  nextOffsetErc20 = response.data.next_offset || null;

                  missingImportantTokens = missingImportantTokens.filter((importantToken) => {
                    if (importantToken.address === "native") return true;
                    return !balances.some((balance) => {
                      const balanceChain = balance.chain?.toLowerCase();
                      const balanceAddress = balance.address?.toLowerCase();
                      const importantTokenAddress = importantToken.address.toLowerCase();
                      return balanceChain === importantToken.chain && balanceAddress === importantTokenAddress;
                    });
                  });
                } while (nextOffsetErc20 && missingImportantTokens.length > 0);
                return balances;
              };

              const [nativeBalances, erc20Balances] = await Promise.all([fetchNative(), fetchErc20()]);
              allBalances = [...nativeBalances, ...erc20Balances];

              const uniqueBalances = [];
              const seen = new Set();
              for (const balance of allBalances) {
                const key = `${balance.chain}-${balance.address}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  uniqueBalances.push(balance);
                }
              }

              const data = await Promise.all(
                uniqueBalances.map(async (balance) => {
                  let logo = balance.token_metadata?.logo || null;
                  if (balance.address === "native") {
                    logo = NATIVE_TOKEN_METADATA[balance.chain]?.logo || logo;
                  }
                  const processedBalance = {
                    chain: balance.chain,
                    chain_id: balance.chain_id,
                    address: balance.address,
                    symbol: balance.symbol || NATIVE_TOKEN_METADATA[balance.chain]?.symbol || "Unknown",
                    decimals: balance.decimals || 18,
                    amount: Number(balance.amount) / Math.pow(10, balance.decimals || 18),
                    price_usd: balance.price_usd || 0,
                    value_usd: balance.value_usd || 0,
                    logo,
                    low_liquidity: balance.low_liquidity || false,
                    name: balance.name || NATIVE_TOKEN_METADATA[balance.chain]?.name || "Unknown",
                  };

                  const isImportantToken = IMPORTANT_TOKENS.some(
                    (token) =>
                      token.chain === balance.chain &&
                      (token.address === "native" ? balance.address === "native" : token.address.toLowerCase() === balance.address.toLowerCase())
                  );

                  if (!isValidTokenSymbol(processedBalance.symbol) && !isImportantToken) {
                    logger.info(`Filtered out invalid token symbol: ${processedBalance.symbol} on ${processedBalance.chain}`, { ip });
                    return null;
                  }
                  if (processedBalance.value_usd > 100_000_000_000) {
                    logger.info(`Filtered out token with excessive value_usd: ${processedBalance.symbol} on ${processedBalance.chain}, value_usd: ${processedBalance.value_usd}`, { ip });
                    return null;
                  }
                  if (processedBalance.value_usd === 0 && !isImportantToken) {
                    logger.info(`Filtered out token with zero value_usd: ${processedBalance.symbol} on ${processedBalance.chain}`, { ip });
                    return null;
                  }
                  return processedBalance;
                })
              );

              let filteredData = data.filter((balance) => balance !== null);

              if (minValueUsd) {
                filteredData = filteredData.filter((balance) => balance.value_usd >= minValueUsd);
              }

              filteredData.sort((a, b) => {
                const aIsNative = a.address === "native" ? -1 : 1;
                const bIsNative = b.address === "native" ? -1 : 1;
                return aIsNative - bIsNative;
              });

              if (effectiveLimit < filteredData.length) {
                filteredData = filteredData.slice(0, effectiveLimit);
              }

              logger.info(`Processed wallet balances data: ${filteredData.length} tokens after processing and filtering`, { ip });
              createJsonStream(controller, filteredData);
              return;
            } else {
              const chainParam = `chains=${SUPPORTED_SVM_CHAINS.join(",")}`;
              const url = `https://api.sim.dune.com/beta/svm/balances/${address}?${chainParam}&limit=${effectiveLimit}`;
              logger.info(`Calling Dune Sim API: ${url}`, { ip });
              const response = await fetchWithRateLimit(url, {
                headers: { "X-Sim-Api-Key": process.env.SIM_API_KEY },
              });

              logger.info(
                `Wallet balances response for address ${address}: ${response.data.balances?.length || 0} tokens, time: ${Date.now() - startTime}ms`,
                { ip },
              );

              const data = await Promise.all(
                response.data.balances?.map(async (balance) => {
                  let logo = balance.uri || null;
                  if ((balance.chain === "solana" || balance.chain === "eclipse") && balance.address === "native") {
                    logo = balance.chain === "solana" ? "/solana-logo.webp" : "/eclipse-logo.webp";
                  } else if (isSVMAddress && logo) {
                    const imageUrl = await fetchImageUrl(logo, ip);
                    logo = imageUrl;
                  }
                  const processedBalance = {
                    chain: balance.chain,
                    chain_id: balance.chain_id || balance.chain,
                    address: balance.address,
                    symbol: balance.symbol || "Unknown",
                    decimals: balance.decimals || 18,
                    amount: Number(balance.amount) / Math.pow(10, balance.decimals || 18),
                    price_usd: balance.price_usd || 0,
                    value_usd: balance.value_usd || 0,
                    logo,
                    low_liquidity: balance.low_liquidity || false,
                    name: balance.name || "Unknown",
                  };

                  const isImportantToken = IMPORTANT_TOKENS.some(
                    (token) => token.chain === balance.chain && token.address === "native"
                  );

                  if (!isValidTokenSymbol(processedBalance.symbol) && !isImportantToken) {
                    logger.info(`Filtered out invalid token symbol: ${processedBalance.symbol} on ${processedBalance.chain}`, { ip });
                    return null;
                  }
                  if (processedBalance.value_usd > 100_000_000_000) {
                    logger.info(`Filtered out token with excessive value_usd: ${processedBalance.symbol} on ${processedBalance.chain}, value_usd: ${processedBalance.value_usd}`, { ip });
                    return null;
                  }
                  if (processedBalance.value_usd === 0 && !isImportantToken) {
                    logger.info(`Filtered out token with zero value_usd: ${processedBalance.symbol} on ${processedBalance.chain}`, { ip });
                    return null;
                  }
                  return processedBalance;
                }) || [],
              );

              let filteredData = data.filter((balance) => balance !== null);

              if (minValueUsd) {
                filteredData = filteredData.filter((balance) => balance.value_usd >= minValueUsd);
              }

              if (effectiveLimit < filteredData.length) {
                filteredData = filteredData.slice(0, effectiveLimit);
              }

              logger.info(`Processed wallet balances data: ${filteredData.length} tokens after processing and filtering`, { ip });
              createJsonStream(controller, filteredData);
              return;
            }
          } else if (action === "transactions") {
            logger.info(`Processing transactions for addresses: ${addresses || address}`, { ip });
            const targetAddresses = [...new Set(addresses && addresses.length > 0 ? addresses : [address])];
            const chainParam = targetAddresses.some((addr) => isValidSolanaAddress(addr))
              ? `chains=${SUPPORTED_SVM_CHAINS.join(",")}`
              : `chain_ids=${SUPPORTED_CHAIN_IDS}`;

            // FIX: Giảm limit cho cluster (nhiều addresses) để tránh chậm
            let clusterLimit = effectiveLimit;
            if (targetAddresses.length > 1) {  // ClusterTab case: nhiều addresses
              clusterLimit = Math.min(effectiveLimit, 500);  // Cap 500 cho cluster
            }

            // Parallelize fetches for each address
            const fetchPromises = targetAddresses.map(async (addr) => {
              const isEVM = isAddress(addr);
              const perCallLimit = isEVM ? 100 : 1000; // EVM max 100/call, SVM max 1000/call
              let allTransactions = [];
              let nextOffset = null;
              let remainingLimit = clusterLimit;  // Sử dụng clusterLimit
              let pageCount = 0;
              const maxPages = isEVM ? 5 : 2;  // FIX: Cap pages/address để tránh overload (EVM: 500 tx max)

              // Paginate loop for this address
              do {
                pageCount++;
                if (pageCount > maxPages) break;  // FIX: Giới hạn pages

                const currentLimit = Math.min(perCallLimit, remainingLimit);
                const url = isEVM
                  ? `https://api.sim.dune.com/v1/evm/activity/${addr}?${chainParam}&limit=${currentLimit}&sort=desc${nextOffset ? `&offset=${nextOffset}` : ''}`
                  : `https://api.sim.dune.com/beta/svm/transactions/${addr}?${chainParam}&limit=${currentLimit}&sort=desc${nextOffset ? `&offset=${nextOffset}` : ''}`;
                logger.info(`Calling Dune Sim API (page ${pageCount}): ${url}`, { ip });

                try {
                  const response = await fetchWithRateLimit(url, {
                    headers: { "X-Sim-Api-Key": process.env.SIM_API_KEY },
                  });

                  logger.info(
                    `Transactions response for address ${addr} (page ${pageCount}): ${response.data.activity?.length || response.data.transactions?.length || 0} transactions, time: ${Date.now() - startTime}ms`,
                    { ip },
                  );

                  const transactions = (isEVM ? response.data.activity : response.data.transactions) || [];

                  // FIX: Filter minValueUsd NGAY SAU MỖI PAGE để giảm data sớm
                  let filteredPage = transactions;
                  if (isEVM && minValueUsd) {
                    filteredPage = transactions.filter(tx => {
                      const value_usd = Number(tx.value_usd || 0);
                      return !(minValueUsd && value_usd < minValueUsd);
                    });
                  }
                  // SVM: Filter sau (complex), nên giữ nguyên

                  allTransactions.push(...filteredPage);
                  nextOffset = response.data.next_offset || null;
                  remainingLimit -= filteredPage.length;  // Dùng filtered length

                } catch (error) {
                  logger.error(`Error fetching transactions page for address ${addr}: ${error.message}`, { ip });
                  if (error.response?.status === 429) {
                    throw new Error("Dune Sim API rate limit exceeded, please try again later.");
                  } else if (error.response?.status === 404) {
                    logger.warn(`No transactions found for address ${addr}`, { ip });
                    break; // Exit loop if 404
                  } else {
                    throw error;
                  }
                }
              } while (nextOffset && remainingLimit > 0 && allTransactions.length < clusterLimit && pageCount <= maxPages);

              // Now process the collected transactions
              const filteredTransactions = await Promise.all(
                allTransactions.slice(0, clusterLimit).map(async (tx) => {  // Cap at clusterLimit
                  if (isEVM) {
                    const decimals = tx.asset_type === "native" ? 18 : tx.token_metadata?.decimals || 18;
                    const value_usd = Number(tx.value_usd || 0);
                    if (minValueUsd && value_usd < minValueUsd) return null;
                    const tokenSymbol = tx.token_metadata?.symbol ||
                      (tx.asset_type === "native" ? NATIVE_TOKEN_METADATA[tx.chain]?.symbol || "Native" : "Unknown");
                    if (!isValidTokenSymbol(tokenSymbol) && !IMPORTANT_TOKENS.some((t) => t.chain === tx.chain && t.address === "native")) {
                      logger.info(`Filtered out invalid token symbol: ${tokenSymbol} on ${tx.chain}`, { ip });
                      return null;
                    }
                    return {
                      chain:
                        Object.keys(CHAIN_ID_MAP).find((key) => CHAIN_ID_MAP[key] === tx.chain_id) ||
                        tx.chain_id || "Unknown",
                      hash: tx.tx_hash || "Unknown",
                      from: tx.from || tx.tx_from || "Unknown",
                      to: tx.to || tx.tx_to || "None",
                      value: Number(tx.value || 0) / Math.pow(10, decimals),
                      value_usd,
                      block_time: tx.block_time || null,
                      block_slot: tx.block_number || null,
                      token: tokenSymbol,
                      type: tx.type || "Unknown",
                      token_metadata: {
                        symbol: tokenSymbol,
                        logo: tx.token_metadata?.logo || NATIVE_TOKEN_METADATA[tx.chain]?.logo || null,
                        name: tx.token_metadata?.name || NATIVE_TOKEN_METADATA[tx.chain]?.name || "Unknown",
                      },
                    };
                  } else {
                    // SVM processing logic remains the same (unchanged)
                    let toAddress = "None";
                    let fromAddress = tx.from || tx.address || "Unknown";
                    let value = "0";
                    let value_usd = 0;
                    let type = "Unknown";
                    let tokenSymbol = NATIVE_TOKEN_METADATA[tx.chain]?.symbol || "Unknown";
                    let tokenLogo = NATIVE_TOKEN_METADATA[tx.chain]?.logo || null;
                    let tokenName = NATIVE_TOKEN_METADATA[tx.chain]?.name || "Unknown";
                    let swap_details = null;

                    const sentTokens = [];
                    const receivedTokens = [];
                    if (tx.meta?.postTokenBalances && tx.meta?.preTokenBalances) {
                      tx.meta.postTokenBalances.forEach((postBalance) => {
                        if (postBalance.owner === addr) {
                          const preBalance = tx.meta.preTokenBalances.find(
                            (pre) => pre.mint === postBalance.mint && pre.owner === postBalance.owner,
                          );
                          if (preBalance) {
                            const delta =
                              Number(postBalance.uiTokenAmount.amount) - Number(preBalance.uiTokenAmount.amount);
                            if (delta > 0) {
                              const symbol = postBalance.mint.slice(0, 4) + "..." || "Unknown";
                              if (!isValidTokenSymbol(symbol) && !IMPORTANT_TOKENS.some((t) => t.chain === tx.chain && t.address === "native")) {
                                logger.info(`Filtered out invalid token symbol: ${symbol} on ${tx.chain}`, { ip });
                                return;
                              }
                              receivedTokens.push({
                                mint: postBalance.mint,
                                amount: delta / Math.pow(10, postBalance.uiTokenAmount.decimals || 9),
                                symbol,
                                logo: null,
                                decimals: postBalance.uiTokenAmount.decimals || 9,
                              });
                            } else if (delta < 0) {
                              const symbol = postBalance.mint.slice(0, 4) + "..." || "Unknown";
                              if (!isValidTokenSymbol(symbol) && !IMPORTANT_TOKENS.some((t) => t.chain === tx.chain && t.address === "native")) {
                                logger.info(`Filtered out invalid token symbol: ${symbol} on ${tx.chain}`, { ip });
                                return;
                              }
                              sentTokens.push({
                                mint: postBalance.mint,
                                amount: -delta / Math.pow(10, postBalance.uiTokenAmount.decimals || 9),
                                symbol,
                                logo: null,
                                decimals: postBalance.uiTokenAmount.decimals || 9,
                              });
                            }
                          }
                        }
                      });
                    }

                    if (
                      tx.meta?.postBalances &&
                      tx.meta?.preBalances &&
                      tx.raw_transaction?.transaction?.message?.accountKeys
                    ) {
                      const deltas = tx.meta.postBalances.map((post, i) => post - (tx.meta.preBalances[i] || 0));
                      const accountKeys = tx.raw_transaction.transaction.message.accountKeys;
                      const userIndex = accountKeys.findIndex((key) => key === addr);
                      if (userIndex !== -1) {
                        const nativeDelta = deltas[userIndex];
                        const priceUsd = tx.price_usd || 0;
                        if (nativeDelta > 0) {
                          value_usd = (nativeDelta / 1e9) * priceUsd;
                          if (minValueUsd && value_usd < minValueUsd) return null;
                          receivedTokens.push({
                            mint: "native",
                            amount: nativeDelta / 1e9,
                            symbol: tokenSymbol,
                            logo: tokenLogo,
                            decimals: 9,
                          });
                        } else if (nativeDelta < 0) {
                          value_usd = (-nativeDelta / 1e9) * priceUsd;
                          if (minValueUsd && value_usd < minValueUsd) return null;
                          sentTokens.push({
                            mint: "native",
                            amount: -nativeDelta / 1e9,
                            symbol: tokenSymbol,
                            logo: tokenLogo,
                            decimals: 9,
                          });
                        }
                      }
                    }

                    if (sentTokens.length > 0 && receivedTokens.length > 0) {
                      type = "swap";
                      swap_details = { sent: sentTokens, received: receivedTokens };
                      tokenSymbol = `${sentTokens[0]?.symbol || "Unknown"}/${receivedTokens[0]?.symbol || "Unknown"}`;
                      tokenLogo = sentTokens[0]?.logo || receivedTokens[0]?.logo || tokenLogo;
                      toAddress = "Swap";
                      value = sentTokens[0]?.amount.toFixed(6) || "0";
                      value_usd = sentTokens[0]?.amount * (sentTokens[0]?.price_usd || 0) || value_usd;
                    } else if (receivedTokens.length > 0) {
                      type = "receive";
                      const received = receivedTokens[0];
                      value = received.amount.toFixed(6);
                      value_usd = received.amount * (received.price_usd || 0) || value_usd;
                      tokenSymbol = received.symbol;
                      tokenLogo = received.logo || tokenLogo;
                      tokenName = received.mint === "native" ? tokenName : "Unknown Token";
                      fromAddress =
                        tx.meta?.postTokenBalances?.find((b) => b.mint === received.mint && b.owner !== addr)?.owner ||
                        fromAddress;
                      toAddress = addr;
                    } else if (sentTokens.length > 0) {
                      type = "send";
                      const sent = sentTokens[0];
                      value = sent.amount.toFixed(6);
                      value_usd = sent.amount * (sent.price_usd || 0) || value_usd;
                      tokenSymbol = sent.symbol;
                      tokenLogo = sent.logo || tokenLogo;
                      tokenName = sent.mint === "native" ? tokenName : "Unknown Token";
                      toAddress =
                        tx.meta?.postTokenBalances?.find((b) => b.mint === sent.mint && b.owner !== addr)?.owner ||
                        toAddress;
                      fromAddress = addr;
                    } else {
                      type = "other";
                      value = "N/A";
                      value_usd = 0;
                    }

                    if (!isValidTokenSymbol(tokenSymbol) && !IMPORTANT_TOKENS.some((t) => t.chain === tx.chain && t.address === "native")) {
                      logger.info(`Filtered out invalid token symbol: ${tokenSymbol} on ${tx.chain}`, { ip });
                      return null;
                    }

                    return {
                      chain: tx.chain,
                      hash: tx.raw_transaction?.transaction?.signatures?.[0] || "Unknown",
                      from: fromAddress,
                      to: toAddress,
                      value,
                      value_usd,
                      block_time: tx.block_time ? new Date(tx.block_time / 1000).toISOString() : null,
                      block_slot: tx.block_slot || null,
                      token: tokenSymbol,
                      type,
                      swap_details,
                      token_metadata: {
                        symbol: tokenSymbol,
                        logo: tokenLogo,
                        name: tokenName,
                      },
                    };
                  }
                })
              );

              const validTransactions = filteredTransactions.filter((tx) => tx !== null);
              logger.info(`Processed ${validTransactions.length} transactions for address ${addr} after pagination`, { ip });
              return validTransactions;
            });

            try {
              const results = await Promise.all(fetchPromises);
              const allTransactions = results.flat();
              logger.info(`Processed transactions data: ${allTransactions.length} transactions total`, { ip });
              createJsonStream(controller, allTransactions);
            } catch (error) {
              if (error.message.includes("rate limit")) {
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify({ detail: error.message }))
                );
              } else {
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify({ detail: `Failed to fetch transactions: ${error.message}` }))
                );
              }
              controller.close();
            }
            return;
          } else if (action === "collectibles" && address) {
            logger.info(`Processing collectibles for address: ${address}`, { ip });
            const effectiveLimit = Math.min(limit || 500, 500);
            const chainParam = isSVMAddress
              ? `chains=${SUPPORTED_SVM_CHAINS.join(",")}`
              : `chain_ids=${SUPPORTED_CHAIN_IDS}`;
            const url = isEVMAddress
              ? `https://api.sim.dune.com/v1/evm/collectibles/${address}?${chainParam}&limit=${effectiveLimit}`
              : `https://api.sim.dune.com/beta/svm/collectibles/${address}?${chainParam}&limit=${effectiveLimit}`;
            logger.info(`Calling Dune Sim API: ${url}`, { ip });
            const response = await fetchWithRateLimit(url, {
              headers: { "X-Sim-Api-Key": process.env.SIM_API_KEY },
            });

            logger.info(
              `Collectibles response for address ${address}: ${response.data.entries?.length || response.data.collectibles?.length || 0} collectibles, time: ${Date.now() - startTime}ms`,
              { ip },
            );

            const data = (response.data.entries || response.data.collectibles || [])
              .filter((nft) => nft.image_url || nft.token_metadata?.logo)
              .map((nft) => ({
                chain: nft.chain,
                chain_id: nft.chain_id || (isSVMAddress ? nft.chain : nft.chain_id),
                contract_address: nft.contract_address,
                token_id: nft.token_id,
                name: nft.name || "Unknown",
                symbol: nft.symbol || "Unknown",
                token_standard: nft.token_standard || "Unknown",
                balance: Number(nft.balance) || 1,
                token_metadata: {
                  logo: nft.image_url || nft.token_metadata?.logo || null,
                },
              }));

            logger.info(`Processed collectibles data: ${data.length} collectibles after filtering`, { ip });
            createJsonStream(controller, data);
            return;
          } else if (action === "proxy-image" && imageUrl) {
            try {
              logger.info(`Proxying image: ${imageUrl}`, { ip });
              const blockedDomains = ["scontent.xx.fbcdn.net", "fbcdn.net"];
              if (blockedDomains.some((domain) => imageUrl.includes(domain))) {
                logger.warn(`Blocked image URL: ${imageUrl} due to restricted domain`, { ip });
                controller.enqueue(JSON.stringify({ detail: "Image URL from restricted domain" }));
                controller.close();
                return;
              }

              const response = await fetchWithRateLimit(imageUrl, {
                responseType: "stream",
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                  Accept: "image/*",
                  Referer: process.env.NEXT_PUBLIC_APP_URL || "https://xynapseai.net",
                },
              });

              const contentType = response.headers["content-type"];
              if (!contentType.startsWith("image/")) {
                logger.warn(`Invalid content-type for image ${imageUrl}: ${contentType}`, { ip });
                controller.enqueue(JSON.stringify({ detail: "Invalid image content type" }));
                controller.close();
                return;
              }

              response.data.on('data', (chunk) => {
                if (controller.desiredSize <= 0) {
                  response.data.pause(); // Pause if buffer is full
                } else {
                  controller.enqueue(chunk);
                  logger.info(`Streamed image chunk of size ${chunk.length} bytes`, { ip });
                }
              });

              response.data.on('end', () => {
                controller.close();
                logger.info(`Completed streaming image: ${imageUrl}`, { ip });
              });

              response.data.on('error', (error) => {
                logger.warn(`Error streaming image ${imageUrl}: ${error.message}`, { ip });
                controller.enqueue(JSON.stringify({ detail: "Failed to stream image", error: error.message }));
                controller.close();
              });

              controller.on('drain', () => {
                response.data.resume(); // Resume when buffer is ready
              });

              return;
            } catch (error) {
              logger.warn(`Failed to proxy image ${imageUrl}: ${error.message}`, { ip });
              controller.enqueue(JSON.stringify({ detail: "Failed to fetch image", error: error.message }));
              controller.close();
              return;
            }
          }

          logger.warn(`Invalid parameters for action: ${action}`, { ip });
          await trackViolation(ip, 'Invalid parameters');
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify({ detail: `Invalid parameters for action: ${action}` }))
          );
          controller.close();
          return;
        } catch (error) {
          if (action === "collectibles" && error.response?.status === 404 && isSVMAddress) {
            logger.warn(`SVM collectibles not supported for address: ${address}`, { ip });
            controller.enqueue(
              new TextEncoder().encode(JSON.stringify({ success: true, data: [] }))
            );
            controller.close();
            return;
          }
          logger.error(`Dune Sim API error for action ${action}: ${error.message}`, {
            status: error.response?.status,
            data: error.response?.data,
            stack: error.stack,
            ip,
          });
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({
                detail:
                  error.response?.status === 429
                    ? "Dune Sim API rate limit exceeded, please try again later."
                    : error.response?.status === 404
                      ? "Requested data not found."
                      : `Dune Sim API error: ${error.message}`,
              })
            )
          );
          controller.close();
          return;
        }
      },
    }),
    {
      headers: {
        ...securityHeaders,
        "Content-Type": action === "proxy-image" ? "image/*" : "application/json",
        "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL || "https://xynapseai.net",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
      },
    },
  );
}

export async function OPTIONS() {
  return NextResponse.json(
    {},
    {
      status: 200,
      headers: {
        ...securityHeaders,
        "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL || "https://xynapseai.net",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
        "Access-Control-Allow-Credentials": "true",
      },
    },
  );
}