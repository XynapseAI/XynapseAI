'use client';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react'; // Import Suspense
import { sdk } from '@farcaster/miniapp-sdk';
import { toast } from 'react-toastify'; // Nếu dùng, import toast

// Sub-component để wrap useSearchParams (optional, nhưng clean)
function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams(); // Giờ safe trong Suspense
  const [loading, setLoading] = useState(false);
  const error = searchParams.get('error');
  const provider = searchParams.get('provider');

  useEffect(() => {
    if (error) {
      const errorMsg = error === 'undefined' ? 'Verification failed. Check domain.' : error;
      toast.error(`Auth error: ${errorMsg}`);
    }
  }, [error]);

  const handleFarcasterSignIn = async () => {
    if (typeof window === 'undefined') return; // Server safety
    setLoading(true);
    try {
      const inMini = await sdk.isInMiniApp();
      if (inMini) {
        const { token } = await sdk.quickAuth.getToken();
        console.log('Token preview:', token?.substring(0, 50) + '...');
        if (!token) throw new Error('No token from SDK');
        const decoded = JSON.parse(atob(token.split('.')[1]));
        console.log('Decoded aud:', decoded.aud); // Debug
        const res = await signIn('farcaster', { 
          token, 
          redirect: false, 
          callbackUrl: '/dashboard' 
        });
        if (res?.error) {
          console.error('SignIn error:', res.error);
          toast.error(`Sign-in failed: ${res.error}`);
          return;
        }
        router.push('/dashboard');
      } else {
        toast.error('Not in Mini App. Use Base/Google.');
      }
    } catch (err) {
      console.error('SDK error:', err);
      toast.error(`SDK error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-black text-white">
      <div className="p-8 border rounded-lg text-center max-w-md w-full">
        <h1 className="text-2xl font-bold mb-4">Sign In to Xynapse</h1>
        {error && (
          <p className="text-red-500 mb-4 bg-red-500/10 p-2 rounded">
            Error: {errorMsg || error || 'Unknown error. Try again.'}
          </p>
        )}
        {provider && <p>Provider: {provider}</p>}
        <button 
          onClick={handleFarcasterSignIn} 
          disabled={loading}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign in with Farcaster'}
        </button>
        {/* Thêm buttons cho Google/Base nếu cần */}
        <p className="text-sm text-gray-400 mt-4">
          Or use <button onClick={() => signIn('google')}>Google</button> / <button onClick={() => signIn('credentials')}>Base</button>
        </p>
      </div>
    </div>
  );
}

// Main page export: Wrap trong Suspense
export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-black text-white">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        <span className="ml-2">Loading sign in...</span>
      </div>
    }>
      <SignInContent />
    </Suspense>
  );
}