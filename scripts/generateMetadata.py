import json
import os

# =========================
# CONFIG
# =========================
NUM_TOKENS = 10000
BASE_DIR = "metadata"

IMAGE_CID = "QmTofP7etC2SNP4dfGz3aposQCHAtkLSHB9VqNNyWo4Mim" 
IMAGE_URL = f"ipfs://{IMAGE_CID}"

EXTERNAL_BASE = "https://xynapseai.net/genesis/"

# =========================
# PREPARE FOLDER
# =========================
os.makedirs(BASE_DIR, exist_ok=True)

print("📦 Generating NFT metadata...")
print(f"🧱 Total tokens: {NUM_TOKENS}")
print(f"🖼️ Image URI: {IMAGE_URL}")
print(f"📂 Output folder: {BASE_DIR}/")
print("=================================")

# =========================
# GENERATE FILES
# =========================
for token_id in range(1, NUM_TOKENS + 1):
    metadata = {
        "name": f"Xynapse Genesis #{token_id}",
        "description": (
            "Exclusive Genesis NFT – Rewards for early adopters and "
            "access to premium features within the XynapseAI ecosystem."
        ),
        "image": IMAGE_URL,
        "external_url": f"{EXTERNAL_BASE}{token_id}",
        "attributes": [
            {
                "trait_type": "Edition",
                "value": "Genesis"
            },
            {
                "trait_type": "Rarity",
                "value": "Unique (All Identical)"
            }
        ]
    }

    file_path = os.path.join(BASE_DIR, f"{token_id}.json")
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)

    if token_id % 1000 == 0:
        print(f"✅ Generated {token_id}/{NUM_TOKENS} metadata files")

print("=================================")
print("🎉 DONE")
print(f"📄 Total files: {NUM_TOKENS}")
print(f"📂 Location: {BASE_DIR}/*.json")
print("=================================")
