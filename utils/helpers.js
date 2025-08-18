import {CHAIN_EXPLORER_MAP} from './constants';
import { motion, AnimatePresence } from 'framer-motion';

export const LoadingOverlay = ({ isLoading, isMobile, className = "" }) => (
  <AnimatePresence>
    {isLoading && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className={`absolute inset-0 flex items-center justify-center bg-black/80 ${!isMobile ? 'backdrop-blur-sm' : ''} ${className}`}
        aria-label="Loading animation"
      >
        <div className={`relative ${isMobile ? 'w-10 h-10' : 'w-12 h-12'}`}>
          <video
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-contain"
            src="/logo-loading.webm" // Update with your WebM file path or URL
          >
            Your browser does not support the video tag.
          </video>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
);

export const getExplorerUrls = (chain, hash, address) => {
  const explorer = CHAIN_EXPLORER_MAP[chain] || CHAIN_EXPLORER_MAP.ethereum;
  const txUrl = explorer.supportsTx ? `${explorer.baseUrl}/tx/${hash}` : '#';
  const addressUrl = explorer.supportsAddress ? `${explorer.baseUrl}/address/${address}` : '#';
  return { txUrl, addressUrl };
};

export const SkeletonLoader = ({ count = 5, isMobile }) => (
  <div className="space-y-2 sm:space-y-3 p-2 sm:p-4">
    {[...Array(count)].map((_, index) => (
      <div key={index} className="flex items-center gap-2 sm:gap-4">
        <div className="w-6 sm:w-8 h-6 sm:h-8 bg-gray-700/50 rounded-full animate-pulse"></div>
        <div className="flex-1 space-y-1 sm:space-y-2">
          <div className="h-3 sm:h-4 bg-gray-700/50 rounded animate-pulse"></div>
          <div className="h-3 sm:h-4 bg-gray-700/50 rounded animate-pulse w-3/4"></div>
        </div>
      </div>
    ))}
  </div>
);

export const formatPrice = (price, currency = 'usd', decimals = 8) => {
  if (price == null || isNaN(price)) return 'N/A';

  // Adjust fraction digits based on price magnitude
  let fractionDigits = 2;
  if (price < 0.0001) {
    fractionDigits = decimals; // Use provided decimals for very small prices
  } else if (price < 0.01) {
    fractionDigits = 4;
  }

  // Use toLocaleString with currency style for proper formatting
  return price.toLocaleString('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
};

export const truncateAddress = (address, nameTags = {}, source) => {
  if (!address || address === 'None' || typeof address !== 'string') return { text: 'N/A', image: null };
  const normalizedAddress = address.toLowerCase();
  const nameTag = nameTags[normalizedAddress]?.nameTag;
  const image = nameTags[normalizedAddress]?.image || null;

  const isEvmAddress = address.match(/^0x[a-fA-F0-9]{40}$/);

  if (source === 'Blockchair') {
    const shortAddress = isEvmAddress
      ? `${address.slice(0, 6)}...${address.slice(-4)}`
      : `${address.slice(0, 6)}...${address.slice(-6)}`;
    return {
      text: nameTag ? `${nameTag} (${shortAddress})` : shortAddress,
      image,
    };
  }

  if (isEvmAddress) {
    return { text: nameTag || `${address.slice(0, 6)}...${address.slice(-4)}`, image };
  }

  return { text: nameTag || address, image };
};

export const truncateHash = (hash, startLength = 6, endLength = 4) => {
  // Handle invalid inputs
  if (!hash || typeof hash !== 'string') {
    return { text: 'N/A' };
  }

  // Truncate to 0x1234...abcd format
  if (hash.length > 12) {
    return {
      text: `${hash.slice(0, startLength)}...${hash.slice(-endLength)}`,
    };
  }

  return { text: hash };
};

export const isValidToken = (token) => {
  if (!token.image || token.image === '') return false;
  const invalidNamePatterns = [
    /https?:\/\//i, // Matches URLs
    /<[^>]+>/, // Matches HTML tags
    /[\n\r\t]/, // Matches newlines or tabs
    /[^a-zA-Z0-9\s\-$]/, // Matches non-alphanumeric characters except spaces, $, and -
  ];
  return !invalidNamePatterns.some((pattern) => pattern.test(token.name || token.symbol));
};

export const logger = {
  log: (message, data) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(message, data);
    }
  },
  error: (message, data) => {
    console.error(message, data);
  },
};