import os
import logging
import requests
import random
import time
import json
from datetime import datetime, timedelta
import asyncio
from web3 import Web3
import psycopg2
from upstash_redis import Redis
from dotenv import load_dotenv
import tweepy

# --- CONFIGURATION ---

load_dotenv(
    dotenv_path=(
        ".env"
        if os.getenv("NODE_ENV") == "production"
        else "C:/Users/nnn/Desktop/Next/.env"
    )
)

required_envs = [
    "DATABASE_URL",
    "ALCHEMY_API_KEY",
    "CONSUMER_KEY",
    "CONSUMER_SECRET",
    "ACCESS_TOKEN",
    "ACCESS_TOKEN_SECRET",
]
for var in required_envs:
    if not os.getenv(var):
        raise ValueError(f"Missing env var: {var}")

logging.basicConfig(level="INFO", format="%(asctime)s - %(levelname)s - %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("web3").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

MIN_VALUE_USD = 500_000
BASE_URL = "https://xynapseai.net"

ALCHEMY_KEY = os.getenv("ALCHEMY_API_KEY")
ETH_RPC = f"https://eth-mainnet.g.alchemy.com/v2/{ALCHEMY_KEY}"

TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

# --- CLIENT INITIALIZATION ---

r = Redis(
    url=os.getenv("UPSTASH_REDIS_REST_URL"), token=os.getenv("UPSTASH_REDIS_REST_TOKEN")
)

client = tweepy.Client(
    consumer_key=os.getenv("CONSUMER_KEY"),
    consumer_secret=os.getenv("CONSUMER_SECRET"),
    access_token=os.getenv("ACCESS_TOKEN"),
    access_token_secret=os.getenv("ACCESS_TOKEN_SECRET"),
)

# --- UTILS ---


def truncate_address(address):
    if not address or address in ["Inputs", "Unknown", "Coinbase"]:
        return address
    if address.startswith("0x"):
        return f"{address[:8]}...{address[-6:]}"
    else:
        return f"{address[:12]}...{address[-8:]}"


# --- PRICE & DB ---


def get_db_conn():
    return psycopg2.connect(os.getenv("DATABASE_URL"))


def fetch_token_price(cg_id):
    try:
        cached = r.get(f"price:{cg_id}")
        if cached:
            return float(cached)
        resp = requests.get(
            f"https://api.coingecko.com/api/v3/simple/price?ids={cg_id}&vs_currencies=usd",
            timeout=10,
        )
        price = resp.json()[cg_id]["usd"]
        r.set(f"price:{cg_id}", price, ex=3600)
        return price
    except:
        fallbacks = {
            "ethereum": 2700.0,
            "bitcoin": 96000.0,
            "tether": 1.0,
            "usd-coin": 1.0,
            "wrapped-bitcoin": 96000.0,
        }
        return fallbacks.get(cg_id, 0.0)


def get_decimals(web3, token_addr):
    key = f"dec:{token_addr.lower()}"
    cached = r.get(key)
    if cached:
        return int(cached)
    try:
        checksum_addr = Web3.to_checksum_address(token_addr)
        abi = [
            {
                "name": "decimals",
                "outputs": [{"type": "uint8", "name": ""}],
                "inputs": [],
                "stateMutability": "view",
                "type": "function",
            }
        ]
        contract = web3.eth.contract(address=checksum_addr, abi=abi)
        dec = contract.functions.decimals().call()
        r.set(key, dec, ex=86400 * 7)
        return dec
    except Exception as e:
        logger.warning(f"Failed to get decimals for {token_addr}: {e}")
        return None


def get_top_ethereum_tokens():
    cache_key = "top_ethereum_tokens"
    cached = r.get(cache_key)
    if cached:
        data = json.loads(cached)
        return data["addresses"], data["address_to_info"]

    try:
        url = "https://api.coingecko.com/api/v3/coins/markets"
        params = {
            "vs_currency": "usd",
            "order": "market_cap_desc",
            "per_page": 250,
            "page": 1,
            "sparkline": False,
        }
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        coins = resp.json()

        addresses = []
        address_to_info = {}

        for coin in coins:
            eth_address = coin.get("platforms", {}).get("ethereum")
            if eth_address:
                addr_lower = eth_address.lower()
                addresses.append(Web3.to_checksum_address(eth_address))
                address_to_info[addr_lower] = {
                    "symbol": coin["symbol"].upper(),
                    "cg_id": coin["id"],
                }

        cache_data = {"addresses": addresses, "address_to_info": address_to_info}
        r.set(cache_key, json.dumps(cache_data), ex=3600)

        logger.info(f"[CG] Loaded {len(addresses)} Ethereum tokens from top 250")
        return addresses, address_to_info
    except Exception as e:
        logger.error(f"Failed to fetch top tokens: {e}")
        return [], {}


def get_nametag(address, conn):
    if not address or address in ["Inputs", "Unknown"]:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT nametag FROM nametags WHERE address = %s", (address.lower(),)
            )
            row = cur.fetchone()
            if row:
                return row[0]
            cur.execute("SELECT nametag FROM nametags WHERE address = %s", (address,))
            row = cur.fetchone()
            return row[0] if row else None
    except Exception as e:
        logger.error(f"Nametag error: {e}")
        return None


# --- BLOCKCHAIN SCAN ---


def fetch_ethereum_txs(web3_conn):
    try:
        latest_block = web3_conn.eth.block_number
        cached_latest = int(r.get(f"latest_block:ethereum") or 0)

        if cached_latest == 0:
            cached_latest = latest_block - 5
            logger.info(f"[ETH] First run - starting from recent blocks")

        blocks_to_fetch = min(latest_block - cached_latest, 5)
        if blocks_to_fetch <= 0:
            return []

        large_txs = []
        logger.info(f"[ETH] Scanning {blocks_to_fetch} recent blocks for native ETH")

        # === NATIVE ETH ===
        eth_price = fetch_token_price("ethereum")
        for i in range(blocks_to_fetch):
            block_num = latest_block - i
            block = web3_conn.eth.get_block(block_num, full_transactions=True)
            for tx in block["transactions"]:
                val_wei = tx["value"]
                if val_wei == 0:
                    continue
                val_eth = float(web3_conn.from_wei(val_wei, "ether"))
                val_usd = val_eth * eth_price
                if val_usd >= MIN_VALUE_USD:
                    large_txs.append(
                        {
                            "chain": "ethereum",
                            "hash": tx["hash"].hex(),
                            "from": tx["from"],
                            "to": tx["to"],
                            "value": val_eth,
                            "value_usd": val_usd,
                            "token": "ETH",
                            "cg_id": "ethereum",
                            "block_time": datetime.fromtimestamp(block["timestamp"]),
                        }
                    )

        # === ERC20 - CHỈ TOP ETHEREUMI TOKENS ===
        addresses, address_to_info = get_top_ethereum_tokens()
        if not addresses:
            logger.warning(
                "[ETH] No top tokens loaded - skipping ERC20 scan this round"
            )
            r.set(f"latest_block:ethereum", latest_block, ex=600)
            return large_txs

        max_log_range = 30  # Có thể tăng lên vì ít address hơn, ít log hơn
        log_from_block = max(cached_latest + 1, latest_block - max_log_range + 1)
        logger.info(
            f"[ETH] Fetching ERC20 Transfer logs for {len(addresses)} top tokens from block {log_from_block} to {latest_block}"
        )

        logs = []
        chunk_size = 15
        current_from = log_from_block
        while current_from <= latest_block:
            current_to = min(current_from + chunk_size - 1, latest_block)
            try:
                chunk_logs = web3_conn.eth.get_logs(
                    {
                        "fromBlock": current_from,
                        "toBlock": current_to,
                        "address": addresses,
                        "topics": [TRANSFER_TOPIC],
                    }
                )
                logs.extend(chunk_logs)
                logger.info(
                    f"[ETH] Fetched {len(chunk_logs)} logs from {current_from}-{current_to}"
                )
            except Exception as e:
                logger.warning(f"[ETH] Failed chunk {current_from}-{current_to}: {e}")
            current_from = current_to + 1

        logger.info(f"[ETH] Total Transfer logs fetched (top tokens): {len(logs)}")

        for log in logs:
            try:
                if len(log["topics"]) != 3:
                    continue

                token_address = log["address"].lower()
                info = address_to_info.get(token_address)
                if not info:
                    continue

                from_addr = "0x" + log["topics"][1].hex()[-40:]
                to_addr = "0x" + log["topics"][2].hex()[-40:]

                data_hex = (
                    log["data"].hex()
                    if hasattr(log["data"], "hex")
                    else (
                        log["data"][2:] if log["data"].startswith("0x") else log["data"]
                    )
                )
                value_raw = int(data_hex, 16)

                decimals = get_decimals(web3_conn, token_address)
                if decimals is None:
                    continue
                value_token = value_raw / (10**decimals)

                price = fetch_token_price(info["cg_id"])
                val_usd = value_token * price
                if val_usd >= MIN_VALUE_USD:
                    tx_hash = (
                        log["transactionHash"].hex()
                        if hasattr(log["transactionHash"], "hex")
                        else log["transactionHash"]
                    )
                    block_time = datetime.fromtimestamp(
                        web3_conn.eth.get_block(log["blockNumber"])["timestamp"]
                    )

                    large_txs.append(
                        {
                            "chain": "ethereum",
                            "hash": tx_hash,
                            "from": from_addr,
                            "to": to_addr,
                            "value": value_token,
                            "value_usd": val_usd,
                            "token": info["symbol"],
                            "cg_id": info["cg_id"],
                            "block_time": block_time,
                        }
                    )
            except Exception as log_e:
                logger.warning(f"Skip bad log: {log_e}")
                continue

        r.set(f"latest_block:ethereum", latest_block, ex=600)
        return large_txs
    except Exception as e:
        logger.error(f"ETH Error: {e}")
        return []


def fetch_bitcoin_txs():
    logger.info("--- [BTC] Scanning ---")
    try:
        latest_data = requests.get(
            "https://blockchain.info/latestblock", timeout=20
        ).json()
        height = latest_data["height"]
        cached = int(r.get(f"latest_block:bitcoin") or 0)
        if cached == 0:
            cached = height - 2
            logger.info(f"[BTC] First run - starting from recent blocks")

        blocks_to_fetch = min(height - cached, 2)
        if blocks_to_fetch <= 0:
            return []

        large_txs = []
        btc_price = fetch_token_price("bitcoin")
        curr_hash = latest_data["hash"]

        for i in range(blocks_to_fetch):
            block = requests.get(
                f"https://blockchain.info/rawblock/{curr_hash}", timeout=30
            ).json()
            logger.info(f"[BTC] Block {block['height']} ({len(block['tx'])} txs)")
            for tx in block["tx"]:
                try:
                    # XỬ LÝ COINBASE
                    inputs = tx.get("inputs", [])
                    is_coinbase = len(inputs) == 0 or all(
                        "prev_out" not in inp for inp in inputs
                    )

                    if is_coinbase:
                        # Coinbase: sum tất cả outputs (thường chỉ reward)
                        val_sat = sum(out.get("value", 0) for out in tx["out"])
                        if val_sat == 0:
                            continue
                        val_btc = val_sat / 1e8
                        val_usd = val_btc * btc_price
                        if val_usd < MIN_VALUE_USD:
                            continue

                        from_a = "Coinbase"
                        to_a = next(
                            (
                                out.get("addr", "Unknown")
                                for out in tx["out"]
                                if "addr" in out
                            ),
                            "Unknown",
                        )

                        large_txs.append(
                            {
                                "chain": "bitcoin",
                                "hash": tx["hash"],
                                "from": from_a,
                                "to": to_a,
                                "value": val_btc,
                                "value_usd": val_usd,
                                "token": "BTC",
                                "cg_id": "bitcoin",
                                "block_time": datetime.fromtimestamp(block["time"]),
                            }
                        )
                        continue

                    # NORMAL TX: collect input addresses
                    input_addrs = set()
                    for inp in inputs:
                        prev_out = inp.get("prev_out", {})
                        addr = prev_out.get("addr")
                        if addr:
                            input_addrs.add(addr)

                    if not input_addrs:
                        continue

                    # Real transfers: outputs KHÔNG back về input_addrs
                    real_transfers = []
                    for out in tx["out"]:
                        addr = out.get("addr")
                        value = out.get("value", 0)
                        if addr and value > 0 and addr not in input_addrs:
                            real_transfers.append((value, addr))

                    if not real_transfers:
                        continue  # Chỉ consolidate/self → skip

                    # Lấy largest real transfer
                    real_transfers.sort(reverse=True)
                    largest_sat, to_a = real_transfers[0]
                    val_btc = largest_sat / 1e8
                    val_usd = val_btc * btc_price
                    if val_usd < MIN_VALUE_USD:
                        continue

                    # From: addr input đầu tiên (hoặc Multiple nếu nhiều)
                    from_a = next(
                        (
                            inp.get("prev_out", {}).get("addr", "Unknown")
                            for inp in inputs
                            if inp.get("prev_out")
                        ),
                        "Unknown",
                    )
                    if len(input_addrs) > 1:
                        from_a = "Multiple"

                    large_txs.append(
                        {
                            "chain": "bitcoin",
                            "hash": tx["hash"],
                            "from": from_a,
                            "to": to_a,
                            "value": val_btc,
                            "value_usd": val_usd,
                            "token": "BTC",
                            "cg_id": "bitcoin",
                            "block_time": datetime.fromtimestamp(block["time"]),
                        }
                    )
                except Exception as tx_e:
                    logger.warning(f"Skip bad BTC tx {tx.get('hash', '')}: {tx_e}")
                    continue

            if "prev_block" in block:
                curr_hash = block["prev_block"]

        r.set(f"latest_block:bitcoin", height, ex=600)
        return large_txs
    except Exception as e:
        logger.error(f"BTC Error: {e}")
        return []


# --- DB HELPERS ---


def is_tx_posted(hash_val, conn):
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM posted_transactions WHERE hash = %s", (hash_val,))
        return cur.fetchone() is not None


def save_tx(hash_val, conn):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO posted_transactions (hash) VALUES (%s) ON CONFLICT DO NOTHING",
            (hash_val,),
        )
        conn.commit()


# --- MAIN LOOP ---


async def main():
    logger.info("🤖 Starting Whale Alert Bot")

    conn = get_db_conn()
    with conn.cursor() as cur:
        cur.execute(
            "CREATE TABLE IF NOT EXISTS posted_transactions (hash TEXT PRIMARY KEY, posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
        )
        cur.execute(
            """CREATE TABLE IF NOT EXISTS nametags (address TEXT PRIMARY KEY, nametag TEXT, image TEXT, description TEXT, subcategory TEXT)"""
        )
        conn.commit()

    web3_conn = Web3(Web3.HTTPProvider(ETH_RPC))

    while True:
        try:
            large_txs = []
            try:
                large_txs.extend(fetch_ethereum_txs(web3_conn))
            except:
                pass
            try:
                large_txs.extend(fetch_bitcoin_txs())
            except:
                pass

            now = datetime.now()
            pending_txs = [
                tx
                for tx in large_txs
                if (now - tx["block_time"]) <= timedelta(hours=24)
                and not is_tx_posted(tx["hash"], conn)
            ]

            if pending_txs:
                biggest_tx = max(pending_txs, key=lambda x: x["value_usd"])

                chain = biggest_tx["chain"]
                tx_hash = biggest_tx["hash"]

                if chain == "ethereum" and not tx_hash.startswith("0x"):
                    tx_hash = "0x" + tx_hash

                link = f"{BASE_URL}/explorer?query={tx_hash}&chain={chain}"

                nametag_from = get_nametag(biggest_tx["from"], conn)
                short_from = truncate_address(biggest_tx["from"])
                from_display = (
                    f"{short_from} ({nametag_from})" if nametag_from else short_from
                )

                nametag_to = get_nametag(biggest_tx["to"], conn)
                short_to = truncate_address(biggest_tx["to"])
                to_display = f"{short_to} ({nametag_to})" if nametag_to else short_to

                text = f"""🚨 Whale Alert

{biggest_tx['value']:,.2f} ${biggest_tx['token']} (${biggest_tx['value_usd']:,.0f})

From: {from_display}
To: {to_display}

Explorer: {link}"""

                success = False
                for retry in range(3):
                    try:
                        client.create_tweet(text=text)
                        logger.info(f"✅ Posted:\n{text}")
                        save_tx(biggest_tx["hash"], conn)
                        success = True
                        break
                    except Exception as e:
                        logger.error(f"Post failed (retry {retry+1}): {e}")
                        await asyncio.sleep(300 * (retry + 1))

                if not success:
                    logger.error(f"Failed to post tx {biggest_tx['hash']}")
            else:
                logger.info("No new whale tx")

            # GỢI Ý: GIẢM THỜI GIAN SLEEP ĐỂ BẮT NHIỀU GIAO DỊCH HƠN (HIỆN ~1 GIỜ)
            sleep_time = random.randint(180, 300)  # 3-5 PHÚT
            logger.info(f"Sleeping {sleep_time // 60} minutes...")
            await asyncio.sleep(sleep_time)

        except Exception as e:
            logger.error(f"Critical error: {e}")
            import traceback

            traceback.print_exc()
            await asyncio.sleep(1800)

    conn.close()


if __name__ == "__main__":
    asyncio.run(main())
