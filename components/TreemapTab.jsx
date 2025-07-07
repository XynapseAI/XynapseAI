// components/TreemapTab.jsx
import { useState, useEffect, useRef } from 'react';
import { isAddress } from 'ethers';
import { motion } from 'framer-motion';

const WalletNode = ({ address, nametag, image, txHash, type, isRoot = false, onSelect }) => {
  const truncateAddress = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const explorerUrl = txHash ? `https://etherscan.io/tx/${txHash}` : `https://etherscan.io/address/${address}`;

  return (
    <div
      className={`flex items-center p-2 rounded-lg border border-white/10 backdrop-blur-md bg-gray-800/50 hover:bg-white/15 transition-all duration-300 cursor-pointer ${isRoot ? 'w-[180px] max-w-[180px] bg-gray-700/70 overflow-hidden' : 'min-w-[100px]'
        }`}
      onClick={() => onSelect(address)}
    >
      {image && (
        <img
          src={image}
          alt={`${nametag} logo`}
          className="w-5 h-5 mr-2 rounded-full flex-shrink-0"
          onError={(e) => {
            e.target.src = '/icons/default.png';
          }}
        />
      )}
      <div className="flex-1 min-w-0 overflow-hidden">
        <p className="text-white text-[10px] font-medium break-words max-h-[32px]" title={nametag}>
          {nametag !== 'Unknown' ? nametag : truncateAddress(address)}
        </p>
        <p className="text-gray-500 text-[8px] truncate">{truncateAddress(address)}</p>
      </div>
      {txHash && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-2 flex-shrink-0"
          title="View on Etherscan"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src="/logos/etherscan-logo.png"
            alt="Etherscan"
            className="w-4 h-4"
            onError={(e) => {
              e.target.src = '/fallback-image.png';
            }}
          />
        </a>
      )}
    </div>
  );
};

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
  const svgRef = useRef(null);

  const fetchTransactions = async (address) => {
    if (!isAddress(address)) {
      setError('Địa chỉ ví không hợp lệ.');
      return;
    }
    setLoading(true);
    setError(null);
    setLoadingMessage('Đang lấy giao dịch từ Etherscan...');
    try {
      if (!recaptchaRef.current) throw new Error('reCAPTCHA không được khởi tạo.');
      const recaptchaToken = await recaptchaRef.current.executeAsync();
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/get-transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Recaptcha-Token': recaptchaToken,
        },
        body: JSON.stringify({
          wallet_address: address,
          chain: 'ethereum',
        }),
      });
      setLoadingMessage('Đang tra cứu nametag...');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Lỗi khi lấy dữ liệu giao dịch.');

      const incoming = result.incoming
        .filter((tx) => Number(tx.value) > 0)
        .map((tx) => ({
          address: tx.from,
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
          address: tx.to,
          nametag: tx.to_nametag,
          image: tx.to_image,
          txHash: tx.hash,
          value: Number(tx.value),
          block_time: tx.block_time,
          type: 'Outgoing',
        }));

      console.log('Incoming Data:', incoming);
      console.log('Outgoing Data:', outgoing);
      console.log('Wallet Info:', result.wallet);

      setIncomingData(incoming);
      setOutgoingData(outgoing);
      setWalletInfo(result.wallet);
      setWalletAddress(address);
    } catch (err) {
      setError(`Lỗi: ${err.message}`);
      console.error(`Lỗi khi lấy giao dịch cho ${address}: ${err.message}`);
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
    console.log('Interaction:', { offset, zoom });
  }, [incomingData, outgoingData, walletInfo, offset, zoom]);

  // Xử lý chọn ví mới làm ví gốc
  const handleSelectWallet = (address) => {
    if (address !== walletInfo.address) {
      fetchTransactions(address);
    }
  };

  // Xử lý kéo/di chuyển
  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Xử lý zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY * -0.001;
    setZoom((prev) => Math.min(Math.max(prev + delta, 0.5), 2)); // Giới hạn zoom 0.5x - 2x
  };

  // Tính toán vị trí các ô và đường nối
  const calculateNodePositions = () => {
    const isMobile = window.innerWidth < 640;
    const totalNodes = incomingData.length + outgoingData.length;
    const nodeWidth = isMobile ? 120 : totalNodes > 20 ? 100 : totalNodes > 10 ? 120 : 150;
    const nodeHeight = isMobile ? 50 : totalNodes > 20 ? 40 : totalNodes > 10 ? 50 : 60;
    const spacing = isMobile ? 20 : totalNodes > 20 ? 15 : 10;
    const columns = totalNodes > 30 ? 4 : totalNodes > 10 ? 2 : 1;
    const horizontalOffset = isMobile ? 0 : totalNodes > 20 ? 6 * spacing : 2 * spacing;

    const rootX = 2000 / 2 - nodeWidth / 2; // Căn giữa trong canvas 2000px
    let rootY = 1000 / 2 - nodeHeight / 2; // Căn giữa trong canvas 1000px

    if (isMobile) {
      // Mobile: incoming trên, root giữa, outgoing dưới
      const incomingHeight = Math.ceil(incomingData.length / columns) * (nodeHeight + spacing);
      const outgoingHeight = Math.ceil(outgoingData.length / columns) * (nodeHeight + spacing);
      rootY = 100 + incomingHeight + nodeHeight + 2 * spacing;

      const incomingNodes = incomingData.map((node, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const gridWidth = columns * (nodeWidth + spacing) - spacing;
        const startX = 2000 / 2 - gridWidth / 2; // Căn giữa trong canvas 2000px
        return {
          ...node,
          x: startX + col * (nodeWidth + spacing),
          y: 100 + row * (nodeHeight + spacing),
        };
      });

      const outgoingNodes = outgoingData.map((node, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const gridWidth = columns * (nodeWidth + spacing) - spacing;
        const startX = 2000 / 2 - gridWidth / 2;
        return {
          ...node,
          x: startX + col * (nodeWidth + spacing),
          y: rootY + nodeHeight + 2 * spacing + row * (nodeHeight + spacing),
        };
      });

      return { rootX, rootY, incomingNodes, outgoingNodes, nodeWidth, nodeHeight };
    } else {
      // Desktop: incoming trái, root giữa, outgoing phải
      const incomingWidth = columns * (nodeWidth + spacing) - spacing;
      const outgoingWidth = columns * (nodeWidth + spacing) - spacing;

      const incomingNodes = incomingData.map((node, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const startX = rootX - incomingWidth - 18 * spacing;
        return {
          ...node,
          x: startX + col * (nodeWidth + spacing),
          y: rootY - (Math.ceil(incomingData.length / columns) * (nodeHeight + spacing)) / 2 + row * (nodeHeight + spacing),
        };
      });

      const outgoingNodes = outgoingData.map((node, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const startX = rootX + nodeWidth + 25 * spacing;
        return {
          ...node,
          x: startX + col * (nodeWidth + spacing),
          y: rootY - (Math.ceil(outgoingData.length / columns) * (nodeHeight + spacing)) / 2 + row * (nodeHeight + spacing),
        };
      });

      return { rootX, rootY, incomingNodes, outgoingNodes, nodeWidth, nodeHeight };
    }
  };

  const { rootX, rootY, incomingNodes, outgoingNodes, nodeWidth, nodeHeight } = calculateNodePositions();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="font-jetbrains w-full h-[calc(100vh)] bg-tech p-4 rounded-xl shadow-lg relative overflow-hidden"
    >
      {/* Header: Wallet Flow và input tìm kiếm */}
      <div className="flex items-center justify-between gap-2 mb-4 mt-4">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-bold text-white uppercase">Wallet Flow</h2>
        </div>
        <div className="relative flex items-center">
          <input
            type="text"
            placeholder="0x..."
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            className="bg-gray-800/50 text-white px-2 py-1 rounded-lg text-xs w-56 border border-white/10 backdrop-blur-md focus:outline-none pr-8"
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

      {/* Nút Zoom và Reset */}
      <div className="flex gap-2 mb-2 justify-center">
        <button
          onClick={() => {
            setOffset({ x: 0, y: 0 });
            setZoom(1);
          }}
          className="px-2 py-1 bg-gray-800/50 text-white rounded text-xs border border-white/10"
        >
          Reset View
        </button>
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
        <p className="text-xs text-gray-400 text-center flex-1">Không có giao dịch để hiển thị.</p>
      )}

      {walletInfo.address && (
        <div
          className="relative w-[2000px] min-h-[1000px] overflow-x-auto overflow-y-auto hide-scrollbar"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transformOrigin: 'center' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          {/* SVG cho đường nối */}
          <svg ref={svgRef} className="absolute inset-0 w-[2000px] h-[1000px] pointer-events-none">
            {incomingNodes.map((node, index) => (
              <path
                key={`line-in-${index}`}
                d={`M${node.x + nodeWidth} ${node.y + nodeHeight / 2} C${node.x + nodeWidth + 50} ${node.y + nodeHeight / 2
                  }, ${rootX - 50} ${rootY + nodeHeight / 2}, ${rootX} ${rootY + nodeHeight / 2}`}
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
                d={`M${rootX + nodeWidth + 60} ${rootY + nodeHeight / 2} C${rootX + nodeWidth + 80} ${rootY + nodeHeight / 2
                  }, ${node.x - 50} ${node.y + nodeHeight / 2}, ${node.x} ${node.y + nodeHeight / 2}`}
                stroke="#FF4500"
                strokeWidth="2"
                fill="none"
                strokeDasharray="5,5"
                className="transition-all duration-300 hover:stroke-opacity-80"
              />
            ))}
          </svg>

          {/* Ví gốc */}
          <div
            className="absolute z-10"
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

          {/* Các ô incoming */}
          {incomingNodes.map((node, index) => (
            <div
              key={`in-${index}`}
              className="absolute"
              style={{ left: `${node.x}px`, top: `${node.y}px` }}
            >
              <WalletNode
                address={node.address}
                nametag={node.nametag}
                image={node.image}
                txHash={node.txHash}
                type={node.type}
                onSelect={handleSelectWallet}
              />
            </div>
          ))}

          {/* Các ô outgoing */}
          {outgoingNodes.map((node, index) => (
            <div
              key={`out-${index}`}
              className="absolute"
              style={{ left: `${node.x}px`, top: `${node.y}px` }}
            >
              <WalletNode
                address={node.address}
                nametag={node.nametag}
                image={node.image}
                txHash={node.txHash}
                type={node.type}
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
      `}</style>
    </motion.div>
  );
};