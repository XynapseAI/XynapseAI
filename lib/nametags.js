// lib/nametags.js
import fs from 'fs/promises';
import path from 'path';
import { query } from '../utils/postgres.js';
import pkg from '../utils/logger.cjs';
import { isAddress } from 'ethers';

const { logger } = pkg;

const NAMETAGS_DIR_PATH = process.env.NAMETAGS_DIR_PATH
  ? path.resolve(process.env.NAMETAGS_DIR_PATH)
  : path.resolve(process.cwd(), 'public/nametags');

/**
 * Loads all nametags from JSON files into PostgreSQL, only for changed files.
 * @param {boolean} forceReload - If true, reloads all nametagscoach: If true, reloads all nametags regardless of changes.
 * @returns {Promise<object>} An object mapping wallet addresses to their nametag data.
 */
export async function loadAllNametags(forceReload = false) {
  try {
    // Kiểm tra số lượng bản ghi trong bảng nametags
    const result = await query(`SELECT COUNT(*) FROM nametags`);
    const nametagCount = parseInt(result.rows[0].count, 10);

    if (nametagCount > 0 && !forceReload) {
      logger.info(`Nametags already loaded in PostgreSQL (${nametagCount} records). Checking for updated JSON files.`);
    } else {
      logger.info(`No nametags in PostgreSQL or force reload enabled. Loading all JSON files.`);
    }

    const absolutePath = path.resolve(NAMETAGS_DIR_PATH);
    await fs.access(absolutePath, fs.constants.F_OK).catch(error => {
      logger.error(`Directory ${absolutePath} not accessible: ${error.message}`);
      throw error;
    });
    const files = await fs.readdir(absolutePath);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    const allNametags = {};

    // Kiểm tra metadata để chỉ tải các file đã thay đổi
    for (const file of jsonFiles) {
      const filePath = path.join(absolutePath, file);
      const stats = await fs.stat(filePath);
      const lastModified = stats.mtime;

      // Kiểm tra thời gian sửa đổi trong nametags_metadata
      const metadataResult = await query(
        `SELECT last_modified FROM nametags_metadata WHERE file_name = $1`,
        [file]
      );
      const lastModifiedInDb = metadataResult.rows[0]?.last_modified;

      if (!forceReload && lastModifiedInDb && new Date(lastModifiedInDb).getTime() >= lastModified.getTime()) {
        logger.info(`No changes in ${file}. Skipping.`);
        continue;
      }

      logger.info(`Reading nametag file: ${filePath}`);
      const fileContent = await fs.readFile(filePath, 'utf-8');
      let nametagsData;
      try {
        nametagsData = JSON.parse(fileContent);
      } catch (error) {
        logger.error(`Error parsing JSON file ${filePath}: ${error.message}`);
        continue;
      }

      // Hỗ trợ cả hai định dạng: mảng và object
      const nametagsArray = Array.isArray(nametagsData)
        ? nametagsData
        : Object.entries(nametagsData).map(([address, data]) => ({
            address,
            name: data.Labels?.[Object.keys(data.Labels || {})[0]]?.['Name Tag'] || data.name || 'Unknown',
            description: data.Labels?.[Object.keys(data.Labels || {})[0]]?.Description || data.description || '',
            subcategory: data.Labels?.[Object.keys(data.Labels || {})[0]]?.Subcategory || data.subcategory || 'Others',
            image: data.Labels?.[Object.keys(data.Labels || {})[0]]?.image || data.image || '/icons/default.png'
          }));

      for (const nametag of nametagsArray) {
        if (!nametag.address || !isAddress(nametag.address)) {
          logger.warn(`Invalid address in ${file}: ${nametag.address}. Skipping.`);
          continue;
        }
        const normalizedAddress = nametag.address.toLowerCase();
        const nameTag = nametag.name || 'Unknown';
        const image = nametag.image || '/icons/default.png';
        const description = nametag.description || '';
        const subcategory = nametag.subcategory || 'Others';

        allNametags[normalizedAddress] = {
          address: normalizedAddress,
          name: nameTag,
          image,
          description,
          subcategory
        };

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
      }

      // Cập nhật metadata
      await query(
        `INSERT INTO nametags_metadata (file_name, last_modified)
         VALUES ($1, $2)
         ON CONFLICT (file_name) DO UPDATE SET last_modified = $2`,
        [file, lastModified]
      );
      logger.info(`Processed ${nametagsArray.length} nametags from ${file}`);
    }

    logger.info(`Loaded and cached ${Object.keys(allNametags).length} total nametags to PostgreSQL.`);
    
    // Trả về tất cả nametags từ cơ sở dữ liệu
    const allNametagsResult = await query(
      `SELECT address, nametag, image, description, subcategory FROM nametags`
    );
    allNametagsResult.rows.forEach(row => {
      allNametags[row.address] = {
        address: row.address,
        name: row.nametag,
        image: row.image,
        description: row.description,
        subcategory: row.subcategory
      };
    });

    return allNametags;
  } catch (error) {
    logger.error(`Error loading nametags from ${NAMETAGS_DIR_PATH}: ${error.message}`, { stack: error.stack });
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
      logger.info(`Found nametag for ${normalizedAddress}: ${result.rows[0].nametag}`);
      return result.rows[0].nametag;
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
    const result = await query(
      `SELECT address, nametag, image, description, subcategory
       FROM nametags
       WHERE address = ANY($1)`,
      [normalizedAddresses]
    );

    result.rows.forEach(row => {
      foundNametags[row.address] = {
        address: row.address,
        name: row.nametag,
        image: row.image,
        description: row.description,
        subcategory: row.subcategory
      };
    });

    logger.info(`Fetched ${Object.keys(foundNametags).length} nametags from PostgreSQL for batch request.`);
    return foundNametags;
  } catch (error) {
    logger.error(`Error fetching batch nametags from PostgreSQL: ${error.message}`, { stack: error.stack });
    return foundNametags;
  }
}