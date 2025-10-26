import axios from 'axios';
import { logger } from './serverLogger';
import Bottleneck from 'bottleneck';

const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});

const verifyWithRateLimit = limiter.wrap(async (token, action, ip) => {
  try {
    if (!process.env.RECAPTCHA_SECRET_KEY) {
      throw new Error('Missing RECAPTCHA_SECRET_KEY');
    }
    const response = await axios.post(
      'https://www.google.com/recaptcha/api/siteverify',
      new URLSearchParams({
        secret: process.env.RECAPTCHA_SECRET_KEY,
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
    return { success: false, error: 'Invalid reCAPTCHA token' };
  }
  if (!action || typeof action !== 'string') {
    return { success: false, error: 'Invalid reCAPTCHA action' };
  }

  try {
    const responseData = await verifyWithRateLimit(token, action, ip);
    const { success, score, action: recaptchaAction, 'error-codes': errorCodes, hostname } = responseData;
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
      return { success: false, error: errorMessage };
    }

    const isV3 = score !== undefined;
    let verified = true;
    let needsFallback = false;
    if (isV3) {
      const minScore = parseFloat(process.env.RECAPTCHA_MIN_SCORE || '0.9');
      if (score < minScore) {
        verified = false;
        needsFallback = true;
      }
    } // v2: success true, no score check

    if (recaptchaAction && recaptchaAction.toLowerCase() !== action.toLowerCase()) {
      return { success: false, error: `reCAPTCHA action mismatch: expected ${action}, got ${recaptchaAction}` };
    }

    return { 
      success: verified, 
      needsFallback, 
      score: isV3 ? score : 1.0,
      error: verified ? null : 'reCAPTCHA verification failed' 
    };
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`, {
      tokenLength: token?.length,
      action,
      ip,
      error: error.response?.data,
    });
    return { success: false, error: `reCAPTCHA verification failed: ${error.message}` };
  }
}