// app/api/auth/[...nextauth]/route.js
import { randomBytes } from 'crypto';
import NextAuth from 'next-auth';
import GoogleProvider from '@auth/core/providers/google';
import EmailProvider from '@auth/core/providers/email';
import { createTransport } from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../../utils/serverLogger';
import { query } from '../../../../utils/postgres';
import { createClient } from 'redis';
import Bottleneck from 'bottleneck';
import { NextResponse } from 'next/server';

// ================== Redis Client ==================
let redisClient;
async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => logger.error('Redis Client Error', err));
    await redisClient.connect();
    logger.info('Redis connected');
  }
  return redisClient;
}

// ================== Bottleneck Rate Limiter ==================
const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});

async function checkRateLimit(ip) {
  const client = await getRedisClient();
  const key = `rate_limit:auth:${ip}`;
  const windowMs = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW || 60 * 1000);
  const maxRequests = parseInt(process.env.AUTH_RATE_LIMIT_MAX || 10);

  const requests = (await client.get(key)) || 0;
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.');
  }
  await client.multi().incr(key).expire(key, windowMs / 1000).exec();
}

// ================== Allowed Origins ==================
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai.vercel.app',
].filter((v, i, a) => a.indexOf(v) === i);

// ================== Email Transporter ==================
const transporter = createTransport({
  host: process.env.EMAIL_SERVER_HOST,
  port: process.env.EMAIL_SERVER_PORT,
  auth: {
    user: process.env.EMAIL_SERVER_USER,
    pass: process.env.EMAIL_SERVER_PASSWORD,
  },
});

// ================== Custom Adapter ==================
const customAdapter = {
  async getUserByEmail(email) {
    try {
      const { rows } = await query(
        `SELECT id, email, google_id, google_name, email_verified, profile_picture,
                connected, last_connected, points, tweet_points, ai_points, task_points,
                is_creator, is_ai_rank, tier, is_plus, is_premium, api_key, created_at
         FROM users WHERE email = $1`,
        [email]
      );
      return rows[0] ? { ...rows[0], id: rows[0].id.toString() } : null;
    } catch (err) {
      logger.error('getUserByEmail error', { error: err.message });
      throw err;
    }
  },
  async getUserByAccount({ provider, providerAccountId }) {
    try {
      const { rows } = await query(
        `SELECT u.* FROM users u
         JOIN accounts a ON u.id = a.userId
         WHERE a.provider = $1 AND a.providerAccountId = $2`,
        [provider, providerAccountId]
      );
      return rows[0] ? { ...rows[0], id: rows[0].id.toString() } : null;
    } catch (err) {
      logger.error('getUserByAccount error', { error: err.message });
      throw err;
    }
  },
  async createUser(data) {
    try {
      const id = data.id || uuidv4();
      const { rows } = await query(
        `INSERT INTO users (id, email, google_id, google_name, email_verified, profile_picture,
           connected, last_connected, points, tweet_points, ai_points, task_points, is_creator,
           is_ai_rank, tier, is_plus, is_premium, api_key, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING *`,
        [
          id, data.email, data.google_id || null, data.google_name || null,
          data.email_verified || false, data.profile_picture || null, true,
          new Date(), 0, 0, 0, 0, false, false, 'Basic', false, false,
          randomBytes(32).toString('hex'), new Date(),
        ]
      );
      return { ...rows[0], id: rows[0].id.toString() };
    } catch (err) {
      logger.error('createUser error', { error: err.message });
      throw err;
    }
  },
  async updateUser(data) {
    try {
      const { rows } = await query(
        `UPDATE users SET email=$2, google_id=$3, google_name=$4, email_verified=$5,
           profile_picture=$6, connected=$7, last_connected=$8, updated_at=$9
         WHERE id=$1 RETURNING *`,
        [
          data.id, data.email, data.google_id || null, data.google_name || null,
          data.email_verified || false, data.profile_picture || null, true,
          new Date(), new Date(),
        ]
      );
      return { ...rows[0], id: rows[0].id.toString() };
    } catch (err) {
      logger.error('updateUser error', { error: err.message });
      throw err;
    }
  },
  async createVerificationToken({ identifier, expires, token }) {
    const { rows } = await query(
      `INSERT INTO verification_tokens (identifier, token, expires)
       VALUES ($1,$2,$3) RETURNING *`,
      [identifier, token, expires]
    );
    return rows[0];
  },
  async useVerificationToken({ identifier, token }) {
    const { rows } = await query(
      `DELETE FROM verification_tokens WHERE identifier=$1 AND token=$2 RETURNING *`,
      [identifier, token]
    );
    return rows[0] || null;
  },
};

// ================== CORS & Rate Limit Wrapper ==================
const rateLimitedHandler = (handler) =>
  limiter.wrap(async (req, ...args) => {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const origin = req.headers.get('origin');
    const referer = req.headers.get('referer');

    logger.info(`Auth Request: IP=${ip}, Origin=${origin || 'null'}, Referer=${referer || 'null'}`);

    let isAllowed = false;
    if (origin && allowedOrigins.includes(origin)) {
      isAllowed = true;
    } else if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin)) isAllowed = true;
    }

    if (!isAllowed) {
      logger.error(`CORS blocked for Origin=${origin || referer || 'null'}`);
      return NextResponse.json({ detail: 'CORS Not Allowed' }, { status: 403 });
    }

    try {
      await checkRateLimit(ip);
    } catch (err) {
      return NextResponse.json({ detail: err.message }, { status: 429 });
    }

    const res = await handler(req, ...args);
    res.headers.set('Access-Control-Allow-Origin', origin || new URL(referer).origin);
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-CSRF-Token');
    res.headers.set('Access-Control-Allow-Credentials', 'true');

    return res;
  });

// ================== NextAuth Options ==================
export const authOptions = {
  adapter: customAdapter,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    EmailProvider({
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: process.env.EMAIL_SERVER_PORT,
        auth: { user: process.env.EMAIL_SERVER_USER, pass: process.env.EMAIL_SERVER_PASSWORD },
      },
      from: process.env.EMAIL_FROM,
      sendVerificationRequest: async ({ identifier, url, provider }) => {
        await transporter.sendMail({
          to: identifier,
          from: provider.from,
          subject: 'Sign in to Dashboard',
          html: `<p><a href="${url}">Sign in</a></p>`,
        });
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      try {
        let email = user.email || '';
        let googleId = null, googleName = null, profilePic = '', verified = false, userId = null;

        if (account.provider === 'google') {
          email = profile.email || '';
          profilePic = profile.picture || '';
          googleId = profile.sub;
          googleName = profile.name;
          verified = profile.email_verified || false;
          userId = googleId;
        } else if (account.provider === 'email') {
          email = user.email || '';
          verified = true;
          userId = uuidv4();
        }

        if (!email) return false;

        await query(
          `INSERT INTO users (id,email,google_id,google_name,email_verified,profile_picture,
             connected,last_connected,points,tweet_points,ai_points,task_points,is_creator,is_ai_rank,
             tier,is_plus,is_premium,api_key,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           ON CONFLICT (email) DO UPDATE SET google_id=$3,google_name=$4,email_verified=$5,
             profile_picture=$6,connected=$7,last_connected=$8,updated_at=$19`,
          [userId,email,googleId,googleName,verified,profilePic,true,new Date(),
            0,0,0,0,false,false,'Basic',false,false,randomBytes(32).toString('hex'),new Date()]
        );

        if (account.provider === 'google') {
          await query(
            `INSERT INTO accounts (userId,type,provider,providerAccountId,access_token,expires_at,
               token_type,scope,id_token)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (provider,providerAccountId) DO UPDATE SET
               access_token=$5,expires_at=$6,token_type=$7,scope=$8,id_token=$9`,
            [userId,account.type,account.provider,account.providerAccountId,
              account.access_token,null,account.token_type,account.scope,account.id_token]
          );
        }
        return true;
      } catch (err) {
        logger.error('signIn error', { error: err.message });
        return false;
      }
    },
    async jwt({ token, account, profile }) {
      if (account) {
        token.id = account.provider === 'google' ? account.providerAccountId : token.sub || uuidv4();
        token.accessToken = account.access_token || randomBytes(32).toString('hex');
        token.email = profile?.email || token.email;
        token.googleName = profile?.name || '';
      }
      const { rows } = await query(`SELECT api_key,is_premium FROM users WHERE id=$1`, [token.id]);
      if (rows[0]) {
        token.apiKey = rows[0].api_key;
        token.isPremium = rows[0].is_premium;
      }
      token.csrfToken = randomBytes(32).toString('hex');
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.email = token.email;
      session.user.googleName = token.googleName;
      session.user.apiKey = token.apiKey;
      session.user.isPremium = token.isPremium || false;
      session.csrfToken = token.csrfToken;
      return session;
    },
  },
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
};

// ================== Export Handlers ==================
export const { handlers: { GET: OriginalGET, POST: OriginalPOST }, auth, signIn, signOut } = NextAuth(authOptions);
export const GET = rateLimitedHandler(OriginalGET);
export const POST = rateLimitedHandler(OriginalPOST);

// Close Redis on exit
process.on('SIGTERM', async () => { if (redisClient?.isOpen) await redisClient.quit(); });
process.on('SIGINT', async () => { if (redisClient?.isOpen) await redisClient.quit(); });
