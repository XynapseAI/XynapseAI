'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { signIn, signOut, useSession, getProviders, getCsrfToken } from 'next-auth/react';
import Header from '../../components/Header';
import AITab from '../../components/AITab';
import ProfileTab from '../../components/ProfileTab';
import MarketTab from '../../components/MarketTab';
import TreemapTab from '../../components/TreemapTab';
import WatchlistsTab from '../../components/WatchlistsTab';
import ClusterTab from '../../components/ClusterTab';
import ReCAPTCHA from 'react-google-recaptcha';
import { toast, ToastContainer } from 'react-toastify';
import MatrixHoverEffect from '../../components/MatrixHoverEffect';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { gsap } from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { LoadingOverlay } from '@/utils/helpers';
import { CurrencyProvider } from '../../components/CurrencyContext';
import crypto from 'crypto'; // Giữ cho server-side, polyfill cho browser
import { Canvas, useFrame } from "@react-three/fiber";
import { Stars, Sphere, Float, Environment } from "@react-three/drei";
import * as THREE from "three";
import { TermsOfServiceContent } from '../../components/TermsOfService';
import { PrivacyPolicyContent } from '../../components/PrivacyPolicy';
import "@farcaster/auth-kit/styles.css";
import { AuthKitProvider, SignInButton } from "@farcaster/auth-kit";
import { sdk } from '@farcaster/miniapp-sdk';  // Giữ cho miniapp
import { useMiniApp, MiniAppProvider } from '@neynar/react';

gsap.registerPlugin(MotionPathPlugin);

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';

const isDev = process.env.NODE_ENV === 'development';
const safeConsole = {
  log: (...args) => isDev && console.log(...args),
  warn: (...args) => isDev && console.warn(...args),
  error: (...args) => isDev && console.error(...args),
};
const safeLog = (...args) => safeConsole.log(...args);
const safeWarn = (...args) => safeConsole.warn(...args);
const safeError = (...args) => safeConsole.error(...args);

// Polyfill HMAC cho browser (dùng Web Crypto API, vì old dùng createHmac - chỉ server)
async function hmacSha256(key, data) {
  if (typeof window !== 'undefined' && !crypto.subtle) {
    throw new Error('Crypto not supported');
  }
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const dataArray = encoder.encode(data);
  const importedKey = await window.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await window.crypto.subtle.sign('HMAC', importedKey, dataArray);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

const useUserData = (session, csrfToken, setIsAnalyzing) => {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const recaptchaRef = useRef(null);

  const fetchUserData = useCallback(async () => {
    // Enhanced check to prevent fetch when unauthenticated
    if (!session || !session?.user?.id || !csrfToken) {
      setLoading(false);
      setUserData(null);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      if (!recaptchaRef.current) {
        throw new Error('reCAPTCHA component is not initialized');
      }
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      if (!recaptchaToken) {
        throw new Error('Failed to obtain reCAPTCHA token');
      }
      const jwtToken = session?.accessToken;
      const response = await fetch(`${API_BASE_URL}/user?uid=${encodeURIComponent(session.user.id)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
          'X-CSRF-Token': csrfToken,
          Authorization: `Bearer ${jwtToken}`,
        },
        credentials: 'include',
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          setError('Session expired, please sign in again');
          return;
        }
        throw new Error(result.detail || 'Failed to fetch user data');
      }
      setUserData({
        ...result.user,
        profilePicture: result.user.profile_picture,
        googleName: result.user.google_name,
        tweetPoints: result.user.tweet_points,
        aiPoints: result.user.ai_points,
      });
      toast.success('User data loaded successfully!', { position: 'top-center' });
      setError(null);
    } catch (err) {
      safeError('Error fetching user data:', err);
      setError(`Failed to fetch user data: ${err.message}`);
      toast.error(`Error: ${err.message}`, { position: 'top-center' });
    } finally {
      setLoading(false);
      if (recaptchaRef.current) {
        recaptchaRef.current.reset();
      }
    }
  }, [session, csrfToken]);

  const handleAnalyzeTweets = useCallback(async () => {
    setIsAnalyzing(true);
    try {
      if (!session?.user || !csrfToken) throw new Error('Authentication or CSRF token missing');
      const recaptchaToken = process.env.NODE_ENV === 'development' ? 'development-token' : await recaptchaRef.current?.executeAsync();
      const jwtToken = session?.accessToken;
      const payload = { uid: session.user.id };
      // Sử dụng polyfill HMAC (tương thích browser/server)
      const sortedPayload = JSON.stringify(payload, Object.keys(payload).sort());
      const signature = await hmacSha256(process.env.HMAC_SECRET || "default-secret", sortedPayload);
      const response = await fetch(`${API_BASE_URL}/api/analyze-tweets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
          'X-CSRF-Token': csrfToken,
          Authorization: `Bearer ${jwtToken}`,
          'X-HMAC-Signature': signature,
        },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          setError('Session expired, please sign in again');
          return;
        }
        throw new Error(result.detail || 'Tweet analysis failed');
      }
      setUserData((prev) => (prev ? { ...prev, tweetPoints: result.tweet_points } : null));
      toast.success('Tweet analysis successful!', { position: 'top-center' });
    } catch (err) {
      safeError('Error analyzing tweet:', err);
      toast.error(`Tweet analysis error: ${err.message}`, { position: 'top-center' });
    } finally {
      setIsAnalyzing(false);
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  }, [session, csrfToken, setIsAnalyzing]);

  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  return { userData, loading, error, handleAnalyzeTweets, recaptchaRef };
};

function UniverseBackground() {
  const groupRef = useRef(null);

  useFrame((state) => {
    if (groupRef.current) {
      const time = state.clock.getElapsedTime();
      groupRef.current.rotation.z = time * 0.003; // Reduced speed for lighter performance
      groupRef.current.rotation.y = time * 0.001;
    }
  });

  // Simplified Galaxy with fewer points
  const Galaxy = () => {
    const pointsRef = useRef();
    const count = 2000; // Reduced count for performance
    const positions = useMemo(() => new Float32Array(count * 3), []);
    const colors = useMemo(() => new Float32Array(count * 3), []);

    useEffect(() => {
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const radius = (Math.random() * 30) + 3; // Smaller radius
        const arms = 3; // Fewer arms
        const spin = radius * 0.15;
        const branchAngle = ((i % arms) / arms) * Math.PI * 2;
        const theta = branchAngle + spin + Math.random() * 0.3;

        const randomX = (Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1)) * 1.5;
        const randomY = (Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1)) * 0.3; // Flatter
        const randomZ = (Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1)) * 1.5;

        positions[i3] = (Math.cos(theta) * radius) + randomX;
        positions[i3 + 1] = randomY;
        positions[i3 + 2] = (Math.sin(theta) * radius) + randomZ;

        const r = Math.random() * 0.3 + 0.7;
        const g = Math.random() * 0.3 + 0.7;
        const b = Math.random() * 0.5 + 0.5; // Subtle blue
        colors[i3] = r;
        colors[i3 + 1] = g;
        colors[i3 + 2] = b;
      }

      pointsRef.current.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      pointsRef.current.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }, []);

    return (
      <points ref={pointsRef} position={[0, 0, -20]} rotation={[Math.PI / 6, 0, 0]}>
        <bufferGeometry />
        <pointsMaterial
          size={0.05} // Smaller size
          sizeAttenuation
          vertexColors
          transparent
          opacity={0.6}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    );
  };

  return (
    <group ref={groupRef}>
      <Stars radius={150} depth={60} count={1000} factor={4} saturation={0} fade speed={0.1} /> {/* Reduced count and speed */}

      {/* Minimal moving stars */}
      <group>
        {Array.from({ length: 3 }).map((_, i) => (
          <Float key={i} speed={0.1} rotationIntensity={0.02}>
            <Sphere args={[0.01 + Math.random() * 0.005, 6, 6]} position={[(Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80]}>
              <meshStandardMaterial color="#FFFFFF" emissive="#FFFFFF" emissiveIntensity={0.3} transparent opacity={0.7} />
            </Sphere>
          </Float>
        ))}
      </group>

      <Galaxy />

      {/* Subtle nebulae */}
      {Array.from({ length: 2 }).map((_, i) => (
        <Float key={`nebula-${i}`} speed={0.1} rotationIntensity={0.02}>
          <Sphere args={[5 + Math.random() * 4, 12, 12]} position={[(Math.random() - 0.5) * 80, (Math.random() - 0.5) * 15, (Math.random() - 0.5) * 80]}>
            <meshStandardMaterial
              color={Math.random() > 0.5 ? "#4B0082" : "#8A2BE2"}
              transparent
              opacity={0.08 + Math.random() * 0.06}
              emissive={Math.random() > 0.5 ? "#4B0082" : "#8A2BE2"}
              emissiveIntensity={0.1 + Math.random() * 0.08}
              blending={THREE.AdditiveBlending}
            />
          </Sphere>
        </Float>
      ))}

      <Environment preset="night" />
      <ambientLight intensity={0.15} color="#000022" />
      <pointLight position={[0, 0, 8]} intensity={0.3} color="#FFFFFF" />
      <pointLight position={[-15, 0, -15]} intensity={0.2} color="#00BFFF" />
    </group>
  );
}

// NEW: Inner component để wrap bởi MiniAppProvider, chứa hook useMiniApp
function DashboardInner() {
  const { data: session, status, update } = useSession();
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [providers, setProviders] = useState(null);
  const [email, setEmail] = useState('');
  const [csrfToken, setCsrfToken] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [farcasterModalOpen, setFarcasterModalOpen] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false); // NEW: Fix loop - track auth success để hide form ngay
  const recaptchaRef = useRef(null);
  const { userData, loading, error } = useUserData(session, csrfToken, setIsAnalyzing);
  const miniApp = useMiniApp(); // FIXED: Hook này giờ nằm trong context của MiniAppProvider
  const [isMiniApp, setIsMiniApp] = useState(false);
  const [miniAppAuthLoading, setMiniAppAuthLoading] = useState(false); // NEW: Loading cho quickauth

  const openModal = (content) => {
    setModalContent(content);
    setIsModalOpen(true);
    document.body.style.overflow = 'hidden';
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalContent(null);
    document.body.style.overflow = 'auto';
  };

  const fetchProvidersWithRetry = useCallback(async (retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await getProviders();
        setProviders(response);
        return;
      } catch (err) {
        safeError(`Attempt ${i + 1} failed to fetch providers: ${err.message}`);
        if (err.message.includes("IP banned") || err.status === 429) {
          toast.error("Too many requests. Please try again later.", { position: 'top-center' });
          return;
        }
        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        toast.error('Failed to fetch sign-in methods.', { position: 'top-center' });
      }
    }
  }, []);

  useEffect(() => {
    setIsMounted(true);
    const tab = searchParams.get('tab');
    if (tab && ['market', 'ai', 'profile', 'graph', 'watchlists', 'cluster'].includes(tab)) {  // Đổi treemap -> graph
      setActiveTab(tab);
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (status !== 'authenticated' || session?.csrfToken || csrfToken) return;

    const fetchCsrfToken = async () => {
      try {
        const response = await fetch('/api/auth/csrf', {  // Fix: relative path chuẩn NextAuth
          method: 'GET',
          credentials: 'include',  // Fix: Để read/set cookie tự động
          // Bỏ Authorization: Bearer - NextAuth handle qua cookie
        });
        const result = await response.json();
        if (response.ok) {
          setCsrfToken(result.csrfToken);
          await update({ csrfToken: result.csrfToken });
        } else {
          throw new Error(result.detail || 'Failed to fetch CSRF token');
        }
      } catch (err) {
        safeError('Error fetching CSRF token:', err);
        // Fallback cho dev: Generate local token tạm
        if (process.env.NODE_ENV === 'development') {
          const fallbackToken = crypto.randomBytes(32).toString('hex');
          setCsrfToken(fallbackToken);
          await update({ csrfToken: fallbackToken });
          toast.warn('Using dev fallback CSRF token', { position: 'top-center' });
        } else {
          toast.error(`Failed to fetch CSRF token: ${err.message}`, { position: 'top-center' });
        }
      }
    };
    fetchCsrfToken();
  }, [status, session, csrfToken, update]);

  useEffect(() => {
    if (isMounted && !providers) {
      fetchProvidersWithRetry();
    }
  }, [isMounted, providers, fetchProvidersWithRetry]);

  // NEW: Detect Mini App (tích hợp quickauth)
  useEffect(() => {
    const initAndCheckEnvironment = async () => {
      // Detect via hostname hoặc Neynar hook
      const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
      const miniAppDetected = hostname.includes('farcaster.') || !!miniApp?.user;
      setIsMiniApp(miniAppDetected);

      if (miniAppDetected && sdk) {
        try {
          await sdk.actions.ready();  // Ẩn splash, show UI
          safeLog('Mini App ready! User FID:', miniApp?.user?.fid);
          // Auto-sign-in nếu chưa session (quickauth)
          if (!session && miniApp?.user) {
            handleMiniAppQuickAuth();
          }
        } catch (err) {
          safeError('Mini App init error:', err);
        }
      }
    };
    initAndCheckEnvironment();
  }, [miniApp, session]);

  // NEW: Handle quickauth cho miniapp (tích hợp vào old flow)
  const handleMiniAppQuickAuth = async () => {
    if (status !== 'unauthenticated') return;
    setMiniAppAuthLoading(true);
    try {
      const { token } = await sdk.quickAuth.getToken();
      if (!token) throw new Error('No token from SDK');

      safeLog('Mini App quickauth token preview:', token.substring(0, 50) + '...');

      const result = await signIn('farcaster', { 
        redirect: false, 
        token,  // Pass token cho Credentials (cần update options.js để handle token)
        callbackUrl: '/dashboard'
      });
      if (result?.error) {
        throw new Error(result.error || 'Auth failed');
      }
      toast.success('Signed in with Farcaster via QuickAuth!');
      setAuthSuccess(true); // NEW: Fix loop
      router.push('/dashboard', { shallow: true, scroll: false }); // Shallow để avoid query param
      await update();
    } catch (err) {
      safeError('Mini App quickauth fail:', err);
      toast.error(`QuickAuth error: ${err.message}`);
    } finally {
      setMiniAppAuthLoading(false);
    }
  };

  const handleConnectWallet = async () => {
    try {
      if (!session?.user || !isConnected || !address || !recaptchaRef.current) throw new Error('Prerequisites not met');
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      const message = `Sign this message to authenticate: ${address}`;
      const signature = await signMessageAsync({ message });
      const jwtToken = session?.accessToken;
      const payload = { walletAddress: address, signature, message, uid: session.user.id };
      // Sử dụng polyfill HMAC (tương thích browser)
      const sortedPayload = JSON.stringify(payload, Object.keys(payload).sort());
      const hmacSignature = await hmacSha256(process.env.HMAC_SECRET || "default-secret", sortedPayload);
      const response = await fetch(`${API_BASE_URL}/api/verify-wallet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
          'X-CSRF-Token': csrfToken,
          Authorization: `Bearer ${jwtToken}`,
          'X-HMAC-Signature': hmacSignature,
        },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Wallet verification failed');
      toast.success('Wallet connected successfully!', { position: 'top-center' });
    } catch (err) {
      safeError('Error verifying wallet:', err);
      toast.error(`Wallet verification error: ${err.message}`, { position: 'top-center' });
    } finally {
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  const handleSignOut = async () => {
    if (!session || !session.user?.id) {
      toast.error('Session expired. Please sign in again.', { position: 'top-center' });
      router.push('/dashboard');
      return;
    }

    try {
      let currentCsrfToken = csrfToken;
      if (!currentCsrfToken) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/auth/csrf`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.accessToken || ''}`,
            },
            credentials: 'include',
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.detail || 'Failed to fetch CSRF token');
          currentCsrfToken = result.csrfToken;
          setCsrfToken(result.csrfToken);
          await update({ csrfToken: result.csrfToken });
        } catch (csrfError) {
          safeError('Failed to fetch CSRF token:', csrfError);
          throw new Error('Cannot sign out: Missing CSRF token');
        }
      }

      try {
        await signOut({ redirect: false });
        await update();
      } catch (signOutError) {
        safeError('signOut fetch error:', signOutError);
        if (signOutError.message.includes('ClientFetchError')) {
          const response = await fetch('/api/auth/signout', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': currentCsrfToken,
            },
            credentials: 'include',
            body: JSON.stringify({}),
          });
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Manual signout failed');
          }
          await update();
        } else {
          throw signOutError;
        }
      }

      try {
        const token = await recaptchaRef.current?.executeAsync();
        const response = await fetch(`${API_BASE_URL}/api/clear-cache`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': currentCsrfToken,
            'X-Recaptcha-Token': token,
          },
          body: JSON.stringify({ cacheKeys: [`user:${session.user.id}`] }),
          credentials: 'include',
        });
        if (!response.ok) {
          safeWarn('Failed to clear server-side cache:', response.statusText);
        }
      } catch (cacheErr) {
        safeWarn('Failed to clear server-side cache:', cacheErr.message);
      }

      localStorage.removeItem('csrfToken');
      setCsrfToken(null);
      setAuthSuccess(false); // NEW: Reset auth success on signout
      if (isConnected) {
        disconnect();
      }

      toast.success('Signed out successfully!', { position: 'top-center' });
      router.refresh();
      router.push('/dashboard');
    } catch (error) {
      safeError('Error during sign out process:', error);
      toast.error(`Failed to sign out: ${error.message}`, { position: 'top-center' });
      router.refresh();
      router.push('/dashboard');
    } finally {
      if (recaptchaRef.current) {
        recaptchaRef.current.reset();
      }
    }
  };

  // FIXED: Merge old handleFarcasterSuccess với new (thêm authSuccess + shallow push)
  const handleFarcasterSuccess = async (result) => {
    try {
      const csrf = await getCsrfToken();  // Fetch CSRF token
      if (!csrf) throw new Error('CSRF token unavailable');

      const res = await signIn('farcaster', {
        message: result.message,
        signature: result.signature,
        // Pass CSRF explicit cho Credentials POST
        csrfToken: csrf,
      }, {
        redirect: false,
        // Ensure cookies forwarded
      });
      if (res?.error) {
        toast.error(`Farcaster login failed: ${res.error}`);
      } else {
        setAuthSuccess(true); // NEW: Fix loop - hide form ngay
        router.push('/dashboard', { shallow: true, scroll: false }); // NEW: Shallow để avoid query param loop
        await update();
        toast.success('Signed in with Farcaster successfully!');
        setFarcasterModalOpen(false);
        router.refresh();
      }
    } catch (err) {
      safeError('Farcaster sign-in error:', err);
      toast.error(`Sign-in error: ${err.message}`);
    }
  };

  const handleNavigateToToken = useCallback((slug) => {
    if (!slug) {
      toast.error('Invalid token ID.', { position: 'top-center' });
      return;
    }
    router.push(`/dashboard?tab=market&token=${slug}`, { scroll: false });
    setActiveTab('market');
  }, [router]);

  const handleEmailSignIn = async (e) => {
    e.preventDefault();
    try {
      await signIn('email', { email, callbackUrl: '/dashboard', redirect: false });
      toast.success('Sign-in email sent, please check your inbox!', { position: 'top-center' });
    } catch (err) {
      safeError('Error signing in with email:', err);
      toast.error('Failed to sign in with email.', { position: 'top-center' });
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const result = await signIn('google', { callbackUrl: '/dashboard', redirect: false });
      if (result?.error) {
        if (result.error.includes('Rate limit exceeded')) {
          toast.error('Too many sign-in attempts. Please try again later.', { position: 'top-center' });
          return;
        }
        // Custom error handling for email-registered account
        if (result.error.includes('This account is registered with email')) {
          toast.error(result.error, { position: 'top-center' });
          return;
        }
        throw new Error(result.error);
      }
      if (!result?.url) {
        safeWarn('No redirect URL provided by NextAuth, falling back to manual redirect');
        window.location.href = `${API_BASE_URL}/api/auth/signin/google`;
        return;
      }
      window.location.href = result.url;
    } catch (err) {
      safeError('Error signing in with Google:', err);
      toast.error(`Failed to sign in with Google: ${err.message}`, { position: 'top-center' });
    }
  };

  // FIXED: Loading state: Thêm authSuccess để hide form ngay sau signIn
  if (!isMounted || !providers || status === 'loading' || miniAppAuthLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
        <LoadingOverlay
          isLoading={true}
          message={isMiniApp ? "Authenticating with Farcaster..." : "Loading dashboard..."}
          isMobile={typeof window !== 'undefined' && window.innerWidth <= 640}
        />
      </div>
    );
  }

  const requiresAuth = ['profile', 'ai', 'watchlists'].includes(activeTab);
  const showLoginForm = status === 'unauthenticated' && requiresAuth && !authSuccess; // NEW: + !authSuccess để fix loop

  return (
    <CurrencyProvider>
      <AuthKitProvider
        config={{
          domain: window.location.hostname, // e.g., localhost
          siweUri: `${window.location.origin}/api/auth/signin/farcaster`, // Callback cho NextAuth
          relay: 'https://relay.farcaster.xyz', // Default relay
          rpcUrl: 'https://mainnet.optimism.io', // Base RPC
          version: 'v1',
        }}
      >
        <div className="h-screen w-screen bg-gradient-to-br from-black to-gray-900 backdrop-blur-xs text-white overflow-x-hidden flex flex-col">
          <Header
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            handleSignOut={handleSignOut}
            selectedAddress={searchParams.get('address') || undefined}
          />
          <main className="flex-1 flex items-center justify-center overflow-hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="w-full h-full flex items-center justify-center"
            >
              {showLoginForm ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="w-full h-full p-4 md:p-0 flex items-center justify-center text-white font-saira relative"
                >
                  <div className="fixed inset-0 z-0">
                    {!isMiniApp && (  // Mới: Chỉ render 3D nếu không phải Mini App (lightweight)
                      <Canvas camera={{ position: [0, 0, 5], fov: 75 }} dpr={[1, 1.5]} performance={{ min: 0.3 }}>
                        <UniverseBackground />
                      </Canvas>
                    )}
                  </div>
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    className="relative z-20 bg-black/60 backdrop-blur-xs p-6 md:p-10 border border-white/15 rounded-lg max-w-sm w-full mx-4 flex flex-col items-center shadow-2xl shadow-black/50"
                  >
                    <motion.h1
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.2 }}
                      className="text-xl md:text-3xl font-bold text-white uppercase mb-3 text-center tracking-wide"
                    >
                      Sign In
                    </motion.h1>
                    <motion.p
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.3 }}
                      className="text-[11px] md:text-xs text-gray-500 mb-6 text-center leading-relaxed"
                    >
                      Access your dashboard with secure authentication.
                    </motion.p>
                    <form onSubmit={handleEmailSignIn} className="w-full space-y-4">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter your email"
                        className="w-full px-4 py-2.5 bg-black/60 border border-white/15 rounded-2xl text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all duration-300"
                        required
                      />
                      <button
                        type="submit"
                        className="w-full px-4 py-2.5 border-2 border-white/15 bg-white/10 text-white rounded-2xl text-sm font-semibold transition-all duration-300 hover:border-white/30 hover:bg-white/20 flex items-center justify-center"
                      >
                        <MatrixHoverEffect text="Sign in with Email" hoverColor="#FFFFFF" />
                      </button>
                    </form>
                    <div className="flex items-center justify-center my-4 w-full">
                      <span className="text-gray-500 text-xs uppercase px-4">OR</span>
                      <div className="flex-1 h-px bg-white/10"></div>
                    </div>
                    {providers?.google && !isMiniApp && (
                      <button
                        onClick={handleGoogleSignIn}
                        className="w-full px-4 py-2.5 bg-black/20 border border-white/25 rounded-2xl text-white text-sm font-semibold flex items-center justify-center gap-3 transition-all duration-300 hover:bg-gray-800/30 hover:border-white/40"
                      >
                        <Image src="/logos/google.webp" alt="Google Logo" width={20} height={20} className="w-5 h-5 object-contain" />
                        <MatrixHoverEffect text="Sign in with Google" />
                      </button>
                    )}
                    <button onClick={() => setFarcasterModalOpen(true)} // Mở modal thay vì signIn trực tiếp
                      className="w-full px-4 m-2 py-2.5 bg-black/20 border border-white/25 rounded-2xl text-white text-sm font-semibold flex items-center justify-center gap-3 transition-all duration-300 hover:bg-gray-800/30 hover:border-white/40"
                    >
                      <Image
                        src="/logos/farcaster-logo.webp"
                        alt="Farcaster Logo"
                        width={20}
                        height={20}
                        className="w-6 h-6 rounded-xl object-contain"
                      />
                      <MatrixHoverEffect text="Sign in with Farcaster" />
                    </button>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.4 }}
                        className="mt-4 text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-center"
                      >
                        Error: {error}
                      </motion.div>
                    )}
                    <motion.p
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.5 }}
                      className="mt-4 text-[11px] text-gray-500 text-center leading-relaxed"
                    >
                      By clicking continue, you agree to our{' '}
                      <button onClick={() => openModal('terms')} className="text-white hover:underline">
                        Terms of Service
                      </button>{' '}
                      và{' '}
                      <button onClick={() => openModal('privacy')} className="text-white hover:underline">
                        Privacy Policy
                      </button>.
                    </motion.p>
                  </motion.div>
                </motion.div>
              ) : (
                <>
                  {activeTab === 'market' && (
                    <MarketTab
                      recaptchaRef={recaptchaRef}
                      toast={toast}
                      onTokenSelect={handleNavigateToToken}
                      initialTokenSlug={searchParams.get('token') || undefined}
                    />
                  )}
                  {activeTab === 'cluster' && (
                    <ClusterTab
                      recaptchaRef={recaptchaRef}
                      initialClusterId={searchParams.get('clusterId') || 'binance'}  // Sửa từ initialExchangeId
                    />
                  )}
                  {activeTab === 'graph' && <TreemapTab onTokenSelect={handleNavigateToToken} />}
                  {activeTab === 'ai' && <AITab recaptchaRef={recaptchaRef} />}
                  {activeTab === 'profile' && (
                    <ProfileTab
                      userData={userData}
                      loading={loading}
                      error={error}
                      isConnected={isConnected}
                      handleConnectWallet={handleConnectWallet}
                      recaptchaRef={recaptchaRef}
                      handleSignOut={handleSignOut}
                    />
                  )}
                  {activeTab === 'watchlists' && <WatchlistsTab toast={toast} initialAddress={searchParams.get('address') || undefined} />}
                </>
              )}
            </motion.div>
          </main>
          {process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ? (
            <ReCAPTCHA
              ref={recaptchaRef}
              sitekey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
              size="invisible"
              badge="bottomright"
              onError={() => {
                safeError('reCAPTCHA initialization failed');
                toast.error('Failed to initialize reCAPTCHA', { position: 'top-center' });
              }}
            />
          ) : (
            <p className="text-[8px] text-red-600 ml-2">
              Error: reCAPTCHA site key is missing. Please configure NEXT_PUBLIC_RECAPTCHA_SITE_KEY.
            </p>
          )}
          <p className="text-[8px] text-gray-600 ml-2">
            Protected by reCAPTCHA. See{' '}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-neon-blue">
              Privacy Policy
            </a>{' '}
            &{' '}
            <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="text-neon-blue">
              Terms
            </a>{' '}
            of Google.
          </p>
          <ToastContainer position="top-center" autoClose={3000} hideProgressBar closeOnClick pauseOnHover />
          {/* Modal for Terms and Privacy */}
          {isModalOpen && (
            <div
              className="fixed inset-0 bg-black/75 flex items-center justify-center z-50"
              onClick={closeModal}
            >
              <div
                className="bg-gray-900/50 backdrop-blur-lg border border-white/20 rounded-2xl w-full max-w-7xl h-[90vh] relative flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="sticky top-0 z-10 backdrop-blur-lg border-b border-white/20 p-6 flex justify-between items-center">
                  <h1 className="text-2xl sm:text-3xl font-bold text-white uppercase">
                    {modalContent === 'privacy'
                      ? 'Xynapse Privacy Policy'
                      : 'Xynapse Terms of Service'}
                    <span className="block text-sm sm:text-base text-gray-300 mt-1">
                      Effective Date: June 21, 2025
                    </span>
                  </h1>
                  <button
                    onClick={closeModal}
                    aria-label="Close modal"
                    className="text-white text-xl font-bold hover:text-neon-blue transition-all duration-300"
                  >
                    ✕
                  </button>
                </div>
                <div className="text-xs sm:text-sm flex-1 overflow-y-auto custom-scrollbar p-6 prose prose-invert max-w-none">
                  {modalContent === 'privacy' ? <PrivacyPolicyContent /> : <TermsOfServiceContent />}
                </div>
              </div>
            </div>
          )}
          {farcasterModalOpen && (
            <div
              className="fixed inset-0 bg-black/75 flex items-center justify-center z-50"
              onClick={() => setFarcasterModalOpen(false)}
            >
              <div
                className="bg-gray-900/50 backdrop-blur-lg border border-white/20 rounded-2xl w-full max-w-md h-[60vh] relative flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="sticky top-0 z-10 backdrop-blur-lg border-b border-white/20 p-4 flex justify-between items-center">
                  <h2 className="text-xl font-bold text-white uppercase">Sign In with Farcaster</h2>
                  <button
                    onClick={() => setFarcasterModalOpen(false)}
                    className="text-white text-xl font-bold hover:text-neon-blue transition-all duration-300"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center p-4 overflow-auto">
                  <p className="text-gray-500 text-sm mb-4 text-center">Scan the QR code with your Warpcast app to sign in.</p>
                  <SignInButton // Sử dụng SignInButton thay vì AuthKitButton
                    onSuccess={handleFarcasterSuccess}
                    onError={(error) => {
                      safeError('AuthKit error:', error);
                      toast.error(`Farcaster error: ${error.message}`);
                      setFarcasterModalOpen(false);
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </AuthKitProvider>
    </CurrencyProvider>
  );
}

export default function Dashboard() {
  return (
    <MiniAppProvider>
      <DashboardInner />
    </MiniAppProvider>
  );
}