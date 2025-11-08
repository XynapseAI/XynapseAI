// app\dashboard\page.js
'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAccount, useDisconnect, useSignMessage, useChainId, useSwitchChain, useConnect } from 'wagmi';
import { signIn, signOut, useSession, getProviders } from 'next-auth/react';
import { sdk } from '@farcaster/miniapp-sdk';
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
import { Canvas, useFrame } from "@react-three/fiber";
import { Stars, Sphere, Float, Environment } from "@react-three/drei";
import * as THREE from "three";
import { TermsOfServiceContent } from '../../components/TermsOfService';
import { PrivacyPolicyContent } from '../../components/PrivacyPolicy';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { SiweMessage } from 'siwe'; // NEW: Client-side parser for basic check (optional, npm install siwe)
gsap.registerPlugin(MotionPathPlugin);

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BASE_CHAIN_ID = 8453; // Base mainnet
const isDev = process.env.NODE_ENV === 'development';
const safeConsole = {
  log: (...args) => isDev && console.log(...args),
  warn: (...args) => isDev && console.warn(...args),
  error: (...args) => isDev && console.error(...args),
};
const safeLog = (...args) => safeConsole.log(...args);
const safeWarn = (...args) => safeConsole.warn(...args);
const safeError = (...args) => safeConsole.error(...args);

// Polyfill HMAC cho browser (dùng Web Crypto API)
async function hmacSha256(key, data) {
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

// NEW: Retry function cho ready() (để handle mobile delay/error)
const callReadyWithRetry = async (retries = 3, delay = 500) => {
  for (let i = 0; i < retries; i++) {
    try {
      await sdk.actions.ready();
      safeLog('Splash screen hidden successfully (attempt ' + (i + 1) + ')');
      return true;
    } catch (err) {
      safeError('Ready() failed (attempt ' + (i + 1) + '):', err);
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  safeWarn('All ready() attempts failed – splash may stay visible');
  return false;
};

const useUserData = (session, csrfToken, setIsAnalyzing) => {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const recaptchaRef = useRef(null);
  const fetchUserData = useCallback(async () => {
    if (!session || !session?.user?.id || !csrfToken) {
      setLoading(false);
      setUserData(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      if (!recaptchaRef.current) {
        throw new Error('reCAPTCHA component is not missing');
      }
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      if (!recaptchaToken) {
        throw new Error('Failed to obtain reCAPTCHA token');
      }
      const jwtToken = session?.accessToken;
      logger.info('Fetching user data with CSRF', { csrfLength: csrfToken.length });  // FIXED: Debug CSRF length from client
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
        if (response.status === 401 || response.status === 404) {
          // FIXED: Nếu 401/404 sau auth, force re-update session
          toast.warn('Session sync issue, refreshing...');
          await update();
          router.refresh();
          return;
        }
        throw new Error(result.detail || 'Failed to fetch user data');
      }
      setUserData({
        ...result.user,
        profilePicture: result.user.profile_picture,
        googleName: result.user.google_name,
        walletAddress: result.user.wallet_address, // Thêm wallet từ API response
        tweetPoints: result.user.tweet_points,
        aiPoints: result.user.ai_points,
      });
      toast.success('User data loaded successfully!', { position: 'top-center' });
      setError(null);
    } catch (err) {
      safeError('Error fetching user data:', err);
      setError(`Failed to fetch user data: ${err.message}`);
      toast.error(`Error: ${err.message}`, { position: 'top-center' });
      if (err.message.includes('401') || err.message.includes('404')) {
        toast.error('Auth session expired. Reloading...', { position: 'top-center' });
        router.refresh();
      }
    } finally {
      setLoading(false);
      if (recaptchaRef.current) {
        recaptchaRef.current.reset();
      }
    }
  }, [session, csrfToken, update, router]);

  const handleAnalyzeTweets = useCallback(async () => {
    setIsAnalyzing(true);
    try {
      if (!session?.user || !csrfToken) throw new Error('Authentication or CSRF token missing');
      const recaptchaToken = process.env.NODE_ENV === 'development' ? 'development-token' : await recaptchaRef.current?.executeAsync();
      const jwtToken = session?.accessToken;
      const payload = { uid: session.user.id };
      // Sử dụng polyfill HMAC thay crypto.createHmac
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
      setUserData((prev) => (prev ? { ...prev, tweet_points: result.tweet_points } : null));
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
      groupRef.current.rotation.z = time * 0.003;
      groupRef.current.rotation.y = time * 0.001;
    }
  });
  const Galaxy = () => {
    const pointsRef = useRef();
    const count = 2000;
    const positions = useMemo(() => new Float32Array(count * 3), []);
    const colors = useMemo(() => new Float32Array(count * 3), []);
    useEffect(() => {
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const radius = (Math.random() * 30) + 3;
        const arms = 3;
        const spin = radius * 0.15;
        const branchAngle = ((i % arms) / arms) * Math.PI * 2;
        const theta = branchAngle + spin + Math.random() * 0.3;
        const randomX = (Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1)) * 1.5;
        const randomY = (Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1)) * 0.3;
        const randomZ = (Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1)) * 1.5;
        positions[i3] = (Math.cos(theta) * radius) + randomX;
        positions[i3 + 1] = randomY;
        positions[i3 + 2] = (Math.sin(theta) * radius) + randomZ;
        const r = Math.random() * 0.3 + 0.7;
        const g = Math.random() * 0.3 + 0.7;
        const b = Math.random() * 0.5 + 0.5;
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
          size={0.05}
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
      <Stars radius={150} depth={60} count={1000} factor={4} saturation={0} fade speed={0.1} />
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

export default function Dashboard() {
  const { data: session, status, update } = useSession();
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const chainId = useChainId();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { switchChain } = useSwitchChain();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { connect } = useConnect();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isMounted, setIsMounted] = useState(false);
  const [forceLoadingDismiss, setForceLoadingDismiss] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [providers, setProviders] = useState(null);
  const [email, setEmail] = useState('');
  const [csrfToken, setCsrfToken] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [baseModalOpen, setBaseModalOpen] = useState(false);
  const [isBaseLoading, setIsBaseLoading] = useState(false); // Thêm loading cho Base modal
  const [isInBaseApp, setIsInBaseApp] = useState(false);
  const [inMiniApp, setInMiniApp] = useState(false);
  const [miniAppAuthLoading, setMiniAppAuthLoading] = useState(false); // NEW: Loading for Mini App auth
  const [fetchedNonce, setFetchedNonce] = useState(null);
  const [miniAppAuthError, setMiniAppAuthError] = useState(null); // NEW: Track auth error for retry
  const recaptchaRef = useRef(null);
  const { userData, loading, error } = useUserData(session, csrfToken, setIsAnalyzing);

  useEffect(() => {
    const prefetchNonce = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/nonce`, { method: 'GET' });
        if (res.ok) {
          const { nonce } = await res.json();
          setFetchedNonce(nonce);
          safeLog('Prefetched nonce:', nonce?.substring(0, 8) + '...'); // Mask
        }
      } catch (err) {
        safeWarn('Nonce prefetch failed:', err.message);
      }
    };
    prefetchNonce();
  }, []);

  // FIXED: Init SDK, check environment, và gọi ready() SỚM sau mount (trong cùng useEffect)
  useEffect(() => {
    setIsMounted(true);
    const tab = searchParams.get('tab');
    if (tab && ['market', 'ai', 'profile', 'graph', 'watchlists', 'cluster'].includes(tab)) {
      setActiveTab(tab);
    }

    const initAndCheckEnvironment = async (retries = 10, delay = 500) => {
      let isInMini = false;
      for (let i = 0; i < retries; i++) {
        try {
          isInMini = await sdk.isInMiniApp();
          setInMiniApp(isInMini);
          if (isInMini) {
            safeLog('Detected Mini App environment via SDK');
            try {
              const context = await sdk.context;
              if (context.client.clientFid === 309857) {
                setIsInBaseApp(true);
                safeLog('Detected Base App environment');
              }
            } catch (contextErr) {
              safeError('Context fetch failed:', contextErr);
            }
            await callReadyWithRetry();
            return true;  // Success, exit
          }
        } catch (err) {
          safeError('SDK error (attempt ' + (i + 1) + '):', err);
          if (err.message.includes('AnalyticsSDKApiError')) {
            safeWarn('Analytics SDK conflict – skipping retry');
            break;
          }
          if (i < retries - 1) {
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      // NEW: Fallback detection via referrer if SDK fails (for mobile mini apps)
      const referrer = document.referrer || '';
      if (!isInMini && (referrer.includes('warpcast.com') || referrer.includes('farcaster.xyz'))) {
        isInMini = true;
        setInMiniApp(true);
        safeLog('Forced Mini App detection via referrer (SDK failed):', { referrer });
        // Still try ready() even if SDK failed
        await callReadyWithRetry().catch(() => safeWarn('Ready failed on referrer fallback'));
        return true;
      }

      safeWarn('Failed to detect Mini App after retries and referrer check');
      return false;
    };
    initAndCheckEnvironment();
  }, []); // Chỉ chạy 1 lần sau mount

  // NEW: Load Eruda cho debug console trên mobile (inject nếu dev hoặc inMiniApp)
  useEffect(() => {
    if (isDev || inMiniApp) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/eruda';
      script.async = true;
      script.onload = () => {
        eruda.init(); // Khởi động Eruda console
        safeLog('Eruda console loaded for mobile debug');
      };
      document.head.appendChild(script);
    }
  }, [inMiniApp]);

  // NEW: Handle auto-auth in Mini App using Quick Auth (gọi sau ready(), dùng skeleton nếu pending)
  useEffect(() => {
    if (inMiniApp && status === 'unauthenticated') {
      const handleMiniAppAuth = async (retryCount = 0) => {
        setMiniAppAuthLoading(true);
        setMiniAppAuthError(null);
        try {
          const { token } = await sdk.quickAuth.getToken();
          if (!token) throw new Error('No token from SDK');

          console.log('Mobile token preview:', token.substring(0, 50) + '...');
          const payload = JSON.parse(atob(token.split('.')[1]));
          console.log('Mobile token aud:', payload.aud);  // Debug aud

          const result = await signIn('farcaster', { redirect: false, token });
          if (result?.error) {
            if (retryCount < 2) {
              console.log('Retry auth (attempt', retryCount + 1, ')');
              await new Promise(r => setTimeout(r, 2000));
              return handleMiniAppAuth(retryCount + 1);
            }
            throw new Error(result.error || 'Auth failed (undefined error)');
          }
          toast.success('Farcaster auth OK!');
          await update();
          // FIXED: Force refresh để sync session/cookie sau auth (tránh 404)
          router.refresh();
          window.location.reload();  // Heavy nhưng an toàn cho mobile webview
        } catch (err) {
          console.error('Mini App auth fail:', err);
          setMiniAppAuthError(err.message);
          if (retryCount < 2) return handleMiniAppAuth(retryCount + 1);
        } finally {
          setMiniAppAuthLoading(false);
        }
      };
      handleMiniAppAuth();
    }
  }, [inMiniApp, status, update, router]);

  // NEW: Debug useEffect cho Mobile Token (tạm thời, xóa sau khi fix)
  useEffect(() => {
    if (inMiniApp && isMounted) {  // Chỉ chạy nếu đã detect Mini App
      const debugToken = async () => {
        try {
          // Kiểm tra nếu trong Mini App
          if (window.sdk && await sdk.isInMiniApp()) {
            const { token } = await sdk.quickAuth.getToken();
            console.log('Quick Auth Token (mobile debug):', token ? token.substring(0, 50) + '...' : 'NULL/EMPTY');
            if (token) {
              // Decode JWT payload (không cần secret, chỉ xem claims)
              const payload = JSON.parse(atob(token.split('.')[1]));
              console.log('Token Payload (debug):', {
                sub: payload.sub,  // FID
                aud: payload.aud,  // Audience/domain expected
                iss: payload.iss,  // Issuer
                exp: new Date(payload.exp * 1000).toISOString()  // Expiry
              });
              // Bonus: Check nếu aud match domain
              const expectedDomain = 'base.xynapseai.net';  // Thay bằng domain của bạn
              if (payload.aud !== expectedDomain) {
                console.error('AUDIENCE MISMATCH! Expected:', expectedDomain, 'Got:', payload.aud);
              }
            }
          } else {
            console.log('Not in Mini App (debug)');
          }
        } catch (err) {
          console.error('getToken Debug Error:', err);
        }
      };
      debugToken();  // Chạy ngay
    }
  }, [inMiniApp, isMounted]);  // Dependency: Chỉ chạy khi inMiniApp thay đổi

  // Load Base Account SDK
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.createBaseAccountSDK) {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/@base-org/account@latest/dist/base-account.min.js';
      script.async = true;
      script.onload = () => {
        safeLog('Base Account SDK loaded successfully');
      };
      script.onerror = () => safeError('Failed to load Base Account SDK');
      document.head.appendChild(script);
    }
  }, []);

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

  const fetchProvidersWithRetry = useCallback(async (retries = 2, delay = 500) => { // FIXED: Giảm retry/delay cho mobile speed
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
    if (isMounted && !providers) {
      fetchProvidersWithRetry();
    }
  }, [isMounted, providers, fetchProvidersWithRetry]);

  useEffect(() => {
    if (status !== 'authenticated' || session?.csrfToken || csrfToken) return;
    const fetchCsrfToken = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/csrf-token`, { // FIXED: Use correct path
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.accessToken || ''}`,
          },
          credentials: 'include',
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
        toast.error(`Failed to fetch CSRF token: ${err.message}`, { position: 'top-center' });
      }
    };
    fetchCsrfToken();
  }, [status, session, csrfToken, update]);

  // FIXED: Force hide loading sau 3s nếu stuck (mobile safety net)
  useEffect(() => {
    if (status === 'loading' || !providers) {
      const timeout = setTimeout(() => {
        safeWarn('Force dismissing loading overlay (possible mobile stuck)');
        // Không set providers null, nhưng allow render partial
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [status, providers]);

  const handleConnectWallet = async () => {
    try {
      if (!session?.user || !isConnected || !address || !recaptchaRef.current) throw new Error('Prerequisites not met');
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      const message = `Sign this message to authenticate: ${address}`;
      const signature = await signMessageAsync({ message });
      const jwtToken = session?.accessToken;
      const payload = { walletAddress: address, signature, message, uid: session.user.id };
      // Sử dụng polyfill HMAC
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
      safeError('Error verifying wallet:', err); // Fixed
      toast.error(`Wallet verification error: ${err.message}`, { position: 'top-center' });
    } finally {
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  // IMPROVED: Updated handleSignOut with correct path and fallback
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
          const response = await fetch(`${API_BASE_URL}/api/csrf-token`, { // FIXED: Use correct path
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
          // FALLBACK: Proceed without CSRF fetch
          safeWarn('CSRF fetch failed, using fallback sign-out');
          currentCsrfToken = null;
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
      if (isConnected) {
        disconnect();
      }
      toast.success('Signed out successfully!', { position: 'top-center' });
      router.refresh();
      router.push('/dashboard');
    } catch (error) {
      safeError('Error during sign out process:', error);
      // FALLBACK: Force sign-out on error
      await signOut({ redirect: false });
      localStorage.clear();
      toast.success('Signed out successfully (fallback mode).', { position: 'top-center' });
      router.refresh();
      router.push('/dashboard');
    } finally {
      if (recaptchaRef.current) {
        recaptchaRef.current.reset();
      }
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
      // FIXED: Check for auth loop (error=undefined)
      if (result?.error && result.error.includes('undefined')) {
        toast.error('Auth loop detected. Clearing cache and retry.');
        localStorage.clear();  // Clear client cache
        await signOut({ redirect: false });
        router.refresh();
        return;
      }
      if (result?.error) {
        if (result.error.includes('Rate limit exceeded')) {
          toast.error('Too many sign-in attempts. Please try again later.', { position: 'top-center' });
          return;
        }
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

  // IMPROVED: Thêm basic client-side SIWE parse check (optional, dùng siwe lib) + cleanup nonce on error
  const handleBaseSignIn = async () => {
    if (isBaseLoading || !fetchedNonce) {
      toast.error('Nonce not ready. Please wait or refresh.');
      return;
    }
    setIsBaseLoading(true);
    let tempNonce = fetchedNonce;
    try {
      if (!window.createBaseAccountSDK) {
        throw new Error('Base Account SDK not loaded. Please refresh.');
      }
      toast.info('Connecting to Base Account...', { position: 'top-center' });
      const baseSDK = window.createBaseAccountSDK({
        appName: 'Xynapse Dashboard',
        appLogoUrl: process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/logo.png` : 'https://base.xynapseai.net/logo.png',
      });
      const provider = baseSDK.getProvider();
      // Switch chain (fixed log)
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x2105' }],
        });
        safeLog('Switched to Base chain');
      } catch (switchErr) {
        safeWarn('Chain switch failed (already on Base?):', switchErr.message);
      }
      let message, signature, address;
      // Try wallet_connect
      try {
        const response = await provider.request({
          method: 'wallet_connect',
          params: [{
            version: '1',
            capabilities: {
              signInWithEthereum: {
                nonce: tempNonce,
                chainId: '0x2105',
              }
            }
          }]
        });
        safeLog('Full SDK response received'); // Silent raw
        const accounts = response?.accounts;
        if (!accounts?.length) throw new Error('No accounts from SDK');
        const account = accounts[0];
        const siwe = account.capabilities?.signInWithEthereum;
        if (!siwe?.message || !siwe?.signature) throw new Error('Invalid SIWE from SDK');
        message = siwe.message;
        signature = siwe.signature;
        address = account.address;
        const hasVersion = message.includes('Version: 1');
        const hasIssuedAt = message.includes('Issued At:');
        if (!hasVersion || !hasIssuedAt) {
          safeWarn('Partial SIWE from SDK, throwing to fallback');
          throw new Error('Partial message - fallback');
        }
        safeLog('Full SIWE from SDK OK');
      } catch (walletErr) {
        safeWarn('wallet_connect failed (origins/unsupported/partial), fallback to manual:', walletErr.message);
        const accountsResp = await provider.request({
          method: 'eth_requestAccounts',
        });
        if (!accountsResp?.length) throw new Error('No accounts from eth_requestAccounts');
        address = accountsResp[0];
        safeLog('Got address for fallback:', address.substring(0, 6) + '...'); // Mask
        const domain = window.location.host;
        const uri = window.location.origin;
        const now = new Date().toISOString();
        const siweMessage = new SiweMessage({
          domain,
          address,
          uri,
          version: '1',
          chainId: 8453,
          nonce: tempNonce,
          issuedAt: now,
          statement: 'Sign in to Xynapse Dashboard.',
        });
        message = siweMessage.prepareMessage();
        safeLog('Constructed full SIWE message (fallback):', message.substring(0, 100) + '...'); // Preview
        safeLog('Message lines:', message.split('\n').length);
        signature = await provider.request({
          method: 'personal_sign',
          params: [message, address],
        });
        safeLog('Fallback signature length:', signature?.length || 'N/A');
      }
      if (!message || !signature || !address) {
        throw new Error('Missing message/signature/address after fallback');
      }
      const hasNonce = message.includes(`Nonce: ${tempNonce}`);
      const hasChain = message.includes('Chain ID: 8453');
      if (!message.includes('Version: 1') || !message.includes('Issued At:') || !hasNonce || !hasChain) {
        throw new Error('Invalid SIWE fields after construct');
      }
      safeLog('Validated SIWE OK, proceeding to NextAuth signIn');
      const res = await signIn('credentials', {
        message,
        signature,
        redirect: false,
      });
      // FIXED: Check for auth loop (error=undefined)
      if (res?.error && res.error.includes('undefined')) {
        toast.error('Auth loop detected. Clearing cache and retry.');
        localStorage.clear();  // Clear client cache
        await signOut({ redirect: false });
        router.refresh();
        return;
      }
      if (res?.error) {
        safeError('NextAuth res error:', res.error); // Keep
        throw new Error(res.error);
      }
      const delRes = await fetch(`${API_BASE_URL}/api/nonce`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: tempNonce }),
      });
      if (!delRes.ok) {
        safeWarn('Nonce cleanup on success failed:', delRes.status);
      } else {
        safeLog('Nonce cleaned up');
      }
      toast.success(`Signed in with Base! Address: ${address.substring(0, 6)}...${address.substring(-4)}`, { position: 'top-center' });
      setBaseModalOpen(false);
      await update();
      router.push('/dashboard');
    } catch (err) {
      safeError('Base sign-in error:', err); // Keep
      toast.error(`Sign-in error: ${err.message}`, { position: 'top-center' });
      try {
        const delRes = await fetch(`${API_BASE_URL}/api/nonce`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nonce: tempNonce }),
        });
        if (!delRes.ok) safeWarn('Nonce cleanup on error failed:', delRes.status);
      } catch (cleanupErr) {
        safeWarn('Cleanup fetch error:', cleanupErr);
      }
    } finally {
      setIsBaseLoading(false);
    }
  };

  // FIXED: Skip loading nếu Mini App + force mounted sau 2s cho mobile
  const isLoadingState = (!isMounted || !providers || status === 'loading') && !forceLoadingDismiss;
  safeLog('Current loading state:', { isMounted, providers: !!providers, status, forceDismiss: forceLoadingDismiss });
  useEffect(() => {
    if (inMiniApp && isLoadingState) {
      const forceMount = setTimeout(() => {
        setIsMounted(true); // Force để dismiss overlay
        setForceLoadingDismiss(true);
        safeLog('Force mounted for Mini App (avoid stuck)');
      }, 2000);
      return () => clearTimeout(forceMount);
    }
  }, [inMiniApp, isLoadingState]);

  if (isLoadingState || (inMiniApp && miniAppAuthLoading)) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
        <LoadingOverlay
          isLoading={true}
          message={inMiniApp ? "Authenticating with Farcaster..." : "Loading dashboard..."}
          isMobile={typeof window !== 'undefined' && window.innerWidth <= 640}
        />
      </div>
    );
  }

  const requiresAuth = ['profile', 'ai', 'watchlists'].includes(activeTab);
  const showLoginForm = status === 'unauthenticated' && requiresAuth && !inMiniApp; // FIXED: Hide form in Mini App
  return (
    <CurrencyProvider>
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
              <div // FIXED: Bỏ motion cho mobile speed, dùng plain div nếu Mini App
                className={`w-full h-full flex items-center justify-center text-white font-saira relative ${inMiniApp ? '' : 'motion-parent' // Conditional class nếu cần
                  }`}
              >
                {/* FIXED: Skip heavy 3D hoàn toàn nếu Mini App */}
                {!inMiniApp && (
                  <div className="fixed inset-0 z-0">
                    <Canvas camera={{ position: [0, 0, 5], fov: 75 }} dpr={[1, 1.5]} performance={{ min: 0.3 }}>
                      <UniverseBackground />
                    </Canvas>
                  </div>
                )}
                <div // FIXED: Bỏ motion, dùng plain cho Mini App
                  className={`relative z-20 bg-black/60 backdrop-blur-xs p-8 md:p-12 border border-white/15 rounded-lg max-w-md w-full mx-4 flex flex-col items-center shadow-2xl shadow-black/50 ${inMiniApp ? '' : 'motion-child'
                    }`}
                >
                  <h1 // FIXED: Plain text, no motion
                    className="text-2xl md:text-3xl font-bold text-white uppercase mb-4 text-center tracking-wide"
                  >
                    {isInBaseApp ? 'Sign In with Base' : 'Sign In'}
                  </h1>
                  <p // FIXED: Plain
                    className="text-xs md:text-sm text-gray-500 mb-8 text-center leading-relaxed"
                  >
                    {isInBaseApp ? 'Use your Base Account for seamless sign-in.' : 'Access your dashboard with secure authentication.'}
                  </p>
                  {!isInBaseApp && (
                    <>
                      <form onSubmit={handleEmailSignIn} className="w-full space-y-6">
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Enter your email"
                          className="w-full px-5 py-3 bg-black/60 border border-white/15 rounded-2xl text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all duration-300"
                          required
                        />
                        <button
                          type="submit"
                          className="w-full px-5 py-3 border-2 border-white/15 bg-white/10 text-white rounded-2xl text-sm font-semibold uppercase transition-all duration-300 hover:border-white/30 hover:bg-white/20 flex items-center justify-center"
                        >
                          <MatrixHoverEffect text="Sign in with Email" hoverColor="#FFFFFF" />
                        </button>
                      </form>
                      <div className="flex items-center justify-center my-6 w-full">
                        <span className="text-gray-500 text-xs uppercase px-4">OR</span>
                        <div className="flex-1 h-px bg-white/10"></div>
                      </div>
                      {providers?.google && (
                        <button
                          onClick={handleGoogleSignIn}
                          className="w-full px-5 py-3 bg-black/20 border border-white/25 rounded-2xl text-white text-sm font-semibold uppercase flex items-center justify-center gap-3 transition-all duration-300 hover:bg-gray-800/30 hover:border-white/40"
                        >
                          <Image
                            src="/logos/google.webp"
                            alt="Google Logo"
                            width={20}
                            height={20}
                            className="w-5 h-5 object-contain"
                          />
                          <MatrixHoverEffect text="Google" />
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => setBaseModalOpen(true)}
                    className="m-2 w-full px-5 py-3 bg-black/20 border border-white/25 rounded-2xl text-white text-sm font-semibold uppercase flex items-center justify-center gap-3 transition-all duration-300 hover:bg-gray-800/30 hover:border-white/40"
                  >
                    <Image
                      src="/logos/base.webp"
                      alt="Base Logo"
                      width={20}
                      height={20}
                      className="w-5 h-5 object-contain"
                    />
                    <MatrixHoverEffect text="Base App" />
                  </button>
                  {error && (
                    <div // FIXED: Plain error
                      className="mt-6 text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center"
                    >
                      Error: {error}
                    </div>
                  )}
                  <p // FIXED: Plain
                    className="mt-6 text-xs text-gray-500 text-center leading-relaxed"
                  >
                    By clicking continue, you agree to our{' '}
                    <button onClick={() => openModal('terms')} className="text-white hover:underline">
                      Terms of Service
                    </button>{' '}
                    and{' '}
                    <button onClick={() => openModal('privacy')} className="text-white hover:underline">
                      Privacy Policy
                    </button>.
                  </p>
                </div>
              </div>
            ) : inMiniApp && miniAppAuthError ? ( // NEW: If Mini App auth fail, show retry UI instead of form
              <div className="w-full h-full flex items-center justify-center text-white">
                <div className="bg-black/60 p-8 border border-white/15 rounded-lg max-w-md w-full mx-4 flex flex-col items-center">
                  <h1 className="text-2xl font-bold text-white uppercase mb-4 text-center">
                    Farcaster Auth Failed
                  </h1>
                  <p className="text-sm text-gray-500 mb-8 text-center">
                    Error: {miniAppAuthError}. Please retry or contact support.
                  </p>
                  <button
                    onClick={() => {
                      setMiniAppAuthLoading(true);
                      // Retry auth function (từ useEffect trên)
                      const handleMiniAppAuth = async () => {
                        setMiniAppAuthError(null);
                        try {
                          const { token } = await sdk.quickAuth.getToken();
                          if (!token) throw new Error('Failed to get Quick Auth token');
                          const result = await signIn('farcaster', { redirect: false, token });
                          // FIXED: Check for auth loop
                          if (result?.error && result.error.includes('undefined')) {
                            toast.error('Auth loop detected. Clearing cache and retry.');
                            localStorage.clear();
                            await signOut({ redirect: false });
                            router.refresh();
                            return;
                          }
                          if (result?.error) throw new Error(result.error);
                          toast.success('Signed in with Farcaster!', { position: 'top-center' });
                          await update();
                        } catch (err) {
                          setMiniAppAuthError(err.message);
                          toast.error(`Retry failed: ${err.message}`, { position: 'top-center' });
                        } finally {
                          setMiniAppAuthLoading(false);
                        }
                      };
                      handleMiniAppAuth();
                    }} // Retry auth
                    className="w-full px-5 py-3 bg-blue-600 text-white rounded-2xl text-sm font-semibold uppercase transition-all duration-300 hover:bg-blue-700 flex items-center justify-center gap-3"
                  >
                    Retry Farcaster Sign In
                  </button>
                </div>
              </div>
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
                    initialClusterId={searchParams.get('clusterId') || 'binance'}
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
        {baseModalOpen && (
          <div
            className="fixed inset-0 bg-black/75 flex items-center justify-center z-50"
            onClick={() => setBaseModalOpen(false)}
          >
            <div
              className="bg-gray-900/50 backdrop-blur-lg border border-white/20 rounded-2xl w-full max-w-md h-[60vh] relative flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 z-10 backdrop-blur-lg border-b border-white/20 p-4 flex justify-between items-center">
                <h2 className="text-xl font-bold text-white uppercase">Sign In with Base App</h2>
                <button
                  onClick={() => setBaseModalOpen(false)}
                  className="text-white text-xl font-bold hover:text-neon-blue transition-all duration-300"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 flex flex-col items-center justify-center p-4 overflow-auto">
                <p className="text-gray-500 text-sm mb-4 text-center">
                  Use your Base passkey or wallet for universal sign-in. One tap across Base apps.
                </p>
                <button
                  onClick={handleBaseSignIn}
                  disabled={isBaseLoading || !fetchedNonce}
                  className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-2xl text-sm font-semibold transition-all duration-300 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isBaseLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Image src="/logos/base.webp" alt="Base Logo" width={16} height={16} className="w-4 h-4 object-contain" />
                      Sign in with Base
                    </>
                  )}
                </button>
                <p className="text-xs text-gray-400 mt-4 text-center">
                  Secure, self-custodial. No seed phrases needed.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </CurrencyProvider>
  );
}