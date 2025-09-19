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
import cytoscape from 'cytoscape';
import cola from 'cytoscape-cola';
import nodeHtmlLabel from 'cytoscape-node-html-label';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { chains, mapCoinGeckoChains, getPlatformImage } from '../utils/constants';
import { LoadingOverlay, getExplorerUrls } from '@/utils/helpers';
import { cacheData, getCachedData } from '../utils/indexedDB';
import { detectClusters } from '../utils/clustering';
import axios from 'axios';
import { logger } from '../utils/clientLogger';
import { Virtuoso } from 'react-virtuoso';
import { TableVirtuoso } from 'react-virtuoso';
import { lazy, Suspense } from 'react';

const TensorFlowJS = lazy(() => import('@tensorflow/tfjs-core'));

cytoscape.use(cola);
cytoscape.use(nodeHtmlLabel);

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
  '1', '56', '10', '130', '137', '5000', '42161', '43114', '59144', '534352', '7777777', 'solana', 'tron',
];

const isValidDate = (date) => {
  return date instanceof Date && !isNaN(date);
};

// VirtuosoTable component remains unchanged for brevity
const VirtuosoTable = ({ transactions, isMobile, selectedChain, tokenImages, nametags, filterType, rootAddress }) => {
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
          {filterType === 'all' ? 'Select a node or cluster to view transactions.' : `No ${filterType} transactions found.`}
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
    const tokenKey = tx.contractAddress?.toLowerCase() || tx.tokenSymbol?.toLowerCase();
    const tokenLogo = tokenImages[tokenKey] || '/icons/default.webp';
    const fromNtag = nametags[tx.source?.toLowerCase()] || { name: 'Unknown', image: '/icons/default.webp' };
    const toNtag = nametags[tx.target?.toLowerCase()] || { name: 'Unknown', image: '/icons/default.webp' };
    const displayValue = formatLargeNumber(Number(tx.value) || 0, 1);
    const { txUrl } = getExplorerUrls(selectedChain, tx.txHash, '');

    let formattedTime = 'N/A';
    if (tx.block_time) {
      const date = new Date(typeof tx.block_time === 'number' ? tx.block_time * 1000 : tx.block_time);
      if (isValidDate(date)) {
        formattedTime = formatDistanceToNow(date, { addSuffix: true });
      } else {
        logger.warn(`Invalid block_time for tx ${tx.txHash}: ${tx.block_time}`);
      }
    }

    return (
      <tr key={`${tx.txHash}-${index}`} className="grid grid-cols-[2fr_1fr_1fr] gap-2 border-t border-white/10 hover:bg-white/5 transition-all duration-300">
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
                  width={isMobile ? 10 : 12}
                  height={isMobile ? 10 : 12}
                  className="rounded-full flex-shrink-0"
                  onError={(e) => (e.target.style.display = 'none')}
                  loading="lazy"
                />
              )}
              <span className="text-[7px] sm:text-[8px] truncate flex-1 min-w-0">
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
                  className="h-3 w-3 text-white/60 hover:text-neon-blue"
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
                  width={isMobile ? 10 : 12}
                  height={isMobile ? 10 : 12}
                  className="rounded-full flex-shrink-0"
                  onError={(e) => (e.target.style.display = 'none')}
                  loading="lazy"
                />
              )}
              <span className="text-[7px] sm:text-[8px] truncate flex-1 min-w-0">
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
                  className="h-3 w-3 text-white/60 hover:text-neon-blue"
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
        <td className="px-2 py-1 text-white/80 text-[8px] sm:text-[10px] text-center overflow-hidden border-r border-white/5 align-middle">
          <div className="flex flex-col items-center justify-center gap-1">
            <img
              src={tokenLogo}
              alt={`${tx.tokenSymbol || 'Token'} logo`}
              width={isMobile ? 12 : 14}
              height={isMobile ? 12 : 14}
              className="rounded-full flex-shrink-0"
              onError={(e) => (e.target.src = '/icons/default.webp')}
              loading="lazy"
            />
            <span className="text-[7px] sm:text-[8px] font-semibold text-center truncate w-full">
              {displayValue} {tx.tokenSymbol || 'N/A'}
            </span>
          </div>
        </td>
        <td className="px-2 py-1 text-white/80 text-[8px] sm:text-[10px] text-center overflow-hidden align-middle">
          <div className="flex flex-col items-center justify-center gap-1">
            <a href={txUrl} target="_blank" rel="noopener noreferrer">
              <img
                src="/logos/etherscan-logo.webp"
                alt="Explorer"
                width={isMobile ? 10 : 12}
                height={isMobile ? 10 : 12}
                className="rounded-full mx-auto cursor-pointer flex-shrink-0"
                onError={(e) => (e.target.src = '/icons/default.webp')}
                loading="lazy"
              />
            </a>
            <span className="text-[6px] sm:text-[7px] text-white/60 text-center truncate w-full">
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
      className={`bg-black/50 backdrop-blur-md border border-white/10 rounded-xl p-3 hide-scrollbar ${isMobile ? 'w-full mt-2' : 'w-96 fixed right-4 top-32'}`}
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
        overscan={400}
      />
    </motion.div>
  );
};

// Optimized TrendChart with dynamic time intervals and dual metrics
const TrendChart = memo(({ transactions }) => {
  const getTimeInterval = useCallback((timestamps) => {
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const range = maxTime - minTime;
    if (range > 30 * 24 * 3600 * 1000) return 'monthly'; // > 30 days
    if (range > 7 * 24 * 3600 * 1000) return 'weekly'; // > 7 days
    return 'daily';
  }, []);

  const chartData = useMemo(() => {
    if (transactions.length === 0) return [];

    const validTxs = transactions.filter(tx => tx.block_time && !isNaN(new Date(tx.block_time).getTime()));
    if (validTxs.length === 0) return [];

    const timestamps = validTxs.map(tx => new Date(tx.block_time).getTime());
    const interval = getTimeInterval(timestamps);

    const aggregated = {};
    validTxs.forEach(tx => {
      const date = new Date(tx.block_time);
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
      aggregated[key].value += Number(tx.value) || 0;
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
      <h5 className="text-white text-[9px] mb-1">Transaction Trends</h5>
      <Suspense fallback={<div>Loading chart...</div>}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="time" stroke="#ccc" fontSize={8} />
            <YAxis yAxisId="left" stroke="#ccc" fontSize={8} />
            <YAxis yAxisId="right" orientation="right" stroke="#ccc" fontSize={8} />
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

// Optimized ClusterDashboard with additional metrics
const ClusterDashboard = memo(({ entity, isMobile }) => {
  if (!entity || entity.type !== 'cluster') return null;

  const { data: cluster } = entity;
  const totalValue = useMemo(() => cluster.wallets.reduce((sum, w) => sum + parseFloat(w.totalValue || 0), 0), [cluster]);
  const riskScore = cluster.riskScore || 0;
  const avgTxValue = useMemo(() => {
    const txCount = cluster.transactions.length;
    return txCount > 0 ? totalValue / txCount : 0;
  }, [cluster, totalValue]);
  const topTokens = useMemo(() => {
    const tokenCounts = {};
    cluster.transactions.forEach(tx => {
      const token = tx.tokenSymbol || 'Unknown';
      tokenCounts[token] = (tokenCounts[token] || 0) + 1;
    });
    return Object.entries(tokenCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([token]) => token);
  }, [cluster.transactions]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`bg-black/50 backdrop-blur-md border border-white/10 rounded-xl p-2 hide-scrollbar ${isMobile ? 'w-full mt-2' : 'w-72 fixed left-4 top-32'}`}
      style={{ maxHeight: 'calc(100vh - 8rem)' }}
    >
      <h4 className="text-white text-[11px] font-bold mb-1">Cluster: {cluster.nametag}</h4>
      <div className="space-y-1 text-[9px] text-white/80">
        <p>Total Value: {formatLargeNumber(totalValue)}</p>
        <p>Wallets: {cluster.wallets.length}</p>
        <p>Transactions: {cluster.transactions.length}</p>
        <p>Avg. Tx Value: {formatLargeNumber(avgTxValue)}</p>
        <p>Top Tokens: {topTokens.join(', ') || 'N/A'}</p>
        <p>Risk Score: {(riskScore * 100).toFixed(1)}% {riskScore > 0.7 && <span className="text-red-500 ml-1">⚠️ High Risk</span>}</p>
        <Suspense fallback={<div>Loading chart...</div>}>
          <TrendChart transactions={cluster.transactions} />
        </Suspense>
      </div>
    </motion.div>
  );
});

const CACHE_TTL = 3600000;
const NODES_PER_PAGE = 50;

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
  const [loadingMessage, setLoadingMessage] = useState('');
  const [selectedChain, setSelectedChain] = useState(initialChain);
  const [isChainDropdownOpen, setIsChainDropdownOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [coingeckoChains, setCoingeckoChains] = useState([]);
  const [tokenImages, setTokenImages] = useState({});
  const [fullIncomingData, setFullIncomingData] = useState([]);
  const [fullOutgoingData, setFullOutgoingData] = useState([]);
  const [fullLayer3Data, setFullLayer3Data] = useState([]);
  const cyRef = useRef(null);
  const containerRef = useRef(null);
  const chainDropdownRef = useRef(null);
  const limitDropdownRef = useRef(null);
  const [selectedLimit, setSelectedLimit] = useState(50);
  const [isLimitDropdownOpen, setIsLimitDropdownOpen] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedEntity, setSelectedEntity] = useState({ type: null, data: { transactions: [] } });
  const [clusters, setClusters] = useState([]);

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

  useEffect(() => {
    setSelectedEntity({ type: null, data: { transactions: [] } });
  }, [filterType]);

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
      setNodes(newNodes);
      setEdges(newEdges);
      setNametags((prev) => ({ ...prev, ...newNametags }));
      if (cyRef.current) {
        cyRef.current.destroy();
      }
      setTimeout(() => initializeCytoscape(), 100);
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

      const images = {};
      edges.forEach((edge) => {
        const tokenKey = edge.data.contractAddress?.toLowerCase() || edge.data.tokenSymbol?.toLowerCase();
        if (edge.data.tokenSymbol?.toLowerCase() === 'eth' && selectedChain === '1') {
          images[tokenKey] = 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628';
        } else if (edge.data.tokenImage && edge.data.tokenImage !== '/icons/default.webp') {
          images[tokenKey] = edge.data.tokenImage;
        }
      });

      const tokensToFetch = uniqueTokens.filter((token) => !images[token]);

      await Promise.all(
        tokensToFetch.map(async (token) => {
          if (!token) {
            logger.warn(`Skipping invalid token: ${token}`);
            return;
          }

          try {
            const cacheResponse = await fetch(`${apiBaseUrl}/api/cache?key=token_image_${token}`, {
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
            });
            const cacheResult = await cacheResponse.json();
            if (cacheResponse.ok && cacheResult.success && cacheResult.data?.image) {
              logger.log(`Cache hit for ${token}:`, cacheResult.data.image);
              images[token] = cacheResult.data.image;
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
              images[token] = dbResult.data.image;
              await fetch(`${apiBaseUrl}/api/cache`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  key: `token_image_${token}`,
                  action: 'set',
                  data: { image: dbResult.data.image },
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
              images[token] = cgResult.data.image.thumb;
              await fetch(`${apiBaseUrl}/api/cache`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  key: `token_image_${token}`,
                  action: 'set',
                  data: { image: cgResult.data.image.thumb },
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
            } else {
              logger.warn(`No valid image for ${token} from CoinGecko`);
              images[token] = '/icons/default.webp';
            }
          } catch (err) {
            logger.error(`Error fetching token image for ${token}:`, err.message);
            images[token] = '/icons/default.webp';
          }
        })
      );
      logger.log('Token images fetched:', images);
      setTokenImages(images);
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

    walletMap.set(rootAddress.toLowerCase(), {
      address: rootAddress.toLowerCase(),
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
    nametags[rootAddress.toLowerCase()] = {
      name: walletInfo.nametag || 'Unknown',
      image: walletInfo.image || '/icons/default.webp',
    };

    const addWallet = (address, tx, type, layer) => {
      if (filterType === 'incoming' && type !== 'incoming') return;
      if (filterType === 'outgoing' && type !== 'outgoing') return;
      if (layer === 3 && (!tx.nametag || tx.nametag === 'Unknown')) return;

      if (!walletMap.has(address)) {
        walletMap.set(address, {
          address: address.toLowerCase(),
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
        nametags[address.toLowerCase()] = {
          name: tx.nametag || 'Unknown',
          image: tx.image || '/icons/default.webp',
        };
      }
      const wallet = walletMap.get(address);
      wallet.totalValue += Number(tx.value);
      wallet.txCount += 1;
      wallet.latestBlockTime = wallet.latestBlockTime
        ? new Date(tx.block_time) > new Date(wallet.latestBlockTime) ? tx.block_time : wallet.latestBlockTime
        : tx.block_time;
    };

    const filteredIncoming = filterType === 'all' || filterType === 'incoming'
      ? incomingData.filter((tx) => tx.address.toLowerCase() !== rootAddress.toLowerCase() && tx.type === 'incoming')
      : [];
    const filteredOutgoing = filterType === 'all' || filterType === 'outgoing'
      ? outgoingData.filter((tx) => tx.address.toLowerCase() !== rootAddress.toLowerCase() && tx.type === 'outgoing')
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
        isRoot: wallet.address === rootAddress.toLowerCase(),
      },
    }));

    filteredIncoming.forEach((tx, index) => {
      if (walletMap.has(tx.address.toLowerCase()) && walletMap.has(rootAddress.toLowerCase())) {
        edges.push({
          data: {
            id: `in-edge-${page}-${index}-${tx.hash}`,
            source: tx.address.toLowerCase(),
            target: rootAddress.toLowerCase(),
            value: Number(tx.value).toFixed(6),
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
      if (walletMap.has(rootAddress.toLowerCase()) && walletMap.has(tx.address.toLowerCase())) {
        edges.push({
          data: {
            id: `out-edge-${page}-${index}-${tx.hash}`,
            source: rootAddress.toLowerCase(),
            target: tx.address.toLowerCase(),
            value: Number(tx.value).toFixed(6),
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
    if (!isAddress(address) && !['solana', 'tron'].includes(selectedChain)) {
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

    const cacheKey = `graph_full_${selectedChain}_${address}_${page}`;
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
    setLoadingMessage(`Fetching transactions (page ${page})...`);

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
        setLoadingMessage('');
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
      setLoadingMessage('');
    }
  }, [selectedChain, selectedLimit, session, apiBaseUrl, filterType, walletInfo]);

  const filterTransactions = useCallback((transactions, filterType, rootId, walletId = null) => {
    let txs = transactions || [];
    if (walletId) {
      txs = txs
        .map((edge) => ({ ...edge.data, type: edge.data.type }))
        .filter((tx) => tx.source === walletId || tx.target === walletId);
    }
    if (filterType !== 'all') {
      txs = txs.filter((tx) => {
        if (filterType === 'incoming') return tx.type === 'incoming' && tx.target?.toLowerCase() === rootId;
        if (filterType === 'outgoing') return tx.type === 'outgoing' && tx.source?.toLowerCase() === rootId;
        return false;
      });
    }
    return [...txs];
  }, []);

  const initializeCytoscape = useCallback(async () => {
    if (!containerRef.current || !nodes.length || !walletInfo.address) return;

    try {
      await TensorFlowJS;
      logger.log('TensorFlow.js loaded for clustering');

      if (cyRef.current) {
        cyRef.current.destroy();
      }

      const rootId = walletInfo.address.toLowerCase();
      let elements = [...nodes, ...edges];

      const detectedClusters = await detectClusters(
        nodes.map((node) => ({ ...node.data, timestamp: Date.now() })),
        edges.map((edge) => edge.data),
        { useDBSCAN: true, useGNN: true }
      );
      setClusters(detectedClusters);

      detectedClusters.forEach((cluster) => {
        const parentId = `cluster-${cluster.clusterId}`;
        elements.push({
          data: { id: parentId, label: cluster.nametag },
          style: { 'background-color': `hsl(${cluster.clusterId * 60}, 70%, 50%)`, width: 200, height: 150 }
        });
        cluster.wallets.forEach((wallet) => {
          elements.push({
            data: { id: wallet.id, parent: parentId, ...wallet.data }
          });
        });
      });

      cyRef.current = cytoscape({
        container: containerRef.current,
        elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-image': (ele) => {
                const image = ele.data('isRoot') ? walletInfo.image : ele.data('image');
                logger.log(`Node ${ele.data('id')} image (isRoot: ${ele.data('isRoot')}):`, image);
                if (isValidNametagImage(image)) {
                  return image.startsWith('http')
                    ? image
                    : `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}${image}`;
                }
                return 'none';
              },
              'background-fit': 'cover',
              'background-clip': 'node',
              'background-color': (ele) => {
                if (ele.data('layer') === 1) return '#4F46E5';
                if (ele.data('layer') === 2) return '#10B981';
                if (ele.data('layer') === 3) return '#F59E0B';
                return '#666';
              },
              'width': (ele) => (ele.data('isRoot') ? 150 : ele.data('layer') === 3 ? 64 : 56),
              'height': (ele) => (ele.data('isRoot') ? 150 : ele.data('layer') === 3 ? 64 : 56),
              'text-valign': 'center',
              'text-halign': 'center',
              'font-size': '12px',
              'color': '#fff',
              'border-width': 1,
              'border-color': '#fff',
              'border-opacity': 0.5,
            },
          },
          {
            selector: 'edge',
            style: {
              width: (ele) => (ele.data('layer') === 3 ? 1.5 : 2),
              'line-color': (ele) =>
                ele.data('type') === 'incoming'
                  ? ele.data('layer') === 3
                    ? '#ffffffff'
                    : '#00BFFF'
                  : ele.data('layer') === 3
                    ? '#ffffffff'
                    : '#EF4444',
              'curve-style': 'bezier',
            },
          },
          {
            selector: 'node[?parent]',
            style: {
              'background-opacity': 0.8,
              'width': 40,
              'height': 40,
            }
          },
          {
            selector: ':parent',
            style: {
              'background-opacity': 0.3,
              'text-valign': 'center',
              'color': '#fff',
              'font-size': '14px',
            }
          },
        ],
        layout: {
          name: 'cola',
          nodeSpacing: (node) => (node.data('layer') === 1 ? 200 : node.data('layer') === 2 ? 120 : 80),
          edgeLength: (edge) => (edge.data('layer') === 2 ? 150 : 100),
          fit: true,
          padding: 50,
          animate: true,
          animationDuration: 1000,
          avoidOverlap: true,
          handleDisconnected: true,
          maxSimulationTime: 4000,
          compoundSpringLength: () => 100,
        },
      });

      cyRef.current.on('tap', 'node:parent', (evt) => {
        const node = evt.target;
        node.children().toggleClass('collapsed', !node.hasClass('collapsed'));
        cyRef.current.layout({ name: 'cola' }).run();
      });

      cyRef.current.nodeHtmlLabel([
        {
          query: 'node',
          halign: 'center',
          valign: 'bottom',
          halignBox: 'center',
          valignBox: 'bottom',
          tpl: (data) => {
            const cluster = detectedClusters.find((c) => c.wallets.some((w) => w.id === data.id));
            const risk = cluster?.riskScore || 0;
            const clusterLabel = data.isRoot ? walletInfo.nametag || 'Unknown' : cluster ? cluster.nametag : 'Unknown';
            const image = data.isRoot ? walletInfo.image : data.image;
            const nametag = data.isRoot ? '' : data.label !== 'Unknown' ? data.label : truncateAddress(data.id);
            logger.log(`Rendering node label for ${data.id}, isRoot: ${data.isRoot}, image: ${image}`);
            return `
            <div class="node-label bg-black/80 border border-white/10 text-white/80 text-[10px] sm:text-[11px] py-1 px-2 rounded">
              ${data.isRoot ? `<div>Cluster: ${clusterLabel}</div>` : `<div>${nametag}${data.layer === 3 ? ' (L3)' : ''}</div>`}
              <div>Tx: ${data.txCount} | Value: ${formatLargeNumber(Number(data.totalValue), 1)} ${data.tokenSymbol}</div>
              <div>Risk: ${(risk * 100).toFixed(0)}%</div>
            </div>
          `;
          },
        },
      ]);

      // Optimized hover handler to ensure data updates
      cyRef.current.on('mouseover', 'node', throttle((evt) => {
        const node = evt.target;
        const walletId = node.data('id');
        const rootId = walletInfo.address.toLowerCase();
        const isRootNode = node.data('isRoot');
        const cluster = detectedClusters.find(c => c.wallets.some(w => w.id === walletId));
        const risk = cluster?.riskScore || 0;

        if (risk > 0.7) {
          toast.warn(`High risk detected for ${walletId}: ${(risk * 100).toFixed(1)}%`, { theme: 'dark' });
        }

        // Clear previous selection to force update
        setSelectedEntity({ type: null, data: { transactions: [] } });

        // Use setTimeout to ensure state update is processed
        setTimeout(() => {
          if (!isRootNode && cluster) {
            const clusterTxs = filterTransactions(cluster.transactions, filterType, rootId);
            logger.log('Cluster transactions:', clusterTxs);
            setSelectedEntity({ type: 'cluster', data: { ...cluster, transactions: clusterTxs } });
          } else {
            const relatedTxs = filterTransactions(edges, filterType, rootId, walletId);
            logger.log('Node transactions:', relatedTxs);
            setSelectedEntity({ type: 'node', data: { id: walletId, transactions: relatedTxs } });
          }
        }, 0);
      }, 100));

      cyRef.current.nodes().forEach((node) => {
        const wallet = node.data('id');
        const cluster = detectedClusters.find((c) => c.wallets.some((w) => w.id === wallet));
        if (cluster && !node.data('isRoot')) {
          node.style('border-color', `hsl(${cluster.clusterId * 60}, 70%, 50%)`);
          node.style('border-width', 2);
        }
        if (node.data('layer') === 3) {
          node.style('border-color', '#FFD700');
          node.style('border-width', 2);
        }
      });

      cyRef.current.on('layoutstop', () => {
        const root = cyRef.current.getElementById(rootId);
        if (root.length) {
          const rootPos = root.position();
          cyRef.current.nodes().forEach((node) => {
            const pos = node.position();
            node.position({
              x: pos.x - rootPos.x,
              y: pos.y - rootPos.y,
            });
          });
        }
        requestAnimationFrame(() => cyRef.current?.fit());
      });
    } catch (err) {
      logger.error('Error initializing Cytoscape:', err);
      const fallbackClusters = detectClusters(nodes.map((n) => n.data), edges.map((e) => e.data), { useML: false });
      setClusters(fallbackClusters);
      cyRef.current = cytoscape({
        container: containerRef.current,
        elements: [...nodes, ...edges],
        style: [
          {
            selector: 'node',
            style: {
              'background-image': (ele) => {
                const image = ele.data('isRoot') ? walletInfo.image : ele.data('image');
                if (isValidNametagImage(image)) {
                  return image.startsWith('http')
                    ? image
                    : `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}${image}`;
                }
                return 'none';
              },
              'background-fit': 'cover',
              'background-clip': 'node',
              'background-color': (ele) => {
                if (ele.data('layer') === 1) return '#4F46E5';
                if (ele.data('layer') === 2) return '#10B981';
                if (ele.data('layer') === 3) return '#F59E0B';
                return '#666';
              },
              'width': (ele) => (ele.data('isRoot') ? 150 : ele.data('layer') === 3 ? 64 : 56),
              'height': (ele) => (ele.data('isRoot') ? 150 : ele.data('layer') === 3 ? 64 : 56),
              'text-valign': 'center',
              'text-halign': 'center',
              'font-size': '12px',
              'color': '#fff',
              'border-width': 1,
              'border-color': '#fff',
              'border-opacity': 0.5,
            },
          },
          {
            selector: 'edge',
            style: {
              width: (ele) => (ele.data('layer') === 3 ? 1.5 : 2),
              'line-color': (ele) =>
                ele.data('type') === 'incoming'
                  ? ele.data('layer') === 3
                    ? '#FFD700'
                    : '#00BFFF'
                  : ele.data('layer') === 3
                    ? '#FFD700'
                    : '#EF4444',
              'curve-style': 'bezier',
            },
          },
        ],
        layout: {
          name: 'cola',
          nodeSpacing: (node) => (node.data('layer') === 1 ? 200 : node.data('layer') === 2 ? 120 : 80),
          edgeLength: (edge) => (edge.data('layer') === 2 ? 150 : 100),
          fit: true,
          padding: 50,
          animate: true,
          animationDuration: 1000,
          avoidOverlap: true,
          handleDisconnected: true,
          maxSimulationTime: 4000,
        },
      });
    }
  }, [nodes, edges, walletInfo, filterType, walletAddress, filterTransactions]);

  useEffect(() => {
    initializeCytoscape().catch(console.error);
    return () => {
      if (cyRef.current) cyRef.current.destroy();
    };
  }, [initializeCytoscape]);

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
    if (addressFromUrl && (isAddress(addressFromUrl) || ['solana', 'tron'].includes(chainFromUrl))) {
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
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (session?.user) {
      setIsPremium(session.user.isPremium || false);
    }
  }, [session]);

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

  const handleLoadMore = useCallback(() => {
    setPage((prev) => {
      const newPage = prev + 1;
      fetchTransactions(walletAddress, newPage);
      return newPage;
    });
  }, [fetchTransactions, walletAddress]);

  const handleSearch = useCallback(() => {
    if (
      (['solana', 'tron'].includes(selectedChain) && walletAddress.match(/^[A-Za-z0-9]{32,44}$/)) ||
      (!['solana', 'tron'].includes(selectedChain) && isAddress(walletAddress))
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

  const mappedChains = coingeckoChains.length > 0 ? mapCoinGeckoChains(coingeckoChains) : chains;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      className={`font-jetbrains w-full max-w-9xl mx-auto mt-4 sm:mt-5 p-2 sm:p-3 h-[calc(100vh)] rounded-xl bg-white/5 ${isMobile ? 'pb-8 overflow-y-auto hide-scrollbar' : 'flex'}`}
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
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <h3 className="text-[10px] sm:text-[12px] font-bold text-white uppercase tracking-wider bg-gradient-to-r from-neon-blue/20 to-transparent p-2 rounded flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3 sm:h-4 w-3 sm:w-4 stroke-neon-blue fill-none"
                viewBox="0 0 24 24"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                />
              </svg>
              Network Graph
            </h3>
          </div>
          <div className="flex items-center justify-between gap-2 sm:gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="relative" ref={chainDropdownRef}>
                <motion.button
                  onClick={() => setIsChainDropdownOpen(!isChainDropdownOpen)}
                  className="text-white px-2 sm:px-3 py-1 rounded-lg border border-white/20 bg-black/10 hover:bg-neon-blue/20 transition-all duration-300 flex items-center gap-2 text-[9px] sm:text-[10px]"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <img
                    src={getPlatformImage(selectedChain, coingeckoChains)}
                    alt={`${mappedChains.find((c) => c.value === selectedChain)?.label || 'Chain'} logo`}
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
                    {[50, 100, 150, 200].map((limit) => (
                      <motion.button
                        key={limit}
                        onClick={() => {
                          if (!isPremium && limit > 100) {
                            toast.error('Premium account required to fetch more than 100 transactions.', {
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
                        className={`flex items-center w-full text-left px-2 sm:px-3 py-1 hover:bg-neon-blue/20 rounded-md text-white font-medium text-[9px] sm:text-[10px] transition-all duration-300 relative ${!isPremium && limit > 100 ? 'opacity-50 cursor-not-allowed' : ''}`}
                        whileHover={{ scale: !isPremium && limit > 100 ? 1 : 1.05 }}
                        whileTap={{ scale: !isPremium && limit > 100 ? 1 : 0.95 }}
                      >
                        {limit}
                        {!isPremium && limit > 100 && (
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

        {loading && <LoadingOverlay isLoading={true} message={loadingMessage} isMobile={isMobile} />}
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
          <div className="relative w-full h-[calc(100vh-10rem)] sm:h-[calc(100vh-8rem)] overflow-hidden">
            <div className="flex gap-2 mb-2 mt-2 justify-center">
              {nodes.length >= page * NODES_PER_PAGE && (
                <motion.button
                  onClick={handleLoadMore}
                  className="px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-neon-blue/20 backdrop-blur-md rounded-xl hover:bg-neon-blue/30 transition-all duration-300"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Load More
                </motion.button>
              )}
            </div>
            <div ref={containerRef} className="w-full h-full" />
          </div>
        )}
      </div>
      <AnimatePresence>
        {selectedEntity.type === 'cluster' && (
          <ClusterDashboard entity={selectedEntity} isMobile={isMobile} />
        )}
        <VirtuosoTable
          key={selectedEntity.data.transactions.length} // Ép re-render khi transactions thay đổi
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
    -ms-overflow-style: none;  /* Ẩn cho IE và Edge */
    scrollbar-width: none;  /* Ẩn cho Firefox */
  }

  .hide-scrollbar::-webkit-scrollbar {
    display: none;  /* Ẩn cho Chrome, Safari, và các browser dựa trên WebKit */
  }

  .shadow-neon-sm {
    box-shadow: 0 0 8px rgba(0, 191, 255, 0.3), 0 0 16px rgba(0, 191, 255, 0.1);
  }

  .node-label {
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.8);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 9px;
    pointer-events: none;
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