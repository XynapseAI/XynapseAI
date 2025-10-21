// app/layout.js
import '../styles/globals.css';
import ClientProviders from './ClientProviders';

export const metadata = {
  title: {
    default: 'Xynapse',
    template: '%s | Xynapse',
  },
  description: 'Explore the ultimate AI-powered crypto market analytics platform.',
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
  if (hasCircularReference(children)) {
    console.error('Circular reference detected in children:', children);
    throw new Error('Circular reference in layout');
  }

  return (
    <html lang="en">
      <head>
        <meta name="fc:frame" content='{"version":"next","imageUrl":"https://farcaster.xynapseai.net/og-image.png","button":{"title":"Launch Xynapse","action":{"type":"launch_miniapp","name":"Xynapse Dashboard","url":"https://farcaster.xynapseai.net/dashboard"}}}' />
      </head>
      <body className={`bg-black text-white`}>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}