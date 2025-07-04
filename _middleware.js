// middleware.js (ở thư mục gốc)
import { ipRateLimiter } from './lib/rateLimit';

export function middleware(req, res, next) {
  return ipRateLimiter(req, res, next);
}