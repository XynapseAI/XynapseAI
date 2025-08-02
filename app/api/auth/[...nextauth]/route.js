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

// Khởi tạo Redis client
const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

// Khởi tạo Bottleneck limiter
const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});

async function checkRateLimit(ip) {
  const key = `rate_limit:auth:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW || 60 * 1000);
  const maxRequests = parseInt(process.env.AUTH_RATE_LIMIT_MAX || 10);
  if (requests >= maxRequests) {
    throw new Error('Too many requests, please try again later.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://xynapse-ai.vercel.app',
];

const transporter = createTransport({
  host: process.env.EMAIL_SERVER_HOST,
  port: process.env.EMAIL_SERVER_PORT,
  auth: {
    user: process.env.EMAIL_SERVER_USER,
    pass: process.env.EMAIL_SERVER_PASSWORD,
  },
});

// Custom adapter for NextAuth
const customAdapter = {
  async getUserByEmail(email) {
    try {
      const userResult = await query(
        `SELECT id, email, google_id, google_name, email_verified, profile_picture,
                connected, last_connected, points, tweet_points, ai_points, task_points,
                is_creator, is_ai_rank, tier, is_plus, is_premium, api_key, created_at
         FROM users
         WHERE email = $1`,
        [email]
      );
      const user = userResult.rows[0];
      return user ? { ...user, id: user.id.toString() } : null;
    } catch (error) {
      logger.error('Error in getUserByEmail', { error: error.message, email });
      throw error;
    }
  },
  async getUserByAccount({ provider, providerAccountId }) {
    try {
      const userResult = await query(
        `SELECT u.* FROM users u
         JOIN accounts a ON u.id = a.userId
         WHERE a.provider = $1 AND a.providerAccountId = $2`,
        [provider, providerAccountId]
      );
      const user = userResult.rows[0];
      logger.info('getUserByAccount result', { provider, providerAccountId, user });
      return user ? { ...user, id: user.id.toString() } : null;
    } catch (error) {
      logger.error('Error in getUserByAccount', { error: error.message, provider, providerAccountId });
      throw error;
    }
  },
  async createUser(data) {
    try {
      const id = data.id || uuidv4();
      const userResult = await query(
        `INSERT INTO users (
           id, email, google_id, google_name, email_verified, profile_picture, connected,
           last_connected, points, tweet_points, ai_points, task_points, is_creator,
           is_ai_rank, tier, is_plus, is_premium, api_key, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         RETURNING *`,
        [
          id,
          data.email,
          data.google_id || null,
          data.google_name || null,
          data.email_verified || false,
          data.profile_picture || null,
          true,
          new Date(),
          0,
          0,
          0,
          0,
          false,
          false,
          'Basic',
          false,
          false,
          randomBytes(32).toString('hex'),
          new Date(),
        ]
      );
      const user = userResult.rows[0];
      logger.info(`Created user with ID: ${id}`, { email: data.email });
      return { ...user, id: user.id.toString() };
    } catch (error) {
      logger.error('Error in createUser', { error: error.message, email: data.email });
      throw error;
    }
  },
  async updateUser(data) {
    try {
      const userResult = await query(
        `UPDATE users SET
           email = $2, google_id = $3, google_name = $4, email_verified = $5,
           profile_picture = $6, connected = $7, last_connected = $8, updated_at = $9
         WHERE id = $1
         RETURNING *`,
        [
          data.id,
          data.email,
          data.google_id || null,
          data.google_name || null,
          data.email_verified || false,
          data.profile_picture || null,
          true,
          new Date(),
          new Date(),
        ]
      );
      const user = userResult.rows[0];
      logger.info(`Updated user with ID: ${data.id}`, { email: data.email });
      return { ...user, id: user.id.toString() };
    } catch (error) {
      logger.error('Error in updateUser', { error: error.message, id: data.id });
      throw error;
    }
  },
  async createVerificationToken({ identifier, expires, token }) {
    try {
      const result = await query(
        `INSERT INTO verification_tokens (identifier, token, expires)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [identifier, token, expires]
      );
      const verificationToken = result.rows[0];
      return verificationToken;
    } catch (error) {
      logger.error('Error in createVerificationToken', { error: error.message, identifier });
      throw error;
    }
  },
  async useVerificationToken({ identifier, token }) {
    try {
      const result = await query(
        `DELETE FROM verification_tokens
         WHERE identifier = $1 AND token = $2
         RETURNING *`,
        [identifier, token]
      );
      const verificationToken = result.rows[0];
      return verificationToken || null;
    } catch (error) {
      logger.error('Error in useVerificationToken', { error: error.message, identifier });
      throw error;
    }
  },
};

// Rate-limit wrapper for NextAuth handlers
const rateLimitedHandler = (handler) =>
  limiter.wrap(async (request, ...args) => {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const origin = request.headers.get('origin');

    // Logging chi tiết hơn để xác định nguồn gốc yêu cầu
    logger.info(`Request to /api/auth/[...nextauth] from IP ${ip}, Origin: ${origin || 'null'}`);

    // Cho phép Origin: null trong môi trường phát triển
    if (!origin && process.env.NODE_ENV === 'development') {
      logger.warn(`Origin is null, allowing in development mode`, { ip });
    } else if (!origin || !allowedOrigins.includes(origin)) {
      logger.error(`CORS error: Origin ${origin || 'null'} not allowed`, { allowedOrigins, ip });
      return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
    }

    // Kiểm tra rate limit
    try {
      await checkRateLimit(ip);
    } catch (err) {
      logger.error(`Rate limit error: ${err.message}`, { ip });
      return NextResponse.json({ detail: err.message }, { status: 429 });
    }

    // Tiến hành xử lý yêu cầu
    const response = await handler(request, ...args);

    // Thêm CORS headers vào phản hồi
    response.headers.set(
      'Access-Control-Allow-Origin',
      process.env.NODE_ENV === 'development' ? (origin || 'http://localhost:3000') : origin
    );
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
    response.headers.set('Access-Control-Allow-Credentials', 'true');

    return response;
  });

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
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM,
      sendVerificationRequest: async ({ identifier, url, provider }) => {
        try {
          await transporter.sendMail({
            to: identifier,
            from: provider.from,
            subject: 'Sign in to Your Dashboard',
            text: `Please click the following link to sign in: ${url}`,
            html: `<p>Please click the following link to sign in:</p><p><a href="${url}">Sign in</a></p>`,
          });
          logger.info(`Verification email sent to ${identifier}`);
        } catch (error) {
          logger.error(`Failed to send verification email to ${identifier}`, { error: error.message });
          throw new Error('Failed to send verification email');
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      try {
        logger.info('SignIn callback', { user, account, profile });
        let email = user.email || '';
        let googleId = null;
        let googleName = null;
        let emailVerified = false;
        let profilePicture = '';
        let userId = null;

        if (account.provider === 'google') {
          email = profile.email || user.email || '';
          profilePicture = profile.picture || user.image || '';
          googleId = profile.sub || account.providerAccountId;
          googleName = profile.name || user.name || '';
          emailVerified = profile.email_verified || false;
          userId = googleId;
        } else if (account.provider === 'email') {
          email = user.email || '';
          profilePicture = '';
          emailVerified = true;
          userId = uuidv4();
        }

        if (!email) {
          logger.error('No valid email found', { userId: user.id, profile });
          return false;
        }

        const userResult = await query(
          `INSERT INTO users (
             id, email, google_id, google_name, email_verified, profile_picture, connected,
             last_connected, points, tweet_points, ai_points, task_points, is_creator,
             is_ai_rank, tier, is_plus, is_premium, api_key, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
           ON CONFLICT (email) DO UPDATE SET
             google_id = $3, google_name = $4, email_verified = $5, profile_picture = $6,
             connected = $7, last_connected = $8, updated_at = $19
           RETURNING *`,
          [
            userId,
            email,
            googleId,
            googleName,
            emailVerified,
            profilePicture,
            true,
            new Date(),
            0,
            0,
            0,
            0,
            false,
            false,
            'Basic',
            false,
            false,
            randomBytes(32).toString('hex'),
            new Date(),
          ]
        );
        const user = userResult.rows[0]; // Use userResult here

        if (account.provider === 'google') {
          await query(
            `INSERT INTO accounts (
               userId, type, provider, providerAccountId, access_token, expires_at,
               token_type, scope, id_token
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (provider, providerAccountId) DO UPDATE SET
               access_token = $5, expires_at = $6, token_type = $7, scope = $8, id_token = $9
             RETURNING *`,
            [
              userId,
              account.type,
              account.provider,
              account.providerAccountId,
              account.access_token || null,
              account.expires_at || null,
              account.token_type || null,
              account.scope || null,
              account.id_token || null,
            ]
          );
        }

        logger.info(`User and account created/updated: ${userId}`);
        return true;
      } catch (error) {
        logger.error('Error in signIn callback', {
          error: error.message,
          userId: user.id,
          stack: error.stack,
        });
        return false;
      }
    },
    async jwt({ token, account, profile }) {
      if (account) {
        token.id = account.provider === 'google' ? account.providerAccountId : token.sub || uuidv4();
        token.accessToken = account.access_token || randomBytes(32).toString('hex');
        token.email = profile?.email || token.email || '';
        token.googleName = profile?.name || '';
        token.googleId = profile?.sub || account.providerAccountId || null;
      }
      const userResult = await query(
        `SELECT api_key, is_premium FROM users WHERE id = $1`,
        [token.id]
      );
      const user = userResult.rows[0];
      if (user) {
        token.apiKey = user.api_key;
        token.isPremium = user.is_premium;
      }
      token.csrfToken = randomBytes(32).toString('hex'); // Tạo CSRF token mới
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.email = token.email;
      session.user.googleName = token.googleName;
      session.user.accessToken = token.accessToken;
      session.user.apiKey = token.apiKey;
      session.user.isPremium = token.isPremium || false;
      session.csrfToken = token.csrfToken; // Lưu CSRF token vào session
      logger.info('Session callback', { userId: session.user.id, csrfToken: session.csrfToken });
      return session;
    },
  },
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
};

// Áp dụng rate limiting và CORS cho GET và POST handlers
export const { handlers: { GET: OriginalGET, POST: OriginalPOST }, auth, signIn, signOut } = NextAuth(authOptions);

export const GET = rateLimitedHandler(OriginalGET);
export const POST = rateLimitedHandler(OriginalPOST);

// Đóng kết nối Redis khi server tắt
process.on('SIGTERM', async () => {
  if (redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed on SIGTERM');
  }
});
process.on('SIGINT', async () => {
  if (redisClient.isOpen) {
    await redisClient.quit();
    logger.info('Redis connection closed on SIGINT');
  }
});