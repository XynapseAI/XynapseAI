// /pages/api/dex.js
import axios from 'axios';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { check, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import pLimit from 'p-limit';
import { GECKOTERMINAL_CHAIN_MAPPING } from '../../components/MarketTabLogic';

// Initialize p-limit for request throttling
const limit = pLimit(5);

// In-memory cache
const cache = new Map();
const CACHE_DURATION = 60 * 1000; // 5 minutes

// CORS configuration with strict origin validation
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'https://xynapse-ai.vercel.app',
].filter(Boolean);

if (!process.env.NEXT_PUBLIC_APP_URL && process.env.NODE_ENV === 'production') {
  throw new Error('NEXT_PUBLIC_APP_URL must be set in production');
}

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['POST'],
  credentials: true,
};

// User-based rate limiting
const userRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute per user
  keyGenerator: (req) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      return decoded.userId || 'anonymous'; // Assumes userId in JWT payload
    } catch {
      return 'invalid_token';
    }
  },
  message: { detail: 'Too many DEX requests for this user. Please try again later.' },
});

// Input validation and sanitization
const sanitizeInput = (value) => value.replace(/[^a-zA-Z0-9-_]/g, '');
const validateInput = [
  check('chain').customSanitizer(sanitizeInput).isIn(Object.keys(GECKOTERMINAL_CHAIN_MAPPING)).withMessage('Invalid chain'),
  check('tokenAddress').customSanitizer(sanitizeInput).matches(/^0x[a-fA-F0-9]{40}$/).withMessage('Invalid token address'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ detail: errors.array()[0].msg });
    }
    next();
  },
];

// JWT authentication middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ detail: 'Unauthorized: No token provided' });
  }
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not set');
    }
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (error) {
    console.error('JWT verification failed:', { message: error.message, timestamp: new Date().toISOString() });
    res.status(401).json({ detail: 'Unauthorized: Invalid token' });
  }
};

// Retry mechanism for API requests
const retryRequest = async (url, options, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await limit(() => axios.get(url, options));
    } catch (error) {
      if (i === retries - 1 || ![429, 503].includes(error.response?.status)) {
        throw error;
      }
      console.log(`Retrying request to ${url} after ${Math.pow(2, i) * 1000}ms, attempt ${i + 1}`);
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
};

export default async function handler(req, res) {
  // Apply security headers
  res.set({
    'Content-Security-Policy': "default-src 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });

  // Apply CORS
  cors(corsOptions)(req, res, async () => {
    // Apply rate limiting
    userRateLimiter(req, res, async () => {
      if (req.method !== 'POST') {
        return res.status(405).json({ detail: 'Method not allowed' });
      }

      // Apply authentication
      authenticate(req, res, async () => {
        // Apply input validation
        validateInput(req, res, async () => {
          const { chain, tokenAddress } = req.body;

          // Log request with sanitized data
          console.log('Processing DEX request:', {
            chain,
            tokenAddress: tokenAddress.slice(0, 6) + '...',
            timestamp: new Date().toISOString(),
          });

          // Check cache
          const cacheKey = `${chain}-${tokenAddress}`;
          if (cache.has(cacheKey) && Date.now() - cache.get(cacheKey).timestamp < CACHE_DURATION) {
            console.log('Serving DEX data from cache:', { cacheKey });
            return res.status(200).json(cache.get(cacheKey).data);
          }

          try {
            const url = `https://api.geckoterminal.com/api/v2/networks/${GECKOTERMINAL_CHAIN_MAPPING[chain]}/tokens/${tokenAddress}/pools?page=1`;
            const response = await retryRequest(url, {
              headers: { accept: 'application/json' },
              timeout: 10000, // Increased timeout
            });

            // Cache the response
            cache.set(cacheKey, { data: response.data, timestamp: Date.now() });
            console.log('DEX data fetched:', { cacheKey, poolCount: response.data?.data?.length || 0 });

            res.status(200).json(response.data);
          } catch (error) {
            const status = error.response?.status || 500;
            const detail =
              status === 429
                ? 'GeckoTerminal API rate limit exceeded. Please try again later.'
                : status === 404
                  ? `No DEX data found for token ${tokenAddress} on ${chain}.`
                  : 'An unexpected error occurred while fetching DEX data';
            console.error('Error fetching DEX data:', {
              status,
              detail,
              timestamp: new Date().toISOString(),
            });
            res.status(status).json({ detail });
          }
        });
      });
    });
  });
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2kb', // Limit POST body size
    },
  },
};