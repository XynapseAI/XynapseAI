import { NextResponse } from 'next/server';
import { query } from '@/utils/postgres';  // Giả sử bạn có file này để query DB

export async function GET() {
  try {
    // Test query đơn giản để kiểm tra kết nối DB
    const { rows } = await query('SELECT 1 as test;');
    return NextResponse.json({ 
      success: true, 
      message: 'DB connection OK', 
      result: rows[0] 
    });
  } catch (err) {
    console.error('DB Test Error:', err);  // Log để xem trên Vercel
    return NextResponse.json({ 
      error: err.message, 
      success: false 
    }, { status: 500 });
  }
}