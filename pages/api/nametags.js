// pages/api/nametags.js
import fs from 'fs';
import path from 'path';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { RateLimiter } from 'limiter';
import { logger } from '../../utils/logger';
import { query, body, validationResult } from 'express-validator';
// Import db từ firebaseAdmin để kiểm tra quyền admin cho các thao tác ghi
import { db } from '../../utils/firebaseAdmin'; 
// Import các hàm addNametag từ lib/nametags cho thao tác ghi (PUT/PATCH)
import { addNametag } from '../../lib/nametags';

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

// Thêm validation cho PUT/PATCH request
const validatePut = [
    body('address')
        .notEmpty()
        .matches(/^0x[a-fA-F0-9]{40}$/)
        .withMessage('Address must be a valid EVM address'),
    body('labels') // Expecting a 'labels' object
        .isObject()
        .notEmpty()
        .withMessage('Labels must be a non-empty object.'),
];

// Hàm kiểm tra quyền admin từ phía server (cần db để truy cập Firestore)
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

export default async function handler(req, res) {
    // Check rate limit
    const remainingRequests = await limiter.removeTokens(1);
    if (remainingRequests < 0) {
        logger.warn('Rate limit exceeded for nametags API');
        return res.status(429).json({
            success: false,
            detail: 'Too many requests. Please try again later.',
        });
    }

    // --- Authentication & Authorization Logic ---
    // GET and POST requests: Public access (no session required)
    // PUT and PATCH requests: Admin access required (via session or internal token in dev)

    // Only fetch session and check admin status if it's a PUT/PATCH request
    let session = null;
    let isAdminUser = false;

    // Check for internal token bypass (mainly for dev or server-to-server calls that don't involve user sessions)
    const internalToken = req.headers['x-internal-token'];
    if (process.env.NODE_ENV === 'development' && internalToken === process.env.INTERNAL_API_TOKEN) {
        logger.info('Bypassing auth with internal token for nametags API (development mode).');
        isAdminUser = true; // Assume admin for dev internal token
    } else if (req.method === 'PUT' || req.method === 'PATCH') {
        // For PUT/PATCH, strictly require admin access via user session
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
            logger.warn(`Forbidden access attempt to nametags API (PUT/PATCH) by non-admin user: ${session?.user?.id || 'N/A'}`);
            return res.status(403).json({
                success: false,
                detail: 'Forbidden: Admin access required for this operation.',
            });
        }
    }

    // Load data from static JSON files for GET/POST requests
    const nametagsDir = path.join(process.cwd(), 'public', 'nametags');
    const files = fs.readdirSync(nametagsDir).filter((file) => file.startsWith('addresses-') && file.endsWith('.json'));

    const loadAllAddresses = () => {
        const allData = {};
        for (const file of files) {
            try {
                const filePath = path.join(nametagsDir, file);
                const fileContent = fs.readFileSync(filePath, 'utf8');
                const jsonData = JSON.parse(fileContent);
                // Ensure Labels exist and have at least one key for consistent structure
                for (const addressKey in jsonData) {
                    if (jsonData[addressKey].Labels && Object.keys(jsonData[addressKey].Labels).length > 0) {
                        const firstLabelKey = Object.keys(jsonData[addressKey].Labels)[0];
                        const labelData = jsonData[addressKey].Labels[firstLabelKey];
                        jsonData[addressKey].Labels[firstLabelKey].image = labelData.image || '/icons/default.png';
                    } else {
                         // Fallback for missing or empty Labels, ensure image
                        jsonData[addressKey].Labels = {
                            'default': {
                                'Name Tag': 'Unknown',
                                'Description': 'No specific label information.',
                                'image': '/icons/default.png'
                            }
                        };
                    }
                }
                Object.assign(allData, jsonData);
            } catch (error) {
                logger.error(`Error reading file ${file}:`, { message: error.message });
            }
        }
        return allData;
    };

    // --- GET Request (Public access) ---
    if (req.method === 'GET') {
        await Promise.all(validateGet.map((validation) => validation.run(req)));
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            logger.warn(`Validation errors in GET request: ${JSON.stringify(errors.array())}`);
            return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
        }

        const { address, page = 1 } = req.query;

        if (address) {
            const normalizedAddress = address.toLowerCase();
            const allData = loadAllAddresses();

            if (allData[normalizedAddress]) {
                const labels = allData[normalizedAddress].Labels;
                // Safely get the first label key, or use 'default' if no labels
                const firstLabelKey = labels && Object.keys(labels).length > 0 ? Object.keys(labels)[0] : 'default';
                const labelData = labels?.[firstLabelKey] || { 'Name Tag': 'Unknown', image: '/icons/default.png' };

                logger.info('Name Tag found for address:', {
                    address: normalizedAddress,
                    nameTag: labelData['Name Tag'],
                    image: labelData.image,
                });
                return res.status(200).json({
                    success: true,
                    data: {
                        [normalizedAddress]: {
                            ...allData[normalizedAddress],
                            Labels: {
                                [firstLabelKey]: {
                                    ...labelData,
                                    image: labelData.image || '/icons/default.png', // Ensure fallback
                                },
                            },
                        },
                    },
                });
            } else {
                logger.info(`Name Tag not found for address: ${normalizedAddress}`);
                return res.status(404).json({
                    success: false,
                    detail: `Name Tag not found for address ${normalizedAddress}`,
                });
            }
        }

        const pageNum = parseInt(page, 10);
        if (isNaN(pageNum) || pageNum < 1) {
            logger.warn(`Invalid page number: ${page}`);
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

        if (startIndex >= totalAddresses && totalAddresses > 0) { // Allow page 1 for 0 addresses
            logger.warn(`Page number out of range: ${pageNum}`);
            return res.status(400).json({
                success: false,
                detail: 'Page number out of range',
            });
        }

        const pageData = Object.fromEntries(
            addresses.slice(startIndex, endIndex).map(([addr, data]) => {
                const firstLabelKey = data.Labels && Object.keys(data.Labels).length > 0 ? Object.keys(data.Labels)[0] : 'default';
                const labelData = data.Labels?.[firstLabelKey] || { 'Name Tag': 'Unknown', image: '/icons/default.png' };
                
                return [
                    addr,
                    {
                        ...data,
                        Labels: {
                            [firstLabelKey]: {
                                ...labelData,
                                image: labelData.image || '/icons/default.png', // Ensure fallback image
                            },
                        },
                    },
                ];
            })
        );

        logger.info('Returning paginated nametags:', {
            page: pageNum,
            totalAddresses,
            totalPages,
            returnedAddresses: Object.keys(pageData).length,
        });

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

    // --- POST Request (Public access for batch fetch) ---
    if (req.method === 'POST') {
        await Promise.all(validatePost.map((validation) => validation.run(req)));
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            logger.warn(`Validation errors in POST request: ${JSON.stringify(errors.array())}`);
            return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
        }

        const { addresses } = req.body;
        const normalizedAddresses = addresses.map((addr) => addr.toLowerCase());
        const allData = loadAllAddresses();
        const result = normalizedAddresses.reduce((acc, addr) => {
            if (allData[addr]) {
                const labels = allData[addr].Labels;
                const firstLabelKey = labels && Object.keys(labels).length > 0 ? Object.keys(labels)[0] : 'default';
                const labelData = labels?.[firstLabelKey] || { 'Name Tag': 'Unknown', image: '/icons/default.png' };

                acc[addr] = {
                    ...allData[addr],
                    Labels: {
                        [firstLabelKey]: {
                            ...labelData,
                            image: labelData.image || '/icons/default.png', // Fallback image
                        },
                    },
                };
                logger.info('Name Tag found for address in POST:', {
                    address: addr,
                    nameTag: labelData['Name Tag'],
                    image: labelData.image,
                });
            } else {
                // If not found in static files, return a default "Unknown" nametag structure
                acc[addr] = {
                    Labels: {
                        'default': {
                            'Name Tag': 'Unknown',
                            'Description': 'Not found in static nametags.',
                            'image': '/icons/default.png',
                            'category': 'Untagged'
                        }
                    }
                };
            }
            return acc;
        }, {});

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

    // --- PUT/PATCH Request (Admin only, uses Firestore via lib/nametags) ---
    if (req.method === 'PUT' || req.method === 'PATCH') {
        // Validation for PUT/PATCH
        await Promise.all(validatePut.map((validation) => validation.run(req)));
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            logger.warn(`Validation errors in PUT/PATCH request: ${JSON.stringify(errors.array())}`);
            return res.status(400).json({ detail: 'Validation failed', errors: errors.array() });
        }

        const { address, labels } = req.body;

        try {
            // Use addNametag from lib/nametags to write to Firestore
            await addNametag(address, labels, address); // Assuming addNametag handles the Firestore write

            logger.info(`Successfully added/updated nametag for ${address} with custom Labels to Firestore.`);
            return res.status(200).json({
                success: true,
                detail: `Name tag for ${address} successfully added/updated with custom labels.`,
                data: { address, labels }
            });
        } catch (error) {
            logger.error(`Failed to add/update nametag for ${address} in Firestore: ${error.message}`);
            return res.status(500).json({
                success: false,
                detail: 'Failed to add/update nametag.',
                error: error.message
            });
        }
    }

    // --- Fallback for unsupported methods ---
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({
        success: false,
        detail: 'Method not allowed',
    });
}