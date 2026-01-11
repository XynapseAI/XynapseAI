'use client'
import { useState, useEffect, useRef, useCallback, useMemo, lazy } from 'react' // REMOVED: Suspense for direct render to avoid delay
import { useRouter, useSearchParams } from 'next/navigation'
import { useAccount, useDisconnect, useSignMessage } from 'wagmi'
import { signIn, signOut, useSession, getProviders } from 'next-auth/react'
import Header from '../../components/Header'
import AITab from '../../components/AITab'
import ProfileTab from '../../components/ProfileTab'
import MarketTab from '../../components/MarketTab'
import TreemapTab from '../../components/TreemapTab'
import WatchlistsTab from '../../components/WatchlistsTab'
import ClusterTab from '../../components/ClusterTab'
import ExplorerTab from '../../components/ExplorerTab'
import EtfTab from '../../components/EtfTab'
import DexTab from '../../components/DexTab'
import ReCAPTCHA from 'react-google-recaptcha'
import { toast, ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import MatrixHoverEffect from '../../components/MatrixHoverEffect'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { gsap } from 'gsap'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import { LoadingOverlay } from '@/utils/helpers'
import { CurrencyProvider } from '../../components/CurrencyContext'
import crypto from 'crypto' // Keep for server-side, polyfill for browser
import { Canvas, useFrame } from '@react-three/fiber'
import { Stars, Sphere, Float, Environment } from '@react-three/drei'
import * as THREE from 'three'
import { TermsOfServiceContent } from '../../components/TermsOfService'
import { PrivacyPolicyContent } from '../../components/PrivacyPolicy'
import '@farcaster/auth-kit/styles.css'
import { AuthKitProvider, SignInButton, useSignIn } from '@farcaster/auth-kit' // ADDED: useSignIn for manual deeplink trigger
import { sdk } from '@farcaster/miniapp-sdk' // Keep for miniapp
import { useMiniApp, MiniAppProvider } from '@neynar/react'
import { MiniKit } from '@worldcoin/minikit-js' // FIXED: Import MiniKit from root, MiniKitProvider from sub-module
import { MiniKitProvider as WorldMiniKitProvider } from '@worldcoin/minikit-js/minikit-provider' // FIXED: Import correct path
import { preconnect } from 'react-dom' // NEW: For preconnect to Quick Auth server
import { SafeArea } from '@coinbase/onchainkit/minikit'
import { clearAllCaches } from '../../utils/indexedDB'
gsap.registerPlugin(MotionPathPlugin)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api'
const isDev = process.env.NODE_ENV === 'development'
const safeConsole = {
  log: (...args) => isDev && console.log(...args),
  warn: (...args) => isDev && console.warn(...args),
  error: (...args) => isDev && console.error(...args),
}
const safeLog = (...args) => safeConsole.log(...args)
const safeWarn = (...args) => safeConsole.warn(...args)
const safeError = (...args) => safeConsole.error(...args)

const BlinkingDots = () => {
  const dotVariants = {
    rest: {
      scale: 1,
      opacity: 0.5,
      boxShadow: '0 0 0px rgba(255, 255, 255, 0)',
    },
    pulse: {
      scale: 1.3,
      opacity: 1,
      boxShadow: '0 0 12px rgba(255, 255, 255, 0.9)',
    },
  }

  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map((index) => (
        <motion.div
          key={index}
          className="w-1 h-1 bg-white rounded-full"
          variants={dotVariants}
          initial="rest"
          animate="pulse"
          transition={{
            duration: 0.6,
            repeat: Infinity,
            repeatType: 'reverse',
            ease: 'easeInOut',
            delay: index * 0.25,
          }}
        />
      ))}
    </div>
  )
}

// Polyfill HMAC for browser (use Web Crypto API, as old uses createHmac - server only)
async function hmacSha256(key, data) {
  if (typeof window !== 'undefined' && !crypto.subtle) {
    throw new Error('Crypto not supported')
  }
  const encoder = new TextEncoder()
  const keyData = encoder.encode(key)
  const dataArray = encoder.encode(data)
  const importedKey = await window.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await window.crypto.subtle.sign('HMAC', importedKey, dataArray)
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
const useUserData = (session, csrfToken, setIsAnalyzing, isWorldMiniApp) => {
  // ADDED: isWorldMiniApp param
  const [userData, setUserData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const recaptchaRef = useRef(null)
  const fetchUserData = useCallback(async () => {
    // Enhanced check to prevent fetch when unauthenticated
    if (!session || !session?.user?.id || !csrfToken) {
      setLoading(false)
      setUserData(null)
      setError(null)
      return
    }
    setLoading(true)
    try {
      let recaptchaToken = null
      if (!isWorldMiniApp && !recaptchaRef.current) {
        // MODIFIED: Skip reCAPTCHA for World Mini App
        throw new Error('reCAPTCHA component is not initialized')
      }
      if (!isWorldMiniApp) {
        // MODIFIED: Only execute if not World Mini App
        recaptchaToken = await recaptchaRef.current.executeAsync()
        if (!recaptchaToken) {
          throw new Error('Failed to obtain reCAPTCHA token')
        }
      }
      const jwtToken = session?.accessToken
      const response = await fetch(
        `${API_BASE_URL}/user?uid=${encodeURIComponent(session.user.id)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(recaptchaToken && { 'X-Recaptcha-Token': recaptchaToken }), // MODIFIED: Conditional header
            'X-CSRF-Token': csrfToken,
            Authorization: `Bearer ${jwtToken}`,
          },
          credentials: 'include',
        },
      )
      const result = await response.json()
      if (!response.ok) {
        if (response.status === 401) {
          setError('Session expired, please sign in again')
          return
        }
        throw new Error(result.detail || 'Failed to fetch user data')
      }
      setUserData({
        ...result.user,
        profilePicture: result.user.profile_picture,
        googleName: result.user.google_name,
        tweetPoints: result.user.tweet_points,
        aiPoints: result.user.ai_points,
      })
      // REMOVED: toast.success('User data loaded successfully!', { position: 'top-center' }); // Silent load
      setError(null)
    } catch (err) {
      safeError('Error fetching user data:', err)
      setError(`Failed to fetch user data: ${err.message}`)
      toast.error(`Error: ${err.message}`, { position: 'top-center' })
    } finally {
      setLoading(false)
      if (recaptchaRef.current && !isWorldMiniApp) {
        // MODIFIED: Reset only if used
        recaptchaRef.current.reset()
      }
    }
  }, [session, csrfToken, isWorldMiniApp]) // ADDED: isWorldMiniApp to deps
  const handleAnalyzeTweets = useCallback(async () => {
    setIsAnalyzing(true)
    try {
      if (!session?.user || !csrfToken) throw new Error('Authentication or CSRF token missing')
      const recaptchaToken =
        process.env.NODE_ENV === 'development'
          ? 'development-token'
          : await recaptchaRef.current?.executeAsync()
      const jwtToken = session?.accessToken
      const payload = { uid: session.user.id }
      // Use polyfill HMAC (browser/server compatible)
      const sortedPayload = JSON.stringify(payload, Object.keys(payload).sort())
      const signature = await hmacSha256(process.env.HMAC_SECRET || 'default-secret', sortedPayload)
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
      })
      const result = await response.json()
      if (!response.ok) {
        if (response.status === 401) {
          setError('Session expired, please sign in again')
          return
        }
        throw new Error(result.detail || 'Tweet analysis failed')
      }
      setUserData((prev) => (prev ? { ...prev, tweetPoints: result.tweet_points } : null))
      toast.success('Tweet analysis successful!', { position: 'top-center' })
    } catch (err) {
      safeError('Error analyzing tweet:', err)
      toast.error(`Tweet analysis error: ${err.message}`, { position: 'top-center' })
    } finally {
      setIsAnalyzing(false)
      if (recaptchaRef.current) recaptchaRef.current.reset()
    }
  }, [session, csrfToken, setIsAnalyzing])
  useEffect(() => {
    fetchUserData()
  }, [fetchUserData])
  return { userData, loading, error, handleAnalyzeTweets, recaptchaRef }
}
// function UniverseBackground() {
//   const groupRef = useRef(null)
//   useFrame((state) => {
//     if (groupRef.current) {
//       const time = state.clock.getElapsedTime()
//       groupRef.current.rotation.z = time * 0.003 // Reduced speed for lighter performance
//       groupRef.current.rotation.y = time * 0.001
//     }
//   })
//   // Simplified Galaxy with fewer points
//   const Galaxy = () => {
//     const pointsRef = useRef()
//     const count = 2000 // Reduced count for performance
//     const positions = useMemo(() => new Float32Array(count * 3), [])
//     const colors = useMemo(() => new Float32Array(count * 3), [])
//     useEffect(() => {
//       for (let i = 0; i < count; i++) {
//         const i3 = i * 3
//         const radius = Math.random() * 30 + 3 // Smaller radius
//         const arms = 3 // Fewer arms
//         const spin = radius * 0.15
//         const branchAngle = ((i % arms) / arms) * Math.PI * 2
//         const theta = branchAngle + spin + Math.random() * 0.3
//         const randomX = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 1.5
//         const randomY = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 0.3 // Flatter
//         const randomZ = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * 1.5
//         positions[i3] = Math.cos(theta) * radius + randomX
//         positions[i3 + 1] = randomY
//         positions[i3 + 2] = Math.sin(theta) * radius + randomZ
//         const r = Math.random() * 0.3 + 0.7
//         const g = Math.random() * 0.3 + 0.7
//         const b = Math.random() * 0.5 + 0.5 // Subtle blue
//         colors[i3] = r
//         colors[i3 + 1] = g
//         colors[i3 + 2] = b
//       }
//       pointsRef.current.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
//       pointsRef.current.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
//     }, [positions, colors]) // Fixed: Add positions and colors to deps (they are memoized, so no infinite loop)
//     return (
//       <points ref={pointsRef} position={[0, 0, -20]} rotation={[Math.PI / 6, 0, 0]}>
//         <bufferGeometry />
//         <pointsMaterial
//           size={0.05} // Smaller size
//           sizeAttenuation
//           vertexColors
//           transparent
//           opacity={0.6}
//           blending={THREE.AdditiveBlending}
//           depthWrite={false}
//         />
//       </points>
//     )
//   }
//   return (
//     <group ref={groupRef}>
//       <Stars radius={150} depth={60} count={1000} factor={4} saturation={0} fade speed={0.1} />{' '}
//       {/* Reduced count and speed */}
//       {/* Minimal moving stars */}
//       <group>
//         {Array.from({ length: 3 }).map((_, i) => (
//           <Float key={i} speed={0.1} rotationIntensity={0.02}>
//             <Sphere
//               args={[0.01 + Math.random() * 0.005, 6, 6]}
//               position={[
//                 (Math.random() - 0.5) * 80,
//                 (Math.random() - 0.5) * 80,
//                 (Math.random() - 0.5) * 80,
//               ]}
//             >
//               <meshStandardMaterial
//                 color="#FFFFFF"
//                 emissive="#FFFFFF"
//                 emissiveIntensity={0.3}
//                 transparent
//                 opacity={0.7}
//               />
//             </Sphere>
//           </Float>
//         ))}
//       </group>
//       <Galaxy />
//       {/* Subtle nebulae */}
//       {Array.from({ length: 2 }).map((_, i) => (
//         <Float key={`nebula-${i}`} speed={0.1} rotationIntensity={0.02}>
//           <Sphere
//             args={[5 + Math.random() * 4, 12, 12]}
//             position={[
//               (Math.random() - 0.5) * 80,
//               (Math.random() - 0.5) * 15,
//               (Math.random() - 0.5) * 80,
//             ]}
//           >
//             <meshStandardMaterial
//               color={Math.random() > 0.5 ? '#4B0082' : '#8A2BE2'}
//               transparent
//               opacity={0.08 + Math.random() * 0.06}
//               emissive={Math.random() > 0.5 ? '#4B0082' : '#8A2BE2'}
//               emissiveIntensity={0.1 + Math.random() * 0.08}
//               blending={THREE.AdditiveBlending}
//             />
//           </Sphere>
//         </Float>
//       ))}
//       <Environment preset="night" />
//       <ambientLight intensity={0.15} color="#000022" />
//       <pointLight position={[0, 0, 8]} intensity={0.3} color="#FFFFFF" />
//       <pointLight position={[-15, 0, -15]} intensity={0.2} color="#00BFFF" />
//     </group>
//   )
// }
// NEW: Inner component wrapped by MiniAppProvider, containing useMiniApp hook
function DashboardInner() {
  // FIXED: Move useEffect suppress unhandledrejection into this component
  useEffect(() => {
    const handleUnhandledRejection = (event) => {
      if (
        event.reason?.message?.includes('result') ||
        event.reason?.message?.includes("origins don't match")
      ) {
        safeError('Suppressed SDK uncaught rejection:', event.reason)
        event.preventDefault() // Stop propagation
      }
    }
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  }, [])
  const { data: session, status, update } = useSession()
  const { isConnected: walletConnected, address: walletAddress } = useAccount()
  const { disconnect } = useDisconnect()
  const { signMessageAsync } = useSignMessage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isMounted, setIsMounted] = useState(false)
  const [activeTab, setActiveTab] = useState('profile') // FIXED: Revert to 'profile' like old file for consistency on unauth
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [providers, setProviders] = useState(null)
  const [email, setEmail] = useState('')
  const [csrfToken, setCsrfToken] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalContent, setModalContent] = useState(null)
  const [authSuccess, setAuthSuccess] = useState(false) // NEW: Fix loop - track auth success to hide form immediately
  const recaptchaRef = useRef(null)
  const { isSDKLoaded, context, user: miniAppUser } = useMiniApp() // FIXED: Destructure properly based on Neynar docs (user may be optional)
  const [isMiniApp, setIsMiniApp] = useState(false)
  const [miniAppAuthLoading, setMiniAppAuthLoading] = useState(false) // NEW: Loading for quickauth
  const [miniAppAuthFailed, setMiniAppAuthFailed] = useState(false) // NEW: Track if auto-auth failed for Mini App
  const [fallbackToManual, setFallbackToManual] = useState(false) // NEW: Fallback to manual if SDK unavailable (e.g., Base App)
  const [isWorldMiniApp, setIsWorldMiniApp] = useState(false) // NEW
  const [worldAppVersionOk, setWorldAppVersionOk] = useState(true) // NEW: Track if version supports walletAuth
  const { userData, loading, error } = useUserData(
    session,
    csrfToken,
    setIsAnalyzing,
    isWorldMiniApp,
  ) // MODIFIED: Pass isWorldMiniApp
  const [worldAuthLoading, setWorldAuthLoading] = useState(false) // NEW
  const [worldAuthFailed, setWorldAuthFailed] = useState(false) // NEW
  // NEW: Ref to prevent multi-attempt loop
  const attemptedAuthRef = useRef(false)
  const [isBaseApp, setIsBaseApp] = useState(false) // NEW: State for Base App detection (from ref)
  const [baseAuthFailed, setBaseAuthFailed] = useState(false) // NEW: Track if Base manual-auth failed (auto removed)
  // NEW: Farcaster signIn hook for manual deeplink trigger
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signIn: farcasterSignIn } = useSignIn()
  // NEW: Separate state for Warpcast detection (for relaxed guard)
  const [isWarpcastMobile, setIsWarpcastMobile] = useState(false)
  const [isMobile, setIsMobile] = useState(false) // NEW: State to detect mobile device (for hiding Farcaster button on PC)
  // FIXED: App domain from env (fix origin mismatch in preview)
  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN || window.location.hostname
  // Invite
  const [pendingInviteCode, setPendingInviteCode] = useState(null)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  useEffect(() => {
    console.log('Current pendingInviteCode:', pendingInviteCode)
  }, [pendingInviteCode])
  preconnect('https://auth.farcaster.xyz') // NEW: Preconnect to Quick Auth server for faster token retrieval (as per docs)
  const openModal = (content) => {
    setModalContent(content)
    setIsModalOpen(true)
    document.body.style.overflow = 'hidden'
  }
  const closeModal = () => {
    setIsModalOpen(false)
    setModalContent(null)
    document.body.style.overflow = 'auto'
  }
  const fetchProvidersWithRetry = useCallback(async (retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await getProviders()
        setProviders(response)
        return
      } catch (err) {
        safeError(`Attempt ${i + 1} failed to fetch providers: ${err.message}`)
        if (err.message.includes('IP banned') || err.status === 429) {
          toast.error('Too many requests. Please try again later.', { position: 'top-center' })
          return
        }
        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }
        toast.error('Failed to fetch sign-in methods.', { position: 'top-center' })
      }
    }
  }, [])
  useEffect(() => {
    setIsMounted(true)
    const tab = searchParams.get('tab')
    if (
      tab &&
      ['market', 'etf', 'ai', 'profile', 'graph', 'watchlists', 'cluster', 'explorer'].includes(tab)
    ) {
      // Added 'explorer' to valid tabs
      setActiveTab(tab)
    }
  }, [searchParams, router])
  useEffect(() => {
    if (status !== 'authenticated' || session?.csrfToken || csrfToken) return
    const fetchCsrfToken = async () => {
      try {
        const response = await fetch('/api/auth/csrf', {
          // Fix: relative path standard NextAuth
          method: 'GET',
          credentials: 'include', // Fix: To read/set cookie automatically
          // Remove Authorization: Bearer - NextAuth handles via cookie
        })
        const result = await response.json()
        if (response.ok) {
          setCsrfToken(result.csrfToken)
          await update({ csrfToken: result.csrfToken })
        } else {
          throw new Error(result.detail || 'Failed to fetch CSRF token')
        }
      } catch (err) {
        safeError('Error fetching CSRF token:', err)
        // Fallback for dev: Generate local token temporarily
        if (process.env.NODE_ENV === 'development') {
          const fallbackToken = crypto.randomBytes(32).toString('hex')
          setCsrfToken(fallbackToken)
          await update({ csrfToken: fallbackToken })
          toast.warn('Using dev fallback CSRF token', { position: 'top-center' })
        } else {
          toast.error(`Failed to fetch CSRF token: ${err.message}`, { position: 'top-center' })
        }
      }
    }
    fetchCsrfToken()
  }, [status, session, csrfToken, update])
  useEffect(() => {
    if (isMounted && !providers) {
      fetchProvidersWithRetry()
    }
  }, [isMounted, providers, fetchProvidersWithRetry])
  // FIXED: Improved Base App detection - Add ethereum.isCoinbaseWallet check + log UA for debug + FORCE via ?base=true for dev test
  // FIX FOR PC: Only apply isCoinbaseWallet if isMobile (prevent false positive on desktop with extension)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const userAgent = navigator.userAgent.toLowerCase()
    safeLog('Full UserAgent (debug):', navigator.userAgent) // NEW: Log full UA for testing
    const mobileDetected = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    ) // NEW: Mobile check to avoid PC extension false positive
    setIsMobile(mobileDetected) // NEW: Set isMobile state
    const isWarpcastDetected = userAgent.includes('warpcast') || userAgent.includes('farcaster') // FIXED: Rename and set state
    setIsWarpcastMobile(isWarpcastDetected) // NEW: Separate state for Warpcast
    const isBaseUADetected =
      userAgent.includes('coinbasewallet') ||
      userAgent.includes('cbwallet') ||
      userAgent.includes('base') ||
      userAgent.includes('coinbase') // Detect Base explicit + coinbase
    const isCoinbaseWallet = !!window.ethereum && window.ethereum.isCoinbaseWallet // NEW: Standard Web3 detection for Coinbase Wallet/Base App webview
    // NEW: Force detection for dev testing via ?base=true
    const forceBase = searchParams.get('base') === 'true'
    // FIXED: Only include isCoinbaseWallet if mobile (desktop extension -> false)
    const isBaseAppDetected = forceBase || isBaseUADetected || (isCoinbaseWallet && mobileDetected)
    setIsBaseApp(isBaseAppDetected) // UPDATED: Include ethereum check + force + mobile guard
    safeLog('Base App Detection Debug:', {
      userAgentSnippet: userAgent.substring(0, 100),
      isMobile: mobileDetected, // NEW: Log mobile flag
      isBaseUADetected,
      isCoinbaseWallet,
      forceBase, // NEW: Log force flag
      isBaseAppDetected,
    }) // NEW: Debug log
    const sdkAvailable = typeof sdk !== 'undefined' && !!sdk.quickAuth && !!sdk.actions.addMiniApp
    const miniAppDetected =
      (isSDKLoaded && (context === 'miniapp' || !!miniAppUser)) ||
      isWarpcastDetected ||
      sdkAvailable ||
      isBaseAppDetected
    setIsMiniApp(miniAppDetected)
    if (isBaseAppDetected) {
      setFallbackToManual(true)
    }
    safeLog('Mini App Detection Debug:', {
      isSDKLoaded,
      context,
      miniAppUser,
      userAgent,
      sdkAvailable,
      miniAppDetected,
      isWarpcast: isWarpcastDetected,
      isBaseApp: isBaseAppDetected,
    })
    if (miniAppDetected && miniAppUser) {
      safeLog('Mini App ready! User FID:', miniAppUser?.fid)
    }
    if (miniAppDetected && session) {
      if (typeof sdk !== 'undefined') sdk.actions.ready() // FIXED: Only call if SDK exists
    }
  }, [isSDKLoaded, context, miniAppUser, session, searchParams]) // ADD: searchParams to deps for force check
  // UPDATED: Adjust handleMiniAppQuickAuth - Remove skip for isBaseApp (allow manual trigger in Base), add fallback toast
  const handleMiniAppQuickAuth = useCallback(async () => {
    if (status !== 'unauthenticated') return // Keep guard for status
    setMiniAppAuthLoading(true)
    setMiniAppAuthFailed(false) // Reset failure state
    setBaseAuthFailed(false) // NEW: Reset Base failed for manual retry
    try {
      // Double-check SDK (available in Base App partial)
      if (
        typeof sdk === 'undefined' ||
        !sdk.quickAuth ||
        typeof sdk.quickAuth.getToken !== 'function'
      ) {
        throw new Error(
          'SDK getToken not available - Ensure running in Farcaster client (Warpcast/Base)',
        )
      }
      // Wrap getToken with explicit catch to suppress uncaught
      const getTokenPromise = sdk.quickAuth.getToken()
      const tokenResponse = await getTokenPromise.catch((err) => {
        safeError('SDK getToken internal rejection:', err)
        throw new Error(`QuickAuth SDK failed: ${err.message || 'Unknown error'}`)
      })
      if (!tokenResponse || !tokenResponse.token) {
        throw new Error('No token in response')
      }
      const { token } = tokenResponse
      safeLog('Mini App quickauth token preview:', token.substring(0, 50) + '...')
      const result = await signIn('farcaster', {
        redirect: false,
        token, // Pass token for Credentials (need to update options.js to handle token)
        callbackUrl: '/dashboard',
      })
      if (result?.error) {
        throw new Error(result.error || 'Auth failed')
      }
      setAuthSuccess(true) // NEW: Fix loop
      await update() // FIXED: Only update session, no push (let re-render handle)
      if (typeof sdk !== 'undefined') sdk.actions.ready() // FIXED: Hide splash if available
      toast.success('Login successful via Farcaster!', { position: 'top-center' }) // NEW: Success toast for manual
    } catch (err) {
      safeError('Mini App quickauth fail:', err)
      const errorMsg = err.message || err.toString()
      if (
        errorMsg.includes('SDK') ||
        errorMsg.includes('origins') ||
        errorMsg.includes('result') ||
        errorMsg.includes('not available')
      ) {
        // Fallback for origin/partial SDK (e.g., Base preview or no Warpcast)
        toast.error('Warpcast app is required for verification. Please install and try again.', {
          position: 'top-center',
        })
        setFallbackToManual(true)
        setMiniAppAuthFailed(false)
        if (isBaseApp) {
          // FIXED: Only set for Base App, not PC (prevent hiding form)
          setBaseAuthFailed(true) // NEW: Trigger retry UI only for Base
        }
      } else {
        toast.error(`QuickAuth error: ${errorMsg}`)
        setMiniAppAuthFailed(true) // Only fail if not SDK issue
        if (isBaseApp) setBaseAuthFailed(true) // FIXED: Conditional for Base
      }
    } finally {
      setMiniAppAuthLoading(false)
    }
  }, [status, signIn, update, isBaseApp]) // ADD: isBaseApp to deps
  // FIXED: Relax guard for Warpcast: If isWarpcastMobile, skip Neynar context/user check to enable auto quickAuth
  useEffect(() => {
    if (
      !isMiniApp ||
      status !== 'unauthenticated' ||
      session ||
      miniAppAuthLoading ||
      attemptedAuthRef.current ||
      (!isWarpcastMobile && context !== 'miniapp' && !miniAppUser)
    ) {
      return
    }
    attemptedAuthRef.current = true // One-time
    handleMiniAppQuickAuth()
  }, [
    isMiniApp,
    status,
    session,
    miniAppAuthLoading,
    handleMiniAppQuickAuth,
    context,
    miniAppUser,
    isWarpcastMobile,
  ]) // ADD: isWarpcastMobile to deps
  // NEW: Detect World Mini App
  useEffect(() => {
    let worldDetected = false
    try {
      worldDetected = MiniKit.isInstalled()
    } catch (err) {
      safeWarn('World Mini App detection error:', err)
    }
    setIsWorldMiniApp(worldDetected)
    safeLog('World Mini App Detection:', { worldDetected })
  }, [])
  // FIXED: Wrap handleWorldQuickAuth with useCallback and add to deps
  const handleWorldQuickAuth = useCallback(async () => {
    if (status !== 'unauthenticated') return
    setWorldAuthLoading(true)
    setWorldAuthFailed(false)
    setWorldAppVersionOk(true) // Reset version check
    try {
      // FIXED: Check installed and manual install if needed
      if (!MiniKit.isInstalled()) {
        throw new Error('World App not detected. Please open in World App.')
      }
      // NEW: Manual install if error suggests (docs 2025: Optional but fix unavailable)
      // await MiniKit.install(); // Comment out if causing error, as per docs it may be auto
      // Assume init is handled by provider
      const res = await fetch('/api/nonce')
      if (!res.ok) throw new Error('Failed to get nonce')
      const { nonce } = await res.json()
      if (!nonce) throw new Error('No nonce from server')
      // FIXED: Add full params per docs (expirationTime, statement for standard SIWE)
      const { commandPayload, finalPayload } = await MiniKit.commandsAsync.walletAuth({
        nonce,
        requestId: '0x' + Math.random().toString(16).substr(2, 8), // Random requestId
        expirationTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        notBefore: new Date(Date.now() - 24 * 60 * 60 * 1000), // Allow 1 day back
        statement: 'Sign in to XynapseAI with your World wallet.', // Custom statement
      })
      safeLog('WalletAuth response:', { commandPayload, finalPayload }) // NEW: Debug log
      // FIXED: Handle error status (unavailable → specific message)
      if (finalPayload.status === 'error') {
        // Check for version-related errors (docs imply 'unavailable' for old versions)
        if (
          finalPayload.error?.includes('unavailable') ||
          finalPayload.error?.includes('install')
        ) {
          setWorldAppVersionOk(false)
          throw new Error('Wallet Auth unavailable. Please update World App to v2.8.79+ and retry.')
        }
        throw new Error(finalPayload.error || 'Wallet auth failed')
      }
      const { message, signature } = finalPayload
      // NEW: Call complete-siwe to verify server-side before NextAuth
      const verifyRes = await fetch('/api/complete-siwe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: finalPayload, nonce }),
      })
      const verifyData = await verifyRes.json()
      if (!verifyRes.ok || !verifyData.isValid) {
        throw new Error(verifyData.message || 'SIWE verification failed')
      }
      // If verify OK, proceed NextAuth
      const result = await signIn('world', {
        redirect: false,
        message,
        signature,
        callbackUrl: '/dashboard',
      })
      if (result?.error) {
        throw new Error(result.error || 'Auth failed')
      }
      setAuthSuccess(true)
      await update() // FIXED: Only update, no push
    } catch (err) {
      safeError('World quickauth fail:', err)
      toast.error(`World Auth error: ${err.message}`)
      setWorldAuthFailed(true)
    } finally {
      setWorldAuthLoading(false)
    }
  }, [status, signIn, update]) // deps: status (used inside), signIn/update (stable from hooks)
  const handleAddMiniApp = async () => {
    if (typeof sdk === 'undefined' || !sdk.actions || !sdk.actions.addMiniApp) {
      toast.error(
        'Function not available in this environment. Please ensure you are in Base App or Warpcast.',
      )
      return
    }
    try {
      const response = await sdk.actions.addMiniApp()
      if (response?.notificationDetails) {
        safeLog('Notification details:', response.notificationDetails)
      }
    } catch (error) {
      safeError('Error adding Mini App:', error)
      toast.error(
        'Error adding Mini App: ' +
          (error?.message || 'Please check your webhook setup in manifest.'),
      )
    }
  }
  // FIXED: Similarly, add status guard for World auto-auth. Add handleWorldQuickAuth to deps.
  useEffect(() => {
    if (isWorldMiniApp && status === 'unauthenticated' && !session && !worldAuthLoading) {
      handleWorldQuickAuth()
    }
  }, [isWorldMiniApp, status, session, worldAuthLoading, handleWorldQuickAuth]) // ADD: handleWorldQuickAuth
  // NEW: Optional check for MiniKit ready (docs don't require, but safe for mobile)
  useEffect(() => {
    if (isWorldMiniApp) {
      safeLog('World Mini App detected. Checking readiness...')
      const checkReady = setInterval(() => {
        if (window.MiniKit?.ready) {
          safeLog('MiniKit ready')
          clearInterval(checkReady)
        }
      }, 500)
      return () => clearInterval(checkReady)
    }
  }, [isWorldMiniApp])
  // NEW: Prompt to add Mini App on first login in Mini App/Base/Warpcast
  useEffect(() => {
    if (
      status === 'authenticated' &&
      (isBaseApp || isWarpcastMobile) &&
      typeof sdk !== 'undefined' &&
      sdk.actions?.addMiniApp
    ) {
      handleAddMiniApp()
    }
  }, [status, isBaseApp, isWarpcastMobile])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const invite = params.get('invite')

    if (invite && pendingInviteCode !== invite) {
      setPendingInviteCode(invite)
      console.log('✅ Invite code detected and saved:', invite)
      safeLog('Detected invite code from URL:', invite)

      // Clean URL
      const cleanUrl = window.location.pathname + window.location.hash
      window.history.replaceState({}, '', cleanUrl)
    }
  }, [])

  // useEffect(() => {
  // if (activeTab === 'etf' && router) {
  // router.replace('/etf');
  // }
  // }, [activeTab, router]);
  // REMOVED: Auto-login for Base App via Farcaster deeplink - Now only manual via button click (per request: show DeeplinkButton first, click to trigger)
  // Keep handleBaseManualAuth for manual trigger if needed (but currently use direct SignInButton onSuccess/onError)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleBaseManualAuth = useCallback(() => {
    // No longer needed as SignInButton handles direct
  }, [])
  const handleConnectWallet = async () => {
    try {
      if (!session?.user || !recaptchaRef.current) throw new Error('Prerequisites not met')
      if (!walletConnected || !walletAddress) throw new Error('Wallet not connected')
      const recaptchaToken = await recaptchaRef.current.executeAsync()
      const message = `Verify wallet for UID: ${session.user.id} - Address: ${walletAddress}`
      const signature = await signMessageAsync({ message })
      const jwtToken = session?.accessToken
      const payload = { walletAddress: walletAddress, signature, message, uid: session.user.id }
      const sortedPayload = JSON.stringify(payload, Object.keys(payload).sort())
      const hmacSignature = await hmacSha256(
        process.env.HMAC_SECRET || 'default-secret',
        sortedPayload,
      )
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
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Wallet verification failed')
      toast.success('Wallet connected successfully!', { position: 'top-center' })
    } catch (err) {
      safeError('Error verifying wallet:', err)
      toast.error(`Wallet verification error: ${err.message}`, { position: 'top-center' })
    } finally {
      if (recaptchaRef.current) recaptchaRef.current.reset()
    }
  }
  const handleSignOut = async () => {
    if (!session || !session.user?.id) {
      toast.error('Session expired. Please sign in again.', { position: 'top-center' })
      router.push('/dashboard')
      return
    }
    try {
      if (typeof window !== 'undefined') {
        // Clear IndexedDB
        await clearAllCaches(session.user.id)
      }
      await signOut({ redirect: false })
      try {
        const currentCsrfToken = csrfToken || session.csrfToken
        if (currentCsrfToken) {
          await fetch(`${API_BASE_URL}/api/clear-cache`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': currentCsrfToken,
            },
            body: JSON.stringify({ cacheKeys: [`user:${session.user.id}`] }),
            credentials: 'include',
          })
        }
      } catch (cacheErr) {
        console.warn('Failed to clear server cache (non-critical):', cacheErr)
      }
      localStorage.removeItem('csrfToken')
      setCsrfToken(null)
      setAuthSuccess(false)
      attemptedAuthRef.current = false
      setFallbackToManual(false)
      setBaseAuthFailed(false)
      if (walletConnected) disconnect()
      router.refresh()
      router.push('/dashboard')
    } catch (error) {
      console.error('Error during sign out:', error)
      toast.error(`Failed to sign out: ${error.message}`, { position: 'top-center' })
      router.refresh()
      router.push('/dashboard')
    }
  }
  // FIXED: Merge old handleFarcasterSuccess with new (add authSuccess + shallow push). REMOVED: csrfToken (let NextAuth add automatically to avoid duplicate/mismatch)
  const handleFarcasterSuccess = async (result) => {
    try {
      const callbackUrl = pendingInviteCode
        ? `/dashboard?invite=${pendingInviteCode}`
        : '/dashboard'
      const res = await signIn('farcaster', {
        message: result.message,
        signature: result.signature,
        callbackUrl,
        redirect: false,
      })
      if (res?.error) {
        toast.error(`Farcaster login failed: ${res.error}`)
      } else {
        setAuthSuccess(true) // NEW: Fix loop - hide form immediately
        await update() // FIXED: Only update, no push/refresh (let session handle re-render)
      }
    } catch (err) {
      safeError('Farcaster sign-in error:', err)
      toast.error(`Sign-in error: ${err.message}`)
    }
  }
  const handleNavigateToToken = useCallback(
    (slug) => {
      if (!slug) {
        toast.error('Invalid token ID.', { position: 'top-center' })
        return
      }
      router.push(`/dashboard?tab=market&token=${slug}`, { scroll: false })
      setActiveTab('market')
    },
    [router],
  )
  const handleEmailSignIn = async (e) => {
    e.preventDefault()

    if (sendingEmail || emailSent) return

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      toast.error('Please enter a valid email address.', { position: 'top-center' })
      return
    }

    setSendingEmail(true)

    try {
      const callbackUrl = pendingInviteCode
        ? `/dashboard?invite=${pendingInviteCode}`
        : '/dashboard'

      const result = await signIn('email', {
        email: trimmedEmail,
        callbackUrl,
        redirect: false,
      })

      if (result?.ok) {
        setEmailSent(true)
      } else {
        toast.error(result?.error || 'Failed to send login email.', { position: 'top-center' })
      }
    } catch (err) {
      safeError('Error signing in with email:', err)
      toast.error('Failed to sign in with email.', { position: 'top-center' })
    } finally {
      setSendingEmail(false)
    }
  }
  const handleGoogleSignIn = async () => {
    try {
      const callbackUrl = pendingInviteCode
        ? `/dashboard?invite=${pendingInviteCode}`
        : '/dashboard'
      const result = await signIn('google', { callbackUrl, redirect: false })
      if (result?.error) {
        if (result.error.includes('Rate limit exceeded')) {
          toast.error('Too many sign-in attempts. Please try again later.', {
            position: 'top-center',
          })
          return
        }
        // Custom error handling for email-registered account
        if (result.error.includes('This account is registered with email')) {
          toast.error(result.error, { position: 'top-center' })
          return
        }
        throw new Error(result.error)
      }
      if (!result?.url) {
        safeWarn('No redirect URL provided by NextAuth, falling back to manual redirect')
        window.location.href = `${API_BASE_URL}/api/auth/signin/google`
        return
      }
      window.location.href = result.url
      // No success toast for Google (redirects immediately)
    } catch (err) {
      safeError('Error signing in with Google:', err)
      toast.error(`Failed to sign in with Google: ${err.message}`, { position: 'top-center' })
    }
  }
  // FIXED: Loading state: Add authSuccess to hide form immediately after signIn. REMOVED: baseAuthLoading since no auto
  // UPDATED: Force show Base UI even if !requiresAuth (to always show DeeplinkButton when opening in Base App)
  if (
    !isMounted ||
    !providers ||
    status === 'loading' ||
    (miniAppAuthLoading && !fallbackToManual) ||
    worldAuthLoading
  ) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
        <LoadingOverlay
          isLoading={true}
          message={
            isWorldMiniApp
              ? 'Authenticating with World...'
              : isMiniApp
                ? 'Authenticating with Farcaster...'
                : 'Loading dashboard...'
          }
          isMobile={typeof window !== 'undefined' && window.innerWidth <= 640}
        />
      </div>
    )
  }
  // FIXED: Revert requiresAuth from old file (only show form for specific tabs on non-Base)
  const requiresAuth = ['profile', 'ai', 'watchlists'].includes(activeTab)
  // FIXED: Integrate requiresAuth into showLoginForm (like old), but OR for Base App force
  const showLoginForm =
    (status === 'unauthenticated' &&
      requiresAuth &&
      !authSuccess &&
      !miniAppAuthFailed &&
      !worldAuthFailed &&
      !baseAuthFailed &&
      !(isMiniApp && miniAppAuthFailed && !fallbackToManual)) ||
    (isBaseApp && status === 'unauthenticated' && !authSuccess)
  return (
    <CurrencyProvider>
      {isBaseApp && <SafeArea />}
      <AuthKitProvider
        config={{
          domain: appDomain,
          siweUri: `${window.location.origin}/api/auth/signin/farcaster`,
          relay: 'https://relay.farcaster.xyz',
          rpcUrl: 'https://mainnet.optimism.io',
          version: '1',
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
              className="w-full h-full flex items-center justify-center" // FIXED: Solid black bg to prevent white flash
            >
              {isMiniApp && miniAppAuthFailed && !fallbackToManual ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="w-full h-full p-4 md:p-0 flex items-center justify-center text-white font-satoshi relative"
                >
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
                      Authentication Failed
                    </motion.h1>
                    <motion.p
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.3 }}
                      className="text-[11px] md:text-xs text-gray-500 mb-6 text-center leading-relaxed"
                    >
                      QuickAuth failed. Please try again or contact support.
                    </motion.p>
                    <button
                      onClick={handleMiniAppQuickAuth}
                      className="w-full px-4 py-2.5 border-2 border-white/15 bg-white/10 text-white rounded-2xl text-sm font-semibold transition-all duration-300 hover:border-white/30 hover:bg-white/20 flex items-center justify-center"
                    >
                      <MatrixHoverEffect text="Retry Authentication" hoverColor="#FFFFFF" />
                    </button>
                  </motion.div>
                </motion.div>
              ) : isWorldMiniApp && worldAuthFailed ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="w-full h-full p-4 md:p-0 flex items-center justify-center text-white font-satoshi relative"
                >
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
                      Authentication Failed
                    </motion.h1>
                    <motion.p
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.3 }}
                      className="text-[11px] md:text-xs text-gray-500 mb-6 text-center leading-relaxed"
                    >
                      {worldAppVersionOk
                        ? 'World Auth failed. Please try again or contact support.'
                        : 'Please update World App to v2.8.79 or higher.'}
                    </motion.p>
                    <button
                      onClick={handleWorldQuickAuth}
                      className="w-full px-4 py-2.5 border-2 border-white/15 bg-white/10 text-white rounded-2xl text-sm font-semibold transition-all duration-300 hover:border-white/30 hover:bg-white/20 flex items-center justify-center"
                    >
                      <MatrixHoverEffect text="Retry Authentication" hoverColor="#FFFFFF" />
                    </button>
                  </motion.div>
                </motion.div>
              ) : isBaseApp && baseAuthFailed ? (
                // UPDATED: Failed state for Base App manual-auth (show DeeplinkButton again)
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="w-full h-full p-4 md:p-0 flex items-center justify-center text-white font-satoshi relative"
                >
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
                      Authentication Failed
                    </motion.h1>
                    <motion.p
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.3 }}
                      className="text-[11px] md:text-xs text-gray-500 mb-6 text-center leading-relaxed"
                    >
                      Base App Farcaster deeplink failed. Please try again.
                    </motion.p>
                    <button
                      onClick={handleMiniAppQuickAuth} // UPDATED: Same handler for retry
                      className="w-full px-4 py-2.5 border-2 border-white/15 bg-white/10 text-white rounded-2xl text-sm font-semibold transition-all duration-300 hover:border-white/30 hover:bg-white/20 flex items-center justify-center"
                    >
                      <MatrixHoverEffect text="Retry Login" hoverColor="#FFFFFF" />
                    </button>
                  </motion.div>
                </motion.div>
              ) : showLoginForm ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="w-full h-full p-4 md:p-0 flex items-center justify-center text-white font-satoshi relative"
                >
                  {isBaseApp ? (
                    // UPDATED: Special frame for Base App - Custom button calls handleMiniAppQuickAuth (trigger deeplink like old auto, but manual)
                    // Force show this UI when unauthenticated in Base App
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
                        Sign In/Sign Up
                      </motion.h1>
                      <motion.p
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                        className="text-[11px] md:text-xs text-gray-500 mb-6 text-center leading-relaxed"
                      >
                        Click the button below to start a secure login via Farcaster deeplink in the
                        Base App.
                      </motion.p>
                      <button
                        onClick={handleMiniAppQuickAuth} // UPDATED: Call SDK quickAuth → Deeplink to Warpcast like old auto
                        disabled={miniAppAuthLoading || worldAuthLoading} // NEW: Disable during loading
                        className="w-full px-4 py-2.5 border border-white/80 bg-transparent text-white/80 rounded-sm text-sm font-semibold transition-all duration-300 hover:border-white/30 hover:bg-white/20 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {miniAppAuthLoading ? (
                          <BlinkingDots />
                        ) : (
                          <>
                            <Image
                              src="/logos/base.webp"
                              alt="Base Logo"
                              width={20}
                              height={20}
                              className="w-6 h-6 rounded-sm object-contain mr-2"
                            />
                            Login With Base App
                          </>
                        )}
                      </button>
                      <motion.p
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.5 }}
                        className="mt-4 text-[11px] text-gray-500 text-center leading-relaxed"
                      >
                        By clicking continue, you agree to the{' '}
                        <button
                          onClick={() => openModal('terms')}
                          className="text-white hover:underline"
                        >
                          Terms of Service
                        </button>{' '}
                        and{' '}
                        <button
                          onClick={() => openModal('privacy')}
                          className="text-white hover:underline"
                        >
                          Privacy Policy
                        </button>
                        .
                      </motion.p>
                    </motion.div>
                  ) : (
                    // Original full login form for non-Base environments
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
                      {!isWorldMiniApp && ( // FIXED: Show Email if not World (support Base/PC)
                        <>
                          <form onSubmit={handleEmailSignIn} className="w-full space-y-4">
                            <input
                              type="email"
                              value={email}
                              onChange={(e) => !emailSent && setEmail(e.target.value)}
                              placeholder="Enter your email"
                              className="w-full px-4 py-2.5 bg-black/60 border border-white/15 rounded-lg text-gray-500 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all duration-300"
                              required
                              disabled={sendingEmail || emailSent}
                            />
                            <button
                              type="submit"
                              disabled={sendingEmail || emailSent}
                              className="w-full px-4 py-2.5 bg-white/90 text-black rounded-lg text-sm font-semibold transition-all duration-300 hover:bg-white/70 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center"
                            >
                              {sendingEmail ? (
                                <>Sending…</>
                              ) : emailSent ? (
                                <>Sent</>
                              ) : (
                                <MatrixHoverEffect text="Sign in with Email" hoverColor="#FFFFFF" />
                              )}
                            </button>

                            {emailSent && (
                              <p className="text-center text-[10px] text-emerald-400/80 mt-2">
                                Please check your inbox and spam folder!
                              </p>
                            )}
                          </form>
                          <div className="flex items-center justify-center my-4 w-full">
                            <span className="text-gray-500 text-xs uppercase px-4">OR</span>
                            <div className="flex-1 h-px bg-white/10"></div>
                          </div>
                        </>
                      )}
                      {providers?.google &&
                        !isWorldMiniApp && ( // FIXED: Show Google if not World
                          <button
                            onClick={handleGoogleSignIn}
                            className="m-4 w-full px-4 py-2.5 bg-black/20 border border-white/25 rounded-lg text-white text-sm font-semibold flex items-center justify-center gap-3 transition-all duration-300 hover:bg-gray-800/30 hover:border-white/40"
                          >
                            <Image
                              src="/logos/google.webp"
                              alt="Google Logo"
                              width={20}
                              height={20}
                              className="w-5 h-5 object-contain"
                            />
                            <MatrixHoverEffect text="Sign in with Google" />
                          </button>
                        )}
                      {/* FIXED: Always show SignInButton for Farcaster if not World (support deeplink in Base/PC, fallback if !isMiniApp) */}
                      {!isWorldMiniApp && (isWarpcastMobile || (isBaseApp && fallbackToManual)) && (
                        <SignInButton
                          onSuccess={handleFarcasterSuccess}
                          onError={(error) => {
                            safeError('AuthKit error:', error)
                            toast.error(`Farcaster error: ${error.message}`)
                          }}
                          className="!w-full !px-4 !m-2 !py-2.5 !bg-black/20 !border !border-white/25 !rounded-2xl !text-white !text-sm !font-semibold !flex !items-center !justify-center !gap-3 !transition-all !duration-300 hover:!bg-gray-800/30 hover:!border-white/40 !bg-purple-600 hover:!bg-purple-700"
                          style={{
                            display: 'flex !important',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(0,0,0,0.2) !important',
                            border: '1px solid rgba(255,255,255,0.25) !important',
                            color: 'white !important',
                            borderRadius: '1rem !important',
                            transition: 'all 0.3s !important',
                          }}
                          buttonText="Sign in with Farcaster"
                          showLogo={true}
                        >
                          <Image
                            src="/logos/farcaster-logo.webp"
                            alt="Farcaster Logo"
                            width={20}
                            height={20}
                            className="w-6 h-6 rounded-xl object-contain mr-2"
                          />
                          Sign in with Farcaster
                        </SignInButton>
                      )}
                      {isWorldMiniApp && (
                        <button
                          onClick={handleWorldQuickAuth}
                          className="w-full px-4 m-2 py-2.5 bg-black/20 border border-white/25 rounded-2xl text-white text-sm font-semibold flex items-center justify-center gap-3 transition-all duration-300 hover:bg-gray-800/30 hover:border-white/40"
                        >
                          <Image
                            src="/logos/worldcoin-logo.png"
                            alt="World Logo"
                            width={20}
                            height={20}
                          />
                          <MatrixHoverEffect text="Sign in with World" />
                        </button>
                      )}
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
                        <button
                          onClick={() => openModal('terms')}
                          className="text-white hover:underline"
                        >
                          Terms of Service
                        </button>{' '}
                        and{' '}
                        <button
                          onClick={() => openModal('privacy')}
                          className="text-white hover:underline"
                        >
                          Privacy Policy
                        </button>
                        .
                      </motion.p>
                    </motion.div>
                  )}
                </motion.div>
              ) : (
                <>
                  {requiresAuth && status === 'unauthenticated' ? (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-8 text-center text-gray-400 max-w-md"
                    >
                      <h2 className="text-xl font-bold mb-4">Login Required</h2>
                      <p>
                        Sign in to access {activeTab} features. Xynapse offers advanced blockchain
                        analytics for crypto enthusiasts.
                      </p>
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
                      {activeTab === 'etf' && <EtfTab />}
                      {activeTab === 'cluster' && (
                        <ClusterTab
                          recaptchaRef={recaptchaRef}
                          initialClusterId={searchParams.get('clusterId') || 'binance'} // Fixed from initialExchangeId
                        />
                      )}
                      {activeTab === 'graph' && (
                        <TreemapTab onTokenSelect={handleNavigateToToken} />
                      )}
                      {activeTab === 'ai' && <AITab recaptchaRef={recaptchaRef} />}
                      {activeTab === 'explorer' && (
                        <ExplorerTab
                          initialQuery={searchParams.get('query')}
                          initialChain={searchParams.get('chain')}
                        />
                      )}
                      {activeTab === 'dex' && <DexTab />}
                      {activeTab === 'profile' && (
                        <ProfileTab
                          userData={userData}
                          loading={loading}
                          error={error}
                          isConnected={walletConnected}
                          handleConnectWallet={handleConnectWallet}
                          recaptchaRef={recaptchaRef}
                          handleSignOut={handleSignOut}
                        />
                      )}
                      {activeTab === 'watchlists' && (
                        <WatchlistsTab
                          toast={toast}
                          initialAddress={searchParams.get('address') || undefined}
                        />
                      )}
                    </>
                  )}
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
                toast.error('Failed please refresh the App', { position: 'top-center' })
              }}
            />
          ) : (
            <p className="text-[8px] text-red-600 ml-2">
              Error: reCAPTCHA site key is missing. Please configure NEXT_PUBLIC_RECAPTCHA_SITE_KEY.
            </p>
          )}
          <p className="text-[8px] text-gray-600 ml-2">
            Protected by reCAPTCHA. See{' '}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neon-blue"
            >
              Privacy Policy
            </a>{' '}
            &{' '}
            <a
              href="https://policies.google.com/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neon-blue"
            >
              Terms
            </a>{' '}
            of Google.
          </p>
          <ToastContainer
            position="top-center"
            autoClose={3000}
            hideProgressBar={false}
            newestOnTop={false}
            closeOnClick
            rtl={false}
            pauseOnFocusLoss
            draggable
            pauseOnHover
            theme="dark"
            limit={3}
            toastStyle={{
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '16px',
              color: '#FFF',
            }}
          />
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
                  {modalContent === 'privacy' ? (
                    <PrivacyPolicyContent />
                  ) : (
                    <TermsOfServiceContent />
                  )}
                </div>
              </div>
            </div>
          )}
          {/* REMOVED: Farcaster modal - now using SignInButton directly */}
        </div>
      </AuthKitProvider>
    </CurrencyProvider>
  )
}
export default function Dashboard() {
  return (
    <MiniAppProvider>
      <WorldMiniKitProvider>
        <DashboardInner />
      </WorldMiniKitProvider>
    </MiniAppProvider>
  )
}
