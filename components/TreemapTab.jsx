// components/TreemapTab.jsx
'use client';

import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isAddress } from 'ethers';
import throttle from 'lodash.throttle';
import crypto from 'crypto-js';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { formatDistanceToNow } from 'date-fns';
import cytoscape from 'cytoscape';
import cola from 'cytoscape-cola';
import nodeHtmlLabel from 'cytoscape-node-html-label';
import { chains, mapCoinGeckoChains, getPlatformImage, getExplorerUrls } from '../utils/constants';
import { LoadingOverlay } from '@/utils/helpers';
import { cacheData, getCachedData } from '../utils/indexedDB';
import { detectClusters } from '../utils/clustering';
import axios from 'axios';
import { logger } from '../utils/clientLogger';

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

const TransactionTable = memo(({ transactions, isMobile, selectedChain, tokenImages, nametags }) => {
  const handleTxClick = (txHash) => {
    const explorerUrl = getExplorerUrls(selectedChain)?.tx + txHash;
    if (explorerUrl) {
      window.open(explorerUrl, '_blank');
    } else {
      logger.error('Explorer URL not available for this chain.');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className={`bg-black/50 backdrop-blur-md border border-white/10 rounded-xl p-3 max-h-[calc(100vh-12rem)] overflow-y-auto custom-scrollbar ${isMobile ? 'w-full mt-2' : 'w-96 fixed right-4 top-32'}`}
    >
      <h4 className="text-white text-[10px] sm:text-[12px] font-bold uppercase tracking-wider mb-2">Transactions</h4>
      {transactions.length === 0 ? (
        <p className="text-white/60 text-[9px] sm:text-[10px]">Select a node or cluster to view transactions.</p>
      ) : (
        <table className="w-full table-fixed text-[8px] sm:text-[9px] bg-black/5 rounded-xl">
          <thead className="border-b border-white/10 bg-black/10">
            <tr>
              <th className="w-[50%] px-2 py-2 text-white font-medium text-center">From/To</th>
              <th className="w-[25%] px-2 py-2 text-white font-medium text-center">Value</th>
              <th className="w-[25%] px-2 py-2 text-white font-medium text-center">Details</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx, index) => {
              const tokenKey = tx.contractAddress?.toLowerCase() || tx.tokenSymbol?.toLowerCase();
              const tokenLogo = tokenImages[tokenKey] || '/icons/default.webp';
              logger.log(`Transaction ${tx.txHash}: Using tokenKey=${tokenKey}, tokenLogo=${tokenLogo}`);
              const fromNtag = nametags[tx.source?.toLowerCase()] || { name: 'Unknown', image: '/icons/default.webp' };
              const toNtag = nametags[tx.target?.toLowerCase()] || { name: 'Unknown', image: '/icons/default.webp' };
              const displayValue = formatLargeNumber(Number(tx.value) || 0, 1);

              return (
                <motion.tr
                  key={`${tx.txHash}-${index}`}
                  className="border-t border-white/10 hover:bg-white/5 transition-all duration-300"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.02 }}
                >
                  <td className="px-2 py-2 text-white/80 text-[8px] sm:text-[10px] text-center">
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-2 group relative">
                        {isValidNametagImage(fromNtag.image) && (
                          <img
                            src={fromNtag.image}
                            alt="From wallet logo"
                            width={isMobile ? 10 : 12}
                            height={isMobile ? 10 : 12}
                            className="rounded-full"
                            onError={(e) => (e.target.style.display = 'none')}
                            loading="lazy"
                          />
                        )}
                        <span className="text-[7px] sm:text-[8px] truncate">{fromNtag.name !== 'Unknown' ? fromNtag.name : truncateAddress(tx.source)}</span>
                      </div>
                      <div className="flex items-center gap-2 group relative">
                        {isValidNametagImage(toNtag.image) && (
                          <img
                            src={toNtag.image}
                            alt="To wallet logo"
                            width={isMobile ? 10 : 12}
                            height={isMobile ? 10 : 12}
                            className="rounded-full"
                            onError={(e) => (e.target.style.display = 'none')}
                            loading="lazy"
                          />
                        )}
                        <span className="text-[7px] sm:text-[8px] truncate">{toNtag.name !== 'Unknown' ? toNtag.name : truncateAddress(tx.target)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-white/80 text-[8px] sm:text-[10px] text-center">
                    <div className="flex items-center justify-center gap-2">
                      <img
                        src={tokenLogo}
                        alt={`${tx.tokenSymbol || 'Token'} logo`}
                        width={isMobile ? 10 : 12}
                        height={isMobile ? 10 : 12}
                        className="rounded-full"
                        onError={(e) => (e.target.src = '/icons/default.webp')}
                        loading="lazy"
                      />
                      <span className="text-[7px] sm:text-[8px] font-semibold">{displayValue} {tx.tokenSymbol || 'N/A'}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-white/80 text-[8px] sm:text-[10px] text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <a href={getExplorerUrls(selectedChain)?.tx + tx.txHash} target="_blank" rel="noopener noreferrer" onClick={() => handleTxClick(tx.txHash)}>
                        <img
                          src="/logos/etherscan-logo.webp"
                          alt="Etherscan"
                          width={isMobile ? 10 : 12}
                          height={isMobile ? 10 : 12}
                          className="rounded-full mx-auto"
                          onError={(e) => (e.target.src = '/icons/default.webp')}
                          loading="lazy"
                        />
                      </a>
                      <span className="text-[5px] sm:text-[7px] text-white/60 truncate">
                        {tx.block_time ? formatDistanceToNow(new Date(tx.block_time), { addSuffix: true }) : 'N/A'}
                      </span>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      )}
    </motion.div>
  );
});

const CACHE_TTL = 3600000; // 1 hour
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
  const cyRef = useRef(null);
  const containerRef = useRef(null);
  const chainDropdownRef = useRef(null);
  const limitDropdownRef = useRef(null);
  const [selectedLimit, setSelectedLimit] = useState(100);
  const [isLimitDropdownOpen, setIsLimitDropdownOpen] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [filter, setFilter] = useState({ type: 'all', minValue: 0 });
  const [page, setPage] = useState(1);
  const [selectedEntity, setSelectedEntity] = useState({ type: null, data: { transactions: [] } });

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

  // Fetch token images from database and fallback to CoinGecko
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
      // Initialize with tokenImage from transaction data
      edges.forEach((edge) => {
        const tokenKey = edge.data.contractAddress?.toLowerCase() || edge.data.tokenSymbol?.toLowerCase();
        if (edge.data.tokenImage && edge.data.tokenImage !== '/icons/default.webp') {
          images[tokenKey] = edge.data.tokenImage;
        }
      });

      // Filter out tokens that already have images
      const tokensToFetch = uniqueTokens.filter((token) => !images[token]);

      await Promise.all(
        tokensToFetch.map(async (token) => {
          if (!token) {
            logger.warn(`Skipping invalid token: ${token}`);
            return;
          }

          try {
            // Check cache first
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

            // Query local database for token image
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

              // Cache the result
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

            // Fallback to CoinGecko if not found in database
            logger.log(`Falling back to CoinGecko for ${token}`);
            const cgResponse = await fetch(`${apiBaseUrl}/api/coingecko?action=token-details&${queryParam}&chain=${selectedChain}`, {
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
            });
            const cgResult = await cgResponse.json();

            if (cgResponse.ok && cgResult.success && cgResult.data?.image?.thumb) {
              logger.log(`CoinGecko hit for ${token}:`, cgResult.data.image.thumb);
              images[token] = cgResult.data.image.thumb;

              // Cache the CoinGecko result
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
            } else {
              logger.warn(`No valid image for ${token} from CoinGecko`);
              images[token] = '/icons/default.webp';
            }
          } catch (err) {
            logger.error(`Error fetching token image for ${token}:`, err.message);
            images[token] = '/icons/default.webp';
          }
        }),
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

  const aggregateWallets = (incomingData, outgoingData, rootAddress, page) => {
    const walletMap = new Map();
    const nametags = {};

    // Initialize root node with walletInfo data
    walletMap.set(rootAddress.toLowerCase(), {
      address: rootAddress.toLowerCase(),
      nametag: walletInfo.nametag || 'Unknown',
      image: walletInfo.image || '/icons/default.webp', // Use walletInfo.image
      chainLogo: walletInfo.chainLogo || '/icons/default.webp',
      tokenSymbol: 'Unknown',
      totalValue: 0,
      txCount: 0,
      latestBlockTime: null,
      type: 'root',
    });
    nametags[rootAddress.toLowerCase()] = {
      name: walletInfo.nametag || 'Unknown',
      image: walletInfo.image || '/icons/default.webp', // Use walletInfo.image
    };

    const addWallet = (address, tx, type) => {
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

    incomingData.forEach((tx) => addWallet(tx.address, tx, 'incoming'));
    outgoingData.forEach((tx) => addWallet(tx.address, tx, 'outgoing'));

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
        isRoot: wallet.address === rootAddress.toLowerCase(),
      },
    }));

    const edges = [];
    incomingData.forEach((tx, index) => {
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
          },
        });
      }
    });
    outgoingData.forEach((tx, index) => {
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

  const cacheKey = `graph_${selectedChain}_${address}_${page}`;
  const cached = await getCachedData(cacheKey);
  if (cached) {
    setNodes(cached.nodes);
    setEdges(cached.edges);
    setWalletInfo(cached.wallet);
    setWalletAddress(address);
    updateUrl(selectedChain, address);
    logger.log('Cached walletInfo.image:', cached.wallet.image); // Debug cached image
    return;
  }

  setLoading(true);
  setLoadingMessage(`Fetching transactions (page ${page})...`);

  try {
    const payload = { wallet_address: address, chain: selectedChain, limit: selectedLimit, page };
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
    if (!data.incoming || !data.outgoing) {
      throw new Error(data.error || 'Invalid response from API.');
    }

    if (data.incoming.length === 0 && data.outgoing.length === 0) {
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
      setWalletInfo({ address: '', nametag: 'Unknown', image: null, chainLogo: '/icons/default.webp' });
      setLoading(false);
      setLoadingMessage('');
      return;
    }

    logger.log('API response walletInfo.image:', data.wallet.image); // Debug API image
    const { nodes, edges, nametags } = aggregateWallets(data.incoming, data.outgoing, address, page);
    await cacheData(cacheKey, { nodes, edges, wallet: data.wallet, nametags }, CACHE_TTL);
    setNodes((prev) => page === 1 ? nodes : [...prev, ...nodes]);
    setEdges((prev) => page === 1 ? edges : [...prev, ...edges]);
    setWalletInfo(data.wallet);
    setWalletAddress(address);
    updateUrl(selectedChain, address);
  } catch (err) {
    logger.error(`Error: ${err.message}`);
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
    setWalletInfo({ address: '', nametag: 'Unknown', image: null, chainLogo: '/icons/default.webp' });
  } finally {
    setLoading(false);
    setLoadingMessage('');
  }
}, [selectedChain, selectedLimit, session, apiBaseUrl]);

  const initializeCytoscape = useCallback(() => {
  if (!containerRef.current || !nodes.length) return;

  try {
    // Debug: Log walletInfo.image to check its value
    logger.log('walletInfo.image for root node:', walletInfo.image);

    cyRef.current = cytoscape({
      container: containerRef.current,
      elements: [...nodes, ...edges],
      style: [
        {
          selector: 'node',
          style: {
            'background-image': (ele) => {
              const image = ele.data('image');
              logger.log(`Node ${ele.data('id')} image:`, image); // Debug image for each node
              if (isValidNametagImage(image)) {
                return image.startsWith('http')
                  ? image
                  : `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}${image}`;
              }
              return 'none';
            },
            'background-fit': 'cover',
            'background-clip': 'node',
            'background-color': '#666',
            'width': (ele) => ele.data('isRoot') ? 72 : 48,
            'height': (ele) => ele.data('isRoot') ? 72 : 48,
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '10px',
            'color': '#fff',
            'border-width': 1,
            'border-color': '#fff',
            'border-opacity': 0.5,
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': (ele) => ele.data('type') === 'incoming' ? '#00BFFF' : '#EF4444',
            'curve-style': 'bezier',
          },
        },
      ],
      layout: {
        name: 'cola',
        nodeSpacing: 80,
        edgeLength: 200,
        animate: true,
        maxSimulationTime: 3000,
      },
    });

    const clusters = detectClusters(
      nodes.map((node) => node.data),
      edges.map((edge) => edge.data)
    );

    cyRef.current.nodeHtmlLabel([
      {
        query: 'node',
        halign: 'center',
        valign: 'bottom',
        halignBox: 'center',
        valignBox: 'bottom',
        tpl: (data) => {
          const cluster = clusters.find((c) => c.wallets.some((w) => w.id === data.id));
          const clusterLabel = data.isRoot ? (walletInfo.nametag || 'Unknown') : (cluster ? cluster.nametag : 'Unknown');
          const image = data.isRoot ? walletInfo.image : data.image;
          return `
            <div class="node-label bg-black/80 border border-white/10 text-white/80 text-[9px] py-1 px-2 rounded">
              <div class="flex items-center gap-2 mb-1">
                ${isValidNametagImage(image) ? `
                  <img
                    src="${image.startsWith('http') ? image : `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}${image}`}"
                    alt="${data.label} logo"
                    width="12"
                    height="12"
                    class="rounded-full"
                    onerror="this.style.display='none'"
                  />
                ` : ''}
                <span>${data.label}</span>
              </div>
              <div>Cluster: ${clusterLabel}</div>
              <div>Tx: ${data.txCount} | Value: ${formatLargeNumber(Number(data.totalValue), 1)} ${data.tokenSymbol}</div>
            </div>
          `;
        },
      },
    ]);

    cyRef.current.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      const walletId = node.data('id');
      const cluster = clusters.find((c) => c.wallets.some((w) => w.id === walletId));
      if (cluster && !node.data('isRoot')) {
        logger.log('Hover cluster:', cluster);
        setSelectedEntity({ type: 'cluster', data: cluster });
      } else {
        const relatedTxs = edges
          .map((edge) => edge.data)
          .filter((tx) => tx.source === walletId || tx.target === walletId);
        logger.log('Hover node:', walletId, relatedTxs);
        setSelectedEntity({ type: 'node', data: { id: walletId, transactions: relatedTxs } });
      }
    });

    cyRef.current.nodes().forEach((node) => {
      const wallet = node.data('id');
      const cluster = clusters.find((c) => c.wallets.some((w) => w.id === wallet));
      if (cluster && !node.data('isRoot')) {
        node.style('border-color', `hsl(${cluster.clusterId * 60}, 70%, 50%)`);
        node.style('border-width', 2);
      }
    });
  } catch (err) {
    logger.error('Error initializing Cytoscape:', err);
  }
}, [nodes, edges, isMobile, walletInfo.nametag, walletInfo.image]);

  useEffect(() => {
    initializeCytoscape();
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
    if (chains.some((c) => c.value === chainFromUrl)) {
      setSelectedChain(chainFromUrl);
    }
    if (addressFromUrl && isAddress(addressFromUrl)) {
      setWalletAddress(addressFromUrl);
      fetchTransactions(addressFromUrl);
    }
  }, [searchParams, initialChain, initialAddress, fetchTransactions]);

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

  const mappedChains = coingeckoChains.length > 0 ? mapCoinGeckoChains(coingeckoChains) : chains;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      className={`font-jetbrains w-full max-w-9xl mx-auto mt-4 sm:mt-5 p-2 sm:p-3 h-[calc(100vh)] rounded-xl bg-white/5 ${isMobile ? 'pb-8 overflow-y-auto custom-scrollbar' : 'flex'}`}
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
            <motion.button
              onClick={() => cyRef.current?.fit()}
              className="px-2 py-1 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 rounded-xl hover:bg-neon-blue/20"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Reset View
            </motion.button>
          </div>
          <div className="flex items-center justify-end gap-2 sm:gap-3 flex-wrap">
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
                <div className="absolute bg-black/50 rounded-xl mt-1 w-36 max-h-56 overflow-y-auto custom-scrollbar border border-white/10 shadow-neon-xs z-50">
                  {mappedChains.map((chain) => (
                    <motion.button
                      key={chain.value}
                      onClick={() => {
                        setSelectedChain(chain.value);
                        setIsChainDropdownOpen(false);
                        updateUrl(chain.value, walletAddress);
                        if (walletAddress) fetchTransactions(walletAddress, 1);
                      }}
                      className="flex items-center w-full text-left px-2 sm:px-3 py-1.5 hover:bg-neon-blue/20 rounded-md text-white font-medium text-[9px] sm:text-[10px] transition-all duration-300"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
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
                <div className="absolute z-20 bg-white/5 rounded-xl mt-1 w-28 max-h-60 overflow-y-auto custom-scrollbar border border-white/10 shadow-neon-sm">
                  {[100, 200, 300, 500].map((limit) => (
                    <motion.button
                      key={limit}
                      onClick={() => {
                        setSelectedLimit(limit);
                        setIsLimitDropdownOpen(false);
                        if (walletAddress) fetchTransactions(walletAddress, 1);
                      }}
                      className="flex items-center w-full text-left px-2 sm:px-3 py-1 hover:bg-neon-blue/20 rounded-md text-white font-medium text-[9px] sm:text-[10px] transition-all duration-300"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      {limit}
                    </motion.button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative flex items-center w-full sm:w-auto">
              <input
                type="text"
                placeholder="Search wallet (0x...)"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                className="bg-black/10 text-white px-2 sm:px-3 py-1.5 rounded-lg text-[9px] sm:text-[10px] w-full sm:w-64 border border-white/20 focus:outline-none focus:ring-2 focus:ring-neon-blue/50 hover:bg-neon-blue/20 transition-all duration-300 pr-8"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && (
                    (['solana', 'tron'].includes(selectedChain) && walletAddress.match(/^[A-Za-z0-9]{32,44}$/)) ||
                    (!['solana', 'tron'].includes(selectedChain) && isAddress(walletAddress))
                  )) {
                    fetchTransactions(walletAddress, 1);
                  }
                }}
              />
              <motion.button
                onClick={() => fetchTransactions(walletAddress, 1)}
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
          <div className="flex gap-2 mt-2 justify-center">
            <select
              value={filter.type}
              onChange={(e) => setFilter({ ...filter, type: e.target.value })}
              className="bg-black/10 text-white px-2 py-1 rounded text-[9px] sm:text-[10px]"
            >
              <option value="all">All Transactions</option>
              <option value="incoming">Incoming</option>
              <option value="outgoing">Outgoing</option>
            </select>
            <input
              type="number"
              placeholder="Min Value"
              value={filter.minValue}
              onChange={(e) => setFilter({ ...filter, minValue: Number(e.target.value) })}
              className="bg-black/10 text-white px-2 py-1 rounded text-[9px] sm:text-[10px]"
            />
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
              <motion.button
                onClick={() => cyRef.current?.fit()}
                className="px-2 sm:px-3 py-1 text-[9px] sm:text-[10px] font-medium text-white border border-white/10 bg-white/5 backdrop-blur-md rounded-xl hover:bg-neon-blue/20 transition-all duration-300"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Reset View
              </motion.button>
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
        <TransactionTable
          transactions={selectedEntity.data.transactions}
          isMobile={isMobile}
          selectedChain={selectedChain}
          tokenImages={tokenImages}
          nametags={nodes.reduce((acc, node) => ({
            ...acc,
            [node.data.id.toLowerCase()]: {
              name: node.data.label,
              image: node.data.image,
            },
          }), {})}
        />
      </AnimatePresence>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.4);
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