import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { formatDistanceToNow } from 'date-fns';
import { CHAIN_ID_TO_NAME } from '../utils/constants';
import { getExplorerUrls, truncateAddress, isValidToken, LoadingOverlay } from '../utils/helpers';
import '../styles/MarketTab.css';
import { toast } from 'react-toastify';
import { logger } from '../utils/clientLogger';
import { Virtuoso } from 'react-virtuoso';

// Hardcoded fallback logos for common chains
const FALLBACK_CHAIN_LOGOS = {
  ethereum: '/logos/ethereum.webp',
  base: '/logos/base.webp',
  bitcoin: '/logos/bitcoin.webp',
  bsc: '/logos/bnb-logo.webp',
  // Add other chains as needed
};

const WalletBalances = ({
  balances,
  walletAddress,
  isLoading,
  error,
  onClose,
  transactions,
  isLoadingTransactions,
  transactionsError,
  fetchTransactions,
  chains,
  setSelectedWallet,
  setWalletBalances,
  setTransactions,
  setWalletBalancesError,
  setTransactionsError,
  setWalletAddress,
  nameTags,
  isMobile,
  fetchOnChainData,
  setIsLoadingWalletBalances,
  chainLogos,
}) => {
  const walletBalancesRef = useRef(null);
  const [activeTab, setActiveTab] = useState('portfolio');

  // Log sorted balances to verify USDT position
  useEffect(() => {
    if (!walletAddress || !balances) return;
    const validBalances = balances.filter((balance) =>
      isValidToken({ image: balance.logo, symbol: balance.symbol })
    );
    const sortedBalances = [...validBalances].sort((a, b) => {
      const valueA = Number(a.value_usd) || 0;
      const valueB = Number(b.value_usd) || 0;
      return valueB - valueA;
    });
    logger.log('Sorted wallet balances:', {
      walletAddress,
      topBalances: sortedBalances.slice(0, 5).map((b) => ({
        symbol: b.symbol,
        value_usd: b.value_usd,
        chain: b.chain,
        address: b.address,
      })),
      usdtIncluded: sortedBalances.some(
        (b) =>
          b.symbol === 'USDT' &&
          b.address.toLowerCase() === '0xdac17f958d2ee523a2206206994597c13d831ec7' &&
          b.chain === 'ethereum'
      ),
      totalBalances: sortedBalances.length,
    });
  }, [walletAddress, balances]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (walletBalancesRef.current && !walletBalancesRef.current.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.addEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    if (!walletAddress) return;

    const fetchData = async () => {
      if (
        activeTab === 'portfolio' &&
        walletAddress &&
        !balances?.length &&
        !isLoading &&
        !error &&
        fetchOnChainData
      ) {
        logger.log('Fetching wallet balances for:', { walletAddress });
        try {
          setIsLoadingWalletBalances(true);
          setWalletBalancesError(null);
          await fetchOnChainData(null, null, 'wallet-balances', null, walletAddress);
        } catch (err) {
          const errorMessage = err.message || 'Failed to fetch wallet balances';
          logger.error('Failed to fetch wallet balances:', { walletAddress, error: errorMessage });
          setWalletBalancesError(errorMessage);
        } finally {
          setIsLoadingWalletBalances(false);
        }
      }

      if (
        activeTab === 'activity' &&
        walletAddress &&
        !transactions &&
        !isLoadingTransactions &&
        !transactionsError
      ) {
        logger.log('Fetching transactions for wallet:', { walletAddress });
        fetchTransactions(walletAddress).catch((err) => {
          const errorMessage = err.message || 'Failed to fetch transactions';
          logger.error('Failed to fetch transactions:', { walletAddress, error: errorMessage });
          setTransactionsError(errorMessage);
        });
      }
    };

    fetchData();

    return () => {
      if (fetchTransactions.cancel) {
        logger.log('Canceling fetchTransactions');
        fetchTransactions.cancel();
      }
    };
  }, [
    activeTab,
    walletAddress,
    balances,
    transactions,
    isLoading,
    error,
    isLoadingTransactions,
    transactionsError,
    fetchTransactions,
    fetchOnChainData,
    setWalletBalancesError,
    setIsLoadingWalletBalances,
    setTransactionsError,
  ]);

  if (!walletAddress) return null;

  const getPlatformImage = (chainValue) => {
    const normalizedChainValue = typeof chainValue === 'string' ? chainValue : 'ethereum';
    const normalizedChain = normalizedChainValue.toLowerCase();
    const chainName = CHAIN_ID_TO_NAME[normalizedChain] || normalizedChain;

    logger.log('getPlatformImage input:', {
      chainValue,
      type: typeof chainValue,
      normalizedChain,
      chainName,
    });

    const imageFromChainLogos = chainLogos?.[normalizedChain];
    if (imageFromChainLogos && imageFromChainLogos !== '/fallback-image.webp') {
      logger.log('getPlatformImage: Found in chainLogos', {
        chainValue,
        chainName,
        imageUrl: imageFromChainLogos,
      });
      return imageFromChainLogos;
    }

    const chain = chains?.find((c) => c.value.toLowerCase() === normalizedChain);
    const imageFromChains = chain?.image;
    if (imageFromChains && imageFromChains !== '/fallback-image.webp') {
      logger.log('getPlatformImage: Found in chains', {
        chainValue,
        chainName,
        imageUrl: imageFromChains,
      });
      return imageFromChains;
    }

    const fallbackImage = FALLBACK_CHAIN_LOGOS[normalizedChain] || '/fallback-image.webp';
    logger.log('getPlatformImage: Using fallback', {
      chainValue,
      chainName,
      imageUrl: fallbackImage,
    });
    return fallbackImage;
  };

  const getChainLabel = (chainValue) => {
    const normalizedChainValue = typeof chainValue === 'string' ? chainValue : 'ethereum';
    const normalizedChain = normalizedChainValue.toLowerCase();
    const chainName = CHAIN_ID_TO_NAME[normalizedChain] || normalizedChain;
    return chains?.find((c) => c.value.toLowerCase() === normalizedChain)?.label || chainName;
  };

  const handleAddressClick = (address) => {
    setSelectedWallet(address);
  };

  const { text: displayWalletAddress, image: walletImage } = truncateAddress(walletAddress, nameTags);

  const formatNumber = (value) => {
    if (value == null || isNaN(value)) return 'N/A';
    return Math.floor(Number(value)).toLocaleString('en-US');
  };

  const validBalances = balances?.filter((balance) =>
    isValidToken({ image: balance.logo, symbol: balance.symbol })
  ) || [];

  const sortedBalances = [...validBalances].sort((a, b) => {
    const valueA = Number(a.value_usd) || 0;
    const valueB = Number(b.value_usd) || 0;
    return valueB - valueA;
  });

  const totalValue = sortedBalances.reduce((sum, balance) => sum + (Number(balance.value_usd) || 0), 0);

  const validTransactions = transactions?.filter((tx) =>
    isValidToken({ image: tx.token_metadata?.logo, symbol: tx.token })
  ) || [];

  const renderPortfolioRow = (index, balance) => {
    const value = Number(balance.value_usd) || 0;
    const percentage = totalValue > 0 ? (value / totalValue) * 100 : 0;
    return (
      <motion.div
        key={`${balance.chain}-${balance.address}-${index}`}
        className="flex border-t border-white/10 hover:bg-neon-blue/10 transition-all duration-300 py-2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: index * 0.02 }}
      >
        <div className="w-[30%] px-2 text-white text-[8px] sm:text-[10px] flex items-center gap-2 truncate">
          {balance.logo && (
            <div className="relative inline-block">
              <img
                src={balance.logo}
                alt={`${balance.symbol} logo`}
                className="w-4 h-4 rounded-full"
                onError={(e) => {
                  logger.error('Token logo failed to load:', {
                    symbol: balance.symbol,
                    src: balance.logo,
                  });
                  e.target.src = '/fallback-image.webp';
                }}
              />
              <img
                src={getPlatformImage(balance.chain)}
                alt={`${getChainLabel(balance.chain)} logo`}
                className="w-3 h-3 rounded-full absolute -right-1 -bottom-1"
                onError={(e) => {
                  logger.error('Platform logo failed to load:', {
                    chain: balance.chain,
                    chainName: getChainLabel(balance.chain),
                    src: getPlatformImage(balance.chain),
                  });
                  e.target.src = '/fallback-image.webp';
                }}
              />
            </div>
          )}
          <div className="flex flex-col">
            <span className="font-medium">{balance.symbol || 'Unknown'}</span>
            {balance.price_usd != null && (
              <span className="text-[7px] sm:text-[9px] text-white/60">
                ${formatNumber(balance.price_usd)}
              </span>
            )}
          </div>
        </div>
        <div className="w-[25%] px-2 text-white text-[8px] sm:text-[10px] font-semibold flex items-center justify-center">
          {balance.amount != null ? formatNumber(balance.amount) : 'N/A'}
        </div>
        <div className="w-[25%] px-2 text-white text-[8px] sm:text-[10px] font-semibold flex items-center justify-center">
          {balance.value_usd != null ? `$${formatNumber(balance.value_usd)}` : 'N/A'}
        </div>
        <div className="w-[20%] px-2 text-white text-[8px] sm:text-[10px] flex flex-col items-center justify-center gap-1">
          <span className="font-semibold">{percentage.toFixed(2)}%</span>
          <div className="w-full bg-white/10 rounded-full h-1.5">
            <motion.div
              className="bg-gradient-to-r from-neon-blue to-emerald-400 h-1.5 rounded-full"
              style={{ width: `${percentage}%` }}
              initial={{ width: 0 }}
              animate={{ width: `${percentage}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>
      </motion.div>
    );
  };

  const renderTransactionRow = (index, tx) => {
    const chainName = CHAIN_ID_TO_NAME[tx.chain] || tx.chain || 'ethereum';
    const { txUrl, addressUrl } = getExplorerUrls(chainName, tx.hash, tx.type === 'receive' ? tx.from : tx.to);
    const { text: displayAddress, image: addressImage } = truncateAddress(
      tx.type === 'receive' ? tx.from : tx.to,
      nameTags
    );
    const isValidAddress = (tx.type === 'receive' ? tx.from : tx.to)?.match(/^(0x[a-fA-F0-9]{40}|(1|3|bc1)[a-zA-Z0-9]+)$/);
    const isValidTxHash = tx.hash?.match(/^(0x)?[a-fA-F0-9]+$/);

    return (
      <motion.div
        key={`${tx.chain}-${tx.hash}-${index}`}
        className="flex border-t border-white/10 hover:bg-neon-blue/10 transition-all duration-300 py-2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: index * 0.02 }}
      >
        <div className="w-[25%] px-2 text-white text-[8px] sm:text-[10px] flex items-center gap-2 truncate">
          {tx.token_metadata?.logo && (
            <div className="relative inline-block">
              <img
                src={tx.token_metadata.logo}
                alt={`${tx.token} logo`}
                className="w-4 h-4 rounded-full"
                onError={(e) => {
                  logger.error('Token logo failed to load:', {
                    symbol: tx.token,
                    src: tx.token_metadata.logo,
                  });
                  e.target.src = '/fallback-image.webp';
                }}
              />
              <img
                src={getPlatformImage(tx.chain)}
                alt={`${chainName} logo`}
                className="w-3 h-3 rounded-full absolute -right-1 -bottom-1"
                onError={(e) => {
                  logger.error('Transaction chain logo failed to load:', {
                    chain: tx.chain,
                    chainName,
                    src: getPlatformImage(tx.chain),
                  });
                  e.target.src = '/fallback-image.webp';
                }}
              />
            </div>
          )}
          <span className="font-medium">{tx.token || 'Unknown'}</span>
        </div>
        <div className="w-[25%] px-2 text-white text-[8px] sm:text-[10px] flex flex-col items-center gap-1 group relative">
          <span
            className={`inline-flex px-2 py-0.5 rounded-lg text-[7px] sm:text-[9px] font-medium ${tx.type === 'receive' ? 'bg-emerald-400/20 text-emerald-400' : 'bg-red-500/20 text-red-500'}`}
          >
            {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
          </span>
          <div className="flex items-center gap-2">
            {addressImage && (
              <img
                src={addressImage}
                alt={`${displayAddress} logo`}
                className="w-4 h-4 rounded-full"
                onError={(e) => {
                  logger.error('Address name tag image failed to load:', {
                    address: tx.type === 'receive' ? tx.from : tx.to,
                    src: addressImage,
                  });
                  e.target.src = '/icons/default.webp';
                }}
              />
            )}
            <a
              href={addressUrl}
              target="_blank"
              rel="noreferrer"
              className="text-neon-blue hover:text-neon-blue/80 transition-colors font-medium text-[8px] sm:text-[10px]"
              title={tx.type === 'receive' ? tx.from : tx.to}
              onClick={() => handleAddressClick(tx.type === 'receive' ? tx.from : tx.to)}
            >
              {displayAddress}
            </a>
            {isValidAddress && (
              <motion.button
                onClick={() => {
                  navigator.clipboard.writeText(tx.type === 'receive' ? tx.from : tx.to);
                  toast.success('Address copied!', { autoClose: 2000 });
                }}
                className="absolute right-0 p-1 bg-white/10 rounded-xl hover:bg-red-500/20 transition-all duration-300 flex-shrink-0 opacity-0 group-hover:opacity-100"
                title="Copy address"
                whileHover={{ scale: 1.1, y: -2 }}
                whileTap={{ scale: 0.9 }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="#F87171"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </motion.button>
            )}
          </div>
        </div>
        <div className="w-[25%] px-2 text-white text-[8px] sm:text-[10px] font-semibold flex items-center justify-center">
          {tx.value_usd != null ? `$${formatNumber(tx.value_usd)}` : 'N/A'}
        </div>
        <div className="w-[25%] px-2 text-white text-[8px] sm:text-[10px] flex flex-col items-center gap-1 group relative">
          <a
            href={txUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-shrink-0 p-1 rounded-lg hover:bg-neon-blue/20 transition-all duration-300"
            title={tx.hash}
          >
            <img
              src="/logos/etherscan-logo.webp"
              alt="Etherscan"
              className="w-4 h-4 object-contain"
              onError={(e) => (e.target.src = '/fallback-image.webp')}
            />
          </a>
          <span className="text-[7px] sm:text-[9px] text-white/60">
            {tx.block_time ? formatDistanceToNow(new Date(tx.block_time), { addSuffix: true }) : 'N/A'}
          </span>
          {isValidTxHash && (
            <motion.button
              onClick={() => {
                navigator.clipboard.writeText(tx.hash);
                toast.success('Transaction hash copied!', { autoClose: 2000 });
              }}
              className="absolute right-0 p-1 bg-white/10 rounded-xl hover:bg-red-500/20 transition-all duration-300 flex-shrink-0 opacity-0 group-hover:opacity-100"
              title="Copy transaction hash"
              whileHover={{ scale: 1.1, y: -2 }}
              whileTap={{ scale: 0.9 }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="#F87171"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </motion.button>
          )}
        </div>
      </motion.div>
    );
  };

  const overlayContent = (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.4, ease: 'easeInOut' }}
      className="fixed inset-0 flex items-center justify-center z-50 font-saira bg-black/10 backdrop-blur-sm"
    >
      <div
        ref={walletBalancesRef}
        className="p-2 sm:p-4 max-w-6xl w-[95%] bg-black/80 backdrop-blur-sm border border-white/10 rounded-3xl relative max-h-[calc(100vh-8rem)] flex flex-col"
      >
        <div className="sticky top-0 z-20 p-3 bg-black/80 backdrop-blur-sm border-b border-white/10">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2 group relative">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-white/60"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                  />
                </svg>
                <img
                  src={nameTags[walletAddress.toLowerCase()]?.image || '/fallback-image.webp'}
                  alt={`${displayWalletAddress} logo`}
                  className="w-6 h-6 rounded-xl"
                  onError={(e) => {
                    logger.error('Wallet name tag image failed to load:', {
                      address: walletAddress,
                      src: nameTags[walletAddress.toLowerCase()]?.image,
                    });
                    e.target.src = '/fallback-image.webp';
                  }}
                />
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-white tracking-tight">{nameTags[walletAddress.toLowerCase()]?.name || displayWalletAddress}</span>
                  <div className="relative flex items-center group">
                    <span className="text-[9px] sm:text-[10px] text-white/60">{displayWalletAddress}</span>
                    <motion.button
                      onClick={() => {
                        navigator.clipboard.writeText(walletAddress);
                        toast.success('Address copied!', { autoClose: 2000 });
                      }}
                      className="ml-2 p-1 bg-white/10 rounded-xl hover:bg-red-500/20 transition-all duration-300 flex-shrink-0 opacity-0 group-hover:opacity-100"
                      title="Copy address"
                      whileHover={{ scale: 1.1, y: -2 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="#F87171"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    </motion.button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 p-1 sm:p-2 mr-2 bg-gradient-to-r from-black/70 to-black/50 rounded-xl border border-white/10 shadow-md shadow-neon-blue/10">
                <div className="flex items-center gap-1 flex-wrap min-w-0">
                  <span className="flex items-center font-bold text-white text-[11px] sm:text-xs whitespace-nowrap">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4 text-emerald-400 flex-shrink-0 m-1"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    Total Value:
                  </span>
                  <span className="font-bold ml-1 bg-gradient-to-r from-neon-blue to-emerald-400 bg-clip-text text-transparent text-xs sm:text-sm truncate">
                    ${formatNumber(totalValue)}
                  </span>
                </div>
              </div>
            </div>
            <motion.button
              onClick={onClose}
              className="text-white text-lg font-bold rounded-full w-8 h-8 flex items-center justify-center bg-white/10 border border-white/10 backdrop-blur-md hover:bg-red-500/20 transition-all duration-300"
              aria-label="Close balances"
              whileHover={{ scale: 1.1, y: -2 }}
              whileTap={{ scale: 0.9 }}
            >
              ✕
            </motion.button>
          </div>
          <div className="flex space-x-2 mb-2">
            <motion.button
              onClick={() => setActiveTab('portfolio')}
              className={`flex-1 px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider text-white bg-white/5 border border-white/10 backdrop-blur-md hover:bg-neon-blue/20 transition-all duration-300 ${activeTab === 'portfolio' ? 'bg-neon-blue/20 border-neon-blue shadow-neon-sm' : ''}`}
              whileHover={{ scale: activeTab !== 'portfolio' ? 1.05 : 1 }}
              whileTap={{ scale: activeTab !== 'portfolio' ? 0.95 : 1 }}
            >
              Portfolio
            </motion.button>
            <motion.button
              onClick={() => setActiveTab('activity')}
              className={`flex-1 px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider text-white bg-white/5 border border-white/10 backdrop-blur-md hover:bg-neon-blue/20 transition-all duration-300 ${activeTab === 'activity' ? 'bg-neon-blue/20 border-neon-blue shadow-neon-sm' : ''}`}
              whileHover={{ scale: activeTab !== 'activity' ? 1.05 : 1 }}
              whileTap={{ scale: activeTab !== 'activity' ? 0.95 : 1 }}
            >
              Activity
            </motion.button>
          </div>
        </div>

        <div className="relative flex-1">
          <div className="p-4">
            {activeTab === 'portfolio' && (
              <div className="relative">
                <LoadingOverlay isLoading={isLoading} isMobile={isMobile} />
                {error ? (
                  <p className="text-[8px] sm:text-[10px] text-red-500 text-center bg-red-500/10 p-3 rounded min-h-[calc(100vh-12rem)] flex items-center justify-center">
                    Error: {error} {isLoading && '(Retrying...)'}
                  </p>
                ) : sortedBalances.length > 0 ? (
                  <div className="space-y-2">
                    <div className="bg-black/80 rounded-xl border border-white/10 overflow-hidden">
                      <div className="flex bg-black/10 border-b border-white/10 px-2 py-2 text-[8px] sm:text-[10px] font-semibold text-white">
                        <div className="w-[30%] px-2 text-left">Token</div>
                        <div className="w-[25%] px-2 text-center">Amount</div>
                        <div className="w-[25%] px-2 text-center">Value (USD)</div>
                        <div className="w-[20%] px-2 text-center">Percentage</div>
                      </div>
                      <div className="max-h-[calc(100vh-16rem)] overflow-y-auto custom-scrollbar">
                        <Virtuoso
                          className="custom-scrollbar"
                          style={{ height: 'auto', minHeight: '350px' }}
                          data={sortedBalances}
                          itemContent={renderPortfolioRow}
                          overscan={400}
                          components={{
                            EmptyPlaceholder: () => null,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-[8px] sm:text-[10px] text-white/60 text-center p-2 min-h-[calc(100vh-12rem)] flex items-center justify-center">
                    {isLoading ? 'Loading balances...' : 'No valid balances found for this wallet.'}
                  </p>
                )}
              </div>
            )}
            {activeTab === 'activity' && (
              <div className="relative">
                <LoadingOverlay isLoading={isLoadingTransactions} isMobile={isMobile} />
                {transactionsError ? (
                  <p className="text-[8px] sm:text-[10px] text-red-500 text-center bg-red-500/10 p-3 rounded min-h-[calc(100vh-12rem)] flex items-center justify-center">
                    Error: {transactionsError}
                  </p>
                ) : validTransactions.length > 0 ? (
                  <div className="bg-black/80 rounded-xl border border-white/10 overflow-hidden">
                    <div className="flex bg-black/10 border-b border-white/10 px-2 py-2 text-[8px] sm:text-[10px] font-semibold text-white sticky top-0 z-10">
                      <div className="w-[25%] px-2 text-left">Token</div>
                      <div className="w-[25%] px-2 text-center">Address</div>
                      <div className="w-[25%] px-2 text-center">Value</div>
                      <div className="w-[25%] px-2 text-center">Tx/Time</div>
                    </div>
                    <div className="max-h-[calc(100vh-12rem)] overflow-y-auto custom-scrollbar">
                      <Virtuoso
                        className="custom-scrollbar"
                        style={{ height: 'auto', minHeight: '350px' }}
                        data={validTransactions}
                        itemContent={renderTransactionRow}
                        overscan={400}
                        components={{
                          EmptyPlaceholder: () => null,
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-[8px] sm:text-[10px] text-white/60 text-center p-2 min-h-[calc(100vh-12rem)] flex items-center justify-center">
                    No valid transactions found for this wallet.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <style jsx>{`
          .shadow-neon-sm {
            box-shadow: 0 0 8px rgba(0, 191, 255, 0.3), 0 0 16px rgba(0, 191, 255, 0.15);
          }
          .custom-scrollbar::-webkit-scrollbar {
            width: 4px;
            height: 4px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 2px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.4);
          }
          .custom-scrollbar {
            -ms-overflow-style: auto;
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
          }
          .hide-scrollbar::-webkit-scrollbar {
            display: none;
          }
          .hide-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
          @media (max-width: 640px) {
            .custom-scrollbar {
              font-size: 8px;
            }
          }
        `}</style>
      </div>
    </motion.div>
  );

  return createPortal(overlayContent, document.body);
};

export default React.memo(WalletBalances);