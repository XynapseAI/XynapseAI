'use client'
import { useState, useEffect, useRef, useCallback, useMemo, lazy } from 'react'
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
import crypto from 'crypto'
import { Canvas, useFrame } from '@react-three/fiber'
import { Stars, Sphere, Float, Environment } from '@react-three/drei'
import * as THREE from 'three'
import { TermsOfServiceContent } from '../../components/TermsOfService'
import { PrivacyPolicyContent } from '../../components/PrivacyPolicy'
import '@farcaster/auth-kit/styles.css'
import { AuthKitProvider, SignInButton } from '@farcaster/auth-kit'
import { sdk } from '@farcaster/miniapp-sdk'
import { useMiniApp, MiniAppProvider } from '@neynar/react'
import { MiniKit } from '@worldcoin/minikit-js'
import { MiniKitProvider as WorldMiniKitProvider } from '@worldcoin/minikit-js/minikit-provider'
import { preconnect } from 'react-dom'
import { SafeArea } from '@coinbase/onchainkit/minikit'
import { clearAllCaches } from '../../utils/indexedDB'
import { createSiweMessage } from 'viem/siwe'

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
  const [userData, setUserData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const recaptchaRef = useRef(null)

  const fetchUserData = useCallback(async () => {
    if (!session || !session?.user?.id || !csrfToken) {
      setLoading(false)
      setUserData(null)
      setError(null)
      return
    }
    setLoading(true)
    try {
      let recaptchaToken = null
      if (!isWorldMiniApp) {
        recaptchaToken = await recaptchaRef.current?.executeAsync()
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
            ...(recaptchaToken && { 'X-Recaptcha-Token': recaptchaToken }),
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
      setError(null)
    } catch (err) {
      safeError('Error fetching user data:', err)
      setError(`Failed to fetch user data: ${err.message}`)
      toast.error(`Error: ${err.message}`, { position: 'top-center' })
    } finally {
      setLoading(false)
      if (recaptchaRef.current && !isWorldMiniApp) {
        recaptchaRef.current.reset()
      }
    }
  }, [session, csrfToken, isWorldMiniApp])

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

function DashboardInner() {
  useEffect(() => {
    const handleUnhandledRejection = (event) => {
      if (
        event.reason?.message?.includes('result') ||
        event.reason?.message?.includes("origins don't match")
      ) {
        safeError('Suppressed SDK uncaught rejection:', event.reason)
        event.preventDefault()
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
  const [activeTab, setActiveTab] = useState('market')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [providers, setProviders] = useState(null)
  const [email, setEmail] = useState('')
  const [csrfToken, setCsrfToken] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalContent, setModalContent] = useState(null)
  const [authSuccess, setAuthSuccess] = useState(false)
  const recaptchaRef = useRef(null)

  const { isSDKLoaded, context, user: miniAppUser } = useMiniApp()
  const [isMiniApp, setIsMiniApp] = useState(false)
  const [miniAppAuthLoading, setMiniAppAuthLoading] = useState(false)
  const [miniAppAuthFailed, setMiniAppAuthFailed] = useState(false)
  const [isWorldMiniApp, setIsWorldMiniApp] = useState(false)
  const [worldAppVersionOk, setWorldAppVersionOk] = useState(true)
  const { userData, loading, error } = useUserData(
    session,
    csrfToken,
    setIsAnalyzing,
    isWorldMiniApp,
  )
  const [worldAuthLoading, setWorldAuthLoading] = useState(false)
  const [worldAuthFailed, setWorldAuthFailed] = useState(false)
  const attemptedAuthRef = useRef(false)
  const [isBaseApp, setIsBaseApp] = useState(false)
  const [baseAuthFailed, setBaseAuthFailed] = useState(false)
  const [isWarpcastMobile, setIsWarpcastMobile] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN || (typeof window !== 'undefined' ? window.location.hostname : '')
  const [pendingInviteCode, setPendingInviteCode] = useState(null)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  useEffect(() => {
    console.log('Current pendingInviteCode:', pendingInviteCode)
  }, [pendingInviteCode])

  preconnect('https://auth.farcaster.xyz')

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
      setActiveTab(tab)
    }
  }, [searchParams, router])

  useEffect(() => {
    if (status !== 'authenticated' || session?.csrfToken || csrfToken) return
    const fetchCsrfToken = async () => {
      try {
        const response = await fetch('/api/auth/csrf', {
          method: 'GET',
          credentials: 'include',
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

  useEffect(() => {
    if (typeof window === 'undefined') return
    const userAgent = navigator.userAgent.toLowerCase()
    safeLog('Full UserAgent (debug):', navigator.userAgent)
    const mobileDetected = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    )
    setIsMobile(mobileDetected)
    const isWarpcastDetected = userAgent.includes('warpcast') || userAgent.includes('farcaster')
    setIsWarpcastMobile(isWarpcastDetected)
    const isBaseUADetected =
      userAgent.includes('coinbasewallet') ||
      userAgent.includes('cbwallet') ||
      userAgent.includes('base') ||
      userAgent.includes('coinbase')
    const isCoinbaseWallet = !!window.ethereum && window.ethereum.isCoinbaseWallet
    const forceBase = searchParams.get('base') === 'true'
    const isBaseAppDetected = forceBase || isBaseUADetected || (isCoinbaseWallet && mobileDetected)
    setIsBaseApp(isBaseAppDetected)
    safeLog('Base App Detection Debug:', {
      userAgentSnippet: userAgent.substring(0, 100),
      isMobile: mobileDetected,
      isBaseUADetected,
      isCoinbaseWallet,
      forceBase,
      isBaseAppDetected,
    })
    const sdkAvailable = typeof sdk !== 'undefined' && !!sdk.quickAuth && !!sdk.actions?.addMiniApp
    const miniAppDetected =
      (isSDKLoaded && (context === 'miniapp' || !!miniAppUser)) ||
      isWarpcastDetected ||
      sdkAvailable ||
      isBaseAppDetected
    setIsMiniApp(miniAppDetected)
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
    if (miniAppDetected && session) {
      if (typeof sdk !== 'undefined') sdk.actions.ready?.()
    }
  }, [isSDKLoaded, context, miniAppUser, session, searchParams])

  // ====================== BASE APP SIWE AUTH (Base App 9/4/2026) ======================
  const handleBaseSIWEAuth = useCallback(async () => {
    if (status !== 'unauthenticated') return
    if (!walletConnected || !walletAddress) {
      toast.error('Wallet not connected. Open in Base Mini App / Coinbase Wallet and try again.', {
        position: 'top-center',
      })
      return
    }
    setMiniAppAuthLoading(true)
    setBaseAuthFailed(false)
    try {
      const nonceRes = await fetch('/api/nonce')
      if (!nonceRes.ok) throw new Error('Failed to get nonce')
      const { nonce } = await nonceRes.json()
      if (!nonce) throw new Error('No nonce from server')

      const message = createSiweMessage({
        domain: window.location.host,
        address: walletAddress,
        statement: 'Sign in to XynapseAI with your Base wallet',
        uri: window.location.origin,
        version: '1',
        chainId: 8453,
        nonce,
        expirationTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })

      const signature = await signMessageAsync({ message })

      const verifyRes = await fetch('/api/complete-siwe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { message, signature, address: walletAddress }, nonce }),
      })
      const verifyData = await verifyRes.json()
      if (!verifyRes.ok || !verifyData.isValid) {
        throw new Error(verifyData.message || 'SIWE verification failed')
      }

      const result = await signIn('siwe', {
        redirect: false,
        message,
        signature,
        address: walletAddress,
        callbackUrl: '/dashboard',
      })
      if (result?.error) throw new Error(result.error || 'Auth failed')

      setAuthSuccess(true)
      await update()
      toast.success('Login successful via Base App!', { position: 'top-center' })
    } catch (err) {
      safeError('Base SIWE auth fail:', err)
      toast.error(`Base App login error: ${err.message}`, { position: 'top-center' })
      setBaseAuthFailed(true)
    } finally {
      setMiniAppAuthLoading(false)
    }
  }, [status, walletConnected, walletAddress, signMessageAsync, update, signIn])

  // ====================== Farcaster QuickAuth (only for Warpcast) ======================
  const handleMiniAppQuickAuth = useCallback(async () => {
    if (isBaseApp) return
    if (status !== 'unauthenticated') return
    setMiniAppAuthLoading(true)
    setMiniAppAuthFailed(false)
    try {
      if (typeof sdk === 'undefined' || !sdk.quickAuth?.getToken) {
        throw new Error('SDK not available - ensure you are in Warpcast')
      }
      const tokenResponse = await sdk.quickAuth.getToken().catch((err) => {
        safeError('SDK getToken internal rejection:', err)
        throw new Error(`QuickAuth SDK failed: ${err.message || 'Unknown error'}`)
      })
      if (!tokenResponse?.token) throw new Error('No token in response')
      const result = await signIn('farcaster', {
        redirect: false,
        token: tokenResponse.token,
        callbackUrl: '/dashboard',
      })
      if (result?.error) throw new Error(result.error || 'Auth failed')
      setAuthSuccess(true)
      await update()
      if (typeof sdk !== 'undefined') sdk.actions.ready?.()
      toast.success('Login successful via Farcaster!', { position: 'top-center' })
    } catch (err) {
      safeError('Mini App quickauth fail:', err)
      const errorMsg = err.message || err.toString()
      if (errorMsg.includes('SDK') || errorMsg.includes('origins') || errorMsg.includes('result')) {
        toast.error('Warpcast app is required for verification. Please install and try again.', {
          position: 'top-center',
        })
        setMiniAppAuthFailed(true)
      } else {
        toast.error(`QuickAuth error: ${errorMsg}`)
        setMiniAppAuthFailed(true)
      }
    } finally {
      setMiniAppAuthLoading(false)
    }
  }, [status, signIn, update, isBaseApp])

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
    attemptedAuthRef.current = true
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
  ])

  // World Mini App
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

  const handleWorldQuickAuth = useCallback(async () => {
    if (status !== 'unauthenticated') return
    setWorldAuthLoading(true)
    setWorldAuthFailed(false)
    setWorldAppVersionOk(true)
    try {
      if (!MiniKit.isInstalled()) {
        throw new Error('World App not detected. Please open in World App.')
      }
      const res = await fetch('/api/nonce')
      if (!res.ok) throw new Error('Failed to get nonce')
      const { nonce } = await res.json()
      if (!nonce) throw new Error('No nonce from server')
      const { commandPayload, finalPayload } = await MiniKit.commandsAsync.walletAuth({
        nonce,
        requestId: '0x' + Math.random().toString(16).substr(2, 8),
        expirationTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        notBefore: new Date(Date.now() - 24 * 60 * 60 * 1000),
        statement: 'Sign in to XynapseAI with your World wallet.',
      })
      if (finalPayload.status === 'error') {
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
      const verifyRes = await fetch('/api/complete-siwe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: finalPayload, nonce }),
      })
      const verifyData = await verifyRes.json()
      if (!verifyRes.ok || !verifyData.isValid) {
        throw new Error(verifyData.message || 'SIWE verification failed')
      }
      const result = await signIn('world', {
        redirect: false,
        message,
        signature,
        callbackUrl: '/dashboard',
      })
      if (result?.error) throw new Error(result.error || 'Auth failed')
      setAuthSuccess(true)
      await update()
    } catch (err) {
      safeError('World quickauth fail:', err)
      toast.error(`World Auth error: ${err.message}`)
      setWorldAuthFailed(true)
    } finally {
      setWorldAuthLoading(false)
    }
  }, [status, signIn, update])

  useEffect(() => {
    if (isWorldMiniApp && status === 'unauthenticated' && !session && !worldAuthLoading) {
      handleWorldQuickAuth()
    }
  }, [isWorldMiniApp, status, session, worldAuthLoading, handleWorldQuickAuth])

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

  const handleAddMiniApp = async () => {
    if (typeof sdk === 'undefined' || !sdk.actions?.addMiniApp) return
    try {
      await sdk.actions.addMiniApp()
    } catch (error) {
      safeError('Error adding Mini App:', error)
    }
  }

  useEffect(() => {
    if (
      status === 'authenticated' &&
      isWarpcastMobile &&
      typeof sdk !== 'undefined' &&
      sdk.actions?.addMiniApp
    ) {
      handleAddMiniApp()
    }
  }, [status, isWarpcastMobile])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const invite = params.get('invite')
    if (invite && pendingInviteCode !== invite) {
      setPendingInviteCode(invite)
      console.log('✅ Invite code detected and saved:', invite)
      safeLog('Detected invite code from URL:', invite)
      const cleanUrl = window.location.pathname + window.location.hash
      window.history.replaceState({}, '', cleanUrl)
    }
  }, [pendingInviteCode])

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
        setAuthSuccess(true)
        await update()
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
    } catch (err) {
      safeError('Error signing in with Google:', err)
      toast.error(`Failed to sign in with Google: ${err.message}`, { position: 'top-center' })
    }
  }

  if (
    !isMounted ||
    !providers ||
    status === 'loading' ||
    (miniAppAuthLoading && !isBaseApp) ||
    worldAuthLoading
  ) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
        <LoadingOverlay
          isLoading={true}
          message={
            isWorldMiniApp
              ? 'Authenticating with World...'
              : isMiniApp && !isBaseApp
                ? 'Authenticating with Farcaster...'
                : 'Loading dashboard...'
          }
          isMobile={typeof window !== 'undefined' && window.innerWidth <= 640}
        />
      </div>
    )
  }

  const requiresAuth = ['profile', 'ai', 'watchlists'].includes(activeTab)
  const showLoginForm =
    (status === 'unauthenticated' &&
      requiresAuth &&
      !authSuccess &&
      !miniAppAuthFailed &&
      !worldAuthFailed &&
      !baseAuthFailed) ||
    (isBaseApp && status === 'unauthenticated' && !authSuccess)

  return (
    <CurrencyProvider>
      {isBaseApp && <SafeArea />}
      {!isBaseApp && (
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
                className="w-full h-full flex items-center justify-center"
              >
                {isMiniApp && miniAppAuthFailed && !isBaseApp ? (
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
                        Base App wallet sign-in failed. Please try again.
                      </motion.p>
                      <button
                        onClick={handleBaseSIWEAuth}
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
                          Sign In / Sign Up
                        </motion.h1>
                        <motion.p
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.5, delay: 0.3 }}
                          className="text-[11px] md:text-xs text-gray-500 mb-6 text-center leading-relaxed"
                        >
                          Click below to sign a secure message with your wallet in the Base App.
                        </motion.p>
                        <button
                          onClick={handleBaseSIWEAuth}
                          disabled={miniAppAuthLoading || worldAuthLoading}
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
                              Sign in with Base Wallet
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
                        {!isWorldMiniApp && (
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
                        {providers?.google && !isWorldMiniApp && (
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
                        {!isWorldMiniApp && isWarpcastMobile && (
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
                            initialClusterId={searchParams.get('clusterId') || 'binance'}
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
          </div>
        </AuthKitProvider>
      )}
      {isBaseApp && (
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
                      Sign In / Sign Up
                    </motion.h1>
                    <motion.p
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.3 }}
                      className="text-[11px] md:text-xs text-gray-500 mb-6 text-center leading-relaxed"
                    >
                      Click below to sign a secure message with your wallet in the Base App.
                    </motion.p>
                    <button
                      onClick={handleBaseSIWEAuth}
                      disabled={miniAppAuthLoading || worldAuthLoading}
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
                          Sign in with Base Wallet
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
                          initialClusterId={searchParams.get('clusterId') || 'binance'}
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
        </div>
      )}
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