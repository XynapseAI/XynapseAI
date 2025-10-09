import axios from 'axios';
import { logger } from './serverLogger';
import Bottleneck from 'bottleneck';

const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});

const verifyWithRateLimit = limiter.wrap(async (token, secret, ip) => {
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

  // Determine secret: Use v2 secret if available, else fallback to v3
  const isV2Action = action.endsWith('_v2'); // Optional: Frontend can pass 'verify_task_v2' for v2 resubmit
  const secret = isV2Action || process.env.RECAPTCHA_V2_SECRET_KEY 
    ? process.env.RECAPTCHA_V2_SECRET_KEY || process.env.RECAPTCHA_SECRET_KEY 
    : process.env.RECAPTCHA_SECRET_KEY;

  try {
    const responseData = await verifyWithRateLimit(token, secret, ip);
    const { success, score, action: recaptchaAction, 'error-codes': errorCodes, hostname } = responseData;
    
    logger.info(
      `reCAPTCHA verification: success=${success}, score=${score || 'N/A (v2)'}, action=${recaptchaAction}, hostname=${hostname}, error-codes=${
        errorCodes?.join(', ') || 'none'
      }`,
      { ip, isV2: !!isV2Action }
    );

    if (!success) {
      const errorMessage = errorCodes?.includes('timeout-or-duplicate')
        ? 'reCAPTCHA token timed out or was reused'
        : errorCodes?.includes('invalid-input-secret')
        ? 'Invalid reCAPTCHA secret key'
        : `reCAPTCHA verification failed: ${errorCodes?.join(', ') || 'Unknown error'}`;
      throw new Error(errorMessage);
    }

    // For v2: No score, so skip score check if score undefined (v2 response)
    if (score !== undefined) {
      // v3: Check score
      const minScore = parseFloat(process.env.RECAPTCHA_MIN_SCORE || '0.5');
      if (score < minScore) {
        throw new Error(`reCAPTCHA score too low: ${score} < ${minScore}`);
      }
    } else {
      // v2: Already success, but optional action check
      logger.info('reCAPTCHA v2 verified (no score check)', { ip });
    }

    if (recaptchaAction && recaptchaAction.toLowerCase() !== action.toLowerCase()) {
      throw new Error(`reCAPTCHA action mismatch: expected ${action}, got ${recaptchaAction}`);
    }

    return { success: true, score: score || null }; // Return score as null for v2
  } catch (error) {
    logger.error(`reCAPTCHA verification failed: ${error.message}`, {
      tokenLength: token?.length,
      action,
      ip,
      error: error.response?.data,
    });
    // Consistent error for frontend catch: Exact base + appended reason
    throw new Error(`reCAPTCHA verification failed: ${error.message}`);
  }
}