// pages/api/auth/[...nextauth].js
import NextAuth from 'next-auth';
import TwitterProvider from 'next-auth/providers/twitter';
import { db, admin } from '../../../utils/firebaseAdmin';
import { logger } from '../../../utils/logger';

export const authOptions = {
  providers: [
    TwitterProvider({
      clientId: process.env.TWITTER_CLIENT_ID,
      clientSecret: process.env.TWITTER_CLIENT_SECRET,
      version: '2.0',
      authorization: {
        url: 'https://api.twitter.com/2/oauth2/authorize',
        params: {
          scope: 'tweet.read users.read offline.access',
        },
      },
      token: 'https://api.twitter.com/2/oauth2/token',
      userinfo: 'https://api.twitter.com/2/users/me?user.fields=profile_image_url,username',
      profile(profile) {
        // Chuẩn hóa profile để tương thích với NextAuth
        return {
          id: profile.data.id,
          name: profile.data.name,
          email: null, // Twitter không cung cấp email
          image: profile.data.profile_image_url,
          twitterHandle: `@${profile.data.username}`,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      try {
        logger.info('Twitter signIn', { userId: user.id, twitterHandle: user.twitterHandle });
        const userRef = db.collection('users').doc(user.id);
        const userDoc = await userRef.get();

        const userData = {
          twitterAccessToken: account.access_token,
          twitterHandle: user.twitterHandle || `@${profile.data.username}`,
          twitterPFP: profile.data.profile_image_url || user.image || '',
          twitterConnected: true,
          lastConnected: admin.firestore.Timestamp.fromDate(new Date()),
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
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          logger.info(`Created new user: ${user.id}`);
        } else {
          await userRef.update({
            ...userData,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          logger.info(`Updated user: ${user.id}`);
        }
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
      if (account && profile) {
        token.id = account.providerAccountId;
        token.twitterAccessToken = account.access_token;
        token.twitterHandle = `@${profile.data.username}`;
      }
      logger.info('JWT callback', {
        tokenId: token.id,
        twitterHandle: token.twitterHandle,
      });
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.twitterHandle = token.twitterHandle;
      session.user.twitterAccessToken = token.twitterAccessToken;
      logger.info('Session callback', { userId: session.user.id });
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 ngày
    updateAge: 24 * 60 * 60, // Cập nhật mỗi 24 giờ
  },
  pages: {
    signIn: '/auth/signin', // Tùy chọn: Trang đăng nhập tùy chỉnh
    error: '/auth/error', // Tùy chọn: Trang lỗi tùy chỉnh
  },
};

export default NextAuth(authOptions);