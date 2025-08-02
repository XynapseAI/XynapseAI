import { auth } from '../auth/[...nextauth]/route';
import { logger } from '../../../utils/serverLogger';
import { NextResponse } from 'next/server';

export async function requireAuth(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Session not authenticated or missing user ID', { ip });
    return NextResponse.json({ detail: 'Not signed in' }, { status: 401 });
  }
  return session;
}