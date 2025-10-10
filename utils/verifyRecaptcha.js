import axios from 'axios';
import { logger } from './serverLogger';
import Bottleneck from 'bottleneck';

const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});

const verifyWithRateLimit = limiter.wrap(async (token, action, ip, secret) => {
  try {
    if (!secret) {
      throw new Error('Missing reCAPTCHA secret key');
    }
    const response = await axios.post(
      'https://www.google.com/recaptcha/api/siteverify',
      new URLSearchParams({
        secret,
        response: token,
        ...(ip && { remoteip: ip }),
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

  try {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    const { success, score, action: recaptchaAction, 'error-codes': errorCodes, hostname } = await verifyWithRateLimit(
      token,
      action,
      ip,
      secret
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

export async function verifyRecaptchaV2(token, ip) {
  if (!token || typeof token !== 'string' || token.length < 10) {
    throw new Error('Invalid reCAPTCHA v2 token');
  }

  try {
    const secret = process.env.RECAPTCHA_V2_SECRET_KEY;
    const { success, 'error-codes': errorCodes } = await verifyWithRateLimit(
      token,
      'v2_fallback',
      ip,
      secret
    );
    logger.info(
      `reCAPTCHA v2 verification: success=${success}, error-codes=${errorCodes?.join(', ') || 'none'}`,
      { ip }
    );

    if (!success) {
      const errorMessage = `reCAPTCHA v2 failed: ${errorCodes?.join(', ') || 'Unknown error'}`;
      throw new Error(errorMessage);
    }

    return { success: true };
  } catch (error) {
    logger.error(`reCAPTCHA v2 verification failed: ${error.message}`, {
      tokenLength: token?.length,
      ip,
      error: error.response?.data,
    });
    throw new Error(`reCAPTCHA v2 verification failed: ${error.message}`);
  }
}