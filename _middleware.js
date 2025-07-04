import { NextResponse } from 'next/server';
import { ipRateLimiter } from './lib/rateLimit';
import helmet from 'helmet';

export async function middleware(req) {
  const response = NextResponse.next();

  // Áp dụng helmet để đặt Content Security Policy (CSP)
  await new Promise((resolve, reject) => {
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'https://ipfs.io', 'https://pbs.twimg.com', 'https://coin-images.coingecko.com'],
          connectSrc: [
            "'self'",
            'https://api.geckoterminal.com',
            'https://api.coingecko.com',
            'https://api.sim.dune.com',
            'https://www.google.com',
            'https://www.recaptcha.net',
          ],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'", // Chỉ nên dùng nếu không thể tránh được
            "'unsafe-eval'",   // Chỉ nên dùng nếu không thể tránh được
            'https://www.google.com',
            'https://www.gstatic.com', // Rất quan trọng cho reCAPTCHA!
            'https://www.recaptcha.net',
          ],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        },
      },
      xFrameOptions: { action: 'deny' },
      xContentTypeOptions: true,
    })(req, response, (err) => (err ? reject(err) : resolve()));
  });

  // Áp dụng rate limiter
  try {
    await new Promise((resolve, reject) => {
      ipRateLimiter(req, response, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    return NextResponse.json({ detail: 'Too many requests, please try again later.' }, { status: 429 });
  }

  return response;
}

// Áp dụng middleware cho tất cả các API routes
export const config = {
  matcher: ['/api/:path*'],
};