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
    winston.format.json() // Modified log: Use JSON format for better log parsing on Railway
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/bot.log', level: isProduction ? 'error' : 'info' }),
    ...(isProduction ? [] : [new winston.transports.Console()]) // Console logs only in non-production
  ]
});

// Added log: Log successful loading of .env file (Moved here after logger initialization)
logger.info('Successfully loaded .env file and validated environment variables'); // Moved log

// Added log: Log logger configuration
logger.info(`Logger configured with level ${isProduction ? 'error' : 'info'} and transports: ${isProduction ? 'file only' : 'file and console'}`); // Added log

// Twitter client configuration
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_CONSUMER_KEY,
  appSecret: process.env.TWITTER_CONSUMER_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});
const v2Client = twitterClient.v2;

// Added log: Confirm Twitter client initialization
logger.info('Twitter client initialized successfully'); // Added log

// Dynamic import for postgres.js
const { query } = await import('../utils/postgres.js');

// Added log: Confirm database module import
logger.info('Postgres module imported successfully'); // Added log

// Track last tweet time and tweet queue
let lastTweetTime = 0;
const tweetQueue = [];

// Fetch watchlist addresses from database
async function getWatchlistAddresses() {
  const startTime = Date.now(); // Added log: Track execution time
  try {
    const result = await query('SELECT wallet_address, name FROM watchlists');
    const duration = Date.now() - startTime;
    logger.info(`Fetched ${result.rows.length} wallet addresses from watchlist in ${duration}ms`); // Modified log
    return result.rows.map(row => ({
      address: row.wallet_address,
      name: row.name || 'Unnamed Wallet'
    }));
  } catch (err) {
    logger.error(`Failed to fetch watchlist: ${err.message}`, { stack: err.stack }); // Modified log: Include stack trace
    throw err;
  }
}

// Fetch name tags for addresses
async function getNameTags(addresses) {
  const startTime = Date.now(); // Added log: Track execution time
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
        timeout: 10000
      }
    );

    if (!response.data.success || !response.data.data) {
      logger.warn(`Invalid response from nametags API`, { addresses }); // Modified log: Include addresses
      return {};
    }

    const nameTags = response.data.data || {};
    const result = Object.keys(nameTags).reduce((acc, addr) => {
      acc[addr.toLowerCase()] = nameTags[addr]?.Labels?.deposit?.['Name Tag'] || 'Unknown wallet';
      return acc;
    }, {});

    const duration = Date.now() - startTime;
    logger.info(`Fetched ${Object.keys(result).length} name tags in ${duration}ms`); // Modified log
    return result;
  } catch (err) {
    logger.error(`Failed to fetch name tags: ${err.message}`, { stack: err.stack, addresses }); // Modified log: Include stack and addresses
    return {};
  }
}

// Fetch transactions for an address
async function fetchTransactions(address) {
  const startTime = Date.now(); // Added log: Track execution time
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
        timeout: 15000
      }
    );

    if (!Array.isArray(response.data)) {
      logger.warn(`Invalid response from transactions API for ${address}`, { response: response.data }); // Modified log: Include response data
      return [];
    }

    const duration = Date.now() - startTime;
    logger.info(`Fetched ${response.data.length} transactions for ${address} in ${duration}ms`); // Modified log
    return response.data;
  } catch (err) {
    logger.error(`Failed to fetch transactions for ${address}: ${err.message}`, { stack: err.stack }); // Modified log: Include stack
    return [];
  }
}

// Check if transaction was already posted
async function isTransactionPosted(hash) {
  try {
    const result = await query('SELECT 1 FROM posted_transactions WHERE hash = $1', [hash]);
    logger.info(`Checked transaction ${hash}: ${result.rows.length > 0 ? 'already posted' : 'not posted'}`); // Added log
    return result.rows.length > 0;
  } catch (err) {
    logger.error(`Failed to check posted transaction ${hash}: ${err.message}`, { stack: err.stack }); // Modified log: Include stack
    return false;
  }
}

// Save posted transaction to database
async function savePostedTransaction(hash) {
  try {
    await query('INSERT INTO posted_transactions (hash) VALUES ($1)', [hash]);
    logger.info(`Saved transaction ${hash} to posted_transactions`); // Modified log
  } catch (err) {
    logger.error(`Failed to save posted transaction ${hash}: ${err.message}`, { stack: err.stack }); // Modified log: Include stack
  }
}

// Generate tweet content using Gemini API
async function getGeminiResponse(transaction, fromName, toName, chainName, txUrl) {
  const startTime = Date.now(); // Added log: Track execution time
  const { chain, hash, from, to, value, token, block_time } = transaction;
  const currentDate = new Date().toISOString().split('T')[0];
  const formattedValue = Number(value).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&.');
  const prompt = `
Write a witty, engaging tweet about a large cryptocurrency transaction. The current date is ${currentDate}. Focus on crypto trends, 20-40 words, no emojis, no @username.
Use complete sentences with line breaks for readability. Avoid numbering (e.g., 1/, 2/). Include a clickable transaction link and a brief analysis of the transaction's significance (e.g., market impact, whale activity).
Use uppercase for token symbol with $ prefix (e.g., $USDT).
Omit USD value, only show token amount.
Always include the sender (${fromName}) and recipient (${toName}) names in the tweet.
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
        timeout: 10000
      }
    );

    const content = response.data.candidates[0].content.parts[0].text;
    const duration = Date.now() - startTime;
    if (content && content.length <= 280) {
      logger.info(`Generated tweet for ${hash} in ${duration}ms: ${content}`); // Modified log
      return content;
    }
    logger.warn(`Gemini response too long for ${hash}, using fallback`, { contentLength: content.length }); // Modified log
    return `${formattedValue} $${token.toUpperCase()} moved from ${fromName} to ${toName} on ${chainName}.
This whale transfer could signal market shifts.
Details: ${txUrl}`;
  } catch (err) {
    logger.error(`Failed to generate tweet for ${hash}: ${err.message}`, { stack: err.stack }); // Modified log: Include stack
    const duration = Date.now() - startTime;
    logger.info(`Fallback tweet generated for ${hash} in ${duration}ms`); // Added log
    return `${formattedValue} $${token.toUpperCase()} moved from ${fromName} to ${toName} on ${chainName}.
This whale transfer could signal market shifts.
Details: ${txUrl}`;
  }
}

// Post tweet for large transaction
async function postTweet(transaction, fromName, toName) {
  const startTime = Date.now(); // Added log: Track execution time
  const { chain, hash, block_time } = transaction;
  const chainName = CHAIN_ID_TO_NAME[chain] || chain;
  const { txUrl } = getExplorerUrls(chain, hash);

  const now = new Date();
  const txTime = new Date(block_time);
  const hoursDiff = (now - txTime) / (1000 * 60 * 60);
  if (hoursDiff > 2) {
    logger.info(`Transaction ${hash} is older than 2 hours, skipping`, { hoursDiff }); // Modified log
    return false;
  }

  if (await isTransactionPosted(hash)) {
    logger.info(`Transaction ${hash} already posted, skipping`); // Modified log
    return false;
  }

  const tweetText = await getGeminiResponse(transaction, fromName, toName, chainName, txUrl);
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await v2Client.tweet(tweetText);
      const duration = Date.now() - startTime;
      logger.info(`Posted tweet for transaction ${hash} in ${duration}ms`, { tweetText }); // Modified log
      await savePostedTransaction(hash);
      lastTweetTime = Date.now();
      return true;
    } catch (err) {
      logger.error(`Failed to post tweet for ${hash} (attempt ${attempt}): ${err.message}`, { stack: err.stack }); // Modified log: Include stack
      if (err.response?.status === 429 && attempt < maxRetries) {
        const waitTime = (err.response.headers['x-rate-limit-reset'] ? (parseInt(err.response.headers['x-rate-limit-reset']) * 1000 - Date.now()) + 1000 : attempt * 5000);
        logger.info(`Rate limit hit for ${hash}, waiting ${waitTime / 1000}s`, { attempt }); // Modified log
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        return false;
      }
    }
  }
  return false;
}

// Process tweet queue with 1-hour spacing
async function processTweetQueue() {
  logger.info('Starting tweet queue processor'); // Added log
  while (true) {
    if (tweetQueue.length === 0) {
      logger.info('Tweet queue is empty, waiting 60s', { queueSize: tweetQueue.length }); // Added log
      await new Promise(resolve => setTimeout(resolve, 60000));
      continue;
    }

    const now = Date.now();
    if (now - lastTweetTime >= 3600000) {
      const { transaction, fromName, toName } = tweetQueue.shift();
      logger.info(`Processing tweet from queue for transaction ${transaction.hash}`, { queueSize: tweetQueue.length }); // Added log
      await postTweet(transaction, fromName, toName);
      logger.info(`Tweet queue size after processing: ${tweetQueue.length}`); // Added log
    } else {
      const waitTime = 3600000 - (now - lastTweetTime);
      logger.info(`Waiting ${waitTime / 1000}s before processing next tweet`, { queueSize: tweetQueue.length }); // Modified log
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

// Main bot logic
async function main() {
  const botStartTime = Date.now(); // Added log: Track bot startup time
  logger.info('Starting watchlist bot'); // Added log

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS posted_transactions (
        hash TEXT PRIMARY KEY,
        posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('Ensured posted_transactions table exists'); // Modified log
  } catch (err) {
    logger.error(`Failed to create posted_transactions table: ${err.message}`, { stack: err.stack }); // Modified log: Include stack
    process.exit(1);
  }

  while (true) {
    const loopStartTime = Date.now(); // Added log: Track loop execution time
    logger.info('Starting new watchlist scan cycle'); // Added log
    try {
      await query('DELETE FROM posted_transactions WHERE posted_at < NOW() - INTERVAL \'7 days\'');
      logger.info('Cleaned up old transactions from posted_transactions'); // Modified log

      const watchlist = await getWatchlistAddresses();
      const addresses = watchlist.map(w => w.address);
      logger.info(`Processing ${addresses.length} addresses from watchlist`); // Added log
      const nameTags = await getNameTags(addresses);
      let transactionsInHour = [];

      for (const wallet of watchlist) {
        const transactions = await fetchTransactions(wallet.address);
        logger.info(`Found ${transactions.length} transactions for wallet ${wallet.address}`); // Added log
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
              logger.info(`Added transaction ${tx.hash} to processing list`, { value_usd: tx.value_usd }); // Added log
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 10 * 1000));
      }

      logger.info(`Found ${transactionsInHour.length} qualifying transactions in the last 2 hours`); // Added log
      if (transactionsInHour.length > 0) {
        const txAddresses = new Set();
        transactionsInHour.forEach(tx => {
          if (tx.from && tx.from !== 'None') txAddresses.add(tx.from);
          if (tx.to && tx.to !== 'None') txAddresses.add(tx.to);
        });
        logger.info(`Fetching name tags for ${txAddresses.size} transaction addresses`); // Added log
        const txNameTags = txAddresses.size > 0 ? await getNameTags([...txAddresses]) : {};

        // Process transactions: post first one immediately, queue the rest
        for (let i = 0; i < transactionsInHour.length; i++) {
          const tx = transactionsInHour[i];
          const fromName = txNameTags[tx.from.toLowerCase()] || tx.walletName || 'Unknown wallet';
          const toName = tx.to === 'None' ? 'None' : (txNameTags[tx.to.toLowerCase()] || 'Unknown wallet');
          
          if (i === 0 && (Date.now() - lastTweetTime >= 3600000)) {
            logger.info(`Posting first transaction ${tx.hash} immediately`, { value_usd: tx.value_usd }); // Modified log
            const posted = await postTweet(tx, fromName, toName);
            if (!posted) {
              logger.warn(`Failed to post first transaction ${tx.hash}, adding to queue`, { value_usd: tx.value_usd }); // Modified log
              tweetQueue.push({ transaction: tx, fromName, toName });
              logger.info(`Added transaction ${tx.hash} to tweet queue`, { queueSize: tweetQueue.length }); // Added log
            }
          } else {
            logger.info(`Adding transaction ${tx.hash} with value ${tx.value_usd} USD to tweet queue`, { queueSize: tweetQueue.length + 1 }); // Modified log
            tweetQueue.push({ transaction: tx, fromName, toName });
          }
        }
      } else {
        logger.info('No qualifying transactions found in the last 2 hours'); // Modified log
      }

      const loopDuration = Date.now() - loopStartTime;
      logger.info(`Completed watchlist scan cycle in ${loopDuration}ms, sleeping for 2 hours`, { transactionsFound: transactionsInHour.length, queueSize: tweetQueue.length }); // Modified log
      await new Promise(resolve => setTimeout(resolve, 7200000));
    } catch (err) {
      logger.error(`Main loop error: ${err.message}`, { stack: err.stack }); // Modified log: Include stack
      await new Promise(resolve => setTimeout(resolve, 300000));
    }
  }
}

// Start the bot
main().catch(err => {
  logger.error(`Fatal error: ${err.message}`, { stack: err.stack }); // Modified log: Include stack
  process.exit(1);
});

// Start tweet queue processor
processTweetQueue().catch(err => {
  logger.error(`Tweet queue processor error: ${err.message}`, { stack: err.stack }); // Modified log: Include stack
});

// Added log: Log bot uptime periodically
setInterval(() => {
  const uptime = Date.now() - botStartTime;
  logger.info(`Bot uptime: ${Math.floor(uptime / 1000 / 60)} minutes`, { queueSize: tweetQueue.length }); // Added log
}, 3600000); // Log every hour