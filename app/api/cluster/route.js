// app\api\cluster\route.js
// app/api/cluster/route.js (Fixed TF import, pure JS fallback, rate-limit exception for localhost)
import { NextResponse } from 'next/server';
import { detectClustersServer } from '../../../utils/serverClustering';

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'https://xynapse-ai.vercel.app',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
  'https://farcaster.xynapseai.net',
  "https://base.xynapseai.net",
  'https://xynapse-ai-xynapse-projects.vercel.app',
].filter(Boolean);

function isAllowedOrigin(origin, referer) {
  try {
    if (origin && (allowedOrigins.includes(origin) || new URL(origin).hostname.endsWith('xynapseai.net'))) {
      return true;
    }
    if (!origin && referer) {
      const refOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refOrigin) || new URL(refOrigin).hostname.endsWith('xynapseai.net')) {
        return true;
      }
    }
    if (!origin && !referer) {
      return true;
    }
    if (!origin && process.env.NODE_ENV === 'development') {
      return true;
    }
    return false;
  } catch {
    return false; 
  }
}

export async function POST(request) {
  const startOverall = Date.now();
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '::1'; // Default localhost

  // Exception for localhost to avoid violation tracking
  if (ip === '::1' || ip === '127.0.0.1') {
    console.log('Localhost request - skipping violation check');
  }

  if (!isAllowedOrigin(origin, referer)) {
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    console.error('Invalid JSON body', { error: err.message });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  const { nodes, edges, options = { useGNN: true, useDBSCAN: true } } = body; // Disable GNN by default for stability
  if (!nodes?.length || !edges?.length) {
    return NextResponse.json({ detail: 'Missing nodes or edges data' }, { status: 400 });
  }

  const payloadSize = JSON.stringify(body).length;
  if (payloadSize > 1e6) {
    return NextResponse.json({ detail: 'Payload too large' }, { status: 413 });
  }

  try {
    // Dynamic import PURE tfjs only (no native tfjs-node in prod)
    let tf;
    const useNative = process.env.USE_TFJS_NODE === 'true' && process.env.NODE_ENV !== 'production';
    try {
      if (useNative) {
        const tfNodePkg = '@tensorflow/tfjs-node';
        const tfModule = await import(tfNodePkg);
        tf = tfModule;
      } else {
        const tfPkg = '@tensorflow/tfjs';
        const tfModule = await import(tfPkg);
        tf = tfModule;
      }
      await tf.setBackend('cpu');
      await tf.ready();
      console.log(useNative ? 'tfjs-node loaded dynamically' : 'Pure tfjs loaded dynamically');
    } catch (tfErr) {
      console.error('tfjs load failed:', tfErr.message);
      // Full fallback: No TF, pure JS clustering
      options.useGNN = false;
      options.useDBSCAN = false; // Use Louvain only
    }

    const clusters = await detectClustersServer(nodes, edges, options, tf); // Pass tf if available
    const overallDuration = Date.now() - startOverall;
    console.log(`Clustering completed in ${overallDuration}ms`, { nodeCount: nodes.length, clusterCount: clusters.length });

    const res = NextResponse.json({ success: true, clusters });
    const allowOrigin = origin || (referer ? new URL(referer).origin : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
    res.headers.set('Access-Control-Allow-Origin', allowOrigin);
    res.headers.set('Access-Control-Allow-Methods', 'POST');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return res;

  } catch (error) {
    const overallDuration = Date.now() - startOverall;
    console.error(`Clustering error after ${overallDuration}ms`, { error: error.message, stack: error.stack });
    return NextResponse.json({ success: false, detail: 'Clustering failed', clusters: [] }, { status: 500 });
  }
}