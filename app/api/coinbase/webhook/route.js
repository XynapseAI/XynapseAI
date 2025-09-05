import { NextResponse } from 'next/server';
import { Webhook } from 'coinbase-commerce-node';
import { PrismaClient } from '@prisma/client';
import { buffer } from 'micro';

const prisma = new PrismaClient();

export async function POST(req) {
  try {
    // Lấy raw body để xác minh chữ ký
    const rawBody = await buffer(req);
    const signature = req.headers.get('x-cc-webhook-signature');
    const webhookSecret = process.env.COINBASE_COMMERCE_WEBHOOK_SECRET;

    // Xác minh chữ ký webhook
    Webhook.verifySigHeader(rawBody.toString(), signature, webhookSecret);

    const event = JSON.parse(rawBody.toString());
    if (event.type === 'charge:confirmed') {
      const { chargeId, userId } = event.data.metadata;
      const chargeCode = event.data.code;
      const amount = parseFloat(event.data.payments[0].value.local.amount);
      const currency = event.data.payments[0].value.local.currency;

      // Đối chiếu với bản ghi trong DB
      const payment = await prisma.payment.findUnique({
        where: { chargeId },
      });

      if (!payment) {
        return NextResponse.json({ success: false, detail: 'Payment not found' }, { status: 400 });
      }

      if (payment.chargeCode !== chargeCode || payment.amount !== amount || payment.currency !== currency) {
        return NextResponse.json({ success: false, detail: 'Payment mismatch' }, { status: 400 });
      }

      // Cập nhật trạng thái thanh toán
      await prisma.payment.update({
        where: { chargeId },
        data: { status: 'confirmed', updatedAt: new Date() },
      });

      // Cập nhật tier người dùng thành Premium
      await prisma.users.update({
        where: { id: userId },
        data: {
          tier: 'Premium',
          is_premium: true,
          premium_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 năm
          updated_at: new Date(),
        },
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true, detail: 'Event processed' });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return NextResponse.json({ success: false, detail: 'Invalid webhook signature or processing error' }, { status: 400 });
  } finally {
    await prisma.$disconnect();
  }
}

// Cấu hình để nhận raw body (cần cho xác minh chữ ký)
export const config = {
  api: {
    bodyParser: false,
  },
};