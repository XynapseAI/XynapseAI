import { NFTStorage } from 'nft.storage'
import { filesFromPaths } from 'files-from-path' // Thư viện giúp đọc file nhẹ hơn
import path from 'path'
import dotenv from 'dotenv'

dotenv.config()

// Kiểm tra API Key
if (!process.env.NFT_STORAGE_API_KEY) {
  console.error("❌ Thiếu API Key trong file .env")
  process.exit(1)
}

const client = new NFTStorage({
  token: process.env.NFT_STORAGE_API_KEY
})

const METADATA_DIR = path.join(process.cwd(), 'metadata')

async function uploadAllMetadata() {
  console.log(`📂 Đang đọc thư mục: ${METADATA_DIR}`)

  // 1. Lấy danh sách file nhưng KHÔNG đọc nội dung vào RAM ngay lập tức
  // filesFromPaths sẽ tạo ra các luồng (streams) để upload hiệu quả
  const files = await filesFromPaths(METADATA_DIR, {
    pathPrefix: path.resolve(METADATA_DIR), // Giữ nguyên tên file (1.json, 2.json...)
    hidden: false, // Bỏ qua file ẩn
  })

  // Lọc chỉ lấy file .json (đề phòng file .DS_Store của Mac hoặc file rác)
  const jsonFiles = []
  for (const f of files) {
      if (f.name.endsWith('.json')) {
          jsonFiles.push(f)
      }
  }

  console.log(`📦 Tìm thấy: ${jsonFiles.length} file JSON.`)
  console.log(`🚀 Bắt đầu upload lên IPFS (Quá trình này có thể mất vài phút)...`)

  try {
    // 2. Upload toàn bộ thư mục 1 lần duy nhất để lấy 1 CID chung
    const cid = await client.storeDirectory(jsonFiles)
    
    console.log('==============================')
    console.log('🎉 UPLOAD THÀNH CÔNG!')
    console.log(`✅ Root CID: ${cid}`)
    console.log(`🌐 Base URI cho Contract: ipfs://${cid}/`)
    console.log(`🔍 Test Link: https://nftstorage.link/ipfs/${cid}/1.json`)
    console.log('==============================')
    
  } catch (err) {
    console.error('❌ Upload thất bại:', err)
  }
}

uploadAllMetadata().catch(console.error)