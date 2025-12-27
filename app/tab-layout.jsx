// app/tab-layout.jsx
'use client'

import Header from '@/components/Header'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

const tabMap = {
  dex: 'dex',
  etf: 'etf',
  cluster: 'cluster',
  graph: 'graph',
  explorer: 'explorer',
  profile: 'profile',
  watchlist: 'watchlist',
  market: 'market',
}

export default function TabLayout({ children, initialTab }) {
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState(initialTab)

  useEffect(() => {
    if (initialTab && tabMap[initialTab]) {
      setActiveTab(initialTab)
      return
    }

    const tabFromUrl = searchParams.get('tab')
    if (tabFromUrl && tabMap[tabFromUrl]) {
      setActiveTab(tabFromUrl)
    } else if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab, searchParams])

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-black to-gray-900 text-white">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        handleSignOut={() => {}}
        selectedAddress={searchParams.get('address') || undefined}
      />
      <main className="flex-1">{children}</main>
    </div>
  )
}
