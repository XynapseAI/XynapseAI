// pages/api/csrf-token.js
import { getCsrfToken } from 'next-auth/react';
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import { logger } from '../../utils/logger';

export default async function handler(req, res) {
  logger.info('Bắt đầu xử lý yêu cầu /api/csrf-token', { method: req.method });

  if (req.method !== 'GET') {
    logger.warn(`Phương thức không được phép: ${req.method}`);
    return res.status(405).json({ detail: 'Phương thức không được phép' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    logger.info('Kết quả getServerSession', { session: !!session, userId: session?.user?.id });

    if (!session) {
      logger.warn('Không xác thực được phiên');
      return res.status(401).json({ detail: 'Chưa đăng nhập' });
    }

    const csrfToken = await getCsrfToken({ req });
    if (!csrfToken) {
      logger.error('Không thể tạo CSRF token');
      return res.status(500).json({ detail: 'Lỗi tạo CSRF token' });
    }

    logger.info('Tạo CSRF token thành công', { csrfToken: csrfToken.substring(0, 8) + '...' });
    return res.status(200).json({ csrfToken });
  } catch (error) {
    logger.error(`Lỗi xử lý /api/csrf-token: ${error.message}`, { stack: error.stack });
    return res.status(500).json({ detail: `Lỗi server: ${error.message}` });
  }
}