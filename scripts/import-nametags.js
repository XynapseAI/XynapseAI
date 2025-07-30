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
 * Reads all JSON files in the specified directory and returns their content
 */
async function readJsonFiles(directoryPath) {
  try {
    logger.info(`Reading JSON files from directory: ${directoryPath}`);
    console.log(`Reading JSON files from directory: ${directoryPath}`);

    // Read all files in the directory
    const files = await fs.readdir(directoryPath);
    const jsonFiles = files.filter(file => file.endsWith('.json'));

    if (jsonFiles.length === 0) {
      logger.warn(`No JSON files found in ${directoryPath}`);
      console.log(`No JSON files found in ${directoryPath}`);
      return [];
    }

    const jsonDataArray = [];
    for (const file of jsonFiles) {
      const filePath = path.join(directoryPath, file);
      try {
        await fs.access(filePath);
        const content = await fs.readFile(filePath, 'utf-8');
        const jsonData = JSON.parse(content);
        logger.info(`Parsed JSON file: ${filePath}, found ${Object.keys(jsonData).length} addresses`);
        console.log(`Parsed JSON file: ${filePath}, found ${Object.keys(jsonData).length} addresses`);
        jsonDataArray.push(jsonData);
      } catch (error) {
        logger.error(`Error reading JSON file ${filePath}: ${error.message}`, { stack: error.stack });
        console.error(`Error reading JSON file ${filePath}: ${error.message}`);
      }
    }

    return jsonDataArray;
  } catch (error) {
    logger.error(`Error accessing directory ${directoryPath}: ${error.message}`, { stack: error.stack });
    console.error(`Error accessing directory ${directoryPath}: ${error.message}`);
    return [];
  }
}

/**
 * Imports nametag data from all JSON files in the directory into PostgreSQL nametags table
 */
async function importNametags(directoryPath) {
  logger.info('Starting nametag import process...');
  console.log('Starting nametag import process...');
  const jsonDataArray = await readJsonFiles(directoryPath);
  let totalImported = 0;
  let totalSkipped = 0;
  let totalNoNameTag = 0;

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

      // Skip entries without a Name Tag
      if (!labelData['Name Tag']) {
        logger.warn(`No Name Tag for address ${normalizedAddress}. Skipping.`);
        console.log(`No Name Tag for address ${normalizedAddress}. Skipping.`);
        totalNoNameTag++;
        continue;
      }

      const nametagData = {
        name: labelData['Name Tag'],
        description: labelData.Description || '',
        subcategory: labelData.Subcategory || 'Others',
        image: labelData.image || '/icons/default.png',
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
              nametagData.subcategory,
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

  logger.info(
    `Import completed: ${totalImported} nametags imported, ${totalSkipped} skipped (invalid addresses), ${totalNoNameTag} skipped (no Name Tag).`
  );
  console.log(
    `Import completed: ${totalImported} imported, ${totalSkipped} skipped (invalid addresses), ${totalNoNameTag} skipped (no Name Tag).`
  );
}

/**
 * Main function to run the import
 */
async function main() {
  const directoryPath = path.join(__dirname, '../public/nametags');
  logger.info(`Starting import from directory: ${directoryPath}`);
  console.log(`Starting import from directory: ${directoryPath}`);
  try {
    await importNametags(directoryPath);
    logger.info('Nametag import process completed successfully.');
    console.log('Nametag import process completed successfully.');
  } catch (error) {
    logger.error(`Fatal error during nametag import: ${error.message}`, { stack: error.stack });
    console.error(`Fatal error during nametag import: ${error.message}`);
    process.exit(1);
  }
}

main();