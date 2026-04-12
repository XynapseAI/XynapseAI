// lib/nametags.js
import { query } from '../utils/postgres.js';
import { logger } from '../utils/serverLogger.js';
import { isAddress } from 'ethers';

// Bitcoin address validation
const isBitcoinAddress = (addr) => {
  const p2pkh = /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/;
  const p2sh = /^3[1-9A-HJ-NP-Za-km-z]{25,34}$/;
  const bech32 = /^bc1[a-z0-9]{39,59}$/;
  return p2pkh.test(addr) || p2sh.test(addr) || bech32.test(addr);
};

// Solana address validation
const isSolanaAddress = (addr) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);

export const isValidAddress = (addr) => isAddress(addr) || isBitcoinAddress(addr) || isSolanaAddress(addr);

async function withRetry(operation, maxAttempts = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (e) {
      if (attempt === maxAttempts) throw e;
      logger.warn(`Attempt ${attempt} failed: ${e.message}. Retrying after ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function loadAllNametags(limit = 1000, offset = 0) {
  try {
    logger.info(`Loading up to ${limit} nametags from PostgreSQL (offset: ${offset})...`);
    const allNametags = {};
    const allNametagsResult = await withRetry(() =>
      query(
        `SELECT LOWER(address) as addr_lower, nametag, image, description, subcategory
         FROM nametags
         ORDER BY LOWER(address)
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      )
    );

    allNametagsResult.rows.forEach((row) => {
      allNametags[row.addr_lower] = {
        address: row.addr_lower,
        name: row.nametag || 'Unknown',
        image: row.image || '/icons/default.webp',
        description: row.description || '',
        subcategory: row.subcategory || 'Others',
      };
    });

    logger.info(`Loaded ${Object.keys(allNametags).length} nametags from PostgreSQL.`);
    return allNametags;
  } catch (error) {
    logger.error(`Error loading nametags from PostgreSQL: ${error.message}`, { stack: error.stack });
    return {};
  }
}

export async function getNametag(walletAddress) {
  if (!isValidAddress(walletAddress)) {
    logger.warn(`Invalid wallet address for getNametag: ${walletAddress}`);
    return null;
  }
  const normalizedAddress = walletAddress.toLowerCase();
  try {
    const result = await withRetry(() =>
      query(`SELECT nametag FROM nametags WHERE LOWER(address) = $1`, [normalizedAddress])
    );
    if (result.rows.length > 0) {
      const nametag = result.rows[0].nametag || 'Unknown';
      logger.info(`Found nametag for ${normalizedAddress}: ${nametag}`);
      return nametag;
    }
    logger.info(`No nametag found for ${normalizedAddress} in PostgreSQL.`);
    return null;
  } catch (error) {
    logger.error(`Error fetching nametag for ${normalizedAddress}: ${error.message}`, { stack: error.stack });
    return null;
  }
}

export async function addNametag(walletAddress, labelsData) {
  if (!isValidAddress(walletAddress)) {
    logger.error(`Invalid wallet address for addNametag: ${walletAddress}`);
    return;
  }
  const normalizedAddress = walletAddress.toLowerCase();
  const nameTag = labelsData?.name || labelsData?.auto_tag?.name || labelsData?.auto_tag?.['Name Tag'] || 'Unknown';
  const image = labelsData?.image || labelsData?.auto_tag?.image || '/icons/default.webp';
  const description = labelsData?.description || labelsData?.auto_tag?.description || labelsData?.auto_tag?.Description || '';
  const subcategory = labelsData?.subcategory || labelsData?.auto_tag?.subcategory || labelsData?.auto_tag?.Subcategory || 'Others';

  try {
    await withRetry(() =>
      query(
        `INSERT INTO nametags (address, nametag, image, description, subcategory)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (address) DO UPDATE SET          -- ← ĐÃ SỬA Ở ĐÂY
           nametag = EXCLUDED.nametag,
           image = EXCLUDED.image,
           description = EXCLUDED.description,
           subcategory = EXCLUDED.subcategory`,
        [normalizedAddress, nameTag, image, description, subcategory]
      )
    );
    logger.info(`✅ Added/Updated nametag for ${normalizedAddress}: ${nameTag}`);
  } catch (error) {
    logger.error(`Error adding nametag for ${normalizedAddress}: ${error.message}`, { stack: error.stack });
  }
}

export async function getNametagsBatch(addresses) {
  const normalizedAddresses = addresses
    .filter(addr => isValidAddress(addr))
    .map(addr => addr.toLowerCase());
  const foundNametags = {};

  if (normalizedAddresses.length === 0) {
    logger.info('No valid addresses provided for batch nametag fetch.');
    return foundNametags;
  }

  try {
    const batchSize = 50;
    for (let i = 0; i < normalizedAddresses.length; i += batchSize) {
      const batchAddresses = normalizedAddresses.slice(i, i + batchSize);
      logger.info(`Fetching nametags for batch of ${batchAddresses.length} addresses: ${batchAddresses.join(', ')}`);

      const result = await withRetry(() =>
        query(
          `SELECT LOWER(address) as addr_lower, nametag, image, description, subcategory
           FROM nametags
           WHERE LOWER(address) = ANY($1)`,
          [batchAddresses]
        )
      );

      result.rows.forEach((row) => {
        foundNametags[row.addr_lower] = {
          address: row.addr_lower,
          name: row.nametag || 'Unknown',
          image: row.image || '/icons/default.webp',
          description: row.description || '',
          subcategory: row.subcategory || 'Others',
        };
      });
    }

    normalizedAddresses.forEach((addr) => {
      if (!foundNametags[addr]) {
        foundNametags[addr] = {
          address: addr,
          name: 'Unknown',
          image: '/icons/default.webp',
          description: '',
          subcategory: 'Others',
        };
      }
    });

    logger.info(`Fetched ${Object.keys(foundNametags).length} nametags from PostgreSQL for batch request.`);
    return foundNametags;
  } catch (error) {
    logger.error(`Error fetching batch nametags from PostgreSQL: ${error.message}`, { stack: error.stack });
    return normalizedAddresses.reduce(
      (acc, addr) => ({
        ...acc,
        [addr]: {
          address: addr,
          name: 'Unknown',
          image: '/icons/default.webp',
          description: '',
          subcategory: 'Others',
        },
      }),
      {}
    );
  }
}