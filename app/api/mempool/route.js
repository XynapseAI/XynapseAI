// app/api/mempool/route.js - Simplified for speed
import { NextResponse } from 'next/server';
import { logger } from '../../../utils/serverLogger';
import { z } from 'zod';

const bodySchema = z.object({
  action: z.literal('tx-details'),
  txHash: z.string().refine((val) => /^[a-fA-F0-9]{64}$/.test(val), { message: 'Invalid Bitcoin transaction hash' }),
});

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://farcaster.xynapseai.net',
  "https://base.xynapseai.net",
  'https://xynapse-ai-xynapse-projects.vercel.app',
].filter(Boolean);

function isAllowedOrigin(origin, referer) {
  try {
    if (origin && (allowedOrigins.includes(origin) || new URL(origin).hostname.endsWith('xynapseai.net'))) {
      return true;
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin) || new URL(refOrigin).hostname.endsWith('xynapseai.net')) {
        return true;
      }
    }
    if (!origin && !referer) {
      return true;
    }
    if (!origin && process.env.NODE_ENV === 'development') {
      return true;
    }
    return false;
  } catch {
    return false; 
  }
}

// Native fetch with timeout (no axios/Bottleneck for speed)
async function fetchTx(txHash) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  const startTime = Date.now();
  logger.info(`Starting fetch for tx ${txHash} at ${new Date().toISOString()}`);

  try {
    const response = await fetch(`https://mempool.space/api/tx/${txHash}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'xynapse-bot/1.0' }, // Mimic curl
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const duration = Date.now() - startTime;
    logger.info(`Mempool fetch completed in ${duration}ms`, { txHash, size: JSON.stringify(data).length });

    return { success: true, data };
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    logger.error(`Mempool fetch failed after ${duration}ms`, { txHash, error: error.message, name: error.name });
    throw error;
  }
}

export async function POST(request) {
  const startOverall = Date.now();
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (!isAllowedOrigin(origin, referer)) {
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.error('Invalid JSON body', { error: err.message });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = bodySchema.parse(body);
  } catch (err) {
    logger.warn('Validation failed', { errors: err.errors });
    return NextResponse.json({ detail: 'Validation failed', errors: err.errors }, { status: 400 });
  }

  const { action, txHash } = parsedBody;
  if (action !== 'tx-details') {
    return NextResponse.json({ detail: 'Invalid action' }, { status: 400 });
  }

  try {
    const result = await fetchTx(txHash);
    const overallDuration = Date.now() - startOverall;
    logger.info(`Full API handler completed in ${overallDuration}ms`, { txHash });

    const res = NextResponse.json(result);
    const allowOrigin = origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
    res.headers.set('Access-Control-Allow-Origin', allowOrigin);
    res.headers.set('Access-Control-Allow-Methods', 'POST');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return res;
  } catch (error) {
    const overallDuration = Date.now() - startOverall;
    logger.error(`Full API error after ${overallDuration}ms`, { txHash, error: error.message, stack: error.stack });
    const detail = error.name === 'AbortError' ? 'Request timeout - network slow, retry?' : (error.message.includes('not found') ? 'Transaction not found' : 'API error');
    return NextResponse.json({ detail }, { status: 500 });
  }
}