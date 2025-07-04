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
          imgSrc: ["'self'", 'https://ipfs.io', 'https://pbs.twimg.com', 'https://coin-images.coingecko.com', 'data:'], // Thêm 'data:' và coin-images nếu cần
          connectSrc: [
            "'self'",
            'https://api.geckoterminal.com',
            'https://api.coingecko.com', // Thêm nếu cần, từ cấu hình Nginx
            'https://api.sim.dune.com', // Thêm nếu cần, từ cấu hình Nginx
            'https://www.google.com', // Cho reCAPTCHA
            'https://www.recaptcha.net', // Cho reCAPTCHA
            'https://*.firebaseio.com', // Cho Firebase
            'wss://*.firebaseio.com', // Cho Firebase websockets
            'https://api.etherscan.io' // Cho Etherscan
          ],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'", // Cân nhắc loại bỏ 'unsafe-inline' nếu có thể
            "'unsafe-eval'",   // Cân nhắc loại bỏ 'unsafe-eval' nếu có thể
            'https://www.google.com', // Cho reCAPTCHA
            'https://www.gstatic.com', // Cho reCAPTCHA (rất quan trọng!)
            'https://www.recaptcha.net', // Cho reCAPTCHA
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com' // Cho Google Fonts
          ],
          fontSrc: [
            "'self'",
            'https://fonts.gstatic.com' // Cho Google Fonts
          ],
          frameSrc: ["'none'"], // Nếu bạn không nhúng iframe, giữ 'none'. Nếu có, cần thêm nguồn.
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