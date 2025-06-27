// pages/api/nametags.js
import fs from 'fs';
import path from 'path';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { RateLimiter } from 'limiter';
import { logger } from '../../utils/logger';
import { query, body, validationResult } from 'express-validator';

const ADDRESS_PAGE_SIZE = 1000;
const limiter = new RateLimiter({ tokensPerInterval: 100, interval: 'minute' }); // Limit 100 requests/minute

const validateGet = [
  query('address')
    .optional()
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Invalid EVM address'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Invalid page number'),
];

const validatePost = [
  body('addresses')
    .isArray({ min: 1 })
    .withMessage('Addresses must be a non-empty array'),
  body('addresses.*')
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Each address must be a valid EVM address'),
];

export default async function handler(req, res) {
  // Check rate limit
  const remainingRequests = await limiter.removeTokens(1);
  if (remainingRequests < 0) {
    return res.status(429).json({
      success: false,
      detail: 'Too many requests. Please try again later.',
    });
  }

  // Check user authentication
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({
      success: false,
      detail: 'Unauthorized: Please log in.',
    });
  }

  const nametagsDir = path.join(process.cwd(), 'public', 'nametags');
  const files = fs.readdirSync(nametagsDir).filter((file) => file.startsWith('addresses-') && file.endsWith('.json'));

  const loadAllAddresses = () => {
    const allData = {};
    for (const file of files) {
      try {
        const filePath = path.join(nametagsDir, file);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const jsonData = JSON.parse(fileContent);
        Object.assign(allData, jsonData);
      } catch (error) {
        logger.error(`Error reading file ${file}:`, { message: error.message });
      }
    }
    return allData;
  };

  if (req.method === 'GET') {
    await Promise.all(validateGet.map((validation) => validation.run(req)));
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`);
      return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
    }

    const { address, page = 1 } = req.query;

    if (address) {
      const normalizedAddress = address.toLowerCase();
      const allData = loadAllAddresses();
      
      if (allData[normalizedAddress]) {
        return res.status(200).json({
          success: true,
          data: { [normalizedAddress]: allData[normalizedAddress] },
        });
      } else {
        return res.status(404).json({
          success: false,
          detail: `Name Tag not found for address ${normalizedAddress}`,
        });
      }
    }

    const pageNum = parseInt(page, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        success: false,
        detail: 'Invalid page number',
      });
    }

    const allData = loadAllAddresses();
    const addresses = Object.entries(allData);
    const totalAddresses = addresses.length;
    const totalPages = Math.ceil(totalAddresses / ADDRESS_PAGE_SIZE);
    const startIndex = (pageNum - 1) * ADDRESS_PAGE_SIZE;
    const endIndex = startIndex + ADDRESS_PAGE_SIZE;

    if (startIndex >= totalAddresses) {
      return res.status(400).json({
        success: false,
        detail: 'Page number out of range',
      });
    }

    const pageData = Object.fromEntries(addresses.slice(startIndex, endIndex));

    return res.status(200).json({
      success: true,
      data: pageData,
      metadata: {
        page: pageNum,
        pageSize: ADDRESS_PAGE_SIZE,
        totalPages,
        totalAddresses,
      },
    });
  }

  if (req.method === 'POST') {
    await Promise.all(validatePost.map((validation) => validation.run(req)));
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(`Validation errors: ${JSON.stringify(errors.array())}`);
      return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
    }

    const { addresses } = req.body;

    const normalizedAddresses = addresses.map((addr) => addr.toLowerCase());
    const allData = loadAllAddresses();
    const result = normalizedAddresses.reduce((acc, addr) => {
      if (allData[addr]) {
        acc[addr] = allData[addr];
      }
      return acc;
    }, {});

    return res.status(200).json({
      success: true,
      data: result,
      metadata: {
        requested: normalizedAddresses.length,
        found: Object.keys(result).length,
      },
    });
  }

  return res.status(405).json({
    success: false,
    detail: 'Method not allowed',
  });
}