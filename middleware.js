import { NextResponse } from 'next/server';
import crypto from 'crypto';
export const runtime = 'nodejs';
export function middleware(request) {
  const { pathname } = request.nextUrl;
  // FIXED: Skip cho auth paths và farcaster.json để tránh conflict
  if (pathname.startsWith('/api/auth/') || pathname === '/.well-known/farcaster.json') {
    return NextResponse.next();
  }
  const response = NextResponse.next();
  let csrfToken = request.cookies.get('csrf_token')?.value;
  if (!csrfToken) {
    // Sử dụng crypto cho secure
    csrfToken = crypto.randomBytes(32).toString('hex');
    response.cookies.set('csrf_token', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Fix mobile/cross-site
      path: '/',
      domain: '.xynapseai.net' // Share cross subdomain
    });
  }
  response.headers.set('X-CSRF-Token', csrfToken);
  return response;
}
export const config = {
  matcher: '/api/:path*',
};