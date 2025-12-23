// components/UniversalSearch.jsx
"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Wallet, Building2, Hash, DollarSign, X, Link2 } from "lucide-react";
import useSWR from "swr";
import { LoadingOverlay } from "../utils/helpers";

export default function UniversalSearch({
  onSelect,
  placeholder = "Search wallets, nametags, tokens, or exchanges...",
  className = "",
  size = "default", // "small", "default", "large"
  hideOrganizations = false,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [groupedResults, setGroupedResults] = useState({
    wallets: [],
    organizations: hideOrganizations ? [] : [],  // NEW: Always empty if hidden
    tokens: [],
    nametags: [],
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const searchRef = useRef(null);
  const debounceTimer = useRef(null);

  // Size configurations
  const sizeConfig = {
    small: {
      input: "text-[8px] sm:text-[9px] px-2 py-1 w-[100px] sm:w-[150px]",
      button: "p-1",
      icon: 10,
      modalInput: "text-[8px] sm:text-[9px] px-2 py-1 w-full",
      modalResult: "text-[8px]",
      image: "w-4 h-4",
      tag: "text-[7px] px-1 py-0.5",
    },
    default: {
      input: "text-[9px] sm:text-[10px] px-3 py-1.5 w-[120px] sm:w-[200px]",
      button: "p-1",
      icon: 12,
      modalInput: "text-[9px] sm:text-[10px] px-3 py-1.5 w-full",
      modalResult: "text-[9px]",
      image: "w-5 h-5",
      tag: "text-[8px] px-2 py-0.5",
    },
    large: {
      input: "text-[10px] sm:text-[12px] px-4 py-2 w-[150px] sm:w-[250px]",
      button: "p-2",
      icon: 14,
      modalInput: "text-[10px] sm:text-[12px] px-4 py-2 w-full",
      modalResult: "text-[10px]",
      image: "w-6 h-6",
      tag: "text-[9px] px-2.5 py-1",
    },
  };

  const config = sizeConfig[size];

  // Debouncing logic
  const debounce = useCallback((value) => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      setDebouncedQuery(value);
    }, 300); // 300ms debounce
  }, []);

  // Update debouncedQuery when searchQuery changes
  useEffect(() => {
    if (searchQuery.trim().length >= 2) {
      debounce(searchQuery.trim());
    } else {
      setDebouncedQuery("");
    }
  }, [searchQuery, debounce]);

  // SWR fetcher
  const fetcher = async (url) => {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch");
    return response.json();
  };

  // SWR for nametags, exchanges, clusters, và tokens
  const { data: nametagData, error: nametagError, isLoading: isLoadingNametags } = useSWR(
    debouncedQuery ? `/api/search-nametags?query=${encodeURIComponent(debouncedQuery)}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000, refreshInterval: 300000 },
  );

  const { data: exchangeData, error: exchangeError, isLoading: isLoadingExchanges } = useSWR(
    debouncedQuery ? `/api/coingecko?action=exchange-search&query=${encodeURIComponent(debouncedQuery)}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000, refreshInterval: 300000 },
  );

  const { data: clusterData, error: clusterError, isLoading: isLoadingClusters } = useSWR(
    debouncedQuery ? `/api/search-clusters?query=${encodeURIComponent(debouncedQuery)}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000, refreshInterval: 300000 },
  );

  const { data: tokenData, error: tokenError, isLoading: isLoadingTokens } = useSWR(
    debouncedQuery ? `/api/search-tokens?query=${encodeURIComponent(debouncedQuery)}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000, refreshInterval: 300000 },
  );

  // Handle click outside to close modal
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setIsModalOpen(false);
        setSearchQuery("");
        setGroupedResults({ wallets: [], organizations: [], tokens: [], nametags: [] });
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isValidAddress = (address) => {
    if (typeof address !== 'string') return false;

    // EVM address
    if (/^0x[a-fA-F0-9]{40}$/i.test(address)) return true;

    // Bitcoin address (Legacy P2PKH, P2SH, Bech32)
    if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/i.test(address)) return true;

    // Solana address
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return true;

    // Tron address
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/i.test(address)) return true;

    return false;
  };

  // Predefined major organizations
  const majorOrganizations = [
    { id: "binance", name: "Binance", type: "organization", image: "/icons/binance.webp" },
    { id: "okex", name: "OKX", type: "organization", image: "/icons/okx.webp" },
    { id: "bybit_spot", name: "Bybit", type: "organization", image: "/icons/bybit.webp" },
    { id: "uniswap", name: "Uniswap", type: "organization", image: "/icons/uniswap.webp" },
    { id: "mtgox", name: "Mt. Gox", type: "organization", image: "/icons/mtgox.webp" },
    { id: "kraken", name: "Kraken", type: "organization", image: "/icons/kraken.webp" },
    { id: "bitfinex", name: "Bitfinex", type: "organization", image: "/icons/bitfinex.webp" },
    { id: "huobi-global", name: "Huobi", type: "organization", image: "/icons/huobi.webp" },
    { id: "kucoin", name: "KuCoin", type: "organization", image: "/icons/kucoin.webp" },
    { id: "gate-io", name: "Gate.io", type: "organization", image: "/icons/gateio.webp" },
  ];

  // Capitalize function
  const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

  // Sort function for each group
  const sortGroup = (arr, query) => {
    return arr.sort((a, b) => {
      const aScore = a.name.toLowerCase().indexOf(query.toLowerCase());
      const bScore = b.name.toLowerCase().indexOf(query.toLowerCase());
      if (aScore === -1 && bScore === -1) return 0;
      if (aScore === -1) return 1;
      if (bScore === -1) return -1;
      return aScore - bScore;
    });
  };

  // Process search results
  useEffect(() => {
    if (!isModalOpen) {
      setGroupedResults({ wallets: [], organizations: [], tokens: [], nametags: [] });
      setIsLoading(false);
      return;
    }

    setIsLoading(isLoadingNametags || isLoadingExchanges || isLoadingClusters || isLoadingTokens);

    const newGrouped = {
      wallets: [],
      organizations: [],
      tokens: [],
      nametags: [],
    };

    // 1. Check if it's a valid wallet address
    if (isValidAddress(searchQuery)) {
      newGrouped.wallets.push({
        id: `wallet-${searchQuery}`,
        type: "wallet",
        address: searchQuery,
        name: `Wallet: ${searchQuery.slice(0, 6)}...${searchQuery.slice(-4)}`,
        image: "/icons/wallet.webp",
      });
    }

    // 2. Search major organizations
    const orgMatches = majorOrganizations.filter((org) =>
      org.name.toLowerCase().includes(debouncedQuery.toLowerCase()),
    );
    if (!hideOrganizations) {  // NEW: Conditional for Treemap
      newGrouped.organizations.push(...orgMatches);
    }

    // 3. Add nametag results
    if (nametagData?.success && nametagData.data) {
      newGrouped.nametags.push(
        ...nametagData.data.map((nametag) => ({
          id: `nametag-${nametag.address}`,
          type: "nametag",
          address: nametag.address,
          name: nametag.nametag,
          description: nametag.description,
          image: nametag.image || "/icons/default-nametag.webp",
          subcategory: nametag.subcategory,
        })),
      );
      if (isValidAddress(debouncedQuery)) {
        newGrouped.nametags = newGrouped.nametags.filter(nt => nt.address.toLowerCase() === debouncedQuery.toLowerCase());
      }
    }

    // 4. Add exchange results
    if (exchangeData?.data) {
      if (!hideOrganizations) {  // NEW: Conditional for Treemap
        newGrouped.organizations.push(
          ...exchangeData.data.map((exchange) => ({
            id: `exchange-${exchange.id}`,
            type: "exchange",
            name: exchange.name,
            image: exchange.image,
            exchangeId: exchange.id,
          })),
        );
      }
    }

    // 5. Add cluster results
    if (clusterData?.success && clusterData.data) {
      if (!hideOrganizations) {  // NEW: Conditional for Treemap
        newGrouped.organizations.push(
          ...clusterData.data.map((cluster) => ({
            id: `cluster-${cluster.cluster_name}`,
            type: "organization",
            name: capitalize(cluster.cluster_name),
            image: cluster.image,
            exchangeId: cluster.cluster_name,
            holder_addresses: cluster.holder_addresses || [],
          })),
        );
      }
    }

    // 6. Add token results
    if (tokenData?.success && tokenData.data) {
      newGrouped.tokens.push(
        ...tokenData.data.map((token) => ({
          id: `token-${token.contractAddress || token.symbol}`,
          type: "token",
          address: token.contractAddress,
          symbol: token.symbol,
          name: token.name,
          image: token.image || "/icons/default-token.webp",
          chain: token.chain,
        })),
      );
    }

    // Sort each group
    Object.keys(newGrouped).forEach((key) => {
      newGrouped[key] = sortGroup(newGrouped[key], debouncedQuery);
    });

    setGroupedResults(newGrouped);

    console.log("Universal search results:", {
      query: searchQuery,
      groupCounts: Object.fromEntries(Object.entries(newGrouped).map(([k, v]) => [k, v.length])),
    });

    // Log errors without toasts
    if (nametagError) {
      console.error("Error searching nametags:", { query: searchQuery, error: nametagError.message });
    }
    if (exchangeError) {
      console.error("Error searching exchanges:", { query: searchQuery, error: exchangeError.message });
    }
    if (clusterError) {
      console.error("Error searching clusters:", { query: searchQuery, error: clusterError.message });
    }
    if (tokenError) {
      console.error("Error searching tokens:", { query: searchQuery, error: tokenError.message });
    }
  }, [searchQuery, debouncedQuery, nametagData, exchangeData, clusterData, tokenData, isLoadingNametags, isLoadingExchanges, isLoadingClusters, isLoadingTokens, nametagError, exchangeError, clusterError, tokenError, isModalOpen]);

  // Handle result selection
  const handleResultSelect = (result) => {
    if (onSelect) {
      if ((result.type === "wallet" || result.type === "nametag" || result.type === "token") && result.address && isValidAddress(result.address)) {
        onSelect({ ...result, isValid: true });
      } else {
        onSelect({ ...result, isValid: false });
      }
    }
    setSearchQuery("");
    setDebouncedQuery("");
    setGroupedResults({ wallets: [], organizations: [], tokens: [], nametags: [] });
    setIsModalOpen(false);
  };

  // Get icon for result type
  const getResultIcon = (type) => {
    switch (type) {
      case "wallet":
        return <Wallet size={config.icon} className="text-blue-400" />;
      case "nametag":
        return <Hash size={config.icon} className="text-green-400" />;
      case "token":
        return <DollarSign size={config.icon} className="text-yellow-400" />;
      case "organization":
      case "exchange":
        return <Building2 size={config.icon} className="text-purple-400" />;
      default:
        return <Search size={config.icon} className="text-gray-400" />;
    }
  };

  const getTypeTagClass = (type) => {
    switch (type) {
      case "organization":
      case "exchange":
        return "bg-gradient-to-r from-green-500/20 to-green-600/20 text-green-300 border-green-500/30 backdrop-blur-sm shadow-green-500/10";
      case "token":
        return "bg-gradient-to-r from-yellow-500/20 to-amber-600/20 text-yellow-300 border-yellow-500/30 backdrop-blur-sm shadow-yellow-500/10";
      case "nametag":
        return "bg-gradient-to-r from-blue-500/20 to-cyan-600/20 text-blue-300 border-blue-500/30 backdrop-blur-sm shadow-blue-500/10";
      case "wallet":
        return "bg-gradient-to-r from-gray-500/20 to-slate-600/20 text-gray-300 border-gray-500/30 backdrop-blur-sm shadow-gray-500/10";
      default:
        return "bg-gradient-to-r from-gray-500/20 to-slate-600/20 text-gray-300 border-gray-500/30 backdrop-blur-sm shadow-gray-500/10";
    }
  };

  const getChainTagClass = (chain) => {
    const chainColors = {
      ethereum: "bg-gradient-to-r from-purple-500/20 to-indigo-600/20 text-purple-300 border-purple-500/30",
      base: "bg-gradient-to-r from-blue-500/20 to-cyan-600/20 text-blue-300 border-blue-500/30",
      arbitrum: "bg-gradient-to-r from-orange-500/20 to-red-600/20 text-orange-300 border-orange-500/30",
      polygon: "bg-gradient-to-r from-pink-500/20 to-rose-600/20 text-pink-300 border-pink-500/30",
    };
    return chainColors[chain] || "bg-gradient-to-r from-gray-500/50 to-slate-600/50 text-gray-500 border-gray-500/50 backdrop-blur-sm shadow-gray-500/10";
  };

  // Get result type label
  const getTypeLabel = (type) => {
    switch (type) {
      case "wallet":
        return "Wallet";
      case "nametag":
        return "Nametag";
      case "token":
        return "Token";
      case "organization":
        return "Organization";
      case "exchange":
        return "Exchange";
      default:
        return "Unknown";
    }
  };

  // Get section title
  const getSectionTitle = (section) => {
    switch (section) {
      case "wallets":
        return "Wallet Addresses";
      case "organizations":
        return "Organizations & Exchanges";
      case "tokens":
        return "Tokens";
      case "nametags":
        return "Nametags";
      default:
        return "";
    }
  };

  // Check if all groups are empty
  const hasNoResults = Object.values(groupedResults).every(group => group.length === 0);

  return (
    <div className={`relative ${className}`} ref={searchRef}>
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder={placeholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setIsModalOpen(true)}
          className={`w-full sm:w-[50vw] h-[4vh] text-white border-b-2 border-b-white/20 bg-black/5 backdrop-blur-xs focus:outline-none focus:ring-2 focus:ring-neon-blue/50 ${config.input}`}
          aria-label="Search wallets, nametags, tokens, or exchanges"
        />
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              className="w-[90vw] sm:w-[50vw] h-[50vh] bg-black/90 backdrop-blur-sm border border-white/20 flex flex-col overflow-hidden rounded-xl shadow-2xl shadow-neon-lg"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/20">
                <input
                  type="text"
                  placeholder={placeholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`text-white border-b-2 border-b-white/20 bg-black/5 backdrop-blur-xs focus:border-none ${config.modalInput}`}
                  aria-label="Search wallets, nametags, tokens, or exchanges"
                  autoFocus
                />
                <motion.button
                  onClick={() => {
                    setIsModalOpen(false);
                    setSearchQuery("");
                    setDebouncedQuery("");
                    setGroupedResults({ wallets: [], organizations: [], tokens: [], nametags: [] });
                  }}
                  className="text-white/70 hover:bg-white/10 p-2 rounded-full transition-all duration-300 hover:shadow-neon-sm"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  aria-label="Close search modal"
                >
                  <X size={config.icon} />
                </motion.button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 mobile-scroll relative">
                <LoadingOverlay isLoading={isLoading} isMobile={window.innerWidth <= 640} className="absolute inset-0 z-[60]" />
                {Object.entries(groupedResults).map(([section, results]) => (
                  (section !== 'organizations' || !hideOrganizations) && results.length > 0 && (  // NEW: Skip organizations in Treemap
                    <div key={section} className="mb-6">
                      <h3 className="text-white font-bold text-sm mb-3">{getSectionTitle(section)}</h3>
                      {results.slice(0, 10).map((result) => (
                        <motion.button
                          key={result.id}
                          onClick={() => handleResultSelect(result)}
                          className={`flex items-center w-full text-left px-3 py-3 hover:bg-white/10 text-white transition-all duration-300 border-b border-white/5 last:border-b-0 rounded-lg mx-1 my-1 hover:shadow-neon-sm ${config.modalResult}`}
                          role="option"
                          aria-selected={false}
                        >
                          <div className="flex items-center mr-3 flex-shrink-0">
                            {result.image ? (
                              <motion.img
                                src={result.image || "/placeholder.svg"}
                                alt={`${result.name} logo`}
                                className={`rounded-full mr-2 ${config.image} shadow-lg`}
                                onError={(e) => {
                                  e.target.style.display = "none";
                                  e.target.nextSibling.style.display = "flex";
                                }}
                              />
                            ) : null}
                            <motion.div
                              className="flex items-center justify-center mr-2"
                              style={{ display: result.image ? "none" : "flex" }}
                            >
                              {getResultIcon(result.type)}
                            </motion.div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-white truncate text-sm">{result.name || result.symbol}</span>
                              <motion.span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full border font-medium ${config.tag} ${getTypeTagClass(result.type)}`}
                              >
                                {getTypeLabel(result.type)}
                              </motion.span>
                              {result.chain && result.type === "token" && (
                                <motion.span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full border font-medium ${config.tag} ${getChainTagClass(result.chain)}`}
                                >
                                  <Link2 className="w-2 h-2 mr-1" />
                                  {result.chain.toUpperCase()}
                                </motion.span>
                              )}
                            </div>
                            {result.address && (
                              <div className="text-xs text-white/60 font-inter truncate mt-0.5 bg-black/20 px-2 py-1 rounded-md">
                                {result.address}
                              </div>
                            )}
                            {result.holder_addresses && result.holder_addresses.length > 0 && (
                              <div className="text-xs text-white/40 truncate mt-0.5">
                                {result.holder_addresses.length} wallets
                              </div>
                            )}
                          </div>
                        </motion.button>
                      ))}
                    </div>
                  )
                ))}
                {!isLoading && hasNoResults && (
                  <motion.p
                    className="text-[10px] text-white/60 text-center mt-4 animate-pulse"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    No results found. Try a different query.
                  </motion.p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx>{`
        .shadow-neon-lg {
          box-shadow: 0 0 20px rgba(0, 191, 255, 0.3), 0 0 40px rgba(0, 191, 255, 0.1);
        }
        .shadow-neon-sm {
          box-shadow: 0 0 8px rgba(0, 191, 255, 0.2), 0 0 16px rgba(0, 191, 255, 0.05);
        }
        .mobile-scroll {
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .mobile-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}