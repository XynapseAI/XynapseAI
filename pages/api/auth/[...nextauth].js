import NextAuth from 'next-auth';
import TwitterProvider from 'next-auth/providers/twitter';
import { query } from '../../../utils/postgres.js';
import pkg from '../../../utils/logger.cjs';

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
                logger.info('Twitter signIn profile:', { profile, user, account });
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
                    twitter_access_token: account.access_token,
                    twitter_handle: twitterHandle,
                    twitter_pfp: profile?.data?.profile_image_url || profile?.profile_image_url || user.image || '',
                    twitter_connected: true,
                    last_connected: new Date(),
                };

                const result = await query(
                    `SELECT id FROM users WHERE id = $1`,
                    [user.id]
                );

                if (result.rows.length === 0) {
                    await query(
                        `INSERT INTO users (
                            id, twitter_handle, twitter_pfp, twitter_access_token, 
                            twitter_connected, points, tweet_points, ai_points, 
                            task_points, is_creator, is_ai_rank, tier, is_plus, created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                        [
                            user.id,
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
                        ]
                    );
                    logger.info(`Created new user: ${user.id}`);
                } else {
                    await query(
                        `UPDATE users SET
                            twitter_handle = $1,
                            twitter_pfp = $2,
                            twitter_access_token = $3,
                            twitter_connected = $4,
                            last_connected = $5,
                            updated_at = $6
                         WHERE id = $7`,
                        [
                            userData.twitter_handle,
                            userData.twitter_pfp,
                            userData.twitter_access_token,
                            userData.twitter_connected,
                            userData.last_connected,
                            new Date(),
                            user.id,
                        ]
                    );
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
    secret: process.env.NEXTAUTH_SECRET,
    session: {
        strategy: 'jwt',
        maxAge: 30 * 24 * 60 * 60,
        updateAge: 24 * 60 * 60,
    },
};

export default NextAuth.default(authOptions);