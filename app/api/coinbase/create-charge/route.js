import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { z } from 'zod';
import crypto from 'crypto';
import { logger } from '../../../../utils/serverLogger';
import { verifyRecaptcha } from '../../../../utils/verifyRecaptcha';
import { requireAuth } from '../../middleware/auth';

// --- IMPROVEMENT: Singleton pattern for Prisma Client in serverless environments ---
const globalForPrisma = global;
const prisma = globalForPrisma.prisma || new PrismaClient({
    errorFormat: 'minimal',
    datasources: { db: { url: process.env.DATABASE_URL } },
});
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;


// --- IMPROVEMENT: Singleton pattern for Redis Client ---
let redisClient;
async function getRedisClient() {
    if (redisClient && redisClient.isOpen) {
        return redisClient;
    }
    const redisUrl = process.env.NODE_ENV === 'production'
        ? process.env.REDIS_URL || 'rediss://localhost:6379' // Use rediss:// for TLS in production
        : process.env.REDIS_URL || 'redis://localhost:6379';

    if (!redisClient) {
        redisClient = createClient({ url: redisUrl });
        redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }));
        redisClient.on('connect', () => logger.info('Redis Client Connected'));
    }

    if (!redisClient.isOpen) {
        await redisClient.connect();
    }
    return redisClient;
}


const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'https://xynapseai.net',
    'https://www.xynapseai.net',
    'https://xynapse-ai-xynapse-projects.vercel.app',
    'https://farcaster.xynapseai.net',
    'https://xynapse-ai.vercel.app',
].filter(Boolean);


async function isAllowedOrigin(origin, referer, ip) {
    try {
        const check = (originToCheck) => {
            if (!originToCheck || originToCheck === 'null') return false;
            if (process.env.NODE_ENV === 'production' && !originToCheck.startsWith('https://')) {
                logger.warn('Blocked non-HTTPS origin/referer in production', { ip, origin: originToCheck });
                trackViolation(ip, 'Non-HTTPS origin/referer in production');
                return false;
            }
            return allowedOrigins.includes(originToCheck);
        };

        if (origin && check(origin)) return true;
        if (referer) {
            const refererOrigin = new URL(referer).origin;
            if (check(refererOrigin)) return true;
        }
        
        if (process.env.NODE_ENV === 'development' && !origin && !referer) {
            logger.info('Allowing server-side/tooling request in development', { ip });
            return true;
        }

        await trackViolation(ip, 'Invalid origin or referer');
        return false;
    } catch (err) {
        logger.error('Error validating origin', { error: err.message, ip, origin, referer });
        await trackViolation(ip, 'Error validating origin');
        return false;
    }
}

async function trackViolation(ip, reason) {
    try {
        const client = await getRedisClient();
        const key = `violations:${ip}`;
        const violations = (await client.incr(key));

        if (violations === 1) {
            // Set expiration on the first violation in this window
            await client.expire(key, 15 * 60); // 15 minutes
        }

        if (violations > 5) {
            await client.setEx(`banned_ip:${ip}`, 3600, 'banned'); // Ban for 1 hour
            logger.warn('IP has been banned', { ip, reason });
            throw new Error('IP banned due to repeated violations.');
        }
        logger.warn('Violation recorded', { ip, reason, violations });
    } catch (error) {
         // Prevent trackViolation from crashing the main request if Redis fails
         logger.error("Failed to track violation", { error: error.message, ip, reason });
    }
}

async function checkRateLimit(ip, userId = null) {
    const client = await getRedisClient();
    const windowSeconds = 5 * 60; // 15 minutes
    const ipMax = process.env.NODE_ENV === 'development' ? 100 : 10;
    const userMax = process.env.NODE_ENV === 'development' ? 50 : 10;

    const multi = client.multi();
    const ipKey = `rate:ip:${ip}`;
    multi.incr(ipKey);
    multi.expire(ipKey, windowSeconds, 'NX'); // 'NX' sets expiry only if it doesn't exist

    let userKey;
    if (userId) {
        userKey = `rate:user:${userId}`;
        multi.incr(userKey);
        multi.expire(userKey, windowSeconds, 'NX');
    }

    const replies = await multi.exec();
    const ipCount = replies[0];

    if (ipCount > ipMax) throw new Error('Too many requests from this IP address.');
    
    if (userKey) {
        const userCount = replies[2];
        if (userCount > userMax) throw new Error('Too many requests for this user.');
    }
}

// --- FIX 1: Secure CSRF Protection (Synchronizer Token Pattern) ---
async function verifyCSRFToken(request, userId) {
    const headerToken = request.headers.get('x-csrf-token');

    if (process.env.NODE_ENV === 'development' && headerToken === 'dev-csrf') {
        logger.info('Development CSRF bypass used');
        return true;
    }
    
    if (!headerToken) {
        logger.warn('CSRF token missing from header', { userId });
        return false;
    }

    const client = await getRedisClient();
    const storedToken = await client.get(`csrf:${userId}`);

    if (!storedToken) {
        logger.warn('CSRF token not found in Redis for user', { userId });
        return false;
    }

    // Use timingSafeEqual to prevent timing attacks
    const valid = crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(storedToken));
    
    if (!valid) {
        logger.warn('CSRF token mismatch', { userId });
    }
    
    // Tokens are single-use; delete after verification
    await client.del(`csrf:${userId}`);

    return valid;
}


function securityHeaders(origin) {
    const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';";
    const headers = {
        'Content-Security-Policy': csp,
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
        'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    };
    if (origin && allowedOrigins.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type, X-CSRF-Token, X-Recaptcha-Token';
        headers['Access-Control-Allow-Credentials'] = 'true';
    }
    return headers;
}

// --- FIX 2: Removed `userId` from schema. It must come from the session. ---
const postSchema = z.object({
    plan: z.enum(['basic', 'premium', 'pro']),
});

const planPricing = {
    basic: { amount: 5.00, currency: 'USD' },
    premium: { amount: 10.00, currency: 'USD' },
    pro: { amount: 20.00, currency: 'USD' },
};

export async function POST(req) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const origin = req.headers.get('origin');
    const referer = req.headers.get('referer');
    const headers = securityHeaders(origin);

    try {
        if (!(await isAllowedOrigin(origin, referer, ip))) {
            return NextResponse.json({ detail: 'Request not allowed by CORS policy.' }, { status: 403, headers });
        }
        
        const session = await requireAuth(req);
        if (!(session instanceof Object)) {
            await trackViolation(ip, 'Authentication failed');
            return session; // requireAuth returns a NextResponse on failure
        }
        
        // --- FIX 2: Get trusted userId from session ---
        const userId = session.user.id;
        if (!userId) {
             await trackViolation(ip, 'User ID missing from session');
             return NextResponse.json({ detail: 'Invalid session data.' }, { status: 401, headers });
        }

        await checkRateLimit(ip, userId);

        if (!(await verifyCSRFToken(req, userId))) {
            await trackViolation(ip, 'Invalid CSRF token');
            return NextResponse.json({ detail: 'Invalid security token. Please refresh the page.' }, { status: 403, headers });
        }
        
        const recaptchaToken = req.headers.get('x-recaptcha-token');
        if (process.env.NODE_ENV !== 'development') {
            if (!recaptchaToken) {
                await trackViolation(ip, 'Missing reCAPTCHA token');
                return NextResponse.json({ detail: 'reCAPTCHA verification is required.' }, { status: 400, headers });
            }
            const { score } = await verifyRecaptcha(recaptchaToken, 'create_charge', ip);
            if (score < 0.7) { // Stricter score for payment actions
                await trackViolation(ip, `reCAPTCHA score too low: ${score}`);
                return NextResponse.json({ detail: 'reCAPTCHA verification failed.' }, { status: 403, headers });
            }
        }
        
        const body = await req.json();
        const { plan } = postSchema.parse(body);

        const userExists = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
        if (!userExists) {
            await trackViolation(ip, 'User not found in database');
            return NextResponse.json({ detail: 'User not found.' }, { status: 404, headers });
        }

        if (!process.env.COINBASE_COMMERCE_API_KEY) {
            logger.error('COINBASE_COMMERCE_API_KEY is not set');
            return NextResponse.json({ detail: 'Server configuration error.' }, { status: 500, headers });
        }
        
        const { amount, currency } = planPricing[plan];
        const chargeData = {
            name: `${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan Upgrade`,
            description: `Upgrade to ${plan} plan for user ${userId.substring(0, 8)}...`,
            local_price: { amount: amount.toFixed(2), currency },
            metadata: { userId, plan }, // Use trusted userId
            pricing_type: 'fixed_price',
        };

        const response = await fetch('https://api.commerce.coinbase.com/charges', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CC-Api-Key': process.env.COINBASE_COMMERCE_API_KEY,
                'X-CC-Version': '2018-03-22',
            },
            body: JSON.stringify(chargeData),
        });

        const charge = await response.json();
        if (!response.ok) {
            logger.error('Coinbase API error', { status: response.status, coinbaseError: charge.error });
            return NextResponse.json({ detail: 'Failed to create payment charge with our provider.' }, { status: 502, headers });
        }

        await prisma.payment.create({
            data: {
                userId,
                chargeId: charge.data.id,
                chargeCode: charge.data.code,
                amount: parseFloat(amount.toFixed(2)),
                currency,
                status: 'pending',
            },
        });

        logger.info('Coinbase charge successfully created', { chargeId: charge.data.id, userId });
        return NextResponse.json({ success: true, hostedUrl: charge.data.hosted_url }, { headers });

    } catch (error) {
        logger.error('An unexpected error occurred in create-charge', {
            error: error.message,
            stack: error.stack,
            ip,
        });
        
        if (error instanceof z.ZodError) {
            await trackViolation(ip, 'Invalid request body format');
            return NextResponse.json({ detail: 'Invalid request data.', errors: error.errors }, { status: 400, headers });
        }
        
        if (error.message.includes('Too many requests') || error.message.includes('banned')) {
            return NextResponse.json({ detail: error.message }, { status: 429, headers });
        }
        
        return NextResponse.json({ detail: 'An internal server error occurred.' }, { status: 500, headers });
    }
}

export async function OPTIONS(req) {
    const origin = req.headers.get('origin');
    const headers = securityHeaders(origin);
    return new NextResponse(null, { status: 204, headers });
}