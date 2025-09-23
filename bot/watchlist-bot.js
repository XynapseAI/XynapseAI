import axios from 'axios';
import { TwitterApi } from 'twitter-api-v2';
import winston from 'winston';
import dotenv from 'dotenv';
import axiosRetry from 'axios-retry';
import { getExplorerUrls, CHAIN_ID_TO_NAME } from '../utils/constants.js';

// Token configuration for price adjustments and exclusions
const TOKEN_CONFIG = {
  RAD: {
    priceSource: 'coingecko',
    coingeckoId: 'radicle',
    defaultPrice: 0.684642,
  },
  ID: {
    exclude: true, // Exclude ID token from processing
  },
};

// Configure axios-retry for API requests
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => Math.min(retryCount * 1000, 5000),
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED',
  onRetry: (retryCount, error) => {
    logger.warn(`Retrying API request (attempt ${retryCount}) due to ${error.message}`, {
      errorCode: error.code,
      status: error.response?.status,
      responseData: error.response?.data
    });
  },
});

// Load .env file
dotenv.config({ path: process.env.NODE_ENV === 'production' ? '.env' : 'C:/Users/nnn/Desktop/Next/.env' });

// Validate environment variables
const requiredEnvVars = [
  'DATABASE_URL', 'API_BASE_URL', 'SIM_API_KEY', 'GEMINI_API_KEY',
  'TWITTER_CONSUMER_KEY', 'TWITTER_CONSUMER_SECRET', 'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_TOKEN_SECRET'
];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Missing environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Configure logging
const isProduction = process.env.NODE_ENV === 'production';
const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/bot.log', level: isProduction ? 'info' : 'debug' }),
    new winston.transports.Console({ level: isProduction ? 'info' : 'debug' })
  ]
});

// Log environment details
logger.info('Bot started', {
  nodeEnv: process.env.NODE_ENV,
  railwayEnv: process.env.RAILWAY_ENVIRONMENT || 'unknown',
  memoryUsage: process.memoryUsage(),
  pid: process.pid,
  uptime: process.uptime()
});

// Twitter client configuration
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_CONSUMER_KEY,
  appSecret: process.env.TWITTER_CONSUMER_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});
const v2Client = twitterClient.v2;
logger.info('Twitter client initialized successfully');

// Dynamic import for postgres.js
const { query } = await import('../utils/postgres.js');
logger.info('Postgres module imported successfully');

// Track last tweet time and tweet queue
let lastTweetTime = 0;
const tweetQueue = [];
const TWEET_SPACING_MS = 1800000; // 30 minutes
const MAX_QUEUE_SIZE = 10; // Limit queue to avoid overload

// Create bot_wallets table if it doesn't exist
async function ensureBotWalletsTable() {
  const startTime = Date.now();
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS bot_wallets (
        wallet_address TEXT PRIMARY KEY,
        name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('Ensured bot_wallets table exists', { queryDuration: Date.now() - startTime });
  } catch (err) {
    logger.error(`Failed to create bot_wallets table: ${err.message}`, { stack: err.stack });
    throw err;
  }
}

// Fetch wallet addresses from bot_wallets table
async function getBotWalletAddresses() {
  const startTime = Date.now();
  try {
    const result = await query('SELECT wallet_address, name FROM bot_wallets');
    const validAddresses = result.rows.filter(row =>
      /^0x[a-fA-F0-9]{40}$/.test(row.wallet_address)
    );
    logger.info(`Fetched ${validAddresses.length} valid wallet addresses from bot_wallets in ${Date.now() - startTime}ms`, {
      rowCount: result.rows.length,
      validCount: validAddresses.length
    });
    return validAddresses.map(row => ({
      address: row.wallet_address.toLowerCase(),
      name: row.name || 'Unnamed Wallet'
    }));
  } catch (err) {
    logger.error(`Failed to fetch bot_wallets: ${err.message}`, { stack: err.stack });
    throw err;
  }
}

// Fetch name tags for addresses
async function getNameTags(addresses) {
  const startTime = Date.now();
  if (!addresses || addresses.length === 0) {
    logger.info('Skipping name tags fetch: no addresses provided', { addressesCount: 0 });
    return {};
  }
  try {
    const response = await axios.post(
      `${process.env.API_BASE_URL}/api/nametags`,
      { addresses },
      {
        headers: {
          'Content-Type': 'application/json',
          'Origin': process.env.API_BASE_URL,
          'Authorization': `Bearer ${process.env.SIM_API_KEY}`,
        },
        timeout: 30000
      }
    );

    if (!response.data.success || !response.data.data) {
      logger.warn(`Invalid response from nametags API`, { responseData: response.data });
      return {};
    }

    const nameTags = response.data.data || {};
    const result = Object.keys(nameTags).reduce((acc, addr) => {
      acc[addr.toLowerCase()] = nameTags[addr]?.Labels?.deposit?.['Name Tag'] || 'Unknown wallet';
      return acc;
    }, {});

    logger.info(`Fetched ${Object.keys(result).length} name tags in ${Date.now() - startTime}ms`, { addressesCount: addresses.length });
    return result;
  } catch (err) {
    logger.error(`Failed to fetch name tags: ${err.message}`, {
      stack: err.stack,
      status: err.response?.status,
      data: err.response?.data
    });
    return {};
  }
}

// Fetch token price from CoinGecko
async function fetchTokenPrice(tokenConfig) {
  if (!tokenConfig.priceSource || tokenConfig.priceSource !== 'coingecko' || !tokenConfig.coingeckoId) {
    return tokenConfig.defaultPrice || 0;
  }
  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${tokenConfig.coingeckoId}&vs_currencies=usd`,
      { timeout: 10000 }
    );
    const price = response.data[tokenConfig.coingeckoId]?.usd || tokenConfig.defaultPrice;
    logger.info(`Fetched ${tokenConfig.coingeckoId} price from CoinGecko: ${price} USD`);
    return price;
  } catch (err) {
    logger.warn(`Failed to fetch ${tokenConfig.coingeckoId} price, using default: ${tokenConfig.defaultPrice}`, { error: err.message });
    return tokenConfig.defaultPrice || 0;
  }
}

// Fetch transactions for an address
async function fetchTransactions(address) {
  const startTime = Date.now();
  try {
    const now = new Date();
    const startTimeFilter = new Date(now.getTime() - 2.5 * 60 * 60 * 1000).toISOString(); // 2.5h trước (2h + buffer 30p)
    const response = await axios.post(
      `${process.env.API_BASE_URL}/api/sim`,
      {
        action: 'transactions',
        address,
        minValueUsd: 100_000_000,
        start_time: startTimeFilter
      },
      {
        headers: {
          'X-Sim-Api-Key': process.env.SIM_API_KEY,
          'Authorization': `Bearer ${process.env.SIM_API_KEY}`,
          'Content-Type': 'application/json',
          'Origin': process.env.API_BASE_URL
        },
        timeout: 30000
      }
    );

    if (!Array.isArray(response.data)) {
      logger.warn(`Invalid response from transactions API for ${address}`, { responseData: response.data });
      return [];
    }

    logger.debug(`Raw transaction data for ${address}`, {
      transactionCount: response.data.length,
      rawData: response.data
    });

    // Fetch prices for tokens in configuration
    const tokenPrices = {};
    for (const token of Object.keys(TOKEN_CONFIG)) {
      if (!TOKEN_CONFIG[token].exclude) {
        tokenPrices[token] = await fetchTokenPrice(TOKEN_CONFIG[token]);
      }
    }

    const transactions = response.data
      .map(tx => {
        if (!tx.value || !tx.token || !tx.hash || !tx.block_time) {
          logger.warn(`Invalid transaction data for ${tx.hash || 'unknown'}: missing required fields`, { tx });
          return null;
        }

        // Skip excluded tokens
        if (TOKEN_CONFIG[tx.token]?.exclude) {
          logger.info(`Skipping transaction ${tx.hash} for excluded token ${tx.token}`);
          return null;
        }

        let adjustedValueUsd = tx.value_usd; // Default to API value
        if (TOKEN_CONFIG[tx.token] && tokenPrices[tx.token]) {
          const tokenAmount = Number(tx.value) / 1e18;
          adjustedValueUsd = tokenAmount * tokenPrices[tx.token];
        }

        if (typeof adjustedValueUsd !== 'number' || isNaN(adjustedValueUsd) || adjustedValueUsd < 0 || adjustedValueUsd > 1_000_000_000_000) {
          logger.warn(`Invalid value_usd for transaction ${tx.hash}`, {
            value_usd: adjustedValueUsd,
            original_value_usd: tx.value_usd,
            token: tx.token,
            value: tx.value,
            reason: 'Value out of valid range'
          });
          return null;
        }

        return { ...tx, value_usd: adjustedValueUsd };
      })
      .filter(tx => tx !== null);

    logger.info(`Fetched and validated ${transactions.length} transactions for ${address} in ${Date.now() - startTime}ms`, {
      originalCount: response.data.length,
      filteredCount: transactions.length
    });
    return transactions;
  } catch (err) {
    logger.error(`Failed to fetch transactions for ${address}: ${err.message}`, {
      stack: err.stack,
      status: err.response?.status,
      data: err.response?.data
    });
    return [];
  }
}

// Check if transaction was already posted (DB + optional Twitter check)
async function isTransactionPosted(hash) {
  const startTime = Date.now();
  try {
    // Check DB first
    const dbResult = await query('SELECT 1 FROM posted_transactions WHERE hash = $1', [hash]);
    if (dbResult.rows.length > 0) {
      logger.info(`Transaction ${hash} already posted in DB`, {
        queryDuration: Date.now() - startTime
      });
      return true;
    }

    // Optional: Check recent tweets if env enabled
    if (process.env.CHECK_TWITTER_TWEETS === 'true') {
      try {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const tweets = await v2Client.userTimeline({ 'user.fields': 'created_at', start_time: twoHoursAgo, max_results: 50 });
        for (const tweet of tweets.data?.data || []) {
          if (tweet.text.includes(hash)) {
            logger.info(`Transaction ${hash} found in recent tweet: ${tweet.id}`);
            await savePostedTransaction(hash); // Sync to DB
            return true;
          }
        }
      } catch (twitterErr) {
        logger.warn(`Failed to check recent tweets for ${hash}: ${twitterErr.message}`);
      }
    }

    logger.info(`Transaction ${hash} not posted`, {
      queryDuration: Date.now() - startTime
    });
    return false;
  } catch (err) {
    logger.error(`Failed to check posted transaction ${hash}: ${err.message}`, { stack: err.stack });
    return false;
  }
}

// Save posted transaction to database
async function savePostedTransaction(hash) {
  const startTime = Date.now();
  try {
    await query('INSERT INTO posted_transactions (hash) VALUES ($1) ON CONFLICT (hash) DO NOTHING', [hash]);
    logger.info(`Saved transaction ${hash} to posted_transactions`, { queryDuration: Date.now() - startTime });
  } catch (err) {
    logger.error(`Failed to save posted transaction ${hash}: ${err.message}`, { stack: err.stack });
  }
}

// Generate tweet content using Gemini API
async function getGeminiResponse(transaction, fromName, toName, chainName, txUrl) {
  const startTime = Date.now();
  const { chain, hash, from, to, value, token, block_time, value_usd } = transaction;
  const currentDate = new Date().toISOString().split('T')[0];
  const formattedValue = Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const formattedValueUsd = Number(value_usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const prompt = `
Write a concise tweet about a large cryptocurrency transaction. Current date: ${currentDate}.
Keep it 20-40 words, under 280 characters, no emojis, no @username, avoid words like Whoa, Wow.
Use complete sentences with line breaks. Avoid numbering (e.g., 1/, 2/).
Include sender (${fromName}), recipient (${toName}), token amount, $ prefix for token, chain (${chainName}), USD value ($${formattedValueUsd}), clickable transaction link, and brief market impact analysis.
Transaction details:
- Chain: ${chainName}
- Token: ${token.toUpperCase()}
- Value: ${formattedValue}
- Value USD: ${formattedValueUsd}
- From: ${fromName} (${from})
- To: ${toName} (${to})
- Tx Hash: ${hash}
- Tx URL: ${txUrl}
- Time: ${new Date(block_time).toISOString()}
`;
  try {
    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent',
      { contents: [{ parts: [{ text: prompt }] }] },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY
        },
        timeout: 20000
      }
    );

    const content = response.data.candidates[0].content.parts[0].text;
    const wordCount = content.split(/\s+/).length;

    if (content && content.length <= 280 && wordCount >= 20 && wordCount <= 40) {
      logger.info(`Generated tweet for ${hash} in ${Date.now() - startTime}ms`, {
        charCount: content.length,
        wordCount,
        content
      });
      return content;
    }

    logger.warn(`Gemini response invalid for ${hash}`, { charCount: content.length, wordCount, content });
    return `${formattedValue} $${token.toUpperCase()} ($${formattedValueUsd}) moved from ${fromName} to ${toName} on ${chainName}.
Whale transfer may impact market.
Details: ${txUrl}`;
  } catch (err) {
    logger.error(`Failed to generate tweet for ${hash}: ${err.message}`, {
      stack: err.stack,
      status: err.response?.status,
      data: err.response?.data
    });
    return `${formattedValue} $${token.toUpperCase()} ($${formattedValueUsd}) moved from ${fromName} to ${toName} on ${chainName}.
Whale transfer may impact market.
Details: ${txUrl}`;
  }
}

async function postTweet(transaction, fromName, toName) {
  const startTime = Date.now();
  const { chain, hash, block_time, value_usd } = transaction;
  const chainName = CHAIN_ID_TO_NAME[chain] || chain;
  const { txUrl } = getExplorerUrls(chain, hash);

  const now = new Date();
  const txTime = new Date(block_time);
  const hoursDiff = (now - txTime) / (1000 * 60 * 60);
  if (hoursDiff > 3) {
    logger.info(`Transaction ${hash} is older than 3 hours, skipping`, {
      hoursDiff,
      txTime: txTime.toISOString(),
      now: now.toISOString()
    });
    return false;
  }

  if (await isTransactionPosted(hash)) {
    logger.info(`Transaction ${hash} already posted, skipping`);
    return false;
  }

  const tweetText = await getGeminiResponse(transaction, fromName, toName, chainName, txUrl);
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Attempting to post tweet for ${hash} (attempt ${attempt})`, {
        tweetText,
        charCount: tweetText.length,
        value_usd
      });
      const tweetResponse = await v2Client.tweet(tweetText);
      const tweetId = tweetResponse.data.id;
      const tweetUrl = `https://x.com/i/status/${tweetId}`; // URL để kiểm tra tweet
      logger.info(`Successfully posted tweet for transaction ${hash} in ${Date.now() - startTime}ms`, {
        tweetText,
        tweetResponse: tweetResponse.data,
        tweetUrl
      });
      await savePostedTransaction(hash);
      lastTweetTime = Date.now();
      return true;
    } catch (err) {
      logger.error(`Failed to post tweet for ${hash} (attempt ${attempt}): ${err.message}`, {
        stack: err.stack,
        status: err.response?.status,
        headers: err.response?.headers,
        data: err.response?.data
      });
      if (err.response?.status === 429 && attempt < maxRetries) {
        const resetTime = err.response.headers['x-rate-limit-reset']
          ? parseInt(err.response.headers['x-rate-limit-reset']) * 1000
          : Date.now() + attempt * 5000;
        const waitTime = Math.max(resetTime - Date.now() + 1000, 0);
        logger.info(`Rate limit hit for ${hash}, waiting ${waitTime / 1000}s`, { attempt });
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        logger.error(`Non-recoverable error for ${hash}`, {
          attempt,
          status: err.response?.status,
          data: err.response?.data
        });
        return false;
      }
    }
  }
  logger.error(`Failed to post tweet for ${hash} after ${maxRetries} attempts`);
  return false;
}

// Process tweet queue with 30-minute spacing
async function processTweetQueue() {
  logger.info('Starting tweet queue processing', {
    queueSize: tweetQueue.length,
    lastTweetTime,
    currentTime: Date.now()
  });
  while (tweetQueue.length > 0) {
    const now = Date.now();
    if (now - lastTweetTime >= TWEET_SPACING_MS) {
      const { transaction, fromName, toName } = tweetQueue.shift();
      logger.info(`Processing tweet from queue for transaction ${transaction.hash}`, {
        queueSize: tweetQueue.length,
        transactionValue: transaction.value_usd
      });
      const posted = await postTweet(transaction, fromName, toName);
      if (!posted) {
        logger.warn(`Failed to post tweet for ${transaction.hash}, re-adding to queue`, {
          value_usd: transaction.value_usd
        });
        if (tweetQueue.length < MAX_QUEUE_SIZE) {
          tweetQueue.push({ transaction, fromName, toName }); // Re-add if queue not full
        } else {
          logger.error(`Queue full, dropping failed transaction ${transaction.hash}`);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // Short delay to avoid rate limits
    } else {
      const waitTime = TWEET_SPACING_MS - (now - lastTweetTime);
      logger.info(`Waiting ${waitTime / 1000}s before processing next tweet`, {
        queueSize: tweetQueue.length
      });
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  logger.info('Tweet queue processing completed');
}

// Main bot logic
async function main() {
  const botStartTime = Date.now();
  logger.info('Starting watchlist bot cron job', {
    memoryUsage: process.memoryUsage(),
    railwayEnv: process.env.RAILWAY_ENVIRONMENT || 'unknown'
  });

  try {
    // Ensure tables exist
    await ensureBotWalletsTable();
    await query(`
      CREATE TABLE IF NOT EXISTS posted_transactions (
        hash TEXT PRIMARY KEY,
        posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('Ensured posted_transactions table exists');

    // Clean up old transactions
    await query('DELETE FROM posted_transactions WHERE posted_at < NOW() - INTERVAL \'7 days\'');
    logger.info('Cleaned up old transactions from posted_transactions');

    // Fetch bot wallets
    const botWallets = await getBotWalletAddresses();
    if (botWallets.length === 0) {
      logger.warn('No wallets to process. Add addresses to bot_wallets table.', {
        memoryUsage: process.memoryUsage()
      });
      return;
    }

    const addresses = botWallets.map(w => w.address);
    logger.info(`Processing ${addresses.length} addresses from bot_wallets`);
    const nameTags = await getNameTags(addresses);
    let transactionsInHour = [];

    const batchSize = 5;
    for (let i = 0; i < botWallets.length; i += batchSize) {
      const batch = botWallets.slice(i, i + batchSize);
      const promises = batch.map(wallet => fetchTransactions(wallet.address));
      const results = await Promise.all(promises);

      for (let j = 0; j < batch.length; j++) {
        const wallet = batch[j];
        const transactions = results[j];
        logger.info(`Found ${transactions.length} transactions for wallet ${wallet.address}`);

        for (const tx of transactions) {
          if (tx.value_usd >= 100_000_000) {
            const txTime = new Date(tx.block_time);
            const now = new Date();
            const hoursDiff = (now - txTime) / (1000 * 60 * 60);
            if (hoursDiff <= 2) {
              if (await isTransactionPosted(tx.hash)) {
                logger.info(`Transaction ${tx.hash} already posted, skipping`, {
                  value_usd: tx.value_usd,
                  token: tx.token,
                  txTime: txTime.toISOString()
                });
                continue;
              }
              transactionsInHour.push({
                ...tx,
                walletName: wallet.name || 'Unnamed Wallet'
              });
              logger.info(`Added transaction ${tx.hash} to processing list`, {
                value_usd: tx.value_usd,
                value: tx.value,
                token: tx.token,
                txTime: txTime.toISOString(),
                hoursDiff
              });
            } else {
              logger.info(`Transaction ${tx.hash} is older than 2 hours, skipping`, {
                value_usd: tx.value_usd,
                token: tx.token,
                txTime: txTime.toISOString(),
                hoursDiff
              });
            }
          } else {
            logger.debug(`Transaction ${tx.hash} below value threshold`, {
              value_usd: tx.value_usd,
              original_value_usd: tx.original_value_usd,
              token: tx.token
            });
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.info(`Found ${transactionsInHour.length} qualifying transactions in the last 2 hours`);
    if (transactionsInHour.length > 0) {
      const txAddresses = new Set();
      transactionsInHour.forEach(tx => {
        if (tx.from && tx.from !== 'None') txAddresses.add(tx.from);
        if (tx.to && tx.to !== 'None') txAddresses.add(tx.to);
      });
      const txNameTags = txAddresses.size > 0 ? await getNameTags([...txAddresses]) : {};

      // Sort by value_usd desc, then by time desc (newest first if tie)
      transactionsInHour.sort((a, b) => {
        if (b.value_usd !== a.value_usd) return b.value_usd - a.value_usd;
        return new Date(b.block_time) - new Date(a.block_time);
      });

      for (let i = 0; i < transactionsInHour.length; i++) {
        const tx = transactionsInHour[i];
        const fromName = txNameTags[tx.from.toLowerCase()] || tx.walletName || 'Unknown wallet';
        const toName = tx.to === 'None' ? 'None' : (txNameTags[tx.to.toLowerCase()] || 'Unknown wallet');

        // Post first tx immediately if spacing allows
        if (i === 0 && (Date.now() - lastTweetTime >= TWEET_SPACING_MS)) {
          logger.info(`Posting first transaction ${tx.hash} immediately`, {
            value_usd: tx.value_usd,
            value: tx.value,
            token: tx.token,
            fromName,
            toName
          });
          const posted = await postTweet(tx, fromName, toName);
          if (!posted) {
            logger.warn(`Failed to post first transaction ${tx.hash}, adding to queue`, {
              value_usd: tx.value_usd
            });
            if (tweetQueue.length < MAX_QUEUE_SIZE) {
              tweetQueue.push({ transaction: tx, fromName, toName });
            }
          }
        } else if (tweetQueue.length < MAX_QUEUE_SIZE) {
          logger.info(`Adding transaction ${tx.hash} to tweet queue`, {
            queueSize: tweetQueue.length + 1,
            value_usd: tx.value_usd,
            token: tx.token
          });
          tweetQueue.push({ transaction: tx, fromName, toName });
        } else {
          logger.warn(`Queue full, skipping transaction ${tx.hash}`);
        }
      }

      await processTweetQueue();
    } else {
      logger.info('No qualifying transactions found in the last 2 hours');
    }

    logger.info(`Cron job completed in ${Date.now() - botStartTime}ms`, {
      transactionsFound: transactionsInHour.length,
      queueSize: tweetQueue.length
    });
  } catch (err) {
    logger.error(`Main function error: ${err.message}`, {
      stack: err.stack,
      memoryUsage: process.memoryUsage()
    });
    throw err;
  }
}

// Start the bot
main().then(() => {
  logger.info('Cron job execution finished successfully', {
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime()
  });
  process.exit(0);
}).catch(err => {
  logger.error(`Fatal error: ${err.message}`, {
    stack: err.stack,
    memoryUsage: process.memoryUsage()
  });
  process.exit(1);
});