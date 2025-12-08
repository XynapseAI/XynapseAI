// app/api/etf-data/route.js
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import Bottleneck from 'bottleneck';
import { logger } from '../../../utils/serverLogger'; // Giả sử bạn có logger, nếu không thì comment out hoặc thêm
import { createClient } from 'redis';

const limiterBottleneck = new Bottleneck({
  maxConcurrent: 3,
  minTime: 250,
});

// Allowed origins
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
      if (logger) logger.info(`Origin allowed: ${origin}`);
      return true;
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin) || new URL(refOrigin).hostname.endsWith('xynapseai.net')) {
        if (logger) logger.info(`Referer origin allowed: ${refOrigin}`);
        return true;
      }
    }
    if (!origin && !referer) {
      if (logger) logger.info('Allowing internal/SSR request');
      return true;
    }
    if (!origin && process.env.NODE_ENV === 'development') {
      if (logger) logger.warn('Origin is null, allowing in development mode');
      return true;
    }
    if (logger) logger.error(`CORS blocked: Origin=${origin || 'null'}, Referer=${referer || 'null'}`);
    return false;
  } catch (err) {
    if (logger) logger.error(`Error in isAllowedOrigin: ${err.message}`, { origin, referer });
    return false;
  }
}

// Redis Client
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }));
    await redisClient.connect();
    if (logger) logger.info('Redis connected for etf-data');
  } else if (!redisClient.isOpen) {
    await redisClient.connect();
    if (logger) logger.info('Redis reconnected for etf-data');
  }
  return redisClient;
}

// CORS wrapper
const handlerWrapper = (handler) =>
  limiterBottleneck.wrap(async (req) => {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const origin = req.headers.get('origin');
    const referer = req.headers.get('referer');
    const startTime = Date.now();
    if (logger) logger.info(`Request to /api/etf-data from IP ${ip}, Origin: ${origin || 'null'}, Referer: ${referer || 'null'}`);

    if (!isAllowedOrigin(origin, referer)) {
      return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
    }

    const res = await handler(req);
    const allowOrigin = origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
    res.headers.set('Access-Control-Allow-Origin', allowOrigin);
    res.headers.set('Access-Control-Allow-Methods', 'GET');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    res.headers.set('Content-Security-Policy', "default-src 'self'");
    if (logger) logger.info(`Response for /api/etf-data, time: ${Date.now() - startTime}ms`, { ip });
    return res;
  });

const getSymbolFromName = (nameTag) => {
  const lower = nameTag.toLowerCase();
  if (lower.includes('ishares')) return 'IBIT';
  if (lower.includes('fidelity')) return 'FBTC';
  if (lower.includes('grayscale') && lower.includes('mini')) return 'BTC';
  if (lower.includes('grayscale')) return 'GBTC';
  if (lower.includes('bitwise')) return 'BITB';
  if (lower.includes('ark 21shares') || lower.includes('21shares')) return 'ARKB';
  if (lower.includes('vaneck')) return 'HODL';
  if (lower.includes('invesco galaxy')) return 'BTCO';
  if (lower.includes('valkyrie')) return 'BRRR';
  if (lower.includes('franklin')) return 'EZBC';
  if (lower.includes('wisdomtree')) return 'BTCW';
  if (lower.includes('hashdex')) return 'DEFI';
  return nameTag.split(' ')[0].toUpperCase();
};

const keywordToImage = {
  'ishares': '/icons/blackrock.webp',
  'fidelity': '/icons/fidelity.webp',
  'grayscale': '/icons/grayscale.webp',
  'bitwise': '/icons/bitwise.webp',
  'ark': '/icons/21shares.webp',
  'vaneck': '/icons/vaneck.webp',
  'invesco': '/icons/invesco.webp',
  'valkyrie': '/icons/valkyrie.webp',
  'franklin': '/icons/franklin.webp',
  'wisdomtree': '/icons/wisdom.webp',
  'hashdex': '/icons/hashdex.webp',
  default: '/icons/bitcoin.webp',
};

const getImageForEtf = (name) => {
  const lowerName = name.toLowerCase();
  for (const [key, img] of Object.entries(keywordToImage)) {
    if (lowerName.includes(key)) return img;
  }
  return keywordToImage.default;
};

export const GET = handlerWrapper(async () => {
  const startOverall = Date.now();
  try {
    const redis = await getRedisClient();
    const cacheKey = 'etf-data:all';
    const cached = await redis.get(cacheKey);
    if (cached) {
      if (logger) logger.info(`Cache hit for etf-data: ${cacheKey}`);
      const result = JSON.parse(cached);
      const overallDuration = Date.now() - startOverall;
      if (logger) logger.info(`Full API handler completed in ${overallDuration}ms (cache hit)`);
      return NextResponse.json(result);
    }

    const btcResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', {
      headers: {
        'Accept': 'application/json',
      },
    });
    if (!btcResponse.ok) {
      throw new Error(`Coingecko API error: ${btcResponse.status}`);
    }
    const btcData = await btcResponse.json();
    const btcPrice = btcData.bitcoin?.usd || 100000;

    const holdersPath = path.join(process.cwd(), 'public/nametags/bitcoin-top-holders.json');
    const flowsPath = path.join(process.cwd(), 'public/data/etf-flows.json');

    const holdersData = JSON.parse(await fs.readFile(holdersPath, 'utf8'));
    const flows = JSON.parse(await fs.readFile(flowsPath, 'utf8'));

    const etfs = Object.values(holdersData).filter(item => {
      const nameTag = item.Labels?.bitcoin?.['Name Tag'] || '';
      const lower = nameTag.toLowerCase();
      return lower.includes('bitcoin') && (lower.includes('etf') || lower.includes('fund') || lower.includes('trust'));
    });

    const validFlows = flows
      .filter(f => f.date && typeof f.date === 'string' && f.date.match(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/) && !f.isSummary)
      .sort((a, b) => new Date(b.date.replace(/(\w+) (\d+), (\d+)/, '$1 $2 $3')) - new Date(a.date.replace(/(\w+) (\d+), (\d+)/, '$1 $2 $3')));

    // Top 6 ETFs cho chart
    const topSymbols = ['IBIT', 'FBTC', 'ARKB', 'BTC', 'GBTC', 'HODL'];

    const chartData = validFlows
      .filter(f => topSymbols.includes(f.symbol))
      .reduce((acc, f) => {
        if (!acc[f.date]) acc[f.date] = { date: f.date };
        acc[f.date][f.symbol] = f.flow;
        return acc;
      }, {});
    let chartArray = Object.values(chartData);
    chartArray.sort((a, b) => new Date(a.date.replace(/(\w+) (\d+), (\d+)/, '$1 $2 $3')) - new Date(b.date.replace(/(\w+) (\d+), (\d+)/, '$1 $2 $3')));

    const flowChartData = chartArray.map(d => {
      const values = Object.values(d).filter(v => typeof v === 'number');
      const inflow = values.filter(v => v > 0).reduce((a, b) => a + b, 0) || 0;
      const outflow = Math.abs(values.filter(v => v < 0).reduce((a, b) => a + b, 0)) || 0;
      return { date: d.date, inflow, outflow };
    });

    const tableData = etfs
      .map(holder => {
        const nameTag = holder.Labels?.bitcoin?.['Name Tag'] || '';
        const symbol = getSymbolFromName(nameTag);
        const latestFlow = validFlows.find(f => f.symbol === symbol);
        const flowValue = Number(latestFlow?.flow || 0);
        return {
          name: nameTag,
          symbol,
          image: holder.Labels?.bitcoin?.image || getImageForEtf(nameTag),
          totalHolding: Number(holder.Balance || 0),
          valueUSD: Number(holder.Balance || 0) * btcPrice,
          inflow: flowValue > 0 ? flowValue : 0,
          outflow: flowValue < 0 ? Math.abs(flowValue) : 0,
        };
      })
      .sort((a, b) => b.totalHolding - a.totalHolding);

    const result = { chartArray, flowChartData, tableData };
    
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 86400);
    if (logger) logger.info(`Cached etf-data: ${cacheKey}`);

    const overallDuration = Date.now() - startOverall;
    if (logger) logger.info(`Full API handler completed in ${overallDuration}ms`);

    return NextResponse.json(result);
  } catch (err) {
    const overallDuration = Date.now() - startOverall;
    if (logger) logger.error(`Error in /api/etf-data after ${overallDuration}ms: ${err.message}`, { stack: err.stack });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});