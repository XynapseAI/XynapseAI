// app/api/complete-siwe/route.ts
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { verifyMessage, parseSiweMessage, recoverAddress } from 'viem';
import { logger } from '@/utils/serverLogger';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { payload, nonce } = body;

    const rawSignature = payload?.signature || '';
    const signaturePreview = rawSignature.substring(0, 80) + (rawSignature.length > 80 ? '...' : '');

    logger.info('SIWE verify request received', {
      hasAddress: !!payload?.address,
      address: payload?.address || 'MISSING',
      messageLength: payload?.message?.length || 0,
      rawSignatureLength: rawSignature.length,
      signaturePreview,
      startsWith0x: rawSignature.startsWith('0x'),
    });

    const cookieStore = await cookies();
    const storedNonce = cookieStore.get('siwe')?.value;

    if (nonce !== storedNonce) {
      logger.error('Nonce mismatch', { received: nonce, stored: storedNonce });
      return NextResponse.json({ status: 'error', isValid: false, message: 'Invalid nonce' }, { status: 400 });
    }

    let address = payload?.address;
    let signature = rawSignature;

    // Fallback address từ message (nếu có)
    if (!address && payload?.message) {
      try {
        const parsed = parseSiweMessage(payload.message);
        address = parsed.address;
      } catch (e) {}
    }

    if (!address) {
      logger.error('No address provided');
      return NextResponse.json({ status: 'error', isValid: false, message: 'Missing address' }, { status: 400 });
    }

    // ====================== NORMALIZE SIGNATURE ======================
    if (!signature.startsWith('0x')) signature = '0x' + signature;

    let isValid = false;

    // Trường hợp chuẩn 65 bytes (130 ký tự)
    if (signature.length === 130) {
      isValid = await verifyMessage({
        address: address as `0x${string}`,
        message: payload.message,
        signature: signature as `0x${string}`,
      });
    }
    // Trường hợp 64 bytes (128 ký tự) – phổ biến ở Coinbase
    else if (signature.length === 128) {
      logger.warn('64-byte signature detected → trying v=27 and v=28');
      const sig27 = signature + '1b';
      isValid = await verifyMessage({
        address: address as `0x${string}`,
        message: payload.message,
        signature: sig27 as `0x${string}`,
      });

      if (!isValid) {
        const sig28 = signature + '1c';
        isValid = await verifyMessage({
          address: address as `0x${string}`,
          message: payload.message,
          signature: sig28 as `0x${string}`,
        });
      }
    }
    // Trường hợp khác (66 bytes, 64 bytes không 0x, v.v.) → thử recoverAddress thủ công
    else {
      logger.warn(`Unusual signature length: ${signature.length} → trying manual recovery`);
      try {
        const messageHash = await recoverAddress({
          hash: payload.message, // viem sẽ tự hash lại
          signature: signature as `0x${string}`,
        });
        isValid = messageHash.toLowerCase() === address.toLowerCase();
      } catch (recoverErr) {
        // Thử tất cả recoveryId từ 0 → 3
        for (let recoveryId = 0; recoveryId < 4; recoveryId++) {
          try {
            const sigWithV = signature + recoveryId.toString(16).padStart(2, '0');
            const recovered = await recoverAddress({
              hash: payload.message,
              signature: sigWithV as `0x${string}`,
            });
            if (recovered.toLowerCase() === address.toLowerCase()) {
              isValid = true;
              break;
            }
          } catch (e) {}
        }
      }
    }

    if (!isValid) {
      logger.error('SIWE signature verification failed after all recovery attempts');
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