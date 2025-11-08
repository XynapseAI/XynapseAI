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
    logger.info('Skipping auth for public API', { pathname, ip });
    return NextResponse.next();
  }

  const session = await auth();
  if (!session || !session.user || !session.user.id) {
    logger.warn('Invalid session', { ip, pathname, session: JSON.stringify(session) });
    return NextResponse.json({ detail: 'Not signed in or invalid session' }, { status: 401 });
  }

  logger.info('Session validated', { userId: session.user.id, pathname, ip });
  return session;
}