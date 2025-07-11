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
                `SELECT address, nametag, image, description, subcategory
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

    try {
        await withRetry(() =>
            query(
                `INSERT INTO nametags (address, nametag, image, description, subcategory)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (address) DO UPDATE SET
                   nametag = EXCLUDED.nametag,
                   image = EXCLUDED.image,
                   description = EXCLUDED.description,
                   subcategory = EXCLUDED.subcategory`,
                [normalizedAddress, nameTag, image, description, subcategory]
            )
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
        const batchSize = 50; // Keep batch size for optimization
        for (let i = 0; i < normalizedAddresses.length; i += batchSize) {
            const batchAddresses = normalizedAddresses.slice(i, i + batchSize);
            logger.info(`Fetching nametags for batch of ${batchAddresses.length} addresses: ${batchAddresses.join(', ')}`);

            const result = await withRetry(() =>
                query(
                    `SELECT address, nametag, image, description, subcategory
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
                    subcategory: row.subcategory || 'Others'
                };
            });
        }

        // Assign default values for addresses not found
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