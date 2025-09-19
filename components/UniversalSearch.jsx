"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import { Search, Wallet, Building2, Hash, X } from "lucide-react";
import useSWR from "swr";
import { LoadingOverlay } from "../utils/helpers";

export default function UniversalSearch({
  onSelect,
  placeholder = "Search wallets, nametags, or exchanges...",
  className = "",
  size = "default", // "small", "default", "large"
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const searchRef = useRef(null);

  // Size configurations
  const sizeConfig = {
    small: {
      input: "text-[8px] sm:text-[9px] px-2 py-1 w-[100px] sm:w-[150px]",
      button: "p-1",
      icon: 10,
      modalInput: "text-[8px] sm:text-[9px] px-2 py-1 w-full",
      modalResult: "text-[8px]",
      image: "w-4 h-4",
    },
    default: {
      input: "text-[9px] sm:text-[10px] px-3 py-1.5 w-[120px] sm:w-[200px]",
      button: "p-1",
      icon: 12,
      modalInput: "text-[9px] sm:text-[10px] px-3 py-1.5 w-full",
      modalResult: "text-[9px]",
      image: "w-5 h-5",
    },
    large: {
      input: "text-[10px] sm:text-[12px] px-4 py-2 w-[150px] sm:w-[250px]",
      button: "p-2",
      icon: 14,
      modalInput: "text-[10px] sm:text-[12px] px-4 py-2 w-full",
      modalResult: "text-[10px]",
      image: "w-6 h-6",
    },
  };

  const config = sizeConfig[size];

  // SWR fetcher
  const fetcher = async (url) => {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch");
    return response.json();
  };

  // SWR for nametags, exchanges, and clusters
  const { data: nametagData, error: nametagError, isLoading: isLoadingNametags } = useSWR(
    searchQuery.trim() ? `/api/search-nametags?query=${encodeURIComponent(searchQuery)}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000, refreshInterval: 300000 },
  );

  const { data: exchangeData, error: exchangeError, isLoading: isLoadingExchanges } = useSWR(
    searchQuery.trim() ? `/api/coingecko?action=exchange-search&query=${encodeURIComponent(searchQuery)}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000, refreshInterval: 300000 },
  );

  const { data: clusterData, error: clusterError, isLoading: isLoadingClusters } = useSWR(
    searchQuery.trim() ? `/api/search-clusters?query=${encodeURIComponent(searchQuery)}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000, refreshInterval: 300000 },
  );

  // Handle click outside to close modal
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setIsModalOpen(false);
        setSearchQuery("");
        setSearchResults([]);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Validate Ethereum address
  const isValidAddress = (address) => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  // Predefined major organizations
  const majorOrganizations = [
    { id: "binance", name: "Binance", type: "organization", image: "/icons/binance.webp" },
    { id: "okex", name: "OKX", type: "organization", image: "/icons/okx.webp" },
    { id: "bybit_spot", name: "Bybit", type: "organization", image: "/icons/bybit.webp" },
    { id: "uniswap", name: "Uniswap", type: "organization", image: "/icons/uniswap.webp" },
    { id: "mtgox", name: "Mt. Gox", type: "organization", image: "/icons/mtgox.webp" },
    { id: "coinbase-exchange", name: "Coinbase", type: "organization", image: "/icons/coinbase.webp" },
    { id: "kraken", name: "Kraken", type: "organization", image: "/icons/kraken.webp" },
    { id: "bitfinex", name: "Bitfinex", type: "organization", image: "/icons/bitfinex.webp" },
    { id: "huobi-global", name: "Huobi", type: "organization", image: "/icons/huobi.webp" },
    { id: "kucoin", name: "KuCoin", type: "organization", image: "/icons/kucoin.webp" },
    { id: "gate-io", name: "Gate.io", type: "organization", image: "/icons/gateio.webp" },
  ];

  // Capitalize function
  const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

  // Process search results
  useEffect(() => {
    if (!isModalOpen) {
      setSearchResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(isLoadingNametags || isLoadingExchanges || isLoadingClusters);

    const results = [];

    // 1. Check if it's a valid wallet address
    if (isValidAddress(searchQuery)) {
      results.push({
        id: `wallet-${searchQuery}`,
        type: "wallet",
        address: searchQuery,
        name: `Wallet: ${searchQuery.slice(0, 6)}...${searchQuery.slice(-4)}`,
        image: "/icons/wallet.webp",
      });
    }

    // 2. Search major organizations
    const orgMatches = majorOrganizations.filter((org) =>
      org.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
    results.push(...orgMatches);

    // 3. Add nametag results
    if (nametagData?.success && nametagData.data) {
      results.push(
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
    }

    // 4. Add exchange results
    if (exchangeData?.data) {
      results.push(
        ...exchangeData.data.map((exchange) => ({
          id: `exchange-${exchange.id}`,
          type: "exchange",
          name: exchange.name,
          image: exchange.image,
          exchangeId: exchange.id,
        })),
      );
    }

    // 5. Add cluster results
    if (clusterData?.success && clusterData.data) {
      results.push(
        ...clusterData.data.map((cluster) => ({
          id: `cluster-${cluster.cluster_name}`,
          type: "organization",
          name: capitalize(cluster.cluster_name),
          image: cluster.image,
          exchangeId: cluster.cluster_name,
          holder_addresses: cluster.holder_addresses || [], // Thêm danh sách ví
        })),
      );
    }

    // Sort results: organizations first, then exchanges, nametags, wallets
    const sortedResults = results.sort((a, b) => {
      const typePriority = {
        organization: 1,
        exchange: 2,
        nametag: 3,
        wallet: 4,
      };
      const aTypeScore = typePriority[a.type] || 5;
      const bTypeScore = typePriority[b.type] || 5;
      if (aTypeScore !== bTypeScore) return aTypeScore - bTypeScore;

      const aScore = a.name.toLowerCase().indexOf(searchQuery.toLowerCase());
      const bScore = b.name.toLowerCase().indexOf(searchQuery.toLowerCase());
      if (aScore === -1 && bScore === -1) return 0;
      if (aScore === -1) return 1;
      if (bScore === -1) return -1;
      return aScore - bScore;
    });

    setSearchResults(sortedResults.slice(0, 10)); // Limit to 10 results

    console.log("Universal search results:", {
      query: searchQuery,
      resultCount: sortedResults.length,
      types: [...new Set(sortedResults.map((r) => r.type))],
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
  }, [searchQuery, nametagData, exchangeData, clusterData, isLoadingNametags, isLoadingExchanges, isLoadingClusters, nametagError, exchangeError, clusterError, isModalOpen]);

  // Handle result selection
  const handleResultSelect = (result) => {
    if (onSelect) {
      onSelect(result);
    }
    setSearchQuery("");
    setSearchResults([]);
    setIsModalOpen(false);
  };

  // Get icon for result type
  const getResultIcon = (type) => {
    switch (type) {
      case "wallet":
        return <Wallet size={config.icon} className="text-blue-400" />;
      case "nametag":
        return <Hash size={config.icon} className="text-green-400" />;
      case "organization":
      case "exchange":
        return <Building2 size={config.icon} className="text-purple-400" />;
      default:
        return <Search size={config.icon} className="text-gray-400" />;
    }
  };

  // Get result type label
  const getTypeLabel = (type) => {
    switch (type) {
      case "wallet":
        return "Wallet";
      case "nametag":
        return "Wallet";
      case "organization":
        return "Organization";
      case "exchange":
        return "Exchange";
      default:
        return "Unknown";
    }
  };

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
          aria-label="Search wallets, nametags, or exchanges"
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
              className="w-[90vw] sm:w-[50vw] h-[50vh] bg-black/90 backdrop-blur-sm border border-white/20 flex flex-col overflow-hidden rounded-xl"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <input
                  type="text"
                  placeholder={placeholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`text-white border-b-2 border-b-white/20 bg-black/5 backdrop-blur-xs focus:border-none ${config.modalInput}`}
                  aria-label="Search wallets, nametags, or exchanges"
                  autoFocus
                />
                <motion.button
                  onClick={() => {
                    setIsModalOpen(false);
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                  className="text-white/70 hover:bg-white/10 p-2 rounded-full transition-all duration-300"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  aria-label="Close search modal"
                >
                  <X size={config.icon} />
                </motion.button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 mobile-scroll">
                <div className="relative min-h-[100px]">
                  <LoadingOverlay isLoading={isLoading} isMobile={window.innerWidth <= 640} className="z-[60]" />
                  {searchResults.length > 0 ? (
                    searchResults.map((result) => (
                      <motion.button
                        key={result.id}
                        onClick={() => handleResultSelect(result)}
                        className={`flex items-center w-full text-left px-3 py-2 hover:bg-white/10 text-white transition-all duration-300 border-b border-white/5 last:border-b-0 ${config.modalResult}`}
                        whileHover={{ x: 4 }}
                        role="option"
                        aria-selected={false}
                      >
                        <div className="flex items-center mr-2">
                          {result.image ? (
                            <img
                              src={result.image || "/placeholder.svg"}
                              alt={`${result.name} logo`}
                              className={`rounded-full mr-2 ${config.image}`}
                              onError={(e) => {
                                e.target.style.display = "none";
                                e.target.nextSibling.style.display = "flex";
                              }}
                            />
                          ) : null}
                          <div
                            className="flex items-center justify-center mr-2"
                            style={{ display: result.image ? "none" : "flex" }}
                          >
                            {getResultIcon(result.type)}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{result.name}</span>
                            <span className="text-10px sm:text-[11px] text-white/50 bg-white/10 px-1 py-0.5 rounded">
                              {getTypeLabel(result.type)}
                            </span>
                          </div>
                          {result.address && (
                            <div className="text-xs text-white/40 font-mono truncate mt-0.5">{result.address}</div>
                          )}
                          {result.holder_addresses && result.holder_addresses.length > 0 && (
                            <div className="text-xs text-white/40 truncate mt-0.5">
                              {result.holder_addresses.length} wallets
                            </div>
                          )}
                        </div>
                      </motion.button>
                    ))
                  ) : !isLoading ? (
                    <p className="text-[10px] text-white/60 text-center mt-4">No results found.</p>
                  ) : null}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx>{`
        .shadow-neon-lg {
          box-shadow: 0 0 12px rgba(0, 191, 255, 0.4), 0 0 24px rgba(0, 191, 255, 0.2);
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