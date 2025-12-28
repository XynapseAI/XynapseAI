import { NextResponse } from 'next/server';
import { query } from '@/utils/postgres'; 

export async function GET() {
  try {
    const { rows } = await query('SELECT 1 as test;');
    return NextResponse.json({ 
      success: true, 
      message: 'DB connection OK', 
      result: rows[0] 
    });
  } catch (err) {
    console.error('DB Test Error:', err);
    return NextResponse.json({ 
      error: err.message, 
      success: false 
    }, { status: 500 });
  }
}