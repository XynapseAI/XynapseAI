import { NextResponse } from 'next/server';
import { logger } from '../../../../utils/serverLogger';

export async function GET(request, { params }) {
  const { id } = params;
  logger.info(`Redirecting /api/user/${id} to /api/user?uid=${id}`);
  return NextResponse.redirect(new URL(`/api/user?uid=${encodeURIComponent(id)}`, request.url));
}