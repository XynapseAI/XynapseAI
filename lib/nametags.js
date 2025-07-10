import { query } from '../utils/postgres.js';
import pkg from '../utils/logger.cjs';
import { isAddress } from 'ethers';

const { logger } = pkg;

/**
 * Retries an operation with exponential backoff.
 * @param {Function} operation - The async operation to retry.
 * @param {number} maxAttempts - Maximum number of attempts.
 * @param {number} delayMs - Delay between attempts in milliseconds.
 * @returns {Promise<any>} The result of the operation.
 */
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

/**
 * Loads all nametags from PostgreSQL with optional pagination.
 * @param {number} [limit=1000] - Maximum number of nametags to load.
 * @param {number} [offset=0] - Offset for pagination.
 * @returns {Promise<object>} An object mapping wallet addresses to their nametag data.
 */
export async function loadAllNametags(limit = 1000, offset = 0) {
  try {
    logger.info(`Loading up to ${limit} nametags from PostgreSQL (offset: ${offset})...`);
    const allNametags = {};
    const allNametagsResult = await withRetry(() =>
      query(
        `SELECT address, nametag, image, description, subcategory, is_deposit, deposit_confidence_percentage, reason, metrics, gemini_analysis, last_analysis, created_at
         FROM nametags
         ORDER BY address
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      )
    );

    allNametagsResult.rows.forEach(row => {
      allNametags[row.address.toLowerCase()] = {
        address: row.address.toLowerCase(),
        name: row.nametag || 'Unknown',
        image: row.image || '/icons/default.png',
        description: row.description || '',
        subcategory: row.subcategory || 'Others',
        is_deposit: row.is_deposit || false,
        deposit_confidence_percentage: row.deposit_confidence_percentage || 0,
        reason: row.reason || '',
        metrics: row.metrics || {},
        gemini_analysis: row.gemini_analysis || '',
        last_analysis: row.last_analysis ? row.last_analysis.toISOString() : null,
        created_at: row.created_at ? row.created_at.toISOString() : null
      };
    });

    logger.info(`Loaded ${Object.keys(allNametags).length} nametags from PostgreSQL.`);
    console.log(`Loaded nametags: ${JSON.stringify(allNametags)}`); // Thêm log console
    return allNametags;
  } catch (error) {
    logger.error(`Error loading nametags from PostgreSQL: ${error.message}`, { stack: error.stack });
    console.error(`Error loading nametags: ${error.message}`); // Thêm log console
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
        const result = await withRetry(() =>
            query(
                `SELECT nametag FROM nametags WHERE address = $1`,
                [normalizedAddress]
            )
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
  const nameTag = labelsData?.name || labelsData?.auto_tag?.name || labelsData?.auto_tag?.['Name Tag'] || 'Unknown';
  const image = labelsData?.image || labelsData?.auto_tag?.image || '/icons/default.png';
  const description = labelsData?.description || labelsData?.auto_tag?.description || labelsData?.auto_tag?.Description || '';
  const subcategory = labelsData?.subcategory || labelsData?.auto_tag?.subcategory || labelsData?.auto_tag?.Subcategory || 'Others';
  const isDeposit = labelsData?.is_deposit || false;
  const depositConfidencePercentage = labelsData?.deposit_confidence_percentage || null;
  const reason = labelsData?.reason || '';
  const metrics = labelsData?.metrics || {};
  const geminiAnalysis = labelsData?.gemini_analysis || '';
  const lastAnalysis = labelsData?.last_analysis ? new Date(labelsData.last_analysis) : new Date();

  try {
    await withRetry(() =>
      query(
        `INSERT INTO nametags (address, nametag, image, description, subcategory, is_deposit, deposit_confidence_percentage, reason, metrics, gemini_analysis, last_analysis, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (address) DO UPDATE SET
           nametag = EXCLUDED.nametag,
           image = EXCLUDED.image,
           description = EXCLUDED.description,
           subcategory = EXCLUDED.subcategory,
           is_deposit = EXCLUDED.is_deposit,
           deposit_confidence_percentage = EXCLUDED.deposit_confidence_percentage,
           reason = EXCLUDED.reason,
           metrics = EXCLUDED.metrics,
           gemini_analysis = EXCLUDED.gemini_analysis,
           last_analysis = EXCLUDED.last_analysis,
           created_at = EXCLUDED.created_at`,
        [
          normalizedAddress,
          nameTag,
          image,
          description,
          subcategory,
          isDeposit,
          depositConfidencePercentage,
          reason,
          metrics,
          geminiAnalysis,
          lastAnalysis,
          new Date()
        ]
      )
    );
    logger.info(`Added/Updated nametag for ${normalizedAddress}: ${nameTag}`);
  } catch (error) {
    logger.error(`Error adding nametag for ${normalizedAddress}: ${error.message}`, { stack: error.stack });
    console.error(`Error adding nametag for ${normalizedAddress}: ${error.message}`); // Thêm log console
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
    const batchSize = 100;
    for (let i = 0; i < normalizedAddresses.length; i += batchSize) {
      const batchAddresses = normalizedAddresses.slice(i, i + batchSize);
      logger.info(`Fetching nametags for batch of ${batchAddresses.length} addresses: ${batchAddresses.join(', ')}`);

      const result = await withRetry(() =>
        query(
          `SELECT address, nametag, image, description, subcategory, is_deposit, deposit_confidence_percentage, reason, metrics, gemini_analysis, last_analysis, created_at
           FROM nametags
           WHERE address = ANY($1)`,
          [batchAddresses]
        )
      );

      result.rows.forEach(row => {
        foundNametags[row.address.toLowerCase()] = {
          address: row.address.toLowerCase(),
          name: row.nametag || 'Unknown',
          image: row.image || '/icons/default.png',
          description: row.description || '',
          subcategory: row.subcategory || 'Others',
          is_deposit: row.is_deposit || false,
          deposit_confidence_percentage: row.deposit_confidence_percentage || 0,
          reason: row.reason || '',
          metrics: row.metrics || {},
          gemini_analysis: row.gemini_analysis || '',
          last_analysis: row.last_analysis ? row.last_analysis.toISOString() : null,
          created_at: row.created_at ? row.created_at.toISOString() : null
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
          subcategory: 'Others',
          is_deposit: false,
          deposit_confidence_percentage: 0,
          reason: '',
          metrics: {},
          gemini_analysis: '',
          last_analysis: null,
          created_at: null
        };
      }
    });

    logger.info(`Fetched ${Object.keys(foundNametags).length} nametags from PostgreSQL for batch request.`);
    console.log(`Fetched nametags: ${JSON.stringify(foundNametags)}`); // Thêm log console
    return foundNametags;
  } catch (error) {
    logger.error(`Error fetching batch nametags from PostgreSQL: ${error.message}`, { stack: error.stack });
    console.error(`Error fetching batch nametags: ${error.message}`); // Thêm log console
    return normalizedAddresses.reduce((acc, addr) => ({
      ...acc,
      [addr]: {
        address: addr,
        name: 'Unknown',
        image: '/icons/default.png',
        description: '',
        subcategory: 'Others',
        is_deposit: false,
        deposit_confidence_percentage: 0,
        reason: '',
        metrics: {},
        gemini_analysis: '',
        last_analysis: null,
        created_at: null
      }
    }), {});
  }
}