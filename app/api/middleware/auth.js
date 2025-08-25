// app/api/middleware/auth.js
import { auth } from '@/lib/auth';
import { logger } from '../../../utils/serverLogger';
import { NextResponse } from 'next/server';

export async function requireAuth(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const { pathname } = request.nextUrl;

  // Skip authentication for public APIs
  const publicApis = [
    '/api/csrf-token',
    '/api/auth/signin',
    '/api/auth/signout',
    '/api/auth/callback/google',
    '/api/auth/session',
  ];
  if (publicApis.includes(pathname)) {
    return NextResponse.next();
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip, pathname });
    return NextResponse.json({ detail: 'Not signed in' }, { status: 401 });
  }

  return session;
}