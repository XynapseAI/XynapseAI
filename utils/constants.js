// utils/constants.js
export const GECKOTERMINAL_CHAIN_MAPPING = {
  'ethereum': 'eth',
  'arbitrum': 'arbitrum',
  'avalanche_c': 'avalanche',
  'bnb': 'bsc',
  'polygon': 'polygon',
  'optimism': 'optimism',
  'base': 'base',
  'zksync': 'zksync',
  'zora': 'zora',
  'linea': 'linea',
  'mantle': 'mantle',
  'scroll': 'scroll',
  'celo': 'celo',
  'opbnb': 'op_bnb',
  'boba': 'boba',
  'metis': 'metis',
  'blast': 'blast',
  'sei': 'sei',
  'kaia': 'kaia',
  'world': 'worldchain',
  'unichain': 'unichain',
  'sonic': 'sonic',
  'berachain': 'berachain',
  'ink': 'ink',
  'mode': 'mode',
  'soneium': 'soneium',
};

// utils/constants.js
export const chains = [
  { value: '1', label: 'Ethereum', image: '/icons/ethereum.png', testnet: false },
  { value: '56', label: 'BNB Chain', image: '/icons/bsc.png', testnet: false },
  { value: '204', label: 'opBNB', image: '/icons/opbnb.png', testnet: false },
  { value: '250', label: 'Fantom', image: '/icons/fantom.png', testnet: false },
  { value: '10', label: 'Optimism', image: '/icons/optimism.png', testnet: false },
  { value: '137', label: 'Polygon', image: '/icons/polygon.png', testnet: false },
  { value: '42161', label: 'Arbitrum', image: '/icons/arbitrum.png', testnet: false },
  { value: '100', label: 'Gnosis', image: '/icons/gnosis.png', testnet: false },
  { value: '8453', label: 'Base', image: '/icons/base.png', testnet: false },
  { value: '59144', label: 'Linea', image: '/icons/linea.png', testnet: false },
  { value: '534352', label: 'Scroll', image: '/icons/scroll.png', testnet: false },
  { value: '81457', label: 'Blast', image: '/icons/blast.png', testnet: false },
  { value: 'solana', label: 'Solana', image: '/icons/solana.png', testnet: false },
  { value: 'tron', label: 'TRON', image: '/icons/tron.png', testnet: false },
];

export const mapCoinGeckoChains = (coingeckoChains) => {
  const chainMap = {
    'ethereum': '1',
    'binance-smart-chain': '56',
    'opbnb': '204',
    'fantom': '250',
    'optimistic-ethereum': '10',
    'polygon-pos': '137',
    'arbitrum-one': '42161',
    'xdai': '100',
    'base': '8453',
    'linea': '59144',
    'scroll': '534352',
    'blast': '81457',
    'solana': 'solana',
    'tron': 'tron',
  };

  return coingeckoChains
    .filter((chain) => chainMap[chain.id])
    .map((chain) => ({
      value: chainMap[chain.id],
      label: chain.name,
      image: chain.image?.thumb || chains.find((c) => c.value === chainMap[chain.id])?.image || '/icons/default.png',
      testnet: false,
    }));
};

export const getPlatformImage = (chainId, coingeckoChains) => {
  const chain = coingeckoChains.find((c) => {
    const chainMap = {
      '1': 'ethereum',
      '56': 'binance-smart-chain',
      '204': 'opbnb',
      '250': 'fantom',
      '10': 'optimistic-ethereum',
      '137': 'polygon-pos',
      '42161': 'arbitrum-one',
      '100': 'xdai',
      '8453': 'base',
      '59144': 'linea',
      '534352': 'scroll',
      '81457': 'blast',
      'solana': 'solana',
      'tron': 'tron',
    };
    return c.id === chainMap[chainId];
  });
  return chain?.image?.thumb || chains.find((c) => c.value === chainId)?.image || '/icons/default.png';
};

export const getExplorerUrls = (chainId, txHash, address) => {
  const chain = chains.find((c) => c.value === chainId) || { value: '1', label: 'Ethereum' };
  const baseUrls = {
    '1': 'https://etherscan.io',
    '56': 'https://bscscan.com',
    '204': 'https://opbnb.bscscan.com',
    '250': 'https://ftmscan.com',
    '10': 'https://optimistic.etherscan.io',
    '137': 'https://polygonscan.com',
    '42161': 'https://arbiscan.io',
    '100': 'https://gnosisscan.io',
    '8453': 'https://basescan.org',
    '59144': 'https://lineascan.build',
    '534352': 'https://scrollscan.com',
    '81457': 'https://blastscan.io',
    'solana': 'https://solscan.io',
    'tron': 'https://tronscan.org',
  };
  const baseUrl = baseUrls[chainId] || baseUrls['1'];
  return {
    txUrl: `${baseUrl}/tx/${txHash}`,
    addressUrl: `${baseUrl}/address/${address}`,
  };
};