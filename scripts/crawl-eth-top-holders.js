// scripts/crawl-eth-top-holders.js
import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import cron from "node-cron";

const URL = "https://etherscan.io/accounts/1?ps=100";
const OUTPUT_FILE = path.join(process.cwd(), "public", "nametags", "eth-top-holders.json");

// Utility: normalize whitespace and remove "Image:" junk
function cleanText(s = "") {
  return s.replace(/Image:\s*/gi, "").replace(/\s+/g, " ").trim();
}

async function crawlEtherscan(pageUrl = URL) {
  try {
    const { data } = await axios.get(pageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 15000,
    });

    const $ = cheerio.load(data);
    const result = {};

    $("table tbody tr").each((_, el) => {
      try {
        const tds = $(el).find("td");
        if (tds.length < 3) return; // skip malformed rows

        // 1) Address: prefer anchor with /address/
        const addrAnchor = $(tds[1]).find('a[href^="/address/"], a[href*="/address/"]').first();
        let address = addrAnchor.attr("href") ? addrAnchor.attr("href").split("/").pop() : null;
        if (address) address = address.toLowerCase();

        // fallback: try to find any 0x... in the cell
        if (!address) {
          const maybe = $(tds[1]).text().match(/0x[a-fA-F0-9]{40}/);
          if (maybe) address = maybe[0].toLowerCase();
        }
        if (!address) return;

        // 2) Name Tag: clone the cell, remove anchors/images/svg/icons, then read remaining text
        const cellClone = $(tds[1]).clone();
        cellClone.find("a, img, svg, i, button").remove();
        let nameTag = cleanText(cellClone.text());

        // Some pages put the name in a span; if clone approach yields empty, try explicit selectors
        if (!nameTag) {
          const spanCandidate = $(tds[1]).find("span.d-block, span.text-truncate, small, div").filter(function () {
            const txt = $(this).text().trim();
            // accept if not an address and not empty and not "Image:" etc
            return txt && !/0x[a-fA-F0-9]{6,}/.test(txt) && !/^Image:/i.test(txt);
          }).first();
          nameTag = cleanText(spanCandidate.text() || "");
        }

        if (!nameTag) nameTag = null;

        // 3) Balance: use regex to extract first numeric token (remove commas)
        const balanceRaw = $(tds[2]).text().trim();
        const numericMatch = balanceRaw.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
        const balance = numericMatch ? parseFloat(numericMatch[0]) : null;

        // Debug log (uncomment if you want detailed per-row logs)
        // console.log({ address, nameTag, balanceRaw, balance });

        result[address] = {
          Address: address,
          Balance: balance,
          Labels: {
            ethereum: {
              "Name Tag": nameTag,
              Description: null,
              Subcategory: "Others",
              image: null,
            },
          },
        };
      } catch (rowErr) {
        // ignore single-row parse failures
        console.warn("Row parse error:", rowErr?.message || rowErr);
      }
    });

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2), "utf8");
    console.log(`[${new Date().toISOString()}] ✅ Saved ${Object.keys(result).length} entries to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("❌ Error crawling Etherscan:", err.message || err);
  }
}

// Run once immediately
crawlEtherscan();

// Cron job: chạy mỗi ngày lúc 01:00 sáng
cron.schedule("0 1 * * *", () => {
  console.log(`[${new Date().toISOString()}] Starting scheduled crawl...`);
  crawlEtherscan();
});
