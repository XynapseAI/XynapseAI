'use client'

import { Suspense, useState } from 'react'
import ClusterTab from './ClusterTab'
import { CurrencyProvider } from './CurrencyContext'
import { ToastContainer } from 'react-toastify'
import { useRef } from 'react'
import { useSearchParams } from 'next/navigation'

export default function ClusterPage({ initialClusterId }) {
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('subtab') || 'portfolio' // Preserve subtab từ URL
  })
  const searchParams = useSearchParams()
  const recaptchaRef = useRef(null)
  const finalClusterId = searchParams.get('clusterId') || initialClusterId

  return (
    <div className="min-h-screen bg-black">
      <CurrencyProvider>
        <Suspense
          fallback={
            <div className="flex justify-center items-center h-screen bg-black/80 text-white">
              <div className="animate-spin rounded-full border-2 border-white/20 border-t-white w-8 h-8" />
              <span className="ml-2">Loading cluster data...</span>
            </div>
          }
        >
          <ClusterTab
            recaptchaRef={recaptchaRef}
            initialClusterId={finalClusterId}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
          />
        </Suspense>
        <ToastContainer
          position="top-center"
          autoClose={5000}
          theme="dark"
          toastStyle={{
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '16px',
          }}
        />
      </CurrencyProvider>
    </div>
  )
}
