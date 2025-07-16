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
 * Reads a specific JSON file and returns its content
 */
async function readJsonFiles(filePath) {
  try {
    logger.info(`Reading JSON file: ${filePath}`);
    console.log(`Reading JSON file: ${filePath}`);
    
    // Kiểm tra xem file có tồn tại không
    await fs.access(filePath); // Ném lỗi nếu file không tồn tại
    
    if (!filePath.endsWith('.json')) {
      throw new Error(`File ${filePath} is not a JSON file`);
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const jsonData = JSON.parse(content);
    logger.info(`Parsed JSON file: ${filePath}, found ${Object.keys(jsonData).length} addresses`);
    console.log(`Parsed JSON file: ${filePath}, found ${Object.keys(jsonData).length} addresses`);
    
    return [jsonData]; // Trả về mảng chứa một object JSON duy nhất
  } catch (error) {
    logger.error(`Error reading JSON file ${filePath}: ${error.message}`, { stack: error.stack });
    console.error(`Error reading JSON file: ${error.message}`);
    return [];
  }
}

/**
 * Imports nametag data from a specific JSON file into PostgreSQL nametags table
 */
async function importNametags(filePath) {
  logger.info('Starting nametag import process...');
  console.log('Starting nametag import process...');
  const jsonDataArray = await readJsonFiles(filePath);
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
        totalSkipped++;
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
        image: labelData.image || '/icons/default.png'
      };

      logger.info(`Processing address ${normalizedAddress}: ${nametagData.name}`);
      console.log(`Processing address ${normalizedAddress}: ${nametagData.name}`);

      try {
        await withRetry(() =>
          query(
            `INSERT INTO nametags (address, nametag, image, description, subcategory)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (address) DO NOTHING`,
            [
              normalizedAddress,
              nametagData.name,
              nametagData.image,
              nametagData.description,
              nametagData.subcategory
            ]
          )
        );
        totalImported++;
        logger.info(`Imported nametag for ${normalizedAddress}: ${nametagData.name}`);
        console.log(`Imported nametag for ${normalizedAddress}: ${JSON.stringify(nametagData)}`);
      } catch (error) {
        logger.error(`Error importing nametag for ${normalizedAddress}: ${error.message}`, { stack: error.stack });
        console.error(`Error importing nametag for ${normalizedAddress}: ${error.message}`);
      }
    }
  }

  logger.info(`Import completed: ${totalImported} nametags imported, ${totalSkipped} skipped (invalid addresses).`);
  console.log(`Import completed: ${totalImported} imported, ${totalSkipped} skipped (invalid addresses)`);
}

/**
 * Main function to run the import
 */
async function main() {
  const filePath = path.join(__dirname, '../public/nametags/addresses-267.json'); // Chỉ định file cụ thể
  logger.info(`Starting import from file: ${filePath}`);
  console.log(`Starting import from file: ${filePath}`);
  try {
    await importNametags(filePath);
    logger.info('Nametag import process completed successfully.');
    console.log('Nametag import process completed successfully.');
  } catch (error) {
    logger.error(`Fatal error during nametag import: ${error.message}`, { stack: error.stack });
    console.error(`Fatal error during nametag import: ${error.message}`);
    process.exit(1);
  }
}

main();