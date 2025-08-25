import axios from 'axios';
import { TwitterApi } from 'twitter-api-v2';
import winston from 'winston';
import dotenv from 'dotenv';
import axiosRetry from 'axios-retry';
import { getExplorerUrls, CHAIN_ID_TO_NAME } from '../utils/constants.js';

// Configure axios-retry for API requests (Dune Sim and Nametags)
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => Math.min(retryCount * 1000, 5000),
  retryCondition: (error) => error.response?.status === 429 || error.code === 'ECONNABORTED',
  onRetry: (retryCount, error) => {
    logger?.warn?.(`Retrying API request (attempt ${retryCount})`, {
      status: error.response?.status,
      message: error.message,
    });
  },
});

// Load .env file explicitly
dotenv.config({ path: 'C:/Users/nnn/Desktop/Next/.env' });

// Debug: Check environment variables
console.log('DATABASE_URL:', process.env.DATABASE_URL);
console.log('API_BASE_URL:', process.env.API_BASE_URL);
console.log('SIM_API_KEY:', process.env.SIM_API_KEY);
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY);
console.log('TWITTER_CONSUMER_KEY:', process.env.TWITTER_CONSUMER_KEY ? 'Set' : 'Not set');

if (!process.env.DATABASE_URL) {
  console.error('Error: DATABASE_URL is not loaded from .env. Check file path and content.');
  process.exit(1);
}
if (!process.env.API_BASE_URL) {
  console.error('Error: API_BASE_URL is not loaded from .env. Check file path and content.');
  process.exit(1);
}
if (!process.env.SIM_API_KEY) {
  console.error('Error: SIM_API_KEY is not loaded from .env. Check file path and content.');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY is not loaded from .env. Check file path and content.');
  process.exit(1);
}
if (!process.env.TWITTER_CONSUMER_KEY || !process.env.TWITTER_CONSUMER_SECRET ||
  !process.env.TWITTER_ACCESS_TOKEN || !process.env.TWITTER_ACCESS_TOKEN_SECRET) {
  console.error('Error: Twitter API credentials are not loaded from .env. Check file path and content.');
  process.exit(1);
}

// Configure logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} - ${level}: ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/bot.log' }),
    new winston.transports.Console()
  ]
});

// Twitter client configuration for v2
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_CONSUMER_KEY,
  appSecret: process.env.TWITTER_CONSUMER_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});
const v2Client = twitterClient.v2;

// Dynamic import for postgres.js after dotenv
const { query } = await import('../utils/postgres.js');

// Track last tweet time
let lastTweetTime = 0;

// Fetch watchlist addresses from database
async function getWatchlistAddresses() {
  try {
    const result = await query('SELECT wallet_address, name FROM watchlists');
    logger.info(`Fetched ${result.rows.length} wallet addresses from watchlist`);
    return result.rows.map(row => ({
      address: row.wallet_address,
      name: row.name || 'Unnamed Wallet'
    }));
  } catch (err) {
    logger.error(`Error fetching watchlist: ${err.message}`, { stack: err.stack });
    throw err;
  }
}

// Fetch name tags for addresses
async function getNameTags(addresses) {
  try {
    const url = `${process.env.API_BASE_URL}/api/nametags`;
    logger.info(`Calling nametags API: ${url} with ${addresses.length} addresses`);
    const response = await axios.post(url, { addresses }, {
      headers: {
        'Content-Type': 'application/json',
        'Origin': process.env.API_BASE_URL,
        'Authorization': `Bearer ${process.env.SIM_API_KEY}`,
      },
      timeout: 10000
    });

    if (!response.data.success || !response.data.data) {
      logger.warn(`Invalid response from nametags API: ${JSON.stringify(response.data)}`);
      return {};
    }

    const nameTags = response.data.data || {};
    const result = Object.keys(nameTags).reduce((acc, addr) => {
      const nameTag = nameTags[addr]?.Labels?.deposit?.['Name Tag'] || 'Unknown wallet';
      acc[addr.toLowerCase()] = nameTag;
      logger.info(`Name tag for ${addr}: ${nameTag}`);
      return acc;
    }, {});

    logger.info(`Successfully fetched ${Object.keys(result).length} name tags`);
    return result;
  } catch (err) {
    logger.error(`Error fetching name tags: ${err.message}`, {
      stack: err.stack,
      url: `${process.env.API_BASE_URL}/api/nametags`,
      response: err.response ? err.response.data : null
    });
    return {};
  }
}

// Fetch transactions for an address using Dune Sim API
async function fetchTransactions(address) {
  try {
    const url = `${process.env.API_BASE_URL}/api/sim`;
    logger.info(`Calling transactions API: ${url} for address ${address}`);
    const response = await axios.post(url, {
      action: 'transactions',
      address,
      minValueUsd: 50_000_000
    }, {
      headers: {
        'X-Sim-Api-Key': process.env.SIM_API_KEY,
        'Authorization': `Bearer ${process.env.SIM_API_KEY}`,
        'Content-Type': 'application/json',
        'Origin': process.env.API_BASE_URL
      },
      timeout: 15000
    });

    if (!response.data.success || !response.data.data) {
      logger.warn(`Invalid response from transactions API: ${JSON.stringify(response.data)}`);
      return [];
    }

    logger.info(`Fetched ${response.data.data.length} transactions for address ${address}`);
    return response.data.data;
  } catch (err) {
    logger.error(`Error fetching transactions for ${address}: ${err.message}`, {
      stack: err.stack,
      url: `${process.env.API_BASE_URL}/api/sim`,
      response: err.response ? err.response.data : null
    });
    return [];
  }
}

// Check if transaction was already posted
async function isTransactionPosted(hash) {
  try {
    const result = await query('SELECT 1 FROM posted_transactions WHERE hash = $1', [hash]);
    return result.rows.length > 0;
  } catch (err) {
    logger.error(`Error checking posted transaction ${hash}: ${err.message}`, { stack: err.stack });
    return false;
  }
}

// Save posted transaction to database
async function savePostedTransaction(hash) {
  try {
    await query('INSERT INTO posted_transactions (hash) VALUES ($1)', [hash]);
    logger.info(`Saved transaction ${hash} to posted_transactions`);
  } catch (err) {
    logger.error(`Error saving posted transaction ${hash}: ${err.message}`, { stack: err.stack });
  }
}

// Call Gemini API to generate tweet content
async function getGeminiResponse(transaction, fromName, toName, chainName, txUrl) {
  const { chain, hash, from, to, value, token, block_time } = transaction;
  const currentDate = new Date().toISOString().split('T')[0];
  // Format number with thousand separators (e.g., 500000000 -> 500.000.000)
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
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';
    logger.info(`Calling Gemini API for transaction ${hash}`);
    const response = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY
      },
      timeout: 10000
    });

    const content = response.data.candidates[0].content.parts[0].text;
    if (content && content.length <= 280) {
      logger.info(`Generated tweet content for ${hash}: ${content}`);
      return content;
    } else {
      logger.warn(`Gemini response too long (${content?.length || 0} chars), using fallback`);
      return `${formattedValue} $${token.toUpperCase()} moved from ${fromName} to ${toName} on ${chainName}.
This whale transfer could signal market shifts.
Details: ${txUrl}`;
    }
  } catch (err) {
    logger.error(`Error calling Gemini API for ${hash}: ${err.message}`, {
      stack: err.stack,
      response: err.response ? err.response.data : null
    });
    return `${formattedValue} $${token.toUpperCase()} moved from ${fromName} to ${toName} on ${chainName}.
This whale transfer could signal market shifts.
Details: ${txUrl}`;
  }
}

// Post tweet for large transaction with retry logic
async function postTweet(transaction, fromName, toName) {
  const { chain, hash, block_time } = transaction;
  const chainName = CHAIN_ID_TO_NAME[chain] || chain;
  const { txUrl } = getExplorerUrls(chain, hash);

  // Check if transaction is within the last 72 hours
  const now = new Date();
  const txTime = new Date(block_time);
  const hoursDiff = (now - txTime) / (1000 * 60 * 60);
  if (hoursDiff > 72) {
    logger.info(`Transaction ${hash} is older than 72 hours, skipping`);
    return;
  }

  // Check if transaction was already posted
  if (await isTransactionPosted(hash)) {
    logger.info(`Transaction ${hash} already posted, skipping`);
    return;
  }

  const tweetText = await getGeminiResponse(transaction, fromName, toName, chainName, txUrl);
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await v2Client.tweet(tweetText);
      logger.info(`Posted tweet for transaction ${hash}: ${tweetText}`);
      await savePostedTransaction(hash);
      lastTweetTime = Date.now(); // update last tweet timestamp
      return;
    } catch (err) {
      logger.error(`Error posting tweet for ${hash} (attempt ${attempt}): ${err.message}`, {
        stack: err.stack,
        response: err.response ? err.response.data : null
      });
      if (err.response?.status === 429 && attempt < maxRetries) {
        const resetTime = err.response.headers['x-rate-limit-reset'];
        if (resetTime) {
          const waitTime = (parseInt(resetTime) * 1000 - Date.now()) + 1000;
          logger.info(`Rate limit hit for transaction ${hash}, waiting ${waitTime / 1000}s before retry`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          logger.warn(`No rate limit reset header, waiting ${attempt * 5}s before retry`);
          await new Promise(resolve => setTimeout(resolve, attempt * 5000));
        }
      } else {
        logger.error(`Failed to post tweet for ${hash} after ${attempt} attempts`);
        break;
      }
    }
  }
}

// Main bot logic
async function main() {
  // Create posted_transactions table if not exists
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS posted_transactions (
        hash TEXT PRIMARY KEY,
        posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('Ensured posted_transactions table exists');
  } catch (err) {
    logger.error(`Error creating posted_transactions table: ${err.message}`, { stack: err.stack });
    process.exit(1);
  }

  while (true) {
    try {
      const watchlist = await getWatchlistAddresses();
      const addresses = watchlist.map(w => w.address);
      const nameTags = await getNameTags(addresses);
      let transactionsInHour = [];

      // Collect transactions for all addresses
      for (const wallet of watchlist) {
        const transactions = await fetchTransactions(wallet.address);
        for (const tx of transactions) {
          if (tx.value_usd >= 50_000_000) {
            const txTime = new Date(tx.block_time);
            const now = new Date();
            const hoursDiff = (now - txTime) / (1000 * 60 * 60);
            if (hoursDiff <= 1 && !await isTransactionPosted(tx.hash)) {
              transactionsInHour.push({
                ...tx,
                walletName: wallet.name || 'Unnamed Wallet'
              });
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 10 * 1000)); // Wait 10s between addresses
      }

      // Find the transaction with the highest USD value
      if (transactionsInHour.length > 0) {
        const largestTx = transactionsInHour.reduce((max, tx) =>
          tx.value_usd > max.value_usd ? tx : max, transactionsInHour[0]);

        const txAddresses = [largestTx.from, largestTx.to].filter(addr => addr && addr !== 'None');
        const txNameTags = txAddresses.length > 0 ? await getNameTags(txAddresses) : {};
        const fromName = txNameTags[largestTx.from.toLowerCase()] || largestTx.walletName || 'Unknown wallet';
        const toName = largestTx.to === 'None' ? 'None' : (txNameTags[largestTx.to.toLowerCase()] || 'Unknown wallet');

        logger.info(`Selected largest transaction ${largestTx.hash} with value ${largestTx.value_usd} USD`);
        await postTweet(largestTx, fromName, toName);
      } else {
        logger.info('No qualifying transactions found in the last hour');
      }

      logger.info('Completed watchlist scan, sleeping for 1 hour');
      await new Promise(resolve => setTimeout(resolve, 3600000)); // Sleep 1h
    } catch (err) {
      logger.error(`Main loop error: ${err.message}`, { stack: err.stack });
      await new Promise(resolve => setTimeout(resolve, 300000)); // Wait 5 min on error
    }
  }
}

// Start the bot
main().catch(err => {
  logger.error(`Fatal error: ${err.message}`, { stack: err.stack });
  process.exit(1);
});