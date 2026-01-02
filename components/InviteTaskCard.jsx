'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Users, Copy, Check, HelpCircle } from 'lucide-react'
import axios from 'axios'
import { toast } from 'react-toastify'
import { useQueryClient } from '@tanstack/react-query'
import { clearCache } from '../utils/indexedDB'

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

export default function InviteTaskCard({ userData, task, csrfToken, index }) {
  const [inputCode, setInputCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')
  const [showTooltip, setShowTooltip] = useState(false)
  const queryClient = useQueryClient()

  const hasUsedInvite = !!userData?.invited_by
  const invitedCount = userData?.invited_count || userData?.invitedCount || 0

  const handleSubmitInvite = async () => {
    if (!inputCode.trim()) {
      setSubmitMessage('Please enter an invite code')
      return
    }
    setIsSubmitting(true)
    setSubmitMessage('')
    try {
      const response = await axios.post(
        '/api/referral',
        { inviteCode: inputCode.trim().toUpperCase() },
        { headers: { 'x-csrf-token': csrfToken } },
      )
      if (response.data.success) {
        queryClient.setQueryData(['userData', userData.id, csrfToken], (oldData) => ({
          ...oldData,
          invited_by: true,
          points: (oldData?.points || 0) + 50,
        }))

        const userCacheKey = `userData-${userData.id}`
        const leaderboardCacheKey = `leaderboard-${userData.id}`
        await Promise.all([clearCache(userCacheKey), clearCache(leaderboardCacheKey)])
        await Promise.all([
          queryClient.invalidateQueries(['userData']),
          queryClient.invalidateQueries(['leaderboard']),
        ])
        await Promise.all([
          queryClient.refetchQueries(['userData']),
          queryClient.refetchQueries(['leaderboard']),
        ])

        window.history.replaceState({}, '', '?inviteSuccess=true')
        setSubmitMessage('Success! You received 50 points. Inviter received 20 points.')
        toast.success('Referral successful! +50 points')
        setInputCode('')
      }
    } catch (err) {
      const msg = err.response?.data?.detail || 'Invalid or expired invite code'
      setSubmitMessage(msg)
      toast.error(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopyLink = () => {
    if (!userData?.inviteCode) return
    const link = `${window.location.origin}?invite=${userData.inviteCode}`
    navigator.clipboard.writeText(link)
    toast.success('Invite link copied!')
  }

  return (
    <motion.div
      className="h-[22vh] bg-[#0A0A0A]/80 backdrop-blur-md border border-[#FFFFFF20] rounded-2xl shadow-2xl p-4 flex flex-col overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.02 }}
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-2 sm:mb-3">
        <div className="flex items-center gap-1 sm:gap-2">
          <Users className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
          <div className="flex items-center gap-1">
            <h4 className="text-xs sm:text-sm font-bold text-[#FFF]">{task.description}</h4>
            <div className="relative">
              <HelpCircle
                className="w-3 h-3 sm:w-4 sm:h-4 text-[#D4D4D4] cursor-help"
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
              />
              {showTooltip && (
                <div className="absolute top-full left-0 mt-2 p-2 bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#FFFFFF20] rounded-lg text-[10px] sm:text-[11px] text-[#D4D4D4] z-50 w-56 sm:w-64 shadow-2xl">
                  The inviter will receive 20 points per successful invite, each user can invite up
                  to 50 other users. The person entering the invite code will receive 50 points
                  (once only).
                </div>
              )}
            </div>
          </div>
        </div>
        <span className="text-xs sm:text-sm font-bold text-emerald-400">+{task.points}/ref</span>
      </div>

      {/* Main content: always row, with responsive adjustments */}
      <div className="flex-1 flex flex-row gap-2 sm:gap-6 items-center">
        {/* Left: Invited count + Your Invite Code */}
        <div className="flex-1 flex flex-col justify-center gap-1 sm:gap-3 min-w-0">
          <div className="flex flex-col gap-0 sm:gap-1">
            <div className="flex items-center gap-1 sm:gap-2">
              <p className="text-[10px] sm:text-xs text-[#D4D4D4]">Your Invite Code</p>
              <p className="text-[10px] sm:text-[11px] text-[#D4D4D4]">
                (
                <span
                  className={`font-bold ${invitedCount >= 50 ? 'text-red-400' : 'text-emerald-400'}`}
                >
                  {invitedCount}
                </span>
                /50
                {invitedCount >= 50 && <span className="text-red-400"> (Max reached)</span>})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <span className="text-sm font-bold text-emerald-400 font-mono truncate">
              {userData?.inviteCode || 'Loading...'}
            </span>
            <button
              onClick={handleCopyLink}
              disabled={!userData?.inviteCode}
              className="p-1 sm:p-1.5 rounded-lg bg-[#FFFFFF]/10 hover:bg-[#FFFFFF]/20 transition-colors disabled:opacity-50 flex-shrink-0"
            >
              <Copy className="w-2 h-2 sm:w-3 sm:h-3 text-[#FFF]" />
            </button>
          </div>
        </div>

        {/* Right: Nhập code */}
        <div className="flex-1 flex flex-col justify-center gap-1 sm:gap-2 min-w-0">
          {hasUsedInvite ? (
            <p className="text-[10px] sm:text-xs text-emerald-400 text-center flex items-center justify-center gap-1">
              <Check className="w-3 h-3 sm:w-4 sm:h-4" />
              Already used invite code.
            </p>
          ) : (
            <>
              <p className="text-[10px] sm:text-xs text-[#D4D4D4]">Enter friend's invite code</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                  placeholder="DP949G7H..."
                  disabled={isSubmitting}
                  className="flex-1 p-1 sm:flex-none sm:w-42 px-2 sm:px-1 py-1.5 sm:py-1.5 bg-[#0A0A0A]/80 border border-[#FFFFFF30] rounded-sm text-[10px] sm:text-[11px] text-[#FFF] placeholder-[#D4D4D4]/70 focus:outline-none focus:border-emerald-400/70"
                  maxLength={20}
                />
                <button
                  onClick={handleSubmitInvite}
                  disabled={isSubmitting || !inputCode.trim()}
                  className={`p-1.5 sm:p-1.5 py-1.5 sm:py-1.5 rounded-sm font-medium text-sm transition-colors flex items-center justify-center gap-1.5 ${
                    isSubmitting || !inputCode.trim()
                      ? 'bg-[#FFFFFF]/10 border border-[#FFFFFF20] text-[#FFF]/50 cursor-not-allowed'
                      : 'bg-transparent border border-[#FFFFFF] text-[#FFF] hover:bg-[#FFFFFF]/10'
                  }`}
                >
                  {isSubmitting ? (
                    <BlinkingDots />
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-4 h-4"
                    >
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              </div>
              {submitMessage && (
                <p
                  className={`text-[10px] sm:text-xs text-center ${submitMessage.includes('Success') ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  {submitMessage}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}
