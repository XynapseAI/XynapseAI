// app/cluster/page.jsx
import { Suspense } from 'react';
import ClusterTab from '../../components/ClusterTab';
import Header from '../../components/Header';
import { CurrencyProvider } from '../../components/CurrencyContext';
import { ToastContainer } from 'react-toastify';

export default function ClusterPage({ searchParams }) {
  const exchangeId = searchParams.exchangeId || 'binance';

  return (
    <div className="min-h-screen bg-black">
      <Header />
      <CurrencyProvider>
        <Suspense
          fallback={
            <div className="flex justify-center items-center h-screen bg-black/80 text-white">
              <div className="animate-spin rounded-full border-2 border-white/20 border-t-white w-8 h-8" />
              <span className="ml-2">Loading cluster data...</span>
            </div>
          }
        >
          <ClusterTabWrapper exchangeId={exchangeId} />
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
  );
}

// Client component to handle useSearchParams
function ClusterTabWrapper({ exchangeId }) {
  'use client';
  const { useRef } = require('react');
  const { useSearchParams } = require('next/navigation');
  const searchParams = useSearchParams();
  const recaptchaRef = useRef(null);
  const finalExchangeId = searchParams.get('exchangeId') || exchangeId;

  return <ClusterTab recaptchaRef={recaptchaRef} initialExchangeId={finalExchangeId} toast={ToastContainer} />;
}