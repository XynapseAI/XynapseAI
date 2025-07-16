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

// utils/chainConstants.js
export const SUPPORTED_CHAINS = [
  { value: 'abstract', chainId: '2741', label: 'Abstract' },
  { value: 'ancient8', chainId: '888888888', label: 'Ancient8' },
  { value: 'ape_chain', chainId: '33139', label: 'Ape Chain' },
  { value: 'arbitrum', chainId: '42161', label: 'Arbitrum' },
  { value: 'arbitrum_nova', chainId: '42170', label: 'Arbitrum Nova' },
  { value: 'avalanche_c', chainId: '43114', label: 'Avax-C' },
  { value: 'avalanche_fuji', chainId: '43113', label: 'Avalanche Fuji', testnet: true },
  { value: 'base', chainId: '8453', label: 'Base' },
  { value: 'base_sepolia', chainId: '84532', label: 'Base Sepolia', testnet: true },
  { value: 'berachain', chainId: '80094', label: 'Berachain' },
  { value: 'blast', chainId: '81457', label: 'Blast' },
  { value: 'bnb', chainId: '56', label: 'BNB' },
  { value: 'bob', chainId: '60808', label: 'BOB' },
  { value: 'boba', chainId: '288', label: 'Boba' },
  { value: 'celo', chainId: '42220', label: 'Celo' },
  { value: 'corn', chainId: '21000000', label: 'Corn' },
  { value: 'cyber', chainId: '7560', label: 'Cyber' },
  { value: 'degen', chainId: '666666666', label: 'Degen' },
  { value: 'ethereum', chainId: '1', label: 'ETH' },
  { value: 'fantom', chainId: '250', label: 'Fantom' },
  { value: 'flare', chainId: '14', label: 'Flare' },
  { value: 'gnosis', chainId: '100', label: 'Gnosis Chain' },
  { value: 'ham', chainId: '5112', label: 'Ham' },
  { value: 'hychain', chainId: '2911', label: 'Hychain' },
  { value: 'ink', chainId: '57073', label: 'Ink' },
  { value: 'kaia', chainId: '8217', label: 'Kaia' },
  { value: 'linea', chainId: '59144', label: 'Linea' },
  { value: 'lisk', chainId: '1135', label: 'Lisk' },
  { value: 'mantle', chainId: '5000', label: 'Mantle' },
  { value: 'metis', chainId: '1088', label: 'Metis' },
  { value: 'mint', chainId: '185', label: 'Mint' },
  { value: 'mode', chainId: '34443', label: 'Mode' },
  { value: 'omni', chainId: '166', label: 'Omni' },
  { value: 'opbnb', chainId: '204', label: 'opBNB' },
  { value: 'optimism', chainId: '10', label: 'Optimism' },
  { value: 'polygon', chainId: '137', label: 'Polygon' },
  { value: 'proof_of_play', chainId: '70700', label: 'Proof of Play' },
  { value: 'rari', chainId: '1380012617', label: 'Rari' },
  { value: 'redstone', chainId: '690', label: 'Redstone' },
  { value: 'scroll', chainId: '534352', label: 'Scroll' },
  { value: 'sei', chainId: '1329', label: 'Sei' },
  { value: 'sepolia', chainId: '11155111', label: 'Sepolia', testnet: true },
  { value: 'shape', chainId: '360', label: 'Shape' },
  { value: 'soneium', chainId: '1868', label: 'Soneium' },
  { value: 'sonic', chainId: '146', label: 'Sonic' },
  { value: 'superseed', chainId: '5330', label: 'Superseed' },
  { value: 'swellchainhome', chainId: '1923', label: 'Swell Chain' },
  { value: 'unichain', chainId: '130', label: 'Unichain' },
  { value: 'wemix', chainId: '1111', label: 'Wemix' },
  { value: 'world', chainId: '480', label: 'World' },
  { value: 'xai', chainId: '660279', label: 'Xai' },
  { value: 'zero_network', chainId: '543210', label: 'Zero Network' },
  { value: 'zkevm', chainId: '1101', label: 'Polygon zkEVM' },
  { value: 'zksync', chainId: '324', label: 'zkSync' },
  { value: 'zora', chainId: '7777777', label: 'Zora' },
  { value: 'monad_testnet', chainId: null, label: 'Monad Testnet', testnet: true },
  { value: 'solana', chainId: null, label: 'Solana' }, // Added Solana
];

export const CHAIN_MAPPING = {
  'ethereum': { simChain: 'ethereum', chainId: '1' },
  'arbitrum-one': { simChain: 'arbitrum', chainId: '42161' },
  'avalanche': { simChain: 'avalanche_c', chainId: '43114' },
  'binance-smart-chain': { simChain: 'bnb', chainId: '56' },
  'polygon-pos': { simChain: 'polygon', chainId: '137' },
  'optimistic-ethereum': { simChain: 'optimism', chainId: '10' },
  'gnosis': { simChain: 'gnosis', chainId: '100' },
  'base': { simChain: 'base', chainId: '8453' },
  'fantom': { simChain: 'fantom', chainId: '250' },
  'zksync': { simChain: 'zksync', chainId: '324' },
  'zora': { simChain: 'zora', chainId: '7777777' },
  'linea': { simChain: 'linea', chainId: '59144' },
  'mantle': { simChain: 'mantle', chainId: '5000' },
  'scroll': { simChain: 'scroll', chainId: '534352' },
  'celo': { simChain: 'celo', chainId: '42220' },
  'opbnb': { simChain: 'opbnb', chainId: '204' },
  'boba': { simChain: 'boba', chainId: '288' },
  'metis-andromeda': { simChain: 'metis', chainId: '1088' },
  'blast': { simChain: 'blast', chainId: '81457' },
  'sei-network': { simChain: 'sei', chainId: '1329' },
  'kaia': { simChain: 'kaia', chainId: '8217' },
  'world-chain': { simChain: 'world', chainId: '480' },
  'unichain': { simChain: 'unichain', chainId: '130' },
  'sonic': { simChain: 'sonic', chainId: '146' },
  'berachain': { simChain: 'berachain', chainId: '80094' },
  'ink': { simChain: 'ink', chainId: '57073' },
  'mode': { simChain: 'mode', chainId: '34443' },
  'soneium': { simChain: 'soneium', chainId: '1868' },
  'monad': { simChain: 'monad_testnet', chainId: null },
  'solana': { simChain: 'solana', chainId: null }, // Added Solana
};

// Optional: Include NON_EVM_CHAINS if needed
export const NON_EVM_CHAINS = ['bitcoin', 'ethereum', 'dogecoin', 'solana'];