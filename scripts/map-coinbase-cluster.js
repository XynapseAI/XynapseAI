import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ file input 
const inputFile = path.join(__dirname, "../public/nametags/coinbase_cluster0.json"); 

// ✅ file output
const outputFile = path.join(__dirname, "../public/nametags/coinbase-cluster.json");

const iconMap = {
  "coinbase": "/icons/coinbase.webp",
  "binance": "/icons/binance.webp",
  "robinhood": "/icons/robinhood.webp"
};

function getIcon(nametag) {
  const key = nametag.toLowerCase();
  if (key.includes("coinbase")) return iconMap.coinbase;
  if (key.includes("binance")) return iconMap.binance;
  if (key.includes("robinhood")) return iconMap.robinhood;
  return "/icons/default.webp";
}

function transformData(data) {
  let result = {};
  for (let item of data) {
    const addr = item.address;
    result[addr] = {
      Address: addr,
      Balance: 0,
      Labels: {
        bitcoin: {
          "Name Tag": item.nametag,
          "Description": null,
          "Subcategory": "Others",
          "image": getIcon(item.nametag)
        }
      }
    };
  }
  return result;
}

async function main() {
  const raw = fs.readFileSync(inputFile, "utf-8");
  const data = JSON.parse(raw);

  // transform
  const transformed = transformData(data);

  fs.writeFileSync(outputFile, JSON.stringify(transformed, null, 2), "utf-8");

  console.log(`✅ Done! Output saved to: ${outputFile}`);
}

main();
