'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { FileSpreadsheet, CornerDownRight } from 'lucide-react'
interface MainContentProps {
  mousePos: { x: number; y: number }
}

function CountUp({
  end,
  duration = 2000,
  suffix = '',
}: {
  end: number
  duration?: number
  suffix?: string
}) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const animated = useRef(false)

  useEffect(() => {
    if (animated.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !animated.current) {
          animated.current = true
          let startTime: number | null = null
          const step = (timestamp: number) => {
            if (!startTime) startTime = timestamp
            const progress = timestamp - startTime
            const value = Math.min(Math.floor((progress / duration) * end), end)
            setCount(value)
            if (progress < duration) {
              requestAnimationFrame(step)
            }
          }
          requestAnimationFrame(step)
        }
      },
      { threshold: 0.1 },
    )

    if (ref.current) {
      observer.observe(ref.current)
    }

    return () => {
      if (ref.current) {
        observer.unobserve(ref.current)
      }
    }
  }, [end, duration])

  return (
    <span ref={ref}>
      {count}
      {suffix}
    </span>
  )
}

export default function MainContent({ mousePos }: MainContentProps) {
  return (
    <main className="flex-1 flex items-center justify-between px-8 py-12 overflow-hidden">
      {/* Left Content */}
      <div className="flex-1 z-10 max-w-2xl space-y-6">
        <div className="space-y-4">
          <div className="relative inline-flex overflow-hidden rounded-full p-[1px]">
            <span className="absolute inset-[-1000%] animate-[spin_4s_linear_infinite] bg-[conic-gradient(from_90deg_at_50%_50%,#0000_0%,#0000_50%,#3b82f6_75%,#22c55e_100%)]" />
            <span className="inline-flex h-full w-full cursor-default items-center justify-center rounded-full bg-black px-3 py-1 text-sm font-bold tracking-widest text-white backdrop-blur-3xl">
              AI-powered insights
            </span>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-white leading-tight tracking-tight">
            ADVANCED ON-CHAIN ANALYTICS
          </h2>
          <p className="text-xs sm:text-sm text-white/60 text-lg leading-relaxed max-w-xl">
            The platform combines real-time market data, ETF analytics, blockchain explorers, wallet
            clustering, network graphs
          </p>
        </div>
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 pt-8">
          <div className="p-4 border border-white/10 rounded-lg bg-white/5 backdrop-blur-sm hover:bg-white/10 transition-all group">
            <p className="text-white text-xl sm:text-2xl font-bold group-hover:text-white/80 transition-colors">
              <CountUp end={99} suffix="%" />
            </p>
            <p className="text-white/50 text-xs tracking-wider mt-1">DATA ACCURACY</p>
          </div>
          <div className="p-4 border border-white/10 rounded-lg bg-white/5 backdrop-blur-sm hover:bg-white/10 transition-all group">
            <p className="text-white text-xl sm:text-2xl font-bold group-hover:text-white/80 transition-colors">
              <CountUp end={1834} />
            </p>
            <p className="text-white/50 text-xs tracking-wider mt-1">DAILY QUERIES</p>
          </div>
          <div className="p-4 border border-white/10 rounded-lg bg-white/5 backdrop-blur-sm hover:bg-white/10 transition-all group">
            <p className="text-white text-xl sm:text-2xl font-bold group-hover:text-white/80 transition-colors">
              &gt;1M
            </p>
            <p className="text-white/50 text-xs tracking-wider mt-1">LABELS</p>
          </div>
        </div>
        {/* CTA Buttons */}
        <div className="flex gap-4 pt-4">
          <Link
            href="/dashboard"
            target="_blank"
            className="px-6 py-1.5 bg-white text-xs sm:text-sm text-black font-bold tracking-wider rounded-xl shadow-lg shadow-white/40 hover:shadow-white/60 transition-all flex items-center"
          >
            LAUNCH APP
            <span className="ml-2">
              <CornerDownRight size={18} />
            </span>
          </Link>
          <Link
            href="/docs"
            target="_blank"
            className="px-6 py-1.5 border-2 border-white/50 text-xs sm:text-sm text-white font-bold tracking-wider rounded-xl hover:bg-white/10 transition-all"
          >
            Documentation
          </Link>
        </div>
      </div>
    </main>
  )
}
