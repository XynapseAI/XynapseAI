// utils/helpers.js
import { CHAIN_EXPLORER_MAP, CHAIN_ID_TO_NAME, SUPPORTED_SVM_CHAINS } from './constants';
import { motion, AnimatePresence } from 'framer-motion';
import { isAddress } from 'ethers';

export const LoadingOverlay = ({ isLoading, isMobile, className = "" }) => (
  <AnimatePresence>
    {isLoading && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className={`fixed inset-0 flex items-center justify-center bg-black/80 rounded-xl z-[1000] backdrop-blur-sm ${className}`}
        style={{ WebkitBackdropFilter: 'blur(4px)' }}
        aria-label="Loading animation"
      >
        <div className={`relative rounded-xl ${isMobile ? "w-12 h-12" : "w-16 h-16"}`}>
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
        </div>
      </motion.div>
    )}
  </AnimatePresence>
);

export const getExplorerUrls = (chain, hash, address) => {
  const normalizedChain = (String(chain || 'ethereum')).toLowerCase();
  const isSVM = SUPPORTED_SVM_CHAINS.includes(normalizedChain);
  const isBitcoin = normalizedChain === 'bitcoin';
  const isEthereum = normalizedChain === 'ethereum';

  let txUrl = '#';
  let addressUrl = '#';

  if (isBitcoin) {
    txUrl = hash ? `https://mempool.space/tx/${hash}` : '#';
    addressUrl = address ? `https://mempool.space/address/${address}` : '#';
  } else if (isSVM) {
    if (normalizedChain === 'solana') {
      txUrl = hash ? `https://solscan.io/tx/${hash}` : '#';
      addressUrl = address ? `https://solscan.io/account/${address}` : '#';
    } else if (normalizedChain === 'eclipse') {
      txUrl = hash ? `https://explorer.eclipse.xyz/tx/${hash}` : '#';
      addressUrl = address ? `https://explorer.eclipse.xyz/account/${address}` : '#';
    }
  } else if (isEthereum) {
    txUrl = hash ? `https://etherscan.io/tx/${hash}` : '#';
    addressUrl = address ? `https://etherscan.io/address/${address}` : '#';
  } else {
    const chainName = CHAIN_ID_TO_NAME[normalizedChain] || normalizedChain;
    const explorer = CHAIN_EXPLORER_MAP[normalizedChain] || CHAIN_EXPLORER_MAP.ethereum;

    logger.log('getExplorerUrls (EVM):', {
      inputChain: chain,
      normalizedChain,
      chainName,
      explorerBaseUrl: explorer.baseUrl,
    });

    const supportsTx = explorer.supportsTx ?? true;
    const supportsAddress = explorer.supportsAddress ?? true;

    txUrl = supportsTx && hash ? `${explorer.baseUrl}/tx/${hash}` : '#';
    addressUrl = supportsAddress && address ? `${explorer.baseUrl}/address/${address}` : '#';
  }

  if (isSVM || isBitcoin) {
    logger.log('getExplorerUrls (SVM or Bitcoin):', {
      inputChain: chain,
      normalizedChain,
      txUrl,
      addressUrl,
    });
  }

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
  if (price == null || isNaN(price) || typeof price !== 'number') {
    logger.error('Invalid price value:', { price, currency });
    return 'N/A';
  }

  const normalizedPrice = Number(price.toFixed(decimals));
  const MAX_REASONABLE_PRICE = 1e12;
  const MIN_REASONABLE_PRICE = -1e12;
  if (normalizedPrice > MAX_REASONABLE_PRICE || normalizedPrice < MIN_REASONABLE_PRICE) {
    logger.error('Abnormal price value detected:', { price: normalizedPrice, currency });
    return 'N/A';
  }

  let fractionDigits = 2;
  if (Math.abs(normalizedPrice) < 0.0001) {
    fractionDigits = decimals;
  } else if (Math.abs(normalizedPrice) < 0.01) {
    fractionDigits = 4;
  }

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
  if (!address || address === 'None' || typeof address !== 'string') {
    logger.log("truncateAddress: Invalid address", { address, source });
    return { text: 'N/A', image: null, shortAddress: 'N/A', originalAddress: 'N/A' };
  }

  const normalizedAddress = address.toLowerCase();
  const nameTag = nameTags[normalizedAddress]?.nameTag || nameTags[normalizedAddress]?.name;
  const image = nameTags[normalizedAddress]?.image || null;

  const isEvmAddress = isAddress(address);
  const isSvmAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  const isBtcAddress = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-zA-Z0-9]{39,59}$/.test(address);

  logger.log("truncateAddress: Processing", { address, source, isEvmAddress, isSvmAddress, isBtcAddress, nameTag });

  let shortAddress;
  if (isEvmAddress || isBtcAddress) {
    shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
  } else if (isSvmAddress) {
    shortAddress = `${address.slice(0, 6)}...${address.slice(-6)}`;
  } else {
    shortAddress = address;
  }

  return {
    text: nameTag || shortAddress,
    image,
    shortAddress,
    originalAddress: address,
  };
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
    /https?:\/\//i,
    /<[^>]+>/,
    /[\n\r\t]/,
    /[^a-zA-Z0-9\s\-$]/,
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
  warn: (message, data) => {
    if (process.env.NODE_ENV === 'development') {
      console.warn(message, data);
    }
  },
};

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}