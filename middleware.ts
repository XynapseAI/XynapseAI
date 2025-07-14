// middleware.ts (ở thư mục gốc)
import { NextResponse, NextRequest } from 'next/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';

// Cấu hình rate limiter tương tự express-rate-limit
const rateLimiter = new RateLimiterMemory({
  points: 100, // Tối đa 100 request
  duration: 60, // Trong 60 giây
});

export const config = {
  matcher: ['/((?!_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)'],
};

export default async function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const hostname = req.headers.get('host') || '';
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const allowedDomains = ['localhost:3000', 'xynapseai.net', 'app.xynapseai.net', 'api.xynapseai.net'];

  // Kiểm tra rate limit
  try {
    await rateLimiter.consume(ip);
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        detail: 'Too many requests from this IP, please try again later.',
      }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Kiểm tra domain hợp lệ
  if (!allowedDomains.some(domain => hostname.includes(domain))) {
    return new Response(null, { status: 404 });
  }

  // Xử lý định tuyến dựa trên subdomain
  if (hostname.includes('app.xynapseai.net')) {
    if (!url.pathname.startsWith('/dashboard')) {
      return NextResponse.rewrite(new URL(`/dashboard${url.pathname || '/leaderboard'}`, req.url));
    }
  } else if (hostname.includes('api.xynapseai.net')) {
    if (!url.pathname.startsWith('/api')) {
      return NextResponse.rewrite(new URL(`/api${url.pathname}`, req.url));
    }
  } else if (hostname.includes('xynapseai.net')) {
    if (url.pathname === '/' || url.pathname.startsWith('/dashboard')) {
      return NextResponse.next();
    }
  }

  return NextResponse.next();
}