// app/dashboard/layout.js
import { auth } from '../api/auth/[...nextauth]/route';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  try {
    const session = await auth(); // Use auth() instead of getServerSession()
    return {
      title: session?.user ? `${session.user.name}'s Dashboard` : 'Dashboard',
      description: 'Manage wallet, points, and interactions',
    };
  } catch (error) {
    console.error('Error fetching session for metadata:', error);
    return {
      title: 'Dashboard',
      description: 'Manage wallet, points, and interactions',
    };
  }
}

export function generateViewport() {
  return {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  };
}

export default function DashboardLayout({ children }) {
  return <div>{children}</div>;
}