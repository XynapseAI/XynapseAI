// pages/api/nametags.js
import fs from 'fs';
import path from 'path';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import axios from 'axios';
import { RateLimiter } from 'limiter';
import { logger } from '../../utils/logger';

const ADDRESS_PAGE_SIZE = 1000;
const limiter = new RateLimiter({ tokensPerInterval: 100, interval: 'minute' }); // Giới hạn 100 yêu cầu/phút

// Hàm xác minh reCAPTCHA
const verifyRecaptcha = async (token) => {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;
  try {
    const response = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify`,
      null,
      {
        params: {
          secret: secretKey,
          response: token,
        },
      }
    );
    return response.data.success && response.data.score >= 0.5;
  } catch (error) {
    logger.error('Error verifying reCAPTCHA:', { message: error.message });
    return false;
  }
};

export default async function handler(req, res) {
  // Kiểm tra rate limit
  const remainingRequests = await limiter.removeTokens(1);
  if (remainingRequests < 0) {
    return res.status(429).json({
      success: false,
      detail: 'Too many requests. Please try again later.',
    });
  }

  // Kiểm tra xác thực người dùng
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({
      success: false,
      detail: 'Unauthorized: Please log in.',
    });
  }

  // Kiểm tra reCAPTCHA
  const recaptchaToken = req.headers['x-recaptcha-token'];
  if (!recaptchaToken || !(await verifyRecaptcha(recaptchaToken))) {
    return res.status(403).json({
      success: false,
      detail: 'reCAPTCHA verification failed.',
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
    const { addresses } = req.body;

    if (!Array.isArray(addresses) || addresses.length === 0) {
      return res.status(400).json({
        success: false,
        detail: 'Addresses must be a non-empty array',
      });
    }

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