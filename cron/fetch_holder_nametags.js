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
  maxConcurrent: 5,
  minTime: 1200,
});

const simLimiter = new Bottleneck({
  maxConcurrent: 3,
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
  }

  // Map name_tag to simplified name (take first word)
  mapNameTagToName(nameTag) {
    if (!nameTag) return null;
    const lowerTag = nameTag.toLowerCase();
    const mapping = {
      "gnosis safe proxy": "gnosis",
      "bybit cold wallet": "bybit",
      "okx hot wallet": "okx",
      "chainlink: communitystakingpool": "chainlink",
      "binance: cold wallet": "binance",
      "aave ethereum link (aethlink)": "aave",
    };
    // Check for direct mapping
    for (const [key, value] of Object.entries(mapping)) {
      if (lowerTag.includes(key.toLowerCase())) return value;
    }
    // Take the first word after splitting by spaces, dashes, or colons
    const words = lowerTag.split(/[\s:-]+/);
    return words[0] ? words[0].trim() : null;
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
    console.log("📂 Loading name tags from public/nametags directory...");
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
              if (nameTag) {
                this.nameTags.set(`${chainKey}:${address.toLowerCase()}`, nameTag);
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
      console.log(`✅ Total name tags loaded: ${this.nameTags.size}`);
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
        rank INTEGER,
        source VARCHAR(50) DEFAULT 'sim',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(coingecko_id, chain, holder_address)
      );
    `;

    const createIndexes = `
      CREATE INDEX IF NOT EXISTS idx_tokens_coingecko_id ON tokens(coingecko_id);
      CREATE INDEX IF NOT EXISTS idx_holders_token_chain ON token_holders(coingecko_id, chain);
      CREATE INDEX IF NOT EXISTS idx_holders_created_at ON token_holders(created_at);
      CREATE INDEX IF NOT EXISTS idx_holders_name ON token_holders(name);
    `;

    await pool.query(createTokensTable);
    await pool.query(createHoldersTable);
    await pool.query(createIndexes);
  }

  async fetchTokensFromCoinGecko() {
    console.log("🔄 Fetching tokens from CoinGecko (limited to 10 for testing)...");
    try {
      const response = await coingeckoLimiter.schedule(() =>
        axios.get("https://api.coingecko.com/api/v3/coins/markets", {
          params: {
            vs_currency: "usd",
            order: "market_cap_desc",
            per_page: 10,
            page: 1,
            sparkline: false,
            price_change_percentage: "24h",
          },
          headers: {
            "x-cg-demo-api-key": process.env.COINGECKO_API_KEY || "",
          },
          timeout: 30000,
        })
      );

      const tokens = response.data;
      if (!Array.isArray(tokens) || tokens.length === 0) {
        console.error("❌ CoinGecko returned invalid or empty data:", tokens);
        throw new Error("Invalid or empty token data from CoinGecko");
      }
      console.log(`✅ Fetched ${tokens.length} tokens from CoinGecko`, {
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

        console.log("⏳ Waiting 10 seconds before next token...");
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }

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
    console.log(`📊 Token ${token.symbol} supported on ${supportedPlatforms.length} chains`, {
      chains: supportedPlatforms,
      platforms: Object.keys(platforms).slice(0, 5),
    });

    if (["bitcoin", "dogecoin"].includes(token.coingecko_id)) {
      await this.processTreasuryData(token);
    }

    for (const chain of supportedPlatforms) {
      try {
        const tokenAddress = platforms[chain].contract_address;
        console.log(`  📡 Fetching holders for ${token.symbol} on ${chain} (address: ${tokenAddress})`);
        await this.fetchAndStoreHolders(token, chain, tokenAddress);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`    ❌ Error processing ${token.symbol} on ${chain}:`, {
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
      console.log(`  🏛️ Fetching treasury data for ${token.coingecko_id}...`);

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
            const nameTag = company.address
              ? this.nameTags.get(`${token.coingecko_id}:${company.address.toLowerCase()}`) || company.name || null
              : company.name || null;

            if (!nameTag) return null;

            const name = this.mapNameTagToName(nameTag);
            const rawBalance = Number.parseFloat(company.total_holdings) || 0;
            // Adjust balance to 6 decimals only if decimals > 6, otherwise use raw balance
            const balance = decimals > 6 ? rawBalance / Math.pow(10, decimals - 6) : rawBalance;

            // Log balance details for debugging
            console.log(`      ℹ️ Treasury balance details:`, {
              holder_address: company.address || company.name || `company_${index}`,
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
              rank: index + 1,
              source: "coingecko_treasury",
            };
          })
          .filter((holder) => holder !== null && holder.name_tag !== null);

        if (holders.length === 0) {
          console.log(`    ⚠️ No holders with name tags for ${token.coingecko_id}`);
          return;
        }

        await this.storeHolders(token, token.coingecko_id, null, holders);
        console.log(`    ✅ Stored ${holders.length} treasury holders with name tags for ${token.coingecko_id}`);
      } else {
        console.log(`    ℹ️ No treasury data available for ${token.coingecko_id}`);
      }
    } catch (error) {
      if (error.response?.status === 404) {
        console.log(`    ℹ️ No treasury data available for ${token.coingecko_id}`);
      } else {
        console.error(`    ❌ Error fetching treasury data:`, error.message);
      }
    }
  }

  async fetchAndStoreHolders(token, chain, tokenAddress) {
    try {
      const decimals = token.detail_platforms?.[chain]?.decimal_place ?? token.decimals ?? 18;

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

      console.log(`📡 SIM API response for ${token.symbol} on ${chain}:`, {
        success: response.data?.success,
        dataLength: response.data?.data?.length,
        sample: response.data?.data?.slice(0, 2),
      });

      if (!response.data?.success || !Array.isArray(response.data.data)) {
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

      const holders = response.data.data
        .map((holder, index) => {
          // 🚨 SỬA LỖI 1: Quay lại dùng key 'uniswap:' cố định để tra cứu name tag
          const nameTag = this.nameTags.get(`uniswap:${holder.address.toLowerCase()}`) || null;
          if (!nameTag) return null;

          // 🚨 SỬA LỖI 2: Sửa lại tên hàm đúng (bỏ "ag")
          const name = this.mapNameTagToName(nameTag);

          const calculatedBalance = Number(holder.balance) || 0;

          const balance_usd = calculatedBalance * priceUsd;
          const percentage = totalSupply > 0 ? (calculatedBalance / totalSupply) * 100 : 0;

          console.log(`       ℹ️ Holder balance details:`, {
            holder_address: holder.address,
            name_tag: nameTag, // Thêm log để kiểm tra
            final_balance: calculatedBalance,
            balance_usd: balance_usd,
            percentage: percentage,
            chain: chain,
          });

          return {
            holder_address: holder.address,
            balance: calculatedBalance,
            balance_usd: balance_usd,
            percentage: percentage,
            name_tag: nameTag,
            name: name,
            rank: index + 1,
            source: "sim",
          };
        })
        .filter((holder) => holder !== null && holder.name_tag !== null);

      if (holders.length === 0) {
        console.log(`     ⚠️ No holders with name tags for ${token.symbol} on ${chain}`);
        return;
      }

      await this.storeHolders(token, chain, tokenAddress, holders);
      console.log(`     ✅ Stored ${holders.length} holders with name tags for ${token.symbol} on ${chain}`);
    } catch (error) {
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
    }
  }

  async storeHolders(token, chain, tokenAddress, holders) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
      DELETE FROM token_holders 
      WHERE coingecko_id = $1 AND chain = $2
    `,
        [token.coingecko_id, chain]
      );

      let insertedCount = 0;
      for (const holder of holders) {
        try {
          const result = await client.query(
            `
          INSERT INTO token_holders (
            token_id, coingecko_id, chain, token_address, holder_address, 
            balance, balance_usd, percentage, name_tag, name, rank, source
          ) VALUES (
            (SELECT id FROM tokens WHERE coingecko_id = $1),
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
          )
          ON CONFLICT (coingecko_id, chain, holder_address) 
          DO UPDATE SET
            balance = EXCLUDED.balance,
            balance_usd = EXCLUDED.balance_usd,
            percentage = EXCLUDED.percentage,
            name_tag = EXCLUDED.name_tag,
            name = EXCLUDED.name,
            rank = EXCLUDED.rank,
            source = EXCLUDED.source,
            created_at = CURRENT_TIMESTAMP
          RETURNING id
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
              holder.rank,
              holder.source,
            ]
          );
          insertedCount++;
          console.log(`      ✅ Inserted holder ${holder.holder_address} for ${token.symbol} on ${chain}`, {
            db_id: result.rows[0]?.id,
            name_tag: holder.name_tag,
            name: holder.name,
            balance: holder.balance,
          });
        } catch (error) {
          console.error(`      ❌ Error storing holder ${holder.holder_address}:`, {
            message: error.message,
            detail: error.detail,
            code: error.code,
          });
        }
      }

      await client.query("COMMIT");
      console.log(`    ✅ Committed ${insertedCount}/${holders.length} holders for ${token.symbol} on ${chain}`);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`    ❌ Transaction rollback for ${token.symbol} on ${chain}:`, error.message);
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
    }
  }

  startCronJob() {
    console.log("⏰ Setting up cron job to run every 5 days at 2:00 AM...");

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

    console.log("🔄 Running initial sync...");
    setTimeout(async () => {
      try {
        await this.runFullCycle();
      } catch (error) {
        console.error("❌ Initial sync failed:", error.message, error.stack);
      }
    }, 5000);

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

    console.log("🎯 Token Holders Cron Job is running...");
    console.log("📅 Next run: Every 5 days at 2:00 AM UTC");
    console.log("🔄 Processing: 10 tokens with 10-second intervals");
    console.log("📊 Chains: All supported EVM chains + Bitcoin/Dogecoin treasury data");

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