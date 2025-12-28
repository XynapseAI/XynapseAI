import { NFTStorage } from 'nft.storage'
import { filesFromPaths } from 'files-from-path'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config()

if (!process.env.NFT_STORAGE_API_KEY) {
  console.error("❌ Not found API Key")
  process.exit(1)
}

const client = new NFTStorage({
  token: process.env.NFT_STORAGE_API_KEY
})

const METADATA_DIR = path.join(process.cwd(), 'metadata')

async function uploadAllMetadata() {
  console.log(`📂 Reading folder: ${METADATA_DIR}`)

  const files = await filesFromPaths(METADATA_DIR, {
    pathPrefix: path.resolve(METADATA_DIR), 
    hidden: false,
  })

  const jsonFiles = []
  for (const f of files) {
      if (f.name.endsWith('.json')) {
          jsonFiles.push(f)
      }
  }

  console.log(`📦 Founded : ${jsonFiles.length} file JSON.`)
  console.log(`🚀 upload IPFS...`)

  try {
    const cid = await client.storeDirectory(jsonFiles)
    
    console.log('==============================')
    console.log('🎉 UPLOAD Success!')
    console.log(`✅ Root CID: ${cid}`)
    console.log(`🌐 Base URI for Contract: ipfs://${cid}/`)
    console.log(`🔍 Test Link: https://nftstorage.link/ipfs/${cid}/1.json`)
    console.log('==============================')
    
  } catch (err) {
    console.error('❌ Upload failed:', err)
  }
}

uploadAllMetadata().catch(console.error)