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
  maxConcurrent: 2,
  minTime: 2000,
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

  // Map name_tag to simplified name (keep original if possible)
  mapNameTagToName(nameTag) {
    if (!nameTag) return null;
    const lowerTag = nameTag.toLowerCase();
    // Remove fixed mapping to preserve original name_tag
    const words = lowerTag.split(/[\s:-]+/);
    return words[0] ? words[0].trim() : nameTag; // Use first word or original name_tag
  }

  async initialize() {
    let retries = 3;
    while (retries > 0) {
      try {
        await redisClient.connect();
        console.log("✅ Redis connected successfully");

        const client = await pool.connect();
        client.release();
        console.log("✅ PostgreSQL connected successfully");

        await this.createTables();
        console.log("✅ Database tables initialized");

        await this.loadNameTags();
        console.log("✅ Name tags loaded successfully");
        return;
      } catch (error) {
        retries--;
        console.error(`❌ Initialization attempt failed (${retries} retries left):`, {
          message: error.message,
          stack: error.stack,
        });
        if (retries === 0) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  async loadNameTags() {
    console.log("📂 Loading name tags and images from public/nametags directory...");
    this.nameTagData = new Map();
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
              const nameTag = labels[chainKey]?.["Name Tag"] || null;
              const image = labels[chainKey]?.["image"] || null;
              if (nameTag) {
                // Store with address as key to allow lookup across all chains
                const key = address.toLowerCase();
                const existing = this.nameTagData.get(key) || [];
                existing.push({ chain: chainKey, nameTag, image });
                this.nameTagData.set(key, existing);
              }
            }
          }
          console.log(`✅ Loaded name tags from ${file} (${Object.keys(jsonData).length} addresses)`);
        } catch (error) {
          console.error(`❌ Error loading name tags from ${file}:`, {
            message: error.message,
          });
        }
      }
      console.log(`✅ Total addresses with name tags loaded: ${this.nameTagData.size}`);
    } catch (error) {
      console.error("❌ Error reading nametags directory:", {
        message: error.message,
      });
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
      console.log("📋 Creating tokens table...");
      await pool.query(createTokensTable);
      console.log("✅ Tokens table created or already exists");

      console.log("📋 Creating token_holders table...");
      await pool.query(createHoldersTable);
      console.log("✅ Token_holders table created or already exists");

      console.log("📋 Creating wallet_holders table...");
      await pool.query(createWalletHoldersTable);
      console.log("✅ Wallet_holders table created or already exists");

      console.log("📋 Creating indexes...");
      await pool.query(createIndexes);
      console.log("✅ Indexes created or already exist");
    } catch (error) {
      console.error("❌ Error creating tables or indexes:", {
        message: error.message,
        detail: error.detail,
        code: error.code,
      });
      throw error;
    }
  }

  async fetchTokensFromCoinGecko() {
    console.log("🔄 Fetching up to 300 tokens from CoinGecko...");
    const tokens = [];
    const perPage = 250; // CoinGecko limits to 250 tokens per request
    const pages = Math.ceil(300 / perPage); // Calculate number of pages needed

    try {
      for (let page = 1; page <= pages; page++) {
        console.log(`📡 Fetching page ${page} of ${pages} with ${perPage} tokens...`);
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
          console.warn(`⚠️ Page ${page} returned invalid or empty data:`, pageTokens);
          continue;
        }

        tokens.push(...pageTokens);
        console.log(`✅ Fetched ${pageTokens.length} tokens from page ${page}`);
      }

      if (tokens.length === 0) {
        console.error("❌ CoinGecko returned no valid token data");
        throw new Error("No valid token data from CoinGecko");
      }

      console.log(`✅ Fetched total ${tokens.length} tokens from CoinGecko`, {
        sample: tokens.slice(0, 3).map((t) => ({ id: t.id, symbol: t.symbol })),
      });

      await this.storeTokens(tokens);
      return tokens;
    } catch (error) {
      console.error("❌ Error fetching tokens from CoinGecko:", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      throw error;
    }
  }

  async storeTokens(tokens) {
    console.log(`💾 Storing ${tokens.length} tokens in database...`);
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
          console.warn(`⚠️ Skipping token ${token.id}: Invalid detail data`, detailData);
          continue;
        }

        const decimals = detailData.contract_address
          ? detailData.detail_platforms?.ethereum?.decimal_place || 18
          : NON_EVM_DECIMALS[token.id] || 18;

        const result = await pool.query(
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
          ]
        );

        storedCount++;
        console.log(`✅ Stored token ${token.id} (${token.symbol})`, { db_id: result.rows[0]?.id, decimals });
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Error storing token ${token.id}:`, {
          message: error.message,
          detail: error.detail,
          code: error.code,
          stack: error.stack,
        });
        continue;
      }
    }

    console.log(`✅ Stored ${storedCount}/${tokens.length} tokens successfully`);
  }

  async processTokenHolders() {
    console.log("🔄 Starting token holders processing...");
    try {
      const tokensResult = await pool.query(`
        SELECT * FROM tokens 
        ORDER BY market_cap_rank ASC NULLS LAST
      `);

      const tokens = tokensResult.rows;
      this.totalTokens = tokens.length;
      console.log(`📊 Processing ${this.totalTokens} tokens...`);

      for (let i = 0; i < tokens.length; i++) {
        if (!this.isRunning) {
          console.log("⏹️ Processing stopped");
          break;
        }

        const token = tokens[i];
        this.currentBatch = i + 1;

        console.log(`\n🔄 Processing token ${this.currentBatch}/${this.totalTokens}: ${token.name} (${token.symbol})`);

        try {
          await this.processTokenOnAllChains(token);
        } catch (error) {
          console.error(`❌ Error processing token ${token.coingecko_id}:`, error.message);
        }

        console.log("⏳ Waiting 15 seconds before next token...");
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Tăng từ 10s lên 15s
      }

      // Process wallet balances for holders with name tags
      await this.processWalletBalances();

      console.log("✅ Token holders processing completed");
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
    console.log(`📊 Token ${token.symbol} supported on ${supportedPlatforms.length} EVM chains`, {
      chains: supportedPlatforms,
      platforms: Object.keys(platforms).slice(0, 5),
    });

    // Handle Bitcoin and Dogecoin
    if (["bitcoin", "dogecoin"].includes(token.coingecko_id)) {
      // Fetch treasury data from CoinGecko
      await this.processTreasuryData(token);

      // Fetch holders from Blockchair
      const chain = token.coingecko_id;
      const blockchairHolders = await this.fetchBlockchairHolders(token, chain);
      if (blockchairHolders.length > 0) {
        await this.storeHolders(token, chain, null, blockchairHolders);
        console.log(`    ✅ Stored ${blockchairHolders.length} Blockchair holders for ${token.symbol} on ${chain}`);
      }
      return;
    }

    // Handle EVM chains
    for (const chain of supportedPlatforms) {
      try {
        const tokenAddress = platforms[chain].contract_address;
        console.log(`  📡 Fetching holders for ${token.symbol} on ${chain} (address: ${tokenAddress})`);
        await this.fetchAndStoreHolders(token, chain, tokenAddress);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`    ❌ Error processing ${token.symbol} on ${chain}:`, {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
        });
        continue;
      }
    }
  }

  async processTreasuryData(token) {
    try {
      console.log(`  🏛️ Fetching treasury data for ${token.coingecko_id}...`);

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

            console.log(`      ℹ️ Treasury balance details:`, {
              holder_address: company.address || company.name || `company_${index}`,
              name_tag: nameTag,
              image: image,
              raw_balance: rawBalance,
              adjusted_balance: balance,
              decimals: decimals,
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
          console.log(`    ⚠️ No holders with name tags for ${token.coingecko_id}`);
          return;
        }

        await this.storeHolders(token, token.coingecko_id, null, holders);
        console.log(`    ✅ Stored ${holders.length} treasury holders with name tags for ${token.coingecko_id}`);
      } else {
        console.log(`    ℹ️ No treasury data available for ${token.coingecko_id}`);
      }
    } catch (error) {
      if (error.response?.status === 404) {
        console.log(`    ℹ️ No treasury data available for ${token.coingecko_id}`);
      } else {
        console.error(`    ❌ Error fetching treasury data:`, error.message);
      }
    }
  }

  async fetchBlockchairHolders(token, chain) {
    try {
      console.log(`  📡 Fetching holders for ${token.symbol} on ${chain} via Blockchair...`);

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

      console.log(`📡 Blockchair API response for ${token.symbol} on ${chain}:`, {
        success: response.data?.success,
        dataLength: response.data?.data?.length,
        sample: response.data?.data?.slice(0, 2),
      });

      if (!response.data?.success || !Array.isArray(response.data.data)) {
        console.warn(`     ⚠️ No valid holder data for ${token.symbol} on ${chain} from Blockchair`);
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

          console.log(`       ℹ️ Blockchair holder balance details:`, {
            holder_address: holder.address,
            name_tag: nameTag,
            image: image,
            final_balance: balance,
            balance_usd: balance_usd,
            percentage: percentage,
            chain: chain,
          });

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

      console.log(`     ✅ Fetched ${holders.length} holders with name tags for ${token.symbol} on ${chain} from Blockchair`);
      return holders;
    } catch (error) {
      console.error(`     ❌ Error fetching Blockchair holders for ${token.symbol} on ${chain}:`, {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      if (error.response?.status === 429) {
        console.log(`     ⚠️ Blockchair API rate limit exceeded`);
      } else if (error.response?.status === 404) {
        console.log(`     ℹ️ No holder data found on ${chain} from Blockchair`);
      }
      return [];
    }
  }

  async fetchAndStoreHolders(token, chain, tokenAddress) {
    const cacheKey = `sim_top_holders:${token.coingecko_id}:${chain}`;
    try {
      // Kiểm tra cache
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        console.log(`📦 Cache hit for ${token.symbol} on ${chain}`);
        const holders = JSON.parse(cachedData);
        if (holders.length > 0) {
          await this.storeHolders(token, chain, tokenAddress, holders);
          console.log(`     ✅ Stored ${holders.length} cached holders for ${token.symbol} on ${chain}`);
        }
        return;
      }

      const decimals = token.detail_platforms?.[chain]?.decimal_place ?? token.decimals ?? 18;

      // Thử gọi API với retry logic
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
                responseType: 'stream', // Sử dụng responseType stream để xử lý dữ liệu streaming
              }
            )
          );

          // Xử lý dữ liệu từ stream
          const holders = [];
          let buffer = '';
          let isFirstChunk = true;

          console.log(`📡 Starting to read SIM API stream for ${token.symbol} on ${chain}`);

          // Đọc từng chunk từ stream
          for await (const chunk of response.data) {
            const chunkString = chunk.toString();
            buffer += chunkString;

            // Xử lý JSON từng phần
            try {
              // Loại bỏ dấu ngoặc mở đầu '[' nếu là chunk đầu tiên
              if (isFirstChunk && buffer.startsWith('[')) {
                buffer = buffer.slice(1);
                isFirstChunk = false;
              }

              // Tách các object JSON hoàn chỉnh
              let lastIndex = 0;
              for (let i = 0; i < buffer.length; i++) {
                if (buffer[i] === '}' && (buffer[i + 1] === ',' || buffer[i + 1] === ']')) {
                  const jsonStr = buffer.slice(lastIndex, i + 1);
                  try {
                    const holder = JSON.parse(jsonStr);
                    if (holder.address && typeof holder.balance !== 'undefined') {
                      holders.push({ wallet_address: holder.address, balance: holder.balance });
                    }
                  } catch (parseError) {
                    console.warn(`     ⚠️ Failed to parse JSON chunk: ${parseError.message}`);
                  }
                  lastIndex = i + 2; // Bỏ qua dấu ',' hoặc ']'
                }
              }
              buffer = buffer.slice(lastIndex); // Giữ lại phần chưa xử lý
            } catch (error) {
              console.warn(`     ⚠️ Error processing stream chunk: ${error.message}`);
            }
          }

          // Xử lý phần còn lại của buffer (nếu có)
          if (buffer.trim().endsWith(']') && buffer.trim().length > 1) {
            try {
              const lastJsonStr = buffer.trim().slice(0, -1); // Loại bỏ dấu ']'
              if (lastJsonStr) {
                const holder = JSON.parse(lastJsonStr);
                if (holder.address && typeof holder.balance !== 'undefined') {
                  holders.push({ wallet_address: holder.address, balance: holder.balance });
                }
              }
            } catch (parseError) {
              console.warn(`     ⚠️ Failed to parse final JSON chunk: ${parseError.message}`);
            }
          }

          console.log(`📡 SIM API stream completed for ${token.symbol} on ${chain}:`, {
            dataLength: holders.length,
            sample: holders.slice(0, 2),
          });

          if (holders.length === 0) {
            console.warn(`     ⚠️ No valid holder data for ${token.symbol} on ${chain}`);
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

          const totalHolders = holders.length;
          const processedHolders = holders
            .map((holder, index) => {
              const tagDataArray = this.nameTagData.get(holder.wallet_address.toLowerCase()) || [];
              let nameTag = null;
              let image = null;
              let nameTagSource = null;

              for (const tagData of tagDataArray) {
                if (tagData.nameTag) {
                  nameTag = tagData.nameTag;
                  image = tagData.image || null;
                  nameTagSource = tagData.chain;
                  break;
                }
              }

              console.log(`       ℹ️ NameTag lookup for ${holder.wallet_address} on ${chain}:`, {
                triedChains: tagDataArray.map((tag) => tag.chain),
                nameTagSource,
                nameTag,
                image,
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

          if (processedHolders.length === 0) {
            console.log(`     ⚠️ No holders with valid name tags for ${token.symbol} on ${chain} (total holders: ${totalHolders})`);
            return;
          }

          console.log(`     ℹ️ Filtered ${processedHolders.length} holders with valid name tags out of ${totalHolders} for ${token.symbol} on ${chain}`);

          // Lưu vào cache với TTL 1 ngày (86400 giây)
          await redisClient.setEx(cacheKey, 86400, JSON.stringify(processedHolders));

          await this.storeHolders(token, chain, tokenAddress, processedHolders);
          console.log(`     ✅ Stored ${processedHolders.length} holders for ${token.symbol} on ${chain}`);
          return;
        } catch (error) {
          if (error.response?.status === 429 && attempts < maxAttempts - 1) {
            const waitTime = (attempts + 1) * 5000; // 5s, 10s, 15s
            console.warn(`     ⚠️ Rate limit (429) for ${token.symbol} on ${chain}, retrying in ${waitTime}ms...`);
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            attempts++;
            continue;
          }
          console.error(`     ❌ Error fetching holders for ${token.symbol} on ${chain}:`, {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data,
          });
          if (error.response?.status === 404) {
            console.log(`     ℹ️ Token not found on ${chain}`);
          } else {
            throw error;
          }
          return;
        }
      }
    } catch (error) {
      console.error(`     ❌ Failed after retries for ${token.symbol} on ${chain}:`, error.message);
    }
  }

  async processWalletBalances() {
    console.log(`🔄 Processing wallet balances for ${this.holdersWithNameTags.size} holders with name tags...`);
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
      console.log(`  📡 Fetching wallet balances for ${holder_address} (${exchange_name}) on ${chain}`);

      const cacheKey = `sim_wallet_balances:${holder_address}:${chain}`;
      try {
        // Kiểm tra cache
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          console.log(`📦 Cache hit for wallet ${holder_address} on ${chain}`);
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
          console.log(`     ✅ Stored cached wallet balances for ${holder_address} (${exchange_name}) on ${chain}`);
          processedWallets.add(holderKey);
          continue;
        }

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
                  responseType: 'stream', // Sử dụng responseType stream để xử lý dữ liệu streaming
                }
              )
            );

            // Xử lý dữ liệu từ stream
            let buffer = '';
            let isFirstChunk = true;

            console.log(`📡 Starting to read SIM API stream for wallet balances of ${holder_address} on ${chain}`);

            for await (const chunk of response.data) {
              const chunkString = chunk.toString();
              buffer += chunkString;

              // Xử lý JSON từng phần
              try {
                if (isFirstChunk && buffer.startsWith('[')) {
                  buffer = buffer.slice(1);
                  isFirstChunk = false;
                }

                let lastIndex = 0;
                for (let i = 0; i < buffer.length; i++) {
                  if (buffer[i] === '}' && (buffer[i + 1] === ',' || buffer[i + 1] === ']')) {
                    const jsonStr = buffer.slice(lastIndex, i + 1);
                    try {
                      const token = JSON.parse(jsonStr);
                      if (token.address && token.chain && typeof token.amount !== 'undefined') {
                        allTokens.push({
                          chain: token.chain,
                          address: token.address,
                          symbol: token.symbol || 'Unknown',
                          decimals: token.decimals || 18,
                          amount: Number(token.amount) || 0,
                          price_usd: Number(token.price_usd) || 0,
                          value_usd: Number(token.value_usd) || 0,
                          logo: token.logo || null,
                          low_liquidity: token.low_liquidity || false,
                          name: token.name || 'Unknown'
                        });
                      }
                    } catch (parseError) {
                      console.warn(`     ⚠️ Failed to parse JSON chunk for ${holder_address}: ${parseError.message}`);
                    }
                    lastIndex = i + 2; // Bỏ qua dấu ',' hoặc ']'
                  }
                }
                buffer = buffer.slice(lastIndex);
              } catch (error) {
                console.warn(`     ⚠️ Error processing stream chunk for ${holder_address}: ${error.message}`);
              }
            }

            // Xử lý phần còn lại của buffer
            if (buffer.trim().endsWith(']') && buffer.trim().length > 1) {
              try {
                const lastJsonStr = buffer.trim().slice(0, -1);
                if (lastJsonStr) {
                  const token = JSON.parse(lastJsonStr);
                  if (token.address && token.chain && typeof token.amount !== 'undefined') {
                    allTokens.push({
                      chain: token.chain,
                      address: token.address,
                      symbol: token.symbol || 'Unknown',
                      decimals: token.decimals || 18,
                      amount: Number(token.amount) || 0,
                      price_usd: Number(token.price_usd) || 0,
                      value_usd: Number(token.value_usd) || 0,
                      logo: token.logo || null,
                      low_liquidity: token.low_liquidity || false,
                      name: token.name || 'Unknown'
                    });
                  }
                }
              } catch (parseError) {
                console.warn(`     ⚠️ Failed to parse final JSON chunk for ${holder_address}: ${parseError.message}`);
              }
            }

            console.log(`📡 SIM API stream completed for ${holder_address} on ${chain}:`, {
              dataLength: allTokens.length,
              sample: allTokens.slice(0, 2),
            });

            // Cập nhật nextOffset từ response headers hoặc logic stream
            // Lưu ý: SIM API có thể không trả về next_offset trong stream, giả định tiếp tục cho đến khi stream kết thúc
            nextOffset = null; // Stream không hỗ trợ phân trang, reset để thoát vòng lặp

            // Kiểm tra USDT như trước
            const usdtToken = allTokens.find(
              (token) =>
                token.chain === "ethereum" &&
                token.address.toLowerCase() === "0xdAC17F958D2ee523a2206206994597C13D831ec7"
            );
            if (usdtToken) {
              console.log(`     ✅ Found USDT:`, {
                address: usdtToken.address,
                balance: usdtToken.amount,
                value_usd: usdtToken.value_usd,
                decimals: usdtToken.decimals,
                logo: usdtToken.logo,
                low_liquidity: usdtToken.low_liquidity || false,
              });
            } else {
              console.log(`     ⚠️ USDT not found in response for ${holder_address} on ${chain}`);
            }

          } catch (error) {
            if (error.response?.status === 429 && attempts < maxAttempts - 1) {
              const waitTime = (attempts + 1) * 10000;
              console.warn(`     ⚠️ Rate limit (429) for wallet ${holder_address} on ${chain}, retrying in ${waitTime}ms...`);
              await new Promise((resolve) => setTimeout(resolve, waitTime));
              attempts++;
              continue;
            }
            console.error(`     ❌ Error fetching wallet balances for ${holder_address} on ${chain}:`, {
              message: error.message,
              status: error.response?.status,
              data: error.response?.data,
            });
            break;
          }
        } while (nextOffset);

        if (allTokens.length === 0) {
          console.warn(`     ⚠️ No tokens retrieved for ${holder_address} on ${chain}`);
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
              console.log(`     ℹ️ Filtered out token ${token.symbol} with excessive value_usd: ${token.value_usd} on ${chain}`);
              return false;
            }

            if (token.value_usd === 0 && !isImportantToken) {
              console.log(`     ℹ️ Filtered out token ${token.symbol} with zero value_usd on ${chain}`);
              return false;
            }

            const hasValidLogo = isValidLogo(token.logo);
            const hasLowLiquidity = token.low_liquidity === true;
            if (!isImportantToken && (!hasValidLogo || hasLowLiquidity)) {
              console.log(`     ℹ️ Filtered out token ${token.symbol} on ${chain}:`, {
                reason: !hasValidLogo ? "Invalid or missing logo" : "Low liquidity",
                logo: token.logo,
                low_liquidity: hasLowLiquidity,
              });
              return false;
            }

            return true;
          })
          .sort((a, b) => b.value_usd - a.value_usd)
          .slice(0, 250);

        if (filteredTokens.length === 0) {
          console.warn(`     ⚠️ No tokens passed filtering for ${holder_address} on ${chain}`);
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
          total_value_usd: totalValueUsd,
          token_count: tokenCount,
          metadata,
          name_tag,
          image,
        });

        console.log(`     ✅ Stored wallet balances for ${holder_address} (${exchange_name}) on ${chain}: ${tokenCount} tokens, total_value_usd: ${totalValueUsd}`);
        processedWallets.add(holderKey);
      } catch (error) {
        console.error(`     ❌ Failed after retries for wallet ${holder_address} on ${chain}:`, error.message);
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    console.log(`✅ Completed processing wallet balances for ${processedWallets.size} unique wallets`);
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

      console.log(
        `      ✅ ${result.rows[0].is_inserted ? "Inserted" : "Updated"} wallet holder ${holder_address} (${exchange_name}) on ${chain}`,
        {
          db_id: result.rows[0]?.id,
          token_count,
          total_value_usd,
        }
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`      ❌ Error storing wallet holder ${walletData.holder_address}:`, {
        message: error.message,
        detail: error.detail,
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

          console.log(
            `      ✅ ${result.rows[0].is_inserted ? "Inserted" : "Updated"} holder ${holder.holder_address} for ${token.symbol} on ${chain} (source: ${holder.source})`,
            {
              db_id: result.rows[0]?.id,
              name_tag: holder.name_tag,
              name: holder.name,
              image: holder.image,
              balance: holder.balance,
            }
          );
        } catch (error) {
          console.error(`      ❌ Error storing holder ${holder.holder_address}:`, {
            message: error.message,
            detail: error.detail,
            code: error.code,
          });
        }
      }

      await client.query("COMMIT");
      console.log(
        `    ✅ Committed ${insertedCount} inserted and ${updatedCount} updated holders for ${token.symbol} on ${chain}`
      );
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`    ❌ Transaction rollback for ${token.symbol} on ${chain}:`, error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  async runFullCycle() {
    if (this.isRunning) {
      console.log("⚠️ Cron job is already running, skipping...");
      return;
    }

    this.isRunning = true;
    this.holdersWithNameTags.clear();
    const startTime = new Date();
    let errors = [];

    try {
      console.log(`\n🚀 Starting full token holders sync at ${startTime.toISOString()}`);

      console.log("📡 Starting fetchTokensFromCoinGecko...");
      await this.fetchTokensFromCoinGecko();
      console.log("✅ Completed fetchTokensFromCoinGecko");

      console.log("📊 Starting processTokenHolders...");
      await this.processTokenHolders();
      console.log("✅ Completed processTokenHolders");

      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000 / 60);
      console.log(`\n✅ Full sync completed successfully!`);
      console.log(`⏱️ Total duration: ${duration} minutes`);
      console.log(`📊 Processed ${this.totalTokens} tokens`);
      if (errors.length > 0) {
        console.warn(`⚠️ Encountered ${errors.length} errors during processing:`, errors);
      }
    } catch (error) {
      errors.push({ message: error.message, stack: error.stack });
      console.error("❌ Full sync failed:", error.message, error.stack);
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
      console.log("⚠️ Cron job is already running, skipping...");
      return;
    }

    this.isRunning = true;
    const startTime = new Date();
    let errors = [];

    try {
      console.log(`\n🚀 Starting wallet balances analysis at ${startTime.toISOString()}`);

      // Kiểm tra dữ liệu trong bảng Tokens
      const tokensResult = await pool.query(`
        SELECT COUNT(*) as count FROM tokens
      `);
      const tokenCount = parseInt(tokensResult.rows[0].count, 10);
      if (tokenCount === 0) {
        console.error("❌ No tokens found in the database. Please run full sync first.");
        throw new Error("No tokens found in the database");
      }
      console.log(`✅ Found ${tokenCount} tokens in the database`);

      // Kiểm tra dữ liệu trong bảng Token_Holders
      const holdersResult = await pool.query(`
        SELECT COUNT(*) as count FROM token_holders
      `);
      const holderCount = parseInt(holdersResult.rows[0].count, 10);
      if (holderCount === 0) {
        console.error("❌ No holders found in the database. Please run full sync first.");
        throw new Error("No holders found in the database");
      }
      console.log(`✅ Found ${holderCount} holders in the database`);

      // Load lại name tags để đảm bảo dữ liệu mới nhất
      await this.loadNameTags();
      console.log("✅ Name tags reloaded for balance analysis");

      // Xóa holdersWithNameTags cũ và rebuild từ token_holders
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
      console.log(`✅ Loaded ${this.holdersWithNameTags.size} holders with name tags from database`);

      // Chạy phân tích wallet balances
      console.log("📊 Starting processWalletBalances...");
      await this.processWalletBalances();
      console.log("✅ Completed processWalletBalances");

      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000 / 60);
      console.log(`\n✅ Wallet balances analysis completed successfully!`);
      console.log(`⏱️ Total duration: ${duration} minutes`);
      console.log(`📊 Processed ${this.holdersWithNameTags.size} holders`);
      if (errors.length > 0) {
        console.warn(`⚠️ Encountered ${errors.length} errors during processing:`, errors);
      }
    } catch (error) {
      errors.push({ message: error.message, stack: error.stack });
      console.error("❌ Wallet balances analysis failed:", error.message, error.stack);
      throw error;
    } finally {
      this.isRunning = false;
      this.holdersWithNameTags.clear();
    }
  }

  startCronJob() {
    const mode = process.argv[2]; // Lấy tham số command line (e.g., 'analyze-balances' hoặc để trống)
    console.log(`⏰ Setting up cron job in ${mode || 'full'} mode...`);

    if (mode === 'analyze-balances') {
      console.log("🔄 Running initial balances analysis...");
      setTimeout(async () => {
        try {
          await this.runAnalyzeBalancesOnly();
        } catch (error) {
          console.error("❌ Initial balances analysis failed:", error.message, error.stack);
        }
      }, 5000);
    } else {
      console.log("⏰ Scheduling full sync to run every 5 days at 2:00 AM...");
      cron.schedule(
        "0 2 */5 * *",
        async () => {
          console.log("⏰ Cron job triggered at", new Date().toISOString());
          await this.runFullCycle();
        },
        {
          scheduled: true,
          timezone: "UTC",
        }
      );
      console.log("✅ Cron job scheduled successfully");

      console.log("🔄 Running initial full sync...");
      setTimeout(async () => {
        try {
          await this.runFullCycle();
        } catch (error) {
          console.error("❌ Initial sync failed:", error.message, error.stack);
        }
      }, 5000);
    }

    process.on("uncaughtException", (err) => {
      console.error("Uncaught Exception:", err.message, err.stack);
    });
    process.on("unhandledRejection", (reason, promise) => {
      console.error("Unhandled Rejection at:", promise, "reason:", reason);
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
    console.log("🧹 Cleaning up connections...");
    try {
      await redisClient.quit();
      await pool.end();
      console.log("✅ Cleanup completed");
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

    const mode = process.argv[2] || 'full';
    console.log(`🎯 Token Holders Cron Job is running in ${mode} mode...`);
    if (mode === 'analyze-balances') {
      console.log("📊 Mode: Analyze wallet balances only");
    } else {
      console.log("📅 Next full sync: Every 5 days at 2:00 AM UTC");
      console.log("🔄 Processing: Up to 500 tokens with 15-second intervals");
      console.log("📊 Chains: All supported EVM chains + Bitcoin/Dogecoin treasury data");
    }

    process.on("SIGINT", async () => {
      console.log("\n🛑 Received SIGINT, shutting down gracefully...");
      await cronJob.cleanup();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
      await cronJob.cleanup();
      process.exit(0);
    });
  } catch (error) {
    console.error("❌ Failed to start cron job:", error.message);
    process.exit(1);
  }
}

main().catch(console.error);