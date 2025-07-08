// cron-worker/index.js
import 'dotenv/config';
import { getHighVolumeWallets } from '../lib/analysisStorage.js';
import { loadAllNametags } from '../lib/nametags.js'; // Still imported but not called with force reload
import pkg from '../utils/logger.cjs';
import { query } from '../utils/postgres.js';
import axios from 'axios';
import fs from 'fs/promises';
import { isAddress } from 'ethers';
import { fetchBlockchainData } from '../lib/blockchainData.js';
import path from 'path';
import crypto from 'crypto';

const { logger } = pkg;
const ANALYZE_WALLETS_API_URL = process.env.ANALYZE_WALLETS_API_URL || (process.env.NEXTAUTH_URL + '/api/analyze-wallets');
const WALLET_FILE_PATH = process.env.WALLET_FILE_PATH
  ? path.resolve(process.env.WALLET_FILE_PATH)
  : path.resolve(process.cwd(), 'cron-worker/wallets.json');
const MAX_WALLETS_PER_RUN = 200;
const DEFAULT_ETH_PRICE_USD = 2000;
const PRICE_CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const API_KEY_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const CRON_USER_AGENT = 'CronWorker/1.0';
const HMAC_SECRET = process.env.HMAC_SECRET || crypto.randomBytes(32).toString('hex');
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;

async function generateApiKey() {
  try {
    const apiKey = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + API_KEY_DURATION_MS);
    await query(
      `INSERT INTO api_keys (api_key, created_at, expires_at, active)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (api_key) DO NOTHING`,
      [apiKey, new Date(), expiresAt, true]
    );
    logger.info(`Generated new API key: ${apiKey}, expires at ${expiresAt}`);
    return apiKey;
  } catch (error) {
    logger.error(`Error generating API key: ${error.message}`, { stack: error.stack });
    return null;
  }
}

async function getValidApiKey() {
  try {
    const result = await query(
      `SELECT api_key FROM api_keys
       WHERE active = true AND expires_at >= CURRENT_TIMESTAMP
       LIMIT 1`
    );
    if (result.rows.length > 0) {
      const apiKey = result.rows[0].api_key;
      logger.info(`Using existing API key: ${apiKey}`);
      return apiKey;
    }

    logger.info('No valid API key found, generating new one...');
    return await generateApiKey() || INTERNAL_API_TOKEN;
  } catch (error) {
    logger.error(`Error getting valid API key: ${error.message}`, { stack: error.stack });
    return INTERNAL_API_TOKEN || null;
  }
}

function generateHmacSignature(payload, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
}

async function readWalletFile() {
  try {
    logger.info(`Attempting to read wallet file at: ${WALLET_FILE_PATH}`);
    const absolutePath = path.resolve(WALLET_FILE_PATH);
    await fs.access(absolutePath, fs.constants.F_OK);
    const fileContent = await fs.readFile(absolutePath, 'utf-8');
    let wallets = [];
    if (WALLET_FILE_PATH.endsWith('.json')) {
      wallets = JSON.parse(fileContent);
    } else if (WALLET_FILE_PATH.endsWith('.csv')) {
      const lines = fileContent.trim().split('\n');
      const headers = lines[0].split(',');
      wallets = lines.slice(1).map(line => {
        const [address, name] = line.split(',');
        return { address, name };
      });
    } else {
      throw new Error('Unsupported file format. Use JSON or CSV.');
    }
    const validWallets = wallets
      .filter(wallet => isAddress(wallet.address))
      .map(wallet => ({
        address: wallet.address.toLowerCase(),
        name: wallet.name || 'Unknown'
      }));
    if (validWallets.length === 0) {
      logger.warn('No valid wallet addresses found in the file.');
    } else {
      logger.info(`Loaded ${validWallets.length} valid wallet addresses from ${WALLET_FILE_PATH}: ${validWallets.map(w => w.address).join(', ')}`);
    }
    return validWallets;
  } catch (error) {
    logger.error(`Error reading wallet file ${WALLET_FILE_PATH}: ${error.message}`, { stack: error.stack });
    return [];
  }
}

async function findDepositWallets(primaryWallets, chain = 'ethereum', txLimit = 500) {
  const depositWallets = [];
  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  for (const primaryWallet of primaryWallets) {
    logger.info(`Fetching transactions for primary wallet ${primaryWallet.address} (${primaryWallet.name}) to find deposit wallets...`);
    const txData = await fetchBlockchainData(primaryWallet.address, 'transactions', true, txLimit, chain);
    if (!txData || txData.length === 0) {
      logger.info(`No transactions found for primary wallet ${primaryWallet.address}.`);
      continue;
    }

    const recentIncomingTxs = txData.filter(tx => {
      try {
        return tx.to.toLowerCase() === primaryWallet.address.toLowerCase() && new Date(tx.block_time) >= last24Hours;
      } catch {
        logger.warn(`Invalid block_time for tx in wallet ${primaryWallet.address}: ${tx.block_time}. Skipping.`);
        return false;
      }
    });

    recentIncomingTxs.forEach(tx => {
      if (isAddress(tx.from)) {
        depositWallets.push({
          address: tx.from.toLowerCase(),
          primaryWallet: primaryWallet.address.toLowerCase(),
          primaryWalletName: primaryWallet.name
        });
      }
    });
    logger.info(`Found ${recentIncomingTxs.length} incoming transactions within last 24 hours for ${primaryWallet.address}, added ${recentIncomingTxs.length} deposit wallets.`);
  }

  const uniqueDepositWallets = Array.from(new Map(depositWallets.map(w => [w.address, w])).values());
  logger.info(`Total unique deposit wallets found: ${uniqueDepositWallets.length}`);
  return uniqueDepositWallets;
}

async function getPendingWallets() {
  try {
    const result = await query(
      `SELECT address, primary_wallet, primary_wallet_name, timestamp
       FROM pending_wallets_to_analyze
       ORDER BY timestamp ASC`
    );
    const pendingWallets = result.rows.map(row => ({
      address: row.address.toLowerCase(),
      primaryWallet: row.primary_wallet.toLowerCase(),
      primaryWalletName: row.primary_wallet_name
    }));
    logger.info(`Loaded ${pendingWallets.length} pending wallets from PostgreSQL.`);
    return pendingWallets;
  } catch (error) {
    logger.error(`Error fetching pending wallets from PostgreSQL: ${error.message}`, { stack: error.stack });
    return [];
  }
}

async function savePendingWallets(wallets) {
  try {
    for (const wallet of wallets) {
      await query(
        `INSERT INTO pending_wallets_to_analyze (address, primary_wallet, primary_wallet_name, timestamp)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (address) DO NOTHING`,
        [wallet.address, wallet.primaryWallet, wallet.primaryWalletName, new Date()]
      );
    }
    logger.info(`Saved ${wallets.length} pending wallets to PostgreSQL.`);
  } catch (error) {
    logger.error(`Error saving pending wallets to PostgreSQL: ${error.message}`, { stack: error.stack });
  }
}

async function deletePendingWallet(address) {
  try {
    await query(
      `DELETE FROM pending_wallets_to_analyze WHERE address = $1`,
      [address.toLowerCase()]
    );
    logger.info(`Deleted pending wallet ${address} from PostgreSQL.`);
  } catch (error) {
    logger.error(`Error deleting pending wallet ${address} from PostgreSQL: ${error.message}`, { stack: error.stack });
  }
}

async function getEthPrice() {
  try {
    const result = await query(
      `SELECT price, timestamp FROM eth_price WHERE id = 'current'`
    );
    const now = Date.now();
    if (result.rows.length > 0) {
      const { price, timestamp } = result.rows[0];
      if (now - new Date(timestamp).getTime() < PRICE_CACHE_DURATION_MS) {
        logger.info(`Using cached ETH price: $${price}`);
        return price;
      }
    }

    logger.info('Fetching ETH price from CoinGecko...');
    const priceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', {
      headers: { 'x-cg-api-key': process.env.COINGECKO_API_KEY },
      timeout: 10000
    });
    const newPrice = priceResponse.data.ethereum.usd;
    await query(
      `INSERT INTO eth_price (id, price, timestamp)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         price = EXCLUDED.price,
         timestamp = EXCLUDED.timestamp`,
      ['current', newPrice, new Date()]
    );
    logger.info(`Fetched and cached ETH price: $${newPrice}`);
    return newPrice;
  } catch (error) {
    logger.warn(`Failed to fetch or save ETH price: ${error.message}. Using default: $${DEFAULT_ETH_PRICE_USD}`);
    return DEFAULT_ETH_PRICE_USD;
  }
}

async function withRetry(operation, maxAttempts = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (e) {
      if (attempt === maxAttempts) {
        throw e;
      }
      logger.warn(`Attempt ${attempt} failed: ${e.message}. Retrying after ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

async function runHighVolumeWalletAnalysis() {
  logger.info('Cron job started at: ' + new Date().toISOString());
  logger.info(`Environment variables - ANALYZE_WALLETS_API_URL: ${ANALYZE_WALLETS_API_URL}, WALLET_FILE_PATH: ${WALLET_FILE_PATH}`);

  if (!ANALYZE_WALLETS_API_URL) {
    logger.error('Missing environment variable: ANALYZE_WALLETS_API_URL or NEXTAUTH_URL');
    return;
  }

  try {
    // Step 1: Removed automatic nametag loading
    logger.info('Skipping automatic nametag loading. Using existing nametags in PostgreSQL.');

    // Step 2: Get or create API key
    const apiKey = await getValidApiKey();
    if (!apiKey) {
      logger.error('Failed to get or generate API key. Aborting cron job.');
      return;
    }
    logger.info(`Using API key: ${apiKey}`);

    // Step 3: Get ETH price
    const currentEthPriceUsd = await getEthPrice();
    logger.info(`Using ETH price $${currentEthPriceUsd} for all analyses.`);

    // Step 4: Read wallets from file (Primary Wallets)
    logger.info('Reading primary wallets from file...');
    const primaryWallets = await readWalletFile();
    if (primaryWallets.length === 0) {
      logger.warn('No primary wallets to analyze. Skipping to high-volume wallets.');
    }

    // Step 5: Find and analyze Secondary Wallets (deposit wallets sending to primary wallets in last 24h)
    let walletsToAnalyze = [];
    if (primaryWallets.length > 0) {
      logger.info('Finding deposit wallets (Secondary Wallets) sending to primary wallets...');
      const depositWallets = await findDepositWallets(primaryWallets);
      const pendingWallets = await getPendingWallets();

      // Combine new secondary wallets and unanalyzed secondary wallets
      const allDepositWallets = [...pendingWallets, ...depositWallets].filter(
        (v, i, a) => a.findIndex(t => t.address === v.address) === i
      );

      // Select up to MAX_WALLETS_PER_RUN wallets for analysis
      walletsToAnalyze = allDepositWallets.slice(0, MAX_WALLETS_PER_RUN);
      const remainingWallets = allDepositWallets.slice(MAX_WALLETS_PER_RUN);

      // Save unanalyzed wallets to PostgreSQL
      if (remainingWallets.length > 0) {
        await savePendingWallets(remainingWallets);
      }

      logger.info(`Selected ${walletsToAnalyze.length} deposit wallets to analyze: ${walletsToAnalyze.map(w => w.address).join(', ')}`);
    }

    // Step 6: Analyze Secondary Wallets
    if (walletsToAnalyze.length > 0) {
      logger.info('Triggering analysis for deposit wallets (Secondary Wallets)...');
      for (const wallet of walletsToAnalyze) {
        try {
          const identifyPayload = {
            action: 'identify',
            wallet_address: wallet.address,
            chain: 'ethereum',
            primary_target_wallet: wallet.primaryWallet,
            eth_price_usd: currentEthPriceUsd
          };
          const identifySignature = generateHmacSignature(identifyPayload, HMAC_SECRET);

          logger.info(`Sending identify request for deposit wallet: ${wallet.address} (to ${wallet.primaryWalletName})`);
          const identifyResponse = await withRetry(() =>
            axios.post(ANALYZE_WALLETS_API_URL, identifyPayload, {
              headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
                'X-HMAC-Signature': identifySignature,
                'User-Agent': CRON_USER_AGENT
              },
              timeout: 120000
            })
          );
          logger.info(`Identify response for deposit wallet ${wallet.address}: ${JSON.stringify(identifyResponse.data)}`);

          const largeFlowPayload = {
            action: 'detect-large-flow',
            wallet_address: wallet.address,
            chain: 'ethereum',
            eth_price_usd: currentEthPriceUsd
          };
          const largeFlowSignature = generateHmacSignature(largeFlowPayload, HMAC_SECRET);

          logger.info(`Sending detect-large-flow request for deposit wallet: ${wallet.address}`);
          const largeFlowResponse = await withRetry(() =>
            axios.post(ANALYZE_WALLETS_API_URL, largeFlowPayload, {
              headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
                'X-HMAC-Signature': largeFlowSignature,
                'User-Agent': CRON_USER_AGENT
              },
              timeout: 120000
            })
          );
          logger.info(`Large flow response for deposit wallet ${wallet.address}: ${JSON.stringify(largeFlowResponse.data)}`);

          // Remove wallet from pending_wallets_to_analyze after analysis
          await deletePendingWallet(wallet.address);
        } catch (apiError) {
          logger.error(`Error analyzing deposit wallet ${wallet.address}: ${apiError.message}`, { stack: apiError.stack });
          if (apiError.response) {
            logger.error(`Response details: ${JSON.stringify(apiError.response.data)}`);
          }
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } else {
      logger.info('No deposit wallets to analyze. Proceeding to high-volume wallets.');
    }

    // Step 7: Analyze high-volume wallets
    logger.info('Fetching high-volume wallets...');
    const highVolumeWallets = await getHighVolumeWallets(
      'ethereum', 200, 500, 20, 1000, 50
    );
    if (highVolumeWallets.length === 0) {
      logger.warn('No high-volume wallets found.');
    } else {
      logger.info(`Found ${highVolumeWallets.length} high-volume wallets: ${highVolumeWallets.join(', ')}`);
    }

    logger.info('Triggering wallet analysis for high-volume wallets...');
    for (const wallet of highVolumeWallets) {
      try {
        const identifyPayload = {
          action: 'identify',
          wallet_address: wallet,
          chain: 'ethereum',
          primary_target_wallet: wallet,
          eth_price_usd: currentEthPriceUsd
        };
        const identifySignature = generateHmacSignature(identifyPayload, HMAC_SECRET);

        logger.info(`Sending identify request for high-volume wallet: ${wallet}`);
        const identifyResponse = await withRetry(() =>
          axios.post(ANALYZE_WALLETS_API_URL, identifyPayload, {
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey,
              'X-HMAC-Signature': identifySignature,
              'User-Agent': CRON_USER_AGENT
            },
            timeout: 120000
          })
        );
        logger.info(`Identify response for high-volume wallet ${wallet}: ${JSON.stringify(identifyResponse.data)}`);

        const largeFlowPayload = {
          action: 'detect-large-flow',
          wallet_address: wallet,
          chain: 'ethereum',
          eth_price_usd: currentEthPriceUsd
        };
        const largeFlowSignature = generateHmacSignature(largeFlowPayload, HMAC_SECRET);

        logger.info(`Sending detect-large-flow request for high-volume wallet: ${wallet}`);
        const largeFlowResponse = await withRetry(() =>
          axios.post(ANALYZE_WALLETS_API_URL, largeFlowPayload, {
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey,
              'X-HMAC-Signature': largeFlowSignature,
              'User-Agent': CRON_USER_AGENT
            },
            timeout: 120000
          })
        );
        logger.info(`Large flow response for high-volume wallet ${wallet}: ${JSON.stringify(largeFlowResponse.data)}`);
      } catch (apiError) {
        logger.error(`Error analyzing high-volume wallet ${wallet}: ${apiError.message}`, { stack: apiError.stack });
        if (apiError.response) {
          logger.error(`Response details: ${JSON.stringify(apiError.response.data)}`);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.info('Cron job finished at: ' + new Date().toISOString());
  } catch (error) {
    logger.error(`Cron job failed: ${error.message}`, { stack: error.stack });
  }
}

runHighVolumeWalletAnalysis().catch(error => {
  logger.error(`Cron job execution failed: ${error.message}`, { stack: error.stack });
  process.exit(1);
});