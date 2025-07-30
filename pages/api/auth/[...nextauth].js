// pages/api/auth/[...nextauth].js
import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import EmailProvider from 'next-auth/providers/email';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { PrismaClient } from '@prisma/client';
import pkg from '../../../utils/logger.cjs';
import crypto from 'crypto';
import { createTransport } from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';

const { logger } = pkg;
const prisma = new PrismaClient();

// Configure nodemailer for EmailProvider
const transporter = createTransport({
  host: process.env.EMAIL_SERVER_HOST,
  port: process.env.EMAIL_SERVER_PORT,
  auth: {
    user: process.env.EMAIL_SERVER_USER,
    pass: process.env.EMAIL_SERVER_PASSWORD,
  },
});

// Custom adapter to override user creation and update
const customAdapter = {
  ...PrismaAdapter(prisma),
  getUserByEmail: async (email) => {
    try {
      const user = await prisma.users.findUnique({
        where: { email },
      });
      return user ? { ...user, id: user.id.toString() } : null;
    } catch (error) {
      logger.error('Error in getUserByEmail', { error: error.message, email });
      throw error;
    }
  },
  createUser: async (data) => {
    try {
      const id = data.id || uuidv4(); // Use provided ID (e.g., Google sub) or generate UUID
      const user = await prisma.users.create({
        data: {
          id,
          email: data.email,
          google_id: data.google_id || null,
          google_name: data.google_name || null,
          email_verified: data.email_verified || false,
          profile_picture: data.profile_picture || null,
          connected: true,
          last_connected: new Date(),
          points: 0,
          tweet_points: 0,
          ai_points: 0,
          task_points: 0,
          is_creator: false,
          is_ai_rank: false,
          tier: 'Basic',
          is_plus: false,
          is_premium: false,
          api_key: crypto.randomBytes(32).toString('hex'),
          created_at: new Date(),
        },
      });
      logger.info(`Created user with ID: ${id}`, { email: data.email });
      return { ...user, id: user.id.toString() };
    } catch (error) {
      logger.error('Error in createUser', { error: error.message, email: data.email });
      throw error;
    }
  },
  updateUser: async (data) => {
    try {
      const user = await prisma.users.update({
        where: { id: data.id },
        data: {
          email: data.email,
          google_id: data.google_id || null,
          google_name: data.google_name || null,
          email_verified: data.email_verified || false,
          profile_picture: data.profile_picture || null,
          connected: true,
          last_connected: new Date(),
          updated_at: new Date(),
        },
      });
      logger.info(`Updated user with ID: ${data.id}`, { email: data.email });
      return { ...user, id: user.id.toString() };
    } catch (error) {
      logger.error('Error in updateUser', { error: error.message, id: data.id });
      throw error;
    }
  },
};

export const authOptions = {
  adapter: customAdapter,
  providers: [
    GoogleProvider.default({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    EmailProvider.default({
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
          userId = googleId; // Use Google providerAccountId as user ID
        } else if (account.provider === 'email') {
          email = user.email || '';
          profilePicture = ''; // Email doesn't provide a profile picture
          emailVerified = true; // Assume email is verified via EmailProvider
          userId = uuidv4(); // Generate UUID for email sign-in
        }

        if (!email) {
          logger.error('No valid email found', { userId: user.id, profile });
          return false;
        }

        // Update or create user in the `users` table
        await prisma.users.upsert({
          where: { email }, // Use email as unique identifier for lookup
          update: {
            email,
            google_id: googleId,
            google_name: googleName,
            email_verified: emailVerified,
            profile_picture: profilePicture,
            last_connected: new Date(),
            updated_at: new Date(),
            connected: true,
          },
          create: {
            id: userId, // Use generated or provided ID
            email,
            google_id: googleId,
            google_name: googleName,
            email_verified: emailVerified,
            profile_picture: profilePicture,
            connected: true,
            last_connected: new Date(),
            points: 0,
            tweet_points: 0,
            ai_points: 0,
            task_points: 0,
            is_creator: false,
            is_ai_rank: false,
            tier: 'Basic',
            is_plus: false,
            is_premium: false,
            api_key: crypto.randomBytes(32).toString('hex'),
            created_at: new Date(),
          },
        });

        // Update or create account in the `Account` table for Google provider
        if (account.provider === 'google') {
          await prisma.account.upsert({
            where: {
              provider_providerAccountId: {
                provider: account.provider,
                providerAccountId: account.providerAccountId,
              },
            },
            update: {
              access_token: account.access_token || null,
              expires_at: account.expires_at || null,
              token_type: account.token_type || null,
              scope: account.scope || null,
              id_token: account.id_token || null,
            },
            create: {
              userId: userId,
              type: account.type,
              provider: account.provider,
              providerAccountId: account.providerAccountId,
              access_token: account.access_token || null,
              expires_at: account.expires_at || null,
              token_type: account.token_type || null,
              scope: account.scope || null,
              id_token: account.id_token || null,
            },
          });
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
        token.accessToken = account.access_token || null;
        token.email = profile?.email || token.email || '';
        token.googleName = profile?.name || '';
        token.googleId = profile?.sub || account.providerAccountId || null;
      }
      const user = await prisma.users.findUnique({
        where: { id: token.id },
        select: { api_key: true, is_premium: true },
      });
      if (user) {
        token.apiKey = user.api_key;
        token.isPremium = user.is_premium;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.email = token.email;
      session.user.googleName = token.googleName;
      session.user.accessToken = token.accessToken;
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