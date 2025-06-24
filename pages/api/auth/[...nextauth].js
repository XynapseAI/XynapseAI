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
        params: {
          scope: 'tweet.read users.read follows.read offline.access', // Giữ scope follows.read
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      try {
        const userRef = db.collection('users').doc(user.id);
        const userDoc = await userRef.get();
        const twitterHandle = profile?.data?.username ? `@${profile.data.username}` : user.name || '';
        if (!twitterHandle) {
          logger.error('No valid Twitter username found', { userId: user.id, profile });
          return false; // Ngăn đăng nhập nếu không có username
        }
        const userData = {
          twitterAccessToken: account.access_token, // Lưu access token
          twitterHandle,
          twitterPFP: profile?.data?.profile_image_url_https || user.image || '',
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
        token.twitterAccessToken = account.access_token;
        token.twitterHandle = profile?.data?.username ? `@${profile.data.username}` : ''; // Sửa lấy username
      }
      logger.info('JWT callback:', {
        tokenId: token.id,
        accountId: account?.providerAccountId,
      });
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.twitterHandle = token.twitterHandle;
      session.user.twitterAccessToken = token.twitterAccessToken;
      logger.info('Session callback:', { userId: session.user.id });
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 ngày
    updateAge: 24 * 60 * 60, // Cập nhật mỗi 24 giờ
  },
};

export default NextAuth(authOptions);