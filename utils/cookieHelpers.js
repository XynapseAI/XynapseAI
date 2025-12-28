// utils/cookieHelpers.js
import cookie from 'cookie';
import crypto from 'crypto';

const isProd = process.env.NODE_ENV === 'production';

export function getCookieOptions(name) {
  return {
    httpOnly: false, 
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax', 
    domain: isProd ? (process.env.COOKIE_DOMAIN || '.xynapseai.net') : undefined,
    maxAge: 15 * 60,
    path: '/',
  };
}

export function serializeCookie(name, value, options = {}) {
  return cookie.serialize(name, value, getCookieOptions(name, options));
}

export function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}