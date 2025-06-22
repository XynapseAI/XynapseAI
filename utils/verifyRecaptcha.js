// utils/verifyRecaptcha.js
const axios = require('axios');
const { logger } = require('./logger');

async function verifyRecaptcha(token, action, ip) {
  // Validate inputs
  if (!token || typeof token !== 'string' || token.length < 10) {
    logger.warn('Invalid reCAPTCHA token format');
    throw new Error('Invalid reCAPTCHA token');
  }
  if (!action || typeof action !== 'string') {
    logger.warn('Invalid reCAPTCHA action format');
    throw new Error('Invalid reCAPTCHA action');
  }
  if (!ip || !ip.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^([\da-fA-F]{1,4}:){7}[\da-fA-F]{1,4}$/)) {
    logger.warn(`Invalid IP format: ${ip}`);
    ip = undefined; // Fallback to undefined if IP is invalid
  }

  // Check environment variable
  if (!process.env.RECAPTCHA_SECRET_KEY) {
    logger.error('RECAPTCHA_SECRET_KEY is not configured');
    throw new Error('Server configuration error: Missing RECAPTCHA_SECRET_KEY');
  }

  try {
    const response = await axios.post(
      'https://www.google.com/recaptcha/api/siteverify',
      new URLSearchParams({
        secret: process.env.RECAPTCHA_SECRET_KEY,
        response: token,
        ...(ip && { remoteip: ip }),
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 5000,
      }
    );

    const { success, score, action: recaptchaAction, 'error-codes': errorCodes } = response.data;

    if (!success) {
      logger.warn(`reCAPTCHA verification failed: ${JSON.stringify(errorCodes)}`);
      const errorMessage = errorCodes?.includes('timeout-or-duplicate')
        ? 'reCAPTCHA verification timed out or token was reused'
        : `reCAPTCHA verification failed: ${errorCodes?.join(', ') || 'Unknown error'}`;
      throw new Error(errorMessage);
    }

    if (recaptchaAction && recaptchaAction.toLowerCase() !== action.toLowerCase()) {
      logger.warn(`reCAPTCHA action mismatch: expected ${action}, got ${recaptchaAction}`);
      throw new Error('Invalid reCAPTCHA action');
    } else if (!recaptchaAction) {
      logger.warn('reCAPTCHA action missing in response');
    }

    logger.info(`reCAPTCHA verified: score=${score}, action=${action}, ip=${ip || 'unknown'}`);
    return { success: true, score: score || 0 };
  } catch (error) {
    logger.error(`reCAPTCHA verification error: ${error.message}`, {
      action,
      ip: ip || 'unknown',
      error: error.response?.data || error.message,
    });
    throw new Error(`reCAPTCHA verification failed: ${error.message}`);
  }
}

module.exports = { verifyRecaptcha };