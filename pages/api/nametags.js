// pages/api/nametags.js
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { RateLimiter } from 'limiter';
import pkg from '../../utils/logger.cjs';
import { body, validationResult } from 'express-validator';
// eslint-disable-next-line
import { isAddress } from 'ethers';
import { getNametagsBatch, addNametag } from '../../lib/nametags.js';
import { query } from '../../utils/postgres.js';

const { logger } = pkg;

const limiter = new RateLimiter({ tokensPerInterval: 100, interval: 'minute' });

const checkCSRF = (req) => {
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://postgres-production-e852c.up.railway.app',
    'https://xynapseai-production.up.railway.app',
  ];
  const origin = req.headers['origin'] || req.headers['referer']?.split('/').slice(0, 3).join('/');
  if (!origin || !allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
    logger.warn(`Invalid or missing Origin/Referer header: ${origin}`);
    return false;
  }
  return true;
};

async function checkAdminStatus(uid) {
  if (!uid) return false;
  try {
    const adminResult = await query(
      `SELECT is_admin FROM admins WHERE uid = $1`,
      [uid]
    );
    logger.info(`Checked admin status for UID ${uid}: ${adminResult.rows.length > 0 && adminResult.rows[0].is_admin}`);
    return adminResult.rows.length > 0 && adminResult.rows[0].is_admin === true;
  } catch (error) {
    logger.error(`Error checking admin status for ${uid}: ${error.message}`, { stack: error.stack });
    return false;
  }
}

const validateGet = [
  body('address')
    .optional()
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Invalid EVM address'),
];

const validatePost = [
  body('addresses')
    .isArray({ min: 1, max: 100 })
    .withMessage('Addresses must be a non-empty array, maximum 100 addresses'),
  body('addresses.*')
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Each address must be a valid EVM address'),
];

const validatePut = [
  body('address')
    .notEmpty()
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Address must be a valid EVM address'),
  body('labels')
    .isObject()
    .notEmpty()
    .withMessage('Labels must be a non-empty object.'),
];

async function getWalletAnalysis(address) {
  try {
    const result = await query(
      `SELECT is_deposit, deposit_confidence_percentage, nametag, image, reason, metrics, gemini_analysis, last_analysis
       FROM wallet_analysis
       WHERE wallet = $1`,
      [address.toLowerCase()]
    );
    if (result.rows.length > 0) {
      return result.rows[0];
    }
    return null;
  } catch (error) {
    logger.error(`Error fetching wallet analysis for ${address}: ${error.message}`, { stack: error.stack });
    return null;
  }
}

export default async function handler(req, res) {
  try {
    const remainingRequests = await limiter.removeTokens(1);
    if (remainingRequests < 0) {
      logger.warn('Rate limit exceeded for nametags API');
      return res.status(429).json({
        success: false,
        detail: 'Too many requests. Please try again later.',
      });
    }

    if (!checkCSRF(req)) {
      return res.status(403).json({ error: 'Invalid or missing Origin/Referer header.' });
    }

    let session = null;
    let isAdminUser = false;

    const internalToken = req.headers['x-internal-token'];
    if (process.env.NODE_ENV === 'development' && internalToken === process.env.INTERNAL_API_TOKEN) {
      logger.info('Bypassing auth with internal token for nametags API (development mode).');
      isAdminUser = true;
    } else if (req.method === 'PUT' || req.method === 'PATCH') {
      session = await getServerSession(req, res, authOptions);
      if (!session) {
        logger.warn('Unauthorized access attempt to nametags API (no session for PUT/PATCH)');
        return res.status(401).json({
          success: false,
          detail: 'Unauthorized: Please log in.',
        });
      }
      isAdminUser = await checkAdminStatus(session.user.id);
      if (!isAdminUser) {
        logger.warn(`Forbidden access attempt to nametags API by non-admin user: ${session?.user?.id || 'N/A'}`);
        return res.status(403).json({
          success: false,
          detail: 'Forbidden: Admin access required.',
        });
      }
    }

    if (req.method === 'GET') {
      await Promise.all(validateGet.map(validation => validation.run(req)));
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        logger.warn(`Validation errors in GET request: ${JSON.stringify(errors.array())}`);
        return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
      }

      const { address } = req.query;
      if (!address) {
        logger.warn('GET request without address is not supported');
        return res.status(400).json({
          success: false,
          detail: 'Address is required for GET request',
        });
      }

      const normalizedAddress = address.toLowerCase();
      try {
        const nametag = (await getNametagsBatch([normalizedAddress]))[normalizedAddress];
        const analysis = await getWalletAnalysis(normalizedAddress);
        const responseData = {
          Address: normalizedAddress,
          Labels: {
            deposit: {
              'Name Tag': nametag.name,
              Description: nametag.description,
              Subcategory: nametag.subcategory,
              image: nametag.image,
              is_deposit: analysis?.is_deposit || false,
              deposit_confidence_percentage: analysis?.deposit_confidence_percentage || null,
              reason: analysis?.reason || '',
              metrics: analysis?.metrics || {},
              gemini_analysis: analysis?.gemini_analysis || '',
              last_analysis: analysis?.last_analysis || null,
            },
          },
        };

        if (nametag && nametag.name !== 'Unknown') {
          logger.info(`Nametag found for address ${normalizedAddress}: ${nametag.name}`);
          return res.status(200).json({
            success: true,
            data: { [normalizedAddress]: responseData },
          });
        }
        logger.info(`Nametag not found for address: ${normalizedAddress}`);
        return res.status(404).json({
          success: false,
          detail: `Nametag not found for address ${normalizedAddress}`,
        });
      } catch (error) {
        logger.error(`Error fetching nametag for ${normalizedAddress}: ${error.message}`, { stack: error.stack });
        return res.status(500).json({
          success: false,
          detail: `Failed to fetch nametag: ${error.message}`,
        });
      }
    }

    if (req.method === 'POST') {
      await Promise.all(validatePost.map(validation => validation.run(req)));
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        logger.warn(`Validation errors in POST request: ${JSON.stringify(errors.array())}`);
        return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
      }

      const { addresses } = req.body;
      const normalizedAddresses = addresses.map(addr => addr.toLowerCase());
      try {
        const nametags = await getNametagsBatch(normalizedAddresses);
        const result = {};
        for (const addr of normalizedAddresses) {
          const analysis = await getWalletAnalysis(addr);
          result[addr] = {
            Address: addr,
            Labels: {
              deposit: {
                'Name Tag': nametags[addr].name,
                Description: nametags[addr].description,
                Subcategory: nametags[addr].subcategory,
                image: nametags[addr].image,
                is_deposit: analysis?.is_deposit || false,
                deposit_confidence_percentage: analysis?.deposit_confidence_percentage || null,
                reason: analysis?.reason || '',
                metrics: analysis?.metrics || {},
                gemini_analysis: analysis?.gemini_analysis || '',
                last_analysis: analysis?.last_analysis || null,
              },
            },
          };
        }

        logger.info(`POST request processed: requested ${normalizedAddresses.length}, found ${Object.keys(result).length}`);
        return res.status(200).json({
          success: true,
          data: result,
          metadata: {
            requested: normalizedAddresses.length,
            found: Object.keys(result).length,
          },
        });
      } catch (error) {
        logger.error(`Error fetching batch nametags: ${error.message}`, { stack: error.stack });
        return res.status(500).json({
          success: false,
          detail: `Failed to fetch nametags: ${error.message}`,
        });
      }
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      await Promise.all(validatePut.map(validation => validation.run(req)));
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        logger.warn(`Validation errors in PUT/PATCH request: ${JSON.stringify(errors.array())}`);
        return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
      }

      const { address, labels } = req.body;
      try {
        const normalizedLabels = {
          name: labels?.deposit?.['Name Tag'] || labels?.name || 'Unknown',
          description: labels?.deposit?.Description || labels?.description || '',
          subcategory: labels?.deposit?.Subcategory || labels?.subcategory || 'Others',
          image: labels?.deposit?.image || labels?.image || '/icons/default.png',
        };
        await addNametag(address, normalizedLabels);
        logger.info(`Nametag added/updated for ${address}: ${JSON.stringify(normalizedLabels)}`);
        return res.status(200).json({
          success: true,
          detail: `Nametag for ${address} successfully added/updated.`,
          data: { address, labels: normalizedLabels },
        });
      } catch (error) {
        logger.error(`Failed to add/update nametag for ${address}: ${error.message}`, { stack: error.stack });
        return res.status(500).json({
          success: false,
          detail: `Failed to add/update nametag: ${error.message}`,
        });
      }
    }

    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({
      success: false,
      detail: 'Method not allowed',
    });
  } catch (err) {
    logger.error(`Unexpected error in nametags: ${err.message}`, { stack: err.stack });
    return res.status(500).json({ error: `Unexpected server error: ${err.message}` });
  }
}