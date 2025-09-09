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
import { logger } from "../utils/serverLogger.js";
import { PrismaClient } from "@prisma/client";

// --- Khởi tạo Prisma Client ---
const prisma = new PrismaClient({
  log: ["error"], // Chỉ log lỗi để giảm output
});

// --- Load environment variables ---
dotenv.config();

// --- Định nghĩa __dirname và __filename cho ES Modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Database connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("sslmode=require") ? { rejectUnauthorized: false } : false,
  max: 40,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// --- Redis connection ---
const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.on("error", (err) => logger.error("Redis Client Error", { message: err.message }));

// --- Rate limiters ---
const coingeckoLimiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 2000,
});

const simLimiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 2000,
});

// --- Supported EVM chains ---
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

const CHAIN_MAPPING = {
  bnb: "bsc",
  ethereum: "ethereum",
};

// --- Important tokens ---
const IMPORTANT_TOKENS = [
  { chain: "ethereum", address: "native" },
  { chain: "bsc", address: "native" },
  { chain: "ethereum", address: "0xdac17f958d2ee523a2206206994597c13d831ec7" }, // USDT on Ethereum
  { chain: "bsc", address: "0x55d398326f99059ff775485246999027b3197955" }, // USDT on BSC
];

const ALLOWED_TOKENS = [
];

const BLOCKED_TOKEN_ADDRESSES = [
  "0x7d25d9f10cd224ecce0bc824a2ec800db81c01d7",
];

// --- Non-EVM chains ---
const NON_EVM_CHAINS = ["bitcoin", "dogecoin", "litecoin"];

// --- Fixed decimals for non-EVM chains ---
const NON_EVM_DECIMALS = {
  bitcoin: 8,
  dogecoin: 8,
  litecoin: 8,
};

// --- Map non-EVM chains to their JSON files ---
const NON_EVM_JSON_FILES = {
  bitcoin: "bitcoin-top-holders.json",
  dogecoin: "dogecoin-top-holders.json",
  litecoin: "litecoin-top-holders.json",
};

// --- Map token coingecko_id to JSON files for EVM chains ---
const EVM_JSON_FILES = {
  ethereum: "eth-top-holders.json",
  binancecoin: "bnb-top-holders.json",
};

// --- Additional chains for nameTag lookup ---
const NAME_TAG_CHAINS = ["kyberswap", "uniswap"];

// --- Utility: Validate logo ---
function isValidLogo(logo) {
  return logo && typeof logo === "string" && logo.startsWith("http");
}

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
    return nameTag || "Unknown";
  }

  async initialize() {
    let retries = 3;
    while (retries > 0) {
      try {
        await redisClient.connect();
        logger.info("Redis connected successfully");

        const client = await pool.connect();
        client.release();
        logger.info("PostgreSQL connected successfully");

        await this.createTables();
        logger.info("Database tables initialized");

        await this.loadNameTags();
        logger.info("Name tags loaded successfully");
        return;
      } catch (error) {
        retries--;
        logger.error(`Initialization attempt failed (${retries} retries left)`, {
          message: error.message,
          stack: error.stack,
        });
        if (retries === 0) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  async loadNameTags() {
    logger.info("Loading name tags and images from public/nametags directory...");
    this.nameTagData = new Map();
    const chainMapping = {
      "binance-smart-chain": "bsc",
      ethereum: "ethereum",
    };

    try {
      const nametagsDir = join(__dirname, "..", "public", "nametags");
      const files = await fs.readdir(nametagsDir);
      const jsonFiles = files.filter((file) => file.endsWith(".json"));

      for (const file of jsonFiles) {
        try {
          const filePath = join(nametagsDir, file);
          const data = await fs.readFile(filePath, "utf-8");
          const jsonData = JSON.parse(data);

          for (const [address, info] of Object.entries(jsonData)) {
            const labels = info.Labels || {};
            const chainKeys = Object.keys(labels);
            for (const chainKey of chainKeys) {
              const mappedChain = chainMapping[chainKey] || chainKey;
              const nameTag = labels[chainKey]?.["Name Tag"] || null;
              const image = labels[chainKey]?.["image"] || null;
              if (nameTag) {
                const key = address.toLowerCase();
                const existing = this.nameTagData.get(key) || [];
                existing.push({ chain: mappedChain, nameTag, image });
                this.nameTagData.set(key, existing);
              }
            }
          }
          logger.info(`Loaded name tags from ${file}`, { addressCount: Object.keys(jsonData).length });
        } catch (error) {
          logger.error(`Error loading name tags from ${file}`, { message: error.message });
        }
      }
      logger.info("Total addresses with name tags loaded", { count: this.nameTagData.size });
    } catch (error) {
      logger.error("Error reading nametags directory", { message: error.message });
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
      image VARCHAR(255),  -- Thêm cột image
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
      logger.info("Creating database tables and indexes...");
      await pool.query(createTokensTable);
      await pool.query(createHoldersTable);
      await pool.query(createWalletHoldersTable);
      await pool.query(createIndexes);
      logger.info("Database tables and indexes created or already exist");
    } catch (error) {
      logger.error("Error creating tables or indexes", {
        message: error.message,
        detail: error.detail,
        code: error.code,
      });
      throw error;
    }
  }

  async fetchTokensFromCoinGecko() {
    logger.info("Fetching exactly 500 tokens from CoinGecko...");
    const tokens = [];
    const totalTokens = 500;
    const perPageOptions = [250, 250];
    const pages = perPageOptions.length;

    try {
      for (let page = 1; page <= pages; page++) {
        const perPage = perPageOptions[page - 1];
        logger.info(`Fetching page ${page} of ${pages} with ${perPage} tokens...`);
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
          logger.warn(`Page ${page} returned invalid or empty data`);
          continue;
        }

        // Thêm trường image vào dữ liệu token
        tokens.push(...pageTokens.map(token => ({
          ...token,
          image: token.image || null // Lấy trường image từ API response
        })));
        logger.info(`Fetched ${pageTokens.length} tokens from page ${page}`);

        if (tokens.length >= totalTokens) {
          tokens.length = totalTokens;
          break;
        }
      }

      if (tokens.length === 0) {
        logger.error("CoinGecko returned no valid token data");
        throw new Error("No valid token data from CoinGecko");
      }

      logger.info("Fetched tokens from CoinGecko", { total: tokens.length });
      await this.storeTokens(tokens);
      return tokens;
    } catch (error) {
      logger.error("Error fetching tokens from CoinGecko", {
        message: error.message,
        status: error.response?.status,
      });
      throw error;
    }
  }

  // Cập nhật hàm storeTokens để lưu trường image
  async storeTokens(tokens) {
    logger.info("Storing tokens in database", { count: tokens.length });
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
          logger.warn(`Skipping token ${token.id}: Invalid detail data`);
          continue;
        }

        const decimals = detailData.contract_address
          ? detailData.detail_platforms?.ethereum?.decimal_place || 18
          : NON_EVM_DECIMALS[token.id] || 18;

        const result = await pool.query(
          `
        INSERT INTO tokens (coingecko_id, symbol, name, market_cap_rank, platforms, detail_platforms, decimals, image, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        ON CONFLICT (coingecko_id) 
        DO UPDATE SET 
          symbol = EXCLUDED.symbol,
          name = EXCLUDED.name,
          market_cap_rank = EXCLUDED.market_cap_rank,
          platforms = EXCLUDED.platforms,
          detail_platforms = EXCLUDED.detail_platforms,
          decimals = EXCLUDED.decimals,
          image = EXCLUDED.image,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id
        `,
          [
            token.id,
            token.symbol,
            token.name,
            token.market_cap_rank,
            JSON.stringify(detailData.platforms || {}),
            JSON.stringify(detailData.detail_platforms || {}),
            decimals,
            token.image || null, // Lưu trường image
          ]
        );

        storedCount++;
        logger.info(`Stored token ${token.id} (${token.symbol})`, { db_id: result.rows[0]?.id });
      } catch (error) {
        logger.error(`Error storing token ${token.id}`, {
          message: error.message,
          code: error.code,
        });
        continue;
      }
    }

    logger.info("Stored tokens successfully", { storedCount, total: tokens.length });
  }

  async processTokenHolders() {
    logger.info("Starting token holders processing...");
    try {
      const tokensResult = await pool.query(`
        SELECT * FROM tokens 
        ORDER BY market_cap_rank ASC NULLS LAST
      `);

      const tokens = tokensResult.rows;
      this.totalTokens = tokens.length;
      logger.info("Processing tokens", { total: this.totalTokens });

      const processedTokens = new Set();
      for (let i = 0; i < tokens.length; i++) {
        if (!this.isRunning) {
          logger.info("Processing stopped");
          break;
        }

        const token = tokens[i];
        const tokenKey = `${token.coingecko_id}`;
        if (processedTokens.has(tokenKey)) {
          logger.info(`Skipping already processed token ${token.name} (${token.symbol})`);
          continue;
        }

        this.currentBatch = i + 1;
        logger.info(`Processing token ${this.currentBatch}/${this.totalTokens}: ${token.name} (${token.symbol})`);

        try {
          const success = await this.processTokenOnAllChains(token);
          if (success) {
            processedTokens.add(tokenKey);
          }
        } catch (error) {
          logger.error(`Error processing token ${token.coingecko_id}`, { message: error.message });
        }

        logger.info("Waiting 10 seconds before next token...");
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }

      await this.processWalletBalances();
      logger.info("Token holders processing completed", { processedCount: processedTokens.size });
      return processedTokens.size;
    } catch (error) {
      logger.error("Error in token holders processing", { message: error.message });
      throw error;
    }
  }

  async processTokenOnAllChains(token) {
    const platforms = token.detail_platforms || {};
    let supportedPlatforms = Object.keys(platforms)
      .map((chain) => CHAIN_MAPPING[chain] || chain)
      .filter(
        (chain) =>
          SUPPORTED_CHAINS.includes(chain) &&
          platforms[chain]?.contract_address?.match(/^0x[a-fA-F0-9]{40}$/)
      );

    if (token.coingecko_id === "ethereum") {
      if (!supportedPlatforms.includes("ethereum")) {
        supportedPlatforms.push("ethereum");
      }
    }

    if (token.coingecko_id === "binancecoin") {
      if (!supportedPlatforms.includes("bsc")) {
        supportedPlatforms.push("bsc");
      }
    }

    logger.info(`Token ${token.symbol} supported on ${supportedPlatforms.length} EVM chains`);

    if (NON_EVM_CHAINS.includes(token.coingecko_id)) {
      await this.processTreasuryData(token);
      const chain = token.coingecko_id;
      const jsonHolders = await this.fetchJsonHolders(token, chain);
      if (jsonHolders.length > 0) {
        await this.storeHolders(token, chain, null, jsonHolders);
        logger.info(`Stored ${jsonHolders.length} JSON holders for ${token.symbol} on ${chain}`);
      }
      return true;
    }

    let processed = false;
    for (const chain of supportedPlatforms) {
      try {
        const tokenAddress = platforms[chain]?.contract_address || null;
        logger.info(`Fetching holders for ${token.symbol} on ${chain}`);
        const success = await this.fetchAndStoreHolders(token, chain, tokenAddress);
        if (success) {
          processed = true;
        }
      } catch (error) {
        logger.error(`Error processing ${token.symbol} on ${chain}`, {
          message: error.message,
          status: error.response?.status,
        });
      }
    }
    return processed;
  }

  async processTreasuryData(token) {
    logger.info(`Fetching treasury data for ${token.coingecko_id}...`);
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

            logger.info(`Treasury balance details for ${company.address || company.name}`, {
              nameTag,
              balance,
              balance_usd: company.total_value_usd,
            });

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

        if (holders.length === 0) {
          logger.info(`No holders with name tags for ${token.coingecko_id}`);
          return;
        }

        await this.storeHolders(token, token.coingecko_id, null, holders);
        logger.info(`Stored ${holders.length} treasury holders for ${token.coingecko_id}`);
      } else {
        logger.info(`No treasury data available for ${token.coingecko_id}`);
      }
    } catch (error) {
      if (error.response?.status === 404) {
        logger.info(`No treasury data available for ${token.coingecko_id}`);
      } else {
        logger.error(`Error fetching treasury data for ${token.coingecko_id}`, { message: error.message });
      }
    }
  }

  async fetchJsonHolders(token, chain) {
    logger.info(`Fetching holders for ${token.symbol} on ${chain} from JSON and top_holders...`);
    try {
      let holders = [];
      const fileName = NON_EVM_JSON_FILES[chain] || EVM_JSON_FILES[token.coingecko_id];
      if (fileName) {
        const filePath = join(__dirname, "..", "public", "nametags", fileName);
        const data = await fs.readFile(filePath, "utf-8");
        const jsonData = JSON.parse(data);
        const jsonHolders = Object.entries(jsonData).map(([address, info]) => ({
          wallet_address: address,
          balance: Number(info.Balance) || 0,
          source: "json",
        }));
        holders.push(...jsonHolders);
        logger.info(`Loaded ${jsonHolders.length} holders from ${fileName} for ${token.symbol} on ${chain}`);
      }

      if (NON_EVM_CHAINS.includes(token.coingecko_id) || ["ethereum", "binancecoin"].includes(token.coingecko_id)) {
        const topHolders = await prisma.top_holders.findMany({
          where: {
            chain: chain === "binancecoin" ? "bsc" : chain,
          },
          select: {
            address: true,
            balance: true,
            name_tag: true,
            image: true,
          },
        });

        const topHoldersMapped = topHolders.map((holder) => ({
          wallet_address: holder.address,
          balance: Number(holder.balance) || 0,
          source: "database",
          name_tag: holder.name_tag,
          image: holder.image,
        }));
        holders.push(...topHoldersMapped);
        logger.info(`Loaded ${topHoldersMapped.length} holders from top_holders for ${token.symbol} on ${chain}`);
      }

      const priceResponse = await coingeckoLimiter.schedule(() =>
        axios.get(`https://api.coingecko.com/api/v3/coins/${token.coingecko_id}`, {
          headers: { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY || "" },
          timeout: 15000,
        })
      );
      const priceUsd = Number.parseFloat(priceResponse.data.market_data.current_price.usd) || 0;
      const totalSupply = Number.parseFloat(priceResponse.data.market_data.total_supply) || 0;

      const processedHolders = holders
        .map((holder, index) => {
          const tagDataArray = this.nameTagData.get(holder.wallet_address.toLowerCase()) || [];
          let nameTag = holder.name_tag || null;
          let image = holder.image || null;
          let nameTagSource = holder.source === "database" ? "database" : null;

          if (!nameTag) {
            for (const tagData of tagDataArray) {
              if (tagData.nameTag) {
                if (tagData.chain === chain) {
                  nameTag = tagData.nameTag;
                  image = tagData.image || null;
                  nameTagSource = tagData.chain;
                  break;
                } else if (!nameTag) {
                  nameTag = tagData.nameTag;
                  image = tagData.image || null;
                  nameTagSource = tagData.chain;
                }
              }
            }
          }

          logger.info(`NameTag lookup for ${holder.wallet_address} on ${chain}`, {
            nameTagSource,
            nameTag,
          });

          if (!nameTag) return null;

          const name = this.mapNameTagToName(nameTag);
          const balance = Number(holder.balance) || 0;
          const balance_usd = balance * priceUsd;
          const percentage = totalSupply > 0 ? (balance / totalSupply) * 100 : 0;

          return {
            holder_address: holder.wallet_address,
            balance,
            balance_usd,
            percentage,
            name_tag: nameTag,
            name,
            image,
            rank: index + 1,
            source: holder.source,
          };
        })
        .filter((holder) => holder !== null && holder.name_tag !== null);

      logger.info(`Fetched ${processedHolders.length} holders with name tags for ${token.symbol} on ${chain}`);
      return processedHolders;
    } catch (error) {
      logger.error(`Error fetching holders for ${token.symbol} on ${chain}`, {
        message: error.message,
      });
      return [];
    }
  }

  async fetchAndStoreHolders(token, chain, tokenAddress) {
    const normalizedChain = CHAIN_MAPPING[chain] || chain;
    if (!SUPPORTED_CHAINS.includes(normalizedChain)) {
      logger.warn(`Chain ${chain} (normalized: ${normalizedChain}) is not supported for token ${token.symbol}`);
      return false;
    }

    const cacheKey = `sim_top_holders:${token.coingecko_id}:${normalizedChain}`;
    logger.info(`Checking cache for ${token.symbol} on ${normalizedChain}`);
    try {
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        logger.info(`Cache hit for ${token.symbol} on ${normalizedChain}`);
        const holders = JSON.parse(cachedData);
        const filteredHolders = holders.filter((holder) => holder.name_tag !== null);
        if (filteredHolders.length > 0) {
          await this.storeHolders(token, normalizedChain, tokenAddress, filteredHolders);
          logger.info(`Stored ${filteredHolders.length} cached holders for ${token.symbol} on ${normalizedChain}`);
          return true;
        } else {
          logger.info(`No valid cached holders with name_tag for ${token.symbol} on ${normalizedChain}`);
        }
      }

      let holders = [];
      const isEth = token.coingecko_id === "ethereum";
      const isBnb = token.coingecko_id === "binancecoin";

      if ((isEth && normalizedChain === "ethereum") || (isBnb && normalizedChain === "bsc")) {
        const fileName = EVM_JSON_FILES[token.coingecko_id];
        try {
          const filePath = join(__dirname, "..", "public", "nametags", fileName);
          const data = await fs.readFile(filePath, "utf-8");
          const jsonData = JSON.parse(data);
          const jsonHolders = Object.entries(jsonData).map(([address, info]) => ({
            wallet_address: address,
            balance: Number(info.Balance) || 0,
            source: "json",
          }));
          holders.push(...jsonHolders);
          logger.info(`Loaded ${jsonHolders.length} holders from ${fileName} for ${token.symbol} on ${normalizedChain}`);
        } catch (error) {
          logger.error(`Error loading holders from ${fileName}`, { message: error.message });
        }

        const topHolders = await prisma.top_holders.findMany({
          where: {
            chain: isBnb ? "bsc" : normalizedChain,
          },
          select: {
            address: true,
            balance: true,
            name_tag: true,
            image: true,
          },
        });

        const topHoldersMapped = topHolders.map((holder) => ({
          wallet_address: holder.address,
          balance: Number(holder.balance) || 0,
          source: "database",
          name_tag: holder.name_tag,
          image: holder.image,
        }));
        holders.push(...topHoldersMapped);
        logger.info(`Loaded ${topHoldersMapped.length} holders from top_holders for ${token.symbol} on ${normalizedChain}`);
      }

      if (tokenAddress || (isEth && chain !== "ethereum") || (isBnb && chain !== "bsc")) {
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
                  chain,
                  tokenAddress,
                  limit: 100,
                  decimalPlace: decimals,
                },
                {
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: process.env.SIM_API_KEY ? `Bearer ${process.env.SIM_API_KEY}` : undefined,
                  },
                  timeout: 30000,
                  responseType: "stream",
                }
              )
            );

            let buffer = "";
            let isFirstChunk = true;

            logger.info(`Starting to read SIM API stream for ${token.symbol} on ${chain}`);

            for await (const chunk of response.data) {
              const chunkString = chunk.toString();
              buffer += chunkString;

              try {
                if (isFirstChunk && buffer.startsWith("[")) {
                  buffer = buffer.slice(1);
                  isFirstChunk = false;
                }

                let lastIndex = 0;
                for (let i = 0; i < buffer.length; i++) {
                  if (buffer[i] === "}" && (buffer[i + 1] === "," || buffer[i + 1] === "]")) {
                    const jsonStr = buffer.slice(lastIndex, i + 1);
                    try {
                      const holder = JSON.parse(jsonStr);
                      if (holder.address && typeof holder.balance !== "undefined") {
                        holders.push({ wallet_address: holder.address, balance: holder.balance, source: "sim" });
                      }
                    } catch (parseError) {
                      logger.warn(`Failed to parse JSON chunk`, { message: parseError.message });
                    }
                    lastIndex = i + 2;
                  }
                }
                buffer = buffer.slice(lastIndex);
              } catch (error) {
                logger.warn(`Error processing stream chunk`, { message: error.message });
              }
            }

            if (buffer.trim().endsWith("]") && buffer.trim().length > 1) {
              try {
                const lastJsonStr = buffer.trim().slice(0, -1);
                if (lastJsonStr) {
                  const holder = JSON.parse(lastJsonStr);
                  if (holder.address && typeof holder.balance !== "undefined") {
                    holders.push({ wallet_address: holder.address, balance: holder.balance, source: "sim" });
                  }
                }
              } catch (parseError) {
                logger.warn(`Failed to parse final JSON chunk`, { message: parseError.message });
              }
            }

            logger.info(`SIM API stream completed for ${token.symbol} on ${chain}`, { dataLength: holders.length });
            break;
          } catch (error) {
            if (error.response?.status === 429 && attempts < maxAttempts - 1) {
              const waitTime = (attempts + 1) * 5000;
              logger.warn(`Rate limit (429) for ${token.symbol} on ${chain}, retrying in ${waitTime}ms...`);
              await new Promise((resolve) => setTimeout(resolve, waitTime));
              attempts++;
              continue;
            }
            logger.error(`Error fetching holders for ${token.symbol} on ${chain}`, {
              message: error.message,
              status: error.response?.status,
            });
            if (error.response?.status === 404) {
              logger.info(`Token not found on ${chain}`);
            }
            break;
          }
        }
      }

      if (holders.length === 0) {
        logger.warn(`No valid holder data for ${token.symbol} on ${chain}`);
        return false;
      }

      const totalSupplyResponse = await coingeckoLimiter.schedule(() =>
        axios.get(`https://api.coingecko.com/api/v3/coins/${token.coingecko_id}`, {
          headers: { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY || "" },
          timeout: 15000,
        })
      );
      const totalSupply = Number.parseFloat(totalSupplyResponse.data.market_data.total_supply) || 0;
      const priceUsd = Number.parseFloat(totalSupplyResponse.data.market_data.current_price.usd) || 0;

      const processedHolders = holders
        .map((holder, index) => {
          const tagDataArray = this.nameTagData.get(holder.wallet_address.toLowerCase()) || [];
          let nameTag = holder.name_tag || null;
          let image = holder.image || null;
          let nameTagSource = holder.source === "database" ? "database" : null;

          if (!nameTag) {
            for (const tagData of tagDataArray) {
              if (tagData.nameTag) {
                if (tagData.chain === chain) {
                  nameTag = tagData.nameTag;
                  image = tagData.image || null;
                  nameTagSource = tagData.chain;
                  break;
                } else if (!nameTag) {
                  nameTag = tagData.nameTag;
                  image = tagData.image || null;
                  nameTagSource = tagData.chain;
                }
              }
            }
          }

          logger.info(`NameTag lookup for ${holder.wallet_address} on ${chain}`, {
            nameTagSource,
            nameTag,
          });

          if (!nameTag) return null;

          const name = this.mapNameTagToName(nameTag);
          const calculatedBalance = Number(holder.balance) || 0;
          const balance_usd = calculatedBalance * priceUsd;
          const percentage = totalSupply > 0 ? (calculatedBalance / totalSupply) * 100 : 0;

          const holderKey = `${chain}:${holder.wallet_address.toLowerCase()}`;
          this.holdersWithNameTags.set(holderKey, {
            holder_address: holder.wallet_address,
            exchange_name: name,
            chain,
            name_tag: nameTag,
            image,
          });

          return {
            holder_address: holder.wallet_address,
            balance: calculatedBalance,
            balance_usd,
            percentage,
            name_tag: nameTag,
            name,
            image,
            rank: index + 1,
            source: holder.source,
          };
        })
        .filter((holder) => holder !== null && holder.name_tag !== null);

      if (processedHolders.length === 0) {
        logger.info(`No holders with valid name tags for ${token.symbol} on ${chain}`);
        return false;
      }

      logger.info(`Filtered ${processedHolders.length} holders with valid name tags for ${token.symbol} on ${chain}`);
      await redisClient.setEx(cacheKey, 86400, JSON.stringify(processedHolders));
      await this.storeHolders(token, chain, tokenAddress, processedHolders);
      logger.info(`Stored ${processedHolders.length} holders for ${token.symbol} on ${chain}`);
      return true;
    } catch (error) {
      logger.error(`Failed after retries for ${token.symbol} on ${chain}`, { message: error.message });
      return false;
    }
  }

  async processWalletBalances() {
    logger.info(`Processing wallet balances for ${this.holdersWithNameTags.size} holders with name tags...`);
    const processedWallets = new Set();

    for (const [holderKey, holderData] of this.holdersWithNameTags) {
      if (processedWallets.has(holderKey)) continue;

      const { holder_address, exchange_name, chain, name_tag, image } = holderData;
      logger.info(`Fetching wallet balances for ${holder_address} (${exchange_name}) on ${chain}`);

      const cacheKey = `sim_wallet_balances:${holder_address}:${chain}`;
      try {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          logger.info(`Cache hit for wallet ${holder_address} on ${chain}`);
          const { total_value_usd, token_count, metadata } = JSON.parse(cachedData);
          await this.storeWalletHolders({
            exchange_name,
            chain,
            holder_address,
            total_value_usd,
            token_count,
            metadata,
            name_tag,
            image,
          });
          logger.info(`Stored cached wallet balances for ${holder_address} (${exchange_name}) on ${chain}`);
          processedWallets.add(holderKey);
          continue;
        }

        let allTokens = [];
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
                  chain,
                  limit: 2000,
                  minValueUsd: 100,
                },
                {
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: process.env.SIM_API_KEY ? `Bearer ${process.env.SIM_API_KEY}` : undefined,
                  },
                  timeout: 45000,
                  responseType: "stream",
                }
              )
            );

            let buffer = "";
            let isFirstChunk = true;

            logger.info(`Starting to read SIM API stream for wallet balances of ${holder_address} on ${chain}`);

            for await (const chunk of response.data) {
              const chunkString = chunk.toString();
              buffer += chunkString;

              try {
                if (isFirstChunk && buffer.startsWith("[")) {
                  buffer = buffer.slice(1);
                  isFirstChunk = false;
                }

                let lastIndex = 0;
                for (let i = 0; i < buffer.length; i++) {
                  if (buffer[i] === "}" && (buffer[i + 1] === "," || buffer[i + 1] === "]")) {
                    const jsonStr = buffer.slice(lastIndex, i + 1);
                    try {
                      const token = JSON.parse(jsonStr);
                      if (token.address && token.chain && typeof token.amount !== "undefined") {
                        allTokens.push({
                          chain: token.chain,
                          address: token.address,
                          symbol: token.symbol || "Unknown",
                          decimals: token.decimals || 18,
                          amount: Number(token.amount) || 0,
                          price_usd: Number(token.price_usd) || 0,
                          value_usd: Number(token.value_usd) || 0,
                          logo: token.logo || null,
                          low_liquidity: token.low_liquidity || false,
                          name: token.name || "Unknown",
                        });
                      }
                    } catch (parseError) {
                      logger.warn(`Failed to parse JSON chunk for ${holder_address}`, { message: parseError.message });
                    }
                    lastIndex = i + 2;
                  }
                }
                buffer = buffer.slice(lastIndex);
              } catch (error) {
                logger.warn(`Error processing stream chunk for ${holder_address}`, { message: error.message });
              }
            }

            if (buffer.trim().endsWith("]") && buffer.trim().length > 1) {
              try {
                const lastJsonStr = buffer.trim().slice(0, -1);
                if (lastJsonStr) {
                  const token = JSON.parse(lastJsonStr);
                  if (token.address && token.chain && typeof token.amount !== "undefined") {
                    allTokens.push({
                      chain: token.chain,
                      address: token.address,
                      symbol: token.symbol || "Unknown",
                      decimals: token.decimals || 18,
                      amount: Number(token.amount) || 0,
                      price_usd: Number(token.price_usd) || 0,
                      value_usd: Number(token.value_usd) || 0,
                      logo: token.logo || null,
                      low_liquidity: token.low_liquidity || false,
                      name: token.name || "Unknown",
                    });
                  }
                }
              } catch (parseError) {
                logger.warn(`Failed to parse final JSON chunk for ${holder_address}`, { message: parseError.message });
              }
            }

            logger.info(`SIM API stream completed for ${holder_address} on ${chain}`, { dataLength: allTokens.length });
            break;
          } catch (error) {
            if (error.response?.status === 429 && attempts < maxAttempts - 1) {
              const waitTime = (attempts + 1) * 10000;
              logger.warn(`Rate limit (429) for wallet ${holder_address} on ${chain}, retrying in ${waitTime}ms...`);
              await new Promise((resolve) => setTimeout(resolve, waitTime));
              attempts++;
              continue;
            }
            logger.error(`Error fetching wallet balances for ${holder_address} on ${chain}`, {
              message: error.message,
              status: error.response?.status,
            });
            break;
          }
        } while (true);

        if (allTokens.length === 0) {
          logger.warn(`No tokens retrieved for ${holder_address} on ${chain}`);
          continue;
        }

        const filteredTokens = allTokens
          .filter((token) => {
            const normalizedChain = CHAIN_MAPPING[token.chain] || token.chain;

            // Kiểm tra nếu token nằm trong danh sách bị chặn
            if (BLOCKED_TOKEN_ADDRESSES.includes(token.address.toLowerCase())) {
              logger.info(`Filtered out token ${token.symbol} on ${normalizedChain} due to blocked token address`, {
                token_address: token.address,
              });
              return false;
            }

            const isImportantToken = IMPORTANT_TOKENS.some(
              (impToken) =>
                impToken.chain === normalizedChain &&
                (impToken.address === "native"
                  ? token.address === "native"
                  : impToken.address.toLowerCase() === token.address.toLowerCase())
            );

            const isAllowedToken = ALLOWED_TOKENS.some(
              (allowedToken) =>
                allowedToken.chain === normalizedChain &&
                (allowedToken.address === "native"
                  ? token.address === "native"
                  : allowedToken.address.toLowerCase() === token.address.toLowerCase())
            );

            const isNativeToken =
              (normalizedChain === "ethereum" && token.address === "native") ||
              (normalizedChain === "bsc" && token.address === "native");

            // Giữ lại token nếu nằm trong ALLOWED_TOKENS
            if (isAllowedToken) {
              logger.info(`Kept token ${token.symbol} on ${normalizedChain} as it is in ALLOWED_TOKENS`, {
                token_address: token.address,
              });
              return true;
            }

            if (token.value_usd > 50_000_000_000 && !isImportantToken && !isNativeToken) {
              logger.info(`Filtered out token ${token.symbol} with excessive value_usd`, {
                value_usd: token.value_usd,
                chain: normalizedChain,
              });
              return false;
            }

            if (token.value_usd === 0 && !isImportantToken && !isNativeToken) {
              logger.info(`Filtered out token ${token.symbol} with zero value_usd`, { chain: normalizedChain });
              return false;
            }

            const hasValidLogo = isValidLogo(token.logo);
            const hasLowLiquidity = token.low_liquidity === true;
            if (!isImportantToken && !isNativeToken && (!hasValidLogo || hasLowLiquidity)) {
              logger.info(`Filtered out token ${token.symbol} on ${normalizedChain}`, {
                reason: !hasValidLogo ? "Invalid or missing logo" : "Low liquidity",
                logo: token.logo,
                low_liquidity: token.low_liquidity,
              });
              return false;
            }

            return true;
          })
          .sort((a, b) => b.value_usd - a.value_usd)
          .slice(0, 250);

        if (filteredTokens.length === 0) {
          logger.warn(`No tokens passed filtering for ${holder_address} on ${chain}`);
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

        await redisClient.setEx(cacheKey, 86400, JSON.stringify({ total_value_usd: totalValueUsd, token_count: tokenCount, metadata }));
        await this.storeWalletHolders({
          exchange_name,
          chain,
          holder_address,
          total_value_usd: totalValueUsd,
          token_count: tokenCount,
          metadata,
          name_tag,
          image,
        });

        logger.info(`Stored wallet balances for ${holder_address} (${exchange_name}) on ${chain}`, {
          tokenCount,
          totalValueUsd,
        });
        processedWallets.add(holderKey);
      } catch (error) {
        logger.error(`Failed after retries for wallet ${holder_address} on ${chain}`, { message: error.message });
      }
    }

    logger.info(`Completed processing wallet balances for ${processedWallets.size} unique wallets`);
  }

  async storeWalletHolders(walletData) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { exchange_name, chain, holder_address, total_value_usd, token_count, metadata, name_tag, image } = walletData;

      const result = await client.query(
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
        RETURNING id, (xmax = 0) AS is_inserted
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

      logger.info(`${result.rows[0].is_inserted ? "Inserted" : "Updated"} wallet holder ${holder_address} (${exchange_name}) on ${chain}`, {
        db_id: result.rows[0]?.id,
        token_count,
        total_value_usd,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error(`Error storing wallet holder ${walletData.holder_address}`, {
        message: error.message,
        code: error.code,
      });
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

          logger.info(`${result.rows[0].is_inserted ? "Inserted" : "Updated"} holder ${holder.holder_address} for ${token.symbol} on ${chain}`, {
            source: holder.source,
            name_tag: holder.name_tag,
          });
        } catch (error) {
          logger.error(`Error storing holder ${holder.holder_address}`, {
            message: error.message,
            code: error.code,
          });
        }
      }

      await client.query("COMMIT");
      logger.info(`Committed ${insertedCount} inserted and ${updatedCount} updated holders for ${token.symbol} on ${chain}`);
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error(`Transaction rollback for ${token.symbol} on ${chain}`, { message: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  async runFullCycle() {
    if (this.isRunning) {
      logger.warn("Cron job is already running, skipping...");
      return;
    }

    this.isRunning = true;
    this.holdersWithNameTags.clear();
    const startTime = new Date();

    try {
      logger.info(`Starting full token holders sync`, { startTime: startTime.toISOString() });

      await this.fetchTokensFromCoinGecko();
      logger.info("Completed fetchTokensFromCoinGecko");

      await this.processTokenHolders();
      logger.info("Completed processTokenHolders");

      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000 / 60);
      logger.info("Full sync completed successfully", {
        duration: `${duration} minutes`,
        totalTokens: this.totalTokens,
      });
    } catch (error) {
      logger.error("Full sync failed", { message: error.message, stack: error.stack });
      throw error;
    } finally {
      this.isRunning = false;
      this.currentBatch = 0;
      this.totalTokens = 0;
      this.holdersWithNameTags.clear();
    }
  }

  async runAnalyzeBalancesOnly() {
    if (this.isRunning) {
      logger.warn("Cron job is already running, skipping...");
      return;
    }

    this.isRunning = true;
    const startTime = new Date();

    try {
      logger.info(`Starting wallet balances analysis`, { startTime: startTime.toISOString() });

      const tokensResult = await pool.query(`SELECT COUNT(*) as count FROM tokens`);
      const tokenCount = parseInt(tokensResult.rows[0].count, 10);
      if (tokenCount === 0) {
        logger.error("No tokens found in the database. Please run full sync first.");
        throw new Error("No tokens found in the database");
      }
      logger.info("Found tokens in the database", { count: tokenCount });

      const holdersResult = await pool.query(`SELECT COUNT(*) as count FROM token_holders`);
      const holderCount = parseInt(holdersResult.rows[0].count, 10);
      if (holderCount === 0) {
        logger.error("No holders found in the database. Please run full sync first.");
        throw new Error("No holders found in the database");
      }
      logger.info("Found holders in the database", { count: holderCount });

      await this.loadNameTags();
      logger.info("Name tags reloaded for balance analysis");

      this.holdersWithNameTags.clear();
      const holdersData = await pool.query(`
        SELECT DISTINCT holder_address, chain, name_tag, name, image
        FROM token_holders
        WHERE name_tag IS NOT NULL
      `);
      holdersData.rows.forEach((holder) => {
        const holderKey = `${holder.chain}:${holder.holder_address.toLowerCase()}`;
        this.holdersWithNameTags.set(holderKey, {
          holder_address: holder.holder_address,
          exchange_name: holder.name,
          chain: holder.chain,
          name_tag: holder.name_tag,
          image: holder.image,
        });
      });
      logger.info("Loaded holders with name tags from database", { count: this.holdersWithNameTags.size });

      await this.processWalletBalances();
      logger.info("Completed processWalletBalances");

      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000 / 60);
      logger.info("Wallet balances analysis completed successfully", {
        duration: `${duration} minutes`,
        holderCount: this.holdersWithNameTags.size,
      });
    } catch (error) {
      logger.error("Wallet balances analysis failed", { message: error.message, stack: error.stack });
      throw error;
    } finally {
      this.isRunning = false;
      this.holdersWithNameTags.clear();
    }
  }

  startCronJob() {
    const mode = process.argv[2] || "full";
    logger.info(`Setting up cron job`, { mode });

    if (mode === "analyze-balances") {
      logger.info("Running initial balances analysis...");
      setTimeout(async () => {
        try {
          await this.runAnalyzeBalancesOnly();
        } catch (error) {
          logger.error("Initial balances analysis failed", { message: error.message, stack: error.stack });
        }
      }, 5000);
    } else {
      logger.info("Scheduling full sync to run every 5 days at 2:00 AM...");
      cron.schedule(
        "0 2 */5 * *",
        async () => {
          logger.info("Cron job triggered", { time: new Date().toISOString() });
          await this.runFullCycle();
        },
        { scheduled: true, timezone: "UTC" }
      );
      logger.info("Cron job scheduled successfully");

      logger.info("Running initial full sync...");
      setTimeout(async () => {
        try {
          await this.runFullCycle();
        } catch (error) {
          logger.error("Initial sync failed", { message: error.message, stack: error.stack });
        }
      }, 5000);
    }

    process.on("uncaughtException", (err) => {
      logger.error("Uncaught Exception", { message: err.message, stack: err.stack });
    });
    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection", { reason: reason.message || reason, promise });
    });
  }

  async cleanup() {
    logger.info("Cleaning up connections...");
    try {
      await redisClient.quit();
      await pool.end();
      await prisma.$disconnect();
      logger.info("Cleanup completed");
    } catch (error) {
      logger.error("Cleanup error", { message: error.message });
    }
  }
}

async function main() {
  const cronJob = new TokenHoldersCron();

  try {
    await cronJob.initialize();
    cronJob.startCronJob();

    const mode = process.argv[2] || "full";
    logger.info(`Token Holders Cron Job is running`, { mode });
  } catch (error) {
    logger.error("Failed to start cron job", { message: error.message });
    await cronJob.cleanup();
    process.exit(1);
  }
}

main().catch((error) => logger.error("Main function error", { message: error.message }));