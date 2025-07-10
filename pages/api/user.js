import { query } from '../../utils/postgres.js';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth].js';
import { verifyRecaptcha } from '../../utils/verifyRecaptcha.js';
import rateLimit from 'express-rate-limit';
import { body, query as expressQuery, validationResult } from 'express-validator';
import winston from 'winston';
import helmet from 'helmet';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
    ],
});

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
    keyGenerator: (req) => {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
        return ip;
    },
    trustProxy: true,
});

const validatePost = [
    body('id').isString().isLength({ max: 100 }).withMessage('ID không hợp lệ'),
    body('twitterHandle').isString().isLength({ max: 15 }).withMessage('Tài khoản Twitter không hợp lệ'),
    body('twitterPFP').optional().isString().isURL().withMessage('URL ảnh đại diện không hợp lệ'),
];

const validateGet = [
    expressQuery('uid').isString().isLength({ max: 100 }).withMessage('UID không hợp lệ'),
];

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '5kb',
        },
    },
};

export default async function handler(req, res) {
    helmet()(req, res, () => {});
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
    logger.info(`Yêu cầu tới ${req.url} từ IP ${ip}, phương thức: ${req.method}, query: ${JSON.stringify(req.query)}`);

    try {
        await new Promise((resolve, reject) => {
            limiter(req, res, (err) => (err ? reject(err) : resolve()));
        });
    } catch (err) {
        logger.error(`Lỗi giới hạn yêu cầu: ${err.message}`);
        return res.status(429).json({ detail: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' });
    }

    const session = await getServerSession(req, res, authOptions);
    if (!session || !session.user?.id) {
        logger.warn('Phiên chưa được xác thực hoặc thiếu ID người dùng', { session });
        return res.status(401).json({ detail: 'Chưa đăng nhập' });
    }

    await Promise.all((req.method === 'POST' ? validatePost : validateGet).map((validation) => validation.run(req)));
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logger.warn(`Lỗi xác thực đầu vào: ${JSON.stringify(errors.array())}`);
        return res.status(400).json({ detail: 'Dữ liệu đầu vào không hợp lệ', errors: errors.array() });
    }

    try {
        if (req.method === 'GET') {
            const recaptchaToken = req.headers['x-recaptcha-token'];
            if (!recaptchaToken) {
                logger.error('Thiếu header X-Recaptcha-Token');
                return res.status(400).json({ detail: 'Thiếu token reCAPTCHA trong header' });
            }

            try {
                const { score } = await verifyRecaptcha(recaptchaToken, 'get_user', ip);
                logger.info('Xác minh reCAPTCHA thành công cho get_user', {
                    token: recaptchaToken.substring(0, 8) + '...',
                    score,
                });
            } catch (error) {
                logger.error(`Xác minh reCAPTCHA thất bại: ${error.message}`, {
                    stack: error.stack,
                    token: recaptchaToken.substring(0, 8) + '...',
                });
                return res.status(403).json({
                    detail: `Xác minh reCAPTCHA thất bại: ${error.message}`,
                    errorCodes: error.message.includes('timeout-or-duplicate') ? ['timeout-or-duplicate'] : [],
                });
            }

            const { uid } = req.query;
            logger.info(`Giá trị uid: ${uid}`); // Thêm log để kiểm tra uid
            if (!uid || uid !== session.user.id) {
                logger.warn(`Truy cập bị từ chối: uid=${uid}, sessionUserId=${session.user.id}`);
                return res.status(403).json({ detail: 'Truy cập bị từ chối: UID không hợp lệ' });
            }

            if (typeof uid !== 'string' || uid === 'uid') {
                logger.error('UID không hợp lệ hoặc bị thay thế', { uid });
                return res.status(400).json({ detail: 'UID không hợp lệ' });
            }

            const result = await query(`SELECT * FROM users WHERE id = $1`, [uid]);
            if (result.rows.length === 0) {
                logger.error(`Không tìm thấy người dùng: ${uid}`);
                return res.status(404).json({ detail: 'Không tìm thấy người dùng' });
            }

            const user = result.rows[0];
            logger.info(`Lấy dữ liệu người dùng: ${uid}`);
            return res.status(200).json({
                success: true,
                user: {
                    id: user.id,
                    twitterHandle: user.twitter_handle || '',
                    twitterPFP: user.twitter_pfp || '',
                    points: user.points || 0,
                    tweetPoints: user.tweet_points || 0,
                    aiPoints: user.ai_points || 0,
                    taskPoints: user.task_points || 0,
                    isCreator: user.is_creator || false,
                    isAiRank: user.is_ai_rank || false,
                    tier: user.tier || 'Basic',
                    walletAddress: user.wallet_address || null,
                    lastConnected: user.last_connected ? new Date(user.last_connected) : null,
                },
            });
        } else if (req.method === 'POST') {
            if (session.user.id !== req.body.id) {
                logger.warn(`Không được phép: uid=${req.body.id}, sessionUserId=${session.user.id}`);
                return res.status(401).json({ detail: 'Không được phép' });
            }

            const { id, twitterHandle, twitterPFP } = req.body;
            const userData = {
                twitter_handle: twitterHandle,
                twitter_pfp: twitterPFP,
                twitter_connected: true,
                last_connected: new Date(),
                points: 0,
                tweet_points: 0,
                ai_points: 0,
                task_points: 0,
                is_creator: false,
                is_ai_rank: false,
                tier: 'Basic',
                is_plus: false,
            };

            await query(
                `INSERT INTO users (
                    id, twitter_handle, twitter_pfp, twitter_connected, 
                    points, tweet_points, ai_points, task_points, 
                    is_creator, is_ai_rank, tier, is_plus, created_at, last_connected
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT (id) DO UPDATE SET
                    twitter_handle = EXCLUDED.twitter_handle,
                    twitter_pfp = EXCLUDED.twitter_pfp,
                    twitter_connected = EXCLUDED.twitter_connected,
                    last_connected = EXCLUDED.last_connected,
                    points = EXCLUDED.points,
                    tweet_points = EXCLUDED.tweet_points,
                    ai_points = EXCLUDED.ai_points,
                    task_points = EXCLUDED.task_points,
                    is_creator = EXCLUDED.is_creator,
                    is_ai_rank = EXCLUDED.is_ai_rank,
                    tier = EXCLUDED.tier,
                    is_plus = EXCLUDED.is_plus,
                    updated_at = CURRENT_TIMESTAMP`,
                [
                    id,
                    userData.twitter_handle,
                    userData.twitter_pfp,
                    userData.twitter_connected,
                    userData.points,
                    userData.tweet_points,
                    userData.ai_points,
                    userData.task_points,
                    userData.is_creator,
                    userData.is_ai_rank,
                    userData.tier,
                    userData.is_plus,
                    new Date(),
                    userData.last_connected,
                ]
            );

            const result = await query(`SELECT * FROM users WHERE id = $1`, [id]);
            const updatedUser = result.rows[0];
            logger.info(`Người dùng được tạo/cập nhật: ${id}`);
            return res.status(200).json({ success: true, user: { id, ...updatedUser } });
        } else {
            logger.warn(`Phương thức không được phép: ${req.method}`);
            return res.status(405).json({ detail: 'Phương thức không được phép' });
        }
    } catch (error) {
        logger.error(`Lỗi khi xử lý yêu cầu người dùng: ${error.message}`, {
            stack: error.stack,
            query: req.query,
            body: req.body,
        });
        return res.status(500).json({ detail: `Lỗi server: ${error.message}` });
    }
}