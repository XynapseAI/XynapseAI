// scripts/crawl-top-holders.js
import axios from "axios";
import { load } from "cheerio";
import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
import fs from "fs/promises";
import path from "path";
import { fi } from "zod/v4/locales";
import { gray } from "d3";
import { bit } from "drizzle-orm/pg-core";

// --- Khởi tạo Prisma Client ---
const prisma = new PrismaClient({
  log: ["error"], // Bật logging để debug
  errorFormat: "pretty",
});

// --- CONFIGURATION FOR PAGES TO CRAWL ---
const TARGETS = [
  {
    name: "Ethereum",
    type: "etherscan",
    url: "https://etherscan.io/accounts/1?ps=100",
    chainLabel: "ethereum",
  },
  {
    name: "BNB Smart Chain",
    type: "etherscan",
    url: "https://bscscan.com/accounts/1?ps=100",
    chainLabel: "binance-smart-chain",
  },
  {
    name: "Bitcoin",
    type: "bitinfocharts",
    urls: [
      "https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html",
      "https://bitinfocharts.com/top-100-richest-bitcoin-addresses-2.html",
    ],
    chainLabel: "bitcoin",
  },
  {
    name: "Litecoin",
    type: "bitinfocharts",
    urls: [
      "https://bitinfocharts.com/top-100-richest-litecoin-addresses.html",
      "https://bitinfocharts.com/top-100-richest-litecoin-addresses-2.html",
    ],
    chainLabel: "litecoin",
  },
  {
    name: "Dogecoin",
    type: "bitinfocharts",
    urls: [
      "https://bitinfocharts.com/top-100-richest-dogecoin-addresses.html",
      "https://bitinfocharts.com/top-100-richest-dogecoin-addresses-2.html",
    ],
    chainLabel: "dogecoin",
  },
  {
    name: "Bitcoin ETFs",
    type: "bitbo",
    url: "https://bitbo.io/treasuries/us-etfs",
    chainLabel: "bitcoin",
  },
];

// Map chainLabel to JSON file(s)
const chainToFiles = {
  ethereum: ['eth-top-holders.json'],
  'binance-smart-chain': ['bnb-top-holders.json'],
  bitcoin: ['bitcoin-top-holders.json', 'btc-top-holders.json'],
  litecoin: ['litecoin-top-holders.json'],
  dogecoin: ['dogecoin-top-holders.json'],
};

// Keyword to image mapping
const keywordToImage = {
  binance: 'binance.webp',
  coinbase: 'coinbase.webp',
  bybit: 'bybit.webp',
  bitget: 'bitget.webp',
  okx: 'okx.webp',
  kraken: 'kraken.webp',
  uniswap: 'uniswap.webp',
  tether: 'tether.webp',
  blackrock: 'blackrock.webp',
  bitstamp: 'bitstamp.webp',
  aave: 'aave.webp',
  robinhood: 'robinhood.webp',
  circle: 'circle.webp',
  sushiswap: 'sushiswap.webp',
  upbit: 'upbit.webp',
  huobi: 'huobi.webp',
  mantle: 'mantle.webp',
  mexc: 'mexc.webp',
  kucoin: 'kucoin.webp',
  arbitrum: 'arbitrum.webp',
  chainlink: 'chainlink.webp',
  coinone: 'coinone.webp',
  gate: 'gate.webp',
  curve: 'curve.webp',
  jump: 'jump.webp',
  optimism: 'optimism.webp',
  polygon: 'polygon.webp',
  government: 'government.webp',
  bitfinex: 'bitfinex.webp',
  ceffu: 'ceffu.webp',
  bingx: 'bingx.webp',
  gnosis: 'gnosis.webp',
  fluid: 'fluid.webp',
  ethena: 'ethena.webp',
  sui: 'sui.webp',
  crypto: 'crypto.webp',
  hyperliquid: 'hyperliquid.webp',
  balancer: 'balancer.webp',
  multichain: 'multichain.webp',
  synthetix: 'synthetix.webp',
  wintermute: 'wintermute.webp',
  bsc: 'binance.webp',
  bnb: 'binance.webp',
  opbnb: 'binance.webp',
  tornado: 'tornado.webp',
  beacon: 'beacon.webp',
  ether: 'eth.webp',
  base: 'coinbase.webp',
  gemini: 'gemini.webp',
  polkadot: 'polkadot.webp',
  ethdev: 'eth.webp',
  linea: 'linea.webp',
  bitbank: 'bitbank.webp',
  phemex: 'phemex.webp',
  makerdao: 'makerdao.webp',
  lighter: 'lighter.webp',
  morpho: 'morpho.webp',
  usdt: 'tether.webp',
  deribit: 'deribit.webp',
  worldcoin: 'worldcoin.webp',
  hashnode: 'hashnode.webp',
  starknet: 'starknet.webp',
  justin: 'justinsun.webp',
  cz: 'cz.webp',
  world: 'wlfi.webp',
  vitalik: 'vitalik.webp',
  vaneck: 'vaneck.webp',
  bitmex: 'bitmex.webp',
  purpose: 'purpose.webp',
  mt: 'mtgox.webp',
  microstrategy: 'microstrategy.webp',
  mara: 'mara.webp',
  twenty: 'twentyone.webp',
  marathon: 'marathon.webp',
  riot: 'riot.webp',
  trump: 'trump.webp',
  metaplanet: 'metaplanet.webp',
  galaxy: 'galaxy.webp',
  cleanspark: 'cleanspark.webp',
  tesla: 'tesla.webp',
  hut: 'hut8.webp',
  revolut: 'revolut.webp',
  bithumb: 'bithumb.webp',
  river: 'river.webp',
  paxos: 'paxos.webp',
  maskex: 'maskex.webp',
  satoshi: 'satoshi.webp',
  okex: 'okx.webp',
  uk: 'uk.webp',
  coincheck: 'coincheck.webp',
  '1inch': '1inch.webp',
  lido: 'lido.webp',
  gemini: 'gemini.webp',
  avalanche: 'avalanche.webp',
  wormhole: 'wormhole.webp',
  htx: 'htx.webp',
  eigen: 'eigenlayer.webp',
  blast: 'blast.webp',
  immutable: 'immutable.webp',
  kelpdao: 'kelpdao.webp',
  ens: 'ens.webp',
  ishares : 'blackrock.webp',
  fidelity : 'fidelity.webp',
  '21shares' : '21shares.webp',
  bitwise : 'bitwise.webp',
  vaneck : 'vaneck.webp',
  franklin : 'franklin.webp',
  valkyrie : 'valkyrie.webp',
  invesco : 'invesco.webp',
  wisdom : 'wisdom.webp',
  hashdex : 'hashdex.webp',
};

// Utility: Normalize whitespace
function cleanText(s = "") {
  return s.replace(/\s+/g, " ").trim();
}

// Utility: Get image based on Name Tag
function getImageForNameTag(nameTag) {
  if (!nameTag) return null;
  const nameTagLower = nameTag.toLowerCase();
  for (const keyword in keywordToImage) {
    if (nameTagLower.includes(keyword)) {
      return `/icons/${keywordToImage[keyword]}`;
    }
  }
  return null;
}

// Utility: Delay to avoid rate-limiting
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Hàm thử lại với retry logic
async function withRetry(fn, retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      console.warn(`Attempt ${attempt} failed, retrying in ${delayMs}ms...`, error.message);
      await delay(delayMs);
    }
  }
}

// Hàm lưu dữ liệu vào JSON files
async function saveHoldersToJson(holders, chainLabel) {
  const files = chainToFiles[chainLabel] || [];
  if (files.length === 0) {
    console.warn(`No JSON file configured for chain: ${chainLabel}`);
    return;
  }

  // Sort holders by balance descending
  holders.sort((a, b) => b.balance - a.balance);

  for (const fileName of files) {
    try {
      const jsonPath = path.join(process.cwd(), 'public', 'nametags', fileName);
      let existingData = {};
      try {
        const existingContent = await fs.readFile(jsonPath, 'utf8');
        existingData = JSON.parse(existingContent);
      } catch (readErr) {
        if (readErr.code !== 'ENOENT') {
          console.warn(`Error reading existing JSON file ${jsonPath}:`, readErr.message);
        }
        // If file doesn't exist, start with empty object
        existingData = {};
      }

      // Update or add holders
      holders.forEach((holder) => {
        const addr = holder.address.toLowerCase();
        existingData[addr] = {
          Address: addr,
          Balance: holder.balance,
          Labels: {
            [chainLabel]: {
              'Name Tag': holder.name_tag || null,
              Description: null,
              Subcategory: 'Others',
              image: holder.image || null,
            },
          },
        };
      });

      // Write back to file
      await fs.writeFile(jsonPath, JSON.stringify(existingData, null, 2), 'utf8');
      console.log(`[${new Date().toISOString()}] ✅ Saved ${holders.length} holders to JSON: ${fileName}`);
    } catch (writeErr) {
      console.error(`Error saving to JSON file ${fileName}:`, writeErr.message);
    }
  }
}

// Crawl function for Etherscan/BscScan pages
async function crawlEtherscanTopHolders(url, chainName, chainLabel) {
  console.log(`🚀 Starting data crawl for ${chainName} (Etherscan)...`);
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 20000,
    });

    const $ = load(data);
    const holders = [];

    $("div.table-responsive table tbody tr").each((_, el) => {
      try {
        const tds = $(el).find("td");
        if (tds.length < 6) return;

        const addressAnchor = $(tds[1]).find('a[href^="/address/"]').first();
        if (!addressAnchor.length) return;
        const address = addressAnchor.attr("href").split("/").pop().toLowerCase();
        if (!address) return;

        let nameTag = cleanText($(tds[2]).text());
        if (!nameTag || nameTag.length === 0) {
          nameTag = null;
        }

        const balanceRaw = $(tds[3]).text().trim();
        const numericMatch = balanceRaw.replace(/,/g, "").match(/[\d.]+/);
        const balance = numericMatch ? parseFloat(numericMatch[0]) : null;

        if (address && balance !== null) {
          holders.push({
            chain: chainLabel,
            address,
            balance,
            name_tag: nameTag,
            image: getImageForNameTag(nameTag),
          });
        }
      } catch (rowErr) {
        console.warn(`[${chainName}] Error processing a row:`, rowErr?.message || rowErr);
      }
    });

    if (holders.length === 0) {
      console.warn(`⚠️ [${chainName}] No data retrieved. Page structure may have changed or request was blocked.`);
      return;
    }

    // Lưu vào database và JSON
    await saveHoldersToDatabase(holders, chainName, chainLabel);
    await saveHoldersToJson(holders, chainLabel);
    console.log(`[${new Date().toISOString()}] ✅ [${chainName}] Saved ${holders.length} addresses to database and JSON`);
  } catch (err) {
    console.error(`❌ [${chainName}] Critical error during crawl:`, err.message || err);
  }
}

// Crawl function for Bitinfocharts pages using axios + cheerio
async function crawlBitinfochartsTopHolders(urls, chainName, chainLabel) {
  console.log(`🚀 Starting data crawl for ${chainName} (Bitinfocharts)...`);
  const holders = [];

  try {
    for (const url of urls) {
      console.log(`📄 Crawling page: ${url}`);
      const { data } = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 20000,
      });

      const $ = load(data);
      const tables = ["table#tblOne tbody tr", "table#tblOne2 tbody tr"];
      let totalRows = 0;

      for (const tableSelector of tables) {
        const rows = $(tableSelector);
        console.log(`[${chainName}] Found ${rows.length} rows in ${tableSelector} on ${url}`);
        totalRows += rows.length;

        rows.each((index, el) => {
          try {
            const tds = $(el).find("td");
            if (tds.length < 3) {
              console.warn(`[${chainName}] Skipping row ${index + 1} in ${tableSelector}: Insufficient columns (only ${tds.length})`);
              return;
            }

            const addressAnchor = $(tds[1]).find('a[href*="/address/"]').first();
            if (!addressAnchor.length) {
              console.warn(`[${chainName}] Skipping row ${index + 1} in ${tableSelector}: Address anchor not found`);
              return;
            }
            const addressMatch = addressAnchor.attr("href").match(/address\/([^\?]+)/);
            if (!addressMatch || !addressMatch[1]) {
              console.warn(`[${chainName}] Skipping row ${index + 1} in ${tableSelector}: Could not extract address from href`);
              return;
            }
            const address = addressMatch[1].toLowerCase();
            if (!address) {
              console.warn(`[${chainName}] Skipping row ${index + 1} in ${tableSelector}: Empty address`);
              return;
            }

            let nameTag = cleanText($(tds[1]).find('a[href*="/wallet/"]').text());
            if (nameTag && nameTag.startsWith("wallet:")) {
              nameTag = nameTag.replace(/^wallet:\s*/, "").trim();
            }
            if (!nameTag || nameTag.length === 0) {
              nameTag = null;
            }

            const balanceRaw = $(tds[2]).text().trim();
            const numericMatch = balanceRaw.match(/([\d,.]+)\s*(BTC|LTC|DOGE)/i);
            if (!numericMatch) {
              console.warn(`[${chainName}] Skipping row ${index + 1} in ${tableSelector}: Unable to parse Balance: ${balanceRaw}`);
              return;
            }
            const balance = parseFloat(numericMatch[1].replace(/,/g, ""));
            if (isNaN(balance)) {
              console.warn(`[${chainName}] Skipping row ${index + 1} in ${tableSelector}: Balance is not a number: ${balanceRaw}`);
              return;
            }

            holders.push({
              chain: chainLabel,
              address,
              balance,
              name_tag: nameTag,
              image: getImageForNameTag(nameTag),
            });
          } catch (rowErr) {
            console.warn(`[${chainName}] Error processing row ${index + 1} in ${tableSelector}:`, rowErr?.message || rowErr);
          }
        });
      }

      console.log(`[${chainName}] Total ${totalRows} rows found on ${url}`);
      await delay(3000);
    }

    // Thêm dữ liệu cứng cho Bitcoin
    if (chainLabel === "bitcoin") {
      const specialAddress = "1a1zp1ep5qgefi2dmptftl5slmv7divfna";
      holders.push({
        chain: chainLabel,
        address: specialAddress,
        balance: 1090000,
        name_tag: "Satoshi Nakamoto",
        image: "/icons/bitcoin.webp",
      });
      console.log(`[${chainName}] Added special address ${specialAddress} (Satoshi Nakamoto) to results`);
    }

    if (holders.length === 0) {
      console.warn(`⚠️ [${chainName}] No data retrieved. Page structure may have changed or request was blocked.`);
      return;
    }

    // Lưu vào database và JSON
    await saveHoldersToDatabase(holders, chainName, chainLabel);
    await saveHoldersToJson(holders, chainLabel);
    console.log(`[${new Date().toISOString()}] ✅ [${chainName}] Saved ${holders.length} addresses to database and JSON`);
  } catch (err) {
    console.error(`❌ [${chainName}] Critical error during crawl:`, err.message || err);
  }
}

// Crawl function for Bitbo pages (US ETFs for Bitcoin)
async function crawlBitboTopHolders(url, chainName, chainLabel) {
  console.log(`🚀 Starting data crawl for ${chainName} (Bitbo)...`);
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 20000,
    });

    const $ = load(data);
    const holders = [];

    $("table.treasuries-table tbody tr").each((_, el) => {
      try {
        const tds = $(el).find("td");
        if (tds.length < 5) return;

        const entityAnchor = $(tds[0]).find("a").first();
        if (!entityAnchor.length) return; // Skip total row or rows without entity link

        const nameTag = cleanText(entityAnchor.text());
        if (!nameTag || nameTag.length === 0) {
          return;
        }

        const href = entityAnchor.attr("href");
        if (!href) return;
        const addressMatch = href.match(/\/treasuries\/([^\?\/]+)/);
        if (!addressMatch || !addressMatch[1]) return;
        const address = addressMatch[1].toLowerCase();

        const balanceRaw = $(tds[4]).text().trim();
        const balanceNumeric = balanceRaw.replace(/,/g, "").match(/[\d.]+/);
        const balance = balanceNumeric ? parseFloat(balanceNumeric[0]) : null;

        if (address && balance !== null) {
          holders.push({
            chain: chainLabel,
            address,
            balance,
            name_tag: nameTag,
            image: getImageForNameTag(nameTag),
          });
        }
      } catch (rowErr) {
        console.warn(`[${chainName}] Error processing a row:`, rowErr?.message || rowErr);
      }
    });

    if (holders.length === 0) {
      console.warn(`⚠️ [${chainName}] No data retrieved. Page structure may have changed or request was blocked.`);
      return;
    }

    // Lưu vào database và JSON
    await saveHoldersToDatabase(holders, chainName, chainLabel);
    await saveHoldersToJson(holders, chainLabel);
    console.log(`[${new Date().toISOString()}] ✅ [${chainName}] Saved ${holders.length} addresses to database and JSON`);
  } catch (err) {
    console.error(`❌ [${chainName}] Critical error during crawl:`, err.message || err);
  }
}

// Hàm lưu dữ liệu vào database với batch và retry
async function saveHoldersToDatabase(holders, chainName, chainLabel) {
  const BATCH_SIZE = 50;
  try {
    for (let i = 0; i < holders.length; i += BATCH_SIZE) {
      const batch = holders.slice(i, i + BATCH_SIZE);
      await withRetry(async () => {
        await prisma.$transaction(
          batch.map((holder) => {
            const updateData = {
              balance: holder.balance,
              image: holder.image,
              updated_at: new Date(),
            };
            // Chỉ cập nhật name_tag nếu nó không null từ nguồn
            if (holder.name_tag !== null) {
              updateData.name_tag = holder.name_tag;
            }
            return prisma.top_holders.upsert({
              where: {
                chain_address: {
                  chain: chainLabel,
                  address: holder.address,
                },
              },
              update: updateData,
              create: {
                chain: chainLabel,
                address: holder.address,
                balance: holder.balance,
                name_tag: holder.name_tag,
                image: holder.image,
                created_at: new Date(),
                updated_at: new Date(),
              },
            });
          }),
          { timeout: 10000 }
        );
      }, 3, 2000);
      console.log(`[${chainName}] Successfully saved batch ${i / BATCH_SIZE + 1} of ${Math.ceil(holders.length / BATCH_SIZE)} (${batch.length} holders)`);
    }
    console.log(`[${chainName}] Successfully saved ${holders.length} holders to database`);
  } catch (error) {
    console.error(`[${chainName}] Error saving to database:`, error.message);
    throw error;
  }
}

async function ensurePrismaConnected() {
  try {
    await prisma.$connect();
    console.log("Prisma client connected");
  } catch (error) {
    console.error("Failed to connect Prisma client:", error.message);
    throw error;
  }
}

// Main function to run all crawlers
async function runAllCrawlers() {
  console.log(`[${new Date().toISOString()}] Starting crawl cycle...`);
  for (const target of TARGETS) {
    if (target.type === "etherscan") {
      await crawlEtherscanTopHolders(target.url, target.name, target.chainLabel);
    } else if (target.type === "bitinfocharts") {
      await crawlBitinfochartsTopHolders(target.urls, target.name, target.chainLabel);
    } else if (target.type === "bitbo") {
      await crawlBitboTopHolders(target.url, target.name, target.chainLabel);
    }
  }
  console.log(`[${new Date().toISOString()}] Crawl cycle completed.`);
}

// Run immediately
runAllCrawlers();

// Schedule daily run at 0h UTC (7h AM Vietnam time)
cron.schedule("0 7 * * *", () => {
  console.log(`[${new Date().toISOString()}] Starting scheduled crawl...`);
  runAllCrawlers();
});

// Cleanup Prisma connection on process exit
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  console.log("Prisma client disconnected");
  process.exit(0);
});