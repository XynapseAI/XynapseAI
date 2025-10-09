import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import { query } from '../utils/postgres.js';
import { logger } from '../utils/serverLogger.js';
import { isAddress as isEthAddress } from 'ethers';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Validate Ethereum and Bitcoin addresses
 */
function isValidAddress(address) {
  // Ethereum check
  if (isEthAddress(address)) return true;

  // Bitcoin legacy (1...), P2SH (3...), or Bech32 (bc1...)
  const btcRegex = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/i;
  return btcRegex.test(address);
}

/**
 * Retries an operation with exponential backoff
 */
async function withRetry(operation, maxAttempts = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.info(`Attempt ${attempt} of ${maxAttempts} for operation`);
      console.log(`Attempt ${attempt} of ${maxAttempts} for operation`);
      return await operation();
    } catch (e) {
      if (attempt === maxAttempts) {
        logger.error(`Operation failed after ${maxAttempts} attempts: ${e.message}`, { stack: e.stack });
        console.error(`Operation failed: ${e.message}`);
        throw e;
      }
      logger.warn(`Attempt ${attempt} failed: ${e.message}. Retrying after ${delayMs}ms...`);
      console.log(`Attempt ${attempt} failed: ${e.message}. Retrying...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Core logic: process one JSON object of addresses -> insert/update into DB
 */
async function processJsonData(jsonData) {
  let totalImported = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalNoNameTag = 0;

  const addresses = Object.keys(jsonData);
  logger.info(`Processing JSON data with ${addresses.length} entries`);
  console.log(`Processing JSON data with ${addresses.length} entries`);

  for (const [address, data] of Object.entries(jsonData)) {
    // ❌ Bỏ kiểm tra isValidAddress — luôn ghi vào DB
    const normalizedAddress = address.trim();
    const labels = data.Labels || {};
    const labelType = Object.keys(labels)[0] || 'unknown';
    const labelData = labels[labelType] || {};

    if (!labelData['Name Tag']) {
      logger.warn(`No Name Tag for ${normalizedAddress}. Skipping.`);
      console.log(`No Name Tag for ${normalizedAddress}. Skipping.`);
      totalNoNameTag++;
      continue;
    }

    const nametagData = {
      name: labelData['Name Tag'],
      description: labelData.Description || '',
      subcategory: labelData.Subcategory || 'Others',
      image: labelData.image || '/icons/default.webp',
    };

    logger.info(`Processing ${normalizedAddress}: ${nametagData.name}`);
    console.log(`Processing ${normalizedAddress}: ${nametagData.name}`);

    try {
      const result = await withRetry(() =>
        query(
          `INSERT INTO nametags (address, nametag, image, description, subcategory)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (address) DO UPDATE
           SET nametag = EXCLUDED.nametag,
               image = EXCLUDED.image,
               description = EXCLUDED.description,
               subcategory = EXCLUDED.subcategory
           RETURNING CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS action`,
          [
            normalizedAddress,
            nametagData.name,
            nametagData.image,
            nametagData.description,
            nametagData.subcategory,
          ]
        )
      );

      if (result.rows[0].action === 'inserted') {
        totalImported++;
        console.log(`✅ Imported ${normalizedAddress}`);
      } else {
        totalUpdated++;
        console.log(`🔄 Updated ${normalizedAddress}`);
      }
    } catch (error) {
      console.error(`Error saving ${normalizedAddress}: ${error.message}`);
    }
  }

  console.log(
    `Summary: ${totalImported} imported, ${totalUpdated} updated, ${totalSkipped} skipped (invalid), ${totalNoNameTag} skipped (no Name Tag).`
  );
}


/**
 * Reads all JSON files in the specified directory and returns their content
 */
async function readJsonFiles(directoryPath) {
  try {
    const files = await fs.readdir(directoryPath);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    if (jsonFiles.length === 0) {
      console.log(`⚠️ No JSON files found in ${directoryPath}`);
      return [];
    }

    const jsonDataArray = [];
    for (const file of jsonFiles) {
      const filePath = path.join(directoryPath, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const jsonData = JSON.parse(content);
      console.log(`📄 Parsed ${file}: ${Object.keys(jsonData).length} addresses`);
      jsonDataArray.push(jsonData);
    }

    return jsonDataArray;
  } catch (error) {
    console.error(`Error accessing directory ${directoryPath}: ${error.message}`);
    return [];
  }
}

/**
 * Import from one specific file
 */
async function importNametagsForFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const jsonData = JSON.parse(content);
    await processJsonData(jsonData);
  } catch (error) {
    console.error(`Error reading file ${filePath}: ${error.message}`);
  }
}

/**
 * Main entry
 */
async function main() {
  const filePath = path.join(__dirname, '../public/nametags/btc-top-holders.json');
  console.log(`🚀 Starting import from file: ${filePath}`);
  await importNametagsForFile(filePath);
  console.log('✅ Nametag import process completed successfully.');
}

main();
