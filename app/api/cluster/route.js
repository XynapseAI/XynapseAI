import { NextResponse } from 'next/server';
import { detectClustersServer } from '../../../utils/serverClustering';

// Danh sách các nguồn gốc (origins) được phép truy cập API
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://farcaster.xynapseai.net',
  'https://base.xynapseai.net',
  'https://xynapse-ai-xynapse-projects.vercel.app',
].filter(Boolean);

/**
 * Hàm kiểm tra nguồn gốc truy cập (Origin Check)
 * @param {string | null} origin - Header Origin
 * @param {string | null} referer - Header Referer
 * @returns {boolean}
 */
function isAllowedOrigin(origin, referer) {
  try {
    // 1. Kiểm tra Origin trực tiếp
    if (origin && (allowedOrigins.includes(origin) || new URL(origin).hostname.endsWith('xynapseai.net'))) {
      return true;
    }
    // 2. Kiểm tra Referer nếu Origin không có
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin) || new URL(refOrigin).hostname.endsWith('xynapseai.net')) {
        return true;
      }
    }
    // 3. Cho phép yêu cầu nội bộ hoặc không rõ trong môi trường dev
    if (!origin && process.env.NODE_ENV === 'development') {
      console.log('Localhost request - skipping violation check');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Xử lý yêu cầu POST tới /api/cluster
 * @param {Request} request - Đối tượng Request của Next.js
 * @returns {NextResponse}
 */
export async function POST(request) {
  const startOverall = Date.now();
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '::1';

  // 1. Kiểm tra Origin/CORS
  if (!isAllowedOrigin(origin, referer)) {
    console.warn(`[Violation] Blocked request from Origin: ${origin || 'None'} and Referer: ${referer || 'None'} at IP: ${ip}`);
    return NextResponse.json({ success: false, error: 'Forbidden Origin' }, { status: 403 });
  }

  // 2. Tải các thư viện nặng (Dynamic Import) - FIXED: Handle load errors gracefully
  let tf = null;
  let IsolationForest = null;

  try {
    const tfModule = await import('@tensorflow/tfjs');
    tf = tfModule;
    console.log('TF.js loaded successfully');
  } catch (tfErr) {
    console.warn("TF.js load failed:", tfErr.message);
    // Continue without TF (fallback to rules)
  }

  try {
    const ifModule = await import('ml-isolation-forest');
    IsolationForest = ifModule.IsolationForest || ifModule.default?.IsolationForest || ifModule.default;
    console.log('Isolation Forest loaded successfully');
  } catch (ifErr) {
    console.warn("Isolation Forest load failed:", ifErr.message);
    // Continue without IF
  }

  // 3. Xử lý yêu cầu chính - FIXED: No client worker call; metrics computed in serverClustering
  try {
    const body = await request.json();
    const { nodes, edges, options } = body;

    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return NextResponse.json({ success: false, error: 'Invalid input: nodes and edges must be arrays.' }, { status: 400 });
    }

    // Gọi hàm logic chính (đã fix errors)
    const clusters = await detectClustersServer(
      nodes,
      edges,
      options,
      tf,
      IsolationForest
    );

    const timeElapsed = Date.now() - startOverall;
    console.log(`Clustering completed successfully after ${timeElapsed}ms`);

    return NextResponse.json({
      success: true,
      clusters,  // FIXED: Use 'clusters' key for client setClusters
      time: timeElapsed
    });

  } catch (error) {
    const timeElapsed = Date.now() - startOverall;
    console.error(`Clustering error after ${timeElapsed}ms`, {
      error: error.message,
      stack: error.stack
    });

    // Trả về lỗi 500
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}