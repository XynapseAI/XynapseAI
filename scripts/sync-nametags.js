// scripts/sync-nametags.js
import fs from 'fs/promises';
import path from 'path';
import { query } from '../utils/postgres.js';
import { logger } from '../utils/logger.cjs';

async function syncNametags() {
  const nametagsDir = process.env.NAMETAGS_DIR_PATH || path.join(process.cwd(), 'public', 'nametags');
  try {
    // Tạo thư mục nếu chưa tồn tại
    await fs.mkdir(nametagsDir, { recursive: true });

    // Lấy dữ liệu từ PostgreSQL
    const result = await query('SELECT address, nametag, image, description, subcategory FROM nametags');
    const fileDataMap = {};

    for (const row of result.rows) {
      const normalizedAddress = row.address.toLowerCase();
      const fileSuffix = normalizedAddress.slice(2, 8);
      const filePath = path.join(nametagsDir, `addresses-${fileSuffix}.json`);

      // Khởi tạo dữ liệu cho file
      if (!fileDataMap[filePath]) {
        fileDataMap[filePath] = {};
        try {
          if (await fs.access(filePath).then(() => true).catch(() => false)) {
            const fileContent = await fs.readFile(filePath, 'utf8');
            fileDataMap[filePath] = JSON.parse(fileContent);
          }
        } catch (error) {
          logger.error(`Error reading JSON file ${filePath}: ${error.message}`);
        }
      }

      // Xác định key của Labels (dựa trên subcategory hoặc fallback)
      let labelKey = row.subcategory?.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'deposit';
      if (fileDataMap[filePath][normalizedAddress]?.Labels) {
        // Giữ key hiện có trong JSON nếu tồn tại
        labelKey = Object.keys(fileDataMap[filePath][normalizedAddress].Labels)[0] || labelKey;
      }

      // Xây dựng dữ liệu cho JSON
      fileDataMap[filePath][normalizedAddress] = {
        Address: normalizedAddress,
        Labels: {
          [labelKey]: {
            'Name Tag': row.nametag || 'Unknown',
            Description: row.description || 'Not found in JSON.',
            Subcategory: row.subcategory || 'Others',
            image: row.image || '/icons/default.png',
          },
        },
      };
    }

    // Ghi dữ liệu vào file JSON
    for (const filePath in fileDataMap) {
      try {
        await fs.writeFile(filePath, JSON.stringify(fileDataMap[filePath], null, 2), 'utf8');
        logger.info(`Synced nametags to ${filePath}`);
      } catch (error) {
        logger.error(`Error writing JSON file ${filePath}: ${error.message}`);
      }
    }
    logger.info(`Synced ${result.rows.length} nametags from PostgreSQL to JSON.`);
  } catch (error) {
    logger.error(`Error syncing nametags: ${error.message}`);
  }
}

syncNametags().then(() => process.exit(0));