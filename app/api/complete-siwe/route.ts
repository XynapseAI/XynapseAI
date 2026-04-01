// app/api/complete-siwe/route.ts
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { verifyMessage, parseSiweMessage, recoverAddress } from 'viem';
import { logger } from '@/utils/serverLogger';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { payload, nonce } = body;

    logger.info('SIWE verify request received', {
      hasAddress: !!payload?.address,
      address: payload?.address || 'MISSING',
      messageLength: payload?.message?.length || 0,
      signatureLength: payload?.signature?.length || 0,
      signaturePreview: payload?.signature?.substring(0, 30) + '...',
    });

    const cookieStore = await cookies();
    const storedNonce = cookieStore.get('siwe')?.value;

    if (nonce !== storedNonce) {
      logger.error('Nonce mismatch', { received: nonce, stored: storedNonce });
      return NextResponse.json({ status: 'error', isValid: false, message: 'Invalid nonce' }, { status: 400 });
    }

    let address = payload?.address;
    let signature = payload?.signature || '';

    // Normalize signature
    if (!signature.startsWith('0x')) signature = '0x' + signature;

    // Fallback: parse address từ message nếu frontend cũ gửi thiếu
    if (!address && payload?.message) {
      try {
        const parsed = parseSiweMessage(payload.message);
        address = parsed.address;
        logger.info('Parsed address from SIWE message (fallback)', { address });
      } catch (e) {}
    }

    if (!address) {
      logger.error('No address provided');
      return NextResponse.json({ status: 'error', isValid: false, message: 'Missing address' }, { status: 400 });
    }

    // ====================== XỬ LÝ SIGNATURE KHÔNG CHUẨN ======================
    let isValid = false;

    if (signature.length === 130) {
      // Trường hợp chuẩn (65 bytes)
      isValid = await verifyMessage({
        address: address as `0x${string}`,
        message: payload.message,
        signature: signature as `0x${string}`,
      });
    } else if (signature.length === 128) {
      // Trường hợp 64 bytes (r,s) – phổ biến ở Coinbase Mini App
      logger.warn('64-byte signature detected → trying v=27 and v=28');
      
      // Thử v = 27 (0x1b)
      const sig27 = signature + '1b';
      isValid = await verifyMessage({
        address: address as `0x${string}`,
        message: payload.message,
        signature: sig27 as `0x${string}`,
      });

      if (!isValid) {
        // Thử v = 28 (0x1c)
        const sig28 = signature + '1c';
        isValid = await verifyMessage({
          address: address as `0x${string}`,
          message: payload.message,
          signature: sig28 as `0x${string}`,
        });
      }
    } else {
      logger.error('Unsupported signature length', { length: signature.length });
      return NextResponse.json({ status: 'error', isValid: false, message: 'Invalid signature length' }, { status: 400 });
    }

    if (!isValid) {
      logger.error('SIWE signature verification failed after all attempts');
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
    });
    return NextResponse.json({
      status: 'error',
      isValid: false,
      message: 'Server error during verification',
    }, { status: 500 });
  }
}