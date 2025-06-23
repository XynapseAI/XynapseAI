// utils/verifyRecaptcha.js
const axios = require('axios');
const { logger } = require('./logger');

async function verifyRecaptcha(token, action, ip) {
  // Validate inputs
  if (!token || typeof token !== 'string' || token.length < 10) {
    throw new Error('Invalid reCAPTCHA token');
  }
  if (!action || typeof action !== 'string') {
    throw new Error('Invalid reCAPTCHA action');
  }
  if (ip && !ip.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^([\da-fA-F]{1,4}:){7}[\da-fA-F]{1,4}$|^([\da-fA-F]{1,4}:){1,7}:?([\da-fA-F]{1,4})?$/)) {
    ip = undefined; // Fallback to undefined
  }

  // Check environment variable
  if (!process.env.RECAPTCHA_SECRET_KEY) {
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
        timeout: 10000, // Increased to 10s
      }
    );

    const { success, score, action: recaptchaAction, 'error-codes': errorCodes, hostname } = response.data;

    if (!success) {
      const errorMessage = errorCodes?.includes('timeout-or-duplicate')
        ? 'reCAPTCHA token timed out or was reused'
        : errorCodes?.includes('invalid-input-secret')
        ? 'Invalid reCAPTCHA secret key'
        : `reCAPTCHA verification failed: ${errorCodes?.join(', ') || 'Unknown error'}`;
      throw new Error(errorMessage);
    }

    if (score < 0.5) {
      throw new Error('reCAPTCHA score too low');
    }

    if (recaptchaAction && recaptchaAction.toLowerCase() !== action.toLowerCase()) {
      throw new Error('Invalid reCAPTCHA action');
    } else if (!recaptchaAction) {
    }

    return { success: true, score };
  } catch (error) {
    throw new Error(`reCAPTCHA verification failed: ${error.message}`);
  }
}

module.exports = { verifyRecaptcha };