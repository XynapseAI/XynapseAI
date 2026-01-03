// app/api/get-transactions/route.js
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '../../../utils/serverLogger'
import { createClient } from 'redis'
import { query } from '../../../utils/postgres'
import { isAddress } from 'ethers'
import { ethers } from 'ethers'
import axios from 'axios'
import axiosRetry from 'axios-retry'
import Bottleneck from 'bottleneck'
import crypto from 'crypto'
import { BLOCKED_TOKEN_ADDRESSES } from '../../../utils/constants'
import { autoLabelWallets } from '../../../utils/serverClustering'
import { bech32 } from 'bech32'
let redisClient
async function getRedisClient() {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL
    if (!redisUrl) throw new Error('REDIS_URL environment variable is required.')
    redisClient = createClient({ url: redisUrl })
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }))
    await redisClient.connect()
    logger.info('Redis connected')
  }
  return redisClient
}
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self';",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
}
async function banIP(ip, durationSeconds = 3600) {
  if (ip === '::1' || ip === '127.0.0.1') return
  const redisClient = await getRedisClient()
  await redisClient.setEx(`banned_ip:${ip}`, durationSeconds, 'banned')
  logger.info(`IP banned: ${ip} for ${durationSeconds} seconds`)
}
async function checkIPBan(ip) {
  if (ip === '::1' || ip === '127.0.0.1') return
  const redisClient = await getRedisClient()
  const isBanned = await redisClient.get(`banned_ip:${ip}`)
  if (isBanned) throw new Error('IP temporarily banned.')
}
async function trackViolation(ip, reason = '') {
  if (ip === '::1' || ip === '127.0.0.1') {
    logger.warn(`Localhost violation skipped: ${reason}`)
    return
  }
  const redisClient = await getRedisClient()
  const key = `violations:${ip}`
  const maxViolations = 50
  const windowMs = 30 * 60 * 1000
  const pipeline = redisClient.multi()
  pipeline.incr(key)
  pipeline.expire(key, windowMs / 1000)
  const [violations] = await pipeline.exec()
  if (violations >= maxViolations) {
    await banIP(ip, 3600)
    throw new Error('IP temporarily banned due to excessive violations.')
  }
  logger.warn(`Violation tracked for IP ${ip}: ${reason}`)
}
async function checkRateLimit(ip) {
  if (ip === '::1' || ip === '127.0.0.1') return
  const redisClient = await getRedisClient()
  const key = `rate_limit:get_transactions:ip:${ip}`
  const maxRequests = 200
  const windowMs = 30 * 60 * 1000
  const pipeline = redisClient.multi()
  pipeline.incr(key)
  pipeline.expire(key, windowMs / 1000)
  const [requests] = await pipeline.exec()
  if (requests > maxRequests) throw new Error('Too many requests.')
}
let circuitOpen = false
let failureCount = 0
const maxFailures = 15
const resetTimeout = 120000
async function fetchWithRateLimit(url, config) {
  if (circuitOpen) throw new Error('Service temporarily unavailable.')
  try {
    const response = await limiterBottleneck.schedule(() =>
      axios.get(url, { ...config, timeout: 10000 }),
    ) // Reduced timeout
    failureCount = 0
    return response
  } catch (error) {
    failureCount++
    if (failureCount >= maxFailures) {
      circuitOpen = true
      setTimeout(() => {
        circuitOpen = false
        failureCount = 0
      }, resetTimeout)
    }
    throw error
  }
}
const limiterBottleneck = new Bottleneck({
  maxConcurrent: 25,
  minTime: 30,
  reservoir: 300,
  reservoirRefreshAmount: 300,
  reservoirRefreshInterval: 30 * 1000,
})
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => Math.pow(2, retryCount) * 300 + Math.random() * 50,
  retryCondition: (error) =>
    error.response?.status === 429 ||
    error.code === 'ECONNABORTED' ||
    error.response?.status === 400,
})
async function isAllowedOrigin(origin, referer, ip) {
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://farcaster.xynapseai.net',
    'https://base.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://xynapse-ai.vercel.app',
  ].filter(Boolean)
  if (process.env.NODE_ENV !== 'production')
    return configured.some((url) => url === origin || (referer && new URL(referer).origin === url))
  try {
    const source = origin && origin !== 'null' ? origin : referer ? new URL(referer).origin : null
    if (!source || !source.startsWith('https://')) {
      await trackViolation(ip, 'Non-HTTPS or missing origin/referer')
      return false
    }
    if (configured.includes(source)) return true
    await trackViolation(ip, 'Invalid origin/referer')
    return false
  } catch {
    await trackViolation(ip, 'Error validating origin')
    return false
  }
}
const SUPPORTED_CHAINS = {
  1: {
    name: 'ethereum',
    explorer: 'Etherscan',
    apiUrl: 'https://api.etherscan.io/v2/api',
    apiKey: process.env.ETHERSCAN_API_KEY,
    coingeckoId: 'ethereum',
  },
  56: {
    name: 'bsc',
    explorer: 'BscScan',
    apiUrl: 'https://api.etherscan.io/v2/api',
    apiKey: process.env.ETHERSCAN_API_KEY,
    coingeckoId: 'binance-smart-chain',
  },
  10: {
    name: 'optimism',
    explorer: 'Optimistic Etherscan',
    apiUrl: 'https://api.etherscan.io/v2/api',
    apiKey: process.env.ETHERSCAN_API_KEY,
    coingeckoId: 'optimism',
  },
  130: { name: 'unichain', explorer: 'Unichain Explorer', apiUrl: '', apiKey: '', coingeckoId: '' },
  137: {
    name: 'polygon',
    explorer: 'Polygonscan',
    apiUrl: 'https://api.etherscan.io/v2/api',
    apiKey: process.env.ETHERSCAN_API_KEY,
    coingeckoId: 'polygon-pos',
  },
  5000: {
    name: 'mantle',
    explorer: 'Mantle Explorer',
    apiUrl: 'https://explorer.mantle.xyz/api',
    apiKey: '',
    coingeckoId: 'mantle',
  },
  42161: {
    name: 'arbitrum',
    explorer: 'Arbiscan',
    apiUrl: 'https://api.etherscan.io/v2/api',
    apiKey: process.env.ETHERSCAN_API_KEY,
    coingeckoId: 'arbitrum-one',
  },
  59144: {
    name: 'linea',
    explorer: 'Linea Explorer',
    apiUrl: '',
    apiKey: '',
    coingeckoId: 'linea',
  },
  534352: {
    name: 'scroll',
    explorer: 'Scroll Explorer',
    apiUrl: '',
    apiKey: '',
    coingeckoId: 'scroll',
  },
  solana: {
    name: 'solana',
    explorer: 'Solscan',
    apiUrl: 'https://public-api.solscan.io',
    apiKey: process.env.SOLSCAN_API_KEY,
    coingeckoId: 'solana',
  },
  tron: {
    name: 'tron',
    explorer: 'TronScan',
    apiUrl: 'https://api.tronscan.org/api',
    apiKey: process.env.TRONSCAN_API_KEY,
    coingeckoId: 'tron',
  },
  bitcoin: {
    name: 'bitcoin',
    explorer: 'Mempool',
    apiUrl: 'https://mempool.space/api',
    apiKey: '',
    coingeckoId: 'bitcoin',
  },
  monad: {
    name: 'monad',
    explorer: 'Monad Explorer',
    apiUrl: 'https://monadvision.com/',
    apiKey: process.env.ETHERSCAN_API_KEY,
    coingeckoId: 'monad',
  },
}
const alchemyNetworks = {
  1: 'eth-mainnet',
  10: 'opt-mainnet',
  137: 'polygon-mainnet',
  59144: 'linea-mainnet',
  8453: 'base-mainnet',
  999: 'hyperliquid-mainnet',
  43114: 'avax-mainnet',
  56: 'bnb-mainnet',
  130: 'unichain-mainnet',
  143: 'monad-mainnet',
  42161: 'arb-mainnet',
  5000: 'mantle-mainnet',
  534352: 'scroll-mainnet',
}
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY
const chainIdToName = Object.fromEntries(
  Object.entries(SUPPORTED_CHAINS).map(([id, { name }]) => [id, name]),
)
const bodySchema = z.object({
  wallet_address: z.string().nonempty('Wallet address is required'),
  chain: z.enum(Object.keys(SUPPORTED_CHAINS), { message: 'Invalid chain' }),
  limit: z.number().int().min(10).max(2000, 'Limit must be between 100 and 2000'),
  page: z.number().int().min(1).default(1),
  fetchLayer3: z.boolean().optional().default(false),
  isToken: z.boolean().optional().default(false),
})
function formatAddress(addr, chain) {
  if (!addr) return 'N/A'
  if (addr.startsWith('0x')) {
    try {
      return ethers.getAddress(addr)
    } catch {
      return addr
    }
  }
  return addr
}
function isValidTokenSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return false
  const cleanedSymbol = symbol.trim().toLowerCase()
  if (cleanedSymbol.length < 2 || cleanedSymbol.length > 20) return false
  const validSymbolPattern = /^[a-z0-9\-_]+$/
  if (!validSymbolPattern.test(cleanedSymbol)) return false
  const urlPattern = /(https?:\/\/|www\.|\.com|\.org|\.net|\.io)/i
  if (urlPattern.test(cleanedSymbol)) return false
  const suspiciousKeywords = ['claim', 'free', 'airdrop', 'promo', 'reward', 'bonus']
  return !suspiciousKeywords.some((keyword) => cleanedSymbol.includes(keyword))
}
function isValidBitcoinAddress(addr) {
  if (typeof addr !== 'string') return false
  addr = addr.trim()
  // Legacy: P2PKH (1...), P2SH (3...), less strict (allow 0, I, O, l and slight length variation)
  if (/^[13][0-9A-Za-z]{25,35}$/.test(addr)) {
    return true // Skip checksum, basic format only for less strictness
  }
  // Bech32 (bc1...): Skip checksum, just format check for less strictness
  if (/^bc1[a-z0-9]{39,59}$/i.test(addr)) {
    return true
  }
  return false
}
function safeFormatUnits(value, unit) {
  if (value == null) return '0'
  try {
    return ethers.formatUnits(value, unit)
  } catch (error) {
    logger.warn(
      `Failed to format units for value ${value} with unit ${unit}: ${error.message}. Using raw value.`,
    )
    return typeof value === 'number' ? value.toFixed(6) : String(value)
  }
}
function safeFormatEther(value) {
  return safeFormatUnits(value, 18)
}
async function getChainLogo(coingeckoId) {
  const cacheKey = `chain_logo_${coingeckoId}`
  const redisClient = await getRedisClient()
  const cached = await redisClient.get(cacheKey)
  if (cached) return cached
  try {
    const response = await fetchWithRateLimit('https://api.coingecko.com/api/v3/asset_platforms', {
      headers: { 'x-c-g-demo-api-key': process.env.COINGECKO_API_KEY },
      timeout: 8000,
    })
    const chain = response.data.find((c) => c.id === coingeckoId)
    const logo = chain?.image?.thumb || '/icons/default.webp'
    await redisClient.setEx(cacheKey, 30 * 24 * 60 * 60, logo)
    return logo
  } catch {
    return '/icons/default.webp'
  }
}
async function getCurrentPrice(cgId) {
  const redisClient = await getRedisClient()
  const cacheKey = `price_${cgId}`
  const cached = await redisClient.get(cacheKey)
  if (cached) return parseFloat(cached)
  try {
    const response = await fetchWithRateLimit(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`,
      { headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } },
    )
    const price = response.data[cgId]?.usd
    if (price) {
      await redisClient.setEx(cacheKey, 300, price.toString())
      return price
    }
  } catch (e) {
    logger.error(`Error fetching price for ${cgId}:`, e)
  }
  return 0
}
async function getTokenCurrentPriceBatch(platform, contractAddresses) {
  const redisClient = await getRedisClient()
  const contractList = contractAddresses.join(',')
  const cacheKey = `token_prices_batch_${platform}_${contractList}`
  const cached = await redisClient.get(cacheKey)
  if (cached) {
    return JSON.parse(cached)
  }
  if (circuitOpen) {
    logger.warn(`Circuit open, skipping price batch for ${platform}`)
    return {}
  }
  try {
    const response = await fetchWithRateLimit(
      `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${contractList}&vs_currencies=usd`,
      { headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } },
    )
    const prices = response.data || {}
    await redisClient.setEx(cacheKey, 300, JSON.stringify(prices))
    return prices
  } catch (e) {
    logger.error(`Error fetching batch token prices for ${platform}:`, e)
    return {}
  }
}
async function getTokenCurrentPrice(platform, contractAddress) {
  const prices = await getTokenCurrentPriceBatch(platform, [contractAddress])
  return prices[contractAddress.toLowerCase()]?.usd || 0
}
async function getNametagsBatch(addresses, chain) {
  const start = Date.now()
  const isCaseSensitive = ['bitcoin', 'solana', 'tron'].includes(chain)
  const lowerToOriginal = new Map(addresses.map((a) => [a.toLowerCase(), a]))
  const uniqueLowers = [...new Set(addresses.map((a) => a.toLowerCase()))]
  const nametags = {}
  if (uniqueLowers.length === 0) return nametags
  const redisClient = await getRedisClient()
  const cacheKeys = uniqueLowers.map((addr) => `nametag_${addr}`)
  const cachedResults = await redisClient.mGet(cacheKeys)
  const cachedNametags = cachedResults.reduce((acc, cached, index) => {
    if (cached) {
      const parsed = JSON.parse(cached)
      acc[uniqueLowers[index]] = {
        address: lowerToOriginal.get(uniqueLowers[index]),
        name: parsed.name,
        image: parsed.image,
        description: parsed.description || '',
        subcategory: parsed.subcategory || 'Others',
      }
    }
    return acc
  }, {})
  const lowersToQuery = uniqueLowers.filter((addr) => !cachedNametags[addr])
  if (lowersToQuery.length > 0) {
    const queryAddresses = isCaseSensitive
      ? lowersToQuery.map((l) => lowerToOriginal.get(l))
      : lowersToQuery
    const result = await query(
      `SELECT address, nametag, image, description, subcategory
       FROM nametags
       WHERE ${isCaseSensitive ? 'address' : 'LOWER(address)'} = ANY($1)`,
      [queryAddresses],
    )
    for (const row of result.rows) {
      const addressKey = isCaseSensitive ? row.address.toLowerCase() : row.address
      const originalAddress = isCaseSensitive ? row.address : row.address
      cachedNametags[addressKey] = {
        address: originalAddress,
        name: row.nametag || 'Unknown',
        image: row.image || '/icons/default.webp',
        description: row.description || '',
        subcategory: row.subcategory || 'Others',
      }
      await redisClient.setEx(
        `nametag_${addressKey}`,
        30 * 24 * 60 * 60,
        JSON.stringify(cachedNametags[addressKey]),
      )
    }
  }
  const lowersWithoutNametag = uniqueLowers.filter(
    (addr) => !cachedNametags[addr] || cachedNametags[addr].name === 'Unknown',
  )
  const addressesWithoutNametag = lowersWithoutNametag
    .map((l) => lowerToOriginal.get(l))
    .slice(0, 20)
  if (
    !isCaseSensitive &&
    chain === '1' &&
    addressesWithoutNametag.length > 0 &&
    addressesWithoutNametag.length <= 20
  ) {
    const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'
    const REGISTRY_ABI = ['function resolver(bytes32 node) view returns (address)']
    const RESOLVER_ABI = ['function name(bytes32 node) view returns (string)']
    const ENS_MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'
    const MULTICALL_ABI = [
      'function aggregate((address target, bytes callData)[] calldata calls) external payable returns (uint256 blockNumber, bytes[] memory returnData)',
    ]
    const ENS_PROVIDER = new ethers.JsonRpcProvider(
      process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    )
    try {
      const ensBatchKey = `ens_batch_${crypto.createHash('md5').update(addressesWithoutNametag.join(',')).digest('hex')}`
      const cachedEns = await redisClient.get(ensBatchKey)
      if (cachedEns) {
        const parsedEns = JSON.parse(cachedEns)
        Object.entries(parsedEns).forEach(([addrLower, data]) => {
          cachedNametags[addrLower] = {
            address: lowerToOriginal.get(addrLower),
            ...data,
          }
        })
        logger.info(`ENS batch cache hit for ${addressesWithoutNametag.length} addresses`)
      } else {
        const reverseNodes = addressesWithoutNametag
          .filter((addr) => addr.startsWith('0x'))
          .map((addr) => ethers.namehash(`${addr.slice(2).toLowerCase()}.addr.reverse`))
        const registryInterface = new ethers.Interface(REGISTRY_ABI)
        const resolverInterface = new ethers.Interface(RESOLVER_ABI)
        const multicallContract = new ethers.Contract(
          ENS_MULTICALL_ADDRESS,
          MULTICALL_ABI,
          ENS_PROVIDER,
        )
        const BATCH_SIZE = 10
        const resolvers = []
        for (let batchStart = 0; batchStart < reverseNodes.length; batchStart += BATCH_SIZE) {
          const batchNodes = reverseNodes.slice(batchStart, batchStart + BATCH_SIZE)
          const resolverCalls = batchNodes.map((node) => ({
            target: ENS_REGISTRY,
            callData: registryInterface.encodeFunctionData('resolver', [node]),
          }))
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 5000)
          try {
            const { returnData: resolverReturnData } = await multicallContract.aggregate.staticCall(
              resolverCalls,
              { signal: controller.signal },
            )
            const batchResolvers = resolverReturnData.map((data) => {
              try {
                return ethers.AbiCoder.defaultAbiCoder().decode(['address'], data)[0]
              } catch {
                return ethers.ZeroAddress
              }
            })
            resolvers.push(...batchResolvers)
          } catch (err) {
            if (err.name === 'AbortError') logger.warn('ENS multicall timeout')
            else logger.error(`ENS resolver error: ${err.message}`)
          }
          clearTimeout(timeoutId)
        }
        const validIndices = resolvers
          .map((resolver, index) => (resolver !== ethers.ZeroAddress ? index : -1))
          .filter((index) => index !== -1)
        if (validIndices.length > 0) {
          const names = []
          for (let batchStart = 0; batchStart < validIndices.length; batchStart += BATCH_SIZE) {
            const batchIndices = validIndices.slice(batchStart, batchStart + BATCH_SIZE)
            const nameCalls = batchIndices.map((index) => ({
              target: resolvers[index],
              callData: resolverInterface.encodeFunctionData('name', [reverseNodes[index]]),
            }))
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 5000)
            try {
              const { returnData: nameReturnData } = await multicallContract.aggregate.staticCall(
                nameCalls,
                { signal: controller.signal },
              )
              const batchNames = nameReturnData.map((data) => {
                try {
                  return ethers.AbiCoder.defaultAbiCoder().decode(['string'], data)[0]
                } catch {
                  return ''
                }
              })
              names.push(...batchNames)
            } catch (err) {
              if (err.name === 'AbortError') logger.warn('ENS name timeout')
              else logger.error(`ENS name error: ${err.message}`)
            }
            clearTimeout(timeoutId)
          }
          const ensResults = {}
          for (let vIndex = 0; vIndex < validIndices.length; vIndex++) {
            const index = validIndices[vIndex]
            const originalAddr = addressesWithoutNametag[index]
            const addrLower = originalAddr.toLowerCase()
            const name = names[vIndex]
            if (name && name !== '') {
              let image = '/icons/default.webp'
              const shortName = name
                .split('.')[0]
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '')
              try {
                const cgResponse = await fetchWithRateLimit(
                  `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(shortName)}`,
                  {
                    headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY },
                    timeout: 3000,
                  },
                )
                const coin = cgResponse.data.coins?.[0]
                if (coin?.thumb) image = coin.thumb
              } catch (cgError) {
                logger.error(
                  `Failed to fetch CoinGecko image for ENS ${shortName}:`,
                  cgError.message,
                )
              }
              const ensNametag = { name, image, description: '', subcategory: 'ENS' }
              ensResults[addrLower] = { address: originalAddr, ...ensNametag }
              await redisClient.setEx(
                `nametag_${addrLower}`,
                30 * 24 * 60 * 60,
                JSON.stringify(ensResults[addrLower]),
              )
              await query(
                `INSERT INTO nametags (address, nametag, image, description, subcategory)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (address)
                 DO UPDATE SET
                 nametag = $2, image = $3, description = $4, subcategory = $5`,
                [addrLower, name, image, '', 'ENS'],
              )
              logger.info(`Saved ENS ${name} for address ${originalAddr} to database`)
            }
          }
          await redisClient.setEx(ensBatchKey, 30 * 24 * 60 * 60, JSON.stringify(ensResults))
          Object.entries(ensResults).forEach(([addrLower, data]) => {
            cachedNametags[addrLower] = data
          })
        }
      }
    } catch (ensError) {
      logger.error(
        `Failed to fetch ENS via multicall for batch: ${ensError.message} - Full error:`,
        ensError,
      )
    }
  }
  for (const addrLower of uniqueLowers) {
    if (!cachedNametags[addrLower]) {
      const originalAddr = lowerToOriginal.get(addrLower)
      cachedNametags[addrLower] = {
        address: originalAddr,
        name: 'Unknown',
        image: '/icons/default.webp',
        description: '',
        subcategory: 'Others',
      }
      await redisClient.setEx(
        `nametag_${addrLower}`,
        30 * 24 * 60 * 60,
        JSON.stringify(cachedNametags[addrLower]),
      )
    }
  }
  logger.info(
    `getNametagsBatch took ${(Date.now() - start) / 1000}s for ${uniqueLowers.length} addresses`,
  )
  return cachedNametags
}
async function getTokenImage(tokenAddress, chain) {
  if (!tokenAddress || !isAddress(tokenAddress)) return '/icons/default.webp'
  const redisClient = await getRedisClient()
  const cacheKey = `token_image_${chain}_${tokenAddress.toLowerCase()}`
  const cached = await redisClient.get(cacheKey)
  if (cached) return cached
  try {
    const result = await query(
      `SELECT image
       FROM tokens
       WHERE detail_platforms->'${chainIdToName[chain]}'->>'contract_address' = $1`,
      [tokenAddress.toLowerCase()],
    )
    if (result.rows.length > 0 && result.rows[0].image) {
      const image = result.rows[0].image
      await redisClient.setEx(cacheKey, 30 * 24 * 60 * 60, image)
      logger.info(`Token image for ${tokenAddress} on ${chain}: ${image} (source: database)`)
      return image
    }
    const cgResponse = await fetchWithRateLimit(
      `https://api.coingecko.com/api/v3/coins/${chainIdToName[chain]}/contract/${tokenAddress}`,
      {
        headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY },
        timeout: 8000,
      },
    )
    const image = cgResponse.data.image?.thumb || '/icons/default.webp'
    await redisClient.setEx(cacheKey, 30 * 24 * 60 * 60, image)
    logger.info(`Token image for ${tokenAddress} on ${chain}: ${image} (source: CoinGecko)`)
    return image
  } catch (error) {
    logger.error(`Failed to fetch token image for ${tokenAddress}:`, error.message)
    await redisClient.setEx(cacheKey, 30 * 24 * 60 * 60, '/icons/default.webp')
    return '/icons/default.webp'
  }
}
async function getTokenSymbolsBatch(baseUrl, contractAddresses) {
  const redisClient = await getRedisClient()
  const symbols = {}
  const uncachedContracts = []
  for (const contract of contractAddresses) {
    const cacheKey = `token_symbol_${contract.toLowerCase()}`
    const cached = await redisClient.get(cacheKey)
    if (cached) {
      symbols[contract.toLowerCase()] = cached
    } else {
      uncachedContracts.push(contract)
    }
  }
  if (uncachedContracts.length === 0) return symbols
  const batchPayloads = uncachedContracts.map((contract, index) => ({
    jsonrpc: '2.0',
    id: index,
    method: 'eth_call',
    params: [{ to: contract, data: '0x95d89b41' }, 'latest'],
  }))
  try {
    const abi = ['function symbol() view returns (string)']
    const iface = new ethers.Interface(abi)
    const response = await axios.post(baseUrl, batchPayloads)
    for (const [index, res] of Object.entries(response.data)) {
      if (res.result) {
        const symbol = iface.decodeFunctionResult('symbol', res.result)[0]
        const contract = uncachedContracts[index]
        symbols[contract.toLowerCase()] = symbol
        await redisClient.setEx(`token_symbol_${contract.toLowerCase()}`, 30 * 24 * 60 * 60, symbol)
      }
    }
  } catch (error) {
    logger.error(`Failed to batch fetch symbols:`, error.message)
    const symbolPromises = uncachedContracts.map(async (contract) => {
      try {
        const abi = ['function symbol() view returns (string)']
        const iface = new ethers.Interface(abi)
        const data = iface.encodeFunctionData('symbol', [])
        const payload = {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to: contract, data }, 'latest'],
        }
        const response = await axios.post(baseUrl, payload)
        if (response.data.result) {
          const symbol = iface.decodeFunctionResult('symbol', response.data.result)[0]
          symbols[contract.toLowerCase()] = symbol
          await redisClient.setEx(
            `token_symbol_${contract.toLowerCase()}`,
            30 * 24 * 60 * 60,
            symbol,
          )
        }
      } catch {
        symbols[contract.toLowerCase()] = 'ERC20'
      }
    })
    await Promise.all(symbolPromises)
  }
  return symbols
}
async function fetchLayer3Transactions(layer2Addresses, chain, limit, page) {
  const start = Date.now()
  const transactions = []
  const chainConfig = SUPPORTED_CHAINS[chain]
  if (!chainConfig.apiUrl && !alchemyNetworks[chain]) return transactions
  const safeAddresses = (layer2Addresses || [])
    .filter((addr) => typeof addr === 'string' && addr.trim().length > 0)
    .map((addr) => addr.toLowerCase().trim())
    .slice(0, 20)
  if (safeAddresses.length === 0) return transactions
  const layer2Nametags = await getNametagsBatch(safeAddresses)
  logger.info(
    `Fetching Layer 3 transactions for ${safeAddresses.length} Layer 2 addresses (including unknown nametags)`,
  )
  if (safeAddresses.length === 0) return transactions
  const layer3Limit = 10
  let nativePrice = await getCurrentPrice(chainConfig.coingeckoId || 'bitcoin')
  let baseUrl = null
  if (alchemyNetworks[chain]) {
    const network = alchemyNetworks[chain]
    baseUrl = `https://${network}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
  }
  const allRawTxs = []
  // Parallel fetch for all addresses
  const fetchPromises = safeAddresses.map(async (address) => {
    try {
      let txData = []
      if (chain === 'bitcoin') {
        const apiUrl = `${chainConfig.apiUrl}/address/${address}/txs?limit=${layer3Limit}`
        const cacheKey = `layer3_tx_${chain}_${address}_${page}_${layer3Limit}`
        const redisClient = await getRedisClient()
        const cached = await redisClient.get(cacheKey)
        if (cached) {
          logger.info(`Layer3 cache hit for ${cacheKey}`)
          txData = JSON.parse(cached)
        } else {
          const response = await fetchWithRateLimit(apiUrl, { timeout: 10000 })
          txData = response.data || []
          await redisClient.setEx(cacheKey, 3600, JSON.stringify(txData))
        }
        txData = txData.map((tx) => ({ ...tx, layer2Address: address }))
      } else if (alchemyNetworks[chain]) {
        const [resOut, resIn] = await Promise.all([
          axios
            .post(baseUrl, {
              jsonrpc: '2.0',
              id: 0,
              method: 'alchemy_getAssetTransfers',
              params: [
                {
                  fromBlock: '0x0',
                  toBlock: 'latest',
                  fromAddress: address,
                  excludeZeroValue: true,
                  maxCount: `0x${layer3Limit.toString(16)}`,
                  category: ['external', 'internal', 'erc20'],
                  withMetadata: true,
                  order: 'desc',
                },
              ],
            })
            .catch(() => ({ data: { result: { transfers: [] } } })),
          axios
            .post(baseUrl, {
              jsonrpc: '2.0',
              id: 1,
              method: 'alchemy_getAssetTransfers',
              params: [
                {
                  fromBlock: '0x0',
                  toBlock: 'latest',
                  toAddress: address,
                  excludeZeroValue: true,
                  maxCount: `0x${layer3Limit.toString(16)}`,
                  category: ['external', 'internal', 'erc20'],
                  withMetadata: true,
                  order: 'desc',
                },
              ],
            })
            .catch(() => ({ data: { result: { transfers: [] } } })),
        ])
        txData.push(
          ...(resOut.data.result.transfers || []).map((t) => ({
            ...t,
            type: 'outgoing',
            layer2Address: address,
          })),
        )
        txData.push(
          ...(resIn.data.result.transfers || []).map((t) => ({
            ...t,
            type: 'incoming',
            layer2Address: address,
          })),
        )
      }
      return txData
    } catch (error) {
      logger.error(`Failed to fetch Layer 3 for ${address}:`, error.message)
      return []
    }
  })
  const allTxData = await Promise.all(fetchPromises)
  allRawTxs.push(...allTxData.flat())
  // Pre-batch all unique contracts for symbols, prices, images
  const allContracts = [
    ...new Set(
      allRawTxs
        .filter((tx) => tx.rawContract?.address && isAddress(tx.rawContract.address))
        .map((tx) => tx.rawContract.address.toLowerCase()),
    ),
  ]
  let tokenSymbols = {}
  if (alchemyNetworks[chain] && allContracts.length > 0) {
    tokenSymbols = await getTokenSymbolsBatch(baseUrl, allContracts)
  }
  let tokenPricesBatch = {}
  if (allContracts.length > 0) {
    tokenPricesBatch = await getTokenCurrentPriceBatch(chainIdToName[chain], allContracts)
  }
  const tokenImagesBatch = Object.fromEntries(
    await Promise.all(
      allContracts.map(async (contract) => [contract, await getTokenImage(contract, chain)]),
    ),
  )
  const allLayer3Promises = allRawTxs.map(async (tx) => {
    if (chain === 'bitcoin') {
      if (!tx.status?.confirmed) return null
      const blockTime = tx.status.block_time
        ? new Date(tx.status.block_time * 1000).toISOString()
        : null
      if (!blockTime) return null
      let value = '0'
      let usdValue = 0
      // Incoming to layer2Address
      const receivedVouts =
        tx.vout?.filter((v) => v.scriptpubkey_address?.toLowerCase() === tx.layer2Address) || []
      for (const vout of receivedVouts) {
        if (vout.value > 546) {
          value = (vout.value / 1e8).toString()
          usdValue = Number(value) * nativePrice
          const source = tx.vin?.[0]?.prevout?.scriptpubkey_address || 'unknown'
          return {
            address: source,
            hash: tx.txid,
            value,
            usdValue: usdValue.toFixed(6),
            tokenSymbol: 'BTC',
            contractAddress: null,
            tokenImage: '/logos/bitcoin.webp',
            block_time: blockTime,
            type: 'incoming',
            layer2Address: tx.layer2Address,
          }
        }
      }
      // Outgoing from layer2Address
      const spentVins =
        tx.vin?.filter(
          (v) => v.prevout?.scriptpubkey_address?.toLowerCase() === tx.layer2Address,
        ) || []
      for (const vin of spentVins) {
        value = (vin.prevout.value / 1e8).toString()
        usdValue = Number(value) * nativePrice
        const target = tx.vout?.[0]?.scriptpubkey_address || 'unknown'
        return {
          address: target,
          hash: tx.txid,
          value,
          usdValue: usdValue.toFixed(6),
          tokenSymbol: 'BTC',
          contractAddress: null,
          tokenImage: '/logos/bitcoin.webp',
          block_time: blockTime,
          type: 'outgoing',
          layer2Address: tx.layer2Address,
        }
      }
      return null
    } else {
      let value,
        tokenSymbolLocal,
        contractAddressLocal,
        decimalsLocal = 18
      if (tx.category === 'erc20' || tx.category === 'erc721' || tx.category === 'erc1155') {
        decimalsLocal = tx.rawContract?.decimal ? parseInt(tx.rawContract.decimal, 16) : 18
        value = safeFormatUnits(tx.rawContract?.value, decimalsLocal)
        contractAddressLocal = tx.rawContract?.address?.toLowerCase()
        tokenSymbolLocal = tx.asset || tokenSymbols[contractAddressLocal] || 'UNKNOWN'
      } else {
        value = safeFormatEther(tx.value)
        tokenSymbolLocal = chain === '1' ? 'ETH' : chainConfig.name.toUpperCase()
        contractAddressLocal = null
      }
      if (parseFloat(value) === 0 && contractAddressLocal) return null
      let tokenImageLocal = contractAddressLocal
        ? tokenImagesBatch[contractAddressLocal] || '/icons/default.webp'
        : '/icons/default.webp'
      let usdValue = 0
      if (contractAddressLocal) {
        const price = tokenPricesBatch[contractAddressLocal]?.usd || 0
        usdValue = parseFloat(value) * price
      } else {
        usdValue = parseFloat(value) * nativePrice
      }
      const block_time = tx.metadata.blockTimestamp
      if (!block_time) return null
      const counterpart = tx.type === 'outgoing' ? tx.to?.toLowerCase() : tx.from?.toLowerCase()
      return {
        address: counterpart,
        hash: tx.hash,
        value,
        usdValue: usdValue.toFixed(6),
        tokenSymbol: tokenSymbolLocal,
        contractAddress: contractAddressLocal,
        tokenImage: tokenImageLocal,
        block_time,
        type: tx.type,
        layer2Address: tx.layer2Address,
      }
    }
  })
  const layer3Results = await Promise.allSettled(allLayer3Promises)
  transactions.push(
    ...layer3Results.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value),
  )
  // Nametags Layer 3
  const layer3Addrs = [
    ...new Set(transactions.map((tx) => tx.address?.toLowerCase()).filter(Boolean)),
  ]
  if (layer3Addrs.length > 0) {
    const l3Nametags = await getNametagsBatch(layer3Addrs)
    transactions.forEach((tx) => {
      const ntag = l3Nametags[tx.address?.toLowerCase()]
      if (ntag && ntag.name !== 'Unknown') {
        tx.nametag = ntag.name
        tx.image = ntag.image
      }
    })
  }
  logger.info(`fetchLayer3Transactions took ${(Date.now() - start) / 1000}s`)
  return transactions
}
async function fetchFromEtherscanFallback(address, chain, limit, page) {
  if (chain !== '1') return { incoming: [], outgoing: [] }
  const chainConfig = SUPPORTED_CHAINS[chain]
  if (!chainConfig.apiKey) return { incoming: [], outgoing: [] }
  const offset = limit
  const startblock = 0
  const endblock = 99999999
  const sort = 'desc'
  const endpoints = [
    { action: 'txlist', type: 'native' },
    { action: 'tokentx', type: 'token' },
    { action: 'txlistinternal', type: 'internal' },
  ]
  let nativeTxs = []
  let tokenTxs = []
  let internalTxs = []
  const redisClient = await getRedisClient()
  for (const { action, type } of endpoints) {
    const url = `${chainConfig.apiUrl}?module=account&action=${action}&address=${address}&startblock=${startblock}&endblock=${endblock}&page=${page}&offset=${offset}&sort=${sort}&apikey=${chainConfig.apiKey}`
    const cacheKey = `etherscan_fallback_${action}_${address}_${page}_${offset}`
    const cached = await redisClient.get(cacheKey)
    let data = []
    if (cached) {
      logger.info(`Etherscan fallback cache hit: ${cacheKey}`)
      data = JSON.parse(cached)
    } else {
      try {
        const response = await fetchWithRateLimit(url, { timeout: 15000 })
        if (response.data.status !== '1') {
          logger.warn(`Etherscan fallback ${action} status not 1: ${response.data.message}`)
          continue
        }
        data = response.data.result || []
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(data))
        logger.info(`Etherscan fallback fetched ${data.length} ${type} txs`)
      } catch (err) {
        logger.error(`Etherscan fallback ${action} error: ${err.message}`)
        continue
      }
    }
    if (type === 'native') nativeTxs = data
    if (type === 'token') tokenTxs = data
    if (type === 'internal') internalTxs = data
  }
  let incoming = []
  let outgoing = []
  let nativePrice = await getCurrentPrice(chainConfig.coingeckoId)
  const addresses = new Set()
  // Process native txs
  const nativeTxPromises = nativeTxs.map(async (tx) => {
    const value = safeFormatEther(tx.value)
    if (parseFloat(value) === 0) return null
    const blockTime = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString() : null
    if (!blockTime) return null
    const usdValue = Number(value) * nativePrice
    const type = tx.from.toLowerCase() === address ? 'outgoing' : 'incoming'
    const counterpart = type === 'outgoing' ? tx.to.toLowerCase() : tx.from.toLowerCase()
    return {
      address: counterpart,
      hash: tx.hash,
      value,
      usdValue: usdValue.toFixed(6),
      tokenSymbol: chain === '1' ? 'ETH' : chainConfig.name.toUpperCase(),
      contractAddress: null,
      tokenImage: '/icons/default.webp',
      block_time: blockTime,
      type,
    }
  })
  const nativeTxResults = await Promise.allSettled(nativeTxPromises)
  nativeTxResults.forEach((result) => {
    if (result.status === 'fulfilled' && result.value) {
      const tx = result.value
      if (tx.type === 'outgoing') {
        outgoing.push(tx)
      } else {
        incoming.push(tx)
      }
      addresses.add(tx.address)
    }
  })
  // Process token txs
  const uniqueContracts = [...new Set(tokenTxs.map((tx) => tx.contractAddress).filter(isAddress))]
  let tokenPrices = {}
  if (uniqueContracts.length > 0) {
    tokenPrices = await getTokenCurrentPriceBatch(chainIdToName[chain], uniqueContracts)
  }
  const imagePromises = uniqueContracts.map(async (contract) => ({
    contract: contract.toLowerCase(),
    image: await getTokenImage(contract, chain),
  }))
  const tokenImages = Object.fromEntries(
    (await Promise.all(imagePromises)).map((o) => [o.contract, o.image]),
  )
  const tokenTxPromises = tokenTxs.map(async (tx) => {
    if (
      !isAddress(tx.contractAddress) ||
      BLOCKED_TOKEN_ADDRESSES.includes(tx.contractAddress.toLowerCase()) ||
      !isValidTokenSymbol(tx.tokenSymbol)
    )
      return null
    const decimals = parseInt(tx.tokenDecimal || 18)
    const value = (parseInt(tx.value) / Math.pow(10, decimals)).toString()
    if (parseFloat(value) === 0) return null
    const blockTime = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString() : null
    if (!blockTime) return null
    const price =
      tokenPrices[tx.contractAddress.toLowerCase()]?.usd ||
      (await getTokenCurrentPrice(chainIdToName[chain], tx.contractAddress))
    const usdValue = Number(value) * price
    const type = tx.from.toLowerCase() === address ? 'outgoing' : 'incoming'
    const counterpart = type === 'outgoing' ? tx.to.toLowerCase() : tx.from.toLowerCase()
    const tokenImage = tokenImages[tx.contractAddress.toLowerCase()] || '/icons/default.webp'
    return {
      address: counterpart,
      hash: tx.hash,
      value,
      usdValue: usdValue.toFixed(6),
      tokenSymbol: tx.tokenSymbol || 'Unknown',
      contractAddress: tx.contractAddress,
      tokenImage,
      block_time: blockTime,
      type,
    }
  })
  const tokenTxResults = await Promise.allSettled(tokenTxPromises)
  tokenTxResults.forEach((result) => {
    if (result.status === 'fulfilled' && result.value) {
      const tx = result.value
      if (tx.type === 'outgoing') {
        outgoing.push(tx)
      } else {
        incoming.push(tx)
      }
      addresses.add(tx.address)
    }
  })
  // Process internal txs
  const internalTxPromises = internalTxs.map(async (itx) => {
    if (itx.type !== 'call' || BigInt(itx.value) === 0n) return null
    const value = safeFormatEther(itx.value)
    const blockTime = itx.timeStamp ? new Date(parseInt(itx.timeStamp) * 1000).toISOString() : null
    if (!blockTime) return null
    const usdValue = Number(value) * nativePrice
    const from = itx.from.toLowerCase()
    const to = itx.to.toLowerCase()
    const type = from === address ? 'outgoing' : 'incoming'
    const counterpart = type === 'outgoing' ? to : from
    return {
      address: counterpart,
      hash: itx.hash,
      value,
      usdValue: usdValue.toFixed(6),
      tokenSymbol: chain === '1' ? 'ETH' : chainConfig.name.toUpperCase(),
      contractAddress: null,
      tokenImage: '/icons/default.webp',
      block_time: blockTime,
      type,
    }
  })
  const internalTxResults = await Promise.allSettled(internalTxPromises)
  internalTxResults.forEach((result) => {
    if (result.status === 'fulfilled' && result.value) {
      const tx = result.value
      if (tx.type === 'outgoing') {
        outgoing.push(tx)
      } else {
        incoming.push(tx)
      }
      addresses.add(tx.address)
    }
  })
  return { incoming, outgoing }
}
async function hasConfidenceColumn() {
  try {
    const result = await query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'nametags' AND column_name = 'confidence'`,
    )
    return result.rows.length > 0
  } catch (err) {
    console.warn('Error checking confidence column:', err.message)
    return false
  }
}
async function saveAutoLabelsToDB(addressesWithLabels, chain) {
  const redisClient = await getRedisClient()
  const hasConf = await hasConfidenceColumn()
  const confParam = hasConf ? ', confidence' : ''
  const confValue = hasConf ? ', $6' : ''
  const confUpdate = hasConf ? ', confidence = $6' : ''
  const isCaseSensitive = ['bitcoin', 'solana', 'tron'].includes(chain)
  for (const [address, { label, confidence }] of Object.entries(addressesWithLabels)) {
    if (!label || label.trim() === '') {
      logger.info(
        `Skipping auto-label save for ${formatAddress(address, chain)}: label is null/empty`,
      )
      continue
    }
    const image = '/icons/default.webp'
    const description = `Auto-labeled by ML (conf: ${confidence})`
    const subcategory = 'ML Auto'
    const dbAddress = isCaseSensitive ? address : address.toLowerCase()
    const params = [dbAddress, label, image, description, subcategory]
    if (hasConf) params.push(parseFloat(confidence))
    const queryText = `INSERT INTO nametags (address, nametag, image, description, subcategory${confParam})
                       VALUES ($1, $2, $3, $4, $5${confValue})
                       ON CONFLICT (address)
                       DO UPDATE SET
                       nametag = $2, image = $3, description = $4, subcategory = $5${confUpdate}`
    try {
      await query(queryText, params)
      const ntagObj = { address: dbAddress, name: label, image, description, subcategory }
      if (hasConf) ntagObj.confidence = confidence
      const redisKey = `nametag_${isCaseSensitive ? address : address.toLowerCase()}`
      await redisClient.setEx(redisKey, 30 * 24 * 60 * 60, JSON.stringify(ntagObj))
      logger.info(
        `Auto-saved label for ${formatAddress(address, chain)}: ${label} (conf: ${confidence})`,
      )
    } catch (dbErr) {
      logger.error(`Failed to save auto-label for ${formatAddress(address, chain)}:`, dbErr.message)
    }
  }
}
export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '::1'
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  try {
    await checkIPBan(ip)
    await checkRateLimit(ip)
    if (!(await isAllowedOrigin(origin, referer, ip))) {
      await trackViolation(ip, 'Invalid origin')
      return NextResponse.json(
        { error: 'Invalid origin.' },
        { status: 403, headers: securityHeaders },
      )
    }
    const body = await request.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      let errorMsg = 'Invalid request body'
      if (
        parsed.error?.errors &&
        Array.isArray(parsed.error.errors) &&
        parsed.error.errors.length > 0
      ) {
        errorMsg = parsed.error.errors[0].message
      } else if (
        parsed.error?.issues &&
        Array.isArray(parsed.error.issues) &&
        parsed.error.issues.length > 0
      ) {
        errorMsg = parsed.error.issues[0].message
      }

      await trackViolation(ip, `Invalid request body: ${errorMsg}`)
      return NextResponse.json({ error: errorMsg }, { status: 400, headers: securityHeaders })
    }
    const {
      wallet_address,
      chain,
      limit,
      page,
      fetchLayer3: inputFetchLayer3,
      isToken = false,
    } = parsed.data
    const caseSensitive = ['bitcoin', 'solana', 'tron'].includes(chain)
    const address = caseSensitive ? wallet_address.trim() : wallet_address.toLowerCase().trim()
    const isPremium = request.headers.get('x-premium-user') === 'true'
    if (!isPremium && limit > 200) {
      await trackViolation(ip, 'Non-premium user attempted to fetch more than 200 transactions')
      return NextResponse.json(
        { error: 'Premium account required to fetch more than 200 transactions.' },
        { status: 403, headers: securityHeaders },
      )
    }
    const isBitcoin = chain === 'bitcoin'
    if (isBitcoin && !isValidBitcoinAddress(address)) {
      await trackViolation(ip, 'Invalid Bitcoin address (format or checksum)')
      return NextResponse.json(
        { error: 'Invalid Bitcoin address.' },
        { status: 400, headers: securityHeaders },
      )
    }
    const chainConfig = SUPPORTED_CHAINS[chain]
    const redisClient = await getRedisClient()
    const cacheKey = `tx_${chain}_${address}_${page}_${limit}`
    const cached = await redisClient.get(cacheKey)
    if (cached) {
      logger.info(`Cache hit for ${cacheKey}`)
      return NextResponse.json(JSON.parse(cached), { headers: securityHeaders })
    }
    let isTokenQuery = isToken
    let fetchLayer3 = inputFetchLayer3
    let tokenSymbol = 'UNKNOWN'
    let tokenImage = '/icons/default.webp'
    if (alchemyNetworks[chain] && !isTokenQuery) {
      const network = alchemyNetworks[chain]
      const baseUrl = `https://${network}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
      try {
        const codeRes = await axios.post(
          baseUrl,
          {
            jsonrpc: '2.0',
            id: 0,
            method: 'eth_getCode',
            params: [address, 'latest'],
          },
          { timeout: 8000 },
        )
        const code = codeRes.data.result || '0x'
        if (code !== '0x') {
          const symbolRes = await axios.post(
            baseUrl,
            {
              jsonrpc: '2.0',
              id: 1,
              method: 'eth_call',
              params: [{ to: address, data: '0x95d89b41' }, 'latest'],
            },
            { timeout: 8000 },
          )
          const result = symbolRes.data.result || '0x'
          if (result !== '0x' && result.length > 10) {
            isTokenQuery = true
            fetchLayer3 = true
            try {
              const iface = new ethers.Interface(['function symbol() view returns (string)'])
              tokenSymbol = iface.decodeFunctionResult('symbol', result)[0].trim() || 'UNKNOWN'
              tokenImage = await getTokenImage(address, chain)
            } catch {}
            tokenImage = await getTokenImage(address, chain)
            logger.info(`Auto detected token contract: ${address} (${tokenSymbol})`)
          } else {
            logger.info(`Contract but not ERC20 token: ${address}`)
          }
        }
      } catch (err) {
        logger.warn(`Auto detect failed for ${address}: ${err.message}`)
      }
    }
    let incoming = []
    let outgoing = []
    let nativePrice = await getCurrentPrice(chainConfig.coingeckoId)
    let tokenPrices = {}
    const addresses = new Set()
    addresses.add(address)
    let layer3Transactions = []
    let walletNametag
    let chainLogo = await getChainLogo(chainConfig.coingeckoId)
    const walletLimit = Math.min(1000, limit)
    if (isTokenQuery) {
      const network = alchemyNetworks[chain]
      const baseUrl = `https://${network}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
      const symbols = await getTokenSymbolsBatch(baseUrl, [address])
      tokenSymbol = symbols[caseSensitive ? address : address.toLowerCase()] || 'UNKNOWN'
      tokenImage = await getTokenImage(address, chain)
      logger.info(`Token query: ${address} - Symbol: ${tokenSymbol}, Image: ${tokenImage}`)
      const resToken = await axios.post(baseUrl, {
        jsonrpc: '2.0',
        id: 0,
        method: 'alchemy_getAssetTransfers',
        params: [
          {
            fromBlock: '0x0',
            toBlock: 'latest',
            contractAddresses: [address],
            excludeZeroValue: true,
            maxCount: `0x${limit.toString(16)}`,
            category: ['erc20'],
            withMetadata: true,
            order: 'desc',
          },
        ],
      })
      if (resToken.data.error) throw new Error(resToken.data.error.message)
      let transfers = resToken.data.result.transfers || []
      const newPageKey = resToken.data.result.pageKey
      if (newPageKey && page === 1) {
        await redisClient.setEx(`pagekey_token_latest_${chain}_${address}`, 3600, newPageKey)
      }
      let continuationPageKey = null
      if (page > 1) {
        continuationPageKey = await redisClient.get(`pagekey_token_latest_${chain}_${address}`)
        if (continuationPageKey) {
          const resContinue = await axios.post(baseUrl, {
            jsonrpc: '2.0',
            id: 0,
            method: 'alchemy_getAssetTransfers',
            params: [
              {
                fromBlock: '0x0',
                toBlock: 'latest',
                contractAddresses: [address],
                excludeZeroValue: true,
                maxCount: `0x${limit.toString(16)}`,
                category: ['erc20'],
                withMetadata: true,
                order: 'desc',
                pageKey: continuationPageKey,
              },
            ],
          })
          transfers = resContinue.data.result.transfers || []
          if (resContinue.data.result.pageKey) {
            await redisClient.setEx(
              `pagekey_token_latest_${chain}_${address}`,
              3600,
              resContinue.data.result.pageKey,
            )
          } else {
            await redisClient.del(`pagekey_token_latest_${chain}_${address}`)
          }
        }
      }
      const tokenPrice = await getTokenCurrentPrice(chainIdToName[chain], address)
      const tokenTransfers = []
      for (const transfer of transfers) {
        const decimals = transfer.rawContract?.decimal
          ? parseInt(transfer.rawContract.decimal, 16)
          : 18
        let value = safeFormatUnits(transfer.rawContract?.value, decimals)
        if (parseFloat(value) === 0) continue
        const block_time = transfer.metadata.blockTimestamp
        const usdValue = parseFloat(value) * tokenPrice
        const tx = {
          from: caseSensitive ? transfer.from : transfer.from.toLowerCase(),
          to: caseSensitive ? transfer.to : transfer.to.toLowerCase(),
          address: caseSensitive ? transfer.to : transfer.to.toLowerCase(),
          hash: transfer.hash,
          value,
          usdValue: usdValue.toFixed(6),
          tokenSymbol: transfer.asset || tokenSymbol,
          contractAddress: address,
          tokenImage,
          block_time,
          method: 'Transfer',
          type: 'outgoing',
          layer2Address: caseSensitive ? transfer.from : transfer.from.toLowerCase(),
          source: caseSensitive ? transfer.from : transfer.from.toLowerCase(),
          target: caseSensitive ? transfer.to : transfer.to.toLowerCase(),
        }
        tokenTransfers.push(tx)
        addresses.add(caseSensitive ? transfer.from : transfer.from.toLowerCase())
        addresses.add(caseSensitive ? transfer.to : transfer.to.toLowerCase())
      }
      addresses.add(address)
      const nametags = await getNametagsBatch([...addresses])
      const dummyLayer2 = []
      const processedDummyLayer2 = dummyLayer2.map((tx) => ({
        ...tx,
        nametag: nametags[caseSensitive ? tx.to : tx.to.toLowerCase()]?.name || 'Unknown',
        image:
          nametags[caseSensitive ? tx.to : tx.to.toLowerCase()]?.image || '/icons/default.webp',
        chainLogo,
      }))
      layer3Transactions = tokenTransfers.map((tx) => ({
        ...tx,
        nametag: nametags[caseSensitive ? tx.to : tx.to.toLowerCase()]?.name || 'Unknown',
        image:
          nametags[caseSensitive ? tx.to : tx.to.toLowerCase()]?.image || '/icons/default.webp',
        nametagLayer2: nametags[caseSensitive ? tx.from : tx.from.toLowerCase()]?.name || 'Unknown',
        imageLayer2:
          nametags[caseSensitive ? tx.from : tx.from.toLowerCase()]?.image || '/icons/default.webp',
        chainLogo,
      }))
      walletNametag = {
        name: `${tokenSymbol} Token`,
        image: tokenImage,
        description: 'ERC20 Token Contract',
        subcategory: 'Token',
      }
      const result = {
        incoming: [],
        outgoing: processedDummyLayer2,
        layer3: layer3Transactions,
        wallet: {
          address,
          nametag: walletNametag.name,
          image: walletNametag.image,
          chainLogo,
        },
      }
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(result))
      return NextResponse.json(result, { headers: securityHeaders })
    } else {
      let incoming = []
      let outgoing = []
      let nativePrice = await getCurrentPrice(chainConfig.coingeckoId)
      let tokenPrices = {}
      const addresses = new Set()
      addresses.add(address)
      let layer3Transactions = []
      let walletNametag
      let chainLogo = await getChainLogo(chainConfig.coingeckoId)
      const walletLimit = Math.min(1000, limit)
      let alchemySuccess = false
      if (alchemyNetworks[chain]) {
        const network = alchemyNetworks[chain]
        const baseUrl = `https://${network}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
        let outPageKey = null
        if (page > 1) {
          outPageKey = await redisClient.get(`pagekey_out_${chain}_${address}_${page - 1}`)
        }
        let inPageKey = null
        if (page > 1) {
          inPageKey = await redisClient.get(`pagekey_in_${chain}_${address}_${page - 1}`)
        }
        const [resOut, resIn] = await Promise.all([
          axios.post(baseUrl, {
            jsonrpc: '2.0',
            id: 0,
            method: 'alchemy_getAssetTransfers',
            params: [
              {
                fromBlock: '0x0',
                toBlock: 'latest',
                fromAddress: address,
                excludeZeroValue: true,
                maxCount: `0x${walletLimit.toString(16)}`,
                category: ['external', 'internal', 'erc20'],
                withMetadata: true,
                order: 'desc',
                ...(outPageKey ? { pageKey: outPageKey } : {}),
              },
            ],
          }),
          axios.post(baseUrl, {
            jsonrpc: '2.0',
            id: 1,
            method: 'alchemy_getAssetTransfers',
            params: [
              {
                fromBlock: '0x0',
                toBlock: 'latest',
                toAddress: address,
                excludeZeroValue: true,
                maxCount: `0x${walletLimit.toString(16)}`,
                category: ['external', 'internal', 'erc20'],
                withMetadata: true,
                order: 'desc',
                ...(inPageKey ? { pageKey: inPageKey } : {}),
              },
            ],
          }),
        ])
        if (resOut.data.error) throw new Error(resOut.data.error.message)
        if (resIn.data.error) throw new Error(resIn.data.error.message)
        const transfersOut = resOut.data.result.transfers || []
        const newPageKeyOut = resOut.data.result.pageKey
        if (newPageKeyOut)
          await redisClient.setEx(`pagekey_out_${chain}_${address}_${page}`, 3600, newPageKeyOut)
        const transfersIn = resIn.data.result.transfers || []
        const newPageKeyIn = resIn.data.result.pageKey
        if (newPageKeyIn)
          await redisClient.setEx(`pagekey_in_${chain}_${address}_${page}`, 3600, newPageKeyIn)
        const allTransfers = [...transfersOut, ...transfersIn]
        const uniqueContracts = [
          ...new Set(
            allTransfers
              .filter((t) => t.rawContract?.address)
              .map((t) => t.rawContract.address)
              .filter(isAddress),
          ),
        ]
        const symbolsNeedingFetch = uniqueContracts.filter(
          (c) => !allTransfers.some((t) => t.asset),
        )
        let tokenSymbols = {}
        if (symbolsNeedingFetch.length > 0) {
          tokenSymbols = await getTokenSymbolsBatch(baseUrl, symbolsNeedingFetch)
        }
        let tokenPricesBatch = {}
        if (uniqueContracts.length > 0) {
          tokenPricesBatch = await getTokenCurrentPriceBatch(chainIdToName[chain], uniqueContracts)
        }
        const imagePromises = uniqueContracts.map(async (contract) => {
          const image = await getTokenImage(contract, chain)
          return { contract: caseSensitive ? contract : contract.toLowerCase(), image }
        })
        const tokenImages = Object.fromEntries(
          (await Promise.all(imagePromises)).map(({ contract, image }) => [contract, image]),
        )
        // Process outgoing
        const missingPricesOut = new Set()
        for (const transfer of transfersOut) {
          let value,
            tokenSymbolLocal,
            contractAddressLocal,
            decimalsLocal = 18
          if (
            transfer.category === 'erc20' ||
            transfer.category === 'erc721' ||
            transfer.category === 'erc1155'
          ) {
            decimalsLocal = transfer.rawContract?.decimal
              ? parseInt(transfer.rawContract.decimal, 16)
              : 18
            value = safeFormatUnits(transfer.rawContract?.value, decimalsLocal)
            tokenSymbolLocal =
              transfer.asset ||
              tokenSymbols[
                caseSensitive
                  ? transfer.rawContract?.address
                  : transfer.rawContract?.address?.toLowerCase()
              ] ||
              'UNKNOWN'
            contractAddressLocal = transfer.rawContract?.address
          } else {
            value = safeFormatEther(transfer.value)
            tokenSymbolLocal = chain === '1' ? 'ETH' : chainConfig.name.toUpperCase()
            contractAddressLocal = null
          }
          if (parseFloat(value) === 0 && contractAddressLocal) continue
          let tokenImageLocal = contractAddressLocal
            ? tokenImages[
                caseSensitive ? contractAddressLocal : contractAddressLocal.toLowerCase()
              ] || '/icons/default.webp'
            : '/icons/default.webp'
          let usdValue = 0
          if (contractAddressLocal) {
            const priceKey = caseSensitive
              ? contractAddressLocal
              : contractAddressLocal.toLowerCase()
            let price = tokenPricesBatch[priceKey]?.usd
            if (!price) {
              missingPricesOut.add(contractAddressLocal)
            } else {
              usdValue = parseFloat(value) * price
            }
          } else {
            usdValue = parseFloat(value) * nativePrice
          }
          const block_time = transfer.metadata.blockTimestamp
          outgoing.push({
            address: caseSensitive ? transfer.to : transfer.to.toLowerCase(),
            hash: transfer.hash,
            value,
            usdValue: usdValue.toFixed(6),
            tokenSymbol: tokenSymbolLocal,
            contractAddress: contractAddressLocal,
            tokenImage: tokenImageLocal,
            block_time,
            type: 'outgoing',
            method: transfer.category === 'erc20' ? 'Transfer' : undefined,
          })
          addresses.add(caseSensitive ? transfer.to : transfer.to.toLowerCase())
        }
        // Fetch missing prices in batch
        if (missingPricesOut.size > 0) {
          const missingPricesBatch = await getTokenCurrentPriceBatch(
            chainIdToName[chain],
            Array.from(missingPricesOut),
          )
          // Update usdValue for outgoing with missing prices
          outgoing = outgoing.map((tx) => {
            if (tx.contractAddress) {
              const priceKey = caseSensitive ? tx.contractAddress : tx.contractAddress.toLowerCase()
              const price = missingPricesBatch[priceKey]?.usd || 0
              if (price > 0) {
                tx.usdValue = (parseFloat(tx.value) * price).toFixed(6)
              }
            }
            return tx
          })
        }
        // Process incoming
        const missingPricesIn = new Set()
        for (const transfer of transfersIn) {
          let value,
            tokenSymbolLocal,
            contractAddressLocal,
            decimalsLocal = 18
          if (
            transfer.category === 'erc20' ||
            transfer.category === 'erc721' ||
            transfer.category === 'erc1155'
          ) {
            decimalsLocal = transfer.rawContract?.decimal
              ? parseInt(transfer.rawContract.decimal, 16)
              : 18
            value = safeFormatUnits(transfer.rawContract?.value, decimalsLocal)
            tokenSymbolLocal =
              transfer.asset ||
              tokenSymbols[
                caseSensitive
                  ? transfer.rawContract?.address
                  : transfer.rawContract?.address?.toLowerCase()
              ] ||
              'UNKNOWN'
            contractAddressLocal = transfer.rawContract?.address
          } else {
            value = safeFormatEther(transfer.value)
            tokenSymbolLocal = chain === '1' ? 'ETH' : chainConfig.name.toUpperCase()
            contractAddressLocal = null
          }
          if (parseFloat(value) === 0 && contractAddressLocal) continue
          let tokenImageLocal = contractAddressLocal
            ? tokenImages[
                caseSensitive ? contractAddressLocal : contractAddressLocal.toLowerCase()
              ] || '/icons/default.webp'
            : '/icons/default.webp'
          let usdValue = 0
          if (contractAddressLocal) {
            const priceKey = caseSensitive
              ? contractAddressLocal
              : contractAddressLocal.toLowerCase()
            let price = tokenPricesBatch[priceKey]?.usd
            if (!price) {
              missingPricesIn.add(contractAddressLocal)
            } else {
              usdValue = parseFloat(value) * price
            }
          } else {
            usdValue = parseFloat(value) * nativePrice
          }
          const block_time = transfer.metadata.blockTimestamp
          incoming.push({
            address: caseSensitive ? transfer.from : transfer.from.toLowerCase(),
            hash: transfer.hash,
            value,
            usdValue: usdValue.toFixed(6),
            tokenSymbol: tokenSymbolLocal,
            contractAddress: contractAddressLocal,
            tokenImage: tokenImageLocal,
            block_time,
            type: 'incoming',
            method: transfer.category === 'erc20' ? 'Transfer' : undefined,
          })
          addresses.add(caseSensitive ? transfer.from : transfer.from.toLowerCase())
        }
        // Fetch missing prices in batch
        if (missingPricesIn.size > 0) {
          const missingPricesBatch = await getTokenCurrentPriceBatch(
            chainIdToName[chain],
            Array.from(missingPricesIn),
          )
          // Update usdValue for incoming with missing prices
          incoming = incoming.map((tx) => {
            if (tx.contractAddress) {
              const priceKey = caseSensitive ? tx.contractAddress : tx.contractAddress.toLowerCase()
              const price = missingPricesBatch[priceKey]?.usd || 0
              if (price > 0) {
                tx.usdValue = (parseFloat(tx.value) * price).toFixed(6)
              }
            }
            return tx
          })
        }
      } else {
        // Original fetching logic for non-Alchemy chains
        const fetchPromises = []
        let apiUrl
        let internalData = []
        const walletLimitNonAlchemy = Math.min(50, limit)
        if (chain === 'solana') {
          apiUrl = `${chainConfig.apiUrl}/account/transactions?account=${address}&limit=${walletLimitNonAlchemy}&offset=${(page - 1) * walletLimitNonAlchemy}`
          fetchPromises.push(
            fetchWithRateLimit(apiUrl, { timeout: 10000 }).then((res) => ({
              type: 'native',
              data: res.data.transactions || [],
            })),
          )
        } else if (chain === 'tron') {
          apiUrl = `${chainConfig.apiUrl}/transaction?address=${address}&limit=${walletLimitNonAlchemy}&start=${(page - 1) * walletLimitNonAlchemy}`
          fetchPromises.push(
            fetchWithRateLimit(apiUrl, { timeout: 10000 }).then((res) => ({
              type: 'native',
              data: res.data.transactions || [],
            })),
          )
        } else if (chain === 'bitcoin') {
          addresses.add(address)
          let allTxs = []
          let afterTxid = null
          const targetLimit = Math.min(200, limit)
          do {
            let apiUrl = `${chainConfig.apiUrl}/address/${address}/txs`
            if (afterTxid) apiUrl += `?after_txid=${afterTxid}`
            const cacheKeyPage = `bitcoin_txs_${address}_${afterTxid || 'initial'}`
            const cachedPage = await redisClient.get(cacheKeyPage)
            let pageTxs = []
            if (cachedPage) {
              logger.info(`Bitcoin page cache hit: ${cacheKeyPage}`)
              pageTxs = JSON.parse(cachedPage)
            } else {
              try {
                const response = await fetchWithRateLimit(apiUrl, {
                  timeout: 15000,
                  headers: { 'User-Agent': 'xynapse-bot/1.0' },
                })
                if (!Array.isArray(response.data)) {
                  logger.warn(`Invalid Bitcoin response for ${address}:`, response.data)
                  break
                }
                pageTxs = response.data
                await redisClient.setEx(cacheKeyPage, 3600, JSON.stringify(pageTxs))
                logger.info(
                  `Fetched ${pageTxs.length} Bitcoin txs (after_txid: ${afterTxid || 'none'})`,
                )
              } catch (err) {
                logger.error(`Bitcoin fetch error for url ${apiUrl}: ${err.message}`)
                if (err.response?.status === 400) {
                }
                break
              }
            }
            if (pageTxs.length === 0) break
            allTxs.push(...pageTxs)
            afterTxid = pageTxs[pageTxs.length - 1]?.txid
          } while (allTxs.length < targetLimit && afterTxid)
          logger.info(`Total Bitcoin transactions fetched: ${allTxs.length}`)
          const bitcoinTxPromises = allTxs.map(async (tx) => {
            if (!tx.status?.confirmed) return null
            const blockTime = tx.status.block_time
              ? new Date(tx.status.block_time * 1000).toISOString()
              : null
            if (!blockTime) return null
            let tokenSymbol = 'BTC'
            let tokenImage = '/icons/default.webp'
            let nativePriceUsed = nativePrice || 0
            if (tx.vout && Array.isArray(tx.vout)) {
              for (const vout of tx.vout) {
                if (
                  vout.scriptpubkey_address &&
                  (caseSensitive
                    ? vout.scriptpubkey_address === address
                    : vout.scriptpubkey_address.toLowerCase() === address) &&
                  vout.value > 546
                ) {
                  const value = (vout.value / 1e8).toString()
                  const usdValue = Number(value) * nativePriceUsed
                  const sourceAddr =
                    tx.vin && tx.vin[0] && tx.vin[0].prevout?.scriptpubkey_address
                      ? tx.vin[0].prevout.scriptpubkey_address
                      : 'coinbase_or_unknown'
                  addresses.add(caseSensitive ? sourceAddr : sourceAddr.toLowerCase())
                  return {
                    address: sourceAddr,
                    hash: tx.txid,
                    value,
                    usdValue: usdValue.toFixed(6),
                    tokenSymbol,
                    contractAddress: null,
                    tokenImage,
                    block_time: blockTime,
                    type: 'incoming',
                  }
                }
              }
            }
            if (tx.vin && Array.isArray(tx.vin)) {
              for (const vin of tx.vin) {
                if (
                  vin.prevout &&
                  vin.prevout.scriptpubkey_address &&
                  (caseSensitive
                    ? vin.prevout.scriptpubkey_address === address
                    : vin.prevout.scriptpubkey_address.toLowerCase() === address)
                ) {
                  const value = (vin.prevout.value / 1e8).toString()
                  const usdValue = Number(value) * nativePriceUsed
                  let targetAddr = 'unknown'
                  if (tx.vout && tx.vout.length > 0) {
                    const firstVout = tx.vout.find((v) => v.scriptpubkey_address) || tx.vout[0]
                    targetAddr = firstVout?.scriptpubkey_address || 'unknown'
                  }
                  addresses.add(caseSensitive ? targetAddr : targetAddr.toLowerCase())
                  return {
                    address: targetAddr,
                    hash: tx.txid,
                    value,
                    usdValue: usdValue.toFixed(6),
                    tokenSymbol,
                    contractAddress: null,
                    tokenImage,
                    block_time: blockTime,
                    type: 'outgoing',
                  }
                }
              }
            }
            return null
          })
          const bitcoinTxResults = await Promise.allSettled(bitcoinTxPromises)
          bitcoinTxResults.forEach((result) => {
            if (result.status === 'fulfilled' && result.value) {
              const tx = result.value
              if (tx.type === 'outgoing') {
                outgoing.push(tx)
                addresses.add(caseSensitive ? tx.address : tx.address.toLowerCase())
              } else {
                incoming.push(tx)
                addresses.add(caseSensitive ? tx.address : tx.address.toLowerCase())
              }
            }
          })
        } else {
          // Other non-Alchemy chains (solana, tron, etherscan-based)
          const fetchPromises = []
          let apiUrl
          let internalData = []
          const walletLimitNonAlchemy = Math.min(50, limit)
          if (chain === 'solana') {
            apiUrl = `${chainConfig.apiUrl}/account/transactions?account=${address}&limit=${walletLimitNonAlchemy}&offset=${(page - 1) * walletLimitNonAlchemy}`
            fetchPromises.push(
              fetchWithRateLimit(apiUrl, { timeout: 10000 }).then((res) => ({
                type: 'native',
                data: res.data.transactions || [],
              })),
            )
          } else if (chain === 'tron') {
            apiUrl = `${chainConfig.apiUrl}/transaction?address=${address}&limit=${walletLimitNonAlchemy}&start=${(page - 1) * walletLimitNonAlchemy}`
            fetchPromises.push(
              fetchWithRateLimit(apiUrl, { timeout: 10000 }).then((res) => ({
                type: 'native',
                data: res.data.transactions || [],
              })),
            )
          } else {
            const endpoints = [
              { action: 'txlist', type: 'native' },
              { action: 'tokentx', type: 'token' },
              { action: 'txlistinternal', type: 'internal' },
            ]
            endpoints.forEach(({ action, type }) => {
              fetchPromises.push(
                (async () => {
                  const cacheKey = `api_${chain}_${address}_${action}_${page}_${walletLimitNonAlchemy}`
                  const cached = await redisClient.get(cacheKey)
                  if (cached) {
                    logger.info(`API cache hit for ${cacheKey}`)
                    return { type, data: JSON.parse(cached) }
                  }
                  const url = `${chainConfig.apiUrl}?module=account&action=${action}&address=${address}&startblock=0&endblock=99999999&page=${page}&offset=${walletLimitNonAlchemy}&sort=desc&chainid=${chain}&apikey=${chainConfig.apiKey}`
                  const response = await fetchWithRateLimit(url, { timeout: 10000 })
                  const data = response.data.result || []
                  await redisClient.setEx(cacheKey, 3600, JSON.stringify(data))
                  return { type, data }
                })(),
              )
            })
          }
          const responses = await Promise.allSettled(fetchPromises)
          let transactions = []
          let tokenTransactions = []
          responses.forEach((result) => {
            if (result.status === 'fulfilled') {
              if (result.value.type === 'native') transactions = result.value.data
              if (result.value.type === 'token') tokenTransactions = result.value.data
              if (result.value.type === 'internal') internalData = result.value.data
            }
          })
          if (!Array.isArray(transactions)) transactions = []
          if (!Array.isArray(tokenTransactions)) tokenTransactions = []
          if (!Array.isArray(internalData)) internalData = []
          if (chain !== 'solana' && chain !== 'tron') {
            const uniqueContracts = [
              ...new Set(tokenTransactions.map((tx) => tx.contractAddress).filter(isAddress)),
            ]
            if (uniqueContracts.length > 0) {
              const platform = chainIdToName[chain]
              const contractList = uniqueContracts.join(',')
              const cacheKey = `token_prices_${platform}_${contractList}_${page}_${walletLimitNonAlchemy}`
              const cached = await redisClient.get(cacheKey)
              if (cached) {
                tokenPrices = JSON.parse(cached)
                logger.info(`Token prices cache hit for ${cacheKey}`)
              } else {
                try {
                  const response = await fetchWithRateLimit(
                    `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${contractList}&vs_currencies=usd`,
                    { headers: { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } },
                  )
                  tokenPrices = response.data || {}
                  await redisClient.setEx(cacheKey, 300, JSON.stringify(tokenPrices))
                  logger.info(
                    `Batch fetched and cached prices for ${uniqueContracts.length} tokens`,
                  )
                } catch (e) {
                  logger.error('Batch token price fetch failed:', e.message)
                }
              }
            }
          }
          const nativeTxPromises = transactions.map(async (tx) => {
            let value = '0'
            let tokenSymbol =
              chainConfig.name === 'ethereum' ? 'ETH' : chainConfig.name.toUpperCase()
            let contractAddress = null
            let tokenImage = '/icons/default.webp'
            let blockTime
            let usdValue = 0
            if (chain === 'solana') {
              value = (tx.lamports / 1e9).toString()
              tokenSymbol = 'SOL'
              blockTime = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null
            } else if (chain === 'tron') {
              value = (tx.amount / 1e6).toString()
              tokenSymbol = 'TRX'
              blockTime = tx.timestamp ? new Date(tx.timestamp).toISOString() : null
            } else {
              value = safeFormatEther(tx.value)
              blockTime = tx.timeStamp
                ? new Date(parseInt(tx.timeStamp) * 1000).toISOString()
                : null
            }
            if (!blockTime) {
              logger.warn(
                `Missing or invalid block_time for tx ${tx.hash || tx.transactionHash} from address ${address}`,
              )
              return null
            }
            if (parseFloat(value) === 0) return null
            usdValue = Number(value) * nativePrice
            return {
              address: caseSensitive
                ? tx.from === address
                  ? tx.to
                  : tx.from
                : tx.from === address
                  ? tx.to
                  : tx.from,
              hash: tx.hash || tx.transactionHash,
              value,
              usdValue: usdValue.toFixed(6),
              tokenSymbol,
              contractAddress,
              tokenImage,
              block_time: blockTime,
              type: tx.from === address ? 'outgoing' : 'incoming',
            }
          })
          const nativeTxResults = await Promise.allSettled(nativeTxPromises)
          nativeTxResults.forEach((result) => {
            if (result.status === 'fulfilled' && result.value) {
              const tx = result.value
              if (tx.type === 'outgoing') {
                outgoing.push(tx)
                addresses.add(caseSensitive ? tx.address : tx.address.toLowerCase())
              } else {
                incoming.push(tx)
                addresses.add(caseSensitive ? tx.address : tx.address.toLowerCase())
              }
            }
          })
          if (chain !== 'solana' && chain !== 'tron' && internalData.length > 0) {
            const internalNativeTxPromises = internalData.map(async (itx) => {
              if (itx.type !== 'call' || BigInt(itx.value) === 0n) return null
              let value = safeFormatEther(itx.value)
              let tokenSymbol =
                chainConfig.name === 'ethereum' ? 'ETH' : chainConfig.name.toUpperCase()
              let contractAddress = null
              let tokenImage = '/icons/default.webp'
              let blockTime = itx.timeStamp
                ? new Date(parseInt(itx.timeStamp) * 1000).toISOString()
                : null
              let usdValue = Number(value) * nativePrice
              if (!blockTime) {
                logger.warn(
                  `Missing or invalid block_time for internal tx ${itx.hash} from address ${address}`,
                )
                return null
              }
              const from = caseSensitive ? itx.from : itx.from.toLowerCase()
              const to = caseSensitive ? itx.to : itx.to.toLowerCase()
              const type = from === address ? 'outgoing' : 'incoming'
              const counterpart = type === 'outgoing' ? to : from
              return {
                address: counterpart,
                hash: itx.hash,
                value,
                usdValue: usdValue.toFixed(6),
                tokenSymbol,
                contractAddress,
                tokenImage,
                block_time: blockTime,
                type,
              }
            })
            const internalTxResults = await Promise.allSettled(internalNativeTxPromises)
            internalTxResults.forEach((result) => {
              if (result.status === 'fulfilled' && result.value) {
                const tx = result.value
                if (tx.type === 'outgoing') {
                  outgoing.push(tx)
                  addresses.add(caseSensitive ? tx.address : tx.address.toLowerCase())
                } else {
                  incoming.push(tx)
                  addresses.add(caseSensitive ? tx.address : tx.address.toLowerCase())
                }
              }
            })
          }
          const tokenPromises = tokenTransactions.map(async (tx) => {
            if (
              !isAddress(tx.contractAddress) ||
              BLOCKED_TOKEN_ADDRESSES.includes(
                caseSensitive ? tx.contractAddress : tx.contractAddress.toLowerCase(),
              ) ||
              !isValidTokenSymbol(tx.tokenSymbol)
            )
              return null
            let value = (
              parseInt(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal || 18))
            ).toString()
            if (parseFloat(value) === 0) return null
            let tokenSymbol = tx.tokenSymbol || 'Unknown'
            let contractAddress = tx.contractAddress
            let tokenImage = await getTokenImage(contractAddress, chain)
            let blockTime = tx.timeStamp
              ? new Date(parseInt(tx.timeStamp) * 1000).toISOString()
              : null
            let usdValue = 0
            if (!blockTime) {
              logger.warn(
                `Missing or invalid block_time for token tx ${tx.hash} from address ${address}`,
              )
              return null
            }
            const price =
              tokenPrices[caseSensitive ? contractAddress : contractAddress.toLowerCase()]?.usd ||
              (await getTokenCurrentPrice(chainIdToName[chain], contractAddress))
            usdValue = Number(value) * price
            return {
              address: caseSensitive
                ? tx.from === address
                  ? tx.to
                  : tx.from
                : tx.from === address
                  ? tx.to
                  : tx.from,
              hash: tx.hash,
              value,
              usdValue: usdValue.toFixed(6),
              tokenSymbol,
              contractAddress,
              tokenImage,
              block_time: blockTime,
              type: tx.from === address ? 'outgoing' : 'incoming',
            }
          })
          const tokenResults = await Promise.allSettled(tokenPromises)
          tokenResults.forEach((result) => {
            if (result.status === 'fulfilled' && result.value) {
              const tx = result.value
              if (tx.type === 'outgoing') {
                outgoing.push(tx)
                addresses.add(caseSensitive ? tx.address : tx.address.toLowerCase())
              } else {
                incoming.push(tx)
                addresses.add(caseSensitive ? tx.address : tx.address.toLowerCase())
              }
            }
          })
        }
      }
      if (fetchLayer3) {
        const addressVolume = new Map()
        ;[...incoming, ...outgoing].forEach((tx) => {
          const addr = caseSensitive ? tx.address : tx.address.toLowerCase()
          const value = parseFloat(tx.usdValue || tx.value || 0)
          addressVolume.set(addr, (addressVolume.get(addr) || 0) + value)
        })

        const sortedLayer2 = [
          ...new Set(
            [...incoming, ...outgoing].map((tx) =>
              caseSensitive ? tx.address : tx.address.toLowerCase(),
            ),
          ),
        ]
          .filter((addr) => (addressVolume.get(addr) || 0) > 500)
          .sort((a, b) => (addressVolume.get(b) || 0) - (addressVolume.get(a) || 0))
          .slice(0, 20)

        logger.info(
          `Fetching Layer 3 for ${sortedLayer2.length} top-volume Layer 2 addresses (out of ${addressVolume.size} total counterparties)`,
        )

        layer3Transactions = await fetchLayer3Transactions(sortedLayer2, chain, limit, page)

        if (layer3Transactions.length > 0) {
          const layer2AddrsInL3 = [
            ...new Set(
              layer3Transactions
                .map((tx) => (caseSensitive ? tx.layer2Address : tx.layer2Address?.toLowerCase()))
                .filter(Boolean),
            ),
          ]

          if (layer2AddrsInL3.length > 0) {
            const l2Nametags = await getNametagsBatch(layer2AddrsInL3)
            logger.info(
              `Enriched nametags for ${layer2AddrsInL3.length} Layer 2 addresses in Layer 3`,
            )

            layer3Transactions.forEach((tx) => {
              if (!tx.layer2Address) return
              const l2Key = caseSensitive ? tx.layer2Address : tx.layer2Address.toLowerCase()
              const ntagL2 = l2Nametags[l2Key]

              if (ntagL2 && ntagL2.name !== 'Unknown') {
                tx.nametagLayer2 = ntagL2.name
                tx.imageLayer2 = ntagL2.image
              }
            })
          }
        }
      }
      const nametags = await getNametagsBatch([...addresses])
      walletNametag = nametags[caseSensitive ? address : address.toLowerCase()] || {
        name: 'Unknown',
        image: '/icons/default.webp',
        description: '',
        subcategory: 'Others',
      }
      const processedIncoming = incoming.map((tx) => ({
        ...tx,
        nametag: nametags[caseSensitive ? tx.address : tx.address.toLowerCase()]?.name || 'Unknown',
        image:
          nametags[caseSensitive ? tx.address : tx.address.toLowerCase()]?.image ||
          '/icons/default.webp',
        chainLogo,
      }))
      const processedOutgoing = outgoing.map((tx) => ({
        ...tx,
        nametag: nametags[caseSensitive ? tx.address : tx.address.toLowerCase()]?.name || 'Unknown',
        image:
          nametags[caseSensitive ? tx.address : tx.address.toLowerCase()]?.image ||
          '/icons/default.webp',
        chainLogo,
      }))
      const result = {
        incoming: processedIncoming,
        outgoing: processedOutgoing,
        layer3: layer3Transactions,
        wallet: {
          address,
          nametag: walletNametag.name,
          image: walletNametag.image,
          chainLogo,
        },
      }
      // Auto-label & DB save...
      const allAddressesSet = new Set([...addresses, address])
      const allAddresses = [...allAddressesSet]
      const knownNametagsMap = new Map(
        Object.entries(nametags)
          .filter(([, data]) => data.name && data.name !== 'Unknown')
          .map(([addr, data]) => [
            caseSensitive ? addr : addr.toLowerCase(),
            { label: data.name, image: data.image },
          ]),
      )
      const unknownAddresses = allAddresses
        .filter(
          (addr) =>
            !nametags[caseSensitive ? addr : addr.toLowerCase()] ||
            nametags[caseSensitive ? addr : addr.toLowerCase()].name === 'Unknown',
        )
        .slice(0, 50)
      if (unknownAddresses.length > 0) {
        const mockNodes = unknownAddresses.map((addr) => {
          const addrTxs = [...incoming, ...outgoing, ...layer3Transactions].filter(
            (tx) =>
              (caseSensitive ? tx.address : tx.address.toLowerCase()) === addr ||
              (tx.layer2Address &&
                (caseSensitive ? tx.layer2Address : tx.layer2Address.toLowerCase()) === addr),
          )
          const totalValue = addrTxs.reduce((sum, tx) => sum + parseFloat(tx.usdValue || 0), 0)
          const txCount = addrTxs.length
          const uniqueTokens = new Set(addrTxs.map((tx) => tx.tokenSymbol)).size
          const velocity = txCount > 0 ? txCount / 30 : 0
          return {
            id: addr,
            totalValue: totalValue.toString(),
            txCount,
            degree: 1,
            uniqueTokens,
            velocity,
            sellRatio: 0,
            airdropScore: 0,
            interactionWithExchanges: 0,
            txEntropy: 0,
          }
        })
        const autoLabels = await autoLabelWallets(mockNodes, null, knownNametagsMap)
        await saveAutoLabelsToDB(autoLabels)
        Object.entries(autoLabels).forEach(([addr, { label }]) => {
          if (
            !nametags[caseSensitive ? addr : addr.toLowerCase()] ||
            nametags[caseSensitive ? addr : addr.toLowerCase()].name === 'Unknown'
          ) {
            nametags[caseSensitive ? addr : addr.toLowerCase()] = {
              name: label,
              image: '/icons/default.webp',
              description: '',
              subcategory: 'ML Auto',
            }
          }
        })
        processedIncoming.forEach((tx) => {
          const ntag = nametags[caseSensitive ? tx.address : tx.address.toLowerCase()]
          if (ntag) {
            tx.nametag = ntag.name
            tx.image = ntag.image
          }
        })
        processedOutgoing.forEach((tx) => {
          const ntag = nametags[caseSensitive ? tx.address : tx.address.toLowerCase()]
          if (ntag) {
            tx.nametag = ntag.name
            tx.image = ntag.image
          }
        })
        layer3Transactions.forEach((tx) => {
          const ntagTo = nametags[caseSensitive ? tx.address : tx.address.toLowerCase()]
          if (ntagTo) {
            tx.nametag = ntagTo.name
            tx.image = ntagTo.image
          }
        })
      }
      // const calculateServerRisk = (txs) => {
      // return txs.map(tx => ({
      // ...tx,
      // riskScore: Math.random() > 0.8 ? 0.9 : 0.3
      // }));
      // };
      // const resultWithRisk = {
      // ...result,
      // incoming: calculateServerRisk(result.incoming),
      // outgoing: calculateServerRisk(result.outgoing),
      // layer3: calculateServerRisk(result.layer3),
      // };
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(result))
      return NextResponse.json(result, { headers: securityHeaders })
    }
  } catch (error) {
    logger.error('Error processing request:', error.message)
    await trackViolation(ip, error.message || 'Unknown error')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: securityHeaders },
    )
  }
}
