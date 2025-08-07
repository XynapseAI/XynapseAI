import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { formatDistanceToNow } from 'date-fns';
import { CHAIN_ID_TO_NAME } from '../utils/constants';
import { getExplorerUrls, truncateAddress, isValidToken } from '../utils/helpers';
import '../styles/MarketTab.css';

const logger = {
  log: (message, data) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(message, data);
    }
  },
  error: (message, data) => {
    console.error(message, data);
  },
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
}) => {
  const walletBalancesRef = useRef(null);
  const [activeTab, setActiveTab] = useState('portfolio');

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
    if (
      activeTab === 'activity' &&
      walletAddress &&
      !transactions &&
      !isLoadingTransactions &&
      !transactionsError
    ) {
      logger.log('Fetching transactions for wallet:', { walletAddress });
      fetchTransactions(walletAddress);
    }
    return () => {
      fetchTransactions.cancel && fetchTransactions.cancel();
    };
  }, [activeTab, transactions, isLoadingTransactions, transactionsError, fetchTransactions, walletAddress]);

  if (!walletAddress) return null;

  const getPlatformImage = (chainValue) => {
    const chainName = CHAIN_ID_TO_NAME[chainValue] || chainValue || 'ethereum';
    const chain = chains.find((c) => c.value === chainName);
    const imageUrl = chain?.image || '/fallback-image.png';
    logger.log('getPlatformImage:', { chainValue, chainName, imageUrl, found: !!chain });
    return imageUrl;
  };

  const getChainLabel = (chainValue) => {
    const chainName = CHAIN_ID_TO_NAME[chainValue] || chainValue || 'ethereum';
    return chains.find((c) => c.value === chainName)?.label || chainName;
  };

  const { text: displayWalletAddress, image: walletImage } = truncateAddress(walletAddress, nameTags);

  const formatNumber = (value) => {
    if (value == null || isNaN(value)) return 'N/A';
    return Math.floor(Number(value)).toLocaleString('en-US');
  };

  // Filter valid tokens for Portfolio tab
  const validBalances = balances.filter((balance) =>
    isValidToken({ image: balance.logo, symbol: balance.symbol })
  );

  // Filter valid transactions for Activity tab
  const validTransactions = transactions?.filter((tx) =>
    isValidToken({ image: tx.token_metadata?.logo, symbol: tx.token })
  ) || [];

  const overlayContent = (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.4, ease: 'easeInOut' }}
      className="fixed inset-0 flex items-center justify-center z-50 font-jetbrains bg-black/80 backdrop-blur-xs"
    >
      <div
        ref={walletBalancesRef}
        className={`p-4 sm:p-6 max-w-6xl w-[95%] rounded-xl relative max-h-[80vh] min-h-[80vh] overflow-hidden custom-scrollbar border border-white/10 bg-black/60 backdrop-blur-xl shadow-neon-lg`}
      >
        <div className="sticky top-0 z-10 p-3 bg-black/70 backdrop-blur-md">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-white"
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
                  className="w-5 h-5 rounded-full flex-shrink-0"
                  onError={(e) => {
                    logger.error('Wallet name tag image failed to load:', {
                      address: walletAddress,
                      src: walletImage,
                    });
                    e.target.src = '/icons/default.png';
                  }}
                />
              )}
              <span className="text-sm font-bold text-white tracking-tight">{displayWalletAddress}</span>
            </div>
            <motion.button
              onClick={onClose}
              className="text-white text-lg font-bold rounded-full w-10 h-10 flex items-center justify-center bg-black/60 border border-white/10 backdrop-blur-md hover:bg-neon-blue/30 transition-all duration-300"
              aria-label="Close balances"
              whileHover={{ scale: 1.1, rotate: 90 }}
              whileTap={{ scale: 0.9 }}
            >
              ✕
            </motion.button>
          </div>
          <div className="flex space-x-2 mb-3">
            <motion.button
              onClick={() => setActiveTab('portfolio')}
              className={`flex-1 px-2 py-1 sm:px-4 sm:py-1.5 rounded-xl text-[10px] sm:text-xs font-medium transition-all duration-300 border-2 border-white/10 ${activeTab === 'portfolio' ? 'bg-white text-black shadow-neon' : 'text-white hover:bg-white/20'}`}
              whileHover={{ scale: 1 }}
            >
              Portfolio
            </motion.button>
            <motion.button
              onClick={() => setActiveTab('activity')}
              className={`flex-1 px-2 py-1 sm:px-4 sm:py-1.5 rounded-xl text-[10px] sm:text-xs font-medium transition-all duration-300 border-2 border-white/10 ${activeTab === 'activity' ? 'bg-white text-black shadow-neon' : 'text-white hover:bg-white/20'}`}
              whileHover={{ scale: 1 }}
            >
              Activity
            </motion.button>
          </div>
        </div>

        <div className="overflow-y-auto max-h-[calc(80vh-100px)] rounded-lg custom-scrollbar">
          {activeTab === 'portfolio' && (
            <>
              {isLoading ? (
                <div className="space-y-3 p-4">
                  {[...Array(5)].map((_, index) => (
                    <div key={index} className="flex items-center gap-4">
                      <div className="w-8 h-8 bg-gray-700/50 rounded-full animate-pulse"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-700/50 rounded animate-pulse"></div>
                        <div className="h-4 bg-gray-700/50 rounded animate-pulse w-3/4"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : error ? (
                <p className="text-sm text-red-400 text-center bg-red-500/10 p-3 rounded">Error: {error}</p>
              ) : validBalances.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed">
                    <thead className="text-[10px] sm:text-xs sticky top-0 z-10 border-b border-white/10 bg-black/70 backdrop-blur-md uppercase">
                      <tr>
                        <th className="px-2 py-2 text-white text-center font-medium w-[30%]">
                          <div className="flex items-center justify-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 10c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z"
                              />
                            </svg>
                            Token
                          </div>
                        </th>
                        <th className="px-2 py-2 text-white text-center font-medium w-[35%]">
                          <div className="flex items-center justify-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 fill-neon-blue"
                              viewBox="0 0 24 24"
                            >
                              <path
                                d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H3V6h18v12zm-10-8h-2v2H7v2h2v2h2v-2h2v-2h-2v-2z"
                              />
                            </svg>
                            Amount
                          </div>
                        </th>
                        <th className="px-2 py-2 text-white text-center font-medium w-[35%]">
                          <div className="flex items-center justify-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M7 12l3-3 3 3 5-5m0 0h-5m5 0v5"
                              />
                            </svg>
                            Value (USD)
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {validBalances.map((balance, index) => (
                        <tr
                          key={`${balance.chain}-${balance.address}-${index}`}
                          className="border-t border-white/10 hover:bg-white/10 transition-all duration-300"
                        >
                          <td className="px-2 py-2 text-gray-200 text-[9px] sm:text-xs text-center">
                            <div className="flex items-center space-x-2 relative">
                              {balance.logo && (
                                <div className="relative inline-block">
                                  <img
                                    src={balance.logo}
                                    alt={`${balance.symbol} logo`}
                                    className="w-5 h-5 sm:w-6 sm:h-6 rounded-full flex-shrink-0"
                                    onError={(e) => {
                                      logger.error('Token logo failed to load:', {
                                        symbol: balance.symbol,
                                        src: balance.logo,
                                      });
                                      e.target.src = '/fallback-image.png';
                                    }}
                                  />
                                  <img
                                    src={getPlatformImage(balance.chain)}
                                    alt={`${balance.chain} logo`}
                                    className="w-3 h-3 sm:w-4 sm:h-4 rounded-full absolute -left-1 -top-1 sm:-left-2 sm:-top-2"
                                    onError={(e) => {
                                      logger.error('Platform logo failed to load:', {
                                        chain: balance.chain,
                                        src: getPlatformImage(balance.chain),
                                      });
                                      e.target.src = '/fallback-image.png';
                                    }}
                                  />
                                </div>
                              )}
                              <div className="flex flex-col items-start">
                                <span className="text-[9px] sm:text-[10px]">
                                  {balance.symbol || 'Unknown'} {balance.address === 'native' ? '' : ''}
                                </span>
                                {balance.price_usd != null && (
                                  <span className="text-[8px] sm:text-[10px] text-gray-400">
                                    ${formatNumber(balance.price_usd)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-gray-200 text-[9px] sm:text-xs text-center">
                            {balance.amount != null ? formatNumber(balance.amount) : 'N/A'}
                          </td>
                          <td className="px-2 py-2 text-gray-200 text-[9px] sm:text-xs text-center">
                            {balance.value_usd != null ? `$${formatNumber(balance.value_usd)}` : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center p-4">No valid balances found for this wallet.</p>
              )}
            </>
          )}

          {activeTab === 'activity' && (
            <>
              {isLoadingTransactions ? (
                <div className="space-y-3 p-4">
                  {[...Array(5)].map((_, index) => (
                    <div key={index} className="flex items-center gap-4">
                      <div className="w-8 h-8 bg-gray-700/50 rounded-full animate-pulse"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-700/50 rounded animate-pulse"></div>
                        <div className="h-4 bg-gray-700/50 rounded animate-pulse w-3/4"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : transactionsError ? (
                <p className="text-xs text-red-400 text-center bg-red-500/10 p-3 rounded">Error: {transactionsError}</p>
              ) : validTransactions.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed">
                    <thead className="text-[10px] sm:text-xs sticky top-0 z-10 border-b border-white/10 bg-black/70 backdrop-blur-md uppercase">
                      <tr>
                        <th className="px-2 py-2 text-white text-center font-medium w-[25%]">
                          <div className="flex items-center justify-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 10c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z"
                              />
                            </svg>
                            Token
                          </div>
                        </th>
                        <th className="px-2 py-2 text-white text-center font-medium w-[25%]">
                          <div className="flex items-center justify-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                              />
                            </svg>
                            Address
                          </div>
                        </th>
                        <th className="px-2 py-2 text-white text-center font-medium w-[25%]">
                          <div className="flex items-center justify-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 fill-neon-blue"
                              viewBox="0 0 24 24"
                            >
                              <path
                                d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H3V6h18v12zm-10-8h-2v2H7v2h2v2h2v-2h2v-2h-2v-2z"
                              />
                            </svg>
                            Value
                          </div>
                        </th>
                        <th className="px-2 py-2 text-white text-center font-medium w-[25%]">
                          <div className="flex items-center justify-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-4 sm:h-5 w-4 sm:w-5 stroke-neon-blue fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            Tx/Time
                          </div>
                        </th>
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
                        return (
                          <tr
                            key={`${tx.chain}-${tx.hash}-${index}`}
                            className="border-t border-white/10 hover:bg-white/10 transition-all duration-300"
                          >
                            <td className="px-2 py-2 text-gray-200 text-[9px] sm:text-xs text-center">
                              <div className="flex flex-col items-center space-y-1 relative">
                                {tx.token_metadata?.logo && (
                                  <div className="relative inline-block">
                                    <img
                                      src={tx.token_metadata.logo}
                                      alt={`${tx.token} logo`}
                                      className="w-5 h-5 sm:w-6 sm:h-6 rounded-full flex-shrink-0"
                                      onError={(e) => {
                                        logger.error('Token logo failed to load:', {
                                          symbol: tx.token,
                                          src: tx.token_metadata.logo,
                                        });
                                        e.target.src = '/fallback-image.png';
                                      }}
                                    />
                                    <img
                                      src={getPlatformImage(tx.chain)}
                                      alt={`${chainName} logo`}
                                      className="w-3 h-3 sm:w-4 sm:h-4 rounded-full absolute -left-1 -top-1 sm:-left-2 sm:-top-2"
                                      onError={(e) => {
                                        logger.error('Transaction chain logo failed to load:', {
                                          chain: tx.chain,
                                          chainName,
                                          src: getPlatformImage(tx.chain),
                                        });
                                        e.target.src = '/fallback-image.png';
                                      }}
                                    />
                                  </div>
                                )}
                                <span className="text-[8px] sm:text-[10px]">{tx.token || 'Unknown'}</span>
                              </div>
                            </td>
                            <td className="px-2 py-2 text-gray-200 text-[9px] sm:text-xs text-center">
                              <div className="flex flex-col items-center space-y-1">
                                <span
                                  className={`inline-flex px-1.5 py-0.5 rounded-lg text-[7px] sm:text-[8px] font-medium flex-shrink-0 ${tx.type === 'receive' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500'}`}
                                >
                                  {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
                                </span>
                                <div className="flex items-center justify-center space-x-2">
                                  {addressImage && (
                                    <img
                                      src={addressImage}
                                      alt={`${displayAddress} logo`}
                                      className="w-3 h-3 sm:w-4 sm:h-4 rounded-full flex-shrink-0"
                                      onError={(e) => {
                                        logger.error('Address name tag image failed to load:', {
                                          address: tx.type === 'receive' ? tx.from : tx.to,
                                          src: addressImage,
                                        });
                                        e.target.src = '/icons/default.png';
                                      }}
                                    />
                                  )}
                                  <a
                                    href={addressUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[8px] sm:text-xs text-neon-blue hover:underline"
                                    title={tx.type === 'receive' ? tx.from : tx.to}
                                    onClick={() => handleAddressClick(tx.type === 'receive' ? tx.from : tx.to)}
                                  >
                                    {displayAddress}
                                  </a>
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-2 text-gray-200 text-[9px] sm:text-xs text-center">
                              {tx.value != null ? `$${formatNumber(tx.value)}` : 'N/A'}
                            </td>
                            <td className="px-2 py-2 text-gray-200 text-[8px] sm:text-xs text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <a href={txUrl} target="_blank" rel="noreferrer" className="flex-shrink-0">
                                  <img
                                    src="/logos/etherscan-logo.png"
                                    alt="Etherscan"
                                    className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0 object-contain"
                                    onError={(e) => (e.target.src = '/fallback-image.png')}
                                  />
                                </a>
                                <span className="text-[7px] sm:text-[10px] text-gray-500 text-center">
                                  {tx.block_time ? formatDistanceToNow(new Date(tx.block_time), { addSuffix: true }) : 'N/A'}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                !isLoadingTransactions && (
                  <p className="text-xs text-gray-400 text-center p-4">No valid transactions found for this wallet.</p>
                )
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );

  return createPortal(overlayContent, document.body);
};

export default React.memo(WalletBalances);