import { NextResponse } from 'next/server';

export async function GET() {
  const manifest = {
    app_fid: "019a49ef-4b9b-c002-0923-6efb49d4796b",  // FID của app Farcaster của bạn (từ Warpcast dev dashboard)
    homeUrl: "https://xynapseai.net/dashboard",  // URL Mini App entry point
    // Thêm nếu cần: icons, name, etc. theo spec Farcaster Mini App
  };
  return NextResponse.json(manifest, {
    headers: { 'Cache-Control': 'public, max-age=3600, immutable' }
  });
}