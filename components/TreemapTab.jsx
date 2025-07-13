import { useState, useEffect, useRef, memo } from 'react';
import { useSession } from 'next-auth/react';
import { isAddress } from 'ethers';
import { motion } from 'framer-motion';
import throttle from 'lodash.throttle';
import crypto from 'crypto-js';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Image from 'next/image';
import { formatDistanceToNow } from 'date-fns';
import { chains, mapCoinGeckoChains, getPlatformImage, getExplorerUrls } from '../utils/constants';
import axios from 'axios';


const WalletNode = memo(({ address, nametag, image, txHash, type, block_time, value, chainLogo, isRoot = false, onSelect }) => {
  const truncateAddress = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const displayName = nametag !== 'Unknown' ? nametag : truncateAddress(address);

  const handleCopyAddress = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      toast.success('Address copied to clipboard!', {
        position: 'top-center',
        autoClose: 3000,
      });
    } catch (err) {
      console.error('Failed to copy address:', err);
      toast.error('Failed to copy address.', {
        position: 'top-center',
        autoClose: 3000,
      });
    }
  };

  return (
    <div
      className={`relative flex items-center justify-center p-2 rounded-xl border border-white/10 backdrop-blur-lg bg-gray-900/30 duration-200 cursor-pointer group ${isRoot ? 'w-[160px] max-w-[160px] bg-gray-900/50 shadow-glow-neon' : 'w-[100px]'
        }`}
      onClick={() => onSelect(address)}
    >
      <button
        onClick={handleCopyAddress}
        className="absolute top-1 right-1 z-20 p-1 rounded-full hover:bg-gray-700/50 transition-colors duration-200 group-hover:block hidden"
        title="Copy address"
        aria-label="Copy wallet address"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3 w-3 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      </button>

      <p className="text-white text-[9px] font-medium text-center truncate mr-2" title={displayName}>
        {displayName}
      </p>
      <div className="absolute z-50 hidden group-hover:flex flex-col -top-2 left-1/2 transform -translate-x-1/2 -translate-y-full w-64 bg-gray-900/95 border border-white/10 rounded-lg shadow-glow-neon p-2 text-white text-xs font-jetbrains backdrop-blur-lg pointer-events-none">
        <div className="flex items-center gap-2 mb-2">
          {image && (
            <Image
              src={image}
              alt={`${nametag} logo`}
              width={20}
              height={20}
              className="rounded-full"
              onError={() => console.log(`Failed to load wallet image: ${image}`)}
            />
          )}
          <span className="font-bold">{nametag !== 'Unknown' ? nametag : 'No Nametag'}</span>
        </div>
        <p><strong>Address:</strong> {truncateAddress(address)}</p>
        {txHash && (
          <p>
            <strong>Tx Hash:</strong>{' '}
            <a
              href={getExplorerUrls('ethereum', txHash, address).txUrl}
              target="_blank"
              rel="noreferrer"
              className="text-neon-blue hover:underline"
            >
              {truncateAddress(txHash)}
            </a>
          </p>
        )}
        {type && <p><strong>Type:</strong> {type}</p>}
        {block_time && <p><strong>Block Time:</strong> {new Date(block_time).toLocaleString()}</p>}
        {value != null && <p><strong>Value:</strong> {value < 0.000001 ? value.toExponential(4) : value.toFixed(6)} ETH</p>}
      </div>
    </div>
  );
});

// LoadingOverlay component
const LoadingOverlay = ({ message }) => {
  return (
    <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-lg flex items-center justify-center z-50">
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-10 h-10">
          <div className="absolute inset-0 border-2 border-neon-blue/50 border-t-neon-blue rounded-full animate-spin"></div>
          <Image
            src="/logos/logo-scan.png"
            alt="Loading Logo"
            width={40}
            height={40}
            className="absolute inset-0 w-7 h-7 m-1.5 object-contain animate-pulse"
            onError={() => console.log(`Failed to load loading logo: /logos/logo-scan.png`)}
          />
        </div>
        <p className="text-[10px] text-gray-500 font-medium animate-pulse">{message || 'Processing...'}</p>
      </div>
    </div>
  );
};

// Cache TTL (1 hour = 3600000 ms)
const CACHE_TTL = 3600000;
const NODES_PER_PAGE = 50;

export default function TreemapTab({ recaptchaRef }) {
  const { data: session, status } = useSession();
  const [walletAddress, setWalletAddress] = useState('');
  const [incomingData, setIncomingData] = useState([]);
  const [outgoingData, setOutgoingData] = useState([]);
  const [walletInfo, setWalletInfo] = useState({ address: '', nametag: 'Unknown', image: '/icons/default.png', chainLogo: '/icons/default.png' });
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [nodePage, setNodePage] = useState(1);
  const [selectedChain, setSelectedChain] = useState('ethereum');
  const [isChainDropdownOpen, setIsChainDropdownOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [coingeckoChains, setCoingeckoChains] = useState([]);
  const svgRef = useRef(null);
  const chainDropdownRef = useRef(null);
  const limitDropdownRef = useRef(null);
  const touchStartRef = useRef({ touches: [], scale: 1 });
  const [selectedLimit, setSelectedLimit] = useState(100);
  const [isLimitDropdownOpen, setIsLimitDropdownOpen] = useState(false);
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    if (session?.user) {
      setIsPremium(session.user.isPremium || false);
    }
  }, [session]);

  // Fetch CoinGecko chains
  useEffect(() => {
    const fetchCoingeckoChains = async () => {
      try {
        const response = await axios.get('/api/coingecko/chains');
        if (response.data.success) {
          setCoingeckoChains(response.data.data);
          console.log('Fetched CoinGecko chains:', response.data.data.slice(0, 5));
        } else {
          console.error('Failed to fetch CoinGecko chains:', response.data.detail);
          toast.error('Failed to load chain data. Using fallback images.', {
            position: 'top-center',
            autoClose: 5000,
          });
        }
      } catch (error) {
        console.error('Error fetching CoinGecko chains:', error.message);
        toast.error('Error loading chain data. Using fallback images.', {
          position: 'top-center',
          autoClose: 5000,
        });
      }
    };
    fetchCoingeckoChains();
  }, []);

  // Generate HMAC signature
  const generateHmacSignature = (payload) => {
    try {
      const hmacSecret = process.env.HMAC_SECRET || '88583e5e555aaeb3d9b3b0cafbd1e609f5a7ff96548caa71c8eda0783d66b1f1';
      const sortedPayload = JSON.stringify(payload, Object.keys(payload).sort());
      const signature = crypto.HmacSHA256(sortedPayload, hmacSecret).toString(crypto.enc.Hex);
      console.log('HMAC Signature:', signature);
      return signature;
    } catch (err) {
      console.error('Error generating HMAC signature:', err.message);
      return null;
    }
  };

  // Cache handling
  const getCachedData = (address, chain, limit) => {
    try {
      const cacheKey = `wallet_transactions_${chain}_${address.toLowerCase()}_${limit}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL) {
          console.log(`Using cached data for ${address} with limit ${limit}`);
          return data;
        } else {
          console.log(`Cache expired for ${address} with limit ${limit}`);
          localStorage.removeItem(cacheKey);
        }
      }
    } catch (err) {
      console.error(`Error reading cache for ${address}: ${err.message}`);
    }
    return null;
  };

  const setCachedData = (address, chain, data) => {
    try {
      const cacheKey = `wallet_transactions_${chain}_${address.toLowerCase()}_${selectedLimit}`;
      localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
      console.log(`Cached data stored for ${address} with limit ${selectedLimit}`);
    } catch (err) {
      console.error(`Error storing cache for ${address}: ${err.message}`);
    }
  };

  const fetchTransactions = async (address) => {
    if (!isAddress(address)) {
      toast.error('Invalid wallet address. Please enter a valid Ethereum address.', {
        position: 'top-center',
        autoClose: 5000,
      });
      console.error('Invalid wallet address:', address);
      return;
    }

    const cachedData = getCachedData(address, selectedChain, selectedLimit);
    if (cachedData) {
      setIncomingData(cachedData.incoming);
      setOutgoingData(cachedData.outgoing);
      setWalletInfo(cachedData.wallet);
      setIsPremium(cachedData.wallet.isPremium || false);
      setWalletAddress(address);
      setNodePage(1);
      setOffset({ x: 0, y: 0 });
      setZoom(1);
      return;
    }

    setLoading(true);
    setLoadingMessage(`Fetching transactions from ${chains.find((c) => c.value === selectedChain)?.label || 'blockchain'}...`);

    try {
      if (!recaptchaRef.current) {
        throw new Error('reCAPTCHA not initialized.');
      }
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      const payload = {
        wallet_address: address,
        chain: selectedChain,
        limit: selectedLimit,
      };
      const signature = generateHmacSignature(payload);
      if (!signature) {
        throw new Error('Unable to generate HMAC signature.');
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/get-transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
          'x-api-key': session?.user?.apiKey || 'default-api-key',
          'x-hmac-signature': signature,
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 304) {
        console.log('Received 304 Not Modified, using cached data if available');
        const cached = getCachedData(address, selectedChain, selectedLimit);
        if (cached) {
          setIncomingData(cached.incoming);
          setOutgoingData(cached.outgoing);
          setWalletInfo(cached.wallet);
          setIsPremium(cached.wallet.isPremium || false);
          setWalletAddress(address);
          setNodePage(1);
          setOffset({ x: 0, y: 0 });
          setZoom(1);
          setLoading(false);
          return;
        }
      }

      setLoadingMessage('Looking up nametags...');
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Error fetching transaction data.');
      }

      const incoming = result.incoming.map((tx) => ({
        address: tx.from.toLowerCase(),
        nametag: tx.from_nametag,
        image: tx.from_image,
        txHash: tx.hash,
        value: parseFloat(tx.value),
        block_time: tx.block_time,
        type: 'Incoming',
        chainLogo: tx.chainLogo,
      }));
      const outgoing = result.outgoing.map((tx) => ({
        address: tx.to.toLowerCase(),
        nametag: tx.to_nametag,
        image: tx.to_image,
        txHash: tx.hash,
        value: parseFloat(tx.value),
        block_time: tx.block_time,
        type: 'Outgoing',
        chainLogo: tx.chainLogo,
      }));

      if (incoming.length === 0 && outgoing.length === 0) {
        toast.info(`No transactions found for this address on ${chains.find((c) => c.value === selectedChain)?.label || selectedChain}. Please verify the address or try another chain.`, {
          position: 'top-center',
          autoClose: 5000,
        });
      }

      setCachedData(address, selectedChain, { incoming, outgoing, wallet: result.wallet });

      setIncomingData(incoming);
      setOutgoingData(outgoing);
      setWalletInfo(result.wallet);
      setIsPremium(result.wallet.isPremium || false);
      setWalletAddress(address);
      setNodePage(1);
      setOffset({ x: 0, y: 0 });
      setZoom(1);
    } catch (err) {
      toast.error(`Error: ${err.message}`, {
        position: 'top-center',
        autoClose: 5000,
      });
      console.error(`Error fetching transactions for ${address}: ${err.message}`, { response: err.response });
    } finally {
      setLoading(false);
      setLoadingMessage('');
      if (recaptchaRef.current) recaptchaRef.current.reset();
    }
  };

  useEffect(() => {
    console.log('Incoming Data Updated:', incomingData);
    console.log('Outgoing Data Updated:', outgoingData);
    console.log('Wallet Info Updated:', walletInfo);
    console.log('Interaction:', { offset, zoom, nodePage, selectedChain });
  }, [incomingData, outgoingData, walletInfo, offset, zoom, nodePage, selectedChain]);

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

  const handleSelectWallet = (address) => {
    if (address !== walletInfo.address) {
      fetchTransactions(address);
    }
  };

  // Mouse events
  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = throttle((e) => {
    if (isDragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  }, 16);

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch events
  const handleTouchStart = (e) => {
    e.preventDefault();
    const touches = e.touches;
    touchStartRef.current.touches = Array.from(touches).map((t) => ({ x: t.clientX, y: t.clientY }));
    if (touches.length === 1) {
      setIsDragging(true);
      setDragStart({ x: touches[0].clientX - offset.x, y: touches[0].clientY - offset.y });
    } else if (touches.length === 2) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      touchStartRef.current.scale = Math.sqrt(dx * dx + dy * dy);
    }
  };

  const handleTouchMove = throttle((e) => {
    e.preventDefault();
    const touches = e.touches;
    if (touches.length === 1 && isDragging) {
      setOffset({
        x: touches[0].clientX - dragStart.x,
        y: touches[0].clientY - dragStart.y,
      });
    } else if (touches.length === 2) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      const scale = Math.sqrt(dx * dx + dy * dy);
      const zoomChange = scale / touchStartRef.current.scale;
      setZoom((prev) => Math.min(Math.max(prev * zoomChange, 0.5), 2));
      touchStartRef.current.scale = scale;
    }
  }, 16);

  const handleTouchEnd = () => {
    setIsDragging(false);
    touchStartRef.current = { touches: [], scale: 1 };
  };

  const handleWheel = throttle((e) => {
    e.preventDefault();
    const delta = e.deltaY * -0.001;
    setZoom((prev) => Math.min(Math.max(prev + delta, 0.5), 2));
  }, 16);

  const handleLoadMore = () => {
    setNodePage((prev) => {
      const newPage = prev + 1;
      console.log(`Loading more nodes: page ${newPage}, showing up to ${newPage * NODES_PER_PAGE} nodes per type`);
      return newPage;
    });
  };

  const calculateNodePositions = () => {
    const limitedIncoming = incomingData.slice(0, nodePage * NODES_PER_PAGE);
    const limitedOutgoing = outgoingData.slice(0, nodePage * NODES_PER_PAGE);
    const totalNodes = limitedIncoming.length + limitedOutgoing.length;
    const nodeWidth = isMobile ? 100 : totalNodes > 20 ? 100 : totalNodes > 10 ? 120 : 150;
    const nodeHeight = isMobile ? 50 : totalNodes > 20 ? 40 : totalNodes > 10 ? 50 : 60;
    const spacing = isMobile ? 20 : totalNodes > 20 ? 15 : 10;
    const columns = isMobile ? 2 : totalNodes > 30 ? 4 : totalNodes > 10 ? 2 : 1;

    const canvasWidth = isMobile ? window.innerWidth : 2000;
    const canvasHeight = isMobile ? window.innerHeight : 1000;
    const rootX = canvasWidth / 2 - nodeWidth / 2;
    let rootY = canvasHeight / 2 - nodeHeight / 2;

    if (isMobile) {
      const incomingHeight = Math.ceil(limitedIncoming.length / columns) * (nodeHeight + spacing);
      const outgoingHeight = Math.ceil(limitedOutgoing.length / columns) * (nodeHeight + spacing);
      rootY = 100 + incomingHeight + nodeHeight + 2 * spacing;

      const incomingNodes = limitedIncoming.map((node, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const gridWidth = columns * (nodeWidth + spacing) - spacing;
        const startX = canvasWidth / 2 - gridWidth / 2;
        return {
          ...node,
          x: startX + col * (nodeWidth + spacing),
          y: 100 + row * (nodeHeight + spacing),
        };
      });

      const outgoingNodes = limitedOutgoing.map((node, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const gridWidth = columns * (nodeWidth + spacing) - spacing;
        const startX = canvasWidth / 2 - gridWidth / 2;
        return {
          ...node,
          x: startX + col * (nodeWidth + spacing),
          y: rootY + nodeHeight + 2 * spacing + row * (nodeHeight + spacing),
        };
      });

      return { rootX, rootY, incomingNodes, outgoingNodes, nodeWidth, nodeHeight, canvasWidth, canvasHeight };
    } else {
      const incomingWidth = columns * (nodeWidth + spacing) - spacing;
      const outgoingWidth = columns * (nodeWidth + spacing) - spacing;

      const incomingNodes = limitedIncoming.map((node, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const startX = rootX - incomingWidth - 18 * spacing;
        return {
          ...node,
          x: startX + col * (nodeWidth + spacing),
          y: rootY - (Math.ceil(limitedIncoming.length / columns) * (nodeHeight + spacing)) / 2 + row * (nodeHeight + spacing),
        };
      });

      const outgoingNodes = limitedOutgoing.map((node, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const startX = rootX + nodeWidth + 25 * spacing;
        return {
          ...node,
          x: startX + col * (nodeWidth + spacing),
          y: rootY - (Math.ceil(limitedOutgoing.length / columns) * (nodeHeight + spacing)) / 2 + row * (nodeHeight + spacing),
        };
      });

      return { rootX, rootY, incomingNodes, outgoingNodes, nodeWidth, nodeHeight, canvasWidth, canvasHeight };
    }
  };

  const mappedChains = coingeckoChains.length > 0 ? mapCoinGeckoChains(coingeckoChains) : chains;
  const { rootX, rootY, incomingNodes, outgoingNodes, nodeWidth, nodeHeight, canvasWidth, canvasHeight } = calculateNodePositions();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="font-jetbrains w-full max-w-10xl mx-auto bg-tech/90 backdrop-blur-xl mt-6 md:mt-10 p-4 md:p-6 shadow-2xl h-[calc(100vh)] overflow-hidden"
    >
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Dropdown chọn chain */}
          <div className="relative" ref={chainDropdownRef}>
            <button
              onClick={() => setIsChainDropdownOpen(!isChainDropdownOpen)}
              className="text-white px-2 py-1 rounded-full border border-white/10 backdrop-blur-md hover:bg-white/10 transition-colors duration-200 flex items-center gap-1.5 text-xs"
              aria-label="Select chain"
            >
              <Image
                src={getPlatformImage(selectedChain, coingeckoChains)}
                alt={`${mappedChains.find((c) => c.value === selectedChain)?.label || 'Chain'} logo`}
                width={16}
                height={16}
                className="rounded-full"
                onError={() => console.log(`Failed to load chain image: ${getPlatformImage(selectedChain, coingeckoChains)} for chain: ${selectedChain}`)}
              />
              <span className="text-xs font-medium">
                {mappedChains.find((c) => c.value === selectedChain)?.label || 'Chain'}
              </span>
              <span className="text-xs">{isChainDropdownOpen ? '▲' : '▼'}</span>
            </button>
            {isChainDropdownOpen && (
              <div className="absolute z-20 bg-gray-900/95 backdrop-blur-lg rounded-lg mt-1 w-56 max-h-72 overflow-y-auto custom-scrollbar border border-white/10 shadow-glow-neon">
                {mappedChains.length === 0 ? (
                  <div className="px-3 py-1.5 text-gray-400 text-xs">No supported chains available</div>
                ) : (
                  mappedChains
                    .filter((chain) => process.env.NODE_ENV === 'development' || !chain.testnet)
                    .map((chain) => (
                      <button
                        key={chain.value}
                        onClick={() => {
                          if (!isPremium && chain.value !== '1') {
                            toast.error('Premium account required to select this chain.', {
                              position: 'top-center',
                              autoClose: 5000,
                            });
                            return;
                          }
                          console.log(`Selected chain: ${chain.value}, image: ${chain.image}`);
                          setSelectedChain(chain.value);
                          setIsChainDropdownOpen(false);
                        }}
                        className={`flex items-center w-full text-left px-3 py-1.5 hover:bg-white/10 rounded-md text-white font-medium text-xs transition-colors duration-200 relative ${!isPremium && chain.value !== '1' ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                      >
                        <Image
                          src={chain.image}
                          alt={`${chain.label} logo`}
                          width={16}
                          height={16}
                          className="mr-2 rounded-full"
                          onError={() => console.log(`Failed to load chain image: ${chain.image} for chain: ${chain.value}`)}
                        />
                        {chain.label}
                        {!isPremium && chain.value !== '1' && (
                          <span className="absolute right-2 top-1/2 transform -translate-y-1/2">
                            <Image
                              src="/icons/crown.png"
                              alt="Premium required"
                              width={12}
                              height={12}
                              className="opacity-80"
                            />
                            <span className="absolute hidden group-hover:block bg-gray-900/90 text-white text-[10px] rounded p-1 -top-5 right-0">
                              Premium required
                            </span>
                          </span>
                        )}
                      </button>
                    ))
                )}
              </div>
            )}
          </div>
          {/* Dropdown chọn limit */}
          <div className="relative" ref={limitDropdownRef}>
            <button
              onClick={() => setIsLimitDropdownOpen(!isLimitDropdownOpen)}
              className="text-white px-2 py-1 rounded-full border border-white/10 backdrop-blur-md hover:bg-white/10 transition-colors duration-200 flex items-center text-xs"
              aria-label="Select transaction limit"
            >
              <span className="text-xs font-medium">Txh: {selectedLimit}</span>
              <span className="ml-2 text-xs">{isLimitDropdownOpen ? '▲' : '▼'}</span>
            </button>
            {isLimitDropdownOpen && (
              <div className="absolute z-20 bg-gray-900/95 backdrop-blur-lg rounded-lg mt-1 w-28 max-h-60 overflow-y-auto custom-scrollbar border border-white/10 shadow-glow-neon">
                {[100, 200, 300, 500].map((limit) => (
                  <button
                    key={limit}
                    onClick={() => {
                      if (!isPremium && limit > 100) {
                        toast.error('Premium account required to fetch more than 100 transactions.', {
                          position: 'top-center',
                          autoClose: 5000,
                        });
                        return;
                      }
                      setSelectedLimit(limit);
                      setIsLimitDropdownOpen(false);
                      if (walletAddress) {
                        fetchTransactions(walletAddress);
                      }
                    }}
                    className={`flex items-center w-full text-left px-3 py-1.5 hover:bg-white/10 rounded-md text-white font-medium text-xs transition-colors duration-200 relative ${!isPremium && limit > 100 ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                  >
                    {limit}
                    {!isPremium && limit > 100 && (
                      <span className="absolute right-2 top-1/2 transform -translate-y-1/2">
                        <Image
                          src="/icons/crown.png"
                          alt="Premium required"
                          width={12}
                          height={12}
                          className="opacity-80"
                        />
                        <span className="absolute hidden group-hover:block bg-gray-900/90 text-white text-[10px] rounded p-1 -top-5 right-0">
                          Premium required
                        </span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Input địa chỉ ví */}
          <div className="relative flex items-center w-full sm:w-auto">
            <input
              type="text"
              placeholder="Search wallet (0x...)"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              className="bg-gray-900/50 text-white px-3 py-1 rounded-full text-[10px] w-full sm:w-64 border border-white/10 backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-neon-blue/50 transition-colors duration-200 pr-8"
              aria-label="Wallet address"
              onKeyPress={(e) => {
                if (e.key === 'Enter' && walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
                  fetchTransactions(walletAddress);
                }
              }}
            />
            <button
              onClick={() => fetchTransactions(walletAddress)}
              className="absolute right-1.5 text-white p-1 rounded-full hover:bg-white/10 transition-colors duration-200"
              aria-label="Search wallet"
              disabled={loading}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      

      {loading && <LoadingOverlay message={loadingMessage} />}
      {!loading && incomingData.length === 0 && outgoingData.length === 0 && walletInfo.address && (
        <div className="text-center text-gray-400 text-sm p-4 bg-gray-900/30 rounded-2xl border border-white/10 backdrop-blur-lg shadow-glow-neon">
          <p className="mb-2">No transactions found for this address on {mappedChains.find((c) => c.value === selectedChain)?.label || selectedChain}.</p>
          <p>Please verify the wallet address or try a different chain.</p>
        </div>
      )}
      {walletInfo.address && (
        
        <div className="relative w-full h-[calc(100vh)] overflow-hidden backdrop-blur-lg shadow-glow-neon">
          <div className="flex gap-2 mb-2 mt-2 justify-center">
        <motion.button
          onClick={() => {
            setOffset({ x: 0, y: 0 });
            setZoom(1);
          }}
          className="px-2 py-1 rounded-xl text-[9px] md:text-[10px] font-medium text-white border border-white/20 backdrop-blur-md hover:bg-white/10 transition-all duration-300"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          Reset View
        </motion.button>
        {(incomingData.length > nodePage * NODES_PER_PAGE || outgoingData.length > nodePage * NODES_PER_PAGE) && (
          <motion.button
            onClick={handleLoadMore}
            className="px-4 py-1.5 rounded-full text-sm font-medium text-white border border-white/20 backdrop-blur-md hover:bg-white/10 transition-all duration-300"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Load More
          </motion.button>
        )}
      </div>
          <div
            className="relative w-full h-full"
            style={{
              touchAction: 'none',
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              transformOrigin: 'center',
              width: `${canvasWidth}px`,
              height: `${canvasHeight}px`,
              minWidth: '100%',
              minHeight: '100%',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <svg ref={svgRef} className="absolute inset-0 pointer-events-none" style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}>
              {incomingNodes.map((node, index) => (
                <path
                  key={`line-in-${index}`}
                  d={`M${node.x + nodeWidth} ${node.y + nodeHeight / 2} C${node.x + nodeWidth + 50} ${node.y + nodeHeight / 2}, ${rootX - 50} ${rootY + nodeHeight / 2}, ${rootX} ${rootY + nodeHeight / 2}`}
                  stroke="#00BFFF"
                  strokeWidth="2"
                  fill="none"
                  strokeDasharray="5,5"
                  className="transition-all duration-300 hover:stroke-neon-blue/80"
                />
              ))}
              {outgoingNodes.map((node, index) => (
                <path
                  key={`line-out-${index}`}
                  d={`M${rootX + nodeWidth + 60} ${rootY + nodeHeight / 2} C${rootX + nodeWidth + 80} ${rootY + nodeHeight / 2}, ${node.x - 50} ${node.y + nodeHeight / 2}, ${node.x} ${node.y + nodeHeight / 2}`}
                  stroke="#EF4444"
                  strokeWidth="2"
                  fill="none"
                  strokeDasharray="5,5"
                  className="transition-all duration-300 hover:stroke-red-500/80"
                />
              ))}
            </svg>

            <div
              className="absolute z-10 group"
              style={{ left: `${rootX}px`, top: `${rootY}px` }}
            >
              <WalletNode
                address={walletInfo.address}
                nametag={walletInfo.nametag}
                image={walletInfo.image}
                chainLogo={walletInfo.chainLogo}
                isRoot={true}
                onSelect={handleSelectWallet}
              />
            </div>

            {incomingNodes.map((node, index) => (
              <div
                key={`in-${index}`}
                className="absolute group"
                style={{ left: `${node.x}px`, top: `${node.y}px` }}
              >
                <WalletNode
                  address={node.address}
                  nametag={node.nametag}
                  image={node.image}
                  txHash={node.txHash}
                  type={node.type}
                  block_time={node.block_time}
                  value={node.value}
                  chainLogo={node.chainLogo}
                  onSelect={handleSelectWallet}
                />
              </div>
            ))}

            {outgoingNodes.map((node, index) => (
              <div
                key={`out-${index}`}
                className="absolute group"
                style={{ left: `${node.x}px`, top: `${node.y}px` }}
              >
                <WalletNode
                  address={node.address}
                  nametag={node.nametag}
                  image={node.image}
                  txHash={node.txHash}
                  type={node.type}
                  block_time={node.block_time}
                  value={node.value}
                  chainLogo={node.chainLogo}
                  onSelect={handleSelectWallet}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <ToastContainer position="top-center" autoClose={5000} />
      <style jsx>{`
      .hide-scrollbar::-webkit-scrollbar {
        display: none;
      }
      .hide-scrollbar {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }
      .custom-scrollbar::-webkit-scrollbar {
        width: 6px;
      }
      .custom-scrollbar::-webkit-scrollbar-track {
        background: transparent;
      }
      .custom-scrollbar::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 3px;
      }
      .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.3);
      }
      @media (max-width: 640px) {
        .relative.w-full {
          overflow: hidden;
          -webkit-overflow-scrolling: auto;
        }
      }
    `}</style>
    </motion.div>
  );
}