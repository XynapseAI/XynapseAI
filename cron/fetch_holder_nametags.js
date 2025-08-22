// cron/fetch_holder_nametags.js
import cron from "node-cron";
import axios from "axios";
import { Pool } from "pg";
import { createClient } from "redis";
import Bottleneck from "bottleneck";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("sslmode=require") ? { rejectUnauthorized: false } : false,
  max: 40,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Redis connection
const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.on("error", (err) => console.error("Redis Client Error", err));

// Rate limiters
const coingeckoLimiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 1500,
});

const simLimiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 2000,
});

// Supported EVM chains for SIM API
const SUPPORTED_CHAINS = [
  "ethereum",
  "bsc",
  "polygon",
  "avalanche",
  "fantom",
  "arbitrum",
  "optimism",
  "base",
  "linea",
  "scroll",
  "zksync",
  "polygon-zkevm",
  "mantle",
];

// Additional chains for nameTag lookup
const NAME_TAG_CHAINS = ["kyberswap", "uniswap"];

// Non-EVM chains for Blockchair API
const NON_EVM_CHAINS = ["bitcoin", "dogecoin"];

// Fixed decimals for non-EVM chains
const NON_EVM_DECIMALS = {
  bitcoin: 8,
  dogecoin: 8,
};

class TokenHoldersCron {
  constructor() {
    this.isRunning = false;
    this.currentBatch = 0;
    this.totalTokens = 0;
    this.nameTags = new Map();
    this.nameTagData = new Map();
    this.holdersWithNameTags = new Map();
  }

  mapNameTagToName(nameTag) {
    if (!nameTag) return null;
    const lowerTag = nameTag.toLowerCase();
    const words = lowerTag.split(/[\s:-]+/);
    return words[0] ? words[0].trim() : nameTag;
  }

  async initialize() {
    let retries = 3;
    while (retries > 0) {
      try {
        await redisClient.connect();
        await pool.connect().then((client) => client.release());
        await this.createTables();
        await this.loadNameTags();
        return;
      } catch (error) {
        retries--;
        console.error(`❌ Initialization attempt failed (${retries} retries left):`, error.message);
        if (retries === 0) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  async loadNameTags() {
    try {
      const nametagsDir = join(__dirname, "..", "public", "nametags");
      const files = await fs.readdir(nametagsDir);
      const jsonFiles = files.filter((file) => file.endsWith(".json"));

      for (const file of jsonFiles) {
        const filePath = join(nametagsDir, file);
        const data = await fs.readFile(filePath, "utf-8");
        const jsonData = JSON.parse(data);

        for (const [address, info] of Object.entries(jsonData)) {
          const labels = info.Labels || {};
          const chainKeys = Object.keys(labels);
          for (const chainKey of chainKeys) {
            const nameTag = labels[chainKey]?.["Name Tag"] || null;
            const image = labels[chainKey]?.["image"] || null;
            if (nameTag) {
              const key = address.toLowerCase();
              const existing = this.nameTagData.get(key) || [];
              existing.push({ chain: chainKey, nameTag, image });
              this.nameTagData.set(key, existing);
            }
          }
        }
      }
    } catch (error) {
      console.error("❌ Error reading nametags directory:", error.message);
    }
  }

  async createTables() {
    const createTokensTable = `
      CREATE TABLE IF NOT EXISTS tokens (
        id SERIAL PRIMARY KEY,
        coingecko_id VARCHAR(255) UNIQUE NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        market_cap_rank INTEGER,
        platforms JSONB,
        detail_platforms JSONB,
        decimals INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const createHoldersTable = `
      CREATE TABLE IF NOT EXISTS token_holders (
        id SERIAL PRIMARY KEY,
        token_id INTEGER REFERENCES tokens(id) ON DELETE CASCADE,
        coingecko_id VARCHAR(255) NOT NULL,
        chain VARCHAR(50) NOT NULL,
        token_address VARCHAR(255),
        holder_address VARCHAR(255) NOT NULL,
        balance DECIMAL(36, 18),
        balance_usd DECIMAL(20, 2),
        percentage DECIMAL(10, 6),
        name_tag VARCHAR(255),
        name VARCHAR(255),
        image VARCHAR(255),
        rank INTEGER,
        source VARCHAR(50) DEFAULT 'sim',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(coingecko_id, chain, holder_address)
      );
    `;

    const createWalletHoldersTable = `
      CREATE TABLE IF NOT EXISTS wallet_holders (
        id SERIAL PRIMARY KEY,
        exchange_name VARCHAR(100) NOT NULL,
        chain VARCHAR(50) NOT NULL,
        holder_address VARCHAR(255) NOT NULL,
        total_value_usd DECIMAL(20, 2),
        token_count INTEGER,
        metadata JSONB,
        name_tag VARCHAR(255),
        image VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(exchange_name, chain, holder_address)
      );
    `;

    const createIndexes = `
      CREATE INDEX IF NOT EXISTS idx_tokens_coingecko_id ON tokens(coingecko_id);
      CREATE INDEX IF NOT EXISTS idx_holders_token_chain ON token_holders(coingecko_id, chain);
      CREATE INDEX IF NOT EXISTS idx_holders_created_at ON token_holders(created_at);
      CREATE INDEX IF NOT EXISTS idx_holders_name ON token_holders(name);
      CREATE INDEX IF NOT EXISTS idx_holders_image ON token_holders(image);
      CREATE INDEX IF NOT EXISTS idx_holders_updated_at ON token_holders(updated_at);
      CREATE INDEX IF NOT EXISTS idx_wallet_holders_exchange_name ON wallet_holders(exchange_name);
      CREATE INDEX IF NOT EXISTS idx_wallet_holders_chain ON wallet_holders(chain);
    `;

    try {
      await pool.query(createTokensTable);
      await pool.query(createHoldersTable);
      await pool.query(createWalletHoldersTable);
      await pool.query(createIndexes);
    } catch (error) {
      console.error("❌ Error creating tables or indexes:", error.message);
      throw error;
    }
  }

  async fetchTokensFromCoinGecko() {
    const tokens = [];
    const perPage = 250;
    const pages = Math.ceil(500 / perPage);

    try {
      for (let page = 1; page <= pages; page++) {
        const response = await coingeckoLimiter.schedule(() =>
          axios.get("https://api.coingecko.com/api/v3/coins/markets", {
            params: {
              vs_currency: "usd",
              order: "market_cap_desc",
              per_page: perPage,
              page: page,
              sparkline: false,
              price_change_percentage: "24h",
            },
            headers: {
              "x-cg-demo-api-key": process.env.COINGECKO_API_KEY || "",
            },
            timeout: 30000,
          })
        );

        const pageTokens = response.data;
        if (!Array.isArray(pageTokens) || pageTokens.length === 0) {
          continue;
        }
        tokens.push(...pageTokens);
      }

      if (tokens.length === 0) {
        throw new Error("No valid token data from CoinGecko");
      }

      await this.storeTokens(tokens);
      return tokens;
    } catch (error) {
      console.error("❌ Error fetching tokens from CoinGecko:", error.message);
      throw error;
    }
  }

  async storeTokens(tokens) {
    let storedCount = 0;

    for (const token of tokens) {
      try {
        const detailResponse = await coingeckoLimiter.schedule(() =>
          axios.get(`https://api.coingecko.com/api/v3/coins/${token.id}`, {
            headers: {
              "x-cg-demo-api-key": process.env.COINGECKO_API_KEY || "",
            },
            timeout: 15000,
          })
        );

        const detailData = detailResponse.data;
        if (!detailData?.id) {
          continue;
        }

        const decimals = detailData.contract_address
          ? detailData.detail_platforms?.ethereum?.decimal_place || 18
          : NON_EVM_DECIMALS[token.id] || 18;

        await pool.query(
          `
          INSERT INTO tokens (coingecko_id, symbol, name, market_cap_rank, platforms, detail_platforms, decimals, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
          ON CONFLICT (coingecko_id) 
          DO UPDATE SET 
            symbol = EXCLUDED.symbol,
            name = EXCLUDED.name,
            market_cap_rank = EXCLUDED.market_cap_rank,
            platforms = EXCLUDED.platforms,
            detail_platforms = EXCLUDED.detail_platforms,
            decimals = EXCLUDED.decimals,
            updated_at = CURRENT_TIMESTAMP
          `,
          [
            token.id,
            token.symbol,
            token.name,
            token.market_cap_rank,
            JSON.stringify(detailData.platforms || {}),
            JSON.stringify(detailData.detail_platforms || {}),
            decimals,
          ]
        );

        storedCount++;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Error storing token ${token.id}:`, error.message);
        continue;
      }
    }
  }

  async processTokenHolders() {
    try {
      const tokensResult = await pool.query(`
        SELECT * FROM tokens 
        ORDER BY market_cap_rank ASC NULLS LAST
      `);

      const tokens = tokensResult.rows;
      this.totalTokens = tokens.length;

      for (let i = 0; i < tokens.length; i++) {
        if (!this.isRunning) {
          break;
        }

        const token = tokens[i];
        this.currentBatch = i + 1;

        try {
          await this.processTokenOnAllChains(token);
        } catch (error) {
          console.error(`❌ Error processing token ${token.coingecko_id}:`, error.message);
        }

        await new Promise((resolve) => setTimeout(resolve, 15000));
      }

      await this.processWalletBalances();
    } catch (error) {
      console.error("❌ Error in token holders processing:", error.message);
      throw error;
    }
  }

  async processTokenOnAllChains(token) {
    const platforms = token.detail_platforms || {};
    const supportedPlatforms = Object.keys(platforms).filter(
      (chain) =>
        SUPPORTED_CHAINS.includes(chain) &&
        platforms[chain]?.contract_address?.match(/^0x[a-fA-F0-9]{40}$/)
    );

    if (["bitcoin", "dogecoin"].includes(token.coingecko_id)) {
      const chain = token.coingecko_id;
      await this.processTreasuryData(token);
      const blockchairHolders = await this.fetchBlockchairHolders(token, chain);
      if (blockchairHolders.length > 0) {
        await this.storeHolders(token, chain, null, blockchairHolders);
      }
      return;
    }

    for (const chain of supportedPlatforms) {
      try {
        const tokenAddress = platforms[chain].contract_address;
        await this.fetchAndStoreHolders(token, chain, tokenAddress);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`❌ Error processing ${token.symbol} on ${chain}:`, error.message);
        continue;
      }
    }
  }

  async processTreasuryData(token) {
    try {
      const response = await coingeckoLimiter.schedule(() =>
        axios.get(`https://api.coingecko.com/api/v3/companies/public_treasury/${token.coingecko_id}`, {
          headers: {
            "x-cg-demo-api-key": process.env.COINGECKO_API_KEY || "",
          },
          timeout: 15000,
        })
      );

      if (response.data?.companies && Array.isArray(response.data.companies)) {
        const decimals = NON_EVM_DECIMALS[token.coingecko_id] || 8;
        const holders = response.data.companies
          .map((company, index) => {
            const tagData = company.address
              ? this.nameTagData.get(company.address.toLowerCase())?.[0] || {}
              : {};
            const nameTag = tagData.nameTag || company.name || null;
            const image = tagData.image || null;
            if (!nameTag) return null;

            const name = this.mapNameTagToName(nameTag);
            const rawBalance = Number.parseFloat(company.total_holdings) || 0;
            const balance = decimals > 6 ? rawBalance / Math.pow(10, decimals - 6) : rawBalance;

            return {
              holder_address: company.address || company.name || `company_${index}`,
              balance: balance,
              balance_usd: Number.parseFloat(company.total_value_usd) || 0,
              percentage: 0,
              name_tag: nameTag,
              name: name,
              image: image,
              rank: index + 1,
              source: "coingecko_treasury",
            };
          })
          .filter((holder) => holder !== null && holder.name_tag !== null);

        if (holders.length > 0) {
          await this.storeHolders(token, token.coingecko_id, null, holders);
        }
      }
    } catch (error) {
      if (error.response?.status !== 404) {
        console.error(`❌ Error fetching treasury data for ${token.coingecko_id}:`, error.message);
      }
    }
  }

  async fetchBlockchairHolders(token, chain) {
    try {
      const decimals = NON_EVM_DECIMALS[token.coingecko_id] || 8;

      const response = await coingeckoLimiter.schedule(() =>
        axios.post(
          `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000"}/api/blockchair`,
          {
            chain: chain,
            limit: 100,
          },
          {
            headers: {
              "Content-Type": "application/json",
            },
            timeout: 30000,
          }
        )
      );

      if (!response.data?.success || !Array.isArray(response.data.data)) {
        return [];
      }

      const priceResponse = await coingeckoLimiter.schedule(() =>
        axios.get(`https://api.coingecko.com/api/v3/coins/${token.coingecko_id}`, {
          headers: {
            "x-cg-demo-api-key": process.env.COINGECKO_API_KEY || "",
          },
          timeout: 15000,
        })
      );
      const priceUsd = Number.parseFloat(priceResponse.data.market_data.current_price.usd) || 0;
      const totalSupply = Number.parseFloat(priceResponse.data.market_data.total_supply) || 0;

      const holders = response.data.data
        .map((holder, index) => {
          const tagData = this.nameTagData.get(holder.address.toLowerCase())?.[0] || {};
          const nameTag = tagData.nameTag || null;
          const image = tagData.image || null;
          if (!nameTag) return null;

          const name = this.mapNameTagToName(nameTag);
          const balance = Number(holder.balance) || 0;
          const balance_usd = balance * priceUsd;
          const percentage = totalSupply > 0 ? (balance / totalSupply) * 100 : holder.share || 0;

          return {
            holder_address: holder.address,
            balance: balance,
            balance_usd: balance_usd,
            percentage: percentage,
            name_tag: nameTag,
            name: name,
            image: image,
            rank: index + 1,
            source: "blockchair",
          };
        })
        .filter((holder) => holder !== null && holder.name_tag !== null);

      return holders;
    } catch (error) {
      console.error(`❌ Error fetching Blockchair holders for ${token.symbol} on ${chain}:`, error.message);
      return [];
    }
  }

  async fetchAndStoreHolders(token, chain, tokenAddress) {
    const cacheKey = `sim_top_holders:${token.coingecko_id}:${chain}`;
    try {
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        const holders = JSON.parse(cachedData);
        if (holders.length > 0) {
          await this.storeHolders(token, chain, tokenAddress, holders);
        }
        return;
      }

      const decimals = token.detail_platforms?.[chain]?.decimal_place ?? token.decimals ?? 18;

      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          const response = await simLimiter.schedule(() =>
            axios.post(
              `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000"}/api/sim`,
              {
                action: "top-holders",
                chain: chain,
                tokenAddress: tokenAddress,
                limit: 100,
                decimalPlace: decimals,
              },
              {
                headers: {
                  "Content-Type": "application/json",
                  Authorization: process.env.SIM_API_KEY ? `Bearer ${process.env.SIM_API_KEY}` : undefined,
                },
                timeout: 30000,
              }
            )
          );

          if (!response.data?.success || !Array.isArray(response.data.data)) {
            return;
          }

          const totalSupplyResponse = await coingeckoLimiter.schedule(() =>
            axios.get(`https://api.coingecko.com/api/v3/coins/${token.coingecko_id}`, {
              headers: {
                "x-cg-demo-api-key": process.env.COINGECKO_API_KEY || "",
              },
              timeout: 15000,
            })
          );
          const totalSupply = Number.parseFloat(totalSupplyResponse.data.market_data.total_supply) || 0;
          const priceUsd = Number.parseFloat(totalSupplyResponse.data.market_data.current_price.usd) || 0;

          const holders = response.data.data
            .map((holder, index) => {
              const tagDataArray = this.nameTagData.get(holder.address.toLowerCase()) || [];
              let nameTag = null;
              let image = null;

              for (const tagData of tagDataArray) {
                if (tagData.nameTag) {
                  nameTag = tagData.nameTag;
                  image = tagData.image || null;
                  break;
                }
              }

              if (!nameTag) return null;

              const name = this.mapNameTagToName(nameTag);
              const calculatedBalance = Number(holder.balance) || 0;
              const balance_usd = calculatedBalance * priceUsd;
              const percentage = totalSupply > 0 ? (calculatedBalance / totalSupply) * 100 : 0;

              const holderKey = `${chain}:${holder.address.toLowerCase()}`;
              this.holdersWithNameTags.set(holderKey, {
                holder_address: holder.address,
                exchange_name: name,
                chain,
                name_tag: nameTag,
                image,
              });

              return {
                holder_address: holder.address,
                balance: calculatedBalance,
                balance_usd: balance_usd,
                percentage: percentage,
                name_tag: nameTag,
                name: name,
                image: image,
                rank: index + 1,
                source: "sim",
              };
            })
            .filter((holder) => holder !== null);

          if (holders.length > 0) {
            await redisClient.setEx(cacheKey, 86400, JSON.stringify(holders));
            await this.storeHolders(token, chain, tokenAddress, holders);
          }
          return;
        } catch (error) {
          if (error.response?.status === 429 && attempts < maxAttempts - 1) {
            const waitTime = (attempts + 1) * 5000;
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            attempts++;
            continue;
          }
          console.error(`❌ Error fetching holders for ${token.symbol} on ${chain}:`, error.message);
          return;
        }
      }
    } catch (error) {
      console.error(`❌ Failed after retries for ${token.symbol} on ${chain}:`, error.message);
    }
  }

  async processWalletBalances() {
    const processedWallets = new Set();

    const IMPORTANT_TOKENS = [
      { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", chain: "ethereum", decimals: 6 },
      { address: "0x55d398326f99059ff775485246999027b3197955", symbol: "USDT", chain: "bsc", decimals: 18 },
      { address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", symbol: "USDT", chain: "polygon", decimals: 6 },
      { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", chain: "ethereum", decimals: 6 },
      { address: "native", symbol: "ETH", chain: "ethereum", decimals: 18 },
      { address: "0xB8c77482e45F1F44dE1745F52C74426C631bDD52", symbol: "BNB", chain: "bsc", decimals: 18 },
      { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", symbol: "WBTC", chain: "ethereum", decimals: 8 },
    ];

    const isValidLogo = (logo) => {
      if (typeof logo !== "string" || logo === "") return false;
      return /^\/[a-zA-Z0-9-_]+\.(png|jpg|jpeg|svg|webp)$/.test(logo) || /^https?:\/\/.+/.test(logo);
    };

    for (const [holderKey, holderData] of this.holdersWithNameTags) {
      if (processedWallets.has(holderKey)) continue;

      const { holder_address, exchange_name, chain, name_tag, image } = holderData;
      const cacheKey = `sim_wallet_balances:${holder_address}:${chain}`;

      try {
        let allTokens = [];
        let nextOffset = null;
        let attempts = 0;
        const maxAttempts = 5;

        do {
          try {
            const response = await simLimiter.schedule(() =>
              axios.post(
                `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000"}/api/sim`,
                {
                  action: "wallet-balances",
                  address: holder_address,
                  chain: chain,
                  limit: 2000,
                  minValueUsd: 100,
                  offset: nextOffset,
                },
                {
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: process.env.SIM_API_KEY ? `Bearer ${process.env.SIM_API_KEY}` : undefined,
                  },
                  timeout: 45000,
                }
              )
            );

            if (!response.data?.success || !Array.isArray(response.data.data)) {
              break;
            }

            allTokens.push(...response.data.data);
            nextOffset = response.data.next_offset || null;
          } catch (error) {
            if (error.response?.status === 429 && attempts < maxAttempts - 1) {
              const waitTime = (attempts + 1) * 10000;
              await new Promise((resolve) => setTimeout(resolve, waitTime));
              attempts++;
              continue;
            }
            console.error(`❌ Error fetching wallet balances for ${holder_address} on ${chain}:`, error.message);
            break;
          }
        } while (nextOffset);

        if (allTokens.length === 0) {
          continue;
        }

        const filteredTokens = allTokens
          .filter((token) => {
            const isImportantToken = IMPORTANT_TOKENS.some(
              (impToken) =>
                impToken.chain === token.chain &&
                (impToken.address === "native"
                  ? token.address === "native"
                  : impToken.address.toLowerCase() === token.address.toLowerCase())
            );

            if (token.value_usd > 50_000_000_000 && !isImportantToken) {
              return false;
            }

            if (token.value_usd === 0 && !isImportantToken) {
              return false;
            }

            const hasValidLogo = isValidLogo(token.logo);
            const hasLowLiquidity = token.low_liquidity === true;
            if (!isImportantToken && (!hasValidLogo || hasLowLiquidity)) {
              return false;
            }

            return true;
          })
          .sort((a, b) => b.value_usd - a.value_usd)
          .slice(0, 500);

        if (filteredTokens.length === 0) {
          continue;
        }

        const totalValueUsd = filteredTokens.reduce((sum, token) => sum + (Number(token.value_usd) || 0), 0);
        const tokenCount = filteredTokens.length;

        const metadata = filteredTokens.map((token) => ({
          token_address: token.address,
          symbol: token.symbol,
          balance: Number(token.amount) || 0,
          balance_usd: Number(token.value_usd) || 0,
          decimals: token.decimals || 18,
          name: token.name || "Unknown",
          logo: token.logo || null,
          chain: token.chain,
        }));

        await redisClient.setEx(
          cacheKey,
          86400,
          JSON.stringify({ total_value_usd: totalValueUsd, token_count: tokenCount, metadata })
        );

        await this.storeWalletHolders({
          exchange_name,
          chain,
          holder_address,
          total_value_usd: TotalValueUsd,
          token_count: tokenCount,
          metadata,
          name_tag,
          image,
        });

        processedWallets.add(holderKey);
      } catch (error) {
        console.error(`❌ Failed after retries for wallet ${holder_address} on ${chain}:`, error.message);
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  async storeWalletHolders(walletData) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const {
        exchange_name,
        chain,
        holder_address,
        total_value_usd,
        token_count,
        metadata,
        name_tag,
        image,
      } = walletData;

      await client.query(
        `
        INSERT INTO wallet_holders (
          exchange_name, chain, holder_address, total_value_usd, token_count, 
          metadata, name_tag, image, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        ON CONFLICT (exchange_name, chain, holder_address)
        DO UPDATE SET
          total_value_usd = EXCLUDED.total_value_usd,
          token_count = EXCLUDED.token_count,
          metadata = EXCLUDED.metadata,
          name_tag = EXCLUDED.name_tag,
          image = EXCLUDED.image,
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          exchange_name,
          chain,
          holder_address,
          total_value_usd,
          token_count,
          JSON.stringify(metadata),
          name_tag,
          image,
        ]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`❌ Error storing wallet holder ${walletData.holder_address}:`, error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  async storeHolders(token, chain, tokenAddress, holders) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      let insertedCount = 0;
      let updatedCount = 0;

      for (const holder of holders) {
        try {
          const result = await client.query(
            `
            INSERT INTO token_holders (
              token_id, coingecko_id, chain, token_address, holder_address, 
              balance, balance_usd, percentage, name_tag, name, image, rank, source
            ) VALUES (
              (SELECT id FROM tokens WHERE coingecko_id = $1),
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
            )
            ON CONFLICT (coingecko_id, chain, holder_address) 
            DO UPDATE SET
              balance = EXCLUDED.balance,
              balance_usd = EXCLUDED.balance_usd,
              percentage = EXCLUDED.percentage,
              name_tag = EXCLUDED.name_tag,
              name = EXCLUDED.name,
              image = EXCLUDED.image,
              rank = EXCLUDED.rank,
              source = EXCLUDED.source,
              created_at = CASE 
                WHEN token_holders.created_at IS NULL THEN CURRENT_TIMESTAMP 
                ELSE token_holders.created_at 
              END,
              updated_at = CURRENT_TIMESTAMP
            RETURNING id, (xmax = 0) AS is_inserted
            `,
            [
              token.coingecko_id,
              chain,
              tokenAddress,
              holder.holder_address,
              holder.balance,
              holder.balance_usd,
              holder.percentage,
              holder.name_tag,
              holder.name,
              holder.image,
              holder.rank,
              holder.source,
            ]
          );

          if (result.rows[0].is_inserted) {
            insertedCount++;
          } else {
            updatedCount++;
          }
        } catch (error) {
          console.error(`❌ Error storing holder ${holder.holder_address}:`, error.message);
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`❌ Transaction rollback for ${token.symbol} on ${chain}:`, error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  async runFullCycle() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.holdersWithNameTags.clear();
    const startTime = new Date();
    let errors = [];

    try {
      await this.fetchTokensFromCoinGecko();
      await this.processTokenHolders();

      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000 / 60);
      console.log(`✅ Full sync completed in ${duration} minutes`);
    } catch (error) {
      errors.push({ message: error.message });
      console.error("❌ Full sync failed:", error.message);
      throw error;
    } finally {
      this.isRunning = false;
      this.currentBatch = 0;
      this.totalTokens = 0;
      this.holdersWithNameTags.clear();
    }
  }

  startCronJob() {
    cron.schedule(
      "0 2 */5 * *",
      async () => {
        await this.runFullCycle();
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    setTimeout(async () => {
      try {
        await this.runFullCycle();
      } catch (error) {
        console.error("❌ Initial sync failed:", error.message);
      }
    }, 5000);

    process.on("uncaughtException", (err) => {
      console.error("Uncaught Exception:", err.message);
    });
    process.on("unhandledRejection", (reason) => {
      console.error("Unhandled Rejection:", reason);
    });
  }

  async getStatus() {
    return {
      isRunning: this.isRunning,
      currentBatch: this.currentBatch,
      totalTokens: this.totalTokens,
      progress: this.totalTokens > 0 ? Math.round((this.currentBatch / this.totalTokens) * 100) : 0,
    };
  }

  async cleanup() {
    try {
      await redisClient.quit();
      await pool.end();
    } catch (error) {
      console.error("❌ Cleanup error:", error.message);
    }
  }
}

async function main() {
  const cronJob = new TokenHoldersCron();

  try {
    await cronJob.initialize();
    cronJob.startCronJob();

    process.on("SIGINT", async () => {
      await cronJob.cleanup();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await cronJob.cleanup();
      process.exit(0);
    });
  } catch (error) {
    console.error("❌ Failed to start cron job:", error.message);
    process.exit(1);
  }
}

main().catch(console.error);