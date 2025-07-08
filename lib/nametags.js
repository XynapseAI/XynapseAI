// lib/nametags.js
import { query } from '../utils/postgres.js';
import pkg from '../utils/logger.cjs';
import { isAddress } from 'ethers';

const { logger } = pkg;

/**
 * Loads all nametags from PostgreSQL.
 * @param {boolean} forceReload - Ignored (kept for compatibility).
 * @returns {Promise<object>} An object mapping wallet addresses to their nametag data.
 */
export async function loadAllNametags() {
  try {
    logger.info('Loading nametags from PostgreSQL...');
    const allNametags = {};
    const allNametagsResult = await query(
      `SELECT address, nametag, image, description, subcategory FROM nametags`
    );

    allNametagsResult.rows.forEach(row => {
      allNametags[row.address.toLowerCase()] = {
        address: row.address.toLowerCase(),
        name: row.nametag || 'Unknown',
        image: row.image || '/icons/default.png',
        description: row.description || '',
        subcategory: row.subcategory || 'Others'
      };
    });

    logger.info(`Loaded ${Object.keys(allNametags).length} nametags from PostgreSQL.`);
    return allNametags;
  } catch (error) {
    logger.error(`Error loading nametags from PostgreSQL: ${error.message}`, { stack: error.stack });
    return {};
  }
}

/**
 * Gets a nametag for a wallet address from PostgreSQL.
 * @param {string} walletAddress - The wallet address to look up.
 * @returns {Promise<string|null>} The nametag or null if not found.
 */
export async function getNametag(walletAddress) {
  if (!isAddress(walletAddress)) {
    logger.warn(`Invalid wallet address for getNametag: ${walletAddress}`);
    return null;
  }
  const normalizedAddress = walletAddress.toLowerCase();
  try {
    const result = await query(
      `SELECT nametag FROM nametags WHERE address = $1`,
      [normalizedAddress]
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

/**
 * Adds or updates a nametag for a wallet address in PostgreSQL.
 * @param {string} walletAddress - The wallet address.
 * @param {object} labelsData - The nametag data (name, description, subcategory, image).
 */
export async function addNametag(walletAddress, labelsData) {
  if (!isAddress(walletAddress)) {
    logger.error(`Invalid wallet address for addNametag: ${walletAddress}`);
    return;
  }
  const normalizedAddress = walletAddress.toLowerCase();
  let nameTag = 'Unknown';
  let image = '/icons/default.png';
  let description = '';
  let subcategory = 'Others';

  if (labelsData?.auto_tag) {
    nameTag = labelsData.auto_tag['Name Tag'] || labelsData.auto_tag.name || labelsData.auto_tag.Description || 'Unknown';
    image = labelsData.auto_tag.image || '/icons/default.png';
    description = labelsData.auto_tag.Description || labelsData.auto_tag.description || '';
    subcategory = labelsData.auto_tag.Subcategory || labelsData.auto_tag.subcategory || 'Others';
  } else {
    nameTag = labelsData?.name || labelsData?.nameTag || 'Unknown';
    image = labelsData?.image || labelsData?.imageUrl || '/icons/default.png';
    description = labelsData?.description || '';
    subcategory = labelsData?.subcategory || labelsData?.category || 'Others';
  }

  try {
    await query(
      `INSERT INTO nametags (address, nametag, image, description, subcategory)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (address) DO UPDATE SET
         nametag = EXCLUDED.nametag,
         image = EXCLUDED.image,
         description = EXCLUDED.description,
         subcategory = EXCLUDED.subcategory`,
      [normalizedAddress, nameTag, image, description, subcategory]
    );
    logger.info(`Added/Updated nametag for ${normalizedAddress}: ${nameTag}`);
  } catch (error) {
    logger.error(`Error adding nametag for ${normalizedAddress}: ${error.message}`, { stack: error.stack });
  }
}

/**
 * Fetches nametags for multiple addresses in a single query.
 * @param {string[]} addresses - Array of wallet addresses.
 * @returns {Promise<object>} An object mapping addresses to their nametag data.
 */
export async function getNametagsBatch(addresses) {
  const normalizedAddresses = addresses.map(addr => addr.toLowerCase()).filter(isAddress);
  const foundNametags = {};

  if (normalizedAddresses.length === 0) {
    logger.info('No valid addresses provided for batch nametag fetch.');
    return foundNametags;
  }

  try {
    const batchSize = 100; // Tăng batch size để tối ưu
    for (let i = 0; i < normalizedAddresses.length; i += batchSize) {
      const batchAddresses = normalizedAddresses.slice(i, i + batchSize);
      logger.info(`Fetching nametags for batch of ${batchAddresses.length} addresses: ${batchAddresses.join(', ')}`);

      const result = await query(
        `SELECT address, nametag, image, description, subcategory
         FROM nametags
         WHERE address = ANY($1)`,
        [batchAddresses]
      );

      result.rows.forEach(row => {
        foundNametags[row.address.toLowerCase()] = {
          address: row.address.toLowerCase(),
          name: row.nametag || 'Unknown',
          image: row.image || '/icons/default.png',
          description: row.description || '',
          subcategory: row.subcategory || 'Others'
        };
      });
    }

    // Gán mặc định cho các địa chỉ không tìm thấy
    normalizedAddresses.forEach(addr => {
      if (!foundNametags[addr]) {
        foundNametags[addr] = {
          address: addr,
          name: 'Unknown',
          image: '/icons/default.png',
          description: '',
          subcategory: 'Others'
        };
      }
    });

    logger.info(`Fetched ${Object.keys(foundNametags).length} nametags from PostgreSQL for batch request.`);
    return foundNametags;
  } catch (error) {
    logger.error(`Error fetching batch nametags from PostgreSQL: ${error.message}`, { stack: error.stack });
    return normalizedAddresses.reduce((acc, addr) => ({
      ...acc,
      [addr]: {
        address: addr,
        name: 'Unknown',
        image: '/icons/default.png',
        description: '',
        subcategory: 'Others'
      }
    }), {});
  }
}