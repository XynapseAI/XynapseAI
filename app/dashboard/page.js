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
        walletAddress: result.user.wallet_address, // Thêm wallet từ API response
        tweetPoints: result.user.tweet_points,
        aiPoints: result.user.ai_points,
      });
      toast.success('User data loaded successfully!', { position: 'top-center' });
      setError(null);
    } catch (err) {
      console.error('Error fetching user data:', err);
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
      setUserData((prev) => (prev ? { ...prev, tweetPoints: result.tweet_points } : null));
      toast.success('Tweet analysis successful!', { position: 'top-center' });
    } catch (err) {
      console.error('Error analyzing tweet:', err);
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
  const recaptchaRef = useRef(null);
  const { userData, loading, error } = useUserData(session, csrfToken, setIsAnalyzing);

  // Init Mini App SDK
  useEffect(() => {
    const initMiniApp = async () => {
      if (sdk) {
        try {
          await sdk.actions.ready(); // Hide splash screen
          console.log('Mini App ready!');
        } catch (err) {
          console.error('Mini App init error:', err);
        }
      }
    };
    initMiniApp();
  }, []);

  // Detect Base App environment
  useEffect(() => {
    const checkEnvironment = async () => {
      if (typeof sdk !== 'undefined') {
        try {
          const inMiniApp = await sdk.isInMiniApp();
          if (inMiniApp) {
            const context = await sdk.context;
            if (context.client.clientFid === 309857) {
              setIsInBaseApp(true);
              console.log('Detected Base App environment');
            }
          }
        } catch (err) {
          console.error('Error checking Base App environment:', err);
        }
      }
    };
    checkEnvironment();
  }, []);

  // Load Base Account SDK
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.createBaseAccountSDK) {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/@base-org/account@latest/dist/base-account.min.js';
      script.async = true;
      script.onload = () => {
        console.log('Base Account SDK loaded successfully');
      };
      script.onerror = () => console.error('Failed to load Base Account SDK');
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

  const fetchProvidersWithRetry = useCallback(async (retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await getProviders();
        setProviders(response);
        return;
      } catch (err) {
        console.error(`Attempt ${i + 1} failed to fetch providers: ${err.message}`);
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
    if (tab && ['market', 'ai', 'profile', 'graph', 'watchlists', 'cluster'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (status !== 'authenticated' || session?.csrfToken || csrfToken) return;

    const fetchCsrfToken = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/csrf`, {
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
        console.error('Error fetching CSRF token:', err);
        toast.error(`Failed to fetch CSRF token: ${err.message}`, { position: 'top-center' });
      }
    };
    fetchCsrfToken();
  }, [status, session, csrfToken, update]);

  useEffect(() => {
    if (isMounted && !providers) {
      fetchProvidersWithRetry();
    }
  }, [isMounted, providers, fetchProvidersWithRetry]);

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
      console.error('Error verifying wallet:', err);
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
          console.error('Failed to fetch CSRF token:', csrfError);
          throw new Error('Cannot sign out: Missing CSRF token');
        }
      }

      try {
        await signOut({ redirect: false });
        await update();
      } catch (signOutError) {
        console.error('signOut fetch error:', signOutError);
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
          console.warn('Failed to clear server-side cache:', response.statusText);
        }
      } catch (cacheErr) {
        console.warn('Failed to clear server-side cache:', cacheErr.message);
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
      console.error('Error during sign out process:', error);
      toast.error(`Failed to sign out: ${error.message}`, { position: 'top-center' });
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
      console.error('Error signing in with email:', err);
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
        if (result.error.includes('This account is registered with email')) {
          toast.error(result.error, { position: 'top-center' });
          return;
        }
        throw new Error(result.error);
      }
      if (!result?.url) {
        console.warn('No redirect URL provided by NextAuth, falling back to manual redirect');
        window.location.href = `${API_BASE_URL}/api/auth/signin/google`;
        return;
      }
      window.location.href = result.url;
    } catch (err) {
      console.error('Error signing in with Google:', err);
      toast.error(`Failed to sign in with Google: ${err.message}`, { position: 'top-center' });
    }
  };

  // IMPROVED: Thêm basic client-side SIWE parse check (optional, dùng siwe lib) + cleanup nonce on error
  const handleBaseSignIn = async () => {
    if (isBaseLoading) return;
    setIsBaseLoading(true);
    let fetchedNonce = null; // For cleanup

    try {
      if (!window.createBaseAccountSDK) {
        throw new Error('Base Account SDK not loaded. Please refresh the page.');
      }

      // Fetch nonce từ server
      const nonceRes = await fetch(`${API_BASE_URL}/api/nonce`, { method: 'GET' });
      if (!nonceRes.ok) throw new Error('Failed to fetch nonce');
      const { nonce } = await nonceRes.json();
      fetchedNonce = nonce;
      if (!nonce || nonce.length !== 32 || !/^[a-f0-9]{32}$/i.test(nonce)) {
        throw new Error('Invalid nonce from server');
      }
      console.log('Fetched server nonce:', nonce); // Debug

      toast.info('Connecting to Base Account...', { position: 'top-center' });

      // Initialize SDK
      const baseSDK = window.createBaseAccountSDK({
        appName: 'Xynapse Dashboard',
        appLogoUrl: process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/logo.png` : 'https://base.xynapseai.net/logo.png',
      });
      const provider = baseSDK.getProvider();

      // Request wallet_connect
      const response = await provider.request({
        method: 'wallet_connect',
        params: [{
          version: '1',
          capabilities: {
            signInWithEthereum: {
              nonce,  // 32 hex chars
              chainId: '0x2105',  // Base = 8453
            }
          }
        }]
      });

      console.log('Full SDK response:', response); // Debug full

      const accounts = response?.accounts;
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts returned from Base Account');
      }

      const account = accounts[0];
      const siwe = account.capabilities?.signInWithEthereum;
      if (!siwe) {
        console.error('No SIWE capabilities in response:', account);
        throw new Error('SDK did not return SIWE capabilities – user may have cancelled or network error');
      }

      let { message, signature } = siwe;
      if (!message || typeof message !== 'string' || !signature || typeof signature !== 'string') {
        console.error('Invalid SIWE from SDK:', { message, signature });
        throw new Error('Invalid SIWE message or signature from SDK');
      }

      console.log('Raw SDK message:', message); // Debug raw
      console.log('Raw SDK signature length:', signature.length); // Debug

      // NEW: Optional client-side parse check (lightweight, using siwe lib)
      try {
        const clientSiwe = new SiweMessage(message);
        const { address, chainId, nonce: msgNonce, version, issuedAt } = clientSiwe;
        if (chainId !== '8453' || version !== '1' || msgNonce !== nonce) {
          throw new Error('Client-side SIWE validation failed (chain/nonce/version mismatch)');
        }
        if (issuedAt && new Date(issuedAt) < new Date(Date.now() - 5 * 60 * 1000)) {
          throw new Error('SIWE message too old on client');
        }
        console.log('Client-side SIWE parse OK:', { address: address?.toLowerCase() });
      } catch (clientParseErr) {
        console.warn('Client-side SIWE parse warning (non-fatal):', clientParseErr.message);
        // Proceed, server will strict validate
      }

      console.log('Validated SIWE OK (raw + client check), proceeding to signIn');

      // Sign in via NextAuth với raw message
      const res = await signIn('credentials', {
        message,  // Raw
        signature,
        redirect: false,
      });

      if (res?.error) {
        console.error('NextAuth res error:', res.error);
        // Cleanup nonce on fail
        if (fetchedNonce) {
          await fetch(`${API_BASE_URL}/api/nonce`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce: fetchedNonce }),
          }).catch(err => console.warn('Nonce cleanup failed:', err));
        }
        throw new Error(res.error);
      }

      // Cleanup on success
      if (fetchedNonce) {
        await fetch(`${API_BASE_URL}/api/nonce`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nonce: fetchedNonce }),
        }).catch(() => { });
      }

      toast.success(`Signed in with Base! Address: ${account.address.slice(0, 6)}...${account.address.slice(-4)}`, { position: 'top-center' });
      setBaseModalOpen(false);
      await update();
      router.push('/dashboard');  // Force push
    } catch (err) {
      console.error('Base sign-in error:', err);
      toast.error(`Sign-in error: ${err.message}`, { position: 'top-center' });
      // Ensure cleanup on error
      if (fetchedNonce) {
        await fetch(`${API_BASE_URL}/api/nonce`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nonce: fetchedNonce }),
        }).catch(err => console.warn('Error cleanup failed:', err));
      }
    } finally {
      setIsBaseLoading(false);
    }
  };

  if (!isMounted || !providers || status === 'loading') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
        <LoadingOverlay
          isLoading={true}
          message="Loading dashboard..."
          isMobile={typeof window !== 'undefined' && window.innerWidth <= 640}
        />
      </div>
    );
  }

  const requiresAuth = ['profile', 'ai', 'watchlists'].includes(activeTab);
  const showLoginForm = status === 'unauthenticated' && requiresAuth;

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
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="w-full h-full flex items-center justify-center text-white font-saira relative"
              >
                <div className="fixed inset-0 z-0">
                  <Canvas camera={{ position: [0, 0, 5], fov: 75 }} dpr={[1, 1.5]} performance={{ min: 0.3 }}>
                    <UniverseBackground />
                  </Canvas>
                </div>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className="relative z-20 bg-black/60 backdrop-blur-xs p-8 md:p-12 border border-white/15 rounded-lg max-w-md w-full mx-4 flex flex-col items-center shadow-2xl shadow-black/50"
                >
                  <motion.h1
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="text-2xl md:text-3xl font-bold text-white uppercase mb-4 text-center tracking-wide"
                  >
                    {isInBaseApp ? 'Sign In with Base' : 'Sign In'}
                  </motion.h1>
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="text-xs md:text-sm text-gray-500 mb-8 text-center leading-relaxed"
                  >
                    {isInBaseApp ? 'Use your Base Account for seamless sign-in.' : 'Access your dashboard with secure authentication.'}
                  </motion.p>
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
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.4 }}
                      className="mt-6 text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center"
                    >
                      Error: {error}
                    </motion.div>
                  )}
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.5 }}
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
              console.error('reCAPTCHA initialization failed');
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
                  disabled={isBaseLoading}
                  className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-2xl text-sm font-semibold transition-all duration-300 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isBaseLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Image
                        src="/logos/base.webp"
                        alt="Base Logo"
                        width={16}
                        height={16}
                        className="w-4 h-4 object-contain"
                      />
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