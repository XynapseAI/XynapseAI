import rateLimit from 'express-rate-limit';

const ipRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Max 100 requests per IP per minute
  standardHeaders: true, // Return rate limit info in headers (`RateLimit-*`)
  legacyHeaders: false, // Use standard headers instead of legacy `X-Rate-Limit-*`
  handler: (req, res, next) => {
    res.status(429).json({
      success: false,
      detail: 'Too many requests from this IP, please try again later.',
    });
  },
});

module.exports = ipRateLimiter;