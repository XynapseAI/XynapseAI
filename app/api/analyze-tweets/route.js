import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '../../../utils/serverLogger';
import { createClient } from 'redis';
import { query } from '../../../utils/postgres';
import { auth } from '../auth/[...nextauth]/route';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha';
import axios from 'axios';
import Bottleneck from 'bottleneck';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('Redis Client Error', err));
await redisClient.connect();

const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});

const twitterRequest = limiter.wrap(async (url, config) => {
  try {
    const response = await axios.get(url, {
      ...config,
      headers: {
        ...config.headers,
        Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}`,
      },
    });
    return response.data;
  } catch (error) {
    logger.error(`Twitter API error: ${error.message}`, { url, stack: error.stack });
    throw error;
  }
});

async function checkRateLimit(ip) {
  const key = `rate_limit:analyze_tweets:${ip}`;
  const requests = await redisClient.get(key) || 0;
  const windowMs = parseInt(process.env.ANALYZE_TWEETS_RATE_LIMIT_WINDOW || 15 * 60 * 1000);
  const maxRequests = parseInt(process.env.ANALYZE_TWEETS_RATE_LIMIT_MAX || 10);
  if (requests >= maxRequests) {
    throw new Error('Quá nhiều yêu cầu, vui lòng thử lại sau.');
  }
  await redisClient.multi()
    .incr(key)
    .expire(key, windowMs / 1000)
    .exec();
}

const bodySchema = z.object({
  uid: z.string().max(100, 'UID không hợp lệ'),
  recaptchaToken: z.string().nonempty('Token reCAPTCHA là bắt buộc'),
});

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'https://xynapseai.net',
  'https://www.xynapseai.net',
];

async function checkCSRF(request, session) {
  const csrfToken = request.headers.get('x-csrf-token');
  if (!csrfToken || !session?.csrfToken || csrfToken !== session.csrfToken) {
    logger.warn(`CSRF check failed: Invalid CSRF token: ${csrfToken}`, { ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown' });
    return false;
  }
  return true;
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  logger.info(`Yêu cầu tới /api/analyze-tweets từ IP ${ip}`);

  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins.includes(origin)) {
    logger.error(`CORS error: Origin ${origin} not allowed`, { allowedOrigins });
    return NextResponse.json({ detail: 'Not allowed by CORS' }, { status: 403 });
  }

  try {
    await checkRateLimit(ip);
  } catch (err) {
    logger.error(`Lỗi giới hạn yêu cầu: ${err.message}`, { ip });
    return NextResponse.json({ detail: err.message }, { status: 429 });
  }

  const session = await auth();
  if (!session || !session.user?.id) {
    logger.warn('Chưa đăng nhập', { ip });
    return NextResponse.json({ detail: 'Chưa đăng nhập' }, { status: 401 });
  }

  if (!(await checkCSRF(request, session))) {
    return NextResponse.json({ detail: 'CSRF check không hợp lệ.' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    logger.warn(`Invalid JSON body: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Invalid JSON body' }, { status: 400 });
  }

  let parsedBody;
  try {
    parsedBody = bodySchema.parse(body);
  } catch (err) {
    logger.warn(`Validation error: ${err.message}`, { ip });
    return NextResponse.json({ detail: 'Xác thực thất bại', errors: err.errors }, { status: 400 });
  }

  const { uid, recaptchaToken } = parsedBody;
  if (uid !== session.user.id) {
    logger.warn(`Truy cập bị từ chối: uid=${uid}, sessionUserId=${session.user.id}`, { ip });
    return NextResponse.json({ detail: 'Truy cập bị từ chối' }, { status: 403 });
  }

  try {
    await verifyRecaptcha(recaptchaToken, 'analyze_tweets', ip);
  } catch (error) {
    logger.error(`Xác minh reCAPTCHA thất bại: ${error.message}`, { ip });
    return NextResponse.json({ detail: `Xác minh reCAPTCHA thất bại: ${error.message}` }, { status: 403 });
  }

  return new NextResponse(
    new ReadableStream({
      async start(controller) {
        try {
          const userResult = await query(
            `SELECT twitter_handle, twitter_connected, points, tweet_points, ai_points, task_points 
             FROM users 
             WHERE id = $1`,
            [uid]
          );
          if (userResult.rows.length === 0 || !userResult.rows[0].twitter_connected) {
            logger.warn(`Tài khoản Twitter không được kết nối: ${uid}`, { ip });
            controller.enqueue(JSON.stringify({ detail: 'Tài khoản Twitter không được kết nối' }));
            controller.close();
            return;
          }
          const user = userResult.rows[0];

          let twitterHandle = user.twitter_handle.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '');
          if (!twitterHandle.match(/^[A-Za-z0-9_]{1,15}$/)) {
            logger.warn(`Tài khoản Twitter không hợp lệ: ${twitterHandle}`, { ip });
            controller.enqueue(JSON.stringify({ detail: 'Tài khoản Twitter không hợp lệ' }));
            controller.close();
            return;
          }

          if (!process.env.TWITTER_BEARER_TOKEN) {
            logger.error('Chưa cấu hình Twitter Bearer Token', { ip });
            controller.enqueue(JSON.stringify({ detail: 'Chưa cấu hình Bearer Token' }));
            controller.close();
            return;
          }

          const cacheKey = `twitter_user:${twitterHandle}`;
          let twitterUserId = await redisClient.get(cacheKey);
          if (!twitterUserId) {
            const userResponse = await twitterRequest(
              `https://api.twitter.com/2/users/by/username/${encodeURIComponent(twitterHandle)}?user.fields=id`,
              {}
            );
            if (!userResponse.data) {
              logger.warn(`Không tìm thấy người dùng Twitter: ${twitterHandle}`, { ip });
              controller.enqueue(JSON.stringify({ detail: 'Không tìm thấy người dùng Twitter' }));
              controller.close();
              return;
            }
            twitterUserId = userResponse.data.id;
            await redisClient.setEx(cacheKey, 3600, twitterUserId);
          }

          const tweetsCacheKey = `tweets:${twitterUserId}`;
          let tweets = await redisClient.get(tweetsCacheKey);
          if (!tweets) {
            const tweetsResponse = await twitterRequest(
              `https://api.twitter.com/2/users/${twitterUserId}/tweets?tweet.fields=created_at,text&max_results=10`,
              {}
            );
            if (!tweetsResponse.data) {
              logger.warn(`Không tìm thấy tweet: ${twitterUserId}`, { ip });
              controller.enqueue(JSON.stringify({ detail: 'Không tìm thấy tweet' }));
              controller.close();
              return;
            }
            tweets = tweetsResponse.data;
            await redisClient.setEx(tweetsCacheKey, 300, JSON.stringify(tweets));
          } else {
            tweets = JSON.parse(tweets);
          }

          let totalTweetPoints = user.tweet_points || 0;
          const cryptoKeywords = ['crypto', 'blockchain', 'bitcoin', 'ethereum', 'web3', 'nft'];
          const tweetAnalyses = [];

          for (const tweet of tweets) {
            let points = 0;
            const text = tweet.text.toLowerCase();
            const length = tweet.text.length;

            if (length > 100) points += 50;
            else if (length > 50) points += 30;
            else points += 10;

            if (cryptoKeywords.some((keyword) => text.includes(keyword))) {
              points += 100;
            }

            if (text.includes('http') || text.includes('#')) points += 20;

            totalTweetPoints += points;

            await query(
              `INSERT INTO tweet_analyses (id, user_id, tweet_id, text, points, created_at)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (id) DO NOTHING`,
              [tweet.id, uid, tweet.id, tweet.text, points, new Date(tweet.created_at)]
            );

            tweetAnalyses.push({
              id: tweet.id,
              userId: uid,
              tweetId: tweet.id,
              text: tweet.text,
              points,
              createdAt: new Date(tweet.created_at),
            });
          }

          const totalPoints = totalTweetPoints + (user.ai_points || 0) + (user.task_points || 0);
          await query(
            `UPDATE users SET
               tweet_points = $1,
               points = $2,
               updated_at = $3
             WHERE id = $4`,
            [totalTweetPoints, totalPoints, new Date(), uid]
          );

          logger.info(`Phân tích tweet cho ${uid}: ${tweetAnalyses.length} tweet, tổng điểm: ${totalTweetPoints}`, { ip });
          controller.enqueue(JSON.stringify({
            success: true,
            points: totalPoints,
            tweetPoints: totalTweetPoints,
            message: 'Đã phân tích tweet và cộng điểm!',
          }));
          controller.close();
        } catch (error) {
          if (error.response?.status === 429) {
            logger.error('Vượt quá giới hạn Twitter API', { ip });
            controller.enqueue(JSON.stringify({ detail: 'Vượt quá giới hạn Twitter API. Vui lòng thử lại sau.' }));
            controller.close();
            return;
          }
          logger.error(`Lỗi khi phân tích tweet: ${error.message}`, { stack: error.stack, ip });
          controller.enqueue(JSON.stringify({ detail: `Không thể phân tích tweet: ${error.message}` }));
          controller.close();
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': "default-src 'self'",
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Recaptcha-Token',
      },
    }
  );
}