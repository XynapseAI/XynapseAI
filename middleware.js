import { NextResponse } from 'next/server';

// Chỉ định runtime là Node.js
export const runtime = 'nodejs';

export function middleware(request) {
  const response = NextResponse.next();
  let csrfToken = request.cookies.get('csrf_token')?.value;

  if (!csrfToken) {
    // Sử dụng crypto.randomUUID để tạo CSRF token thay vì randomBytes
    csrfToken = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 34);
    response.cookies.set('csrf_token', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });
  }

  response.headers.set('X-CSRF-Token', csrfToken);
  return response;
}

export const config = {
  matcher: '/api/:path*',
};