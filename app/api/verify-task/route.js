// app/api/verify-task/route.js
import { query } from '../../../utils/postgres.js';
import { auth } from '../auth/[...nextauth]/route.js';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha.js';
import TwitterApi from 'twitter-api-v2';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { logger } from '../../../utils/serverLogger.js';
import { NextResponse } from 'next/server';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 50, // 50 yêu cầu mỗi cửa sổ
  handler: () => {
    return NextResponse.json(
      { detail: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
      { status: 429 }
    );
  },
});

const validate = [
  body('taskId').isString().isLength({ max: 100 }).withMessage('ID nhiệm vụ không hợp lệ'),
  body('userId').isString().isLength({ max: 100 }).withMessage('ID người dùng không hợp lệ'),
  body('taskType')
    .isString()
    .isIn(['tweet', 'follow', 'like', 'join', 'ai_interaction'])
    .withMessage('Loại nhiệm vụ không hợp lệ'),
  body('link')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Liên kết không hợp lệ'),
  body('recaptchaToken').isString().withMessage('Token reCAPTCHA không hợp lệ'),
];

export async function POST(req) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  logger.info(`Yêu cầu đến /api/verify-task từ IP ${ip}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, null, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Lỗi giới hạn yêu cầu: ${err.message}`);
    return NextResponse.json(
      { detail: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
      { status: 429 }
    );
  }

  const session = await auth(req);
  if (!session) {
    logger.error(`Lỗi xác thực: Chưa đăng nhập`);
    return NextResponse.json(
      { detail: 'Chưa đăng nhập: Vui lòng đăng nhập.' },
      { status: 401 }
    );
  }

  const body = await req.json();
  await Promise.all(validate.map((validation) => validation.run({ body })));
  const errors = validationResult({ body });
  if (!errors.isEmpty()) {
    logger.warn(`Lỗi xác thực: ${JSON.stringify(errors.array())}`);
    return NextResponse.json(
      { detail: 'Xác thực thất bại', errors: errors.array() },
      { status: 400 }
    );
  }

  const { taskId, userId, taskType, link, recaptchaToken } = body;

  if (!taskId || !userId || !taskType || userId !== session.user.id) {
    logger.error(
      `Tham số không hợp lệ: taskId=${taskId}, userId=${userId}, sessionUserId=${session.user.id}`
    );
    return NextResponse.json(
      { detail: 'Tham số thiếu hoặc không hợp lệ' },
      { status: 400 }
    );
  }

  try {
    await verifyRecaptcha(recaptchaToken, 'verify_task', ip);
    logger.info('Xác minh reCAPTCHA thành công cho hành động: verify_task');
  } catch (error) {
    logger.error(`Xác minh reCAPTCHA thất bại: ${error.message}`);
    return NextResponse.json(
      { detail: 'Xác minh reCAPTCHA thất bại. Vui lòng thử lại.' },
      { status: 403 }
    );
  }

  try {
    const taskResult = await query(
      `SELECT is_daily, max_completions, points
       FROM tasks
       WHERE id = $1`,
      [taskId]
    );
    if (taskResult.rows.length === 0) {
      logger.error(`Không tìm thấy nhiệm vụ: ${taskId}`);
      return NextResponse.json({ detail: 'Không tìm thấy nhiệm vụ' }, { status: 404 });
    }
    const task = taskResult.rows[0];

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dateString = today.toISOString().split('T')[0];
    const completionId = `${userId}_${taskId}_${dateString}`;
    const completionResult = await query(
      `SELECT completion_count
       FROM task_completions
       WHERE id = $1`,
      [completionId]
    );
    let completionCount = completionResult.rows.length > 0 ? completionResult.rows[0].completion_count : 0;

    if (task.is_daily && completionCount >= task.max_completions) {
      logger.info(`Đã đạt giới hạn nhiệm vụ hàng ngày cho nhiệm vụ: ${taskId}, người dùng: ${userId}`);
      return NextResponse.json(
        { detail: 'Đã đạt giới hạn nhiệm vụ hàng ngày' },
        { status: 400 }
      );
    }

    let isCompleted = false;

    if (taskType === 'ai_interaction') {
      const dailyInteractionId = `${userId}_${dateString}_${taskType}`;
      const dailyInteractionResult = await query(
        `SELECT count
         FROM daily_ai_interactions
         WHERE id = $1`,
        [dailyInteractionId]
      );
      if (dailyInteractionResult.rows.length === 0) {
        logger.info(`Không tìm thấy tương tác AI cho người dùng ${userId} vào ${dateString}`);
        return NextResponse.json(
          { detail: 'Không có tương tác AI nào được ghi nhận' },
          { status: 400 }
        );
      }
      if (dailyInteractionResult.rows[0].count < task.max_completions) {
        logger.info(
          `Tương tác AI không đủ: ${dailyInteractionResult.rows[0].count}/${task.max_completions}`
        );
        return NextResponse.json(
          { detail: 'Hoàn thành tất cả tương tác AI hàng ngày trước khi xác minh' },
          { status: 400 }
        );
      }
      completionCount = dailyInteractionResult.rows[0].count;
      isCompleted = true;
    } else {
      const userResult = await query(
        `SELECT twitter_access_token, twitter_handle, discord_access_token
         FROM users
         WHERE id = $1`,
        [userId]
      );
      if (userResult.rows.length === 0 || !userResult.rows[0].twitter_access_token) {
        logger.error(`Không có token Twitter cho người dùng: ${userId}`);
        return NextResponse.json(
          { detail: 'Twitter chưa được kết nối' },
          { status: 400 }
        );
      }
      const user = userResult.rows[0];
      if (!user.twitter_handle || user.twitter_handle === '@undefined') {
        logger.error(
          `Twitter handle không hợp lệ cho người dùng: ${userId}, twitterHandle: ${user.twitter_handle}`
        );
        return NextResponse.json(
          { detail: 'Twitter handle không hợp lệ. Vui lòng kết nối lại tài khoản Twitter.' },
          { status: 400 }
        );
      }
      const twitterClient = new TwitterApi(user.twitter_access_token);

      if (taskType === 'follow' && link) {
        const targetHandle = link.startsWith('@') ? link.slice(1) : link;
        if (!targetHandle.match(/^[A-Za-z0-9_]{1,15}$/)) {
          logger.error(`Định dạng Twitter handle không hợp lệ: ${targetHandle}`);
          return NextResponse.json(
            { detail: `Định dạng Twitter handle không hợp lệ: ${targetHandle}` },
            { status: 400 }
          );
        }
        try {
          const { data: targetUser } = await twitterClient.v2.usersByUsernames([targetHandle]);
          if (!targetUser?.[0]?.id) {
            logger.error(`Không tìm thấy người dùng Twitter: ${targetHandle}`);
            return NextResponse.json(
              { detail: `Không tìm thấy người dùng Twitter @${targetHandle}` },
              { status: 400 }
            );
          }
          const userTwitter = await twitterClient.v2.usersByUsernames([
            user.twitter_handle.replace('@', ''),
          ]);
          const userTwitterId = userTwitter.data?.[0]?.id;
          if (!userTwitterId) {
            logger.error(`Người dùng Twitter không hợp lệ: ${user.twitter_handle}`);
            return NextResponse.json(
              { detail: 'Người dùng Twitter không hợp lệ' },
              { status: 400 }
            );
          }
          let allFollowers = [];
          let nextToken = null;
          try {
            do {
              const { data, meta } = await twitterClient.v2.followers(targetUser[0].id, {
                max_results: 100,
                pagination_token: nextToken,
              });
              allFollowers = allFollowers.concat(data || []);
              nextToken = meta.next_token;
            } while (nextToken);
            isCompleted = allFollowers.some((follower) => follower.id === userTwitterId);
            if (!isCompleted) {
              logger.info(`Người dùng ${userId} không theo dõi ${targetHandle}`);
              return NextResponse.json(
                { detail: `Bạn phải theo dõi @${targetHandle} để hoàn thành nhiệm vụ này.` },
                { status: 400 }
              );
            }
          } catch (error) {
            if (error.code === 429 || error.message.includes('Rate limit')) {
              logger.error(`Vượt quá giới hạn API Twitter cho endpoint followers: ${error.message}`);
              return NextResponse.json(
                { detail: 'Vượt quá giới hạn API Twitter. Vui lòng thử lại sau.' },
                { status: 429 }
              );
            }
            logger.error(`Lỗi API Twitter cho nhiệm vụ follow: ${error.message}`, {
              stack: error.stack,
            });
            return NextResponse.json(
              { detail: `Xác minh nhiệm vụ follow thất thất bại: ${error.message}` },
              { status: 400 }
            );
          }
        } catch (error) {
          if (error.code === 429 || error.message.includes('Rate limit')) {
            logger.error(
              `Vượt quá giới hạn API Twitter cho endpoint usersByUsernames: ${error.message}`
            );
            return NextResponse.json(
              { detail: 'Vượt quá giới hạn API Twitter. Vui lòng thử lại sau.' },
              { status: 429 }
            );
          }
          logger.error(`Lỗi khi lấy người dùng ${targetHandle}: ${error.message}`, {
            stack: error.stack,
          });
          return NextResponse.json(
            { detail: `Không tìm thấy người dùng Twitter @${targetHandle}` },
            { status: 400 }
          );
        }
      } else if (taskType === 'tweet' && link) {
        const userTwitter = await twitterClient.v2.usersByUsernames([
          user.twitter_handle.replace('@', ''),
        ]);
        const userTwitterId = userTwitter.data?.[0]?.id;
        if (!userTwitterId) {
          logger.error(`Người dùng Twitter không hợp lệ: ${user.twitter_handle}`);
          return NextResponse.json(
            { detail: 'Người dùng Twitter không hợp lệ' },
            { status: 400 }
          );
        }
        try {
          let allTweets = [];
          let nextToken = null;
          do {
            const { data, meta } = await twitterClient.v2.userTimeline(userTwitterId, {
              max_results: 100,
              pagination_token: nextToken,
            });
            allTweets = allTweets.concat(data || []);
            nextToken = meta.next_token;
          } while (nextToken && allTweets.length < 3200);
          isCompleted = allTweets.some((tweet) => tweet.text.includes(link));
          if (!isCompleted) {
            logger.info(`Người dùng ${userId} chưa tweet với ${link}`);
            return NextResponse.json(
              { detail: `Bạn phải tweet với ${link} để hoàn thành nhiệm vụ này.` },
              { status: 400 }
            );
          }
        } catch (error) {
          if (error.code === 429 || error.message.includes('Rate limit')) {
            logger.error(`Vượt quá giới hạn API Twitter cho endpoint userTimeline: ${error.message}`);
            return NextResponse.json(
              { detail: 'Vượt quá giới hạn API Twitter. Vui lòng thử lại sau.' },
              { status: 429 }
            );
          }
          logger.error(`Lỗi API Twitter cho nhiệm vụ tweet: ${error.message}`, {
            stack: error.stack,
          });
          return NextResponse.json(
            { detail: `Xác minh nhiệm vụ tweet thất bại: ${error.message}` },
            { status: 400 }
          );
        }
      } else if (taskType === 'like' && link) {
        const tweetId = link.match(/status\/(\d+)/)?.[1];
        if (!tweetId) {
          logger.error(`URL tweet không hợp lệ: ${link}`);
          return NextResponse.json({ detail: 'URL tweet không hợp lệ' }, { status: 400 });
        }
        try {
          let allLikers = [];
          let nextToken = null;
          do {
            const { data, meta } = await twitterClient.v2.tweetLikedBy(tweetId, {
              max_results: 100,
              pagination_token: nextToken,
            });
            allLikers = allLikers.concat(data || []);
            nextToken = meta.next_token;
          } while (nextToken);
          const userTwitter = await twitterClient.v2.usersByUsernames([
            user.twitter_handle.replace('@', ''),
          ]);
          const userTwitterId = userTwitter.data?.[0]?.id;
          if (!userTwitterId) {
            logger.error(`Người dùng Twitter không hợp lệ: ${user.twitter_handle}`);
            return NextResponse.json(
              { detail: 'Người dùng Twitter không hợp lệ' },
              { status: 400 }
            );
          }
          isCompleted = allLikers.some((liker) => liker.id === userTwitterId);
          if (!isCompleted) {
            logger.info(`Người dùng ${userId} chưa thích tweet ${tweetId}`);
            return NextResponse.json(
              { detail: `Bạn phải thích tweet để hoàn thành nhiệm vụ này.` },
              { status: 400 }
            );
          }
        } catch (error) {
          if (error.code === 429 || error.message.includes('Rate limit')) {
            logger.error(`Vượt quá giới hạn API Twitter cho endpoint tweetLikedBy: ${error.message}`);
            return NextResponse.json(
              { detail: 'Vượt quá giới hạn API Twitter. Vui lòng thử lại sau.' },
              { status: 429 }
            );
          }
          logger.error(`Lỗi API Twitter cho nhiệm vụ like: ${error.message}`, {
            stack: error.stack,
          });
          return NextResponse.json(
            { detail: `Xác minh nhiệm vụ like thất bại: ${error.message}` },
            { status: 400 }
          );
        }
      } else if (taskType === 'join' && link) {
        if (!user.discord_access_token) {
          logger.error(`Không có token Discord cho người dùng: ${userId}`);
          return NextResponse.json(
            { detail: 'Discord chưa được kết nối' },
            { status: 400 }
          );
        }
        const discordToken = user.discord_access_token;
        const guildId = link.match(/discord\.gg\/([a-zA-Z0-9]+)/)?.[1];
        if (!guildId) {
          logger.error(`Liên kết mời Discord không hợp lệ: ${link}`);
          return NextResponse.json(
            { detail: 'Liên kết mời Discord không hợp lệ' },
            { status: 400 }
          );
        }
        try {
          const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bearer ${discordToken}` },
          });
          if (!response.ok) {
            logger.error(`Lỗi API Discord: ${response.status}`);
            return NextResponse.json(
              { detail: 'Xác minh thành viên Discord thất bại' },
              { status: 400 }
            );
          }
          const guilds = await response.json();
          isCompleted = guilds.some((guild) => guild.id === guildId);
          if (!isCompleted) {
            logger.info(`Người dùng ${userId} chưa tham gia máy chủ Discord ${guildId}`);
            return NextResponse.json(
              { detail: 'Bạn phải tham gia máy chủ Discord để hoàn thành nhiệm vụ này.' },
              { status: 400 }
            );
          }
        } catch (error) {
          logger.error(`Lỗi API Discord: ${error.message}`, { stack: error.stack });
          return NextResponse.json(
            { detail: `Xác minh thành viên Discord thất bại: ${error.message}` },
            { status: 400 }
          );
        }
      } else {
        logger.error(`Loại nhiệm vụ không hợp lệ: ${taskType}`);
        return NextResponse.json(
          { detail: 'Loại nhiệm vụ không hợp lệ' },
          { status: 400 }
        );
      }
    }

    if (!isCompleted) {
      return NextResponse.json(
        { detail: 'Nhiệm vụ chưa được hoàn thành' },
        { status: 400 }
      );
    }

    completionCount = completionCount + 1;
    await query(
      `INSERT INTO task_completions (id, user_id, task_id, completed_at, completion_count)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
       SET completion_count = EXCLUDED.completion_count,
           completed_at = EXCLUDED.completed_at`,
      [completionId, userId, taskId, today, completionCount]
    );

    if (!task.is_daily || completionCount === task.max_completions) {
      await query(
        `UPDATE users
         SET task_points = task_points + $1,
             points = points + $1
         WHERE id = $2`,
        [task.points, userId]
      );
    }

    logger.info(`Nhiệm vụ ${taskId} đã được xác minh cho người dùng ${userId}, điểm: ${task.points}`);
    return NextResponse.json({
      success: true,
      message: 'Xác minh nhiệm vụ thành công',
      completionCount,
    });
  } catch (error) {
    logger.error(`Lỗi khi xác minh nhiệm vụ: ${error.message}`, { stack: error.stack });
    return NextResponse.json(
      { detail: `Xác minh nhiệm vụ thất bại: ${error.message}` },
      { status: 500 }
    );
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10kb',
    },
  },
};