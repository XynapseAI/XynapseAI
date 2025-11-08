// app/auth/error/page.js
import { Suspense } from 'react';
import AuthErrorClient from './AuthErrorClient';  // Client Component

export default function AuthError() {
  return (
    <div className="h-screen flex items-center justify-center bg-black text-white">
      <Suspense fallback={<div className="text-center"><p>Loading error details...</p></div>}>
        <AuthErrorClient />
      </Suspense>
    </div>
  );
}