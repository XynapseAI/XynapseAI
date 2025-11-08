import { NextResponse } from 'next/server';

export async function GET() {
  // Ensure FARCASTER_APP_ID is set in .env (your Farcaster Mini App ID from developer portal)
  if (!process.env.FARCASTER_APP_ID) {
    console.error('FARCASTER_APP_ID not configured – Quick Auth will fail. Set in Vercel env vars.');
    return NextResponse.json({ error: 'Configuration missing' }, { status: 500 });
  }
  return NextResponse.json({ app_id: process.env.FARCASTER_APP_ID });
}