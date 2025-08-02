// app/api/nametags/route.js
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { getRedisClient } from '../../../lib/redis';
import { auth } from '../auth/[...nextauth]/route';
import { query } from '../../../utils/postgres';
import { isAddress } from 'ethers';
import { getNametagsBatch, addNametag } from '../../../lib/nametags';

async function checkRateLimit(ip) {
  const redisClient = await getRedisClient();
  const key = `rate_limit:nametags:${ip}`;
  const requests = parseInt(await redisClient.get(key)) || 0;
  const windowMs = 60 * 1000;
  if (requests >= 500) {
    throw new Error('Too many requests. Please try again later.');
  }
  await redisClient
    .multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

const allowedOrigins = [
  process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://postgres-production-e852c.up.railway.app',
  'https://xynapseai-production.up.railway.app',
];

async function checkCSRF(request) {
  const origin = request.headers.get('origin') || request.headers.get('referer')?.split('/').slice(0, 3).join('/');
  if (!origin || !allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
    logger.warn(`Invalid or missing Origin/Referer header: ${origin}`);
    return false;
  }
  return true;
}

async function checkAdminStatus(uid) {
  if (!uid) return false;
  try {
    const adminResult = await query(`SELECT is_admin FROM admins WHERE uid = $1`, [uid]);
    logger.info(`Checked admin status for UID ${uid}: ${adminResult.rows.length > 0 && adminResult.rows[0].is_admin}`);
    return adminResult.rows.length > 0 && adminResult.rows[0].is_admin === true;
  } catch (error) {
    logger.error(`Error checking admin status for ${uid}: ${error.message}`, { stack: error.stack });
    return false;
  }
}

async function getWalletAnalysis(address) {
  try {
    const result = await query(
      `SELECT is_deposit, deposit_confidence_percentage, nametag, image, reason, metrics, gemini_analysis, last_analysis
       FROM wallet_analysis
       WHERE wallet = $1`,
      [address.toLowerCase()]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    logger.error(`Error fetching wallet analysis for ${address}: ${error.message}`, { stack: error.stack });
    return null;
  }
}

const getSchema = z.object({
  address: z.string().optional().refine((val) => !val || isAddress(val), { message: 'Invalid EVM address' }),
});

const postSchema = z.object({
  addresses: z
    .array(z.string().refine(isAddress, { message: 'Each address must be a valid EVM address' }))
    .min(1)
    .max(100, 'Addresses must be a non-empty array, maximum 100 addresses'),
});

const putSchema = z.object({
  address: z.string().refine(isAddress, { message: 'Address must be a valid EVM address' }),
  labels: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      subcategory: z.string().optional(),
      image: z.string().optional(),
      deposit: z
        .object({
          'Name Tag': z.string().optional(),
          Description: z.string().optional(),
          Subcategory: z.string().optional(),
          image: z.string().optional(),
        })
        .optional(),
    })
    .refine(
      (data) => Object.keys(data).length > 0 || (data.deposit && Object.keys(data.deposit).length > 0),
      { message: 'Labels or labels.deposit must be a non-empty object' }
    ),
});

export async function GET(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`GET request to /api/nametags from IP ${ip}`);

  if (!(await checkCSRF(request))) {
    return NextResponse.json({ error: 'Invalid or missing Origin/Referer header.' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.warn(`Rate limit exceeded for nametags API: ${err.message}`);
    return NextResponse.json({ success: false, detail: err.message }, { status: 429 });
  }

  let parsedParams;
  try {
    parsedParams = getSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400 });
  }

  const { address } = parsedParams;
  if (!address) {
    logger.warn('GET request without address is not supported');
    return NextResponse.json({ success: false, detail: 'Address is required for GET request' }, { status: 400 });
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
      return NextResponse.json({ success: true, data: { [normalizedAddress]: responseData } }, { status: 200 });
    }
    logger.info(`Nametag not found for address: ${normalizedAddress}`);
    return NextResponse.json(
      { success: false, detail: `Nametag not found for address ${normalizedAddress}` },
      { status: 404 }
    );
  } catch (error) {
    logger.error(`Error fetching nametag for ${normalizedAddress}: ${error.message}`, { stack: error.stack });
    return NextResponse.json(
      { success: false, detail: `Failed to fetch nametag: ${error.message}` },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`POST request to /api/nametags from IP ${ip}`);

  if (!(await checkCSRF(request))) {
    return NextResponse.json({ error: 'Invalid or missing Origin/Referer header.' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.warn(`Rate limit exceeded for nametags API: ${err.message}`);
    return NextResponse.json({ success: false, detail: err.message }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = postSchema.parse(body);
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400 });
  }

  const { addresses } = parsedBody;
  const normalizedAddresses = addresses.map((addr) => addr.toLowerCase());

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
    return NextResponse.json(
      {
        success: true,
        data: result,
        metadata: { requested: normalizedAddresses.length, found: Object.keys(result).length },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error(`Error fetching batch nametags: ${error.message}`, { stack: error.stack });
    return NextResponse.json(
      { success: false, detail: `Failed to fetch nametags: ${error.message}` },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`PUT request to /api/nametags from IP ${ip}`);

  if (!(await checkCSRF(request))) {
    return NextResponse.json({ error: 'Invalid or missing Origin/Referer header.' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.warn(`Rate limit exceeded for nametags API: ${err.message}`);
    return NextResponse.json({ success: false, detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session) {
    logger.warn('Unauthorized access attempt to nametags API (no session for PUT)');
    return NextResponse.json({ success: false, detail: 'Unauthorized: Please log in.' }, { status: 401 });
  }

  const isAdminUser = await checkAdminStatus(session.user.id);
  if (!isAdminUser) {
    logger.warn(`Forbidden access attempt to nametags API by non-admin user: ${session.user.id}`);
    return NextResponse.json({ success: false, detail: 'Forbidden: Admin access required.' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = putSchema.parse(body);
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400 });
  }

  const { address, labels } = parsedBody;
  try {
    const normalizedLabels = {
      name: labels.deposit?.['Name Tag'] || labels.name || 'Unknown',
      description: labels.deposit?.Description || labels.description || '',
      subcategory: labels.deposit?.Subcategory || labels.subcategory || 'Others',
      image: labels.deposit?.image || labels.image || '/icons/default.png',
    };
    await addNametag(address, normalizedLabels);
    logger.info(`Nametag added/updated for ${address}: ${JSON.stringify(normalizedLabels)}`);
    return NextResponse.json(
      {
        success: true,
        detail: `Nametag for ${address} successfully added/updated.`,
        data: { address, labels: normalizedLabels },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error(`Failed to add/update nametag for ${address}: ${error.message}`, { stack: error.stack });
    return NextResponse.json(
      { success: false, detail: `Failed to add/update nametag: ${error.message}` },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  return PUT(request); // Reuse PUT logic for PATCH
}