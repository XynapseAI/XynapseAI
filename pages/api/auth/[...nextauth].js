import NextAuth from 'next-auth';
import TwitterProvider from 'next-auth/providers/twitter';
import { db, admin } from '../../../utils/firebaseAdmin';
import { logger } from '../../../utils/logger';
import { getSecrets } from '../../../lib/vault';

export default async function handler(req, res) {
  const secrets = await getSecrets();
  const TWITTER_CLIENT_ID = secrets.TWITTER_CLIENT_ID;
  const TWITTER_CLIENT_SECRET = secrets.TWITTER_CLIENT_SECRET;
  const NEXTAUTH_SECRET = secrets.NEXTAUTH_SECRET;

  const authOptions = {
    providers: [
      TwitterProvider({
        clientId: TWITTER_CLIENT_ID,
        clientSecret: TWITTER_CLIENT_SECRET,
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
          logger.info('Twitter signIn profile:', { profile, user, account });
          const userRef = db.collection('users').doc(user.id);
          const userDoc = await userRef.get();
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
            twitterAccessToken: account.access_token,
            twitterHandle,
            twitterPFP: profile?.data?.profile_image_url || profile?.profile_image_url || user.image || '',
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
    secret: NEXTAUTH_SECRET,
    session: {
      strategy: 'jwt',
      maxAge: 30 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
  };

  return NextAuth(req, res, authOptions);
}