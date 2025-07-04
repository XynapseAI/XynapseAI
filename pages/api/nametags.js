import fs from 'fs/promises';
import path from 'path';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import rateLimit from 'express-rate-limit';
import { query, body, validationResult } from 'express-validator';
import { logger } from '../../utils/logger';
import { db } from '../../utils/firebaseAdmin';
import { getSecrets } from '../../lib/vault';

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  },
});

const validateGet = [
  query('address')
    .optional()
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Invalid EVM address'),
];

const validatePost = [
  body('addresses')
    .isArray({ min: 1 })
    .withMessage('Addresses must be a non-empty array'),
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

async function checkAdminStatus(uid) {
  if (!uid) return false;
  try {
    const adminDoc = await db.collection('admins').doc(uid).get();
    return adminDoc.exists && adminDoc.data().isAdmin === true;
  } catch (error) {
    logger.error(`Error checking admin status for ${uid}:`, error);
    return false;
  }
}

let NAMETAG_CACHE = null;

async function loadNametagCache() {
  if (!NAMETAG_CACHE) {
    NAMETAG_CACHE = {};
    const nametagsDir = path.join(process.cwd(), 'public', 'nametags');
    try {
      const files = await fs.readdir(nametagsDir);
      const jsonFiles = files.filter(file => file.startsWith('addresses-') && file.endsWith('.json'));
      for (const file of jsonFiles) {
        try {
          const filePath = path.join(nametagsDir, file);
          const fileContent = await fs.readFile(filePath, 'utf8');
          const jsonData = JSON.parse(fileContent);
          for (const addressKey in jsonData) {
            const normalizedAddress = addressKey.toLowerCase();
            const data = jsonData[addressKey];
            if (data.Labels && Object.keys(data.Labels).length > 0) {
              const firstLabelKey = Object.keys(data.Labels)[0];
              data.Labels[firstLabelKey].image = data.Labels[firstLabelKey].image || '/icons/default.png';
            } else {
              data.Labels = {
                'deposit': {
                  'Name Tag': 'Unknown',
                  'Description': 'No specific label information.',
                  'Subcategory': 'Deposit',
                  'image': '/icons/default.png'
                }
              };
            }
            NAMETAG_CACHE[normalizedAddress] = data;
          }
        } catch (error) {
          logger.error(`Error reading file ${file}:`, { message: error.message });
        }
      }
      logger.info(`Loaded ${Object.keys(NAMETAG_CACHE).length} nametags from JSON.`);
    } catch (error) {
      logger.error(`Error accessing nametags directory: ${error.message}`);
    }
  }
  return NAMETAG_CACHE;
}

async function getNametagForAddress(address) {
  const normalizedAddress = address.toLowerCase();
  const cache = await loadNametagCache();
  if (cache[normalizedAddress]) {
    return cache[normalizedAddress];
  }

  const fileSuffix = normalizedAddress.slice(2, 8);
  const filePath = path.join(process.cwd(), 'public', 'nametags', `addresses-${fileSuffix}.json`);
  try {
    const fileContent = await fs.readFile(filePath, 'utf8');
    const jsonData = JSON.parse(fileContent);
    const data = jsonData[normalizedAddress];
    if (data) {
      if (data.Labels && Object.keys(data.Labels).length > 0) {
        const firstLabelKey = Object.keys(data.Labels)[0];
        data.Labels[firstLabelKey].image = data.Labels[firstLabelKey].image || '/icons/default.png';
      } else {
        data.Labels = {
          'deposit': {
            'Name Tag': 'Unknown',
            'Description': 'No specific label information.',
            'Subcategory': 'Deposit',
            'image': '/icons/default.png'
          }
        };
      }
      cache[normalizedAddress] = data;
      return data;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error(`Error reading JSON file ${filePath}:`, { message: error.message });
    }
  }
  return null;
}

async function addNametag(address, labels) {
  const normalizedAddress = address.toLowerCase();
  try {
    await db.collection('nametags').doc(normalizedAddress).set({
      Labels: labels
    }, { merge: true });

    const nametagsDir = path.join(process.cwd(), 'public', 'nametags');
    const filePath = path.join(nametagsDir, `addresses-${normalizedAddress.slice(2, 8)}.json`);
    let fileData = {};
    try {
      if (await fs.access(filePath).then(() => true).catch(() => false)) {
        const fileContent = await fs.readFile(filePath, 'utf8');
        fileData = JSON.parse(fileContent);
      }
    } catch (error) {
      logger.error(`Error reading JSON file ${filePath} for update: ${error.message}`);
    }
    fileData[normalizedAddress] = { Address: address, Labels: labels };
    await fs.writeFile(filePath, JSON.stringify(fileData, null, 2), 'utf8');
    logger.info(`Updated JSON file ${filePath} with nametag for ${normalizedAddress}`);

    if (NAMETAG_CACHE) {
      NAMETAG_CACHE[normalizedAddress] = { Address: address, Labels: labels };
    }
    logger.info(`Added/Updated nametag for ${normalizedAddress} in Firestore and JSON.`);
  } catch (error) {
    logger.error(`Error adding nametag for ${normalizedAddress}: ${error.message}`);
    throw error;
  }
}

export default async function handler(req, res) {
  // Apply security headers
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://ipfs.io https://pbs.twimg.com; connect-src 'self' https://api.geckoterminal.com;",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });

  const secrets = await getSecrets();
  const INTERNAL_API_TOKEN = secrets.INTERNAL_API_TOKEN;

  try {
  await new Promise((resolve, reject) => {
    limiter(req, res, (err) => (err ? reject(err) : resolve()));
  });
} catch (err) {
  logger.error(`Rate limit error: ${err.message}`, { stack: err.stack });
  return res.status(429).json({
    success: false,
    detail: 'Too many requests. Please try again later.',
  });
}

  let session = null;
  let isAdminUser = false;

  const internalToken = req.headers['x-internal-token'];
  if (process.env.NODE_ENV === 'development' && internalToken === INTERNAL_API_TOKEN) {
    logger.info('Bypassing auth with internal token for nametags API (development mode).');
    isAdminUser = true;
  } else if (req.method === 'PUT' || req.method === 'PATCH') {
    const authOptionsInstance = await authOptions();
    session = await getServerSession(req, res, authOptionsInstance);
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
      logger.warn('GET request without address is not supported for Market page');
      return res.status(400).json({
        success: false,
        detail: 'Address is required for GET request',
      });
    }

    const normalizedAddress = address.toLowerCase();
    const data = await getNametagForAddress(normalizedAddress);
    if (data) {
      logger.info('Name Tag found for address:', {
        address: normalizedAddress,
        nameTag: data.Labels[Object.keys(data.Labels)[0]]['Name Tag'],
      });
      return res.status(200).json({
        success: true,
        data: { [normalizedAddress]: data },
      });
    } else {
      logger.info(`Name Tag not found for address: ${normalizedAddress}`);
      return res.status(404).json({
        success: false,
        detail: `Name Tag not found for address ${normalizedAddress}`,
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
    const result = {};
    for (const addr of normalizedAddresses) {
      const data = await getNametagForAddress(addr);
      if (data) {
        result[addr] = data;
        logger.info('Name Tag found for address in POST:', {
          address: addr,
          nameTag: data.Labels[Object.keys(data.Labels)[0]]['Name Tag'],
        });
      } else {
        result[addr] = {
          Address: addr,
          Labels: {
            'deposit': {
              'Name Tag': 'Unknown',
              'Description': 'Not found in JSON.',
              'Subcategory': 'Deposit',
              'image': '/icons/default.png'
            }
          }
        };
      }
    }

    logger.info('POST request processed:', {
      requested: normalizedAddresses.length,
      found: Object.keys(result).length,
    });

    return res.status(200).json({
      success: true,
      data: result,
      metadata: {
        requested: normalizedAddresses.length,
        found: Object.keys(result).length,
      },
    });
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
      await addNametag(address, labels);
      return res.status(200).json({
        success: true,
        detail: `Name tag for ${address} successfully added/updated.`,
        data: { address, labels }
      });
    } catch (error) {
      logger.error(`Failed to add/update nametag for ${address}: ${error.message}`);
      return res.status(500).json({
        success: false,
        detail: 'Failed to add/update nametag.',
        error: error.message
      });
    }
  }

  logger.warn(`Method not allowed: ${req.method}`);
  return res.status(405).json({
    success: false,
    detail: 'Method not allowed',
  });
}