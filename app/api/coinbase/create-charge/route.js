import { NextResponse } from 'next/server';
import { Client, resources } from 'coinbase-commerce-node';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
Client.init(process.env.COINBASE_COMMERCE_API_KEY);

export async function POST(req) {
  try {
    const { userId, plan, amount, currency } = await req.json();

    // Xác minh CSRF token
    const csrfToken = req.headers.get('x-csrf-token');
    const cookieCsrfToken = req.cookies.get('csrfToken')?.value;
    if (!csrfToken || csrfToken !== cookieCsrfToken) {
      return NextResponse.json({ success: false, detail: 'Invalid CSRF token' }, { status: 403 });
    }

    // Tạo charge trên Coinbase
    const chargeData = {
      name: `${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan Upgrade`,
      description: `Upgrade to ${plan} plan for user ${userId}`,
      local_price: { amount: amount.toFixed(2), currency },
      metadata: { userId, plan },
      pricing_type: 'fixed_price',
    };

    const charge = await resources.Charge.create(chargeData);
    const chargeCode = charge.code;
    const chargeId = charge.id;

    // Lưu thông tin charge vào bảng Payment
    await prisma.payment.create({
      data: {
        userId,
        chargeId,
        chargeCode,
        amount,
        currency,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      hostedUrl: charge.hosted_url,
      chargeId,
      chargeCode,
    });
  } catch (error) {
    console.error('Error creating Coinbase charge:', error);
    return NextResponse.json({ success: false, detail: 'Failed to create charge' }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}