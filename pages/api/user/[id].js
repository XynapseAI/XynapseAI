// pages/api/user/[id].js
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

const prisma = new PrismaClient();

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ detail: 'Phương thức không được phép' });
  }

  const session = await getServerSession(req, res, authOptions);
  console.log('Session in /api/user/[id]:', session);
  console.log('Requested ID:', req.query.id);

  if (!session || session.user.id !== req.query.id) {
    return res.status(401).json({ detail: 'Chưa đăng nhập hoặc không có quyền' });
  }

  try {
    const user = await prisma.player.findUnique({ where: { id: req.query.id } });
    if (!user) {
      console.log('User not found for ID:', req.query.id);
      return res.status(404).json({ detail: 'Không tìm thấy người dùng' });
    }
    return res.status(200).json({ success: true, user });
  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({ detail: `Không thể lấy dữ liệu người dùng: ${error.message}` });
  } finally {
    await prisma.$disconnect();
  }
}