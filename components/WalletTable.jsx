// components/WalletTable.jsx
'use client';

import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function WalletTable({ recaptchaRef }) {
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchWallets() {
      setLoading(true);
      try {
        const recaptchaToken = await recaptchaRef.current.executeAsync();
        const response = await axios.get('/api/nametags?page=1', {
          headers: {
            'Content-Type': 'application/json',
            'X-Recaptcha-Token': recaptchaToken,
          },
        });
        if (response.data.success) {
          setWallets(
            Object.entries(response.data.data).map(([address, data]) => ({
              address,
              nametag: data.Labels[Object.keys(data.Labels)[0]]['Name Tag'],
              is_deposit: data.Labels[Object.keys(data.Labels)[0]]['Name Tag'].includes('Exchange') || data.Labels[Object.keys(data.Labels)[0]]['Name Tag'].includes('Deposit'),
            }))
          );
        } else {
          throw new Error(response.data.detail || 'Failed to fetch wallets');
        }
      } catch (err) {
        setError(`Failed to load wallets: ${err.message}`);
      } finally {
        setLoading(false);
        if (recaptchaRef.current) recaptchaRef.current.reset();
      }
    }
    if (recaptchaRef.current) fetchWallets();
  }, [recaptchaRef]);

  if (loading) return <p>Loading wallets...</p>;
  if (error) return <p className="text-red-500">{error}</p>;

  return (
    <div className="p-4 bg-tech border border-white/10 rounded-xl shadow-card">
      <h2 className="text-xl font-bold mb-4">Wallet Nametags</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="border border-white/10 p-2 text-left">Address</th>
            <th className="border border-white/10 p-2 text-left">Nametag</th>
            <th className="border border-white/10 p-2 text-left">Is Deposit</th>
          </tr>
        </thead>
        <tbody>
          {wallets.map((wallet) => (
            <tr key={wallet.address}>
              <td className="border border-white/10 p-2">{wallet.address}</td>
              <td className="border border-white/10 p-2">{wallet.nametag}</td>
              <td className="border border-white/10 p-2">{wallet.is_deposit ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}