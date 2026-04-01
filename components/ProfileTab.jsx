'use client'
import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import {
  Trophy,
  Award,
  Flame,
  User,
  Crown,
  Calendar,
  Info,
  Check,
  Coins,
  Shield,
  Users,
  Eye,
  EyeOff,
  RefreshCw,
  Copy,
  Wallet,
  HelpCircle,
  BadgeCheck,
  Biohazard,
  ShieldUser,
  BookType,
  Sparkles,
} from 'lucide-react' // Added HelpCircle icon
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from 'recharts'
import { ethers, parseEther } from 'ethers'
import { ToastContainer, toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { cacheData, getCachedData, clearCache, clearAllCaches } from '../utils/indexedDB'
import { LoadingOverlay } from '@/utils/helpers'
import { debounce } from 'lodash'
import LoginPrompt from './LoginPrompt'
import ReCAPTCHA from 'react-google-recaptcha'
import { logger } from '../utils/clientLogger'
import {
  ConnectWallet,
  Wallet as OnchainWalletWrapper, // Renamed to avoid conflict with lucide Wallet icon
} from '@coinbase/onchainkit/wallet'
import {
  useAccount,
  useDisconnect,
  useChainId,
  useWriteContract,
  useSwitchChain,
  useReadContract,
  useSendCalls,
} from 'wagmi'
import {
  Transaction,
  TransactionButton,
  TransactionStatus,
  TransactionStatusLabel,
  TransactionStatusAction,
} from '@coinbase/onchainkit/transaction'
import { encodeFunctionData } from 'viem'
import { Attribution } from 'ox/erc8021'
import InviteTaskCard from './InviteTaskCard'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api'
// Updated: Use faster Cloudflare IPFS gateway for baseURI to reduce loading time
const BASE_URI_GATEWAY = 'https://ipfs.io/ipfs/QmNoskhe6ES3e7X6huo6PJRuKhpGU5MuuZqhHAvavzaV5J/'
const CONTRACT_ADDRESS = '0x22EE9eE1a5986ff354d34ed19Eb28E65091C7648' // Deployed contract address
const BASE_CHAIN_ID = 8453 // Base Sepolia for testing; change to 8453 for mainnet if deployed there
// NEW: Builder Code for Base attribution (replace with your actual code from base.dev)
const builderCode = process.env.NEXT_PUBLIC_BUILDER_CODE || 'bc_kne07rwd'
const dataSuffix = Attribution.toDataSuffix({ codes: [builderCode] })

const CopyButton = ({ text, size = 12 }) => {
  const [isCopied, setIsCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      className="cursor-pointer hover:text-emerald-400 transition flex-shrink-0"
    >
      {isCopied ? <Check size={size} className="text-emerald-400" /> : <Copy size={size} />}
    </button>
  )
}

// Enhanced Spinner component - Accepts className and color props for flexibility
const Spinner = ({ className = 'h-4 w-4', color = 'text-blue-400' }) => (
  <svg
    className={`animate-spin ${className} ${color}`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    ></circle>
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    ></path>
  </svg>
)
// Blinking Dots component for loading states
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
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <motion.div
        className="bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#FFFFFF20] p-3 rounded-2xl text-[#FFF] text-sm font-medium shadow-2xl"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <p className="text-[#D4D4D4] text-xs mb-1">{label}</p>
        <p className="text-[#FFF] font-semibold">
          Points: <span className="text-emerald-400">{payload[0].value}</span>
        </p>
      </motion.div>
    )
  }
  return null
}
// Updated ABI: Added balanceOf for on-chain mint check, counter for preview ID
const NFT_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'tokenURI',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'counter',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
]
export default function ProfileTab({ recaptchaRef, handleSignOut }) {
  const { data: session, status } = useSession()
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.innerWidth <= 640,
  )
  const [activeTab, setActiveTab] = useState('profile')
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [followedTasks, setFollowedTasks] = useState(new Set())
  const [immediateLoading, setImmediateLoading] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const [showWallet, setShowWallet] = useState(false) // Add state for wallet display
  const [showV2Modal, setShowV2Modal] = useState(false)
  const [pendingTask, setPendingTask] = useState(null)
  const [currentPage, setCurrentPage] = useState({ leaderboard: 1 })
  // NEW: States for Badge tab mint flow
  const [showMintModal, setShowMintModal] = useState(false)
  const [mintStep, setMintStep] = useState('connectWallet') // 'connectWallet', 'connectTwitter', 'mintNFT'
  // NEW: Track completion of each step
  const [walletConnected, setWalletConnected] = useState(false)
  const [twitterConnected, setTwitterConnected] = useState(false)
  const [isUpdatingWallet, setIsUpdatingWallet] = useState(false)
  const [hasUpdatedWallet, setHasUpdatedWallet] = useState(false)
  const hasTriggeredRef = useRef(false)
  // NEW: Tooltip state for Genesis NFT
  const [showNftTooltip, setShowNftTooltip] = useState(false)
  const recaptchaV2Ref = useRef(null)
  const { address, isConnected, connector } = useAccount()
  const { disconnect } = useDisconnect() // For manual disconnect
  const { writeContractAsync } = useWriteContract()
  const switchChainMutation = useSwitchChain()
  const { sendCalls } = useSendCalls()
  const [nftImageSrc, setNftImageSrc] = useState('')
  const chainId = useChainId()
  const [walletAddressForQuery, setWalletAddressForQuery] = useState(null)
  const email = session?.user?.email || ''
  const isBaseAccount = email.includes('@base.xynapseai.net')
  const [followXCompleted, setFollowXCompleted] = useState(false)
  const [isMinting, setIsMinting] = useState(false)
  const [isClaimingGenesis, setIsClaimingGenesis] = useState(false)
  const [isConnectingTwitter, setIsConnectingTwitter] = useState(false)
  const [currentVerifyingTaskId, setCurrentVerifyingTaskId] = useState(null)
  const [tweetUrl, setTweetUrl] = useState('')
  const itemsPerPage = 20

  const handleTweetNow = () => {
    const suggestedText = `I'm excited about @xynapseai_ — innovative AI tools for the future! Check it out and join the community 🚀\n\nTag your friends! #xynapse`
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(suggestedText)}`
    window.open(url, '_blank')
  }

  // Updated: Use wagmi to read current counter for preview ID
  const { data: currentCounter } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: NFT_ABI,
    functionName: 'counter',
    chainId: BASE_CHAIN_ID,
  })
  // NEW: On-chain mint check via balanceOf
  const { data: nftBalance } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: NFT_ABI,
    functionName: 'balanceOf',
    args: [walletAddressForQuery || '0x0000000000000000000000000000000000000000'],
    chainId: BASE_CHAIN_ID,
  })
  const nftMinted = (nftBalance || 0n) > 0n
  // Updated: Fetch metadata for next token ID (preview) with timeout
  useEffect(() => {
    const fetchMetadata = async () => {
      if (!currentCounter) return // Wait for counter
      console.log('Current counter:', currentCounter) // Debug: Check ID
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout
        const previewId = currentCounter.toString()
        const metadataUrl = `${BASE_URI_GATEWAY}${previewId}.json`
        console.log('Fetching metadata URL:', metadataUrl) // Debug: Check URL
        const response = await fetch(metadataUrl, { signal: controller.signal })
        clearTimeout(timeoutId)
        if (!response.ok) throw new Error(`Failed to fetch metadata: ${response.status}`)
        const data = await response.json()
        console.log('Metadata fetched:', data) // Debug: Check JSON
        // Replace ipfs:// with reliable gateway
        const imageUrl = data.image.replace('ipfs://', 'https://ipfs.io/ipfs/')
        console.log('Image URL:', imageUrl) // Debug: Check image URL
        setNftImageSrc(imageUrl)
      } catch (err) {
        if (err.name === 'AbortError') {
          console.warn('Metadata fetch timed out after 10s')
        } else {
          console.error('Error fetching NFT metadata:', err)
        }
        setNftImageSrc('/placeholder_nft.png') // Fallback immediately
      }
    }
    if (currentCounter) {
      fetchMetadata()
    }
  }, [currentCounter])
  const {
    data: csrfToken,
    isLoading: csrfLoading,
    error: csrfError,
  } = useQuery({
    queryKey: ['csrfToken'],
    queryFn: async () => {
      const response = await axios.get('/api/csrf-token', { withCredentials: true })
      if (!response.data.csrfToken) throw new Error('Empty CSRF token received')
      return response.data.csrfToken
    },
    retry: 3,
    retryDelay: 2000,
    enabled: status === 'authenticated',
    onError: (err) => {
      if (process.env.NODE_ENV !== 'production') {
        logger.error('Error fetching CSRF token:', err)
      }
      // Removed toast to avoid duplicates
    },
  })
  const {
    data: userData,
    isLoading: userLoading,
    error: userError,
  } = useQuery({
    queryKey: ['userData', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `userData-${session.user.id}`
      const cached = await getCachedData(cacheKey)
      if (cached) {
        if (cached.twitterHandle && window.location.search.includes('twitterConnected=true')) {
          await clearCache(cacheKey)
          throw new Error('Cache invalidated due to Twitter connection')
        }
        if (cached.walletAddress && searchParams.get('walletConnected') === 'true') {
          await clearCache(cacheKey)
          throw new Error('Cache invalidated due to Wallet connection')
        }
        return cached
      }

      try {
        const response = await axios.get(`/api/user?uid=${encodeURIComponent(session.user.id)}`, {
          headers: {
            'x-csrf-token': csrfToken,
          },
          withCredentials: true,
        })
        if (!response.data.success)
          throw new Error(response.data.detail || 'Unable to fetch user data')

        const user = {
          ...response.data.user,
          isPremium: response.data.user.isPremium || false,
          tier: response.data.user.isPremium ? 'Premium' : response.data.user.tier || 'Basic',
          twitterHandle: response.data.user.twitterHandle || null,
          profilePicture: response.data.user.profilePicture || '',
          googleName: response.data.user.googleName || '',
          walletAddress: response.data.user.walletAddress || null,
          daysActive: response.data.user.daysActive || 0,
          streak: response.data.user.streak || 0,
          last7Days: response.data.user.last7Days || [],
          inviteCode: response.data.user.inviteCode ?? '',
          invited_by: response.data.user.invited_by || null,
        }

        await cacheData(cacheKey, user, 5 * 60 * 1000)

        return user
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          logger.error('Error fetching user data:', err.response?.data || err.message)
        }
        throw err
      }
    },
    enabled: status === 'authenticated' && !!session?.user?.id && !!csrfToken,
    staleTime: 5 * 60 * 1000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    onError: async (err) => {
      if (process.env.NODE_ENV !== 'production') {
        logger.error('Error fetching user data:', err.response?.data || err.message)
      }
    },
  })

  // NEW: Update wallet query address when address or saved changes
  useEffect(() => {
    const currentWallet = address || userData?.walletAddress
    setWalletAddressForQuery(currentWallet || null)
  }, [address, userData?.walletAddress])

  const {
    data: tasks,
    isLoading: tasksLoading,
    error: tasksError,
  } = useQuery({
    queryKey: ['tasks', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `tasks-${session.user.id}`
      const cached = await getCachedData(cacheKey)
      if (cached) return cached
      const response = await axios.get('/api/tasks', {
        headers: {
          'x-csrf-token': csrfToken,
        },
        withCredentials: true,
      })
      if (!response.data.success) throw new Error(response.data.detail || 'Failed to fetch tasks.')
      await cacheData(cacheKey, response.data.tasks, 10 * 60 * 1000)
      return response.data.tasks
    },
    enabled: status === 'authenticated' && !!session?.user?.id && !!csrfToken,
    staleTime: 10 * 60 * 1000,
  })

  const {
    data: taskProgress,
    isLoading: taskProgressLoading,
    error: taskProgressError,
  } = useQuery({
    queryKey: ['taskProgress', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `taskProgress-${session.user.id}`
      const cached = await getCachedData(cacheKey)
      if (cached) return cached
      const response = await axios.get(`/api/task-progress?uid=${session.user.id}`, {
        headers: {
          'x-csrf-token': csrfToken,
        },
        withCredentials: true,
      })
      const progress = response.data.progress || {}
      await cacheData(cacheKey, progress, 10 * 60 * 1000)
      return progress
    },
    enabled: status === 'authenticated' && !!session?.user?.id && !!csrfToken,
    staleTime: 10 * 60 * 1000,
  })
  const {
    data: rankings,
    isLoading: leaderboardLoading,
    error: leaderboardError,
  } = useQuery({
    queryKey: ['leaderboard', session?.user?.id, csrfToken],
    queryFn: async () => {
      const cacheKey = `leaderboard-${session.user.id}`
      const cached = await getCachedData(cacheKey)
      if (cached) {
        return cached
      }
      const response = await axios
        .get('/api/leaderboard', {
          headers: {
            'x-csrf-token': csrfToken,
          },
          withCredentials: true,
        })
        .catch((err) => {
          logger.error('Leaderboard fetch error:', err.response?.data || err.message)
          throw err
        })
      if (!response.data.success)
        throw new Error(response.data.detail || 'Failed to fetch leaderboard.')
      await cacheData(cacheKey, response.data.rankings, 5 * 60 * 1000)
      return response.data.rankings
    },
    enabled: status === 'authenticated' && !!session?.user?.id && !!csrfToken,
    staleTime: 30 * 60 * 1000,
    retry: 1,
    retryDelay: 2000,
    onError: (err) => {
      logger.error('Leaderboard error:', err)
      // Removed toast to avoid duplicates
    },
  })

  const handleFollow = (taskId) => {
    const followUrl = `https://x.com/intent/follow?screen_name=xynapseai_`
    window.open(followUrl, '_blank')
    setFollowedTasks((prev) => new Set([...prev, taskId]))
    // Removed toast to avoid duplicates
  }
  const verifyTaskMutation = useMutation({
    mutationFn: async ({ task, v2Token, tweetUrl = null }) => {
      if (task.task_type === 'follow') {
        await new Promise((resolve) => setTimeout(resolve, 5500))
      }
      const token = v2Token || (await debouncedExecuteRecaptcha('verify_task'))

      const body = {
        taskId: task.id,
        userId: session.user.id,
        recaptchaToken: token,
      }
      if (tweetUrl) {
        body.tweetUrl = tweetUrl
      }

      const response = await axios.post('/api/twitter/verify-task', body, {
        headers: { 'x-csrf-token': csrfToken, 'Content-Type': 'application/json' },
        withCredentials: true,
      })
      if (!response.data.success) throw new Error(response.data.detail || 'Failed to verify task')
      return response.data
    },
    onMutate: (variables) => {
      setCurrentVerifyingTaskId(variables.task.id)
    },
    onSettled: () => {
      setCurrentVerifyingTaskId(null)
    },
    onSuccess: async (data, variables) => {
      const task = variables.task
      const userCacheKey = `userData-${session.user.id}`
      const progressCacheKey = `taskProgress-${session.user.id}`
      await Promise.all([clearCache(userCacheKey), clearCache(progressCacheKey)])
      await Promise.all([
        queryClient.invalidateQueries(['taskProgress', session?.user?.id, csrfToken]),
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
      ])
      await Promise.all([
        queryClient.refetchQueries(['taskProgress', session?.user?.id, csrfToken]),
        queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]),
      ])

      // Reward referral
      if (task.id === 'daily_checkin') {
        try {
          await axios.post(
            '/api/referral-reward',
            { taskId: task.id },
            {
              headers: { 'x-csrf-token': csrfToken },
              withCredentials: true,
            },
          )
        } catch (err) {
          console.warn('Referral reward failed', err)
        }
      }
    },
    onError: (err, variables) => {
      const task = variables?.task || { task_type: 'unknown' }
      if (err.response?.status === 403 && err.response.data.detail === 'low_score_fallback') {
        setPendingTask(task)
        setShowV2Modal(true)
        // Removed toast to avoid duplicates
        return
      }
      const detail = err.response?.data?.detail
      let errorMessage = `Verification unsuccessful for ${task.description || 'this task'}. Please try again.`
      if (err.response?.status === 429) {
        errorMessage = 'X (Twitter) rate limit exceeded. Please wait 1-2 minutes and try again.'
      } else if (err.response?.status === 403) {
        if (detail === 'Invalid CSRF check.') {
          errorMessage = 'Session security issue detected. Please refresh the page and try again.'
        } else if (detail?.includes('reCAPTCHA')) {
          errorMessage =
            'Security verification failed. Please try the action again. If it persists , try another browser.'
        } else {
          errorMessage =
            'Security verification failed. Please try the action again. If it persists, refresh the page.'
        }
      } else if (detail === 'Task already completed today') {
        errorMessage = `You've already completed today's ${task.task_type === 'daily_checkin' ? 'check-in' : 'task'}! Come back tomorrow.`
      } else if (detail === 'Maximum completions reached') {
        errorMessage = `You've already completed this ${task.task_type === 'follow' ? 'follow' : 'task'}! Thanks for your support—explore other tasks for more rewards.`
      } else if (detail === 'X (Twitter) account not connected') {
        errorMessage = 'Please connect your X (Twitter) account first to verify this task.'
      } else if (err.message.includes('reCAPTCHA')) {
        errorMessage =
          'Verification challenge failed. Please complete the security check and retry.'
      } else if (detail?.includes('Twitter authentication')) {
        errorMessage =
          'X (Twitter) authentication issue. Please reconnect your account in profile settings.'
      } else {
        errorMessage = detail || err.message || errorMessage
      }
      // Removed toast to avoid duplicates
    },
  })

  const claimGenesisMutation = useMutation({
    mutationFn: async () => {
      const token = await debouncedExecuteRecaptcha('claim_genesis')
      const response = await axios.post(
        '/api/claim-genesis',
        {},
        {
          headers: {
            'x-csrf-token': csrfToken,
            'x-recaptcha-token': token,
            'Content-Type': 'application/json',
          },
          withCredentials: true,
        },
      )
      if (!response.data.success) throw new Error(response.data.detail || 'Claim failed')
      return response.data
    },
    onSuccess: async () => {
      // Clear cache & refetch
      await Promise.all([
        clearAllCaches(session.user.id),
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
        queryClient.invalidateQueries(['taskProgress', session?.user?.id, csrfToken]),
      ])
      await Promise.all([
        queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]),
        queryClient.refetchQueries(['taskProgress', session?.user?.id, csrfToken]),
      ])
      toast.success('500 points claimed successfully!')
    },
    onError: (err) => {
      const detail = err.response?.data?.detail || err.message
      let msg = 'Claim failed. Please try again.'
      if (detail.includes('already claimed')) msg = 'You have already claimed Genesis reward.'
      else if (detail.includes('No NFT')) msg = 'No Genesis NFT found in your wallet.'
      toast.error(msg)
    },
    onSettled: () => {
      setIsClaimingGenesis(false)
    },
  })

  const handleV2Change = useCallback(
    (token) => {
      if (token && pendingTask) {
        setImmediateLoading(true)
        verifyTaskMutation.mutate(
          { task: pendingTask, v2Token: token },
          {
            onSettled: () => {
              setImmediateLoading(false)
              if (recaptchaV2Ref.current) {
                recaptchaV2Ref.current.reset()
              }
              setPendingTask(null)
            },
          },
        )
        setShowV2Modal(false)
      }
    },
    [pendingTask, verifyTaskMutation],
  )
  const handleDailyCheckin = () => {
    setImmediateLoading(true)
    const task = {
      id: 'daily_checkin',
      description: 'Daily Check-in',
      points: 10,
      task_type: 'daily_checkin',
    }
    verifyTaskMutation.mutate(
      { task },
      {
        onSettled: () => {
          setImmediateLoading(false)
        },
      },
    )
  }
  const getPaginatedData = useCallback(
    (data, tab) => {
      const startIndex = (currentPage[tab] - 1) * itemsPerPage
      const endIndex = startIndex + itemsPerPage
      return data.slice(startIndex, endIndex)
    },
    [currentPage],
  )
  const getTotalPages = useCallback((data) => Math.ceil(data.length / itemsPerPage), [])
  const handlePageChange = useCallback((tab, page) => {
    setCurrentPage((prev) => ({ ...prev, [tab]: page }))
  }, [])
  const handleVerifyTask = useCallback(
    (task) => {
      setImmediateLoading(true)
      verifyTaskMutation.mutate(
        { task },
        {
          onSettled: () => {
            setImmediateLoading(false)
          },
        },
      )
    },
    [verifyTaskMutation],
  )

  const connectTwitterMutation = useMutation({
    mutationFn: async () => {
      window.location.href = '/api/twitter/connect'
    },
    onError: (err) => {
      logger.error('Connect Twitter error:', err)
      // Removed toast to avoid duplicates
    },
  })
  const getProfilePictureSrc = useCallback((profilePicture) => {
    const isValidUrl = (url) => {
      try {
        new URL(url)
        return true
      } catch (err) {
        logger.warn(`Invalid URL: ${url}`, err)
        return false
      }
    }
    if (profilePicture && typeof profilePicture === 'string' && isValidUrl(profilePicture)) {
      return profilePicture
    }
    return '/fallback-image.webp'
  }, [])

  const DailyCheckinBar = ({
    last7Days,
    streak,
    onCheckin,
    isLoading,
    userData,
    twitterConnected,
  }) => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const todayIndex = new Date().getDay()
    const [tooltipVisible, setTooltipVisible] = useState(false)
    const getDayIndex = (index) => {
      const daysBack = 6 - index
      return (todayIndex - daysBack + 7) % 7
    }
    const isTodayChecked = last7Days[last7Days.length - 1]
    const handleCheckinClick = () => {
      if (!twitterConnected) {
        // Removed toast to avoid duplicates
        return
      }
      onCheckin()
    }
    return (
      <div className="relative w-full bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-xl p-3 mb-2 shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15]">
        <div className="relative z-20 flex justify-between items-center mb-3">
          <div className="flex items-center gap-1">
            <Calendar className="w-4 h-4 text-emerald-400" />
            <h3 className="text-[#FFF] font-bold text-[12px]">Daily Check-in</h3>
            <div className="relative">
              <Info
                className="w-4 h-4 text-[#D4D4D4] cursor-help"
                onMouseEnter={() => setTooltipVisible(true)}
                onMouseLeave={() => setTooltipVisible(false)}
              />
              {tooltipVisible && (
                <div className="absolute top-full left-full ml-2 mb-2 p-4 bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#FFFFFF20] rounded-xl text-[9px] sm:text-[10px] leading-relaxed text-[#D4D4D4] z-[9999] w-72 max-w-[90vw] shadow-2xl pointer-events-none">
                  <div className="text-left">
                    Maintain a 7-day streak to earn double points (20 pts/day) and unlock exclusive
                    rewards! Breaking the streak resets to normal (10 pts).
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="relative z-20 flex justify-around items-center">
          {last7Days.map((checked, index) => {
            const dayIndex = getDayIndex(index)
            return (
              <div key={index} className="flex flex-col items-center gap-1">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-bold transition-all duration-300 ${
                    checked
                      ? 'bg-gradient-to-r from-[#FFF] to-[#D4D4D4] text-[#0A0A0A] shadow-lg shadow-[#D4D4D4]/25'
                      : 'bg-[#FFFFFF]/10 text-[#FFF]/50 border border-[#FFFFFF20]'
                  }`}
                >
                  {checked ? <Check className="w-3 h-3 text-[#0A0A0A]" /> : days[dayIndex]}
                </div>
                {index === last7Days.length - 1 && !checked && (
                  <motion.button
                    onClick={handleCheckinClick}
                    disabled={isLoading || !twitterConnected}
                    className={`mt-1 px-2 py-1 rounded-lg text-[8px] sm:text-[9px] font-semibold transition-colors flex items-center justify-center gap-1 ${
                      isLoading || !twitterConnected
                        ? 'bg-transparent border border-[#FFFFFF20] text-[#FFF]/50 cursor-not-allowed'
                        : 'bg-transparent border border-[#FFFFFF] text-[#FFF] hover:bg-[#FFFFFF]/10'
                    }`}
                  >
                    {isLoading ? (
                      <BlinkingDots />
                    ) : !twitterConnected ? (
                      'Connect Twitter'
                    ) : (
                      'Check-in'
                    )}
                  </motion.button>
                )}
              </div>
            )
          })}
        </div>
        {streak >= 7 && (
          <div className="relative z-20 flex items-center justify-center mt-3 gap-1">
            <Flame className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span className="text-emerald-400 font-bold text-sm">
              Streak: {streak} days - Double Points Active!
            </span>
          </div>
        )}
      </div>
    )
  }

  const renderTasksSection = useCallback(() => {
    if (!userData?.twitterHandle) {
      return (
        <motion.div
          className="h-full flex items-center justify-center p-6 min-h-[calc(45vh-1rem)] bg-gradient-to-br from-black/90 to-gray-900/90 rounded-b-xl border-t border-white/15 shadow-2xl shadow-black/30"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
        >
          <div className="text-center max-w-md flex flex-col items-center justify-center gap-4">
            <p className="text-sm text-white/80">
              Connect your X (Twitter) account to unlock tasks.
            </p>
            <motion.button
              onClick={() => connectTwitterMutation.mutate()}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-neon-blue border border-neon-blue/50 bg-gradient-to-r from-white/10 to-white/5 hover:bg-neon-blue/20 transition-all duration-300 shadow-lg flex items-center justify-center gap-2"
              whileHover={{ scale: 1 }}
              whileTap={{ scale: 0.98 }}
            >
              Connect
              <img src="/logos/x.webp" alt="X Logo" className="w-3 h-3" />
            </motion.button>
          </div>
        </motion.div>
      )
    }

    if (tasksLoading || taskProgressLoading) {
      return (
        <div className="relative h-full">
          <LoadingOverlay
            isLoading={true}
            isMobile={isMobile}
            className="absolute inset-0 z-10 h-full"
          />
          <div className="h-full flex items-center justify-center">
            <Spinner className="h-8 w-8 text-[#00FFFF]" />
          </div>
        </div>
      )
    }

    if (tasksError || taskProgressError) {
      return (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="h-full flex items-center justify-center text-red-400 text-sm p-4 text-center"
        >
          Error loading tasks: {tasksError?.message || taskProgressError?.message}
        </motion.div>
      )
    }

    if (!tasks?.length) {
      return (
        <div className="h-full flex items-center justify-center text-[#D4D4D4] text-sm p-4 text-center">
          No tasks available.
        </div>
      )
    }

    return (
      <div className="relative h-full p-4 space-y-4 overflow-y-auto hide-scrollbar">
        <DailyCheckinBar
          last7Days={userData.last7Days}
          streak={userData.streak}
          onCheckin={() => {
            const task = {
              id: 'daily_checkin',
              description: 'Daily Check-in',
              points: 10,
              task_type: 'daily_checkin',
            }
            verifyTaskMutation.mutate({ task })
          }}
          isLoading={currentVerifyingTaskId === 'daily_checkin'}
          userData={userData}
          twitterConnected={!!userData.twitterHandle}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tasks.map((task) => {
            const isCompleted =
              task.task_type === 'genesis_mint'
                ? nftMinted
                : task.is_daily
                  ? (taskProgress?.[task.id]?.completionCount || 0) >= task.max_completions
                  : (taskProgress?.[task.id]?.completionCount || 0) >= task.max_completions

            if (task.task_type === 'invite') {
              return (
                <InviteTaskCard
                  key={task.id}
                  userData={userData}
                  task={task}
                  csrfToken={csrfToken}
                />
              )
            }

            if (task.task_type === 'genesis_mint') {
              const hasMinted = nftMinted
              const hasClaimed = !!taskProgress?.[task.id]?.completionCount
              return (
                <div
                  key={task.id}
                  className="h-[22vh] bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-xl shadow-2xl p-4 flex flex-col justify-between relative overflow-hidden"
                >
                  <div className="flex justify-between items-start mb-2 z-10 relative">
                    <div className="flex items-center gap-2">
                      <Biohazard className="w-5 h-5 text-emerald-400" />
                      <h4 className="text-sm font-bold text-[#FFF]">Genesis</h4>
                    </div>
                    <span className="text-sm font-bold text-emerald-400">+500</span>
                  </div>
                  <p className="text-[10px] text-[#D4D4D4] mb-3 z-10 relative">
                    Mint Genesis NFT
                    {hasMinted && (
                      <div className="text-xs text-emerald-400 text-center font-medium">
                        ✓ NFT Minted
                      </div>
                    )}
                  </p>
                  {nftImageSrc && (
                    <div className="absolute inset-0 opacity-10 pointer-events-none">
                      <Image
                        src={nftImageSrc}
                        alt="Genesis NFT Preview"
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                  )}
                  <div className="text-xs z-10 relative space-y-2">
                    {hasClaimed ? (
                      <button
                        disabled
                        className="w-full min-h-10 py-2 rounded-lg bg-[#FFFFFF]/10 border border-[#FFFFFF20] text-[#FFF]/50 cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        <Check className="w-4 h-4" />
                        Completed
                      </button>
                    ) : hasMinted ? (
                      <button
                        onClick={() => claimGenesisMutation.mutate()}
                        disabled={claimGenesisMutation.isPending}
                        className="w-full min-h-10 py-2 rounded-lg bg-transparent border border-emerald-400 text-emerald-400 font-medium hover:bg-emerald-400/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        {claimGenesisMutation.isPending ? (
                          <div className="flex items-center h-5">
                            <BlinkingDots />
                          </div>
                        ) : (
                          'Claim 500 Points'
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={() => setShowMintModal(true)}
                        className="w-full min-h-10 py-2 rounded-lg bg-transparent border border-[#FFFFFF] text-[#FFF] font-medium hover:bg-[#FFFFFF]/10 transition-colors flex items-center justify-center gap-2"
                      >
                        Mint NFT
                      </button>
                    )}
                  </div>
                </div>
              )
            }

            if (task.id === 'tweet') {
              const isCompleted =
                (taskProgress?.[task.id]?.completionCount || 0) >= task.max_completions
              return (
                <div
                  key={task.id}
                  className="h-[22vh] bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-xl shadow-2xl p-4 flex flex-col justify-between relative"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="text-sm font-bold text-[#FFF] truncate flex-1 pr-2">
                      {task.description}
                    </h4>
                    <span className="text-sm font-bold text-emerald-400">+{task.points}</span>
                  </div>
                  <p className="text-[10px] text-[#D4D4D4] mb-4 leading-relaxed">
                    Post a tweet mentioning @xynapseai_ , tag at least 2 friends, and include
                    #xynapse.
                    <br />
                    Paste your tweet link below to verify.
                  </p>
                  {isCompleted ? (
                    <button
                      disabled
                      className="text-xs w-full min-h-10 py-2 rounded-lg bg-[#FFFFFF]/10 border border-[#FFFFFF20] text-[#FFF]/50 cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <Check className="w-4 h-4" />
                      Completed
                    </button>
                  ) : (
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={tweetUrl}
                        onChange={(e) => setTweetUrl(e.target.value)}
                        placeholder="https://x.com/user/status/..."
                        className="flex-1 px-3 py-2 bg-[#0A0A0A] border border-[#FFFFFF30] rounded-lg text-xs text-[#FFF] placeholder:text-[#D4D4D4]/60 focus:border-[#00FFFF] focus:outline-none transition-colors"
                      />
                      <button
                        onClick={() => {
                          if (!tweetUrl.trim()) {
                            toast.error('Please paste your tweet link first')
                            return
                          }
                          verifyTaskMutation.mutate({ task, tweetUrl })
                        }}
                        disabled={currentVerifyingTaskId === task.id}
                        className="px-5 min-h-8 py-2 rounded-lg font-medium text-xs whitespace-nowrap transition-colors flex items-center justify-center min-w-[80px] bg-transparent border border-[#FFFFFF] text-[#FFF] hover:bg-[#FFFFFF]/10 disabled:bg-[#FFFFFF]/10 disabled:border-[#FFFFFF20] disabled:text-[#FFF]/50 disabled:cursor-not-allowed"
                      >
                        {currentVerifyingTaskId === task.id ? (
                          <div className="flex items-center h-5">
                            <BlinkingDots />
                          </div>
                        ) : (
                          'Verify'
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )
            }

            if (task.id === 'daily_checkin') return null

            return (
              <div
                key={task.id}
                className="h-[22vh] bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-xl shadow-2xl p-4 flex flex-col justify-between relative"
              >
                <div className="flex justify-between items-start mb-2">
                  <h4 className="text-sm font-bold text-[#FFF] truncate flex-1 pr-2">
                    {task.description}
                  </h4>
                  <span className="text-sm font-bold text-emerald-400">+{task.points}</span>
                </div>
                {task.is_daily && (
                  <p className="text-xs text-[#D4D4D4] mb-3">
                    Daily ({taskProgress?.[task.id]?.completionCount || 0}/{task.max_completions})
                  </p>
                )}
                <div>
                  {task.task_type === 'follow' && !followedTasks.has(task.id) ? (
                    <button
                      onClick={() => handleFollow(task.id)}
                      className="text-xs w-full min-h-10 py-2 rounded-lg bg-transparent border border-[#FFFFFF] text-[#FFF] font-medium transition-colors hover:bg-[#FFFFFF]/10 flex items-center justify-center gap-2"
                    >
                      <img src="/logos/x.webp" alt="X Logo" className="w-3 h-3" />
                      Follow
                    </button>
                  ) : (
                    <button
                      onClick={() => verifyTaskMutation.mutate({ task })}
                      disabled={
                        currentVerifyingTaskId === task.id ||
                        !userData?.twitterHandle ||
                        isCompleted
                      }
                      className="w-full min-h-10 py-2 rounded-lg font-medium text-xs transition-colors flex items-center justify-center gap-2 bg-transparent border border-[#FFFFFF] text-[#FFF] hover:bg-[#FFFFFF]/10 disabled:bg-[#FFFFFF]/10 disabled:border-[#FFFFFF20] disabled:text-[#FFF]/50 disabled:cursor-not-allowed"
                    >
                      {currentVerifyingTaskId === task.id ? (
                        <div className="flex items-center h-5">
                          <BlinkingDots />
                        </div>
                      ) : isCompleted ? (
                        <>
                          <Check className="w-4 h-4" />
                          Completed
                        </>
                      ) : !userData?.twitterHandle ? (
                        <>
                          <img src="/logos/x.webp" alt="X Logo" className="w-3 h-3" />
                          Connect Twitter
                        </>
                      ) : (
                        'Verify'
                      )}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }, [
    userData,
    tasks,
    tasksLoading,
    taskProgress,
    taskProgressLoading,
    tasksError,
    taskProgressError,
    verifyTaskMutation.isPending,
    claimGenesisMutation.isPending,
    isMobile,
    followedTasks,
    connectTwitterMutation,
    nftMinted,
    nftImageSrc,
    setShowMintModal,
    csrfToken,
  ])

  const renderUserRow = useCallback(
    (user, index, isCurrentUser = false) => {
      const rank = rankings?.findIndex((u) => u.id === user.id) + 1 || 'N/A'
      const getRankIcon = (r) => {
        if (r === 1) return <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
        if (r === 2) return <Flame className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-400" />
        if (r === 3) return <Award className="w-4 h-4 sm:w-5 sm:h-5 text-[#D4D4D4]" />
        return null
      }
      const rankIcon = getRankIcon(rank)
      return (
        <motion.tr
          key={user.id}
          className={`border-t border-[#FFFFFF10] hover:bg-[#FFFFFF]/10 transition-all duration-300`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: index * 0.02 }}
        >
          <td className="px-4 py-2 text-[#FFF] text-sm sm:text-base truncate align-middle flex items-center gap-1 min-w-[4rem]">
            {rankIcon}
            {rank}
          </td>
          <td className="px-4 py-2 text-[#FFF] text-sm sm:text-base truncate align-middle min-w-0">
            <div className="flex items-center">
              <Image
                src={getProfilePictureSrc(user.profilePicture)}
                alt={user.googleName || user.twitterHandle || 'User Avatar'}
                width={isMobile ? 24 : 32}
                height={isMobile ? 24 : 32}
                className="rounded-full border border-[#FFFFFF20] mr-3 object-cover shadow-md flex-shrink-0"
              />
              <div className="flex items-center gap-1 truncate min-w-0 ml-1">
                <span className="truncate">
                  {user.googleName || user.twitterHandle || 'Anonymous'}
                </span>
                {user.twitterHandle && (
                  <a
                    href={`https://x.com/${user.twitterHandle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src="/logos/x.webp"
                      alt="X Logo"
                      className="ml-1 w-4 h-4 sm:w-5 sm:h-5 text-[#00FFFF] hover:text-emerald-400 flex-shrink-0"
                    />
                  </a>
                )}
                {isCurrentUser && (
                  <span className="ml-2 text-[9px] md:text-[10px] font-semibold text-[#0A0A0A] px-1 py-0.5 rounded-lg border border-[#FFFFFF] bg-gradient-to-r from-[#FFF] to-[#D4D4D4] whitespace-nowrap">
                    You
                  </span>
                )}
              </div>
            </div>
          </td>
          <td className="px-4 py-2 text-[#00FFFF] text-sm sm:text-base text-right truncate align-middle min-w-[5rem]">
            {user.points || 0}
          </td>
        </motion.tr>
      )
    },
    [isMobile, rankings, getProfilePictureSrc],
  )

  const renderLeaderboardSection = useCallback(() => {
    const currentUserRank = userData
      ? (rankings?.findIndex((u) => u.id === userData.id) ?? -1) + 1
      : null
    const leaderboardUsers = rankings?.filter((u) => u.id !== (session?.user?.id || '')) || []
    const getRankDisplay = (rank) => {
      if (!rank || rank <= 0)
        return <span className="text-xs sm:text-sm font-bold text-[#D4D4D4]">N/A</span>
      if (rank === 1) return <Trophy className="w-5 h-5 text-emerald-400" />
      if (rank === 2) return <Flame className="w-4 h-4 text-yellow-400" />
      if (rank === 3) return <Award className="w-4 h-4 text-[#D4D4D4]" />
      return <span className="text-xs sm:text-sm font-bold text-[#FFF]">{rank}</span>
    }
    const renderUserItem = (user, rank, isCurrentUser = false) => (
      <motion.div
        key={user.id}
        className={`relative bg-[#0A0A0A]/80 backdrop-blur-md border rounded-xl p-2 flex items-center justify-between shadow-lg transition-all duration-300 hover:bg-[#FFFFFF]/10 ${
          isCurrentUser ? 'border-emerald-400/60 shadow-emerald-400/20' : 'border-[#FFFFFF20]'
        }`}
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Rank */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="flex flex-col items-center w-12">{getRankDisplay(rank)}</div>
          {/* Avatar + Info */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Image
              src={getProfilePictureSrc(user.profilePicture)}
              alt={user.googleName || user.twitterHandle || 'User'}
              width={isMobile ? 36 : 44}
              height={isMobile ? 36 : 44}
              className="rounded-lg border-2 border-[#FFFFFF30] object-cover flex-shrink-0 shadow-md"
            />
            <div className="text-sm flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[#FFF] font-semibold truncate">
                  {user.googleName || user.twitterHandle || 'Anonymous'}
                </span>
                {isCurrentUser && (
                  <span className="flex-shrink-0 px-2 py-0.5 text-[8px] sm:text-[9px] font-bold text-emerald-400 bg-emerald-400/10 rounded-full border border-emerald-400/40 whitespace-nowrap">
                    YOU
                  </span>
                )}
              </div>
              {/* Twitter handle */}
              {user.twitterHandle && (
                <a
                  href={`https://x.com/${user.twitterHandle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[#00FFFF] text-xs truncate mt-0.5 hover:underline"
                >
                  <img src="/logos/x.webp" alt="X" className="w-3.5 h-3.5" />@{user.twitterHandle}
                </a>
              )}
            </div>
          </div>
        </div>
        {/* Points */}
        <div className="text-right mr-4">
          <span className="text-xl font-bold text-emerald-400">{user.points || 0}</span>
          <span className="block text-[10px] text-[#D4D4D4] mt-0.5">points</span>
        </div>
      </motion.div>
    )

    if (leaderboardLoading) {
      return (
        <div className="relative h-full">
          <LoadingOverlay
            isLoading={true}
            isMobile={isMobile}
            className="absolute inset-0 z-10 h-full"
          />
          <div className="h-full flex items-center justify-center">
            <Spinner className="h-8 w-8 text-[#00FFFF]" />
          </div>
        </div>
      )
    }
    if (leaderboardError) {
      return (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="h-full flex items-center justify-center text-red-400 text-sm p-4 text-center gap-2"
        >
          Error: {leaderboardError.message}
          <button
            onClick={() => window.location.reload()}
            className="px-2 py-1 bg-[#00FFFF]/20 text-[#FFF] rounded-lg text-sm font-medium hover:from-emerald-400/20 hover:to-[#00FFFF]/20 transition-colors shadow-lg shadow-[#00FFFF]/25 border border-[#00FFFF]/40"
          >
            Retry
          </button>
        </motion.div>
      )
    }
    if (!rankings?.length) {
      return (
        <div className="h-full flex items-center justify-center text-[#D4D4D4] text-sm p-4 text-center">
          No ranking data available.
        </div>
      )
    }

    return (
      <div className="h-full flex flex-col">
        <div className="px-4 pt-5 pb-4 flex flex-col items-center border-b border-[#FFFFFF10]">
          <div className="flex items-center gap-4">
            <Trophy className="w-6 h-6 sm-w-8 sm:h-8 text-emerald-400 drop-shadow-lg" />
            <div className="flex items-center gap-4">
              <h2 className="text-xl sm:text-2xl font-black text-[#FFF] uppercase tracking-wider bg-gradient-to-r from-[#FFF] to-emerald-400 bg-clip-text text-transparent drop-shadow-md">
                Leaderboard
              </h2>

              <div className="group relative">
                <HelpCircle className="w-3 h-3 sm:w-4 sm:h-4 text-[#A0A0A0] cursor-help hover:text-[#D4D4D4] transition-colors" />
                <div className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all duration-300 absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-2 bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#FFFFFF20] rounded-xl text-xs text-[#D4D4D4] shadow-2xl w-52 text-center z-50">
                  Ranking of users with the highest scores.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto hide-scrollbar px-4 pb-2 space-y-3">
          {userData && renderUserItem(userData, currentUserRank || 0, true)}
          {getPaginatedData(leaderboardUsers, 'leaderboard').map((user, index) => {
            const rank = rankings?.findIndex((u) => u.id === user.id) + 1 || index + 1
            return renderUserItem(user, rank, false)
          })}
        </div>

        {leaderboardUsers.length > itemsPerPage && (
          <div className="flex justify-center gap-3 px-4 py-3 border-t border-[#FFFFFF10]">
            <motion.button
              onClick={() => handlePageChange('leaderboard', currentPage.leaderboard - 1)}
              disabled={currentPage.leaderboard === 1}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                currentPage.leaderboard === 1
                  ? 'border-[#FFFFFF20] text-[#FFF]/50 cursor-not-allowed'
                  : 'border-[#FFFFFF40] text-[#FFF] hover:bg-[#FFFFFF]/10'
              }`}
              whileTap={{ scale: currentPage.leaderboard === 1 ? 1 : 0.98 }}
            >
              Previous
            </motion.button>
            <span className="self-center text-xs text-[#D4D4D4]">
              Page {currentPage.leaderboard} / {getTotalPages(leaderboardUsers)}
            </span>
            <motion.button
              onClick={() => handlePageChange('leaderboard', currentPage.leaderboard + 1)}
              disabled={currentPage.leaderboard === getTotalPages(leaderboardUsers)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                currentPage.leaderboard === getTotalPages(leaderboardUsers)
                  ? 'border-[#FFFFFF20] text-[#FFF]/50 cursor-not-allowed'
                  : 'border-[#FFFFFF40] text-[#FFF] hover:bg-[#FFFFFF]/10'
              }`}
              whileTap={{
                scale: currentPage.leaderboard === getTotalPages(leaderboardUsers) ? 1 : 0.98,
              }}
            >
              Next
            </motion.button>
          </div>
        )}
      </div>
    )
  }, [
    leaderboardLoading,
    leaderboardError,
    rankings,
    userData,
    isMobile,
    currentPage,
    getPaginatedData,
    getTotalPages,
    handlePageChange,
    getProfilePictureSrc,
    session,
  ])

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      console.log = () => {}
      console.error = () => {}
      console.warn = () => {}
    }
  }, [])
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 640)
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  const onSignOut = async () => {
    setIsSigningOut(true)
    await handleSignOut()
    setIsSigningOut(false)
  }
  let isExecuting = false
  const debouncedExecuteRecaptcha = useCallback(
    async (action, retries = 3) => {
      if (!recaptchaRef.current) {
        if (process.env.NODE_ENV !== 'production') {
          logger.error('reCAPTCHA ref is null')
        }
        throw new Error('reCAPTCHA not initialized')
      }
      for (let i = 0; i < retries; i++) {
        try {
          await recaptchaRef.current.reset()
          const token = await Promise.race([
            recaptchaRef.current.executeAsync(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('reCAPTCHA timeout')), 20000),
            ),
          ])
          if (!token) throw new Error('Empty reCAPTCHA token')
          return token
        } catch (error) {
          if (process.env.NODE_ENV !== 'production') {
            logger.error(`reCAPTCHA attempt ${i + 1} failed for ${action}: ${error.message}`)
          }
          if (i === retries - 1) {
            throw new Error(`reCAPTCHA failed after ${retries} attempts: ${error.message}`)
          }
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
    },
    [recaptchaRef],
  )
  const createChargeMutation = useMutation({
    mutationFn: async () => {
      if (!session?.user?.id) throw new Error('Not authenticated')
      if (!csrfToken) throw new Error('CSRF token not available')
      const token = await debouncedExecuteRecaptcha('create_charge')
      const response = await axios.post(
        '/api/coinbase/create-charge',
        { userId: session.user.id, plan: 'premium' },
        {
          headers: {
            'x-csrf-token': csrfToken,
            'X-Recaptcha-Token': token,
            'Content-Type': 'application/json',
          },
          withCredentials: true,
        },
      )
      if (!response.data.success) throw new Error(response.data.detail || 'Unable to create charge')
      return response.data.hostedUrl
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken])
    },
    onError: (err) => {
      // Removed toast to avoid duplicates
    },
  })
  useEffect(() => {
    if (
      userData?.twitterHandle &&
      !userData?.profilePicture.includes('pbs.twimg.com') &&
      status === 'authenticated'
    ) {
      logger.warn(
        'Twitter handle present but profile picture is not from Twitter, triggering refetch',
      )
      const cacheKey = `userData-${session.user.id}`
      clearCache(cacheKey).then(() => {
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken])
        queryClient.refetchQueries(['userData', session?.user?.id, csrfToken])
      })
    }
  }, [userData, session, csrfToken, queryClient, status])
  // Sync wallet and twitter connection states for modal
  useEffect(() => {
    setWalletConnected(!!address || !!userData?.walletAddress)
    setTwitterConnected(!!userData?.twitterHandle)
  }, [address, userData?.walletAddress, userData?.twitterHandle])
  // Automatically switch to Base Mainnet if connected to wrong chain
  useEffect(() => {
    if (isConnected && chainId !== BASE_CHAIN_ID) {
      switchChainMutation.mutate(
        { chainId: BASE_CHAIN_ID },
        {
          onSuccess: () => toast.info('Switched to Base Mainnet'),
          onError: (err) => toast.error(`Failed to switch network: ${err.message}`),
        },
      )
    }
  }, [isConnected, chainId, switchChainMutation])

  const displayInfo = isBaseAccount ? userData?.walletAddress || address || '' : email
  const maskedInfo = isBaseAccount
    ? `${(userData?.walletAddress || address)?.slice(0, 6) || ''}...${(userData?.walletAddress || address)?.slice(-4) || ''}`
    : email
      ? email.replace(/./g, '*')
      : '********'
  const fullInfo = displayInfo
  const currentAddress = address || userData?.walletAddress
  const isWalletSaved = !!userData?.walletAddress
  const statusText = isWalletSaved
  const displayedAddress = currentAddress || ''
  // UPDATED: Simplified mutation for saving wallet address (no verification/signature)
  const updateWalletMutation = useMutation({
    mutationFn: async ({ walletAddress, v2Token } = {}) => {
      const token = v2Token || (await debouncedExecuteRecaptcha('update_wallet'))
      const response = await axios.patch(
        '/api/user',
        { uid: session.user.id, walletAddress }, // REMOVED: recaptchaToken from body
        {
          headers: {
            'x-csrf-token': csrfToken,
            'x-recaptcha-token': token, // ADDED: Send in header as expected by backend
            'Content-Type': 'application/json',
          },
          withCredentials: true,
        },
      )
      if (!response.data.success) throw new Error(response.data.detail || 'Unable to update wallet')
    },
    onSuccess: async () => {
      setHasUpdatedWallet(true)
      setIsUpdatingWallet(false)
      const cacheKey = `userData-${session.user.id}`
      await clearAllCaches(session.user.id)
      await clearCache(cacheKey)
      await queryClient.invalidateQueries({ queryKey: ['userData', session?.user?.id, csrfToken] })
      await queryClient.refetchQueries({ queryKey: ['userData', session?.user?.id, csrfToken] })
      // REMOVED: window.location.reload(); to prevent infinite reload loop
    },
    onError: (err) => {
      setHasUpdatedWallet(false)
      setIsUpdatingWallet(false)
      // ADDED: On 403 (CSRF issue), refresh CSRF token
      if (err.response?.status === 403 && err.response.data.detail.includes('CSRF')) {
        queryClient.invalidateQueries({ queryKey: ['csrfToken'] })
      }
    },
  })
  const debouncedUpdateWallet = useCallback(
    debounce((address) => {
      setIsUpdatingWallet(true)
      updateWalletMutation.mutate({ walletAddress: address })
    }, 2000), // 2s debounce to avoid spamming on connect glitches
    [updateWalletMutation],
  )
  useEffect(() => {
    if (
      isConnected &&
      !!address &&
      userData &&
      !userData.walletAddress &&
      !isUpdatingWallet &&
      !hasUpdatedWallet
    ) {
      debouncedUpdateWallet(address)
    }
  }, [isConnected, address, userData, isUpdatingWallet, hasUpdatedWallet, debouncedUpdateWallet])

  const disconnectTwitterMutation = useMutation({
    mutationFn: async () => {
      await queryClient.invalidateQueries({ queryKey: ['csrfToken'] })
      const newCsrfToken = await queryClient.fetchQuery({ queryKey: ['csrfToken'] })
      const response = await axios
        .post(
          '/api/twitter/connect',
          { action: 'disconnect', uid: session.user.id },
          {
            headers: { 'x-csrf-token': newCsrfToken, 'Content-Type': 'application/json' },
            withCredentials: true,
          },
        )
        .catch((err) => {
          logger.error('Disconnect Twitter error:', err.response?.data || err.message)
          throw err
        })
      if (!response.data.success)
        throw new Error(response.data.detail || 'Unable to disconnect Twitter')
      await clearAllCaches(session.user.id)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
        queryClient.invalidateQueries(['leaderboard', session?.user?.id, csrfToken]),
      ])
      await Promise.all([
        queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]),
        queryClient.refetchQueries(['leaderboard', session?.user?.id, csrfToken]),
      ])
    },
    onError: (err) => {
      // Removed toast to avoid duplicates
    },
  })
  const disconnectWalletMutation = useMutation({
    mutationFn: async () => {
      // FIXED: Removed reCAPTCHA for disconnect to fix production error
      const response = await axios.patch(
        '/api/user',
        { uid: session.user.id, walletAddress: null },
        {
          headers: { 'x-csrf-token': csrfToken, 'Content-Type': 'application/json' },
          withCredentials: true,
        },
      )
      if (!response.data.success)
        throw new Error(response.data.detail || 'Unable to disconnect wallet')
    },
    onSuccess: async () => {
      disconnect()
      setWalletConnected(false)
      setHasUpdatedWallet(false) // Reset flag
      hasTriggeredRef.current = false
      // Removed toast to avoid duplicates
      const cacheKey = `userData-${session.user.id}`
      await clearCache(cacheKey)
      await queryClient.refetchQueries(['userData', session?.user?.id, csrfToken])
    },
    onError: (err) => {
      // Removed toast to avoid duplicates
    },
  })
  const debouncedHandleSignOut = useCallback(
    debounce(() => handleSignOut(), 1000, { leading: true, trailing: false }),
    [handleSignOut],
  )
  // Get Days Active
  const getDaysActive = useCallback(() => {
    return userData?.daysActive || 0
  }, [userData])
  // UPDATED: Auto-save wallet on connect (simplified, no verification) - FIXED: Only save if no wallet exists yet
  useEffect(() => {
    if (
      isConnected &&
      !!address &&
      userData &&
      !userData.walletAddress &&
      !isUpdatingWallet &&
      !hasUpdatedWallet
    ) {
      setIsUpdatingWallet(true)
      updateWalletMutation.mutate({ walletAddress: address })
    }
  }, [isConnected, address, userData, isUpdatingWallet, hasUpdatedWallet, updateWalletMutation])
  // NEW: Auto-connect/save for Base/Farcaster apps on login - FIXED: Only save if no wallet exists yet
  useEffect(() => {
    const isSpecialApp = isBaseAccount || !!userData?.farcaster_fid
    if (
      status === 'authenticated' &&
      isSpecialApp &&
      isConnected &&
      !!address &&
      userData &&
      !userData.walletAddress &&
      !isUpdatingWallet &&
      !hasUpdatedWallet
    ) {
      setIsUpdatingWallet(true)
      updateWalletMutation.mutate({ walletAddress: address })
    }
  }, [
    status,
    isBaseAccount,
    userData?.farcaster_fid,
    isConnected,
    address,
    userData,
    isUpdatingWallet,
    hasUpdatedWallet,
    updateWalletMutation,
  ])
  // Handle Twitter redirect callback (existing)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)

    if (urlParams.get('inviteSuccess') === 'true' && status === 'authenticated') {
      const cacheKey = `userData-${session.user.id}`
      const leaderboardCacheKey = `leaderboard-${session.user.id}`

      Promise.all([
        clearAllCaches(session.user.id),
        clearCache(cacheKey),
        clearCache(leaderboardCacheKey),
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
        queryClient.invalidateQueries(['leaderboard', session?.user?.id, csrfToken]),
      ])
        .then(() => {
          return Promise.all([
            queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]),
            queryClient.refetchQueries(['leaderboard', session?.user?.id, csrfToken]),
          ])
        })
        .then(() => {
          window.history.replaceState({}, document.title, window.location.pathname)
          toast.success('Invite code applied successfully!')
        })
        .catch((err) => {
          logger.error('Error handling invite success callback:', err)
        })
    }
  }, [session, csrfToken, queryClient, status])

  // Handle Twitter connection callback - force refresh user data
  useEffect(() => {
    if (window.location.search.includes('twitterConnected=true') && status === 'authenticated') {
      const cacheKey = `userData-${session.user.id}`

      Promise.all([
        clearCache(cacheKey),
        clearAllCaches(session.user.id),
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
      ])
        .then(() => queryClient.refetchQueries(['userData', session?.user?.id, csrfToken]))
        .then(() => {
          window.history.replaceState({}, document.title, '/dashboard')
        })
        .catch((err) => {
          logger.error('Error handling Twitter connection callback:', err)
        })
    }
  }, [status, session?.user?.id, csrfToken, queryClient])

  // NEW: Handle wallet connection URL param for cache clear (analogous to Twitter)
  useEffect(() => {
    if (searchParams.get('walletConnected') === 'true' && status === 'authenticated') {
      const cacheKey = `userData-${session.user.id}`
      Promise.all([
        clearAllCaches(session.user.id), // Clear IndexedDB
        clearCache(cacheKey),
        queryClient.invalidateQueries(['userData', session?.user?.id, csrfToken]),
      ])
        .then(() => {
          return queryClient.refetchQueries(['userData', session?.user?.id, csrfToken])
        })
        .then(() => {
          window.history.replaceState({}, document.title, window.location.pathname)
          setWalletConnected(true)
          // REMOVED: window.location.reload(); to prevent potential loops
        })
        .catch((err) => {
          logger.error('Error handling Wallet connection callback:', err)
        })
    }
  }, [searchParams, status, session, csrfToken, queryClient])
  const handleManualCacheClear = async () => {
    try {
      await clearAllCaches(session.user.id)
      window.location.reload()
    } catch (err) {
      logger.error('Error clearing cache:', err)
    }
  }
  const getBalanceWithRetry = async (address, retries = 3) => {
    if (!address) {
      throw new Error('Wallet not connected')
    }
    for (let i = 0; i < retries; i++) {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum)
        return await provider.getBalance(address)
      } catch (err) {
        if (i === retries - 1 || !err.message.includes('RPC')) throw err
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)))
      }
    }
  }
  // Updated: Handle Mint NFT - Use BASE_CHAIN_ID, fix max supply msg to 10000, integrate useSendCalls for Builder Code attribution, no record mint
  // const handleMint = async () => {
  //   if (!isConnected || !address) {
  //     toast.error('Please connect your wallet first.')
  //     return
  //   }
  //   if (chainId !== BASE_CHAIN_ID) {
  //     try {
  //       await switchChainMutation.mutateAsync({ chainId: BASE_CHAIN_ID })
  //       toast.info('Please switch to Base mainnet to mint.')
  //     } catch (err) {
  //       toast.error('Network switching failed. Please switch to Base manually.')
  //     }
  //     return
  //   }
  //   if (nftMinted) {
  //     toast.info('You have already minted!')
  //     return
  //   }
  //   setIsMinting(true)
  //   try {
  //     const hash = await writeContractAsync({
  //       address: CONTRACT_ADDRESS,
  //       abi: NFT_ABI,
  //       functionName: 'mint',
  //       value: parseEther('0.0002'),
  //       dataSuffix,
  //     })
  //     setShowMintModal(false)
  //     toast.success('Genesis NFT minted successfully!')
  //   } catch (err) {
  //     let errorMsg = 'Mint failed. Please try again.'
  //     if (err.message?.includes('insufficient funds')) {
  //       errorMsg = 'Insufficient ETH , make sure you have more than 0.0002 ETH for gas fees'
  //     } else if (err.message?.includes('Max supply')) {
  //       errorMsg = 'Max supply (10,000) reached!'
  //     } else if (err.shortMessage) {
  //       errorMsg = err.shortMessage
  //     }
  //     toast.error(errorMsg)
  //   } finally {
  //     setIsMinting(false)
  //   }
  // }
  // NEW: Handle modal steps progression - Skip if already completed/minted (on-chain check)
  const handleNextStep = () => {
    if (mintStep === 'connectWallet' && walletConnected) {
      setMintStep('connectTwitter')
    } else if (mintStep === 'connectTwitter' && twitterConnected) {
      setMintStep('followX')
    } else if (mintStep === 'followX' && followXCompleted) {
      if (nftMinted) {
        setShowMintModal(false)
      } else {
        setMintStep('mintNFT')
      }
    }
  }
  const handleConnectWallet = () => {
    // Trigger manual connect if needed (but auto-handled by useEffect)
  }
  const handleConnectTwitter = () => {
    connectTwitterMutation.mutate()
  }
  // Render Badge Section - UPDATED: Rely on on-chain nftMinted
  const renderBadgeSection = useCallback(() => {
    return (
      <div className="relative h-full w-full overflow-hidden bg-[#0A0A0A]">
        <div className="absolute top-0 right-0 bottom-0 w-full md:w-[60%]">
          {nftImageSrc ? (
            <Image
              src={nftImageSrc}
              alt="Xynapse Genesis NFT"
              fill
              className="object-cover object-center md:object-right"
              unoptimized={true}
              priority={true}
              onError={(e) => {
                e.target.src = '/placeholder_nft.png'
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[#0A0A0A]/60">
              <Spinner className="h-16 w-16 text-[#00FFFF]" />
            </div>
          )}
        </div>

        <div className="relative h-full flex flex-col justify-center z-10 bg-gradient-to-r from-[#0A0A0A]/95 via-[#0A0A0A]/30 to-transparent">
          <div className="w-full md:w-[30%] pl-8 md:pl-10 lg:pl-12 pr-8 bg-gradient-to-r from-[#0A0A0A]/95 via-[#0A0A0A]/30 to-transparent">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6 flex-wrap">
              <h3 className="text-lg md:text-lg lg:text-xl font-bold text-white">
                Xynapse Genesis NFT
              </h3>
              {nftMinted && (
                <span className="inline-block bg-emerald-500 text-black px-2 py-1 rounded-full text-[9px] md:text-[10px] font-bold shadow-lg flex-shrink-0">
                  Minted
                </span>
              )}
            </div>

            <p className="text-[10px] md:text-xs text-white/90 mb-2 leading-relaxed">
              Welcome to Genesis, the first stage in the Xynapse journey.
            </p>

            <p className="text-[10px] md:text-xs text-white/90 mb-10 leading-relaxed">
              This proprietary NFT is proof-of-concept for early adopters, granting early access to
              advanced tools, early feature launches within the XynapseAI ecosystem, and several
              other future benefits.
            </p>

            {nftMinted ? (
              <div className="space-y-6">
                <p className="text-xs md:text-sm font-medium text-emerald-400">Already owned</p>

                {/* NEW: Button Share */}
                <motion.button
                  onClick={() => {
                    const tweetText = `I just minted my Xynapse Genesis NFT! 🎉\n\nEarly access to advanced AI tools and exclusive benefits in the @xynapseai_ ecosystem.\n\n #Xynapse`
                    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(tweetText)}`
                    window.open(url, '_blank')
                  }}
                  className="w-full max-w-[120px] px-3 py-1.5 bg-transparent border-2 border-white text-white text-xs font-medium rounded-lg hover:bg-white/10 transition-all duration-300 shadow-lg flex items-center justify-center gap-2"
                  whileHover={{ scale: 1 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Share on
                  <img src="/logos/x.webp" alt="X" className="w-4 h-4" />
                </motion.button>
              </div>
            ) : (
              <motion.button
                onClick={() => setShowMintModal(true)}
                className="px-5 py-2 bg-white border border-white text-black text-xs md:text-sm font-bold rounded-lg hover:bg-white/10 transition-all duration-300 shadow-2xl"
                whileHover={{ scale: 1 }}
                whileTap={{ scale: 0.98 }}
              >
                Mint (Free)
              </motion.button>
            )}
          </div>
        </div>
      </div>
    )
  }, [nftMinted, nftImageSrc, setShowMintModal])
  // UPDATED: Render Mint Modal - Professional 3-step with lines, checkmarks, green on complete; skip if minted (on-chain)
  const renderMintModal = () => (
    <AnimatePresence>
      {showMintModal && !nftMinted && (
        <motion.div
          className="fixed inset-0 bg-[#0A0A0A]/90 backdrop-blur-md z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setShowMintModal(false)}
        >
          <motion.div
            className="bg-[#111111] backdrop-blur-xl border border-[#FFFFFF30] rounded-3xl w-full max-w-md lg:max-w-lg relative overflow-hidden shadow-2xl"
            initial={{ scale: isMobile ? 0.85 : 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: isMobile ? 0.85 : 0.9, opacity: 0, y: 20 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={isMobile ? 'p-6' : 'p-8'}>
              <h3 className="text-[#FFFFFF] font-bold text-center mb-8 text-lg lg:text-xl uppercase">
                Mint Process
              </h3>

              {/* Progress steps Follow X */}
              <div className="flex items-center justify-between mb-10">
                {['connectWallet', 'connectTwitter', 'followX', 'mintNFT'].map((step, index) => {
                  const isCompleted =
                    (step === 'connectWallet' && walletConnected) ||
                    (step === 'connectTwitter' && twitterConnected) ||
                    (step === 'followX' && followXCompleted) ||
                    (step === 'mintNFT' && false)
                  const isActive = mintStep === step

                  return (
                    <Fragment key={step}>
                      <div className="flex flex-col items-center gap-3">
                        <div
                          className={`flex items-center justify-center text-base font-bold border-4 transition-all duration-300 rounded-full ${
                            isCompleted
                              ? 'bg-white text-black border-white'
                              : isActive
                                ? 'border-white bg-[#FFFFFF20] text-white shadow-lg shadow-white/20'
                                : 'border-[#FFFFFF40] bg-transparent text-[#AAAAAA]'
                          } ${isMobile ? 'w-9 h-9' : 'w-10 h-10'}`}
                        >
                          {isCompleted ? (
                            <Check className={isMobile ? 'w-4 h-4' : 'w-5 h-5'} />
                          ) : (
                            index + 1
                          )}
                        </div>
                        <span
                          className={`text-[#CCCCCC] capitalize ${isMobile ? 'text-xs' : 'text-sm'}`}
                        >
                          {step === 'connectWallet'
                            ? 'Wallet'
                            : step === 'connectTwitter'
                              ? 'Twitter'
                              : step === 'followX'
                                ? 'Follow X'
                                : 'Mint NFT'}
                        </span>
                      </div>
                      {index < 3 && (
                        <div
                          className={`flex-1 h-0.5 bg-[#FFFFFF30] ${isMobile ? 'mx-2' : 'mx-3'}`}
                        />
                      )}
                    </Fragment>
                  )
                })}
              </div>

              {/* Step content */}
              <div className="w-full max-w-md mx-auto flex flex-col items-center justify-center space-y-8 px-4">
                {/* Step: Connect Wallet */}
                {mintStep === 'connectWallet' && (
                  <div className="w-full text-center space-y-6">
                    <p className={`text-[#CCCCCC] ${isMobile ? 'text-[11px]' : 'text-xs'}`}>
                      Connect your wallet to Base mainnet
                    </p>
                    {walletConnected ? (
                      <div className="flex gap-4 justify-center">
                        <button
                          onClick={() => setShowMintModal(false)}
                          className="px-5 py-2 bg-[#FFFFFF10] text-white rounded-lg hover:bg-[#FFFFFF20] border border-[#FFFFFF30] transition text-sm min-w-[120px]"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleNextStep}
                          className="px-5 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition text-sm min-w-[120px]"
                        >
                          Next
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-center">
                        <OnchainWalletWrapper>
                          <ConnectWallet
                            onConnect={handleConnectWallet}
                            theme="dark"
                            className="px-8 py-3"
                          />
                        </OnchainWalletWrapper>
                      </div>
                    )}
                  </div>
                )}

                {/* Step: Connect Twitter */}
                {mintStep === 'connectTwitter' && (
                  <div className="w-full text-center space-y-6">
                    <p className={`text-[#CCCCCC] ${isMobile ? 'text-[11px]' : 'text-xs'}`}>
                      Connect your X account for verification
                    </p>
                    {twitterConnected ? (
                      <div className="flex gap-4 justify-center">
                        <button
                          onClick={() => setShowMintModal(false)}
                          className="px-5 py-2 bg-[#FFFFFF10] text-white rounded-lg hover:bg-[#FFFFFF20] border border-[#FFFFFF30] transition text-sm min-w-[120px]"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleNextStep}
                          className="px-5 py-2 bg-white text-black rounded-xl font-medium hover:bg-gray-200 transition text-sm min-w-[120px]"
                        >
                          Next
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-center">
                        <button
                          onClick={handleConnectTwitter}
                          className="px-5 py-2 border border-white bg-[#111111] text-white rounded-lg font-medium hover:bg-white/10 transition flex items-center justify-center gap-3 min-w-[260px]"
                        >
                          <span>Connect</span>
                          <img src="/logos/x.webp" alt="X Logo" className="w-5 h-5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Step: Follow X Account */}
                {mintStep === 'followX' && (
                  <div className="w-full text-center space-y-6">
                    <p className={`text-[#CCCCCC] ${isMobile ? 'text-[11px]' : 'text-xs'}`}>
                      Follow our official X account to continue
                    </p>
                    <div className="flex justify-center">
                      <button
                        onClick={() => {
                          setFollowXCompleted(true)
                          handleNextStep()
                        }}
                        disabled={followXCompleted}
                        className="px-3 py-2 text-white border border-white rounded-lg font-medium hover:bg-white/10 transition flex items-center justify-center gap-3 min-w-[280px] disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        <img src="/logos/x.webp" alt="X Logo" className="w-6 h-6" />
                        <span>Follow</span>
                      </button>
                    </div>

                    {followXCompleted && (
                      <div className="flex gap-4 justify-center">
                        <button
                          onClick={() => setShowMintModal(false)}
                          className="px-5 py-2 bg-[#FFFFFF10] text-white rounded-xl hover:bg-[#FFFFFF20] border border-[#FFFFFF30] transition text-sm min-w-[120px]"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleNextStep}
                          className="px-5 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition text-sm min-w-[120px]"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Step: Mint NFT */}
                {mintStep === 'mintNFT' && (
                  <div className="w-full text-center space-y-8">
                    <p className={`text-[#CCCCCC] ${isMobile ? 'text-[11px]' : 'text-xs'}`}>
                      All done! Mint your exclusive Genesis NFT.
                      <br />
                      Make sure you have switched to{' '}
                      <span className="text-blue-500">Base Mainnet</span>.
                    </p>
                    <div
                      className={`relative mx-auto rounded-2xl overflow-hidden shadow-2xl ${isMobile ? 'w-60 h-60' : 'w-64 h-64'}`}
                    >
                      {nftImageSrc ? (
                        <Image
                          src={nftImageSrc}
                          alt="NFT Preview"
                          fill
                          className="object-cover"
                          unoptimized={true}
                          priority
                          onError={(e) => (e.target.src = '/placeholder_nft.png')}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-[#222222]">
                          <Spinner className={isMobile ? 'h-10 w-10' : 'h-12 w-12 text-white'} />
                        </div>
                      )}
                    </div>
                    <div className="flex gap-4 justify-center">
                      {/*<button
                        onClick={() => setShowMintModal(false)}
                        className="px-5 py-2 bg-[#FFFFFF10] text-white rounded-lg hover:bg-[#FFFFFF20] border border-[#FFFFFF30] transition text-sm min-w-[120px]"
                      >
                        Cancel
                      </button>*/}
                      {chainId !== BASE_CHAIN_ID ? (
                        <button
                          onClick={() => switchChainMutation.mutate({ chainId: BASE_CHAIN_ID })}
                          disabled={switchChainMutation.isPending}
                          className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition text-sm min-w-[120px] disabled:opacity-70"
                        >
                          {switchChainMutation.isPending
                            ? 'Switching...'
                            : 'Switch to Base Mainnet'}
                        </button>
                      ) : (
                        <Transaction
                          chainId={BASE_CHAIN_ID}
                          calls={[
                            {
                              to: CONTRACT_ADDRESS,
                              data: encodeFunctionData({
                                abi: NFT_ABI,
                                functionName: 'mint',
                                args: [],
                              }),
                              value: parseEther('0.0002'),
                              dataSuffix,
                            },
                          ]}
                          onStatus={(status) => {
                            console.log('Transaction LifecycleStatus:', status)
                          }}
                          onSuccess={(hash) => {
                            toast.success('Genesis NFT minted successfully!')
                            setShowMintModal(false)
                            refetchNftBalance() // Update nftMinted
                            refetchCounter() // Update preview image
                          }}
                          onError={(err) => {
                            let errorMsg = 'Mint failed. Please try again.'
                            if (err.message?.includes('insufficient funds')) {
                              errorMsg = 'Insufficient ETH; ensure you have more ETH for gas fees.'
                            } else if (err.message?.includes('Max supply')) {
                              errorMsg = 'Max supply (10,000) reached!'
                            } else if (err.shortMessage) {
                              errorMsg = err.shortMessage
                            }
                            toast.error(errorMsg)
                            console.error('Transaction error:', err) // Log error
                          }}
                        >
                          <TransactionButton
                            disabled={!isConnected}
                            className={`px-5 py-2 rounded-lg font-medium transition text-sm min-w-[120px] ${
                              !isConnected
                                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                : 'bg-white text-black hover:bg-gray-200'
                            }`}
                            text="Mint"
                          />
                          <TransactionStatus>
                            <TransactionStatusLabel />
                            <TransactionStatusAction />
                          </TransactionStatus>
                        </Transaction>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
  const renderProfileSection = useCallback(() => {
    if (userLoading) {
      return (
        <div className="h-full flex items-center justify-center">
          <LoadingOverlay isLoading={true} isMobile={isMobile} />
        </div>
      )
    }
    if (userError) {
      return (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="h-full flex items-center justify-center text-red-400 text-sm p-4 text-center"
        >
          Error: {userError.message}
        </motion.div>
      )
    }
    if (!userData) {
      return (
        <div className="h-full flex items-center justify-center text-gray-500 text-xs">
          No profile data available.
        </div>
      )
    }
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
          <div className="h-[30vh] rounded-xl p-3 bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] relative col-span-1 flex flex-col items-center justify-center">
            <div className="absolute top-1 right-1 p-2 flex gap-1 items-center z-10">
              <motion.button
                onClick={() =>
                  queryClient.invalidateQueries({
                    queryKey: ['userData', session?.user?.id, csrfToken],
                  })
                }
                className="p-1 rounded-sm bg-[#FFFFFF]/10 hover:bg-emerald-400/20 transition-all duration-300 z-10 border border-[#FFFFFF20]"
                whileHover={{ scale: 1 }}
                whileTap={{ scale: 0.98 }}
                title="Refresh Profile"
              >
                <RefreshCw className="w-4 h-4 text-[#FFF]" />
              </motion.button>
              <motion.button
                onClick={onSignOut}
                disabled={isSigningOut}
                className={`p-1 rounded-sm bg-[#FFFFFF]/10 ${isSigningOut ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-400/20'} z-10 border border-[#FFFFFF20]`}
                whileHover={{ scale: isSigningOut ? 1 : 1 }}
                whileTap={{ scale: isSigningOut ? 1 : 0.98 }}
                aria-label="Sign out"
              >
                {isSigningOut ? (
                  <span className="text-[8px] sm:text-[10px] text-[#FFF]">Signing out</span>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-4 h-4 text-red-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                )}
              </motion.button>
            </div>
            <div className="relative mb-3 flex justify-center">
              <div
                className={`relative w-20 h-20 sm:w-20 sm:h-20 border-3 rounded-3xl overflow-hidden ${userData.tier === 'Premium' ? 'border-emerald-400' : 'border-[#D4D4D4]'} border-b-transparent`}
              >
                <Image
                  src={getProfilePictureSrc(userData.profilePicture)}
                  alt={userData.googleName || userData.twitterHandle || 'User Avatar'}
                  width={80}
                  height={80}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.src = '/fallback-image.webp' // Ensure fallback on error
                  }}
                />
              </div>
              <div
                className={`w-[65px] sm:w-[65px] absolute -bottom-2 bg-[#0A0A0A] border-2 ${userData.tier === 'Premium' ? 'border-emerald-400' : 'border-[#D4D4D4]'} rounded-lg px-2 py-0.5 flex items-center justify-center text-[8px] sm:text-[9px]`}
              >
                <span
                  className={`font-bold ${userData.tier === 'Premium' ? 'text-emerald-400' : 'text-[#D4D4D4]'}`}
                >
                  {userData.tier}
                </span>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1 mb-3">
              <h4 className="text-xs sm:text-sm font-bold text-[#FFF] bg-gradient-to-r from-[#00FFFF] to-emerald-400 bg-clip-text text-transparent truncate max-w-full">
                {userData.googleName}
              </h4>
              <div className="flex items-center gap-2 text-[#D4D4D4] w-full justify-center">
                <span className="text-[9px] sm:text-[10px] truncate">
                  {showEmail ? fullInfo : maskedInfo}
                </span>
                <motion.button
                  onClick={() => setShowEmail(!showEmail)}
                  className="p-1 rounded-lg hover:bg-[#FFFFFF]/10 transition-colors"
                  whileHover={{ scale: 1 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {showEmail ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </motion.button>
              </div>
            </div>
          </div>
          <div className="h-[30vh] rounded-xl p-3 bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] relative col-span-1">
            {' '}
            {/* Twitter card */}
            <div className="flex items-center mb-3">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <img
                  src="/logos/x.webp"
                  alt="X Logo"
                  className="w-3 h-3 sm:w-4 sm:h-4 text-[#00FFFF] flex-shrink-0"
                />
                <span className="text-[#FFF] font-semibold text-sm flex-shrink-0">Twitter :</span>
                {userData.twitterHandle ? (
                  <div className="flex items-center gap-2 min-w-0">
                    <a
                      href={`https://x.com/${userData.twitterHandle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#FFF] text-sm underline hover:decoration-emerald-400 transition-colors truncate"
                    >
                      @{userData.twitterHandle}
                    </a>
                    <div className="px-1 py-1 flex items-center justify-center flex-shrink-0">
                      <BadgeCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 rounded-full" />
                    </div>
                  </div>
                ) : (
                  <span className="text-[#D4D4D4] text-[10px]">Not Connected</span>
                )}
              </div>
            </div>
            <motion.button
              onClick={() => {
                if (userData.twitterHandle) {
                  disconnectTwitterMutation.mutate({})
                } else {
                  setIsConnectingTwitter(true)
                  setTimeout(() => {
                    window.location.href = '/api/twitter/connect'
                  }, 600)
                }
              }}
              disabled={disconnectTwitterMutation.isLoading || isConnectingTwitter}
              className={`absolute bottom-3 right-3 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 flex items-center justify-center gap-1.5 shadow-lg ${
                userData.twitterHandle
                  ? 'bg-transparent text-red-400 border border-red-400/50 hover:bg-red-400/20 hover:text-red-400'
                  : 'bg-transparent border border-[#00FFFF]/50 text-[#00FFFF] hover:bg-[#00FFFF]/20 hover:text-[#00FFFF]'
              } ${
                disconnectTwitterMutation.isLoading || isConnectingTwitter
                  ? 'opacity-70 cursor-not-allowed'
                  : ''
              }`}
              whileTap={{
                scale: disconnectTwitterMutation.isLoading || isConnectingTwitter ? 1 : 0.98,
              }}
            >
              {disconnectTwitterMutation.isLoading ? (
                <>
                  <BlinkingDots />
                </>
              ) : isConnectingTwitter ? (
                <>
                  <BlinkingDots />
                </>
              ) : userData.twitterHandle ? (
                'Disconnect'
              ) : (
                'Connect'
              )}
            </motion.button>
          </div>
          {/* Wallet card inline - UPDATED: Simplified, no verification */}
          <div className="h-[30vh] rounded-xl p-3 bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] relative flex flex-col col-span-1">
            <div className="w-full flex-1 flex flex-col relative">
              <OnchainWalletWrapper className="w-full flex-1 flex flex-col">
                <div className="flex items-center mb-4">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Wallet className="w-5 h-5 text-[#00FFFF]" />
                    <span className="text-[#FFF] font-semibold text-sm">Wallet</span>
                    {isWalletSaved && (
                      <div className="px-1 py-1 flex items-center justify-center flex-shrink-0 ml-2">
                        <BadgeCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 rounded-full" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    {displayedAddress ? (
                      <>
                        <p
                          className={`text-xs text-[#D4D4D4] flex-1 min-w-0 ${
                            showWallet
                              ? 'whitespace-pre-wrap break-words max-h-[4rem] overflow-y-auto'
                              : 'truncate'
                          }`}
                        >
                          {showWallet
                            ? displayedAddress
                            : `${displayedAddress.slice(0, 6)}...${displayedAddress.slice(-4)}`}
                        </p>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <CopyButton text={userData?.walletAddress || address || ''} size={14} />
                          <motion.button
                            onClick={() => setShowWallet(!showWallet)}
                            className="text-[#D4D4D4] hover:text-[#FFF] transition-colors p-1"
                            whileHover={{ scale: 1 }}
                            whileTap={{ scale: 0.98 }}
                          >
                            {showWallet ? (
                              <EyeOff className="w-3 h-3" />
                            ) : (
                              <Eye className="w-3 h-3" />
                            )}
                          </motion.button>
                        </div>
                      </>
                    ) : (
                      <span className="text-[#D4D4D4] text-[10px]">Not Connected</span>
                    )}
                  </div>

                  <div className="flex-1" />

                  {/* Loading when updating wallet */}
                  {isUpdatingWallet && (
                    <div className="w-full flex justify-center items-center gap-2 text-[10px] text-[#D4D4D4] mb-2">
                      <BlinkingDots />
                    </div>
                  )}
                </div>
              </OnchainWalletWrapper>
            </div>

            {/* Connect/Disconnect button */}
            {isConnected || isWalletSaved ? (
              <motion.button
                onClick={() => disconnectWalletMutation.mutate({})}
                disabled={isUpdatingWallet || disconnectWalletMutation.isLoading}
                className={`absolute bottom-3 right-3 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 flex items-center justify-center gap-1 shadow-lg bg-transparent text-red-400 border border-red-400/50 hover:bg-red-400/20 hover:text-red-400 disabled:opacity-50 z-10`}
                whileTap={{
                  scale: isUpdatingWallet || disconnectWalletMutation.isLoading ? 1 : 0.98,
                }}
              >
                {isUpdatingWallet ? (
                  <>
                    <BlinkingDots />
                  </>
                ) : disconnectWalletMutation.isLoading ? (
                  <BlinkingDots />
                ) : (
                  'Disconnect'
                )}
              </motion.button>
            ) : (
              <ConnectWallet>
                {({ onClick, isLoading }) => (
                  <motion.button
                    onClick={onClick}
                    disabled={isLoading}
                    className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 flex items-center justify-center gap-1 shadow-lg bg-transparent border border-[#00FFFF]/50 text-[#00FFFF] hover:bg-[#00FFFF]/20 hover:text-[#00FFFF] disabled:opacity-50 z-10"
                    whileTap={{ scale: isLoading ? 1 : 0.98 }}
                  >
                    {isLoading ? <BlinkingDots /> : 'Connect'}
                  </motion.button>
                )}
              </ConnectWallet>
            )}
          </div>
          {/* Points card - balanced with others */}
          <div className="h-[30vh] rounded-xl p-3 bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] shadow-[0_4px_12px_rgba(0,0,0,0.3)] glow-[#FFFFFF15] relative col-span-1">
            {/*<div className="absolute inset-0 bg-black/90 backdrop-blur-xl flex items-center justify-center rounded-xl z-10">
              <span className="text-white text-lg font-medium">Coming Soon</span>
            </div>*/}
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-400" />
                <span className="text-[#FFF] font-semibold text-sm">Points</span>
              </div>
            </div>
            <div className="flex flex-col items-center justify-center h-full gap-1">
              <span className="text-white text-3xl sm:text-4xl font-bold m-2">
                {userData?.points || 0}
              </span>
              <div className="flex flex-row text-white/70 text-[10px] items-center gap-2">
                <span>
                  Days Active: <span className="text-white font-bold">{getDaysActive()}</span>
                </span>
                <span
                  className={`flex items-center gap-1 ${userData.streak >= 7 ? 'text-orange-400' : 'text-white/70'}`}
                >
                  {userData.streak >= 7 && (
                    <Flame className="w-3 h-3 text-orange-500 animate-pulse" />
                  )}
                  Streak: <span className="text-white font-bold">{userData.streak}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }, [
    userData,
    userLoading,
    userError,
    isMobile,
    session,
    csrfToken,
    queryClient,
    isSigningOut,
    showEmail,
    showWallet,
    getDaysActive,
    getProfilePictureSrc,
    connectTwitterMutation,
    disconnectTwitterMutation,
    address,
    isConnected,
    isUpdatingWallet,
    disconnectWalletMutation,
    isWalletSaved,
    statusText,
    displayedAddress,
  ]) // remove immediateLoading
  if (!session) {
    return <LoginPrompt />
  }
  const overallLoading = immediateLoading || verifyTaskMutation.isLoading

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="w-full max-w-9xl mx-auto p-2 sm:p-3 bg-[#0A0A0A]/80 backdrop-blur-md flex flex-col h-[calc(100vh-3rem)] overflow-y-auto hide-scrollbar"
    >
      <div className="flex flex-col flex-1 gap-4 sm:gap-5">
        <motion.div
          className="bg-gradient-to-r from-black/40 to-gray-900/40 flex flex-col shadow-xl relative flex-1"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="border-b border-white/15 bg-black/50 rounded-t-xl flex h-[32px] sm:h-[40px] overflow-hidden">
            {['profile'].map((tab) => {
              const isActive = activeTab === tab
              return (
                <motion.button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 text-[9px] sm:text-xs font-bold text-white uppercase tracking-wider py-2 relative transition-all duration-300 flex items-center justify-center gap-1 ${
                    isActive ? 'text-white shadow-lg' : 'text-white/70 hover:text-neon-blue'
                  }`}
                >
                  {tab === 'profile' && <ShieldUser className="w-3 h-3 sm:w-4 sm:h-4" />}
                  {tab === 'tasks' && <BookType className="w-3 h-3 sm:w-4 sm:h-4" />}
                  {tab === 'leaderboard' && <Trophy className="w-3 h-3 sm:w-4 sm:h-4" />}
                  {tab === 'genesis' && <Biohazard className="w-3 h-3 sm:w-4 sm:h-4" />}
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {isActive && (
                    <motion.div
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-white to-emerald-400 rounded-full"
                      layoutId="profileTabIndicator"
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    />
                  )}
                </motion.button>
              )
            })}
          </div>
          <div className="flex-1 overflow-hidden relative">
            <AnimatePresence mode="wait">
              {activeTab === 'profile' && (
                <motion.div
                  key="profile"
                  className="h-full overflow-y-auto hide-scrollbar"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  {renderProfileSection()}
                </motion.div>
              )}
              {/* {activeTab === 'tasks' && (
                <motion.div
                  key="tasks"
                  className="h-full"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  {renderTasksSection()}
                </motion.div>
              )}
              {activeTab === 'leaderboard' && (
                <motion.div
                  key="leaderboard"
                  className="h-full"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  {renderLeaderboardSection()}
                </motion.div>
              )}
              {activeTab === 'genesis' && (
                <motion.div
                  key="genesis"
                  className="h-full overflow-y-auto hide-scrollbar"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  {renderBadgeSection()}
                </motion.div>
              )} */}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
      {/* UPDATED: Render Mint Modal */}
      {renderMintModal()}
      {/* v2 Fallback Modal */}
      <AnimatePresence>
        {showV2Modal && (
          <motion.div
            className="fixed inset-0 bg-[#0A0A0A]/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setShowV2Modal(false)
              setPendingTask(null)
              if (recaptchaV2Ref.current) recaptchaV2Ref.current.reset()
            }}
          >
            <motion.div
              className="bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#FFFFFF20] rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-[#FFF] font-bold mb-4 text-sm">Security Verification</h3>
              <p className="text-[#D4D4D4] mb-6 text-xs">
                To protect your account, please verify you are human by checking the box below.
              </p>
              <ReCAPTCHA
                ref={recaptchaV2Ref}
                sitekey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY} // Use same or separate V2 key
                onChange={handleV2Change}
                size="normal"
              />
              <motion.button
                onClick={() => {
                  setShowV2Modal(false)
                  setPendingTask(null)
                  if (recaptchaV2Ref.current) recaptchaV2Ref.current.reset()
                }}
                className="mt-4 px-4 py-2 bg-[#FFFFFF]/10 text-[#FFF] rounded-lg hover:bg-[#FFFFFF]/20 text-xs transition-colors border border-[#FFFFFF20]"
                whileHover={{ scale: 1 }}
                whileTap={{ scale: 0.98 }}
              >
                Cancel
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <style jsx>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .animate-pulse {
          animation: ${isMobile ? 'none' : 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite'};
        }
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
        .animate-shimmer {
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255, 255, 255, 0.1) 50%,
            transparent 100%
          );
          animation: shimmer 1.5s infinite;
        }
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        .glow-emerald {
          box-shadow: 0 0 20px rgba(6, 78, 59, 0.3);
        }
        .glow-nft {
          box-shadow: 0 0 20px rgba(0, 255, 255, 0.3);
        }
        .animate-glow {
          animation: glow 2s ease-in-out infinite alternate;
        }
        @keyframes glow {
          from {
            opacity: 0.5;
          }
          to {
            opacity: 1;
          }
        }
        .animate-scan {
          animation: scan 3s linear infinite;
        }
        .animate-scan-slow {
          animation: scan 5s linear infinite;
        }
        @keyframes scan {
          0% {
            transform: translateY(-100%);
          }
          100% {
            transform: translateY(100%);
          }
        }
        .animate-pulse-slow {
          animation: pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @media (max-width: 640px) {
          .text-base {
            font-size: 0.875rem;
          }
          .text-lg {
            font-size: 1rem;
          }
          .text-xl {
            font-size: 1rem;
          }
          .text-2xl {
            font-size: 1.25rem;
          }
          .text-[11px] {
            font-size: 9px;
          }
          .text-[9px] {
            font-size: 7px;
          }
          .text-[8px] {
            font-size: 6px;
          }
          .h-[52px] {
            height: 48px;
          }
          .min-h-[100px] {
            min-height: 80px;
          }
          .grid-cols-4 {
            grid-template-columns: repeat(1, 1fr);
          } /* Stack on mobile */
        }
        @media (min-width: 641px) and (max-width: 1024px) {
          .grid-cols-4 {
            grid-template-columns: repeat(2, 1fr);
          } /* 2 cols on tablet */
        }
      `}</style>
    </motion.div>
  )
}
