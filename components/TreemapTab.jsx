// components\TreemapTab.jsx
'use client';
import { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isAddress } from 'ethers';
import throttle from 'lodash.throttle';
import crypto from 'crypto-js';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { formatDistanceToNow } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { chains, mapCoinGeckoChains, getPlatformImage } from '../utils/constants';
import { getExplorerUrls } from '@/utils/helpers';
import { cacheData, getCachedData } from '../utils/indexedDB';
import axios from 'axios';
import { logger } from '../utils/clientLogger';
import { Virtuoso } from 'react-virtuoso';
import { TableVirtuoso } from 'react-virtuoso';
import { lazy, Suspense } from 'react';
import ForceGraph from 'force-graph';
import * as d3 from 'd3-force';
// Fixed: Lazy load pure TF.js only (no node backend in client)
const TensorFlowJS = lazy(() => import('@tensorflow/tfjs')); // Direct import, no concat needed in client
const formatLargeNumber = (value, decimals = 1) => {
  const absValue = Math.abs(value);
  if (absValue >= 1e9) {
    return `${Number((value / 1e9).toFixed(decimals))}B`;
  } else if (absValue >= 1e6) {
    return `${Number((value / 1e6).toFixed(decimals))}M`;
  } else if (absValue >= 1e3) {
    return `${Number((value / 1e3).toFixed(decimals))}K`;
  }
  return Number(value.toFixed(decimals)).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};
const truncateAddress = (addr) => {
  if (!addr) return 'N/A';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
};
const isValidNametagImage = (image) => {
  return image && image !== '/icons/default.webp';
};
const SUPPORTED_CHAINS = [
  '1', '56', '10', '130', '137', '42161', '59144', 'solana', 'tron', 'bitcoin',
];
const isValidDate = (date) => {
  return date instanceof Date && !isNaN(date);
};
const getExplorerLogo = (selectedChain) => {
  if (selectedChain === 'bitcoin') {
    return '/logos/mempool-logo.webp';
  }
  return '/logos/etherscan-logo.webp';
};
const VirtuosoTable = memo(({ transactions, isMobile, selectedChain, tokenImages, nametags, filterType, rootAddress }) => {
  if (!transactions || !Array.isArray(transactions)) {
    logger.warn('Invalid transactions in VirtuosoTable:', transactions);
    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
        className={`bg-black/10 backdrop-blur-md border border-white/10 rounded-xl p-3 max-h-[calc(100vh-12rem)] hide-scrollbar ${isMobile ? 'w-full mt-2' : 'w-96 fixed right-4 top-32'}`}
      >
        <h4 className="text-white text-[10px] sm:text-[12px] font-bold uppercase tracking-wider mb-2">Transactions</h4>
        <p className="text-white/60 text-[9px] sm:text-[10px]">No transactions available.</p>
      </motion.div>
    );
  }
  const handleCopyAddress = (address) => {
    navigator.clipboard.writeText(address);
    toast.success('Address copied to clipboard!', {
      position: 'top-center',
      autoClose: 2000,
      hideProgressBar: true,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      theme: 'dark',
    });
  };
  const filteredTransactions = useMemo(() => {
    const filtered = transactions.filter((tx) => {
      if (filterType === 'all') return true;
      if (filterType === 'incoming') {
        return tx.type === 'incoming' && tx.target?.toLowerCase() === rootAddress?.toLowerCase();
      }
      if (filterType === 'outgoing') {
        return tx.type === 'outgoing' && tx.source?.toLowerCase() === rootAddress?.toLowerCase();
      }
      return false;
    });
    logger.log('Filtered transactions in VirtuosoTable:', filtered);
    return filtered;
  }, [transactions, filterType, rootAddress]);
  if (filteredTransactions.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
        className={`bg-black/50 backdrop-blur-md border border-white/10 rounded-xl p-3 max-h-[calc(100vh-12rem)] hide-scrollbar ${isMobile ? 'w-full mt-2' : 'w-96 fixed right-4 top-32'}`}
      >
        <h4 className="text-white text-[10px] sm:text-[12px] font-bold uppercase tracking-wider mb-2">Transactions</h4>
        <p className="text-white/60 text-[9px] sm:text-[10px]">
          {filterType === 'all' ? 'Select a wallet or cluster to view transactions.' : `No ${filterType} transactions found.`}
        </p>
      </motion.div>
    );
  }
  const fixedHeaderContent = () => (
    <tr className="grid grid-cols-[2fr_1fr_1fr] gap-2">
      <th className="px-2 py-1 text-white font-medium text-left overflow-hidden border-r border-white/5">From/To</th>
      <th className="px-2 py-1 text-white font-medium text-center overflow-hidden border-r border-white/5">Value</th>
      <th className="px-2 py-1 text-white font-medium text-center overflow-hidden">Details</th>
    </tr>
  );
  const Row = (index, tx) => {
    if (!tx) {
      console.error(`No transaction data at index ${index}`);
      return null;
    }
    let tokenLogo = '/icons/default.webp';
    let displaySymbol = tx.tokenSymbol || 'N/A';
    if (selectedChain === 'bitcoin' && displaySymbol.toLowerCase() === 'btc') {
      tokenLogo = '/logos/bitcoin.webp';
      displaySymbol = 'BTC';
    } else {
      const tokenKey = tx.contractAddress?.toLowerCase() || tx.tokenSymbol?.toLowerCase();
      const tokenInfoItem = tokenImages[tokenKey];
      tokenLogo = tokenInfoItem?.image || '/icons/default.webp';
      displaySymbol = tokenInfoItem?.symbol || tx.tokenSymbol || 'N/A';
    }
    const fromNtag = nametags[tx.source?.toLowerCase()] || { name: 'Unknown', image: '/icons/default.webp' };
    const toNtag = nametags[tx.target?.toLowerCase()] || { name: 'Unknown', image: '/icons/default.webp' };
    const displayValue = formatLargeNumber(Number(tx.value) || 0, 1);
    const { txUrl } = getExplorerUrls(selectedChain, tx.hash, '');
    const explorerLogo = getExplorerLogo(selectedChain);
    let formattedTime = 'N/A';
    if (tx.block_time) {
      const blockTime = typeof tx.block_time === 'number' ? tx.block_time * 1000 : tx.block_time;
      const date = new Date(blockTime);
      if (isValidDate(date)) {
        formattedTime = formatDistanceToNow(date, { addSuffix: true });
      } else {
        logger.warn(`Invalid block_time for tx ${tx.hash}: ${tx.block_time}`);
      }
    }
    return (
      <tr key={`${tx.hash}-${index}`} className="grid grid-cols-[2fr_1fr_1fr] gap-2 border-t border-white/10 hover:bg-white/5 transition-all duration-300">
        <td className="px-2 py-1 text-white/80 text-[8px] sm:text-[10px] text-left overflow-hidden border-r border-white/5 align-middle">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-1 group relative">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`h-3 w-3 ${tx.type === 'incoming' ? 'text-neon-blue' : 'text-red-500'} flex-shrink-0`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                {tx.type === 'incoming' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                )}
              </svg>
              {isValidNametagImage(fromNtag.image) && (
                <img
                  src={fromNtag.image}
                  alt="From wallet logo"
                  width={isMobile ? 12 : 14}
                  height={isMobile ? 12 : 14}
                  className="rounded-full flex-shrink-0"
                  onError={(e) => (e.target.style.display = 'none')}
                  loading="lazy"
                />
              )}
              <span className="text-[8px] sm:text-[9px] truncate flex-1 min-w-0">
                {fromNtag.name !== 'Unknown' ? fromNtag.name : truncateAddress(tx.source)}
              </span>
              <motion.button
                className="ml-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => handleCopyAddress(tx.source)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 text-white/60 hover:text-neon-blue"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </motion.button>
            </div>
            <div className="flex items-center gap-1 group relative">
              <div className="w-3 h-3 flex-shrink-0" />
              {isValidNametagImage(toNtag.image) && (
                <img
                  src={toNtag.image}
                  alt="To wallet logo"
                  width={isMobile ? 12 : 14}
                  height={isMobile ? 12 : 14}
                  className="rounded-full flex-shrink-0"
                  onError={(e) => (e.target.style.display = 'none')}
                  loading="lazy"
                />
              )}
              <span className="text-[8px] sm:text-[9px] truncate flex-1 min-w-0">
                {toNtag.name !== 'Unknown' ? toNtag.name : truncateAddress(tx.target)}
              </span>
              <motion.button
                className="ml-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => handleCopyAddress(tx.target)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 text-white/60 hover:text-neon-blue"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </motion.button>
            </div>
          </div>
        </td>
        <td className="px-2 py-1 text-white/80 text-[9px] sm:text-[11px] text-center overflow-hidden border-r border-white/5 align-middle">
          <div className="flex flex-col items-center justify-center gap-1">
            <img
              src={tokenLogo}
              alt={`${displaySymbol} logo`}
              width={isMobile ? 14 : 16}
              height={isMobile ? 14 : 16}
              className="rounded-full flex-shrink-0"
              onError={(e) => (e.target.src = '/icons/default.webp')}
              loading="lazy"
            />
            <span className="text-[8px] sm:text-[9px] font-semibold text-center truncate w-full">
              {displayValue} {displaySymbol}
            </span>
          </div>
        </td>
        <td className="px-2 py-1 text-white/80 text-[9px] sm:text-[11px] text-center overflow-hidden align-middle">
          <div className="flex flex-col items-center justify-center gap-1">
            <a href={txUrl} target="_blank" rel="noopener noreferrer">
              <img
                src={explorerLogo}
                alt="Explorer"
                width={isMobile ? 12 : 14}
                height={isMobile ? 12 : 14}
                className="rounded-full mx-auto cursor-pointer flex-shrink-0"
                onError={(e) => (e.target.src = '/icons/default.webp')}
                loading="lazy"
              />
            </a>
            <span className="text-[7px] sm:text-[8px] text-white/60 text-center truncate w-full">
              {formattedTime}
            </span>
          </div>
        </td>
      </tr>
    );
  };
  const tableHeight = isMobile ? 'auto' : 'calc(100vh - 8rem)';
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className={`bg-black/10 backdrop-blur-md border border-white/10 rounded-xl p-3 hide-scrollbar ${isMobile ? 'w-full mt-2 overflow-auto max-h-[50vh]' : 'w-96 fixed right-4 top-32'}`}
      style={{ height: tableHeight, minHeight: '400px' }}
    >
      <h4 className="text-white text-[10px] sm:text-[12px] font-bold uppercase tracking-wider mb-2">Transactions</h4>
      <TableVirtuoso
        data={filteredTransactions}
        fixedHeaderContent={fixedHeaderContent}
        itemContent={Row}
        style={{
          height: tableHeight,
          maxHeight: '70vh',
          width: '100%',
          overflowX: 'hidden',
        }}
        className="hide-scrollbar"
        components={{
          Table: ({ children, ...props }) => (
            <table
              {...props}
              className="w-full text-[8px] sm:text-[9px] bg-black/5 rounded-xl border-collapse"
              style={{ ...props.style, tableLayout: 'fixed', width: '100%', borderCollapse: 'collapse' }}
            >
              {children}
            </table>
          ),
          TableHead: ({ children, ...props }) => (
            <thead
              {...props}
              className="border-b border-white/10 bg-black/10 sticky top-0 z-10"
            >
              {children}
            </thead>
          ),
          TableBody: ({ children, ...props }) => (
            <tbody
              {...props}
              className="w-full hide-scrollbar"
              style={{ ...props.style }}
            >
              {children}
            </tbody>
          ),
          EmptyPlaceholder: () => (
            <tbody>
              <tr>
                <td colSpan={3} className="text-center text-white/60 text-[9px] sm:text-[10px] py-4">
                  No transactions available
                </td>
              </tr>
            </tbody>
          ),
          Scroller: (props) => (
            <div
              {...props}
              className="hide-scrollbar"
              style={{ ...props.style, overflowX: 'hidden', overflowY: 'auto' }}
            />
          ),
        }}
        overscan={200} // Reduced from 400 for faster rendering
      />
    </motion.div>
  );
});
const TrendChart = memo(({ transactions, velocity }) => {
  const getTimeInterval = useCallback((timestamps) => {
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const range = maxTime - minTime;
    if (range > 30 * 24 * 3600 * 1000) return 'monthly';
    if (range > 7 * 24 * 3600 * 1000) return 'weekly';
    return 'daily';
  }, []);
  const chartData = useMemo(() => {
    if (transactions.length === 0) return [];
    const validTxs = transactions.filter(tx => {
      const bt = typeof tx.block_time === 'number' ? tx.block_time * 1000 : tx.block_time;
      return bt && !isNaN(new Date(bt).getTime());
    });
    if (validTxs.length === 0) return [];
    const timestamps = validTxs.map(tx => {
      const bt = typeof tx.block_time === 'number' ? tx.block_time * 1000 : tx.block_time;
      return new Date(bt).getTime();
    });
    const interval = getTimeInterval(timestamps);
    const aggregated = {};
    validTxs.forEach(tx => {
      const date = new Date(typeof tx.block_time === 'number' ? tx.block_time * 1000 : tx.block_time);
      let key;
      if (interval === 'monthly') {
        key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      } else if (interval === 'weekly') {
        const weekStart = new Date(date.setDate(date.getDate() - date.getDay()));
        key = weekStart.toISOString().split('T')[0];
      } else {
        key = date.toISOString().split('T')[0];
      }
      if (!aggregated[key]) {
        aggregated[key] = { value: 0, count: 0 };
      }
      aggregated[key].value += Number(tx.usdValue || tx.value || 0);
      aggregated[key].count += 1;
    });
    return Object.entries(aggregated)
      .map(([time, data]) => ({
        time,
        value: data.value,
        count: data.count,
      }))
      .sort((a, b) => new Date(a.time) - new Date(b.time));
  }, [transactions, getTimeInterval]);
  if (chartData.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="w-full h-48 bg-black/50 rounded-xl p-1"
    >
      <h5 className="text-white text-[8px] mb-1">Trends (Velocity: {velocity.toFixed(1)}/day)</h5>
      <Suspense fallback={<div>Loading chart...</div>}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="time" stroke="#ccc" fontSize={6} />
            <YAxis yAxisId="left" stroke="#ccc" fontSize={6} />
            <YAxis yAxisId="right" orientation="right" stroke="#ccc" fontSize={6} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '4px' }}
              labelStyle={{ color: '#fff' }}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="value"
              stroke="#00BFFF"
              strokeWidth={2}
              dot={false}
              animationDuration={500}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="count"
              stroke="#FFD700"
              strokeWidth={2}
              dot={false}
              animationDuration={500}
            />
          </LineChart>
        </ResponsiveContainer>
      </Suspense>
    </motion.div>
  );
});
const ClusterDashboard = memo(({ entity, isMobile, tokenImages }) => {
  if (!entity || entity.type !== 'cluster' || !entity.data || !entity.data.wallets || !entity.data.transactions) {
    logger.warn('Invalid cluster data:', entity);
    return null;
  }
  const { data: cluster } = entity;
  const totalValue = useMemo(() => cluster.wallets.reduce((sum, w) => sum + parseFloat(w.totalValue || 0), 0), [cluster]);
  const riskScore = cluster.riskScore || 0;
  const txCount = cluster.transactions.length;
  const avgTxValue = useMemo(() => txCount > 0 ? totalValue / txCount : 0, [cluster, totalValue]);
  const velocity = cluster.velocity || 0;
  const uniqueTokens = cluster.uniqueTokens || 0;
  const topTokensVolume = useMemo(() => {
    const volumes = cluster.transactions.reduce((acc, tx) => {
      const key = tx.contractAddress?.toLowerCase() || (tx.tokenSymbol?.toLowerCase() || 'unknown');
      acc[key] = (acc[key] || 0) + Number(tx.usdValue || tx.value || 0);
      return acc;
    }, {});
    return Object.entries(volumes)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
  }, [cluster.transactions]);
  // New: Outstanding activities - high value or anomalous tx
  const outstandingTxs = useMemo(() => {
    if (txCount === 0) return [];
    const values = cluster.transactions.map(tx => Number(tx.usdValue || tx.value || 0));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance);
    const threshold = mean + 2 * std;
    return cluster.transactions
      .filter(tx => (Number(tx.usdValue || tx.value || 0) > threshold) || (Number(tx.usdValue || tx.value || 0) > totalValue * 0.1)) // Top 10% or anomalous
      .sort((a, b) => (Number(b.usdValue || b.value || 0)) - (Number(a.usdValue || a.value || 0)))
      .slice(0, 3);
  }, [cluster.transactions, totalValue]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`bg-black/10 backdrop-blur-lg border border-white/20 rounded-2xl p-3 shadow-neon-md hide-scrollbar max-h-[calc(100vh-8rem)] ${isMobile ? 'w-full mt-2 overflow-auto max-h-[40vh]' : 'w-80 fixed left-4 top-32'}`}
      style={{ overflowY: 'auto' }}
    >
      <h4 className="text-white text-[11px] font-bold mb-2 bg-gradient-to-r from-neon-blue/30 to-transparent rounded p-1 flex items-center gap-2">
        HotSpot:
        {isValidNametagImage(cluster.image) && (
          <img
            src={cluster.image}
            alt="Cluster logo"
            width={16}
            height={16}
            className="rounded-full flex-shrink-0"
            onError={(e) => (e.target.style.display = 'none')}
            loading="lazy"
          />
        )}
        {cluster.nametag || 'Unknown'}
      </h4>
      <div className="grid grid-cols-2 gap-2 mb-2 text-[9px]">
        <div className="bg-white/10 p-2 rounded-lg">
          <p className="text-white/60 text-[8px]">Total Value</p>
          <p className="text-white font-bold text-[12px]">${formatLargeNumber(totalValue)}</p>
        </div>
        <div className="bg-white/10 p-2 rounded-lg">
          <p className="text-white/60 text-[8px]">Wallets</p>
          <p className="text-white font-bold text-[12px]">{cluster.wallets.length}</p>
        </div>
        <div className="bg-white/10 p-2 rounded-lg">
          <p className="text-white/60 text-[8px]">Tx Velocity</p>
          <p className="text-white font-bold text-[12px]">{velocity.toFixed(1)}/day</p>
        </div>
        <div className="bg-white/10 p-2 rounded-lg">
          <p className="text-white/60 text-[8px]">Unique Tokens</p>
          <p className="text-white font-bold text-[12px]">{uniqueTokens}</p>
        </div>
      </div>
      <div className="bg-white/10 p-2 rounded-lg mb-2">
        <p className="text-white/90 text-[10px] font-bold mb-1">Top Tokens by Volume</p>
        <div className="space-y-1">
          {topTokensVolume.map(([key, vol]) => {
            const tokenInfoItem = tokenImages[key];
            const token = tokenInfoItem?.symbol || (isAddress(key) ? key.slice(0, 6) : key.toUpperCase());
            const tokenLogo = tokenInfoItem?.image || '/icons/default.webp';
            return (
              <div key={key} className="flex items-center justify-between text-[10px] py-0.5 gap-2">
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <img
                    src={tokenLogo}
                    alt={`${token} logo`}
                    width={14}
                    height={14}
                    className="rounded-full flex-shrink-0"
                    onError={(e) => (e.target.src = '/icons/default.webp')}
                    loading="lazy"
                  />
                  <span className="text-white/70 capitalize truncate">{token}</span>
                </div>
                <span className="font-mono text-white/90 min-w-0">${formatLargeNumber(vol, 2)}</span>
              </div>
            );
          })}
        </div>
      </div>
      {/* New: Outstanding Activities */}
      {outstandingTxs.length > 0 && (
        <div className="bg-orange-500/20 p-2 rounded-lg mb-2 border border-orange-500/30">
          <p className="text-[9px] font-bold text-orange-300 mb-1">Outstanding Activities</p>
          <div className="space-y-1 text-[8px]">
            {outstandingTxs.map((tx, idx) => (
              <div key={idx} className="flex justify-between">
                <span className="text-white/80 truncate">{tx.tokenSymbol || 'Unknown'} Tx</span>
                <span className="font-bold text-orange-400">${formatLargeNumber(Number(tx.usdValue || tx.value || 0))}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={`p-2 rounded-lg mb-2 ${riskScore > 0.5 ? 'bg-red-500/20 border-red-500/30' : 'bg-green-500/20 border-green-500/30'}`}>
        <p className="text-[9px] font-bold">Risk Score: <span className={`${riskScore > 0.5 ? 'text-red-400' : 'text-green-400'}`}>{(riskScore * 100).toFixed(1)}%</span></p>
        {riskScore > 0.7 && <span className="text-red-400 text-[8px] inline-block ml-1">⚠️ High Risk</span>}
      </div>
      <Suspense fallback={<div>Loading chart...</div>}>
        <TrendChart transactions={cluster.transactions} velocity={velocity} />
      </Suspense>
    </motion.div>
  );
});
const CACHE_TTL = 7200000; // Increased to 2 hours for longer caching
const NODES_PER_PAGE = 50;
const MAX_NODES = 1000; // Scalability limit
// THÊM HÀM NÀY VÀO ĐÂY (ngay trước export default)
function simpleRuleBasedClustering(nodesData, edgesData) {
  const clusters = [];
  const nodeMap = new Map(nodesData.map(n => [n.id.toLowerCase(), n]));
  const adjList = new Map();
  nodesData.forEach(n => adjList.set(n.id.toLowerCase(), new Set()));
  edgesData.forEach(e => {
    adjList.get(e.source.toLowerCase())?.add(e.target.toLowerCase());
    adjList.get(e.target.toLowerCase())?.add(e.source.toLowerCase());
  });
  // Compute per-node metrics for better labeling
  nodesData.forEach(node => {
    const nodeTxs = edgesData.filter(e => e.source.toLowerCase() === node.id.toLowerCase() || e.target.toLowerCase() === node.id.toLowerCase());
    node.degree = adjList.get(node.id.toLowerCase())?.size || 0;
    node.txCount = node.txCount || nodeTxs.length;
    const times = nodeTxs.map(e => typeof e.block_time === 'number' ? e.block_time * 1000 : new Date(e.block_time).getTime()).filter(t => t).sort((a, b) => a - b);
    let velocity = 0;
    if (times.length > 1) {
      const spanDays = (times[times.length - 1] - times[0]) / (86400000);
      velocity = times.length / Math.max(spanDays, 1);
    }
    node.velocity = velocity;
    const uniqueTokens = new Set(nodeTxs.map(e => e.tokenSymbol || 'unknown')).size;
    node.uniqueTokens = uniqueTokens;
    // Enhanced rule-based autoLabel - Only assign for Institution, Whale, Exchange, NFT Collector
    let autoLabel = null;
    const totalValue = parseFloat(node.totalValue || 0);
    const txCount = node.txCount || 0;
    const degree = node.degree || 0;
    if (degree > 20 || txCount > 500) autoLabel = 'Exchange';
    else if (totalValue > 1000000) autoLabel = 'Whale';
    else if (totalValue > 100000 && degree > 8 && velocity < 1.5) autoLabel = 'Institution';
    else if (uniqueTokens >= 30) autoLabel = 'NFT Collector';
    node.autoLabel = autoLabel;
  });
  // Simple: Group by shared label (nametag) or high degree (>3), add auto-label preview only if applicable
  const groups = new Map();
  nodesData.forEach(node => {
    const key = node.label !== 'Unknown' ? node.label : (node.autoLabel ? `auto_${node.autoLabel}_${node.degree > 3 ? 'hub' : 'solo'}` : truncateAddress(node.id));
    if (!groups.has(key)) groups.set(key, { wallets: [], transactions: [], autoLabel: node.autoLabel });
    groups.get(key).wallets.push({ ...node, autoLabel: node.autoLabel }); // Add to node
  });
  // Assign tx (simple: all to group if connected)
  edgesData.forEach(edge => {
    const sourceKey = [...groups.entries()].find(([k, g]) => g.wallets.some(w => w.id.toLowerCase() === edge.source.toLowerCase()))?.[0];
    if (sourceKey) groups.get(sourceKey).transactions.push({ ...edge });
  });
  groups.forEach((group, key) => {
    if (group.wallets.length >= 2 && group.wallets.some(w => w.label !== 'Unknown' || w.autoLabel)) {
      clusters.push({
        clusterId: key,
        nametag: key,
        wallets: group.wallets,
        transactions: [...new Set(group.transactions.map(JSON.stringify))].map(JSON.parse),
        riskScore: 0.3, // Default low
        velocity: 0,
        uniqueTokens: 0,
        topFeatures: [], // Empty
        autoLabel: group.autoLabel || null, // Preview only if applicable
      });
    }
  });
  return clusters;
}
export default function TreemapTab({ initialChain = 'ethereum', initialAddress = '' }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [walletAddress, setWalletAddress] = useState(initialAddress);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [nametags, setNametags] = useState({});
  const [walletInfo, setWalletInfo] = useState({
    address: '',
    nametag: 'Unknown',
    image: null,
    chainLogo: '/icons/default.webp',
  });
  const [loading, setLoading] = useState(false);
  const [logMessages, setLogMessages] = useState([]);
  const [selectedChain, setSelectedChain] = useState(initialChain);
  const [isChainDropdownOpen, setIsChainDropdownOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileWarning, setShowMobileWarning] = useState(true);
  const [coingeckoChains, setCoingeckoChains] = useState([]);
  const [tokenImages, setTokenImages] = useState({});
  const [fullIncomingData, setFullIncomingData] = useState([]);
  const [fullOutgoingData, setFullOutgoingData] = useState([]);
  const [fullLayer3Data, setFullLayer3Data] = useState([]);
  const graphRef = useRef(null);
  const containerRef = useRef(null);
  const chainDropdownRef = useRef(null);
  const limitDropdownRef = useRef(null);
  const [selectedLimit, setSelectedLimit] = useState(100); // Updated default to 100
  const [isLimitDropdownOpen, setIsLimitDropdownOpen] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedEntity, setSelectedEntity] = useState({ type: null, data: { transactions: [] } });
  const [clusters, setClusters] = useState([]);
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
  // Fetch user data to get accurate isPremium status
  const fetchUserData = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const response = await axios.get(`${apiBaseUrl}/api/user?uid=${encodeURIComponent(session.user.id)}`, {
        headers: { 'Content-Type': 'application/json' },
        withCredentials: true,
      });
      if (response.data.success) {
        const user = response.data.user;
        setIsPremium(user.isPremium || false);
      }
    } catch (err) {
      logger.error('Error fetching user data for premium status:', err);
    }
  }, [session, apiBaseUrl]);
  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);
  useEffect(() => {
    if (fullIncomingData.length > 0 || fullOutgoingData.length > 0 || fullLayer3Data.length > 0) {
      const { nodes: newNodes, edges: newEdges, nametags: newNametags } = aggregateWallets(
        fullIncomingData,
        fullOutgoingData,
        fullLayer3Data,
        walletAddress,
        page,
        filterType
      );
      // Enforce max nodes for scalability
      const limitedNodes = newNodes.slice(0, MAX_NODES);
      const limitedEdges = newEdges.filter(e =>
        limitedNodes.some(n => n.data.id === e.data.source) &&
        limitedNodes.some(n => n.data.id === e.data.target)
      );
      setNodes(limitedNodes);
      setEdges(limitedEdges);
      setNametags((prev) => ({ ...prev, ...newNametags }));
      setTimeout(() => initializeForceGraph(), 100);
    }
  }, [filterType, fullIncomingData, fullOutgoingData, fullLayer3Data, walletAddress, page]);
  useEffect(() => {
    const fetchTokenImages = async () => {
      const uniqueTokens = [
        ...new Set([
          ...edges.flatMap((edge) => edge.data.contractAddress?.toLowerCase()),
          ...edges.flatMap((edge) => edge.data.tokenSymbol?.toLowerCase()),
        ]),
      ].filter(Boolean);
      logger.log('Fetching token images for:', uniqueTokens);
      const tokenInfo = {};
      edges.forEach((edge) => {
        const tokenKey = edge.data.contractAddress?.toLowerCase() || edge.data.tokenSymbol?.toLowerCase();
        if (edge.data.tokenSymbol?.toLowerCase() === 'eth' && selectedChain === '1') {
          tokenInfo[tokenKey] = {
            image: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628',
            symbol: 'ETH'
          };
        }
        if (selectedChain === 'bitcoin' && edge.data.tokenSymbol?.toLowerCase() === 'btc') {
          tokenInfo[tokenKey] = {
            image: '/logos/bitcoin.webp',
            symbol: 'BTC'
          };
        } else if (edge.data.tokenImage && edge.data.tokenImage !== '/icons/default.webp') {
          tokenInfo[tokenKey] = {
            image: edge.data.tokenImage,
            symbol: edge.data.tokenSymbol?.toUpperCase() || 'UNKNOWN'
          };
        }
      });
      const tokensToFetch = uniqueTokens.filter((token) => !tokenInfo[token] && selectedChain !== 'bitcoin');
      // Parallel fetch with concurrency limit to avoid rate limits
      const concurrencyLimit = 10;
      const fetchBatch = async (batch) => {
        const batchPromises = batch.map(async (token) => {
          if (!token) {
            logger.warn(`Skipping invalid token: ${token}`);
            return;
          }
          try {
            // Parallel: Cache, DB, CG in sequence per token, but batches parallel
            const cacheResponse = await fetch(`${apiBaseUrl}/api/cache?key=token_image_${token}`, {
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
            });
            const cacheResult = await cacheResponse.json();
            if (cacheResponse.ok && cacheResult.success && cacheResult.data?.image) {
              const symbol = cacheResult.data?.symbol || (isAddress(token) ? undefined : token.toUpperCase());
              logger.log(`Cache hit for ${token}:`, cacheResult.data.image);
              tokenInfo[token] = { image: cacheResult.data.image, symbol };
              return;
            }
            const isContractAddress = isAddress(token);
            const queryParam = isContractAddress ? `contractAddress=${token}` : `symbol=${token}`;
            logger.log(`Querying database for token ${token} with ${queryParam}&chain=${selectedChain}`);
            const dbResponse = await fetch(`${apiBaseUrl}/api/tokens?${queryParam}&chain=${selectedChain}`, {
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
            });
            const dbResult = await dbResponse.json();
            if (dbResponse.ok && dbResult.success && dbResult.data?.image) {
              logger.log(`Database hit for ${token}:`, dbResult.data.image);
              const symbol = dbResult.data.symbol?.toUpperCase() || token.toUpperCase();
              tokenInfo[token] = { image: dbResult.data.image, symbol };
              await fetch(`${apiBaseUrl}/api/cache`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  key: `token_image_${token}`,
                  action: 'set',
                  data: { image: dbResult.data.image, symbol: dbResult.data.symbol },
                  ttl: 4 * 3600 * 1000,
                }),
              });
              return;
            }
            logger.log(`Falling back to CoinGecko for ${token}`);
            const cgResponse = await fetch(
              `${apiBaseUrl}/api/coingecko?action=token-details&${queryParam}&chain=${selectedChain}`,
              {
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
              }
            );
            const cgResult = await cgResponse.json();
            if (cgResponse.ok && cgResult.success && cgResult.data?.image?.thumb) {
              logger.log(`CoinGecko hit for ${token}:`, cgResult.data.image.thumb);
              const symbol = cgResult.data.symbol?.toUpperCase() || token.toUpperCase();
              tokenInfo[token] = { image: cgResult.data.image.thumb, symbol };
              await fetch(`${apiBaseUrl}/api/cache`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  key: `token_image_${token}`,
                  action: 'set',
                  data: { image: cgResult.data.image.thumb, symbol: cgResult.data.symbol },
                  ttl: 4 * 3600 * 1000,
                }),
              });
              if (isContractAddress) {
                await fetch(`${apiBaseUrl}/api/tokens`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({
                    action: 'update',
                    coingecko_id: cgResult.data.id || token,
                    symbol: cgResult.data.symbol || token,
                    name: cgResult.data.name || token,
                    image: cgResult.data.image.thumb,
                    chain: selectedChain,
                    contractAddress: token,
                  }),
                });
              }
              return;
            } else {
              logger.warn(`No valid image for ${token} from CoinGecko`);
              tokenInfo[token] = { image: '/icons/default.webp', symbol: token.toUpperCase() };
            }
          } catch (err) {
            logger.error(`Error fetching token image for ${token}:`, err.message);
            tokenInfo[token] = { image: '/icons/default.webp', symbol: token.toUpperCase() };
          }
        });
        await Promise.all(batchPromises);
      };
      // Batch with concurrency
      for (let i = 0; i < tokensToFetch.length; i += concurrencyLimit) {
        const batch = tokensToFetch.slice(i, i + concurrencyLimit);
        await fetchBatch(batch);
      }
      logger.log('Token info fetched:', tokenInfo);
      setTokenImages(tokenInfo);
    };
    if (edges.length > 0) {
      fetchTokenImages();
    }
  }, [edges, selectedChain, apiBaseUrl]);
  const updateUrl = (chain, address) => {
    const newParams = new URLSearchParams();
    newParams.set('tab', 'treemap');
    newParams.set('chain', chain);
    if (address) newParams.set('address', address);
    router.replace(`/dashboard?${newParams.toString()}`, { scroll: false });
  };
  const aggregateWallets = (incomingData, outgoingData, layer3Data, rootAddress, page, filterType) => {
    const walletMap = new Map();
    const nametags = {};
    const edges = [];
    const rootLower = rootAddress.toLowerCase();
    walletMap.set(rootLower, {
      address: rootLower,
      nametag: walletInfo.nametag || 'Unknown',
      image: walletInfo.image || '/icons/default.webp',
      chainLogo: walletInfo.chainLogo || '/icons/default.webp',
      tokenSymbol: 'Unknown',
      totalValue: 0,
      txCount: 0,
      latestBlockTime: null,
      type: 'root',
      layer: 1,
    });
    nametags[rootLower] = {
      name: walletInfo.nametag || 'Unknown',
      image: walletInfo.image || '/icons/default.webp',
    };
    const addWallet = (address, tx, type, layer) => {
      if (filterType === 'incoming' && type !== 'incoming') return;
      if (filterType === 'outgoing' && type !== 'outgoing') return;
      if (layer === 3 && (!tx.nametag || tx.nametag === 'Unknown')) return;
      const addrLower = address.toLowerCase();
      if (!walletMap.has(addrLower)) {
        walletMap.set(addrLower, {
          address: addrLower,
          nametag: tx.nametag || 'Unknown',
          image: tx.image || '/icons/default.webp',
          chainLogo: tx.chainLogo || '/icons/default.webp',
          tokenSymbol: tx.tokenSymbol || 'Unknown',
          totalValue: 0,
          txCount: 0,
          latestBlockTime: null,
          type,
          layer,
        });
        nametags[addrLower] = {
          name: tx.nametag || 'Unknown',
          image: tx.image || '/icons/default.webp',
        };
      }
      const wallet = walletMap.get(addrLower);
      const txValue = Number(tx.usdValue || tx.value || 0);
      if (isNaN(txValue)) return; // Validate value
      wallet.totalValue += txValue;
      wallet.txCount += 1;
      const txTime = typeof tx.block_time === 'number' ? tx.block_time * 1000 : tx.block_time;
      const walletTime = wallet.latestBlockTime ? (typeof wallet.latestBlockTime === 'number' ? wallet.latestBlockTime * 1000 : wallet.latestBlockTime) : null;
      if (isValidDate(new Date(txTime)) && (!walletTime || new Date(txTime) > new Date(walletTime))) {
        wallet.latestBlockTime = tx.block_time;
      }
    };
    const filteredIncoming = filterType === 'all' || filterType === 'incoming'
      ? incomingData.filter((tx) => tx.address.toLowerCase() !== rootLower && tx.type === 'incoming')
      : [];
    const filteredOutgoing = filterType === 'all' || filterType === 'outgoing'
      ? outgoingData.filter((tx) => tx.address.toLowerCase() !== rootLower && tx.type === 'outgoing')
      : [];
    filteredIncoming.forEach((tx) => addWallet(tx.address, tx, 'incoming', 2));
    filteredOutgoing.forEach((tx) => addWallet(tx.address, tx, 'outgoing', 2));
    const filteredLayer3 = layer3Data.filter((tx) => tx.nametag && tx.nametag !== 'Unknown');
    filteredLayer3.forEach((tx) => {
      const address = tx.type === 'incoming' ? tx.address : tx.address;
      addWallet(address, tx, tx.type, 3);
    });
    const nodes = Array.from(walletMap.values()).map((wallet) => ({
      data: {
        id: wallet.address,
        label: wallet.nametag,
        image: wallet.image,
        chainLogo: wallet.chainLogo,
        tokenSymbol: wallet.tokenSymbol,
        totalValue: wallet.totalValue.toFixed(6),
        txCount: wallet.txCount,
        latestBlockTime: wallet.latestBlockTime,
        type: wallet.type,
        layer: wallet.layer,
        isRoot: wallet.address === rootLower,
      },
    }));
    filteredIncoming.forEach((tx, index) => {
      if (walletMap.has(tx.address.toLowerCase()) && walletMap.has(rootLower)) {
        edges.push({
          data: {
            id: `in-edge-${page}-${index}-${tx.hash}`,
            source: tx.address.toLowerCase(),
            target: rootLower,
            value: Number(tx.value).toFixed(6),
            usdValue: Number(tx.usdValue || 0).toFixed(6),
            type: 'incoming',
            txHash: tx.hash,
            block_time: tx.block_time,
            tokenSymbol: tx.tokenSymbol,
            contractAddress: tx.contractAddress,
            tokenImage: tx.tokenImage,
            layer: 2,
          },
        });
      }
    });
    filteredOutgoing.forEach((tx, index) => {
      if (walletMap.has(rootLower) && walletMap.has(tx.address.toLowerCase())) {
        edges.push({
          data: {
            id: `out-edge-${page}-${index}-${tx.hash}`,
            source: rootLower,
            target: tx.address.toLowerCase(),
            value: Number(tx.value).toFixed(6),
            usdValue: Number(tx.usdValue || 0).toFixed(6),
            type: 'outgoing',
            txHash: tx.hash,
            block_time: tx.block_time,
            tokenSymbol: tx.tokenSymbol,
            contractAddress: tx.contractAddress,
            tokenImage: tx.tokenImage,
            layer: 2,
          },
        });
      }
    });
    filteredLayer3.forEach((tx, index) => {
      const layer2Address = tx.layer2Address.toLowerCase();
      const layer3Address = tx.address.toLowerCase();
      if (walletMap.has(layer2Address) && walletMap.has(layer3Address)) {
        edges.push({
          data: {
            id: `layer3-edge-${page}-${index}-${tx.hash}`,
            source: tx.type === 'incoming' ? layer3Address : layer2Address,
            target: tx.type === 'incoming' ? layer2Address : layer3Address,
            value: Number(tx.value).toFixed(6),
            usdValue: Number(tx.usdValue || 0).toFixed(6),
            type: tx.type,
            txHash: tx.hash,
            block_time: tx.block_time,
            tokenSymbol: tx.tokenSymbol,
            contractAddress: tx.contractAddress,
            tokenImage: tx.tokenImage,
            layer: 3,
          },
        });
      }
    });
    return { nodes, edges, nametags };
  };
  const fetchTransactions = useCallback(async (address, page = 1) => {
    const isBitcoin = selectedChain === 'bitcoin';
    if (!isAddress(address) && !['solana', 'tron', 'bitcoin'].includes(selectedChain)) {
      logger.error('Invalid wallet address.');
      toast.error('Invalid wallet address.', {
        position: 'top-center',
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        theme: 'dark',
      });
      return;
    }
    if (!SUPPORTED_CHAINS.includes(selectedChain)) {
      toast.error('Selected chain is not supported.', {
        position: 'top-center',
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        theme: 'dark',
      });
      return;
    }
    const cacheKey = `graph_full_${selectedChain}_${address.toLowerCase()}_${page}`;
    const cached = await getCachedData(cacheKey);
    if (cached) {
      setFullIncomingData(cached.incoming || []);
      setFullOutgoingData(cached.outgoing || []);
      setFullLayer3Data(cached.layer3 || []);
      setNodes(cached.nodes || []);
      setEdges(cached.edges || []);
      setWalletInfo(cached.wallet || walletInfo);
      setNametags(cached.nametags || {});
      setWalletAddress(address);
      updateUrl(selectedChain, address);
      logger.log('Cached walletInfo.image:', cached.wallet?.image);
      const { nodes: newNodes, edges: newEdges, nametags: newNametags } = aggregateWallets(
        cached.incoming || [],
        cached.outgoing || [],
        cached.layer3 || [],
        address,
        page,
        filterType
      );
      setNodes(newNodes);
      setEdges(newEdges);
      setNametags((prev) => ({ ...prev, ...newNametags }));
      return;
    }
    setLoading(true);
    try {
      const payload = { wallet_address: address, chain: selectedChain, limit: selectedLimit, page, fetchLayer3: true };
      const signature = generateHmacSignature(payload);
      const response = await fetch(`${apiBaseUrl}/api/get-transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': session?.user?.apiKey || 'default-api-key',
          'x-hmac-signature': signature,
        },
        body: JSON.stringify(payload),
      });
      const reader = response.body.getReader();
      let result = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += new TextDecoder().decode(value);
      }
      const data = JSON.parse(result);
      if (data.error) {
        throw new Error(data.error || 'Invalid response from API.');
      }
      if (data.incoming.length === 0 && data.outgoing.length === 0 && data.layer3.length === 0) {
        toast.info('No transactions found for this address on the selected chain.', {
          position: 'top-center',
          autoClose: 5000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          theme: 'dark',
          style: { background: '#10B981', color: '#FFFFFF' },
        });
        setNodes([]);
        setEdges([]);
        setNametags({});
        setFullIncomingData([]);
        setFullOutgoingData([]);
        setFullLayer3Data([]);
        setWalletInfo({ address: '', nametag: 'Unknown', image: null, chainLogo: '/icons/default.webp' });
        setLoading(false);
        return;
      }
      logger.log('API response walletInfo.image:', data.wallet.image);
      setFullIncomingData(data.incoming);
      setFullOutgoingData(data.outgoing);
      setFullLayer3Data(data.layer3);
      const { nodes, edges, nametags: newNametags } = aggregateWallets(
        data.incoming,
        data.outgoing,
        data.layer3,
        address,
        page,
        filterType
      );
      await cacheData(cacheKey, {
        incoming: data.incoming,
        outgoing: data.outgoing,
        layer3: data.layer3,
        nodes,
        edges,
        wallet: data.wallet,
        nametags: newNametags
      }, CACHE_TTL);
      setNodes((prev) => page === 1 ? nodes : [...prev, ...nodes]);
      setEdges((prev) => page === 1 ? edges : [...prev, ...edges]);
      setNametags((prev) => ({ ...prev, ...newNametags }));
      setWalletInfo(data.wallet);
      setWalletAddress(address);
      updateUrl(selectedChain, address);
    } catch (err) {
      logger.error(`Error: ${err.message}`);
      if (nodes.length === 0 && edges.length === 0) {
        toast.error(`Failed to fetch transactions: ${err.message}`, {
          position: 'top-center',
          autoClose: 5000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          theme: 'dark',
        });
        setNodes([]);
        setEdges([]);
        setNametags({});
        setFullIncomingData([]);
        setFullOutgoingData([]);
        setFullLayer3Data([]);
        setWalletInfo({ address: '', nametag: 'Unknown', image: null, chainLogo: '/icons/default.webp' });
      }
    } finally {
      setLoading(false);
    }
  }, [selectedChain, selectedLimit, session, apiBaseUrl, filterType, walletInfo]);
  const filterTransactions = useCallback((transactions, filterType, rootId, walletId = null) => {
    if (!transactions || !Array.isArray(transactions)) {
      logger.warn('Invalid transactions array:', transactions);
      return [];
    }
    let txs = transactions.map(tx => ({
      ...tx,
      source: tx.source?.toLowerCase(),
      target: tx.target?.toLowerCase(),
    }));
    if (walletId) {
      logger.log(`Filtering transactions for walletId: ${walletId}`);
      txs = txs.filter(
        (tx) =>
          (tx.source === walletId.toLowerCase() || tx.target === walletId.toLowerCase()) &&
          tx.source && tx.target
      );
    }
    if (filterType !== 'all') {
      logger.log(`Applying filterType: ${filterType}, rootId: ${rootId}`);
      txs = txs.filter((tx) => {
        if (!tx.source || !tx.target) {
          logger.warn('Invalid transaction (missing source or target):', tx);
          return false;
        }
        if (filterType === 'incoming') {
          return tx.type === 'incoming' && tx.target === rootId?.toLowerCase();
        }
        if (filterType === 'outgoing') {
          return tx.type === 'outgoing' && tx.source === rootId?.toLowerCase();
        }
        return false;
      });
    }
    const uniqueTxs = [...new Set(txs.map(JSON.stringify))].map(JSON.parse);
    logger.log(`Filtered transactions (walletId: ${walletId || 'none'}, filterType: ${filterType}):`, uniqueTxs.length);
    return uniqueTxs;
  }, []);
  // Replace the entire initializeForceGraph function with this:
  // Replace the entire initializeForceGraph function with this:
  const initializeForceGraph = useCallback(async () => {
    if (!containerRef.current || !nodes.length || !walletInfo.address) {
      logger.warn('Cannot initialize ForceGraph: missing container, nodes, or walletInfo.address');
      return;
    }
    try {
      await TensorFlowJS; // Load pure TF for client-side if needed (non-clustering)
      logger.log('TensorFlow.js loaded (client)');
      if (graphRef.current) {
        graphRef.current.pauseAnimation();
        containerRef.current.innerHTML = ''; // Clear previous canvas
        logger.log('Cleared previous ForceGraph instance');
      }
      const rootId = walletInfo.address.toLowerCase();
      // Fetch server-side clusters with error handling & auto-label
      let detectedClusters = [];
      try {
        const clusterResponse = await fetch(`${apiBaseUrl}/api/cluster`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            nodes: nodes.map(n => ({ ...n.data })),
            edges: edges.map(e => ({ ...e.data })),
            options: { useGNN: true, useDBSCAN: true } // Stable options
          }),
        });
        if (!clusterResponse.ok) {
          throw new Error(`Cluster API error: ${clusterResponse.status} ${clusterResponse.statusText}`);
        }
        const clusterData = await clusterResponse.json();
        if (!clusterData.success || !clusterData.clusters) {
          throw new Error(clusterData.error || 'Invalid cluster response');
        }
        detectedClusters = clusterData.clusters;
        logger.log('Server clusters fetched successfully');
      } catch (clusterErr) {
        logger.warn('Server clustering failed, using simple fallback:', clusterErr.message);
        detectedClusters = simpleRuleBasedClustering(nodes.map(n => n.data), edges.map(e => e.data));
      }
      logger.log('Detected clusters:', detectedClusters.map(c => ({
        clusterId: c.clusterId,
        nametag: c.nametag,
        autoLabel: c.autoLabel,
        walletCount: c.wallets.length,
        transactionCount: c.transactions.length,
      })));
      setClusters(detectedClusters);
      // Prepare initial positions for layered layout
      const positionedNodes = nodes.map(n => ({ ...n.data }));
      const rootData = positionedNodes.find(n => n.isRoot);
      if (rootData) {
        rootData.x = 0;
        rootData.y = 0;
        rootData.fx = rootData.x;
        rootData.fy = rootData.y;
      }
      const layer2Datas = positionedNodes.filter(n => n.layer === 2);
      const radius2 = 250;
      const numL2 = layer2Datas.length;
      if (numL2 > 0) {
        const angleStep = 2 * Math.PI / numL2;
        layer2Datas.forEach((nd, i) => {
          const angle = i * angleStep;
          nd.x = Math.cos(angle) * radius2;
          nd.y = Math.sin(angle) * radius2;
        });
      }
      const layer3Datas = positionedNodes.filter(n => n.layer === 3);
      const parentChildMap = new Map(); // childId -> parentId
      const graphLinksTemp = edges.map(e => ({ ...e.data })); // Temp for positioning
      graphLinksTemp.forEach(link => {
        if (link.layer === 3) {
          const ids = [link.source, link.target];
          const l2id = positionedNodes.find(n => n.id === ids[0] && n.layer === 2)?.id || positionedNodes.find(n => n.id === ids[1] && n.layer === 2)?.id;
          if (l2id) {
            const childId = ids[0] === l2id ? ids[1] : ids[0];
            parentChildMap.set(childId, l2id);
          }
        }
      });
      const childrenByParent = new Map();
      layer3Datas.forEach(nd => {
        const parentId = parentChildMap.get(nd.id);
        if (parentId) {
          if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
          childrenByParent.get(parentId).push(nd);
        }
      });
      const radius3 = 100;
      childrenByParent.forEach((children, parentId) => {
        const parent = positionedNodes.find(n => n.id === parentId);
        if (!parent || !parent.x || !parent.y) return;
        const numC = children.length;
        const angleStep3 = 2 * Math.PI / Math.max(1, numC);
        children.forEach((nd, i) => {
          const angle = i * angleStep3 + (Math.random() - 0.5) * angleStep3 * 0.2; // small jitter
          nd.x = parent.x + Math.cos(angle) * radius3;
          nd.y = parent.y + Math.sin(angle) * radius3;
        });
      });
      // Orphan layer3
      const orphanL3 = layer3Datas.filter(nd => !parentChildMap.has(nd.id));
      if (orphanL3.length > 0) {
        const outerRadius = radius2 + 150;
        orphanL3.forEach((nd, i) => {
          const angle = i * (2 * Math.PI / orphanL3.length);
          nd.x = Math.cos(angle) * outerRadius;
          nd.y = Math.sin(angle) * outerRadius;
        });
      }
      // Prepare graph data with explicit color assignment
      const graphNodes = positionedNodes.map(n => ({
        id: n.id,
        ...n, // includes x, y, fx, fy
        val: n.layer === 1 ? 40.32 : n.layer === 2 ? 20.16 : 10.08, // Increased another 20% from previous (33.6,16.8,8.4)
        group: n.layer,
        color: n.layer === 1 ? '#4F46E5' : n.layer === 2 ? '#10B981' : n.layer === 3 ? '#F59E0B' : '#666' // Explicit color
      }));
      const graphLinks = graphLinksTemp.map(e => ({
        source: e.source,
        target: e.target,
        ...e,
        width: e.layer === 3 ? 0.15 : 0.4 // Thinner links, reduced 50%
      }));
      // Assign clusterId to nodes for grouping/coloring
      detectedClusters.forEach((cluster, index) => {
        cluster.wallets.forEach((wallet) => {
          const node = graphNodes.find(n => n.id.toLowerCase() === wallet.id.toLowerCase());
          if (node) {
            node.clusterId = cluster.clusterId || `cluster-${index}`;
            node.clusterNametag = cluster.nametag;
            node.autoLabel = cluster.autoLabel;
          }
        });
      });
      // Set selectedEntity for root node/cluster data
      let clusterData;
      const rootCluster = detectedClusters.find(c => c.wallets.some(w => w.id.toLowerCase() === rootId));
      if (rootCluster) {
        clusterData = rootCluster;
      } else {
        // Fallback to root-only data
        let filteredRootTxs = [];
        if (filterType === 'all' || filterType === 'incoming') {
          filteredRootTxs.push(...fullIncomingData.map(tx => ({
            ...tx,
            type: 'incoming',
            source: tx.address.toLowerCase(),
            target: rootId,
          })));
        }
        if (filterType === 'all' || filterType === 'outgoing') {
          filteredRootTxs.push(...fullOutgoingData.map(tx => ({
            ...tx,
            type: 'outgoing',
            source: rootId,
            target: tx.address.toLowerCase(),
          })));
        }
        let filteredLayer3ForCluster = [];
        if (fullLayer3Data.length > 0) {
          const layer3Filter = fullLayer3Data.filter(tx => tx.nametag && tx.nametag !== 'Unknown');
          const layer3ToInclude = filterType === 'all' ? layer3Filter : layer3Filter.filter(tx => tx.type === filterType);
          filteredLayer3ForCluster = layer3ToInclude.map(tx => ({
            ...tx,
            source: tx.type === 'incoming' ? tx.address.toLowerCase() : tx.layer2Address.toLowerCase(),
            target: tx.type === 'incoming' ? tx.layer2Address.toLowerCase() : tx.address.toLowerCase(),
          }));
        }
        const allTxs = [...filteredRootTxs, ...filteredLayer3ForCluster];
        const connectedWallets = [...new Set(allTxs.map(tx => [tx.source, tx.target].filter(id => id !== rootId)).flat().filter(Boolean))];
        const uniqueTxs = [...new Set(allTxs.map(JSON.stringify))].map(JSON.parse);
        const getTime = (bt) => {
          if (typeof bt === 'number') return bt * 1000;
          if (typeof bt === 'string' || bt instanceof Date) return new Date(bt).getTime();
          return null;
        };
        const times = uniqueTxs.map(tx => getTime(tx.block_time)).filter(t => t !== null).sort((a, b) => a - b);
        let velocity = 0;
        if (times.length > 1) {
          const timeSpanDays = (times[times.length - 1] - times[0]) / (1000 * 60 * 60 * 24);
          velocity = uniqueTxs.length / Math.max(timeSpanDays, 1);
        } else if (times.length === 1) {
          velocity = 1;
        }
        const tokenKeys = uniqueTxs.map(tx => tx.contractAddress?.toLowerCase() || tx.tokenSymbol?.toLowerCase() || 'unknown');
        const uniqueTokens = new Set(tokenKeys).size;
        const connectedWalletsWithData = connectedWallets.map(cid => {
          const node = nodes.find(n => n.data.id.toLowerCase() === cid);
          if (node) {
            const w = { ...node.data };
            w.totalValue = parseFloat(w.totalValue || 0);
            return w;
          }
          return { id: cid, totalValue: 0 };
        });
        const rootWalletNode = nodes.find(n => n.data.id.toLowerCase() === rootId);
        const rootWalletData = rootWalletNode ? { ...rootWalletNode.data } : { id: rootId, totalValue: 0 };
        rootWalletData.totalValue = parseFloat(rootWalletData.totalValue || 0);
        const allWallets = [rootWalletData, ...connectedWalletsWithData];
        clusterData = {
          clusterId: 'root',
          nametag: walletInfo.nametag || truncateAddress(rootId),
          image: walletInfo.image,
          wallets: allWallets,
          transactions: allTxs,
          riskScore: 0,
          velocity,
          uniqueTokens,
        };
      }
      setSelectedEntity({ type: 'cluster', data: clusterData });
      // Preload images (giữ nguyên)
      const imageCache = {};
      const uniqueImages = [...new Set(graphNodes.map(n => n.image).filter(isValidNametagImage))];
      await Promise.all(uniqueImages.map(url => new Promise((resolve) => {
        if (imageCache[url]) return resolve();
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          imageCache[url] = img;
          resolve();
        };
        img.onerror = () => resolve();
        img.src = url.startsWith('http') ? url : `${window.location.origin}${url}`;
      })));
      logger.log(`Preloaded ${Object.keys(imageCache).length}/${uniqueImages.length} images`);
      // Initialize ForceGraph (chỉnh sửa)
      graphRef.current = ForceGraph()(containerRef.current)
        .graphData({ nodes: graphNodes, links: graphLinks })
        .backgroundColor('rgba(0,0,0,0.3)')
        .nodeRelSize(15.84) // Increased another 20% from 13.2
        .nodeVal(node => {
          let baseVal = Math.sqrt(node.totalValue || 1) + 1;
          if (node.layer === 1) return baseVal * 9.36; // Increased another 20% from 7.8
          if (node.layer === 2) return baseVal * 5.76; // Increased another 20% from 4.8
          return baseVal * 2.88; // Increased another 20% from 2.4
        })
        .nodeLabel(node => {
          // Giữ nguyên label HTML
          const cluster = detectedClusters.find(c => c.clusterId === node.clusterId);
          const risk = cluster?.riskScore || 0;
          const clusterLabel = node.isRoot ? walletInfo.nametag || 'Unknown' : cluster ? cluster.nametag : 'Unknown';
          const autoLabel = node.autoLabel || cluster?.autoLabel || '';
          const nametag = node.isRoot ? '' : node.label !== 'Unknown' ? node.label : truncateAddress(node.id);
          return `
          <div style="background: rgba(0,0,0,0.8); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.8); padding: 4px 8px; border-radius: 4px; font-size: 12px;">
            ${node.isRoot ? `<div>Cluster: ${clusterLabel}</div>` : `<div>${nametag}${node.layer === 3 ? ' (L3)' : ''}</div>`}
            ${autoLabel ? `<div>Auto: ${autoLabel}</div>` : ''}
            ${cluster ? `<div>Cluster: ${cluster.nametag}</div>` : ''}
            <div>Tx: ${node.txCount} | Value: ${formatLargeNumber(Number(node.totalValue), 1)}$</div>
            <div>Risk: ${(risk * 100).toFixed(0)}%</div>
          </div>
        `;
        })
        .nodeCanvasObject((node, ctx, globalScale) => {
          const label = node.label || truncateAddress(node.id);
          const size = node.val / globalScale;
          // Draw circle background
          ctx.beginPath();
          ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
          ctx.fillStyle = node.color || '#666';
          ctx.fill();
          // Draw border
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1 / globalScale;
          ctx.stroke();
          // Draw image if available
          if (isValidNametagImage(node.image) && imageCache[node.image]) {
            const img = imageCache[node.image];
            ctx.save();
            ctx.beginPath();
            ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
            ctx.clip();
            ctx.drawImage(img, node.x - size, node.y - size, size * 2, size * 2);
            ctx.restore();
          }
          // Bỏ vẽ text mặc định
        })
        .nodeCanvasObjectMode(() => 'replace')
        .linkColor(link => link.type === 'incoming' ? '#00BFFF' : '#EF4444')
        .linkCurvature(0.25) // Curvature như example để giống dây
        .linkDirectionalArrowLength(0) // Bỏ mũi tên
        .linkDirectionalParticles(2) // Thêm particles để animation thực hơn
        .linkDirectionalParticleSpeed(0.01)
        .linkDirectionalParticleWidth(1)
        .linkDirectionalParticleColor(link => link.type === 'incoming' ? '#00BFFF' : '#EF4444')
        .linkCanvasObject((link, ctx, globalScale) => {
          const start = link.source;
          const end = link.target;
          if (typeof start === 'object' && typeof end === 'object') {
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.strokeStyle = link.color || '#fff';
            ctx.lineWidth = (link.width || 1) / globalScale;
            ctx.stroke();
          }
        })
        .linkCanvasObjectMode(() => 'replace')
        .linkLabel(link => `${link.tokenSymbol || 'Unknown'} - ${formatLargeNumber(Number(link.value), 1)}`)
        .linkHoverPrecision(10) // Increase precision to avoid false hovers
        .onNodeClick((node, event) => {
          // Giữ nguyên click logic
          const walletId = node.id;
          const cluster = detectedClusters.find(c => c.wallets.some(w => w.id.toLowerCase() === walletId.toLowerCase()));
          if (cluster) {
            setSelectedEntity({ type: 'cluster', data: cluster });
          } else {
            const filteredTxs = filterTransactions([...fullIncomingData, ...fullOutgoingData, ...fullLayer3Data], filterType, rootId, walletId);
            setSelectedEntity({
              type: 'wallet',
              data: {
                id: walletId,
                nametag: node.label || truncateAddress(walletId),
                image: node.image,
                transactions: filteredTxs,
              }
            });
          }
        })
        .onNodeHover(node => {
          containerRef.current.style.cursor = node ? 'pointer' : null;
        })
        .onNodeDrag((node, translate) => {
          graphRef.current.d3ReheatSimulation();
        })
        .onNodeDragEnd(node => {
          node.fx = node.x;
          node.fy = node.y;
        })
        .onBackgroundClick(() => {
          // Optional: clear selection or hover
        })
        .d3Force('charge', d3.forceManyBody().strength(-500)) // Tăng repulsion để spread out hơn
        .d3Force('link', d3.forceLink().id(d => d.id).distance(link => link.layer === 3 ? 80 : 150).strength(0.8)) // Điều chỉnh link distance và strength theo layer
        .d3AlphaDecay(0.01) // Giảm để mượt hơn
        .d3VelocityDecay(0.6) // Giảm để kéo node mượt hơn (ít damping hơn)
        .warmupTicks(500) // Reduced from 2000 for faster init
        .cooldownTicks(2000) // Reduced from 3000 for faster stabilization
        .enablePointerInteraction(true)
        .enableNodeDrag(true)
        .enableZoomInteraction(true)
        .enablePanInteraction(true);
      // Auto center on root
      graphRef.current.centerAt(0, 0, 1500);
      graphRef.current.zoom(1.5, 1500);
    } catch (err) {
      logger.error('Error initializing ForceGraph:', err);
      toast.error('Graph visualization failed. Please refresh.', { position: 'top-right', theme: 'dark' });
    }
  }, [nodes, edges, walletInfo, filterType, walletAddress, fullIncomingData, fullOutgoingData, fullLayer3Data, filterTransactions, apiBaseUrl]);
  useEffect(() => {
    initializeForceGraph().catch(console.error);
    return () => {
      if (graphRef.current) {
        graphRef.current.pauseAnimation();
      }
    };
  }, [initializeForceGraph]);
  const generateHmacSignature = (payload) => {
    try {
      const hmacSecret = process.env.HMAC_SECRET || '88583e5e555aaeb3d9b3b0cafbd1e609f5a7ff96548caa71c8eda0783d66b1f1';
      const sortedPayload = JSON.stringify(payload, Object.keys(payload).sort());
      return crypto.HmacSHA256(sortedPayload, hmacSecret).toString(crypto.enc.Hex);
    } catch (err) {
      logger.error('Error generating HMAC signature:', err.message);
      return null;
    }
  };
  useEffect(() => {
    const chainFromUrl = searchParams.get('chain') || initialChain;
    const addressFromUrl = searchParams.get('address') || initialAddress;
    if (SUPPORTED_CHAINS.includes(chainFromUrl)) {
      setSelectedChain(chainFromUrl);
    } else {
      setSelectedChain('1');
    }
    if (addressFromUrl && (isAddress(addressFromUrl) || ['solana', 'tron', 'bitcoin'].includes(chainFromUrl))) {
      setWalletAddress(addressFromUrl);
      fetchTransactions(addressFromUrl, 1);
    }
  }, [searchParams, initialChain, initialAddress]);
  useEffect(() => {
    const fetchCoingeckoChains = async () => {
      try {
        const response = await axios.get(`${apiBaseUrl}/api/coingecko/chains`);
        if (response.data.success) setCoingeckoChains(response.data.data);
      } catch (error) {
        logger.error('Error loading chain data:', error.message);
      }
    };
    fetchCoingeckoChains();
  }, [apiBaseUrl]);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 640);
    checkMobile();
    window.addEventListener('resize', throttle(checkMobile, 200));
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (chainDropdownRef.current && !chainDropdownRef.current.contains(event.target)) {
        setIsChainDropdownOpen(false);
      }
      if (limitDropdownRef.current && !limitDropdownRef.current.contains(event.target)) {
        setIsLimitDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  // Dynamic log messages for loading
  useEffect(() => {
    if (loading) {
      const sources = [
        'Validating wallet address...',
        'Connecting to blockchain...',
        'Fetching incoming transactions...',
        'Fetching outgoing transactions...',
        'Analyzing token transfers...',
        'Resolving labels...',
        'Detecting clusters...',
        'Generating graph layout...',
      ];
      const interval = setInterval(() => {
        setLogMessages((prev) => {
          const nextIndex = prev.length % sources.length;
          return [...prev, { text: sources[nextIndex], id: Date.now() + Math.random() }].slice(-5);
        });
      }, 1200);
      return () => clearInterval(interval);
    } else {
      setLogMessages([]);
    }
  }, [loading]);
  const handleLoadMore = useCallback(() => {
    if (nodes.length >= MAX_NODES) {
      toast.warn('Maximum nodes limit reached. Consider subgraph views for larger graphs.', {
        position: 'top-center',
        autoClose: 3000,
        theme: 'dark',
      });
      return;
    }
    setPage((prev) => {
      const newPage = prev + 1;
      fetchTransactions(walletAddress, newPage);
      return newPage;
    });
  }, [fetchTransactions, walletAddress, nodes.length]);
  const handleSearch = useCallback(() => {
    const isBitcoin = selectedChain === 'bitcoin';
    const bitcoinRegex = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/i;
    if (
      (['solana', 'tron'].includes(selectedChain) && walletAddress.match(/^[A-Za-z0-9]{32,44}$/)) ||
      (isBitcoin && bitcoinRegex.test(walletAddress)) ||
      (!['solana', 'tron', 'bitcoin'].includes(selectedChain) && isAddress(walletAddress))
    ) {
      setPage(1);
      setFullIncomingData([]);
      setFullOutgoingData([]);
      setFullLayer3Data([]);
      fetchTransactions(walletAddress, 1);
    } else {
      toast.error('Invalid wallet address.', {
        position: 'top-center',
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        theme: 'dark',
      });
    }
  }, [walletAddress, selectedChain, fetchTransactions]);
  const handleFilterChange = useCallback(() => {
    setFilterType((prev) => {
      if (prev === 'all') {
        return 'incoming';
      } else if (prev === 'incoming') {
        return 'outgoing';
      } else {
        return 'all';
      }
    });
  }, []);
  const mappedChains = useMemo(() => {
    let cgChains = [];
    if (coingeckoChains.length > 0) {
      cgChains = mapCoinGeckoChains(coingeckoChains);
    }
    // Always include static chains that are not in cgChains
    const staticOnly = chains.filter(c => !cgChains.some(cg => cg.value === c.value));
    return [...cgChains, ...staticOnly];
  }, [coingeckoChains]);
  if (isMobile && showMobileWarning) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
        className="font-jetbrains w-full max-w-9xl mx-auto mt-4 sm:mt-5 p-2 sm:p-3 h-[calc(100vh)] rounded-xl bg-white/5 flex items-center justify-center"
      >
        <ToastContainer
          position="top-center"
          autoClose={5000}
          hideProgressBar={false}
          closeOnClick
          pauseOnHover
          draggable
          theme="dark"
        />
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-black/80 backdrop-blur-md border border-white/20 rounded-2xl p-6 sm:p-8 text-center max-w-md w-full"
        >
          <div className="mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-12 w-12 mx-auto text-neon-blue mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h3 className="text-white text-lg sm:text-xl font-bold mb-4">Access from mobile device</h3>
          <p className="text-white/70 mb-6 text-sm sm:text-base">
            This tab works better on a PC browser. We recommend accessing it on a computer for the best experience.
          </p>
          {/* <motion.button
    onClick={() => setShowMobileWarning(false)}
    className="w-full bg-neon-blue/80 hover:bg-neon-blue text-white font-medium py-2 px-4 rounded-lg transition-all duration-300"
    whileHover={{ scale: 1.05 }}
    whileTap={{ scale: 0.95 }}
  >
    Continue on mobile
  </motion.button> */}
        </motion.div>
      </motion.div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      className={`font-jetbrains w-full max-w-9xl mx-auto mt-2 sm:mt-3 p-2 sm:p-3 h-[calc(100vh)] rounded-xl bg-white/5 ${isMobile ? 'pb-8 overflow-y-auto hide-scrollbar' : 'flex'}`}
    >
      <ToastContainer
        position="top-center"
        autoClose={5000}
        hideProgressBar={false}
        closeOnClick
        pauseOnHover
        draggable
        theme="dark"
      />
      <div className={`flex-1 ${isMobile ? '' : 'pr-4'}`}>
        <div className="mb-2 sm:mb-3 pb-2">
          <div className="flex items-center justify-between gap-2 sm:gap-3 flex-wrap">
            <div className="flex items-center gap-2 m-4">
              <div className="relative" ref={chainDropdownRef}>
                <motion.button
                  onClick={() => setIsChainDropdownOpen(!isChainDropdownOpen)}
                  className="text-white px-2 sm:px-3 py-1 rounded-lg border border-white/20 bg-black/10 hover:bg-neon-blue/20 transition-all duration-300 flex items-center gap-2 text-[9px] sm:text-[10px]"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <img
                    src={getPlatformImage(selectedChain, coingeckoChains)}
                    alt={`${mappedChains.find((c) => c.value === selectedChain)?.label || ''}`}
                    width={isMobile ? 12 : 16}
                    height={isMobile ? 12 : 16}
                    className="rounded-lg"
                    loading="lazy"
                  />
                  <span className="font-medium">{mappedChains.find((c) => c.value === selectedChain)?.label || 'Chain'}</span>
                  <span>{isChainDropdownOpen ? '▲' : '▼'}</span>
                </motion.button>
                {isChainDropdownOpen && (
                  <div className="absolute bg-black/50 rounded-xl mt-1 w-36 max-h-56 overflow-y-auto hide-scrollbar border border-white/10 shadow-neon-xs z-50">
                    {mappedChains
                      .filter((chain) => SUPPORTED_CHAINS.includes(chain.value))
                      .map((chain) => (
                        <motion.button
                          key={chain.value}
                          onClick={() => {
                            if (!isPremium && chain.value !== '1') {
                              toast.error('Premium account required to select this chain.', {
                                position: 'top-center',
                                autoClose: 5000,
                                hideProgressBar: false,
                                closeOnClick: true,
                                pauseOnHover: true,
                                draggable: true,
                                theme: 'dark',
                              });
                              return;
                            }
                            setSelectedChain(chain.value);
                            setIsChainDropdownOpen(false);
                            updateUrl(chain.value, walletAddress);
                            setFullIncomingData([]);
                            setFullOutgoingData([]);
                            setFullLayer3Data([]);
                            if (walletAddress) handleSearch();
                          }}
                          className={`flex items-center w-full text-left px-2 sm:px-3 py-1.5 hover:bg-neon-blue/20 rounded-md text-white font-medium text-[9px] sm:text-[10px] transition-all duration-300 relative ${!isPremium && chain.value !== '1' ? 'opacity-50 cursor-not-allowed' : ''}`}
                          whileHover={{ scale: !isPremium && chain.value !== '1' ? 1 : 1.05 }}
                          whileTap={{ scale: !isPremium && chain.value !== '1' ? 1 : 0.95 }}
                        >
                          <img
                            src={chain.image}
                            alt={`${chain.label} logo`}
                            width={isMobile ? 12 : 16}
                            height={isMobile ? 12 : 16}
                            className="mr-2 rounded-xl"
                            loading="lazy"
                          />
                          {chain.label}
                          {!isPremium && chain.value !== '1' && (
                            <span className="absolute right-2 top-1/2 transform -translate-y-1/2 group">
                              <img
                                src="/icons/crown.webp"
                                alt="Premium required"
                                width={isMobile ? 10 : 12}
                                height={isMobile ? 10 : 12}
                                className="opacity-80"
                                loading="lazy"
                              />
                              <span className="absolute hidden group-hover:block bg-white/5 border border-white/10 text-white/80 text-[8px] sm:text-[9px] rounded p-1 -top-5 right-0">
                                Premium required
                              </span>
                            </span>
                          )}
                        </motion.button>
                      ))}
                  </div>
                )}
              </div>
              <div className="relative" ref={limitDropdownRef}>
                <motion.button
                  onClick={() => setIsLimitDropdownOpen(!isLimitDropdownOpen)}
                  className="text-white px-2 sm:px-3 py-1 rounded-lg border border-white/20 bg-black/10 hover:bg-neon-blue/20 transition-all duration-300 flex items-center gap-2 text-[9px] sm:text-[10px]"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <span className="font-medium">Tx Limit: {selectedLimit}</span>
                  <span>{isLimitDropdownOpen ? '▲' : '▼'}</span>
                </motion.button>
                {isLimitDropdownOpen && (
                  <div className="absolute z-20 bg-white/5 rounded-xl mt-1 w-28 max-h-60 overflow-y-auto hide-scrollbar border border-white/10 shadow-neon-sm">
                    {[100, 200, 300, 500].map((limit) => ( // Updated array: 100, 200, 300, 500
                      <motion.button
                        key={limit}
                        onClick={() => {
                          if (!isPremium && limit > 200) {
                            toast.error('Premium account required to fetch more than 200 transactions.', {
                              position: 'top-center',
                              autoClose: 5000,
                              hideProgressBar: false,
                              closeOnClick: true,
                              pauseOnHover: true,
                              draggable: true,
                              theme: 'dark',
                            });
                            return;
                          }
                          setSelectedLimit(limit);
                          setIsLimitDropdownOpen(false);
                          setFullIncomingData([]);
                          setFullOutgoingData([]);
                          setFullLayer3Data([]);
                          if (walletAddress) handleSearch();
                        }}
                        className={`flex items-center w-full text-left px-2 sm:px-3 py-1 hover:bg-neon-blue/20 rounded-md text-white font-medium text-[9px] sm:text-[10px] transition-all duration-300 relative ${!isPremium && limit > 200 ? 'opacity-50 cursor-not-allowed' : ''}`}
                        whileHover={{ scale: !isPremium && limit > 200 ? 1 : 1.05 }}
                        whileTap={{ scale: !isPremium && limit > 200 ? 1 : 0.95 }}
                      >
                        {limit}
                        {!isPremium && limit > 200 && (
                          <span className="absolute right-2 top-1/2 transform -translate-y-1/2 group">
                            <img
                              src="/icons/crown.webp"
                              alt="Premium required"
                              width={isMobile ? 10 : 12}
                              height={isMobile ? 10 : 12}
                              className="opacity-80"
                              loading="lazy"
                            />
                            <span className="absolute hidden group-hover:block bg-white/5 border border-white/10 text-white/80 text-[8px] sm:text-[9px] rounded p-1 -top-5 right-0">
                              Premium required
                            </span>
                          </span>
                        )}
                      </motion.button>
                    ))}
                  </div>
                )}
              </div>
              <motion.button
                onClick={handleFilterChange}
                className="text-white px-2 sm:px-3 py-1 rounded-lg border border-white/20 bg-black/10 hover:bg-neon-blue/20 transition-all duration-300 flex items-center gap-2 text-[9px] sm:text-[10px]"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3 sm:h-4 w-3 sm:w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                  />
                </svg>
                <span className="font-medium">Filter</span>
              </motion.button>
            </div>
            <div className="relative flex items-center w-full sm:w-auto">
              <input
                type="text"
                placeholder="Search wallet (0x...)"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch();
                  }
                }}
                className="bg-black/10 text-white px-2 sm:px-3 py-1.5 rounded-lg text-[9px] sm:text-[10px] w-full sm:w-64 border border-white/20 focus:outline-none focus:ring-2 focus:ring-neon-blue/50 hover:bg-neon-blue/20 transition-all duration-300 pr-8"
              />
              <motion.button
                onClick={handleSearch}
                className="absolute right-1.5 text-white p-1 transition-all duration-300 rounded hover:bg-neon-blue/20"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                disabled={loading}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3 sm:h-4 w-3 sm:w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </motion.button>
            </div>
          </div>
        </div>
        {loading && (
          <motion.div
            className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.4, ease: 'easeInOut' }}
              className={`bg-black/80 border border-white/20 rounded-2xl p-4 sm:p-6 w-full max-w-md ${isMobile ? 'h-[60vh]' : 'max-h-[50vh]'} overflow-y-auto custom-scrollbar`}
            >
              <div className="w-full h-[80%] bg-black/10 backdrop-blur-xl border border-white/20 rounded-xl p-6 relative overflow-hidden shadow-2xl animate-pulse-slow">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-neon-blue to-transparent animate-scan" />
                <div className="absolute inset-0 bg-black/10 backdrop-blur-sm animate-pulse opacity-50" />
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 bg-neon-blue rounded-full animate-pulse" />
                  <h3 className="text-white text-sm sm:text-base font-semibold">Processing</h3>
                </div>
                <div className="h-22 sm:h-28 overflow-y-auto custom-scrollbar log-container relative">
                  <motion.ul
                    layout
                    className="space-y-2"
                    initial={false}
                    animate={{ opacity: 1 }}
                    transition={{ staggerChildren: 0.1, duration: 0.4, ease: 'easeInOut' }}
                  >
                    <AnimatePresence mode="popLayout">
                      {logMessages.map((log, index) => (
                        <motion.li
                          key={log.id}
                          layout
                          initial={{ opacity: 0, y: 20, scale: 0.95 }}
                          animate={{
                            opacity: 1,
                            y: 0,
                            scale: 1,
                            transition: {
                              duration: 0.5,
                              ease: [0.25, 0.46, 0.45, 0.94], // easeInOut cubic
                              delay: index * 0.05
                            }
                          }}
                          exit={{
                            opacity: 0,
                            y: -20,
                            scale: 0.95,
                            transition: { duration: 0.3, ease: 'easeInOut' }
                          }}
                          className={`text-white/80 text-xs font-saira ${index === logMessages.length - 1 ? 'text-neon-blue font-semibold animate-pulse' : 'text-white/60'}`}
                        >
                          <span className="text-neon-blue mr-2">•</span>{log.text}
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </motion.ul>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
        {!loading && nodes.length === 0 && walletInfo.address && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="text-[9px] sm:text-[10px] text-white/60 text-center p-2 sm:p-3 bg-white/5 border border-white/10 rounded-xl shadow-neon-sm"
          >
            <p className="mb-1">No transactions found for this address on {mappedChains.find((c) => c.value === selectedChain)?.label || selectedChain}.</p>
            <p>Please verify the wallet address or try a different chain.</p>
          </motion.div>
        )}
        {walletInfo.address && (
          <div className="relative w-full h-[calc(100vh-8rem)] sm:h-[calc(100vh-6rem)] overflow-hidden">
            <div className="flex gap-2 mb-2 mt-2 justify-center">
              {nodes.length >= page * NODES_PER_PAGE && nodes.length < MAX_NODES && (
                <motion.button
                  onClick={handleLoadMore}
                  className="px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-neon-blue/20 backdrop-blur-md rounded-xl hover:bg-neon-blue/30 transition-all duration-300"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Load More
                </motion.button>
              )}
              {nodes.length >= MAX_NODES && (
                <motion.span
                  className="px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium text-yellow-400 border border-yellow-400/30 bg-yellow-500/10 rounded-xl"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  Max nodes reached (1000). Use filters for subgraphs.
                </motion.span>
              )}
            </div>
            <div ref={containerRef} className="w-full h-full" />
          </div>
        )}
      </div>
      <AnimatePresence>
        {selectedEntity.type === 'cluster' && (
          <ClusterDashboard
            key={selectedEntity.data.clusterId}
            entity={selectedEntity}
            isMobile={isMobile}
            tokenImages={tokenImages}
          />
        )}
        <VirtuosoTable
          key={`${selectedEntity.type}-${selectedEntity.data.id || selectedEntity.data.clusterId}`}
          transactions={selectedEntity.data.transactions}
          isMobile={isMobile}
          selectedChain={selectedChain}
          tokenImages={tokenImages}
          nametags={nametags}
          filterType={filterType}
          rootAddress={walletInfo.address}
        />
      </AnimatePresence>
      <style jsx>{`
  .hide-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .hide-scrollbar::-webkit-scrollbar {
    display: none;
  }
  .shadow-neon-sm {
    box-shadow: 0 0 8px rgba(0, 191, 255, 0.3), 0 0 16px rgba(0, 191, 255, 0.1);
  }
  .shadow-neon-md {
    box-shadow: 0 0 20px rgba(0, 191, 255, 0.2), 0 0 40px rgba(0, 191, 255, 0.1);
  }
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.3);
    border-radius: 3px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.5);
  }
  .log-container {
    -webkit-mask-image: linear-gradient(to bottom, transparent 0%, white 20%, white 80%, transparent 100%);
    mask-image: linear-gradient(to bottom, transparent 0%, white 20%, white 80%, transparent 100%);
  }
  @keyframes scan {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }
  .animate-scan {
    animation: scan 2s linear infinite;
  }
  .animate-pulse-slow {
    animation: pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
  @media (max-width: 640px) {
    .text-[12px] { font-size: 10px; }
    .text-[10px] { font-size: 8px; }
    .text-[9px] { font-size: 7px; }
    .w-56 { width: 12rem; }
    .w-64 { width: 14rem; }
    .w-28 { width: 6rem; }
  }
`}</style>
    </motion.div>
  );
}
