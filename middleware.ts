// middleware.ts
import { NextResponse, NextRequest } from 'next/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';

const rateLimiter = new RateLimiterMemory({
  points: 100,
  duration: 60,
});

export const config = {
  matcher: ['/((?!_next/|_static/|_vercel|api/|[\\w-]+\\.\\w+).*)'],
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

  // Xử lý định tuyến
  if (hostname.includes('app.xynapseai.net')) {
    if (!url.pathname.startsWith('/dashboard') && !url.pathname.startsWith('/api')) {
      return NextResponse.rewrite(new URL('/dashboard/profile', req.url));
    }
  } else if (hostname.includes('api.xynapseai.net')) {
    if (!url.pathname.startsWith('/api')) {
      return NextResponse.rewrite(new URL(`/api${url.pathname}`, req.url));
    }
  } else if (hostname.includes('xynapseai.net')) {
    if (url.pathname.startsWith('/dashboard')) {
      // Chuyển hướng /dashboard/* sang app.xynapseai.net
      return NextResponse.redirect(new URL(`https://app.xynapseai.net${url.pathname}`, req.url));
    }
    if (url.pathname === '/' || !url.pathname.startsWith('/api')) {
      return NextResponse.next();
    }
  }

  return NextResponse.next();
}