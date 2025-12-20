// app/api/record-mint/route.js
import { NextResponse } from 'next/server';
import { logger } from '../../../utils/serverLogger';

// REMOVED: No longer record mint in DB, rely on on-chain. This API now just returns success for compatibility if called.
export async function POST(request) {
  logger.info('record-mint API called (noop - on-chain only)');
  return NextResponse.json({ success: true, detail: 'Mint recorded on-chain' });
}