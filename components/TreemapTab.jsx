import { useState, useEffect, useRef, memo } from 'react';
import { isAddress } from 'ethers';
import { motion } from 'framer-motion';
import throttle from 'lodash.throttle';
import crypto from 'crypto-js';

// WalletNode component with improved tooltip and mobile support
const WalletNode = memo(({ address, nametag, image, txHash, type, block_time, value, isRoot = false, onSelect }) => {
  const truncateAddress = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const displayName = nametag !== 'Unknown' ? nametag : truncateAddress(address);

  return (
    <div
      className={`relative flex items-center justify-center p-2 rounded-lg border border-white/10 backdrop-blur-md bg-gray-800/50 hover:bg-white/15 transition-all duration-300 cursor-pointer ${
        isRoot ? 'w-[180px] max-w-[180px] bg-gray-700/70' : 'w-[120px]'
      } group`}
      onClick={() => onSelect(address)}
    >
      <p className="text-white text-[10px] font-medium text-center truncate" title={displayName}>
        {displayName}
      </p>
      {/* Hover Tooltip */}
      <div className="absolute z-50 hidden group-hover:flex flex-col -top-2 left-1/2 transform -translate-x-1/2 -translate-y-full w-64 bg-gray-900/90 border border-white/20 rounded-lg shadow-lg p-3 text-white text-xs font-jetbrains backdrop-blur-md pointer-events-none">
        <div className="flex items-center gap-2 mb-2">
          {image && (
            <img
              src={image}
              alt={`${nametag} logo`}
              className="w-5 h-5 rounded-full"
              onError={(e) => (e.target.src = '/icons/default.png')}
            />
          )}
          <span>{nametag !== 'Unknown' ? nametag : 'No Nametag'}</span>
        </div>
        <p><strong>Address:</strong> {truncateAddress(address)}</p>
        {txHash && <p><strong>Tx Hash:</strong> {truncateAddress(txHash)}</p>}
        {type && <p><strong>Type:</strong> {type}</p>}
        {block_time && <p><strong>Block Time:</strong> {new Date(block_time).toLocaleString()}</p>}
        {value && <p><strong>Value:</strong> {value.toFixed(6)} ETH</p>}
      </div>
    </div>
  );
});

// Cache TTL (1 hour = 3600000 ms)
const CACHE_TTL = 3600000;
const NODES_PER_PAGE = 50;

export default function TreemapTab({ recaptchaRef }) {
  const [walletAddress, setWalletAddress] = useState('');
  const [incomingData, setIncomingData] = useState([]);
  const [outgoingData, setOutgoingData] = useState([]);
  const [walletInfo, setWalletInfo] = useState({ address: '', nametag: 'Unknown', image: '/icons/default.png' });
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [nodePage, setNodePage] = useState(1);
  const svgRef = useRef(null);
  const touchStartRef = useRef({ touches: [], scale: 1 });

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
  const getCachedData = (address, chain) => {
    try {
      const cacheKey = `wallet_transactions_${chain}_${address.toLowerCase()}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL) {
          console.log(`Using cached data for ${address}`);
          return data;
        } else {
          console.log(`Cache expired for ${address}`);
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
      const cacheKey = `wallet_transactions_${chain}_${address.toLowerCase()}`;
      localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
      console.log(`Cached data stored for ${address}`);
    } catch (err) {
      console.error(`Error storing cache for ${address}: ${err.message}`);
    }
  };

  const fetchTransactions = async (address) => {
    if (!isAddress(address)) {
      setError('Invalid wallet address.');
      console.error('Invalid wallet address:', address);
      return;
    }

    const cachedData = getCachedData(address, 'ethereum');
    if (cachedData) {
      setIncomingData(cachedData.incoming);
      setOutgoingData(cachedData.outgoing);
      setWalletInfo(cachedData.wallet);
      setWalletAddress(address);
      setNodePage(1);
      setOffset({ x: 0, y: 0 }); // Reset offset on new search
      setZoom(1); // Reset zoom on new search
      return;
    }

    setLoading(true);
    setError(null);
    setLoadingMessage('Fetching transactions from Etherscan...');

    try {
      if (!recaptchaRef.current) {
        throw new Error('reCAPTCHA not initialized.');
      }
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      const payload = {
        wallet_address: address,
        chain: 'ethereum',
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
          'x-api-key': process.env.INTERNAL_API_KEY || 'f8397e3b47591eb37bcb1b0d1f8bc688626fbc9415db37f7e66dfde9a38db776',
          'x-hmac-signature': signature,
        },
        body: JSON.stringify(payload),
      });

      setLoadingMessage('Looking up nametags...');
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Error fetching transaction data.');
      }

      const incoming = result.incoming
        .filter((tx) => Number(tx.value) > 0)
        .map((tx) => ({
          address: tx.from.toLowerCase(),
          nametag: tx.from_nametag,
          image: tx.from_image,
          txHash: tx.hash,
          value: Number(tx.value),
          block_time: tx.block_time,
          type: 'Incoming',
        }));
      const outgoing = result.outgoing
        .filter((tx) => Number(tx.value) > 0)
        .map((tx) => ({
          address: tx.to.toLowerCase(),
          nametag: tx.to_nametag,
          image: tx.to_image,
          txHash: tx.hash,
          value: Number(tx.value),
          block_time: tx.block_time,
          type: 'Outgoing',
        }));

      setCachedData(address, 'ethereum', { incoming, outgoing, wallet: result.wallet });

      setIncomingData(incoming);
      setOutgoingData(outgoing);
      setWalletInfo(result.wallet);
      setWalletAddress(address);
      setNodePage(1);
      setOffset({ x: 0, y: 0 });
      setZoom(1);
    } catch (err) {
      setError(`Error: ${err.message}`);
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
    console.log('Interaction:', { offset, zoom, nodePage });
  }, [incomingData, outgoingData, walletInfo, offset, zoom, nodePage]);

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
    touchStartRef.current.touches = Array.from(touches).map(t => ({ x: t.clientX, y: t.clientY }));
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
    const isMobile = window.innerWidth < 640;
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

  const { rootX, rootY, incomingNodes, outgoingNodes, nodeWidth, nodeHeight, canvasWidth, canvasHeight } = calculateNodePositions();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="font-jetbrains w-full h-[calc(100vh)] bg-tech p-4 rounded-xl shadow-lg relative overflow-hidden touch-pinch-zoom"
    >
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 mb-4 mt-4">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-bold text-white uppercase">Wallet Flow</h2>
        </div>
        <div className="relative flex items-center w-full sm:w-auto">
          <input
            type="text"
            placeholder="0x..."
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            className="bg-gray-800/50 text-white px-2 py-1 rounded-lg text-xs w-full sm:w-56 border border-white/10 backdrop-blur-md focus:outline-none pr-8"
            aria-label="Wallet address"
            onKeyPress={(e) => {
              if (e.key === 'Enter' && walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
                fetchTransactions(walletAddress);
              }
            }}
          />
          <button
            onClick={() => fetchTransactions(walletAddress)}
            className="absolute right-1 text-white p-1 transition-all duration-300 backdrop-blur-md rounded-r-xl"
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

      <div className="flex gap-2 mb-4 justify-center">
        <button
          onClick={() => {
            setOffset({ x: 0, y: 0 });
            setZoom(1);
          }}
          className="px-2 py-1 bg-gray-800/50 text-white rounded text-xs border border-white/10"
        >
          Reset View
        </button>
        {(incomingData.length > nodePage * NODES_PER_PAGE || outgoingData.length > nodePage * NODES_PER_PAGE) && (
          <button
            onClick={handleLoadMore}
            className="px-2 py-1 bg-gray-800/50 text-white rounded text-xs border border-white/10"
          >
            Load More
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-500 text-center p-4 bg-red-500/10 rounded-lg border border-red-500/30">
          Error: {error}
        </p>
      )}
      {loading && (
        <div className="fixed inset-0 bg-gray/10 flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 border-4 border-gray-600/50 border-t-white rounded-full animate-spin"></div>
              <img
                src="/logos/logo-scan.png"
                alt="Loading Logo"
                className="absolute inset-0 w-8 h-8 m-2 object-contain"
              />
            </div>
            <p className="text-sm text-gray-200 font-medium animate-pulse">{loadingMessage || 'Processing...'}</p>
          </div>
        </div>
      )}
      {!loading && incomingData.length === 0 && outgoingData.length === 0 && !error && (
        <p className="text-xs text-gray-400 text-center flex-1">No transactions to display.</p>
      )}

      {walletInfo.address && (
        <div
          className="relative w-full h-[calc(100vh-120px)] overflow-auto hide-scrollbar touch-pinch-zoom"
          style={{ 
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
                className="transition-all duration-300 hover:stroke-opacity-80"
              />
            ))}
            {outgoingNodes.map((node, index) => (
              <path
                key={`line-out-${index}`}
                d={`M${rootX + nodeWidth + 60} ${rootY + nodeHeight / 2} C${rootX + nodeWidth + 80} ${rootY + nodeHeight / 2}, ${node.x - 50} ${node.y + nodeHeight / 2}, ${node.x} ${node.y + nodeHeight / 2}`}
                stroke="#FF4500"
                strokeWidth="2"
                fill="none"
                strokeDasharray="5,5"
                className="transition-all duration-300 hover:stroke-opacity-80"
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
                onSelect={handleSelectWallet}
              />
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .bg-tech {
          background: linear-gradient(145deg, #1a1a1a, #2a2a2a);
        }
        .spinner-border {
          border-top-color: #00BFFF;
          border-right-color: transparent;
        }
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .touch-pinch-zoom {
          touch-action: pan-x pan-y pinch-zoom;
        }
        @media (max-width: 640px) {
          .relative.w-full {
            overflow: auto;
            -webkit-overflow-scrolling: touch;
          }
        }
      `}</style>
    </motion.div>
  );
}