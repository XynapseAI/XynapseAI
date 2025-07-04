import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

const prisma = new PrismaClient();

export default async function handler(req, res) {
  // Apply security headers
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://ipfs.io https://pbs.twimg.com; connect-src 'self' https://api.geckoterminal.com;",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });

  if (req.method !== 'GET') {
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  const authOptionsInstance = await authOptions();
  const session = await getServerSession(req, res, authOptionsInstance);
  console.log('Session in /api/user/[id]:', session);
  console.log('Requested ID:', req.query.id);

  if (!session || session.user.id !== req.query.id) {
    return res.status(401).json({ detail: 'Not authenticated or unauthorized' });
  }

  try {
    const user = await prisma.player.findUnique({ where: { id: req.query.id } });
    if (!user) {
      console.log('User not found for ID:', req.query.id);
      return res.status(404).json({ detail: 'User not found' });
    }
    return res.status(200).json({ success: true, user });
  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({ detail: `Failed to fetch user: ${error.message}` });
  } finally {
    await prisma.$disconnect();
  }
}