// app/api/complete-siwe/route.ts
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { verifyMessage, parseSiweMessage, hashMessage, recoverAddress } from 'viem';
import { logger } from '@/utils/serverLogger';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { payload, nonce } = body;

    const rawSig = payload?.signature || '';
    const sigPreview = rawSig.length > 100 
      ? rawSig.substring(0, 100) + '...' 
      : rawSig;

    logger.info('SIWE verify request received', {
      address: payload?.address || 'MISSING',
      messageLength: payload?.message?.length || 0,
      rawSignatureLength: rawSig.length,
      signaturePreview: sigPreview,
    });

    const cookieStore = await cookies();
    const storedNonce = cookieStore.get('siwe')?.value;

    if (nonce !== storedNonce) {
      logger.error('Nonce mismatch');
      return NextResponse.json({ status: 'error', isValid: false, message: 'Invalid nonce' }, { status: 400 });
    }

    let address = payload?.address;
    let signature = rawSig;

    // Fallback address từ message
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

    // ====================== NORMALIZE & FIX SIGNATURE ======================
    if (!signature.startsWith('0x')) signature = '0x' + signature;

    let isValid = false;

    // 1. Trường hợp chuẩn 65 bytes
    if (signature.length === 130) {
      isValid = await verifyMessage({
        address: address as `0x${string}`,
        message: payload.message,
        signature: signature as `0x${string}`,
      });
    }
    // 2. Trường hợp 64 bytes (Coinbase thường gặp)
    else if (signature.length === 128) {
      logger.warn('64-byte signature → trying v=27 / v=28');
      isValid = await verifyMessage({ address: address as `0x${string}`, message: payload.message, signature: (signature + '1b') as `0x${string}` })
        || await verifyMessage({ address: address as `0x${string}`, message: payload.message, signature: (signature + '1c') as `0x${string}` });
    }
    // 3. Trường hợp dài bất thường (1218 ký tự) → lấy 130 ký tự cuối làm signature
    else if (signature.length > 200) {
      logger.warn(`Very long signature (${signature.length} chars) → extracting last 130 chars`);
      const shortSig = signature.slice(-130);
      isValid = await verifyMessage({
        address: address as `0x${string}`,
        message: payload.message,
        signature: ('0x' + shortSig) as `0x${string}`,
      });
    }
    // 4. Fallback: manual recover bằng hashMessage (an toàn nhất)
    else {
      logger.warn(`Unusual signature length: ${signature.length} → manual recovery`);
      const messageHash = hashMessage(payload.message);
      try {
        const recovered = await recoverAddress({ hash: messageHash, signature: signature as `0x${string}` });
        isValid = recovered.toLowerCase() === address.toLowerCase();
      } catch (e) {
        // Thử thêm 4 recoveryId phổ biến
        for (let i = 0; i < 4; i++) {
          try {
            const recovered = await recoverAddress({
              hash: messageHash,
              signature: (signature + i.toString(16).padStart(2, '0')) as `0x${string}`,
            });
            if (recovered.toLowerCase() === address.toLowerCase()) {
              isValid = true;
              break;
            }
          } catch {}
        }
      }
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
    });
    return NextResponse.json({ status: 'error', isValid: false, message: 'Server error during verification' }, { status: 500 });
  }
}