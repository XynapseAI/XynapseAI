import axios from 'axios';
import { TwitterApi } from 'twitter-api-v2';
import winston from 'winston';
import dotenv from 'dotenv';
import axiosRetry from 'axios-retry';
import { getExplorerUrls, CHAIN_ID_TO_NAME } from '../utils/constants.js';

// Configure axios-retry for API requests
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => Math.min(retryCount * 1000, 5000),
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED',
  onRetry: (retryCount, error) => {
    logger.warn(`Retrying API request (attempt ${retryCount}) due to ${error.message}`);
  },
});

// Load .env file
dotenv.config({ path: 'C:/Users/nnn/Desktop/Next/.env' });

// Validate environment variables
const requiredEnvVars = [
  'DATABASE_URL', 'API_BASE_URL', 'SIM_API_KEY', 'GEMINI_API_KEY',
  'TWITTER_CONSUMER_KEY', 'TWITTER_CONSUMER_SECRET', 'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_TOKEN_SECRET'
];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Error: ${envVar} is not set in .env file.`);
    process.exit(1);
  }
}

// Configure logging
const isProduction = process.env.NODE_ENV === 'production';
const logger = winston.createLogger({
  level: isProduction ? 'error' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/bot.log', level: isProduction ? 'error' : 'info' }),
    ...(isProduction ? [] : [new winston.transports.Console()])
  ]
});

logger.info('Successfully loaded .env file and validated environment variables');
logger.info(`Logger configured with level ${isProduction ? 'error' : 'info'} and transports: ${isProduction ? 'file only' : 'file and console'}`);

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

// Fetch watchlist addresses from database
async function getWatchlistAddresses() {
  const startTime = Date.now();
  try {
    const result = await query('SELECT wallet_address, name FROM watchlists');
    const validAddresses = result.rows.filter(row =>
      /^0x[a-fA-F0-9]{40}$/.test(row.wallet_address)
    );
    const duration = Date.now() - startTime;
    logger.info(`Fetched ${validAddresses.length} valid wallet addresses from watchlist in ${duration}ms`);
    return validAddresses.map(row => ({
      address: row.wallet_address,
      name: row.name || 'Unnamed Wallet'
    }));
  } catch (err) {
    logger.error(`Failed to fetch watchlist: ${err.message}`, { stack: err.stack });
    throw err;
  }
}

// Fetch name tags for addresses
async function getNameTags(addresses) {
  const startTime = Date.now();
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
      logger.warn(`Invalid response from nametags API`, { addresses, response: response.data });
      return {};
    }

    const nameTags = response.data.data || {};
    const result = Object.keys(nameTags).reduce((acc, addr) => {
      acc[addr.toLowerCase()] = nameTags[addr]?.Labels?.deposit?.['Name Tag'] || 'Unknown wallet';
      return acc;
    }, {});

    const duration = Date.now() - startTime;
    logger.info(`Fetched ${Object.keys(result).length} name tags in ${duration}ms`);
    return result;
  } catch (err) {
    logger.error(`Failed to fetch name tags: ${err.message}`, {
      stack: err.stack,
      status: err.response?.status,
      data: err.response?.data,
      addresses
    });
    return {};
  }
}

async function fetchTransactions(address) {
  const startTime = Date.now();
  try {
    const response = await axios.post(
      `${process.env.API_BASE_URL}/api/sim`,
      { action: 'transactions', address, minValueUsd: 50_000_000 },
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
      logger.warn(`Invalid response from transactions API for ${address}`, { response: response.data });
      return [];
    }

    const duration = Date.now() - startTime;
    logger.info(`Fetched ${response.data.length} transactions for ${address} in ${duration}ms`);
    return response.data;
  } catch (err) {
    logger.error(`Failed to fetch transactions for ${address}: ${err.message}`, {
      stack: err.stack,
      status: err.response?.status,
      data: err.response?.data
    });
    return [];
  }
}

// Check if transaction was already posted
async function isTransactionPosted(hash) {
  try {
    const result = await query('SELECT 1 FROM posted_transactions WHERE hash = $1', [hash]);
    logger.info(`Checked transaction ${hash}: ${result.rows.length > 0 ? 'already posted' : 'not posted'}`);
    return result.rows.length > 0;
  } catch (err) {
    logger.error(`Failed to check posted transaction ${hash}: ${err.message}`, { stack: err.stack });
    return false;
  }
}

// Save posted transaction to database
async function savePostedTransaction(hash) {
  try {
    await query('INSERT INTO posted_transactions (hash) VALUES ($1)', [hash]);
    logger.info(`Saved transaction ${hash} to posted_transactions`);
  } catch (err) {
    logger.error(`Failed to save posted transaction ${hash}: ${err.message}`, { stack: err.stack });
  }
}

// Generate tweet content using Gemini API
// Generate tweet content using Gemini API
async function getGeminiResponse(transaction, fromName, toName, chainName, txUrl) {
  const startTime = Date.now();
  const { chain, hash, from, to, value, token, block_time } = transaction;
  const currentDate = new Date().toISOString().split('T')[0];
  const formattedValue = Number(value).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&.');
  const prompt = `
Write a concise tweet about a large cryptocurrency transaction. The current date is ${currentDate}.
Keep it 20-40 words, under 260 characters to allow for URLs, no emojis, no @username , do not write words like Whoa, Wow, etc..
Use complete sentences with line breaks for readability. Avoid numbering (e.g., 1/, 2/).
Include sender (${fromName}) and recipient (${toName}), token amount, $ prefix for token (e.g., $USDT), chain (${chainName}), clickable transaction link, and brief market impact analysis (e.g., whale activity).
Transaction details:
- Chain: ${chainName}
- Token: ${token.toUpperCase()}
- Value: ${formattedValue}
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
    const duration = Date.now() - startTime;
    const wordCount = content.split(/\s+/).length;

    if (content && content.length <= 260 && wordCount >= 20 && wordCount <= 40) {
      logger.info(`Generated tweet for ${hash} in ${duration}ms: ${content}`, { charCount: content.length, wordCount });
      return content;
    }

    logger.warn(`Gemini response invalid for ${hash}: ${content.length} chars, ${wordCount} words`, { content });
    return `${formattedValue} $${token.toUpperCase()} moved from ${fromName} to ${toName} on ${chainName}.
Whale transfer.
Details: ${txUrl}`;
  } catch (err) {
    logger.error(`Failed to generate tweet for ${hash}: ${err.message}`, { stack: err.stack });
    const duration = Date.now() - startTime;
    logger.info(`Fallback tweet generated for ${hash} in ${duration}ms`);
    return `${formattedValue} $${token.toUpperCase()} moved from ${fromName} to ${toName} on ${chainName}.
This whale transfer could signal market shifts.
Details: ${txUrl}`;
  }
}

// Post tweet for large transaction
async function postTweet(transaction, fromName, toName) {
  const startTime = Date.now();
  const { chain, hash, block_time } = transaction;
  const chainName = CHAIN_ID_TO_NAME[chain] || chain;
  const { txUrl } = getExplorerUrls(chain, hash);

  const now = new Date();
  const txTime = new Date(block_time);
  const hoursDiff = (now - txTime) / (1000 * 60 * 60);
  if (hoursDiff > 2) {
    logger.info(`Transaction ${hash} is older than 2 hours, skipping`, { hoursDiff });
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
      await v2Client.tweet(tweetText);
      const duration = Date.now() - startTime;
      logger.info(`Posted tweet for transaction ${hash} in ${duration}ms`, { tweetText });
      await savePostedTransaction(hash);
      lastTweetTime = Date.now();
      return true;
    } catch (err) {
      logger.error(`Failed to post tweet for ${hash} (attempt ${attempt}): ${err.message}`, { stack: err.stack });
      if (err.response?.status === 429 && attempt < maxRetries) {
        const waitTime = (err.response.headers['x-rate-limit-reset'] ? (parseInt(err.response.headers['x-rate-limit-reset']) * 1000 - Date.now()) + 1000 : attempt * 5000);
        logger.info(`Rate limit hit for ${hash}, waiting ${waitTime / 1000}s`, { attempt });
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        return false;
      }
    }
  }
  return false;
}

// Process tweet queue with 1-hour spacing within a single cron run
async function processTweetQueue() {
  logger.info('Processing tweet queue');
  while (tweetQueue.length > 0) {
    const now = Date.now();
    if (now - lastTweetTime >= 3600000) {
      const { transaction, fromName, toName } = tweetQueue.shift();
      logger.info(`Processing tweet from queue for transaction ${transaction.hash}`, { queueSize: tweetQueue.length });
      const posted = await postTweet(transaction, fromName, toName);
      if (!posted) {
        logger.warn(`Failed to post tweet for ${transaction.hash}, skipping`, { queueSize: tweetQueue.length });
      }
      logger.info(`Tweet queue size after processing: ${tweetQueue.length}`);
    } else {
      const waitTime = 3600000 - (now - lastTweetTime);
      logger.info(`Waiting ${waitTime / 1000}s before processing next tweet`, { queueSize: tweetQueue.length });
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  logger.info('Tweet queue processing completed');
  const uptime = Date.now() - botStartTime; // Now botStartTime is accessible
  logger.info(`Cron job uptime: ${uptime}ms`);
}

// Main bot logic for single execution
async function main() {
  const botStartTime = Date.now();
  logger.info('Starting watchlist bot cron job');

  try {
    // Ensure posted_transactions table exists
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

    // Fetch watchlist and process transactions
    const watchlist = await getWatchlistAddresses();
    const addresses = watchlist.map(w => w.address);
    logger.info(`Processing ${addresses.length} addresses from watchlist`);
    const nameTags = await getNameTags(addresses);
    let transactionsInHour = [];

    for (const wallet of watchlist) {
      const transactions = await fetchTransactions(wallet.address);
      logger.info(`Found ${transactions.length} transactions for wallet ${wallet.address}`);
      for (const tx of transactions) {
        if (tx.value_usd >= 50_000_000) {
          const txTime = new Date(tx.block_time);
          const now = new Date();
          const hoursDiff = (now - txTime) / (1000 * 60 * 60);
          if (hoursDiff <= 2 && !await isTransactionPosted(tx.hash)) {
            transactionsInHour.push({
              ...tx,
              walletName: wallet.name || 'Unnamed Wallet'
            });
            logger.info(`Added transaction ${tx.hash} to processing list`, { value_usd: tx.value_usd });
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 10 * 1000));
    }

    logger.info(`Found ${transactionsInHour.length} qualifying transactions in the last 2 hours`);
    if (transactionsInHour.length > 0) {
      const txAddresses = new Set();
      transactionsInHour.forEach(tx => {
        if (tx.from && tx.from !== 'None') txAddresses.add(tx.from);
        if (tx.to && tx.to !== 'None') txAddresses.add(tx.to);
      });
      logger.info(`Fetching name tags for ${txAddresses.size} transaction addresses`);
      const txNameTags = txAddresses.size > 0 ? await getNameTags([...txAddresses]) : {};

      // Process transactions: post first one immediately if allowed, queue the rest
      for (let i = 0; i < transactionsInHour.length; i++) {
        const tx = transactionsInHour[i];
        const fromName = txNameTags[tx.from.toLowerCase()] || tx.walletName || 'Unknown wallet';
        const toName = tx.to === 'None' ? 'None' : (txNameTags[tx.to.toLowerCase()] || 'Unknown wallet');

        if (i === 0 && (Date.now() - lastTweetTime >= 3600000)) {
          logger.info(`Posting first transaction ${tx.hash} immediately`, { value_usd: tx.value_usd });
          const posted = await postTweet(tx, fromName, toName);
          if (!posted) {
            logger.warn(`Failed to post first transaction ${tx.hash}, adding to queue`, { value_usd: tx.value_usd });
            tweetQueue.push({ transaction: tx, fromName, toName });
            logger.info(`Added transaction ${tx.hash} to tweet queue`, { queueSize: tweetQueue.length });
          }
        } else {
          logger.info(`Adding transaction ${tx.hash} with value ${tx.value_usd} USD to tweet queue`, { queueSize: tweetQueue.length + 1 });
          tweetQueue.push({ transaction: tx, fromName, toName });
        }
      }

      // Process the tweet queue within this run
      await processTweetQueue();
    } else {
      logger.info('No qualifying transactions found in the last 2 hours');
    }

    const duration = Date.now() - botStartTime;
    logger.info(`Cron job completed in ${duration}ms`, { transactionsFound: transactionsInHour.length, queueSize: tweetQueue.length });
  } catch (err) {
    logger.error(`Main function error: ${err.message}`, { stack: err.stack });
    process.exit(1);
  }
}

// Start the bot
main().then(() => {
  logger.info('Cron job execution finished successfully');
  process.exit(0);
}).catch(err => {
  logger.error(`Fatal error: ${err.message}`, { stack: err.stack });
  process.exit(1);
});