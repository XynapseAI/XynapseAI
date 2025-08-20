// app/api/sim/route.js
import { NextResponse } from "next/server";
import axios from "axios";
import { logger } from "../../../utils/serverLogger";
import axiosRetry from "axios-retry";
import { isAddress } from "ethers";
import { auth } from "@/lib/auth";
import { getRedisClient } from "../../../lib/redis";

// Configure axios-retry for Dune API requests
axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => Math.min(retryCount * 2000, 10000),
  retryCondition: (error) => error.response?.status === 429 || error.code === "ECONNABORTED",
  onRetry: (retryCount, error) => {
    logger.warn(`Retrying Dune API request (attempt ${retryCount})`, {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
  },
});

// Define important tokens whitelist
const IMPORTANT_TOKENS = [
  { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", chain: "ethereum", decimals: 6 }, // Tether
  { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", chain: "ethereum", decimals: 6 }, // USD Coin
  { address: "native", symbol: "ETH", chain: "ethereum", decimals: 18 }, // Ethereum native
  { address: "0xB8c77482e45F1F44dE1745F52C74426C631bDD52", symbol: "BNB", chain: "bnb", decimals: 18 }, // BNB
  { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", symbol: "WBTC", chain: "ethereum", decimals: 8 }, // Wrapped Bitcoin
];

async function checkRateLimit(ip, address, isSVMAddress) {
  try {
    const redisClient = await getRedisClient();
    if (!redisClient.isOpen) {
      logger.error("Redis client not connected in checkRateLimit", { ip });
      throw new Error("Redis client not connected");
    }

    const ipKey = `rate_limit:sim:ip:${ip}`;
    const addressKey = address ? `rate_limit:sim:address:${isSVMAddress ? address : address.toLowerCase()}` : null;
    const windowMs = 60 * 1000;

    const ipRequests = Number.parseInt(await redisClient.get(ipKey)) || 0;
    if (ipRequests >= 50) {
      logger.warn(`Rate limit exceeded for IP ${ip}: ${ipRequests} requests`, { ip });
      throw new Error("Too many requests, please try again later.");
    }

    let addressRequests = 0;
    if (addressKey) {
      addressRequests = Number.parseInt(await redisClient.get(addressKey)) || 0;
      if (addressRequests >= 50) {
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
  } catch (err) {
    logger.error(`Rate limit check failed: ${err.message}`, { ip });
    throw err;
  }
}

// Validate Solana address (Base58)
const isValidSolanaAddress = (address) => {
  return address && address.length >= 32 && address.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
};

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
  solana: { symbol: "SOL", logo: "/solana-logo.png", name: "Solana" },
  eclipse: { symbol: "ECL", logo: "/eclipse-logo.png", name: "Eclipse" },
  ethereum: { symbol: "ETH", logo: "/ethereum-logo.png", name: "Ethereum" },
  bnb: { symbol: "BNB", logo: "/bnb-logo.png", name: "BNB" },
  polygon: { symbol: "MATIC", logo: "/polygon-logo.png", name: "Polygon" },
};

async function fetchImageUrl(metadataUrl, ip) {
  try {
    const blockedDomains = ["scontent.xx.fbcdn.net", "fbcdn.net"];
    if (blockedDomains.some((domain) => metadataUrl.includes(domain))) {
      logger.warn(`Blocked metadata URL: ${metadataUrl} due to restricted domain`, { ip });
      return null;
    }

    const response = await axios.get(metadataUrl, {
      timeout: 5000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept: "image/*,application/json",
      },
    });

    if (response.headers["content-type"].includes("application/json")) {
      const metadata = response.data;
      const imageUrl = metadata.image || metadata.logo || metadata.image_url || null;
      if (imageUrl && blockedDomains.some((domain) => imageUrl.includes(domain))) {
        logger.warn(`Blocked image URL from metadata: ${imageUrl}`, { ip });
        return null;
      }
      return imageUrl;
    }
    if (response.headers["content-type"].startsWith("image/")) {
      return metadataUrl;
    }
    return null;
  } catch (error) {
    logger.warn(`Failed to fetch image from metadata URL ${metadataUrl}: ${error.message}`, { ip });
    return null;
  }
}

export async function POST(request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const startTime = Date.now();
  logger.info(`Request to /api/sim from IP ${ip}`);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const validActions = ["top-holders", "wallet-balances", "transactions", "collectibles", "proxy-image"];
  const { action, imageUrl, chain, tokenAddress, address, addresses, decimalPlace, limit, minValueUsd } = body;

  if (!action || !validActions.includes(action)) {
    logger.warn(`Validation error: Invalid 'action' parameter.`, { ip, action });
    return NextResponse.json(
      {
        detail: "Validation failed",
        errors: [{ message: `Invalid 'action'. Must be one of ${validActions.join(", ")}` }],
      },
      { status: 400 },
    );
  }

  const effectiveDecimalPlace =
    typeof decimalPlace === "number" && Number.isInteger(decimalPlace) && decimalPlace >= 0 ? decimalPlace : 18;

  let effectiveLimit = LIMIT_CONFIG[action] || 500;
  if (typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= LIMIT_CONFIG[action]) {
    effectiveLimit = limit;
  }

  let validationError = null;
  const isEVMAddress = address ? isAddress(address) : false;
  const isSVMAddress = address ? isValidSolanaAddress(address) : false;
  const areAddressesValid = addresses ? addresses.every((addr) => isAddress(addr) || isValidSolanaAddress(addr)) : true;

  switch (action) {
    case "proxy-image":
      if (!imageUrl || typeof imageUrl !== "string" || !/^https?:\/\/.+/.test(imageUrl)) {
        validationError = "imageUrl must be a valid URL.";
      }
      break;
    case "top-holders":
      if (!chain || !tokenAddress) {
        validationError = "chain and tokenAddress are required for top-holders.";
      } else if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
        validationError = "tokenAddress must be a valid EVM address format.";
      }
      break;
    case "wallet-balances":
    case "collectibles":
      if (!address) {
        validationError = "address is required for this action.";
      } else if (!isEVMAddress && !isSVMAddress) {
        validationError = "address must be a valid EVM or Solana address.";
      }
      break;
    case "transactions":
      if (!address && (!addresses || !Array.isArray(addresses) || addresses.length === 0)) {
        validationError = "address or addresses array is required for transactions.";
      } else if (address && !isEVMAddress && !isSVMAddress) {
        validationError = "address must be a valid EVM or Solana address.";
      } else if (addresses && !areAddressesValid) {
        validationError = "All addresses must be valid EVM or Solana addresses.";
      }
      break;
    default:
      validationError = `Invalid parameters for the specified action: ${action}`;
      break;
  }

  if (validationError) {
    logger.warn(`Validation error: ${validationError}`, { ip, body });
    return NextResponse.json({ detail: "Validation failed", errors: [{ message: validationError }] }, { status: 400 });
  }

  try {
    const redisClient = await getRedisClient();
    if (!redisClient.isOpen) {
      logger.error("Redis client not connected", { ip });
      throw new Error("Redis client not connected");
    }

    await checkRateLimit(ip, address, isSVMAddress);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ detail: err.message }, { status: err.message.includes("Too many requests") ? 429 : 500 });
  }

  if (!process.env.SIM_API_KEY) {
    logger.error("SIM_API_KEY is not configured", { ip });
    return NextResponse.json({ detail: "Server configuration error: Missing SIM_API_KEY" }, { status: 500 });
  }

  if (["wallet-balances", "transactions", "collectibles"].includes(action)) {
    const session = await auth();
    if (!session || !session.user?.id) {
      logger.error(`Authentication error: Unauthorized`, { ip });
      return NextResponse.json({ detail: "Unauthorized: Please log in." }, { status: 401 });
    }
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          let data = [];

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
            const response = await axios.get(url, {
              headers: { "X-Sim-Api-Key": process.env.SIM_API_KEY },
              timeout: 15000,
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

            data =
              response.data.holders?.map((holder) => {
                const rawBalance = Number(holder.balance) || 0;
                const balance = rawBalance / Math.pow(10, finalDecimalPlace);
                return {
                  address: holder.wallet_address || "Unknown",
                  balance: Number(balance.toFixed(6)),
                };
              }) || [];

            logger.info(`Processed top-holders data: ${data.length} holders`, { ip });
            controller.enqueue(JSON.stringify({ success: true, data }));
            controller.close();
            return;
          } else if (action === "wallet-balances" && address) {
            logger.info(`Processing wallet-balances for address: ${address}`, { ip });

            if (isEVMAddress) {
              let allBalances = [];
              let missingImportantTokens = [...IMPORTANT_TOKENS];
              const allChainIds = Object.values(CHAIN_ID_MAP).join(",");

              // Step 1: Fetch all native tokens first
              let nextOffsetNative = null;
              do {
                const url = `https://api.sim.dune.com/v1/evm/balances/${address}?chain_ids=${allChainIds}&metadata=logo&limit=1000${nextOffsetNative ? `&offset=${nextOffsetNative}` : ''}&filters=native`;
                logger.info(`Calling Dune Sim API (Native): ${url}`, { ip });
                const response = await axios.get(url, {
                  headers: { "X-Sim-Api-Key": process.env.SIM_API_KEY },
                  timeout: 15000,
                });

                logger.info(
                  `Wallet balances (Native) response for address ${address}: ${response.data.balances?.length || 0} tokens, time: ${Date.now() - startTime}ms`,
                  { ip },
                );

                const balances = response.data.balances || [];
                allBalances.push(...balances);

                // Check for important native tokens
                missingImportantTokens = missingImportantTokens.filter((importantToken) => {
                  if (importantToken.address !== "native") return true;
                  return !balances.some((balance) => {
                    const balanceChain = balance.chain?.toLowerCase();
                    return balanceChain === importantToken.chain && balance.address === "native";
                  });
                });

                nextOffsetNative = response.data.next_offset || null;
              } while (nextOffsetNative && missingImportantTokens.some((token) => token.address === "native"));

              // Step 2: Fetch ERC20 tokens after all native tokens are retrieved
              let nextOffsetErc20 = null;
              do {
                const url = `https://api.sim.dune.com/v1/evm/balances/${address}?chain_ids=${allChainIds}&metadata=logo&limit=1000${nextOffsetErc20 ? `&offset=${nextOffsetErc20}` : ''}&filters=erc20`;
                logger.info(`Calling Dune Sim API (ERC20): ${url}`, { ip });
                const response = await axios.get(url, {
                  headers: { "X-Sim-Api-Key": process.env.SIM_API_KEY },
                  timeout: 15000,
                });

                logger.info(
                  `Wallet balances (ERC20) response for address ${address}: ${response.data.balances?.length || 0} tokens, time: ${Date.now() - startTime}ms`,
                  { ip },
                );

                const balances = response.data.balances || [];
                allBalances.push(...balances);

                // Check for important ERC20 tokens
                missingImportantTokens = missingImportantTokens.filter((importantToken) => {
                  if (importantToken.address === "native") return true;
                  return !balances.some((balance) => {
                    const balanceChain = balance.chain?.toLowerCase();
                    const balanceAddress = balance.address?.toLowerCase();
                    const importantTokenAddress = importantToken.address.toLowerCase();
                    return balanceChain === importantToken.chain && balanceAddress === importantTokenAddress;
                  });
                });

                nextOffsetErc20 = response.data.next_offset || null;
              } while (nextOffsetErc20 && missingImportantTokens.some((token) => token.address !== "native"));

              // Remove duplicates based on chain and address
              const uniqueBalances = [];
              const seen = new Set();
              for (const balance of allBalances) {
                const key = `${balance.chain}-${balance.address}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  uniqueBalances.push(balance);
                }
              }

              // Process balances
              data = await Promise.all(
                uniqueBalances.map(async (balance) => {
                  let logo = balance.token_metadata?.logo || null;
                  if (balance.address === "native") {
                    logo = NATIVE_TOKEN_METADATA[balance.chain]?.logo || logo;
                  }
                  return {
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
                }),
              );

              // Apply minValueUsd filter if provided
              if (minValueUsd) {
                data = data.filter((balance) => balance.value_usd >= minValueUsd);
              }

              // Sort to prioritize native tokens first
              data.sort((a, b) => {
                const aIsNative = a.address === "native" ? -1 : 1;
                const bIsNative = b.address === "native" ? -1 : 1;
                return aIsNative - bIsNative;
              });

              // Apply user-specified limit
              if (effectiveLimit < data.length) {
                data = data.slice(0, effectiveLimit);
              }

              logger.info(`Processed wallet balances data: ${data.length} tokens after processing`, { ip });
              controller.enqueue(JSON.stringify({ success: true, data }));
              controller.close();
              return;
            } else {
              // SVM balances (unchanged from original)
              const chainParam = `chains=${SUPPORTED_SVM_CHAINS.join(",")}`;
              const url = `https://api.sim.dune.com/beta/svm/balances/${address}?${chainParam}&limit=${effectiveLimit}`;
              logger.info(`Calling Dune Sim API: ${url}`, { ip });
              const response = await axios.get(url, {
                headers: { "X-Sim-Api-Key": process.env.SIM_API_KEY },
                timeout: 15000,
              });

              logger.info(
                `Wallet balances response for address ${address}: ${response.data.balances?.length || 0} tokens, time: ${Date.now() - startTime}ms`,
                { ip },
              );

              data = await Promise.all(
                response.data.balances?.map(async (balance) => {
                  let logo = balance.uri || null;
                  if ((balance.chain === "solana" || balance.chain === "eclipse") && balance.address === "native") {
                    logo = balance.chain === "solana" ? "/solana-logo.png" : "/eclipse-logo.png";
                  } else if (isSVMAddress && logo) {
                    const imageUrl = await fetchImageUrl(logo, ip);
                    logo = imageUrl;
                  }
                  return {
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
                }) || [],
              );

              logger.info(`Processed wallet balances data: ${data.length} tokens after processing`, { ip });
              controller.enqueue(JSON.stringify({ success: true, data }));
              controller.close();
              return;
            }
          } else if (action === "transactions") {
            logger.info(`Processing transactions for addresses: ${addresses || address}`, { ip });
            const targetAddresses = addresses && addresses.length > 0 ? addresses : [address];
            const chainParam = targetAddresses.some((addr) => isValidSolanaAddress(addr))
              ? `chains=${SUPPORTED_SVM_CHAINS.join(",")}`
              : `chain_ids=${SUPPORTED_CHAIN_IDS}`;

            for (const addr of targetAddresses) {
              const isEVM = isAddress(addr);
              const url = isEVM
                ? `https://api.sim.dune.com/v1/evm/activity/${addr}?${chainParam}&limit=${effectiveLimit}&sort=desc`
                : `https://api.sim.dune.com/beta/svm/transactions/${addr}?${chainParam}&limit=${effectiveLimit}&sort=desc`;
              logger.info(`Calling Dune Sim API: ${url}`, { ip });

              try {
                const response = await axios.get(url, {
                  headers: { "X-Sim-Api-Key": process.env.SIM_API_KEY },
                  timeout: 15000,
                });

                logger.info(
                  `Transactions response for address ${addr}: ${response.data.activity?.length || response.data.transactions?.length || 0} transactions, time: ${Date.now() - startTime}ms`,
                  { ip },
                );

                const transactions = (isEVM ? response.data.activity : response.data.transactions) || [];
                const filteredTransactions = transactions
                  .map((tx) => {
                    if (isEVM) {
                      const decimals = tx.asset_type === "native" ? 18 : tx.token_metadata?.decimals || 18;
                      const value_usd = Number(tx.value_usd || 0);
                      if (minValueUsd && value_usd < minValueUsd) return null;
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
                        token:
                          tx.token_metadata?.symbol ||
                          (tx.asset_type === "native" ? NATIVE_TOKEN_METADATA[tx.chain]?.symbol || "Native" : "Unknown"),
                        type: tx.type || "Unknown",
                        token_metadata: {
                          symbol:
                            tx.token_metadata?.symbol ||
                            (tx.asset_type === "native"
                              ? NATIVE_TOKEN_METADATA[tx.chain]?.symbol || "Native"
                              : "Unknown"),
                          logo: tx.token_metadata?.logo || NATIVE_TOKEN_METADATA[tx.chain]?.logo || null,
                          name: tx.token_metadata?.name || NATIVE_TOKEN_METADATA[tx.chain]?.name || "Unknown",
                        },
                      };
                    } else {
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
                                receivedTokens.push({
                                  mint: postBalance.mint,
                                  amount: delta / Math.pow(10, postBalance.uiTokenAmount.decimals || 9),
                                  symbol: postBalance.mint.slice(0, 4) + "..." || "Unknown",
                                  logo: null,
                                  decimals: postBalance.uiTokenAmount.decimals || 9,
                                });
                              } else if (delta < 0) {
                                sentTokens.push({
                                  mint: postBalance.mint,
                                  amount: -delta / Math.pow(10, postBalance.uiTokenAmount.decimals || 9),
                                  symbol: postBalance.mint.slice(0, 4) + "..." || "Unknown",
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
                  .filter((tx) => tx !== null);

                data.push(...filteredTransactions);
              } catch (error) {
                logger.error(`Error fetching transactions for address ${addr}: ${error.message}`, { ip });
                if (error.response?.status === 429) {
                  controller.enqueue(
                    JSON.stringify({ detail: "Dune Sim API rate limit exceeded, please try again later." })
                  );
                  controller.close();
                  return;
                } else if (error.response?.status === 404) {
                  controller.enqueue(JSON.stringify({ success: true, data: [] }));
                  controller.close();
                  return;
                } else {
                  controller.enqueue(JSON.stringify({ detail: `Failed to fetch transactions: ${error.message}` }));
                  controller.close();
                  return;
                }
              }
            }

            logger.info(`Processed transactions data: ${data.length} transactions`, { ip });
            controller.enqueue(JSON.stringify({ success: true, data }));
            controller.close();
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
            const response = await axios.get(url, {
              headers: { "X-Sim-Api-Key": process.env.SIM_API_KEY },
              timeout: 15000,
            });

            logger.info(
              `Collectibles response for address ${address}: ${response.data.entries?.length || response.data.collectibles?.length || 0} collectibles, time: ${Date.now() - startTime}ms`,
              { ip },
            );

            data = (response.data.entries || response.data.collectibles || [])
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
            controller.enqueue(JSON.stringify({ success: true, data }));
            controller.close();
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

              const response = await axios.get(imageUrl, {
                responseType: "arraybuffer",
                timeout: 5000,
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

              controller.enqueue(response.data);
              controller.close();
              return;
            } catch (error) {
              logger.warn(`Failed to proxy image ${imageUrl}: ${error.message}`, { ip });
              controller.enqueue(JSON.stringify({ detail: "Failed to fetch image", error: error.message }));
              controller.close();
              return;
            }
          }

          logger.warn(`Invalid parameters for action: ${action}`, { ip });
          controller.enqueue(JSON.stringify({ detail: `Invalid parameters for action: ${action}` }));
          controller.close();
          return;
        } catch (error) {
          if (action === "collectibles" && error.response?.status === 404 && isSVMAddress) {
            logger.warn(`SVM collectibles not supported for address: ${address}`, { ip });
            controller.enqueue(JSON.stringify({ success: true, data: [] }));
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
            JSON.stringify({
              detail:
                error.response?.status === 429
                  ? "Dune Sim API rate limit exceeded, please try again later."
                  : error.response?.status === 404
                    ? "Requested data not found."
                    : `Dune Sim API error: ${error.message}`,
            }),
          );
          controller.close();
          return;
        }
      },
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL || "https://xynapseai.net",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
        "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL || "https://xynapseai.net",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
      },
    },
  );
}