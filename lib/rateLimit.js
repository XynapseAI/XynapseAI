// lib/rateLimit.js
import rateLimit from 'express-rate-limit'

// Cấu hình rate-limit: mỗi IP chỉ được 100 requests / 1 phút
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 100,            // tối đa 100 request mỗi IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests from this IP, please try again later.',
    })
  },
})

// Middleware adapter để dùng trong API Route
export function applyRateLimit(req, res) {
  return new Promise((resolve, reject) => {
    limiter(req, res, (result) => {
      if (result instanceof Error) return reject(result)
      return resolve(result)
    })
  })
}
