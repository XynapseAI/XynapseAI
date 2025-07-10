// scripts/import-nametags.js
import { promises as fs } from 'fs';
import path from 'path';
import { query } from '../utils/postgres.js';
import { logger } from '../utils/logger.cjs';
import { isAddress } from 'ethers';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 * Reads all JSON files from a directory and returns their content
 */
async function readJsonFiles(directory) {
  try {
    logger.info(`Scanning directory: ${directory}`);
    console.log(`Scanning directory: ${directory}`);
    const files = await fs.readdir(directory);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    logger.info(`Found ${jsonFiles.length} JSON files: ${jsonFiles.join(', ')}`);
    console.log(`Found ${jsonFiles.length} JSON files: ${jsonFiles.join(', ')}`);
    const allData = [];

    for (const file of jsonFiles) {
      const filePath = path.join(directory, file);
      logger.info(`Reading JSON file: ${filePath}`);
      console.log(`Reading JSON file: ${filePath}`);
      const content = await fs.readFile(filePath, 'utf-8');
      const jsonData = JSON.parse(content);
      logger.info(`Parsed JSON file: ${filePath}, found ${Object.keys(jsonData).length} addresses`);
      console.log(`Parsed JSON file: ${filePath}, found ${Object.keys(jsonData).length} addresses`);
      allData.push(jsonData);
    }

    logger.info(`Read ${jsonFiles.length} JSON files from ${directory}`);
    console.log(`Read ${jsonFiles.length} JSON files successfully`);
    return allData;
  } catch (error) {
    logger.error(`Error reading JSON files from ${directory}: ${error.message}`, { stack: error.stack });
    console.error(`Error reading JSON files: ${error.message}`);
    return [];
  }
}

/**
 * Imports nametag data from JSON files into PostgreSQL nametags table
 */
async function importNametags(directory) {
  logger.info('Starting nametag import process...');
  console.log('Starting nametag import process...');
  const jsonDataArray = await readJsonFiles(directory);
  let totalImported = 0;
  let totalSkipped = 0;

  for (const jsonData of jsonDataArray) {
    const addresses = Object.keys(jsonData);
    logger.info(`Processing JSON data with ${addresses.length} addresses`);
    console.log(`Processing JSON data with ${addresses.length} addresses`);

    for (const [address, data] of Object.entries(jsonData)) {
      if (!isAddress(address)) {
        logger.warn(`Invalid address in JSON data: ${address}. Skipping.`);
        console.log(`Invalid address: ${address}. Skipping.`);
        continue;
      }

      const normalizedAddress = address.toLowerCase();
      const labels = data.Labels || {};
      const labelType = Object.keys(labels)[0] || 'unknown';
      const labelData = labels[labelType] || {};

      const nametagData = {
        name: labelData['Name Tag'] || 'Unknown',
        description: labelData.Description || '',
        subcategory: labelData.Subcategory || 'Others',
        image: labelData.image || '/icons/default.png',
        is_deposit: false,
        deposit_confidence_percentage: null,
        reason: '',
        metrics: {},
        gemini_analysis: '',
        last_analysis: null
      };

      logger.info(`Processing address ${normalizedAddress}: ${nametagData.name}`);
      console.log(`Processing address ${normalizedAddress}: ${nametagData.name}`);

      // Kiểm tra xem địa chỉ đã tồn tại và là ví deposit
      let isExistingDeposit = false;
      try {
        const existing = await query(
          `SELECT is_deposit FROM nametags WHERE address = $1`,
          [normalizedAddress]
        );
        if (existing.rows.length > 0 && existing.rows[0].is_deposit) {
          isExistingDeposit = true;
          totalSkipped++;
          logger.info(`Skipping address ${normalizedAddress}: Already a deposit wallet.`);
          console.log(`Skipping address ${normalizedAddress}: Already a deposit wallet`);
          continue;
        }
      } catch (error) {
        logger.error(`Error checking existing nametag for ${normalizedAddress}: ${error.message}`, { stack: error.stack });
        console.error(`Error checking existing nametag for ${normalizedAddress}: ${error.message}`);
        continue;
      }

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
              nametagData.name,
              nametagData.image,
              nametagData.description,
              nametagData.subcategory,
              nametagData.is_deposit,
              nametagData.deposit_confidence_percentage,
              nametagData.reason,
              nametagData.metrics,
              nametagData.gemini_analysis,
              nametagData.last_analysis,
              new Date()
            ]
          )
        );
        totalImported++;
        logger.info(`Imported/Updated nametag for ${normalizedAddress}: ${nametagData.name}`);
        console.log(`Imported/Updated nametag for ${normalizedAddress}: ${JSON.stringify(nametagData)}`);
      } catch (error) {
        logger.error(`Error importing nametag for ${normalizedAddress}: ${error.message}`, { stack: error.stack });
        console.error(`Error importing nametag for ${normalizedAddress}: ${error.message}`);
      }
    }
  }

  logger.info(`Import completed: ${totalImported} nametags imported/updated, ${totalSkipped} skipped (deposit wallets).`);
  console.log(`Import completed: ${totalImported} imported/updated, ${totalSkipped} skipped`);
}

/**
 * Main function to run the import
 */
async function main() {
  const directory = path.join(__dirname, '../public/nametags');
  logger.info(`Starting import from directory: ${directory}`);
  console.log(`Starting import from directory: ${directory}`);
  try {
    await importNametags(directory);
    logger.info('Nametag import process completed successfully.');
    console.log('Nametag import process completed successfully.');
  } catch (error) {
    logger.error(`Fatal error during nametag import: ${error.message}`, { stack: error.stack });
    console.error(`Fatal error during nametag import: ${error.message}`);
    process.exit(1);
  }
}

main();