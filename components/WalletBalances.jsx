// components/WalletBalances.jsx
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { formatDistanceToNow } from 'date-fns';
import { CHAIN_ID_TO_NAME } from '../utils/constants';
import { getExplorerUrls, truncateAddress, isValidToken, LoadingOverlay } from '../utils/helpers';
import '../styles/MarketTab.css';
import { toast } from 'react-toastify';
import { logger } from '../utils/clientLogger';

// Hardcoded fallback logos for common chains
const FALLBACK_CHAIN_LOGOS = {
  ethereum: '/logos/ethereum.webp',
  base: '/logos/base.webp',
  bitcoin: '/logos/bitcoin.webp',
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
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

  const validTransactions = transactions?.filter((tx) =>
    isValidToken({ image: tx.token_metadata?.logo, symbol: tx.token })
  ) || [];

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
              {walletImage && (
                <img
                  src={walletImage}
                  alt={`${displayWalletAddress} logo`}
                  className="w-6 h-6 rounded-xl"
                  onError={(e) => {
                    logger.error('Wallet name tag image failed to load:', {
                      address: walletAddress,
                      src: walletImage,
                    });
                    e.target.src = '/icons/default.webp';
                  }}
                />
              )}
              <span className="text-sm font-bold text-white tracking-tight">{displayWalletAddress}</span>
              <motion.button
                onClick={() => {
                  navigator.clipboard.writeText(walletAddress);
                  toast.success('Address copied!', { autoClose: 2000 });
                }}
                className="ml-2 p-1 bg-white/10 rounded-xl hover:bg-red-400/20 transition-all duration-300 flex-shrink-0 opacity-0 group-hover:opacity-100"
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
            <motion.button
              onClick={onClose}
              className="text-white text-lg font-bold rounded-full w-8 h-8 flex items-center justify-center bg-white/10 border border-white/10 backdrop-blur-md hover:bg-red-400/20 transition-all duration-300"
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

        <div className="relative flex-1 overflow-y-auto custom-scrollbar">
          <div className="min-h-[calc(100vh-12rem)] p-4 relative">
            {activeTab === 'portfolio' && (
              <div className="relative">
                <LoadingOverlay isLoading={isLoading} isMobile={isMobile} />
                {error ? (
                  <p className="text-[8px] sm:text-[10px] text-red-400 text-center bg-red-400/10 p-3 rounded min-h-[calc(100vh-12rem)] flex items-center justify-center">
                    Error: {error} {isLoading && '(Retrying...)'}
                  </p>
                ) : sortedBalances.length > 0 ? (
                  <div className="relative overflow-x-auto custom-scrollbar">
                    <table className="w-full text-[8px] sm:text-[10px]">
                      <thead className="sticky top-0 z-10 border-b border-white/10 bg-black/10">
                        <tr>
                          <th className="px-2 py-1 text-white text-left font-semibold w-[30%]">Token</th>
                          <th className="px-2 py-1 text-white text-left font-semibold w-[35%]">Amount</th>
                          <th className="px-2 py-1 text-white text-left font-semibold w-[35%]">Value (USD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedBalances.map((balance, index) => (
                          <motion.tr
                            key={`${balance.chain}-${balance.address}-${index}`}
                            className="border-t border-white/10 hover:bg-neon-blue/10 transition-all duration-300"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, delay: index * 0.02 }}
                          >
                            <td className="px-2 py-2 text-white">
                              <div className="flex items-center gap-2">
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
                                  <span className="text-[8px] sm:text-[10px] font-medium">{balance.symbol || 'Unknown'}</span>
                                  {balance.price_usd != null && (
                                    <span className="text-[7px] sm:text-[9px] text-white/60">
                                      ${formatNumber(balance.price_usd)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-2 text-white font-semibold">
                              {balance.amount != null ? formatNumber(balance.amount) : 'N/A'}
                            </td>
                            <td className="px-2 py-2 text-white font-semibold">
                              {balance.value_usd != null ? `$${formatNumber(balance.value_usd)}` : 'N/A'}
                            </td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
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
                  <p className="text-[8px] sm:text-[10px] text-red-400 text-center bg-red-400/10 p-3 rounded min-h-[calc(100vh-12rem)] flex items-center justify-center">
                    Error: {transactionsError}
                  </p>
                ) : validTransactions.length > 0 ? (
                  <div className="relative overflow-x-auto custom-scrollbar">
                    <table className="w-full text-[8px] sm:text-[10px]">
                      <thead className="sticky top-0 z-10 border-b border-white/10 bg-black/10">
                        <tr>
                          <th className="px-2 py-1 text-white text-left font-semibold w-[25%]">Token</th>
                          <th className="px-2 py-1 text-white text-left font-semibold w-[25%]">Address</th>
                          <th className="px-2 py-1 text-white text-left font-semibold w-[25%]">Value</th>
                          <th className="px-2 py-1 text-white text-left font-semibold w-[25%]">Tx/Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validTransactions.map((tx, index) => {
                          const chainName = CHAIN_ID_TO_NAME[tx.chain] || tx.chain || 'ethereum';
                          const { txUrl, addressUrl } = getExplorerUrls(chainName, tx.hash, tx.type === 'receive' ? tx.from : tx.to);
                          const { text: displayAddress, image: addressImage } = truncateAddress(
                            tx.type === 'receive' ? tx.from : tx.to,
                            nameTags
                          );
                          const isValidAddress = (tx.type === 'receive' ? tx.from : tx.to)?.match(/^(0x[a-fA-F0-9]{40}|(1|3|bc1)[a-zA-Z0-9]+)$/);
                          const isValidTxHash = tx.hash?.match(/^(0x)?[a-fA-F0-9]+$/);

                          return (
                            <motion.tr
                              key={`${tx.chain}-${tx.hash}-${index}`}
                              className="border-t border-white/10 hover:bg-neon-blue/10 transition-all duration-300"
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3, delay: index * 0.02 }}
                            >
                              <td className="px-2 py-2 text-white">
                                <div className="flex items-center gap-2">
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
                                  <span className="text-[8px] sm:text-[10px] font-medium">{tx.token || 'Unknown'}</span>
                                </div>
                              </td>
                              <td className="px-2 py-2 text-white">
                                <div className="flex flex-col items-center gap-1 group relative">
                                  <span
                                    className={`inline-flex px-2 py-0.5 rounded-lg text-[7px] sm:text-[9px] font-medium ${tx.type === 'receive' ? 'bg-emerald-400/20 text-emerald-400' : 'bg-red-400/20 text-red-400'}`}
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
                                      className="text-[8px] sm:text-[10px] text-neon-blue hover:text-neon-blue/80 transition-colors font-medium"
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
                                        className="absolute right-0 p-1 bg-white/10 rounded-xl hover:bg-red-400/20 transition-all duration-300 flex-shrink-0 opacity-0 group-hover:opacity-100"
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
                              </td>
                              <td className="px-2 py-2 text-white font-semibold">
                                {tx.value_usd != null ? `$${formatNumber(tx.value_usd)}` : 'N/A'}
                              </td>
                              <td className="px-2 py-2 text-white">
                                <div className="flex flex-col items-center gap-1 group relative">
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
                                      className="absolute right-0 p-1 bg-white/10 rounded-xl hover:bg-red-400/20 transition-all duration-300 flex-shrink-0 opacity-0 group-hover:opacity-100"
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
                              </td>
                            </motion.tr>
                          );
                        })}
                      </tbody>
                    </table>
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
        table {
          table-layout: auto;
          width: 100%;
        }
        th,
        td {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        @media (max-width: 640px) {
          table {
            font-size: 8px;
          }
          th,
          td {
            padding: 0.4rem;
          }
        }
      `}</style>
    </motion.div>
  );

  return createPortal(overlayContent, document.body);
};

export default React.memo(WalletBalances);