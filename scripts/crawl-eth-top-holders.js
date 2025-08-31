// scripts/crawl-top-holders.js
// (Đã đổi tên file để phù hợp hơn)
import axios from "axios";
import { load } from "cheerio";
import fs from "fs";
import path from "path";
import cron from "node-cron";

// --- CẤU HÌNH CÁC TRANG CẦN CRAWL ---
const TARGETS = [
    {
        name: "Ethereum",
        url: "https://etherscan.io/accounts/1?ps=100",
        outputFile: path.join(process.cwd(), "public", "nametags", "eth-top-holders.json"),
        chainLabel: "ethereum", // Thêm nhãn để định danh
    },
    {
        name: "BNB Smart Chain",
        url: "https://bscscan.com/accounts/1?ps=100",
        outputFile: path.join(process.cwd(), "public", "nametags", "bnb-top-holders.json"),
        chainLabel: "binance-smart-chain", // Thêm nhãn để định danh
    },
    // Bạn có thể dễ dàng thêm các trang khác ở đây, ví dụ: Polygonscan
];

// Utility: Chuẩn hóa khoảng trắng
function cleanText(s = "") {
    return s.replace(/\s+/g, " ").trim();
}

/**
 * Hàm crawl chung cho các trang explorer (Etherscan, BscScan, ...)
 * @param {string} url - URL của trang accounts
 * @param {string} outputFile - Đường dẫn file JSON để lưu kết quả
 * @param {string} chainName - Tên của chuỗi (vd: "Ethereum") để log
 * @param {string} chainLabel - Nhãn để dùng trong cấu trúc JSON
 */
async function crawlTopHolders(url, outputFile, chainName, chainLabel) {
    console.log(`🚀 Bắt đầu crawl dữ liệu cho ${chainName}...`);
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

                // Cột 2: Address
                const addressAnchor = $(tds[1]).find('a[href^="/address/"]').first();
                if (!addressAnchor.length) return;
                const address = addressAnchor.attr("href").split("/").pop().toLowerCase();
                if (!address) return;

                // Cột 3: Name Tag
                let nameTag = cleanText($(tds[2]).text());
                if (!nameTag || nameTag.length === 0) {
                    nameTag = null;
                }

                // Cột 4: Balance
                const balanceRaw = $(tds[3]).text().trim();
                const numericMatch = balanceRaw.replace(/,/g, "").match(/[\d.]+/);
                const balance = numericMatch ? parseFloat(numericMatch[0]) : null;

                if (address && balance !== null) {
                    result[address] = {
                        Address: address,
                        Balance: balance,
                        Labels: {
                            [chainLabel]: { // Sử dụng nhãn chuỗi động
                                "Name Tag": nameTag,
                                Description: null,
                                Subcategory: "Others",
                                image: null,
                            },
                        },
                    };
                }
            } catch (rowErr) {
                console.warn(`[${chainName}] Lỗi khi xử lý một hàng:`, rowErr?.message || rowErr);
            }
        });

        if (Object.keys(result).length === 0) {
            console.warn(`⚠️ [${chainName}] Không lấy được dữ liệu nào. Có thể cấu trúc trang đã thay đổi hoặc request bị chặn.`);
            return;
        }

        fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), "utf8");
        console.log(`[${new Date().toISOString()}] ✅ [${chainName}] Đã lưu ${Object.keys(result).length} địa chỉ vào ${outputFile}`);

    } catch (err) {
        console.error(`❌ [${chainName}] Lỗi nghiêm trọng trong quá trình crawl:`, err.message || err);
    }
}

// --- HÀM CHẠY CHÍNH ---
async function runAllCrawlers() {
    console.log(`[${new Date().toISOString()}] Bắt đầu chu trình crawl dữ liệu...`);
    for (const target of TARGETS) {
        await crawlTopHolders(target.url, target.outputFile, target.name, target.chainLabel);
    }
    console.log(`[${new Date().toISOString()}] Hoàn tất chu trình crawl.`);
}

// Chạy ngay lần đầu
runAllCrawlers();

// Lập lịch chạy hằng ngày
cron.schedule("0 1 * * *", () => {
    console.log(`[${new Date().toISOString()}] Bắt đầu chạy crawl theo lịch...`);
    runAllCrawlers();
});