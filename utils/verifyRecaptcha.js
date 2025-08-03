// utils/verifyRecaptcha.js
import axios from 'axios';
import { logger } from './serverLogger';
import Bottleneck from 'bottleneck';

const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});

const verifyWithRateLimit = limiter.wrap(async (token, action, ip) => {
  try {
    const response = await axios.post(
      'https://www.google.com/recaptcha/api/siteverify',
      new URLSearchParams({
        secret: process.env.RECAPTCHA_SECRET_KEY,
        response: token,
        ...(ip && { remoteip: ip }), // Keep IP if provided, no validation
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      }
    );
    return response.data;
  } catch (error) {
    if (error.response?.status === 429) {
      throw new Error('reCAPTCHA rate limit exceeded');
    }
    throw error;
  }
});

export async function verifyRecaptcha(token, action, ip) {
  if (!token || typeof token !== 'string' || token.length < 10) {
    throw new Error('Invalid reCAPTCHA token');
  }
  if (!action || typeof action !== 'string') {
    throw new Error('Invalid reCAPTCHA action');
  }

  if (!process.env.RECAPTCHA_SECRET_KEY) {
    logger.error('Missing RECAPTCHA_SECRET_KEY');
    throw new Error('Server configuration error: Missing RECAPTCHA_SECRET_KEY');
  }

  try {
    const { success, score, action: recaptchaAction, 'error-codes': errorCodes, hostname } = await verifyWithRateLimit(
      token,
      action,
      ip
    );
    logger.info(
      `reCAPTCHA verification: success=${success}, score=${score}, action=${recaptchaAction}, hostname=${hostname}, error-codes=${
        errorCodes?.join(', ') || 'none'
      }`,
      { ip }
    );

    if (!success) {
      const errorMessage = errorCodes?.includes('timeout-or-duplicate')
        ? 'reCAPTCHA token timed out or was reused'
        : errorCodes?.includes('invalid-input-secret')
        ? 'Invalid reCAPTCHA secret key'
        : `reCAPTCHA verification failed: ${errorCodes?.join(', ') || 'Unknown error'}`;
      throw new Error(errorMessage);
    }

    const minScore = parseFloat(process.env.RECAPTCHA_MIN_SCORE || '0.5');
    if (score < minScore) {
      throw new Error(`reCAPTCHA score too low: ${score} < ${minScore}`);
    }

    if (recaptchaAction && recaptchaAction.toLowerCase() !== action.toLowerCase()) {
      throw new Error(`reCAPTCHA action mismatch: expected ${action}, got ${recaptchaAction}`);
    }

    return { success: true, score };
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`, {
      tokenLength: token?.length,
      action,
      ip,
      error: error.response?.data,
    });
    throw new Error(`reCAPTCHA verification failed: ${error.message}`);
  }
}