import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { MiniAppWalletAuthSuccessPayload, verifySiweMessage } from '@worldcoin/minikit-js';
import { logger } from '@/utils/serverLogger';  // Import logger nếu có

interface IRequestPayload {
  payload: MiniAppWalletAuthSuccessPayload;
  nonce: string;
}

export async function POST(req: NextRequest) {
  try {
    const { payload, nonce } = await req.json() as IRequestPayload;

    // FIXED: Check nonce match cookie (từ /api/nonce)
    const cookieStore = await cookies();
    const storedNonce = cookieStore.get('siwe')?.value;
    if (nonce !== storedNonce) {
      logger.error('Nonce mismatch in SIWE verify', { received: nonce, stored: storedNonce });
      return NextResponse.json({
        status: 'error',
        isValid: false,
        message: 'Invalid nonce',
      }, { status: 400 });
    }

    // NEW: Verify SIWE với MiniKit lib (docs 2025: Chuẩn cho walletAuth)
    const validMessage = await verifySiweMessage(payload, nonce);
    if (!validMessage.isValid) {
      logger.error('SIWE verification failed');
      return NextResponse.json({
        status: 'error',
        isValid: false,
        message: 'Invalid SIWE message',
      }, { status: 400 });
    }

    // Success: Cleanup nonce (tương tự DELETE route cũ)
    cookieStore.delete('siwe');

    logger.info('SIWE verified successfully', { address: payload.address });
    return NextResponse.json({
      status: 'success',
      isValid: true,
      address: payload.address,  // Optional: Trả address cho frontend
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('SIWE verification error', { error: errorMessage });
    return NextResponse.json({
      status: 'error',
      isValid: false,
      message: 'Server error',
    }, { status: 500 });
  }
}