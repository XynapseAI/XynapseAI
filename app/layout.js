// app/layout.js
import '../styles/globals.css';
import ClientProviders from './ClientProviders';

export const metadata = {
  title: {
    default: 'Xynapse',
    template: '%s | Xynapse',
  },
  description: 'Explore the ultimate AI-powered crypto market analytics platform.',
  other: {
    'fc:miniapp': JSON.stringify({
      version: 'next',
      imageUrl: 'https://xynapseai.net/og.png',
      button: {
        title: 'Launch Xynapse',
        action: {
          type: 'launch_miniapp',
          name: 'Xynapse Mini App',
          url: 'https://xynapseai.net/dashboard',
          splashImageUrl: 'https://xynapseai.net/splash.png',
          splashBackgroundColor: '#000000',
        },
      },
    }),
  },
};

function hasCircularReference(obj, seen = new WeakSet()) {
  if (typeof obj !== 'object' || obj === null) return false;
  if (seen.has(obj)) return true;
  seen.add(obj);
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null && hasCircularReference(value, seen)) {
      return true;
    }
  }
  return false;
}

export default function RootLayout({ children }) {
  // Kiểm tra children hoặc dữ liệu khác nếu cần
  if (hasCircularReference(children)) {
    console.error('Circular reference detected in children:', children);
    throw new Error('Circular reference in layout');
  }

  return (
    <html lang="en">
      <body className={`bg-black text-white`}>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}