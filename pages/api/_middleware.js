import { ipRateLimiter } from '../../lib/rateLimit';

export default function middleware(req, res, next) {
  ipRateLimiter(req, res, next);
}