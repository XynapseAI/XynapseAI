import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { verifyMessage } from 'viem';
import { logger } from '@/utils/serverLogger'; // giữ nguyên nếu bạn có

interface IRequestPayload {
  payload: {
    message: string;
    signature: `0x${string}`;
    address: `0x${string}`;
  };
  nonce: string;
}

export async function POST(req: NextRequest) {
  try {
    const { payload, nonce } = await req.json() as IRequestPayload;

    // 1. Kiểm tra nonce (giữ nguyên như cũ)
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

    // 2. Verify SIWE bằng viem (chuẩn cho Base App)
    const isValid = await verifyMessage({
      address: payload.address,
      message: payload.message,
      signature: payload.signature,
    });

    if (!isValid) {
      logger.error('SIWE signature verification failed');
      return NextResponse.json({
        status: 'error',
        isValid: false,
        message: 'Invalid signature',
      }, { status: 400 });
    }

    // 3. Xóa nonce sau khi verify thành công
    cookieStore.delete('siwe');

    logger.info('SIWE verified successfully', { address: payload.address });

    return NextResponse.json({
      status: 'success',
      isValid: true,
      address: payload.address,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('SIWE verification error', { error: errorMessage });
    return NextResponse.json({
      status: 'error',
      isValid: false,
      message: 'Server error during verification',
    }, { status: 500 });
  }
}