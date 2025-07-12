// pages\api\auth\[...nextauth].js
import NextAuth from 'next-auth';
import TwitterProvider from 'next-auth/providers/twitter';
import { query } from '../../../utils/postgres.js';
import pkg from '../../../utils/logger.cjs';
import crypto from 'crypto';

const { logger } = pkg;

export const authOptions = {
  providers: [
    TwitterProvider.default({
      clientId: process.env.TWITTER_CLIENT_ID,
      clientSecret: process.env.TWITTER_CLIENT_SECRET,
      version: '2.0',
      authorization: {
        params: {
          scope: 'tweet.read users.read offline.access',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      try {
        logger.info('Twitter signIn profile', { profile, user, account });

        const twitterHandle = profile?.data?.username
          ? `@${profile.data.username}`
          : profile?.username
            ? `@${profile.username}`
            : user.name || '';
        if (!twitterHandle) {
          logger.error('No valid Twitter username found', { userId: user.id, profile });
          return false;
        }

        const userData = {
          id: user.id,
          twitter_handle: twitterHandle,
          twitter_pfp: profile?.data?.profile_image_url || profile?.profile_image_url || user.image || '',
          twitter_access_token: account.access_token,
          twitter_connected: true,
          last_connected: new Date(),
          api_key: crypto.randomBytes(32).toString('hex'), // Tạo API key
        };

        await query(
          `INSERT INTO users (
            id, twitter_handle, twitter_pfp, twitter_access_token, 
            twitter_connected, points, tweet_points, ai_points, 
            task_points, is_creator, is_ai_rank, tier, is_plus, 
            created_at, last_connected, api_key, is_premium, premium_expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          ON CONFLICT (id) DO UPDATE SET
            twitter_handle = EXCLUDED.twitter_handle,
            twitter_pfp = EXCLUDED.twitter_pfp,
            twitter_access_token = EXCLUDED.twitter_access_token,
            twitter_connected = EXCLUDED.twitter_connected,
            last_connected = EXCLUDED.last_connected,
            api_key = COALESCE(users.api_key, EXCLUDED.api_key),
            updated_at = CURRENT_TIMESTAMP`,
          [
            userData.id,
            userData.twitter_handle,
            userData.twitter_pfp,
            userData.twitter_access_token,
            userData.twitter_connected,
            0,
            0,
            0,
            0,
            false,
            false,
            'Basic',
            false,
            new Date(),
            userData.last_connected,
            userData.api_key,
            false,
            null,
          ]
        );

        logger.info(`User created/updated: ${user.id}`);
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
        token.id = account.providerAccountId;
        token.twitterAccessToken = account.access_token;
        token.twitterHandle = profile?.data?.username
          ? `@${profile.data.username}`
          : profile?.username
            ? `@${profile.username}`
            : '';
      }
      // Lấy api_key từ database
      const result = await query(`SELECT api_key, is_premium FROM users WHERE id = $1`, [token.id]);
      if (result.rows.length > 0) {
        token.apiKey = result.rows[0].api_key;
        token.isPremium = result.rows[0].is_premium;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.twitterHandle = token.twitterHandle;
      session.user.twitterAccessToken = token.twitterAccessToken;
      session.user.apiKey = token.apiKey;
      session.user.isPremium = token.isPremium || false;
      logger.info('Session callback', { userId: session.user.id });
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // 24 hours
  },
};

export default NextAuth.default(authOptions);