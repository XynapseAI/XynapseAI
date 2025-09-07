// scripts/crawl-top-holders.js
import axios from "axios";
import { load } from "cheerio";
import fs from "fs";
import path from "path";
import cron from "node-cron";
import puppeteer from "puppeteer";

// --- CONFIGURATION FOR PAGES TO CRAWL ---
const TARGETS = [
    {
        name: "Ethereum",
        type: "etherscan",
        url: "https://etherscan.io/accounts/1?ps=100",
        outputFile: path.join(process.cwd(), "public", "nametags", "eth-top-holders.json"),
        chainLabel: "ethereum",
    },
    {
        name: "BNB Smart Chain",
        type: "etherscan",
        url: "https://bscscan.com/accounts/1?ps=100",
        outputFile: path.join(process.cwd(), "public", "nametags", "bnb-top-holders.json"),
        chainLabel: "binance-smart-chain",
    },
    {
        name: "Bitcoin",
        type: "bitinfocharts",
        urls: [
            "https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html",
            "https://bitinfocharts.com/top-100-richest-bitcoin-addresses-2.html",
        ],
        outputFile: path.join(process.cwd(), "public", "nametags", "bitcoin-top-holders.json"),
        chainLabel: "bitcoin",
    },
    {
        name: "Litecoin",
        type: "bitinfocharts",
        urls: [
            "https://bitinfocharts.com/top-100-richest-litecoin-addresses.html",
            "https://bitinfocharts.com/top-100-richest-litecoin-addresses-2.html",
        ],
        outputFile: path.join(process.cwd(), "public", "nametags", "litecoin-top-holders.json"),
        chainLabel: "litecoin",
    },
    {
        name: "Dogecoin",
        type: "bitinfocharts",
        urls: [
            "https://bitinfocharts.com/top-100-richest-dogecoin-addresses.html",
            "https://bitinfocharts.com/top-100-richest-dogecoin-addresses-2.html",
        ],
        outputFile: path.join(process.cwd(), "public", "nametags", "dogecoin-top-holders.json"),
        chainLabel: "dogecoin",
    },
];

// Utility: Normalize whitespace
function cleanText(s = "") {
    return s.replace(/\s+/g, " ").trim();
}

// Utility: Delay to avoid rate-limiting
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Crawl function for Etherscan/BscScan pages
 */
async function crawlEtherscanTopHolders(url, outputFile, chainName, chainLabel) {
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
        const result = {};

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
                    result[address] = {
                        Address: address,
                        Balance: balance,
                        Labels: {
                            [chainLabel]: {
                                "Name Tag": nameTag,
                                Description: null,
                                Subcategory: "Others",
                                image: null,
                            },
                        },
                    };
                }
            } catch (rowErr) {
                console.warn(`[${chainName}] Error processing a row:`, rowErr?.message || rowErr);
            }
        });

        if (Object.keys(result).length === 0) {
            console.warn(`⚠️ [${chainName}] No data retrieved. Page structure may have changed or request was blocked.`);
            return;
        }

        fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), "utf8");
        console.log(`[${new Date().toISOString()}] ✅ [${chainName}] Saved ${Object.keys(result).length} addresses to ${outputFile}`);
    } catch (err) {
        console.error(`❌ [${chainName}] Critical error during crawl:`, err.message || err);
    }
}

/**
 * Crawl function for bitinfocharts.com pages using Puppeteer
 * @param {string[]} urls - Array of URLs to crawl
 * @param {string} outputFile - Path to JSON file to save results
 * @param {string} chainName - Name of the chain
 * @param {string} chainLabel - Label used in JSON structure
 */
async function crawlBitinfochartsTopHolders(urls, outputFile, chainName, chainLabel) {
    console.log(`🚀 Starting data crawl for ${chainName} (Bitinfocharts)...`);
    const result = {};
    const browser = await puppeteer.launch({ headless: true });

    try {
        for (const url of urls) {
            console.log(`📄 Crawling page: ${url}`);
            const page = await browser.newPage();
            try {
                await page.setUserAgent(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                );
                await page.setViewport({ width: 1280, height: 800 });

                // Navigate to page and wait
                await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

                // Check for Cloudflare or CAPTCHA
                const cloudflareCheck = await page.evaluate(() => {
                    return document.querySelector('title')?.innerText.includes("Cloudflare") || document.querySelector('#cf-wrapper') !== null;
                });
                if (cloudflareCheck) {
                    console.warn(`⚠️ [${chainName}] Page ${url} may be blocked by Cloudflare.`);
                    await page.close();
                    continue;
                }

                // Scroll page to load all data
                await page.evaluate(async () => {
                    await new Promise(resolve => {
                        let totalHeight = 0;
                        const distance = 100;
                        const timer = setInterval(() => {
                            const scrollHeight = document.body.scrollHeight;
                            window.scrollBy(0, distance);
                            totalHeight += distance;
                            if (totalHeight >= scrollHeight) {
                                clearInterval(timer);
                                resolve();
                            }
                        }, 100);
                    });
                });

                // Wait for both data tables to appear
                await page.waitForSelector("table#tblOne, table#tblOne2", { timeout: 15000 }).catch(() => {
                    console.warn(`[${chainName}] Tables #tblOne or #tblOne2 not found on ${url}`);
                });

                // Get HTML content after rendering
                const data = await page.content();
                const $ = load(data);

                // Process both tables
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
                            // Extract address from href attribute
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
                            // Remove "wallet:" prefix if present
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

                            result[address] = {
                                Address: address,
                                Balance: balance,
                                Labels: {
                                    [chainLabel]: {
                                        "Name Tag": nameTag,
                                        Description: null,
                                        Subcategory: "Others",
                                        image: null,
                                    },
                                },
                            };
                        } catch (rowErr) {
                            console.warn(`[${chainName}] Error processing row ${index + 1} in ${tableSelector}:`, rowErr?.message || rowErr);
                        }
                    });
                }

                console.log(`[${chainName}] Total ${totalRows} rows found on ${url}`);

                await page.close();
                await delay(3000); // Delay 3 seconds between pages
            } catch (pageErr) {
                console.error(`❌ [${chainName}] Error crawling ${url}:`, pageErr.message || pageErr);
                await page.close();
            }
        }

        if (Object.keys(result).length === 0) {
            console.warn(`⚠️ [${chainName}] No data retrieved. Page structure may have changed or request was blocked.`);
            return;
        }

        fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), "utf8");
        console.log(`[${new Date().toISOString()}] ✅ [${chainName}] Saved ${Object.keys(result).length} addresses to ${outputFile}`);
    } finally {
        await browser.close();
    }
}

/**
 * Main function to run all crawlers
 */
async function runAllCrawlers() {
    console.log(`[${new Date().toISOString()}] Starting crawl cycle...`);
    for (const target of TARGETS) {
        if (target.type === "etherscan") {
            await crawlEtherscanTopHolders(target.url, target.outputFile, target.name, target.chainLabel);
        } else if (target.type === "bitinfocharts") {
            await crawlBitinfochartsTopHolders(target.urls, target.outputFile, target.name, target.chainLabel);
        }
    }
    console.log(`[${new Date().toISOString()}] Crawl cycle completed.`);
}

// Run immediately
runAllCrawlers();

// Schedule daily run
cron.schedule("0 1 * * *", () => {
    console.log(`[${new Date().toISOString()}] Starting scheduled crawl...`);
    runAllCrawlers();
});