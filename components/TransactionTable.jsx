// components/TransactionTable.jsx
'use client';

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { logger } from '../utils/logger';

export default function TransactionTable({ recaptchaRef, walletAddress }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchTransactions() {
      setLoading(true);
      try {
        const recaptchaToken = await recaptchaRef.current.executeAsync();
        const response = await axios.post(
          '/api/ai-interaction',
          {
            interactionType: 'detect-large-flow',
            walletAddress: walletAddress || '0x1234567890abcdef1234567890abcdef12345678', // Default wallet
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-Recaptcha-Token': recaptchaToken,
            },
          }
        );
        if (response.data.success) {
          setTransactions(response.data.data.large_flows || []);
        } else {
          throw new Error(response.data.detail || 'Failed to fetch transactions');
        }
      } catch (err) {
        logger.error('Error fetching large transactions:', { message: err.message });
        setError(`Failed to load transactions: ${err.message}`);
      } finally {
        setLoading(false);
        if (recaptchaRef.current) recaptchaRef.current.reset();
      }
    }
    if (recaptchaRef.current) fetchTransactions();
  }, [recaptchaRef, walletAddress]);

  if (loading) return <p>Loading transactions...</p>;
  if (error) return <p className="text-red-500">{error}</p>;

  return (
    <div className="p-4 bg-tech border border-white/10 rounded-xl shadow-card mt-4">
      <h2 className="text-xl font-bold mb-4">Large Transactions (1M USD)</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="border border-white/10 p-2 text-left">Hash</th>
            <th className="border border-white/10 p-2 text-left">Wallet</th>
            <th className="border border-white/10 p-2 text-left">Value (USD)</th>
            <th className="border border-white/10 p-2 text-left">To Address</th>
            <th className="border border-white/10 p-2 text-left">Nametag</th>
            <th className="border border-white/10 p-2 text-left">Time</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr key={tx.hash}>
              <td className="border border-white/10 p-2">{tx.hash}</td>
              <td className="border border-white/10 p-2">{tx.wallet}</td>
              <td className="border border-white/10 p-2">{tx.value_usd.toFixed(2)}</td>
              <td className="border border-white/10 p-2">{tx.to}</td>
              <td className="border border-white/10 p-2">{tx.nametag_to}</td>
              <td className="border border-white/10 p-2">{tx.block_time}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}