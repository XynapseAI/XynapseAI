// app/api/complete-siwe/route.ts
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { verifyMessage, parseSiweMessage } from 'viem';
import { logger } from '@/utils/serverLogger';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { payload, nonce } = body;

    logger.info('SIWE verify request received', {
      hasAddress: !!payload?.address,
      address: payload?.address || 'MISSING',
      messageLength: payload?.message?.length || 0,
      nonce,
    });

    const cookieStore = await cookies();
    const storedNonce = cookieStore.get('siwe')?.value;

    if (nonce !== storedNonce) {
      logger.error('Nonce mismatch', { received: nonce, stored: storedNonce });
      return NextResponse.json({ status: 'error', isValid: false, message: 'Invalid nonce' }, { status: 400 });
    }

    let address = payload?.address;

    // Fallback: nếu frontend cũ gửi thiếu address → tự parse từ message
    if (!address && payload?.message) {
      try {
        const parsed = parseSiweMessage(payload.message);
        address = parsed.address;
        logger.info('Parsed address from SIWE message (fallback)', { address });
      } catch (parseErr) {
        logger.error('Failed to parse SIWE message', { error: parseErr.message });
      }
    }

    if (!address) {
      logger.error('No address in payload');
      return NextResponse.json({ status: 'error', isValid: false, message: 'Missing address' }, { status: 400 });
    }

    const isValid = await verifyMessage({
      address: address as `0x${string}`,
      message: payload.message,
      signature: payload.signature,
    });

    if (!isValid) {
      logger.error('SIWE signature verification failed');
      return NextResponse.json({ status: 'error', isValid: false, message: 'Invalid signature' }, { status: 400 });
    }

    cookieStore.delete('siwe');
    logger.info('SIWE verified successfully', { address });

    return NextResponse.json({ status: 'success', isValid: true, address });
  } catch (error: any) {
    logger.error('SIWE verification error - FULL DETAIL', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
    });
    return NextResponse.json({
      status: 'error',
      isValid: false,
      message: 'Server error during verification',
    }, { status: 500 });
  }
}