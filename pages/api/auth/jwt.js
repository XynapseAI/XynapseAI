// pages/api/auth/jwt.js
import jwt from 'jsonwebtoken';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './[...nextauth]';
import { logger } from '../../../utils/logger';

export default async function handler(req, res) {
  logger.info('Bắt đầu xử lý yêu cầu /api/auth/jwt', { method: req.method });

  if (req.method !== 'GET') {
    logger.warn(`Phương thức không được phép: ${req.method}`);
    return res.status(405).json({ detail: 'Phương thức không được phép' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    logger.info('Kết quả getServerSession', { session: !!session, userId: session?.user?.id });

    if (!session || !session.user?.id) {
      logger.warn('Không xác thực được phiên hoặc thiếu user ID');
      return res.status(401).json({ detail: 'Chưa đăng nhập' });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error('Thiếu JWT_SECRET trong biến môi trường');
      throw new Error('Cấu hình server không đầy đủ');
    }

    const token = jwt.sign(
      {
        userId: session.user.id,
        twitterHandle: session.user.twitterHandle,
        exp: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour
      },
      jwtSecret
    );

    logger.info('Tạo JWT thành công', { userId: session.user.id });
    return res.status(200).json({ token });
  } catch (error) {
    logger.error(`Lỗi xử lý /api/auth/jwt: ${error.message}`, { stack: error.stack });
    return res.status(500).json({ detail: `Lỗi server: ${error.message}` });
  }
}