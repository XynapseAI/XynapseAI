// lib/rateLimit.js
import { rateLimit } from 'express-rate-limit';

const ipRateLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 100, 
  standardHeaders: true, 
  legacyHeaders: false, 
  handler: (req, res) => { 
    res.status(429).json({
      success: false,
      detail: 'Too many requests from this IP, please try again later.',
    });
  },
});

module.exports = ipRateLimiter;