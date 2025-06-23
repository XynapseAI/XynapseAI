
// pages/api/auth/[...nextauth].js
import NextAuth from 'next-auth';
import TwitterProvider from 'next-auth/providers/twitter';
import { db } from '../../../utils/firebaseAdmin';
import { logger } from '../../../utils/logger';

export const authOptions = {
  providers: [
    TwitterProvider({
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
    async signIn({ user, profile }) {
      try {
        const userRef = db.collection('users').doc(user.id);
        const userDoc = await userRef.get();
        const userData = {
          twitterHandle: profile?.data?.username || user.name || '',
          twitterPFP: profile?.data?.profile_image_url_https || user.image || '',
          twitterConnected: true,
          lastConnected: new Date(),
        };

        if (!userDoc.exists) {
          await userRef.set({
            ...userData,
            points: 0,
            tweetPoints: 0,
            aiPoints: 0,
            taskPoints: 0,
            isCreator: false,
            isAiRank: false,
            tier: 'Basic',
            isPlus: false,
          });
          logger.info(`Created new user: ${user.id}`);
        } else {
          await userRef.update(userData);
          logger.info(`Updated user: ${user.id}`);
        }
        return true;
      } catch (error) {
        logger.error('Error in signIn callback:', {
          error: error.message,
          userId: user.id,
        });
        return false;
      }
    },
    async jwt({ token, account, profile }) {
      if (account) {
        token.id = account.providerAccountId;
        token.twitterHandle = profile?.data?.username || '';
      }
      logger.info('JWT callback:', { tokenId: token.id, accountId: account?.providerAccountId });
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.twitterHandle = token.twitterHandle;
      logger.info('Session callback:', { session });
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
};

export default NextAuth(authOptions);