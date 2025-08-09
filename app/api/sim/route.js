import { NextResponse } from 'next/server';
import axios from 'axios';
import { logger } from '../../../utils/serverLogger';
import axiosRetry from 'axios-retry';
import { isAddress } from 'ethers';
import { auth } from '@/lib/auth';
import { createClient } from 'redis';

axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => Math.min(retryCount * 2000, 10000),
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED',
  onRetry: (retryCount, error) => {
    logger.warn(`Retrying Dune API request (attempt ${retryCount})`, {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
  },
});

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

async function checkRateLimit(ip, address) {
  const ipKey = `rate_limit:sim:ip:${ip}`;
  const addressKey = address ? `rate_limit:sim:address:${address}` : null;
  const windowMs = 60 * 1000;

  const ipRequests = await redisClient.get(ipKey) || 0;
  if (ipRequests >= 100) {
    throw new Error('Too many requests, please try again later.');
  }

  let addressRequests = 0;
  if (addressKey) {
    addressRequests = await redisClient.get(addressKey) || 0;
    if (addressRequests >= 100) {
      throw new Error('Too many requests for this wallet address.');
    }
  }

  const multi = redisClient.multi()
    .incr(ipKey)
    .expire(ipKey, windowMs / 1000);

  if (addressKey) {
    multi.incr(addressKey).expire(addressKey, windowMs / 1000);
  }

  await multi.exec();
}

const isValidSolanaAddress = (address) => {
  return address && address.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
};

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

const NATIVE_TOKEN_METADATA = {
  solana: { symbol: 'SOL', logo: '/solana-logo.png', name: 'Solana' },
  eclipse: { symbol: 'ECL', logo: '/eclipse-logo.png', name: 'Eclipse' },
};

async function fetchImageUrl(metadataUrl, ip) {
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
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const startTime = Date.now();
  logger.info(`Request to /api/sim from IP ${ip}`);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  // --- Manual validation replacing Zod ---
  const validActions = ['top-holders', 'wallet-balances', 'transactions', 'collectibles', 'proxy-image'];
  const { action, imageUrl, chain, tokenAddress, address, decimalPlace, limit } = body;

  // Validate 'action'
  if (!action || !validActions.includes(action)) {
    logger.warn(`Validation error: Invalid 'action' parameter.`, { ip, action });
    return NextResponse.json({ detail: 'Validation failed', errors: [{ message: `Invalid 'action'. Must be one of ${validActions.join(', ')}` }] }, { status: 400 });
  }

  // Set default values for optional parameters
  const effectiveDecimalPlace = typeof decimalPlace === 'number' && Number.isInteger(decimalPlace) && decimalPlace >= 0
    ? decimalPlace
    : 18;
  const effectiveLimit = typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= 3000
    ? limit
    : 3000;

  // Validate parameters based on 'action'
  let validationError = null;
  switch (action) {
    case 'proxy-image':
      if (!imageUrl || typeof imageUrl !== 'string' || !/^https?:\/\/.+/.test(imageUrl)) {
        validationError = 'imageUrl must be a valid URL.';
      }
      break;
    case 'top-holders':
      if (!chain || !tokenAddress) {
        validationError = 'chain and tokenAddress are required for top-holders.';
      } else if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
        validationError = 'tokenAddress must be a valid EVM address format.';
      }
      break;
    case 'wallet-balances':
    case 'transactions':
    case 'collectibles':
      if (!address) {
        validationError = 'address is required for this action.';
      } else if (!isAddress(address) && !isValidSolanaAddress(address)) {
        validationError = 'address must be a valid EVM or Solana address.';
      }
      break;
    default:
      // This case is already covered by the initial 'action' check, but for completeness.
      validationError = `Invalid parameters for the specified action: ${action}`;
      break;
  }

  if (validationError) {
    logger.warn(`Validation error: ${validationError}`, { ip, body });
    return NextResponse.json({ detail: 'Validation failed', errors: [{ message: validationError }] }, { status: 400 });
  }
  // --- End of manual validation ---

  try {
    await checkRateLimit(ip, address);
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`, { ip });
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  if (!process.env.SIM_API_KEY) {
    logger.error('SIM_API_KEY is not configured');
    return NextResponse.json({ detail: 'Server configuration error: Missing SIM_API_KEY' }, { status: 500 });
  }

  if (['wallet-balances', 'transactions', 'collectibles'].includes(action)) {
    const session = await auth();
    if (!session || !session.user?.id) {
      logger.error(`Authentication error: Unauthorized`, { ip });
      return NextResponse.json({ detail: 'Unauthorized: Please log in.' }, { status: 401 });
    }
  }

  const isEVMAddress = isAddress(address || '');
  const isSVMAddress = isValidSolanaAddress(address || '');
  const chainParam = isEVMAddress ? `chain_ids=${SUPPORTED_CHAIN_IDS}` : `chains=${SUPPORTED_SVM_CHAINS.join(',')}`;

  // Streaming response for large datasets
  if (['wallet-balances', 'transactions', 'collectibles'].includes(action) || action === 'top-holders') {
    return new NextResponse(
      new ReadableStream({
        async start(controller) {
          try {
            let data;

            if (action === 'top-holders' && chain && tokenAddress) {
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
                headers: { 'X-Sim-Api-Key': process.env.SIM_API_KEY },
                timeout: 15000,
              });

              logger.info(`Top holders response for chain ${chain} (${chainId}): ${response.data.holders?.length || 0} holders, time: ${Date.now() - startTime}ms`, { ip });

              const knownTokens = {
                '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6, // USDC
                '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
              };
              let finalDecimalPlace = effectiveDecimalPlace;
              if (knownTokens[tokenAddress.toLowerCase()]) {
                finalDecimalPlace = knownTokens[tokenAddress.toLowerCase()];
              }

              data = response.data.holders?.map((holder) => {
                const rawBalance = Number(holder.balance) || 0;
                const balance = rawBalance / Math.pow(10, finalDecimalPlace);
                return {
                  address: holder.wallet_address || 'Unknown',
                  balance: Number(balance.toFixed(6)),
                };
              }) || [];

              logger.info(`Processed top-holders data: ${data.length} holders`, { ip });
              controller.enqueue(JSON.stringify({ success: true, data }));
              controller.close();
            } else if (action === 'wallet-balances' && address) {
              logger.info(`Processing wallet-balances for address: ${address}`, { ip });
              const url = isEVMAddress
                ? `https://api.sim.dune.com/v1/evm/balances/${address}?${chainParam}&metadata=logo&limit=${effectiveLimit}`
                : `https://api.sim.dune.com/beta/svm/balances/${address}?${chainParam}&limit=${effectiveLimit}`;
              logger.info(`Calling Dune Sim API: ${url}`, { ip });
              const response = await axios.get(url, {
                headers: { 'X-Sim-Api-Key': process.env.SIM_API_KEY },
                timeout: 15000,
              });

              logger.info(`Wallet balances response for address ${address}: ${response.data.balances?.length || 0} tokens, time: ${Date.now() - startTime}ms`, { ip });

              data = await Promise.all(
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

              logger.info(`Processed wallet balances data: ${data.length} tokens after processing`, { ip });
              controller.enqueue(JSON.stringify({ success: true, data }));
              controller.close();
            } else if (action === 'transactions' && address) {
              logger.info(`Processing transactions for address: ${address}`, { ip });
              const effectiveLimit = Math.min(limit, 500);
              const url = isEVMAddress
                ? `https://api.sim.dune.com/v1/evm/activity/${address}?${chainParam}&limit=${effectiveLimit}&sort=desc`
                : `https://api.sim.dune.com/beta/svm/transactions/${address}?${chainParam}&limit=${effectiveLimit}&sort=desc`;
              logger.info(`Calling Dune Sim API: ${url}`, { ip });
              const response = await axios.get(url, {
                headers: { 'X-Sim-Api-Key': process.env.SIM_API_KEY },
                timeout: 15000,
              });

              logger.info(`Transactions response for address ${address}: ${response.data.activity?.length || response.data.transactions?.length || 0} transactions, time: ${Date.now() - startTime}ms`, { ip });

              data = (isEVMAddress ? response.data.activity : response.data.transactions)?.map((tx) => {
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
                    tokenLogo = null;
                    tokenName = 'Unknown Token';
                  } else {
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
              controller.enqueue(JSON.stringify({ success: true, data }));
              controller.close();
            } else if (action === 'collectibles' && address) {
              logger.info(`Processing collectibles for address: ${address}`, { ip });
              const effectiveLimit = Math.min(limit, 500);
              const url = isEVMAddress
                ? `https://api.sim.dune.com/v1/evm/collectibles/${address}?${chainParam}&limit=${effectiveLimit}`
                : `https://api.sim.dune.com/beta/svm/collectibles/${address}?${chainParam}&limit=${effectiveLimit}`;
              logger.info(`Calling Dune Sim API: ${url}`, { ip });
              const response = await axios.get(url, {
                headers: { 'X-Sim-Api-Key': process.env.SIM_API_KEY },
                timeout: 15000,
              });

              logger.info(`Collectibles response for address ${address}: ${response.data.entries?.length || response.data.collectibles?.length || 0} collectibles, time: ${Date.now() - startTime}ms`, { ip });

              data = (response.data.entries || response.data.collectibles || [])
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
              controller.enqueue(JSON.stringify({ success: true, data }));
              controller.close();
            }
          } catch (error) {
            if (action === 'collectibles' && error.response?.status === 404 && isSVMAddress) {
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
            controller.enqueue(JSON.stringify({
              detail: error.response?.status === 429
                ? 'Dune Sim API rate limit exceeded, please try again later.'
                : error.response?.status === 404
                  ? 'Requested data not found.'
                  : `Dune Sim API error: ${error.message}`,
            }));
            controller.close();
          }
        },
      }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'https://xynapseai.net',
        'Access-Control-Allow-Methods': 'POST',
      },
    });
  }


  // Non-streaming response for proxy-image
  if (action === 'proxy-image' && imageUrl) {
    try {
      logger.info(`Proxying image: ${imageUrl}`, { ip });
      const blockedDomains = ['scontent.xx.fbcdn.net', 'fbcdn.net'];
      if (blockedDomains.some((domain) => imageUrl.includes(domain))) {
        logger.warn(`Blocked image URL: ${imageUrl} due to restricted domain`, { ip });
        return NextResponse.json({ detail: 'Image URL from restricted domain' }, { status: 400 });
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
        return NextResponse.json({ detail: 'Invalid image content type' }, { status: 400 });
      }

      return new NextResponse(response.data, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'https://xynapseai.net',
          'Access-Control-Allow-Methods': 'POST',
        },
      });
    } catch (error) {
      logger.warn(`Failed to proxy image ${imageUrl}: ${error.message}`, { ip });
      return NextResponse.json({ detail: 'Failed to fetch image', error: error.message }, { status: 400 });
    }
  }

  logger.warn(`Invalid parameters for action: ${action}`, { ip });
  return NextResponse.json({ detail: `Invalid parameters for action: ${action}` }, { status: 400 });
}
