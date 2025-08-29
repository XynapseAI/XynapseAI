// utils/helpers.js
import { CHAIN_EXPLORER_MAP, CHAIN_ID_TO_NAME } from './constants';
import { motion, AnimatePresence } from 'framer-motion';

export const LoadingOverlay = ({ isLoading, isMobile, className = "" }) => (
  <AnimatePresence>
    {isLoading && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className={`absolute inset-0 flex items-center justify-center bg-black/80 rounded-xl ${!isMobile ? "backdrop-blur-xl" : "backdrop-blur-xl"} ${className}`}
        aria-label="Loading animation"
      >
        <div className={`relative rounded-xl ${isMobile ? "w-10 h-10" : "w-12 h-12"}`}>
          {/* Logo */}
          <video
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-contain relative z-10"
            src="/logo-loading.webm"
          >
            Your browser does not support the video tag.
          </video>

          {/* Hiệu ứng mờ đồng đều 4 phía */}
          <div className="absolute inset-0 -z-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.9)_20%,rgba(0,0,0,0)_80%)] blur-2xl" />
          </div>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
);



export const getExplorerUrls = (chain, hash, address) => {
  // Normalize chain name to lowercase to avoid case sensitivity issues
  const normalizedChain = (chain || 'ethereum').toLowerCase();
  const chainName = CHAIN_ID_TO_NAME[normalizedChain] || normalizedChain;
  const explorer = CHAIN_EXPLORER_MAP[normalizedChain] || CHAIN_EXPLORER_MAP.ethereum;

  logger.log('getExplorerUrls:', {
    inputChain: chain,
    normalizedChain,
    chainName,
    explorerBaseUrl: explorer.baseUrl,
  });

  const txUrl = explorer.supportsTx && hash ? `${explorer.baseUrl}/tx/${hash}` : '#';
  const addressUrl = explorer.supportsAddress && address ? `${explorer.baseUrl}/address/${address}` : '#';

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
  // Handle null, undefined, NaN, or non-numeric values
  if (price == null || isNaN(price) || typeof price !== 'number') {
    logger.error('Invalid price value:', { price, currency });
    return 'N/A';
  }

  // Convert scientific notation to a regular number
  const normalizedPrice = Number(price.toFixed(decimals));

  // Validate price range
  const MAX_REASONABLE_PRICE = 1e12; // 1 trillion USD
  const MIN_REASONABLE_PRICE = -1e12; // Allow negative prices up to -1 trillion
  if (normalizedPrice > MAX_REASONABLE_PRICE || normalizedPrice < MIN_REASONABLE_PRICE) {
    logger.error('Abnormal price value detected:', { price: normalizedPrice, currency });
    return 'N/A';
  }

  // Adjust fraction digits based on price magnitude
  let fractionDigits = 2;
  if (Math.abs(normalizedPrice) < 0.0001) {
    fractionDigits = decimals; // Use provided decimals for very small prices
  } else if (Math.abs(normalizedPrice) < 0.01) {
    fractionDigits = 4;
  }

  // Use toLocaleString with currency style for proper formatting
  try {
    return normalizedPrice.toLocaleString('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  } catch (err) {
    logger.error('Error formatting price:', { price: normalizedPrice, currency, error: err.message });
    return 'N/A';
  }
};

export const truncateAddress = (address, nameTags = {}, source) => {
  if (!address || address === 'None' || typeof address !== 'string') return { text: 'N/A', image: null };
  const normalizedAddress = address.toLowerCase();
  const nameTag = nameTags[normalizedAddress]?.nameTag || nameTags[normalizedAddress]?.name;
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
  if (!hash || typeof hash !== 'string') {
    return { text: 'N/A' };
  }

  if (hash.length > 12) {
    return {
      text: `${hash.slice(0, startLength)}...${hash.slice(-endLength)}`,
    };
  }

  return { text: hash };
};

export const isValidToken = (token) => {
  if (!token || !token.image || token.image === '') return false;
  const nameOrSymbol = token.name || token.symbol || '';
  const invalidNamePatterns = [
    /https?:\/\//i, // Matches URLs
    /<[^>]+>/, // Matches HTML tags
    /[\n\r\t]/, // Matches newlines or tabs
    /[^a-zA-Z0-9\s\-$]/, // Matches non-alphanumeric characters except spaces, $, and -
  ];
  const isValid = !invalidNamePatterns.some((pattern) => pattern.test(nameOrSymbol));
  if (!isValid) {
    logger.error('Invalid token detected:', { token });
  }
  return isValid;
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