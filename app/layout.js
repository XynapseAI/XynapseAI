// app/layout.js
import { Inter, JetBrains_Mono } from 'next/font/google';
import '../styles/globals.css';
import ClientProviders from './ClientProviders';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-inter',
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-jetbrains-mono',
});

export const metadata = {
  title: {
    default: 'Xynapse',
    template: '%s | Xynapse',
  },
  description: 'Explore the ultimate AI-powered crypto market analytics platform.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
      <body className={`bg-black text-white ${inter.variable} ${jetBrainsMono.variable}`}>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}