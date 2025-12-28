// convert-all-png-to-webp.js
import fs from "fs";
import path from "path";
import sharp from "sharp";

const rootDir = path.join(process.cwd(), "public");

async function convertDir(dir) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      await convertDir(filePath);
    } else {
      const ext = path.extname(file).toLowerCase();
      if (ext === ".png") {
        const fileName = path.basename(file, ext);
        const outputPath = path.join(dir, `${fileName}.webp`);

        try {
          await sharp(filePath)
            .webp({ quality: 80 })
            .toFile(outputPath);

          console.log(`✅ Converted: ${filePath} → ${outputPath}`);

          fs.unlinkSync(filePath);
          console.log(`🗑️ Deleted original: ${filePath}`);
        } catch (err) {
          console.error(`❌ Error converting ${filePath}:`, err);
        }
      }
    }
  }
}

(async () => {
  console.log("🚀 Starting conversion in /public...");
  await convertDir(rootDir);
  console.log("🎉 Done converting all PNG files!");
})();
