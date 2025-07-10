import { query } from '../../utils/postgres.js';
import { ethers } from 'ethers';
import { getServerSession } from 'next-auth/next';
import { getCsrfToken } from 'next-auth/react';
import { authOptions } from './auth/[...nextauth].js';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha.js';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import pkg from '../../utils/logger.cjs';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';

const { logger } = pkg;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
});

const validatePost = [
  body('action').isIn(['verify-wallet', 'disconnect-wallet']).withMessage('Invalid action'),
  body('uid').isString().isLength({ max: 100 }).withMessage('Invalid UID'),
  body('recaptchaToken').isString().withMessage('Invalid reCAPTCHA token'),
  body('walletAddress')
    .optional()
    .isString()
    .matches(/^0x[a-fA-F0-9]{40}$/)
    .withMessage('Invalid wallet address'),
  body('signature').optional().isString().withMessage('Invalid signature'),
  body('message').optional().isString().withMessage('Invalid message'),
];

export default async function handler(req, res) {
  helmet()(req, res, () => {});
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  logger.info(`Request to ${req.url} from IP ${ip}`, {
    method: req.method,
    body: req.body,
  });

  try {
    await new Promise((resolve, reject) => {
      limiter(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Rate limit error: ${err.message}`);
    return res.status(429).json({ detail: 'Too many requests, please try again later.' });
  }

  if (req.method !== 'POST') {
    logger.warn(`Method not allowed: ${req.method}`);
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID');
    return res.status(401).json({ detail: 'Not signed in' });
  }

  logger.info('Session details:', {
    userId: session.user.id,
    twitterHandle: session.user.twitterHandle,
  });

  const csrfToken = req.headers['x-csrf-token'];
  const expectedCsrfToken = await getCsrfToken({ req });
  logger.info('CSRF token validation:', {
    provided: csrfToken ? csrfToken.substring(0, 8) + '...' : 'none',
    expected: expectedCsrfToken ? expectedCsrfToken.substring(0, 8) + '...' : 'none',
  });

  const authHeader = req.headers['authorization'];
  logger.info('Authorization header:', { authHeader: authHeader || 'none' });
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Missing or invalid Authorization header');
    return res.status(401).json({ detail: 'Missing or invalid JWT' });
  }

  const token = authHeader.split(' ')[1];
  try {
    if (!process.env.JWT_SECRET) {
      logger.error('JWT_SECRET is not configured');
      throw new Error('Server configuration error: Missing JWT_SECRET');
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    logger.info('JWT decoded payload:', { decoded });
    if (decoded.userId !== session.user.id) {
      logger.warn(`JWT userId mismatch:`, { jwtUserId: decoded.userId, sessionUserId: session.user.id });
      return res.status(401).json({ detail: 'Invalid JWT' });
    }
    logger.info('JWT verified successfully:', { userId: decoded.userId });
  } catch (error) {
    logger.error(`JWT verification failed: ${error.message}`, { stack: error.stack, token: token.substring(0, 8) + '...' });
    return res.status(401).json({ detail: `Invalid JWT: ${error.message}` });
  }

  await Promise.all(validatePost.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Input validation errors: ${JSON.stringify(errors.array())}`);
    return res.status(400).json({ detail: 'Invalid input data', errors: errors.array() });
  }

  try {
    const { action, uid, recaptchaToken, walletAddress, signature, message } = req.body;
    try {
      logger.info('Verifying reCAPTCHA:', { action, token: recaptchaToken ? recaptchaToken.substring(0, 8) + '...' : 'none' });
      await verifyRecaptcha(recaptchaToken, action, ip);
      logger.info(`reCAPTCHA verified successfully for ${action}`);
    } catch (recaptchaError) {
      logger.error(`reCAPTCHA verification error: ${recaptchaError.message}`, {
        action,
        token: recaptchaToken ? recaptchaToken.substring(0, 8) + '...' : 'none',
      });
      throw recaptchaError;
    }

    if (uid !== session.user.id) {
      logger.warn(`Unauthorized: uid=${uid}, sessionUserId=${session.user.id}`);
      return res.status(403).json({ detail: 'Invalid UID' });
    }

    if (action === 'verify-wallet') {
      if (!walletAddress || !signature || !message) {
        logger.warn('Missing wallet information:', { walletAddress, signature, message });
        return res.status(400).json({ detail: 'Missing wallet address, signature, or message' });
      }

      const normalizedAddress = walletAddress.toLowerCase();
      const recoveredAddress = ethers.verifyMessage(message, signature);
      if (recoveredAddress.toLowerCase() !== normalizedAddress) {
        logger.warn('Invalid wallet signature:', { recoveredAddress, walletAddress });
        return res.status(403).json({ detail: 'Invalid signature' });
      }

      await query(
        `UPDATE users
         SET wallet_address = $1, last_connected = $2
         WHERE id = $3`,
        [normalizedAddress, new Date(), session.user.id]
      );

      await query(
        `INSERT INTO wallet_histories (user_id, wallet_address, action, data, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [session.user.id, normalizedAddress, 'connect', { signature, message }, new Date()]
      );

      const userResult = await query(
        `SELECT id, twitter_handle, twitter_access_token, discord_access_token, wallet_address, task_points, points, last_connected
         FROM users
         WHERE id = $1`,
        [session.user.id]
      );
      const user = userResult.rows[0];
      logger.info(`Wallet verified for user: ${uid}`, { walletAddress: normalizedAddress });
      return res.status(200).json({ success: true, user });
    } else if (action === 'disconnect-wallet') {
      const userResult = await query(
        `SELECT wallet_address
         FROM users
         WHERE id = $1`,
        [session.user.id]
      );
      const user = userResult.rows[0];

      await query(
        `UPDATE users
         SET wallet_address = NULL, last_connected = $1
         WHERE id = $2`,
        [new Date(), session.user.id]
      );

      await query(
        `INSERT INTO wallet_histories (user_id, wallet_address, action, data, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [session.user.id, user.wallet_address || 'unknown', 'disconnect', {}, new Date()]
      );

      const updatedUserResult = await query(
        `SELECT id, twitter_handle, twitter_access_token, discord_access_token, wallet_address, task_points, points, last_connected
         FROM users
         WHERE id = $1`,
        [session.user.id]
      );
      const updatedUser = updatedUserResult.rows[0];
      logger.info(`Wallet disconnected for user: ${uid}`);
      return res.status(200).json({ success: true, user: updatedUser });
    }

    logger.warn(`Invalid action: ${action}`);
    return res.status(400).json({ detail: 'Invalid action' });
  } catch (error) {
    logger.error(`Error processing request: ${error.message}`, {
      stack: error.stack,
      body: req.body,
    });
    return res.status(500).json({ detail: `Server error: ${error.message}` });
  }
}