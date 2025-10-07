import requests
import pandas as pd
from datetime import datetime, timedelta
import time
import logging
import json
import io
from collections import defaultdict
from rich.console import Console
from rich.table import Table
import random
from typing import Set, Dict, List, Any, Tuple, Optional
import os
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import RealDictCursor

load_dotenv()
DATABASE_URL = os.getenv('DATABASE_URL')

def get_db_connection():
    """Get a database connection."""
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL is not set in .env")
    return psycopg2.connect(DATABASE_URL)

def db_load_coinbase_cluster() -> Set[str]:
    """Load coinbase cluster addresses from DB."""
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT address FROM coinbase_cluster")
        rows = cur.fetchall()
        conn.close()
        return set(row['address'] for row in rows)
    except Exception as e:
        logging.error(f"Error loading coinbase_cluster: {e}")
        return set()

def db_save_coinbase_cluster(cluster: Set[str]):
    """Save coinbase cluster to DB (replace all)."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM coinbase_cluster")
        seeds = set(Config.COINBASE_SEED_BTC)
        for addr in cluster:
            nametag = "Coinbase Prime Custody Hotwallet Seed" if addr in seeds else "Coinbase Custody Cluster Wallet"
            cur.execute(
                "INSERT INTO coinbase_cluster (address, nametag) VALUES (%s, %s)",
                (addr, nametag)
            )
        conn.commit()
        conn.close()
        logging.info(f"Saved {len(cluster)} addresses to coinbase_cluster table.")
    except Exception as e:
        logging.error(f"Error saving coinbase_cluster: {e}")
        conn.rollback()
        raise

def db_load_etf_clusters() -> Dict[str, List[Dict[str, str]]]:
    """Load ETF clusters from DB."""
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT etf_name, address, nametag, type FROM etf_clusters")
        rows = cur.fetchall()
        conn.close()
        clusters = defaultdict(list)
        for row in rows:
            clusters[row['etf_name']].append({
                'address': row['address'],
                'nametag': row['nametag'],
                'type': row['type']
            })
        return dict(clusters)
    except Exception as e:
        logging.error(f"Error loading etf_clusters: {e}")
        return {}

def db_save_etf_clusters(clusters: Dict[str, List[Dict[str, str]]]):
    """Save ETF clusters to DB (replace all)."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM etf_clusters")
        for etf_name, wallets in clusters.items():
            for wallet in wallets:
                cur.execute(
                    "INSERT INTO etf_clusters (etf_name, address, nametag, type) VALUES (%s, %s, %s, %s)",
                    (etf_name, wallet['address'], wallet['nametag'], wallet['type'])
                )
        conn.commit()
        conn.close()
        logging.info(f"Saved ETF clusters to DB.")
    except Exception as e:
        logging.error(f"Error saving etf_clusters: {e}")
        conn.rollback()
        raise

def db_load_match_history() -> Dict[str, List[Dict[str, Any]]]:
    """Load match history from DB."""
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT wallet, ticker, date, txid, btc_amount, type, nametag, group_outflow_btc, is_custody_interaction, created_at
            FROM match_history
            ORDER BY wallet, created_at
        """)
        rows = cur.fetchall()
        conn.close()
        history = defaultdict(list)
        for row in rows:
            match = dict(row)
            match['date'] = row['date']
            history[row['wallet']].append(match)
        return dict(history)
    except Exception as e:
        logging.error(f"Error loading match_history: {e}")
        return {}

def db_save_match_history(history: Dict[str, List[Dict[str, Any]]]):
    """Save match history to DB (insert if not exists on txid)."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        for wallet, matches in history.items():
            for match in matches:
                cur.execute("""
                    INSERT INTO match_history (wallet, ticker, date, txid, btc_amount, type, nametag, group_outflow_btc, is_custody_interaction)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (txid) DO NOTHING
                """, (
                    wallet, match['ticker'], match['date'], match['txid'],
                    match.get('btc_amount'), match['type'], match['nametag'],
                    match.get('group_outflow_btc'), match.get('is_custody_interaction')
                ))
        conn.commit()
        conn.close()
        logging.info(f"Saved match history to DB.")
    except Exception as e:
        logging.error(f"Error saving match_history: {e}")
        conn.rollback()
        raise

def db_load_etf_balances() -> Dict[str, Any]:
    """Load ETF balances from DB."""
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT etf_name, total_btc, wallet_count, last_updated, details FROM etf_balances")
        rows = cur.fetchall()
        conn.close()
        balances = {}
        for row in rows:
            balances[row['etf_name']] = {
                'total_btc': row['total_btc'],
                'wallet_count': row['wallet_count'],
                'last_updated': row['last_updated'].isoformat() if row['last_updated'] else None,
                'details': row['details']
            }
        return balances
    except Exception as e:
        logging.error(f"Error loading etf_balances: {e}")
        return {}

def db_save_etf_balances(balances: Dict[str, Any]):
    """Save ETF balances to DB (upsert on etf_name)."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        for etf_name, data in balances.items():
            cur.execute("""
                INSERT INTO etf_balances (etf_name, total_btc, wallet_count, last_updated, details)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (etf_name) DO UPDATE SET
                    total_btc = EXCLUDED.total_btc,
                    wallet_count = EXCLUDED.wallet_count,
                    last_updated = EXCLUDED.last_updated,
                    details = EXCLUDED.details
            """, (
                etf_name, data['total_btc'], data['wallet_count'],
                data['last_updated'], data['details']
            ))
        conn.commit()
        conn.close()
        logging.info(f"Saved ETF balances to DB.")
    except Exception as e:
        logging.error(f"Error saving etf_balances: {e}")
        conn.rollback()
        raise

# --- Cấu Hình Ứng Dụng ---

class Config:
    """Cấu hình toàn cục cho script theo dõi ETF."""
    # API Endpoints
    MEMPOOL_BASE = 'https://mempool.space/api'
    BITBO_URL = 'https://bitbo.io/treasuries/etf-flows/'

    # Heuristic & Matching Parameters
    MATCH_TOLERANCE_PCT = 0.005  # 0.5% tolerance for Aggregate Match
    SINGLE_TX_TOLERANCE_PCT = 0.001 # 0.1% tolerance for Single Match
    SPLIT_TX_MIN_OUTPUTS = 5 

    # Seed Addresses (Coinbase Custody)
    COINBASE_SEED_BTC = ['3MqUP6G1daVS5YTD8fz3QgwjZortWwxXFd'] 
    COINBASE_LEGACY_SEEDS = ['3J7cUjBZxvGRCwFBz3q23zAsnhFfZrDSSU'] 
    # EVM seeds are for reference, not used in this BTC-only script
    COINBASE_SEED_EVM = [
        '0xDfD76BbFEB9Eb8322F3696d3567e03f894C40d6c', 
        '0x1E7016f7C23859d097668C27B72C170eD7129A10', 
        '0xceB69F6342eCE283b2F5c9088Ff249B5d0Ae66ea', 
        '0xCD531Ae9EFCCE479654c4926dec5F6209531Ca7b'
    ]

    # ETF Configuration
    ETF_TICKERS = ['IBIT', 'FBTC', 'BITB', 'ARKB', 'EZBC']
    ETF_NAMES = {
        'IBIT': 'BlackRock IBIT', 'FBTC': 'Fidelity FBTC', 'BITB': 'Bitwise BITB', 
        'ARKB': 'ARK 21Shares ARKB', 'EZBC': 'Franklin Templeton EZBC'
    }

    # Operational Limits & Thresholds
    CLUSTER_BUILD_MAX_ADDRESSES = 1000 
    CLUSTER_BUILD_TX_DEPTH = 200  
    REQUEST_DELAY = 1.0  # Tăng delay lên 1 giây để tránh rate limit
    DAYS_TO_SCAN = 45 # Tăng thời gian quét lên 45 ngày
    MIN_BTC_THRESHOLD = 50 # BTC tối thiểu để xét là giao dịch lớn/ví cold
    TXS_LIMIT_PER_ADDR = 100
    MIN_TRANSFER_AMOUNT = 0.01 
    MAX_TXS_FOR_BALANCE = 2000 
    
    # IBIT Specific Heuristic
    IBIT_TARGET_BALANCE = 300.0 # IBIT vault standard size
    IBIT_BALANCE_TOLERANCE = 0.1 # 10% tolerance (270 BTC - 330 BTC)

    # Retry Configuration
    MAX_RETRIES = 5  # Số lần retry tối đa khi gặp lỗi 429
    RETRY_BACKOFF_FACTOR = 2  # Nhân tố backoff (tăng thời gian sleep theo cấp số nhân)

# Known Wallets (Initial Seeds for Vaults/Hotwallets)
KNOWN_ETF_WALLETS: Dict[str, List[Dict[str, str]]] = {
    'BlackRock IBIT': [
        {'address': '3MqUP6G1daVS5YTD8fz3QgwjZortWwxXFd', 'nametag': 'IBIT Hotwallet Primary (Coinbase Recipient)', 'type': 'Hot'},
        {'address': 'bc1qhk0ghcywv0mlmcmz408sdaxudxuk9tvng9xx8g', 'nametag': 'IBIT Known Vault Large', 'type': 'Vault'},
        {'address': 'bc1q4vmfd76exk6jupd3468x960xjvmuvyz3xczhdh', 'nametag': 'IBIT Known Vault 1', 'type': 'Vault'},
        {'address': 'bc1qm4k243yv4c43p46y25s937y3737q3y3q43g3q4', 'nametag': 'IBIT Known Vault 2', 'type': 'Vault'},
    ],
    'Fidelity FBTC': [
        {'address': 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 'nametag': 'FBTC Main Hotwallet', 'type': 'Hot'},
    ],
    'Bitwise BITB': [
        {'address': '1CKVszDdUp4ymGceAZpGzYEFr4RPNHYqaM', 'nametag': 'BITB Main Hotwallet', 'type': 'Hot'},
    ],
    'ARK 21Shares ARKB': [],
    'Franklin Templeton EZBC': []
}

# --- Cấu hình Logging & Console ---

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
console = Console()

def fetch_data(url: str, is_json: bool = True) -> Optional[Any]:
    """Lấy dữ liệu từ một URL với độ trễ (delay) và retry mechanism cho lỗi 429."""
    retries = 0
    while retries < Config.MAX_RETRIES:
        try:
            time.sleep(Config.REQUEST_DELAY)
            response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0 (Custom BTC Tracker)'}, timeout=10)
            if response.status_code == 429:
                # Rate limit: sleep lâu hơn và retry
                sleep_time = Config.REQUEST_DELAY * (Config.RETRY_BACKOFF_FACTOR ** retries)
                logger.warning(f"Rate limit hit (429) for {url}. Retrying after {sleep_time:.2f} seconds... (Retry {retries + 1}/{Config.MAX_RETRIES})")
                time.sleep(sleep_time)
                retries += 1
                continue
            response.raise_for_status()
            return response.json() if is_json else response.text
        except requests.RequestException as e:
            logger.error(f"Request failed for {url}: {e}")
            if '429' in str(e):
                sleep_time = Config.REQUEST_DELAY * (Config.RETRY_BACKOFF_FACTOR ** retries)
                time.sleep(sleep_time)
                retries += 1
            else:
                return None
        except Exception as e:
            logger.error(f"An unexpected error occurred: {e}")
            return None
    logger.error(f"Max retries exceeded for {url}. Giving up.")
    return None

def get_full_tx(txid: str) -> Optional[Dict[str, Any]]:
    """Lấy chi tiết giao dịch."""
    return fetch_data(f"{Config.MEMPOOL_BASE}/tx/{txid}")

def get_address_txs_paginated(address: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Lấy danh sách giao dịch phân trang cho một địa chỉ."""
    all_txs = []
    last_txid = None
    url_base = f"{Config.MEMPOOL_BASE}/address/{address}/txs/chain"
    
    while len(all_txs) < limit:
        url = url_base
        if last_txid: 
            url += f"/{last_txid}"
        
        txs_batch = fetch_data(url)
        if txs_batch is None: 
            break
        if not isinstance(txs_batch, list) or not txs_batch: 
            break
        
        all_txs.extend(txs_batch)
        if len(txs_batch) < 25: break # Kết thúc nếu ít hơn 25 TX trong batch (batch cuối)
        last_txid = txs_batch[-1]['txid']
        
    return all_txs[:limit]

def sats_to_btc(sats: int) -> float:
    """Chuyển đổi Satoshi sang BTC."""
    return sats / 100_000_000

def get_address_balance(address: str) -> float:
    """Lấy số dư BTC hiện tại của một địa chỉ."""
    try:
        data = fetch_data(f"{Config.MEMPOOL_BASE}/address/{address}")
        if not data: return 0.0
        # Balance = tổng nhận (funded) - tổng chi (spent)
        balance = data['chain_stats']['funded_txo_sum'] - data['chain_stats']['spent_txo_sum']
        return sats_to_btc(balance)
    except Exception:
        return 0.0

def is_cold_wallet(address: str) -> bool:
    """Kiểm tra ví có phải là ví lạnh tiềm năng (số dư lớn, ít giao dịch) không."""
    try:
        data = fetch_data(f"{Config.MEMPOOL_BASE}/address/{address}")
        if not data: return False
        # Tiêu chí: Số dư > 50 BTC VÀ Số lượng giao dịch < 10
        balance = get_address_balance(address)
        tx_count = data['chain_stats']['tx_count']
        return balance > Config.MIN_BTC_THRESHOLD and tx_count < 10 
    except:
        return False

def is_ibit_vault_candidate(address: str, target: float = Config.IBIT_TARGET_BALANCE, tol: float = Config.IBIT_BALANCE_TOLERANCE) -> bool:
    """Kiểm tra nếu địa chỉ là vault IBIT tiềm năng (balance ~300 BTC)."""
    balance = get_address_balance(address)
    lower = target * (1 - tol)
    upper = target * (1 + tol)
    return lower <= balance <= upper

# --- Lớp Chính EtfDetector ---

class EtfDetector:
    def __init__(self):
        """Khởi tạo: Tải cluster Coinbase, cluster ETF và lịch sử khớp."""
        # Tải/Khởi tạo Coinbase Cluster
        self.coinbase_cluster: Set[str] = db_load_coinbase_cluster()
        self.coinbase_cluster.update(Config.COINBASE_SEED_BTC)
        
        # Tải/Khởi tạo ETF Cluster (bao gồm các ví đã biết)
        self.etf_clusters: Dict[str, List[Dict[str, str]]] = db_load_etf_clusters()
        
        # Thêm các ví Known Hot/Vault vào Cluster nếu chưa có
        for name, wallets in KNOWN_ETF_WALLETS.items():
            for wallet in wallets:
                if wallet.get('type') in ['Hot', 'Vault']:
                    if not any(w.get('address') == wallet['address'] for w in self.etf_clusters.get(name, [])):
                        self.etf_clusters.setdefault(name, []).append({
                            'address': wallet['address'], 
                            'nametag': wallet['nametag'], 
                            'type': wallet['type']
                        })
        
        self.match_history: Dict[str, List[Dict[str, Any]]] = db_load_match_history()
        self.balances: Dict[str, Any] = db_load_etf_balances()

    def get_high_activity_addresses(self, cluster: Set[str], num: int = 50) -> List[str]:
        """Chọn các địa chỉ có hoạt động cao nhất trong cluster để quét giao dịch OUTFLOW."""
        logger.info(f"🔥 Selecting top {num} high-activity addresses from cluster (sampling {min(100, len(cluster))} for efficiency)...")
        # Lấy mẫu để tránh quá nhiều API call
        sample_addrs = random.sample(list(cluster), min(100, len(cluster)))
        activities = []
        for addr in sample_addrs:
            data = fetch_data(f"{Config.MEMPOOL_BASE}/address/{addr}")
            if data and data.get('chain_stats'):
                tx_count = data['chain_stats']['tx_count']
                activities.append((addr, tx_count))
        
        activities.sort(key=lambda x: x[1], reverse=True)
        high_activity = [a[0] for a in activities[:num]]
        logger.info(f"Selected {len(high_activity)} high-activity addresses.")
        return high_activity

    def build_coinbase_cluster(self):
        """
        Clustering BTC: Áp dụng heuristic UTXO-linking và Change-address 
        để mở rộng cụm ví Coinbase Custody.
        """
        logger.info("🔥 Starting advanced Coinbase BTC cluster building (UTXO/Change-address heuristic)...")
        to_process = list(self.coinbase_cluster)
        processed = set()
        initial_size = len(self.coinbase_cluster)
        
        # Thêm ví Legacy Seed vào danh sách xử lý
        for addr in Config.COINBASE_LEGACY_SEEDS:
            if addr not in self.coinbase_cluster:
                self.coinbase_cluster.add(addr)
                to_process.append(addr)

        while to_process and len(self.coinbase_cluster) < Config.CLUSTER_BUILD_MAX_ADDRESSES:
            address = to_process.pop(0)
            if address in processed: continue
            
            console.print(f"🕵️ Processing address [bold cyan]{address}[/] | Cluster size: [bold green]{len(self.coinbase_cluster)}[/]")
            processed.add(address)
            
            try:
                # Lấy các giao dịch gần nhất
                txs = get_address_txs_paginated(address, limit=Config.CLUSTER_BUILD_TX_DEPTH)
                if not txs: continue
                
                for tx_summary in txs:
                    # Bỏ qua các TX đã xử lý để tránh lặp
                    # if tx_summary.get('txid') in self.match_history.get('processed_txs_cb', []): continue

                    tx_detail = get_full_tx(tx_summary['txid'])
                    if not tx_detail: continue
                    
                    vin_addresses = {vin['prevout']['scriptpubkey_address'] for vin in tx_detail.get('vin', []) if vin.get('prevout')}
                    
                    # 1. UTXO-linking Heuristic: Nếu nhiều input từ nhiều địa chỉ khác nhau cùng chi tiêu trong 1 TX, các địa chỉ đó thuộc cùng 1 thực thể.
                    if len(vin_addresses) > 1 and address in vin_addresses:
                        new_addrs = vin_addresses - self.coinbase_cluster
                        for addr in new_addrs:
                            self.coinbase_cluster.add(addr)
                            to_process.append(addr)
                            console.print(f"[bold yellow]  -> UTXO-Link Found: {addr}[/]")
                    
                    # 2. Change Address Heuristic: Trong TX 2-output, 1 output là đích đến, output còn lại (thường có cùng định dạng với input) là ví change (cùng cluster).
                    if address in vin_addresses and len(tx_detail.get('vout', [])) == 2:
                        output_addresses = {vout['scriptpubkey_address'] for vout in tx_detail['vout'] if 'scriptpubkey_address' in vout}
                        potential_change_addrs = output_addresses - vin_addresses # Địa chỉ output không phải input
                        
                        if len(potential_change_addrs) == 1:
                            change_addr = potential_change_addrs.pop()
                            if change_addr not in self.coinbase_cluster and change_addr != address: # Đảm bảo không phải địa chỉ đang xử lý (re-use)
                                self.coinbase_cluster.add(change_addr)
                                to_process.append(change_addr)
                                console.print(f"[bold yellow]  -> Change-Addr Found: {change_addr}[/]")
                    
                    # Tạm thời bỏ qua việc lưu 'processed_txs_cb' để đơn giản hóa quá trình cluster
                    # self.match_history.setdefault('processed_txs_cb', []).append(tx_summary['txid'])
            
            except Exception as e:
                logger.error(f"Error processing address {address}: {e}")
                continue

        db_save_coinbase_cluster(self.coinbase_cluster)
        logger.info(f"✅ Coinbase BTC cluster building complete. Total addresses: {len(self.coinbase_cluster)} (Found {len(self.coinbase_cluster) - initial_size} new)")

    def fetch_etf_flows(self) -> pd.DataFrame:
        """Tải dữ liệu dòng tiền ETF (USD) từ Bitbo.io."""
        logger.info("📡 Fetching ETF flow data from Bitbo.io...")
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            }
            response = requests.get(Config.BITBO_URL, headers=headers)
            response.raise_for_status()
            html = response.text
            if not html: return pd.DataFrame()
            
            # Đọc bảng HTML. Bitbo thường có 1 bảng chính.
            dfs = pd.read_html(io.StringIO(html))
            if not dfs: return pd.DataFrame()
            
            df = dfs[0].copy()
            
            # Chọn và đổi tên cột cần thiết (cần kiểm tra thường xuyên vì cấu trúc website có thể thay đổi)
            col_indices = [0, 1, 2, 5, 6, 8] # Cột Date và 5 cột ETF flows (IBIT, FBTC, ARKB, BITB, EZBC)
            df = df.iloc[:, col_indices]
            df.columns = ['Date', 'IBIT_USD_M', 'FBTC_USD_M', 'ARKB_USD_M', 'BITB_USD_M', 'EZBC_USD_M']
            
            # Loại bỏ các hàng tóm tắt
            summary_rows = ['Total', 'Average', 'Maximum', 'Minimum']
            df = df[~df['Date'].astype(str).isin(summary_rows)]
            
            # Chuyển đổi cột Date và loại bỏ hàng lỗi
            df['Date'] = pd.to_datetime(df['Date'], format='%b %d, %Y', errors='coerce')
            df.dropna(subset=['Date'], inplace=True)
            
            # Xử lý cột USD (chuyển đổi từ triệu USD sang USD)
            usd_m_cols = ['IBIT_USD_M', 'FBTC_USD_M', 'ARKB_USD_M', 'BITB_USD_M', 'EZBC_USD_M']
            for col in usd_m_cols:
                df[col] = df[col].astype(str).str.replace(',', '').astype(float).fillna(0)
                usd_col = col.replace('_M', '')
                # Flow (USD) = Flow (triệu USD) * 1,000,000. Dòng chảy âm (Outflow) cũng được tính.
                df[usd_col] = df[col] * 1_000_000
            
            # Chỉ giữ lại dòng chảy dương (Inflow)
            df.loc[df['IBIT_USD'] < 0, 'IBIT_USD'] = 0
            df.loc[df['FBTC_USD'] < 0, 'FBTC_USD'] = 0
            df.loc[df['ARKB_USD'] < 0, 'ARKB_USD'] = 0
            df.loc[df['BITB_USD'] < 0, 'BITB_USD'] = 0
            df.loc[df['EZBC_USD'] < 0, 'EZBC_USD'] = 0

            # Lọc cột và sắp xếp theo ngày
            df = df[['Date'] + [f'{t}_USD' for t in Config.ETF_TICKERS]].set_index('Date')
            df = df.sort_index()
            
            # Lọc theo phạm vi ngày cấu hình
            end_date = datetime.now().date()
            start_date = end_date - timedelta(days=Config.DAYS_TO_SCAN)
            df = df[(df.index.date >= start_date) & (df.index.date <= end_date)]
            
            logger.info(f"✅ Fetched ETF flows (INFLOW only) for {len(df)} days.")
            return df

        except Exception as e:
            logger.error(f"Error fetching/parsing ETF flows: {e}")
            return pd.DataFrame()

    def fetch_large_custody_txs(self) -> List[Dict[str, Any]]:
        """Tìm kiếm các giao dịch lớn (>= MIN_BTC_THRESHOLD) đi ra từ ví Coinbase Custody (cluster)."""
        logger.info("🔍 Searching for large outgoing TXs from high-activity Coinbase Custody addresses...")
        custody_txs = []
        addresses_to_scan = self.get_high_activity_addresses(self.coinbase_cluster, 50)
        
        for address in addresses_to_scan:
            # Lấy các giao dịch gần đây của ví
            txs = get_address_txs_paginated(address, limit=Config.TXS_LIMIT_PER_ADDR)
            
            for tx_summary in txs:
                if tx_summary.get('status', {}).get('confirmed') != True: continue
                # Bỏ qua TX đã xử lý (đã có trong danh sách custody_txs)
                if tx_summary['txid'] in [t['txid'] for t in custody_txs]: continue 
                
                tx_detail = get_full_tx(tx_summary['txid'])
                if not tx_detail: continue
                
                # Kiểm tra nếu bất kỳ input nào đến từ cluster Coinbase
                is_input_from_cluster = any(
                    vin and vin.get('prevout') and vin['prevout'].get('scriptpubkey_address') in self.coinbase_cluster 
                    for vin in tx_detail.get('vin', [])
                )
                
                if is_input_from_cluster:
                    outflow_btc = 0
                    # Tính tổng lượng BTC gửi ra ngoài cluster (Outflow BTC)
                    for vout in tx_detail.get('vout', []):
                        out_address = vout.get('scriptpubkey_address')
                        # Nếu địa chỉ output KHÔNG thuộc cluster Coinbase
                        if out_address and out_address not in self.coinbase_cluster:
                            outflow_btc += sats_to_btc(vout.get('value', 0))
                    
                    # Nếu Outflow BTC đủ lớn
                    if outflow_btc >= Config.MIN_BTC_THRESHOLD:
                        tx_detail['status'] = tx_summary.get('status', {})
                        tx_detail['outflow_btc'] = outflow_btc 
                        tx_detail['time'] = datetime.fromtimestamp(tx_detail['status']['block_time'])
                        custody_txs.append(tx_detail)

        logger.info(f"✅ Found {len(custody_txs)} large custody TXs to analyze.")
        return custody_txs
        
    def get_btc_price(self, date: datetime.date) -> float:
        """Lấy giá BTC cho một ngày cụ thể (ưu tiên Coingecko, fallback Mempool/Default)."""
        # Thử Coingecko
        try:
            time.sleep(Config.REQUEST_DELAY)
            resp = requests.get(f'https://api.coingecko.com/api/v3/coins/bitcoin/history?date={date.strftime("%d-%m-%Y")}')
            resp.raise_for_status()
            data = resp.json()
            if data and data.get('market_data') and data['market_data'].get('current_price') and data['market_data']['current_price'].get('usd'):
                return data['market_data']['current_price']['usd']
        except:
            pass
        # Thử Mempool API (lấy giá hiện tại nếu không lấy được giá lịch sử)
        try:
            time.sleep(Config.REQUEST_DELAY)
            resp = requests.get(f'{Config.MEMPOOL_BASE}/v1/prices')
            return resp.json().get('USD', 60000) # Fallback 2: 60000 USD
        except:
            return 60000 # Fallback 3: Default

    def find_aggregate_match(self, target_btc: float, available_txs: List[Dict[str, Any]], used_txids: Set[str]) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
        """
        Tìm kiếm tập hợp các giao dịch (TXs) có tổng outflow khớp với target_btc (Inflow ETF).
        Áp dụng thuật toán "Gần đúng Khớp Tổng" đơn giản.
        """
        candidate_txs = [tx for tx in available_txs if tx['txid'] not in used_txids]
        candidate_txs.sort(key=lambda x: x['outflow_btc'], reverse=True) # Ưu tiên TX lớn để tối ưu heuristic
        
        # 1. Single TX Match (ít sai số hơn)
        for tx in candidate_txs:
            tx_net = tx['outflow_btc']
            if abs(tx_net - target_btc) / target_btc < Config.SINGLE_TX_TOLERANCE_PCT:
                return [tx], 'Single Match'
                
        # 2. Aggregate Match (sử dụng nhiều TX) - Thuật toán "Greedy" đơn giản
        best_match_txs = []
        best_match_sum = 0
        current_sum = 0
        current_group = []
        
        for tx in candidate_txs:
            # Chỉ thêm TX nếu tổng không vượt quá target quá nhiều
            if current_sum + tx['outflow_btc'] <= target_btc * (1 + Config.MATCH_TOLERANCE_PCT):
                current_sum += tx['outflow_btc']
                current_group.append(tx)
            
            # Nếu tổng đạt gần target
            if abs(current_sum - target_btc) / target_btc < Config.MATCH_TOLERANCE_PCT:
                return current_group, 'Aggregate Match'
            
            # Cập nhật kết quả gần nhất (phòng trường hợp không đạt ngưỡng)
            if not best_match_txs or abs(current_sum - target_btc) < abs(best_match_sum - target_btc):
                best_match_sum = current_sum
                best_match_txs = list(current_group)

        # Kiểm tra lại kết quả tốt nhất nếu không tìm thấy match hoàn hảo trong vòng lặp
        if best_match_txs and len(best_match_txs) > 1 and abs(best_match_sum - target_btc) / target_btc < Config.MATCH_TOLERANCE_PCT:
            return best_match_txs, 'Aggregate Match'
            
        return None, None

    def analyze_and_match_txs(self, etf_flows_df: pd.DataFrame, custody_txs: List[Dict[str, Any]]):
        """
        Phân tích và khớp giao dịch: Áp dụng Aggregate Matching giữa Outflow Coinbase Custody và Inflow ETF (BTC).
        """
        logger.info("Analyzing transactions with Enhanced Aggregate Matching Algorithm...")
        potential_matches = []
        
        # Nhóm TX theo ngày để khớp với Flow ETF
        txs_by_date = defaultdict(list)
        for tx in custody_txs:
            tx_date = tx['time'].strftime('%Y-%m-%d')
            txs_by_date[tx_date].append(tx)

        for date_str, txs_on_date in txs_by_date.items():
            date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
            
            # Tìm Flow USD cho ngày này
            daily_flows_candidates = etf_flows_df.loc[etf_flows_df.index.date == date_obj]
            if daily_flows_candidates.empty: continue
            daily_flows = daily_flows_candidates.iloc[0]

            sorted_flows = []
            price = self.get_btc_price(date_obj) # Lấy giá BTC cho ngày đó
            
            # Chuyển đổi Inflow USD sang BTC
            for ticker in Config.ETF_TICKERS:
                inflow_usd = daily_flows.get(f'{ticker}_USD', 0)
                if inflow_usd > 0 and price > 0:
                    inflow_btc = inflow_usd / price
                    sorted_flows.append({'ticker': ticker, 'inflow_btc': inflow_btc})
            
            # Ưu tiên khớp các Flow lớn hơn trước (Greedy approach)
            sorted_flows.sort(key=lambda x: x['inflow_btc'], reverse=True)
            daily_used_txids = set()

            for flow in sorted_flows:
                ticker = flow['ticker']
                etf_name = Config.ETF_NAMES[ticker]
                inflow_btc_expected = flow['inflow_btc']
                
                # Bỏ qua nếu đã có match Single/Aggregate cho ETF này hôm nay
                if any(m['ticker'] == ticker for m in potential_matches if m['date'] == date_str):
                    continue

                # Tìm kiếm Aggregate Match
                tx_group, match_type = self.find_aggregate_match(
                    inflow_btc_expected, 
                    txs_on_date, 
                    daily_used_txids
                )
                
                if tx_group:
                    group_outflow_btc = sum(tx['outflow_btc'] for tx in tx_group)
                    
                    logger.info(f"🎉 Found {match_type} for {etf_name} ({inflow_btc_expected:.2f} BTC) with {len(tx_group)} TXs (Sum: {group_outflow_btc:.2f} BTC)")

                    for tx in tx_group:
                        daily_used_txids.add(tx['txid']) # Đánh dấu TX đã sử dụng
                        
                        # Phân tích địa chỉ nhận (Recipient Address)
                        for vout in tx['vout']:
                            addr = vout.get('scriptpubkey_address')
                            output_btc = sats_to_btc(vout.get('value', 0))

                            if addr and addr not in self.coinbase_cluster and output_btc >= Config.MIN_TRANSFER_AMOUNT:
                                is_main_recipient = False
                                
                                # Xác định Main Recipient:
                                if match_type == 'Single Match':
                                    # Main recipient là địa chỉ nhận phần lớn số BTC của TX đơn
                                    is_main_recipient = abs(output_btc - inflow_btc_expected) / inflow_btc_expected < Config.SINGLE_TX_TOLERANCE_PCT * 2 
                                elif match_type == 'Aggregate Match':
                                    # Main recipient là địa chỉ nhận số BTC lớn (ví dụ > 50% MIN_BTC_THRESHOLD)
                                    is_main_recipient = output_btc >= Config.MIN_BTC_THRESHOLD * 0.5 
                                    
                                if is_main_recipient:
                                    # Kiểm tra Change Address Heuristic: Địa chỉ output cũng là input
                                    is_change = addr in {vin.get('prevout', {}).get('scriptpubkey_address') for vin in tx.get('vin', []) if vin.get('prevout')}
                                    if is_change: continue
                                    
                                    # Phân loại ví Hot/Vault
                                    wallet_type = 'Hot'
                                    if is_cold_wallet(addr):
                                        wallet_type = 'Vault Candidate' 

                                    nametag = f"{etf_name} Prime Hotwallet ({match_type})" if wallet_type == 'Hot' else f"{etf_name} Vault Candidate ({match_type})" 
                                    
                                    match_data = {
                                        'ticker': ticker, 'date': date_str, 'txid': tx['txid'], 
                                        'btc_amount': output_btc, 'wallet': addr, 'type': match_type,
                                        'nametag': nametag, 'group_outflow_btc': group_outflow_btc,
                                        'is_custody_interaction': True
                                    }
                                    potential_matches.append(match_data)
                                    
                                    # Nếu là Single Match, không cần xét các output khác của TX đó (vì 1 Flow = 1 TX lớn)
                                    if match_type == 'Single Match':
                                        break 

                    # Nếu là Single Match, chuyển sang Flow tiếp theo (vì 1 Flow đã tiêu hết 1 TX)
                    if match_type == 'Single Match':
                        break
                    # Nếu là Aggregate Match, chuyển sang Flow tiếp theo (vì 1 Flow đã tiêu hết 1 nhóm TX)
                    if match_type == 'Aggregate Match':
                        break 
        
        self.update_clusters_with_matches(potential_matches)

    def update_clusters_with_matches(self, matches: List[Dict[str, Any]]):
        """Cập nhật cluster ví ETF (ví trung gian/hotwallet) và lịch sử khớp."""
        if not matches:
            logger.info("No new potential matches found.")
            return
            
        table = Table(title="✨ Potential New ETF Wallet Matches (Hotwallets/Vaults) ✨")
        table.add_column("Date", style="cyan"); table.add_column("Ticker", style="magenta"); 
        table.add_column("Type", style="green"); table.add_column("BTC Amount", justify="right", style="yellow"); 
        table.add_column("Wallet Address", style="blue"); table.add_column("Nametag", style="bold white"); table.add_column("TXID", style="dim")
        
        new_confirmations = False
        for match in matches:
            wallet = match['wallet']; etf_name = Config.ETF_NAMES[match['ticker']]
            nametag = match.get('nametag', f"{etf_name} Hotwallet") 
            
            # Lưu lịch sử khớp
            if wallet not in self.match_history: self.match_history[wallet] = []
            
            # Kiểm tra tránh trùng lặp lịch sử
            if not any(h['txid'] == match['txid'] for h in self.match_history[wallet]):
                match['nametag'] = nametag 
                self.match_history[wallet].append(match)
                
                # Hiển thị kết quả mới
                table.add_row(
                    match['date'], match['ticker'], match['type'], 
                    f"{match['btc_amount']:,.2f}", wallet, nametag, 
                    f"[link=https://mempool.space/tx/{match['txid']}]{match['txid'][:10]}...[/link]"
                )
                
                # Logic xác nhận ví: Cần ít nhất 2 lần khớp từ Custody Outflow (tương tác trực tiếp)
                is_confirmed = len(self.match_history[wallet]) >= 2 and match.get('is_custody_interaction', False)
                
                # Cập nhật ETF Cluster nếu đã xác nhận
                if is_confirmed and not any(w.get('address') == wallet for w in self.etf_clusters.get(etf_name, [])):
                    wallet_type = 'Hot' if 'Hotwallet' in nametag else 'Vault'
                    self.etf_clusters.setdefault(etf_name, []).append({'address': wallet, 'nametag': nametag, 'type': wallet_type})
                    logger.info(f"🎉 CONFIRMED new {wallet_type} for {etf_name}: {wallet} ({nametag}) (found {len(self.match_history[wallet])} matches)")
                    new_confirmations = True
        
        if table.row_count > 0:
            console.print(table)
        
        db_save_etf_clusters(self.etf_clusters)
        db_save_match_history(self.match_history)
        
        if new_confirmations:
            self.display_confirmed_wallets()

    def display_confirmed_wallets(self):
        """Hiển thị các ví ETF (Hotwallet/Vault) đã xác nhận."""
        logger.info("Displaying all confirmed main ETF wallets (Hot/Vault)...")
        hot_wallets_count = sum(len([w for w in wallets if w.get('type') == 'Hot']) for wallets in self.etf_clusters.values())
        vault_wallets_count = sum(len([w for w in wallets if w.get('type') == 'Vault']) for wallets in self.etf_clusters.values())

        table = Table(title=f"✅ Confirmed ETF Wallets (Hot: {hot_wallets_count}, Vault: {vault_wallets_count})")
        table.add_column("ETF Name", style="bold green")
        table.add_column("Type", style="cyan")
        table.add_column("Wallet Address", style="blue")
        table.add_column("Nametag", style="bold white")
        table.add_column("Match Count", justify="right", style="yellow")
        
        for name, wallets in self.etf_clusters.items():
            if not wallets: continue
            for wallet_entry in wallets:
                wallet = wallet_entry['address']
                nametag = wallet_entry.get('nametag', f"{name} Wallet")
                wallet_type = wallet_entry.get('type', 'Unknown')
                match_count = len(self.match_history.get(wallet, []))
                
                table.add_row(name, wallet_type, wallet, nametag, str(match_count))
        
        if table.row_count > 0:
            console.print(table)

    def get_recipient_wallets(self, main_wallet: str, etf_name: str) -> Set[str]:
        """
        Tìm kiếm các ví nhận (ví thứ 3/vault) từ các giao dịch outgoing của main ETF wallet (ví trung gian). 
        Áp dụng thêm filter cho IBIT (balance ~300 BTC).
        """
        logger.info(f"🔍 Scanning recipients (vaults) for main wallet: {main_wallet}...")
        recipients = set()
        
        # Lấy tối đa 2000 TX
        all_txs_summary = get_address_txs_paginated(main_wallet, limit=Config.MAX_TXS_FOR_BALANCE)
        
        # Danh sách các Hotwallet của chính ETF này (để loại bỏ ví change/ví nội bộ)
        etf_hotwallets = {w['address'] for w in self.etf_clusters.get(etf_name, []) if w.get('type') == 'Hot'}
        
        for tx_summary in all_txs_summary:
            try:
                tx_detail = get_full_tx(tx_summary['txid'])
                if not tx_detail: continue
                
                # Kiểm tra giao dịch đi ra (main_wallet là input)
                vin_addresses = {vin['prevout']['scriptpubkey_address'] for vin in tx_detail.get('vin', []) if vin.get('prevout')}
                is_outgoing_tx = main_wallet in vin_addresses
                
                if is_outgoing_tx:
                    vout_list = tx_detail.get('vout', [])
                    for vout in vout_list:
                        addr = vout.get('scriptpubkey_address')
                        amount_btc = sats_to_btc(vout.get('value', 0))
                        
                        if addr and amount_btc > 0:
                            # 1. Bỏ qua nếu là Hotwallet nội bộ của ETF này
                            if addr in etf_hotwallets: continue
                            # 2. Bỏ qua giao dịch nhỏ
                            if amount_btc < Config.MIN_TRANSFER_AMOUNT: continue
                                
                            # 3. Chỉ xét recipient là ví lớn (> MIN_BTC_THRESHOLD) hoặc ví Cold/Vault
                            if amount_btc >= Config.MIN_BTC_THRESHOLD or is_cold_wallet(addr):
                                # 4. Filter đặc biệt cho IBIT (vaults ~300 BTC)
                                if etf_name == 'BlackRock IBIT' and not is_ibit_vault_candidate(addr):
                                    continue
                                # 5. Loại bỏ địa chỉ Change (ví output là ví input)
                                is_change = addr in vin_addresses
                                if is_change: continue
                                
                                recipients.add(addr)
                                    
            except Exception as e:
                logger.warning(f"Error processing TX {tx_summary['txid']} for recipients: {e}")
                continue
                
        # Loại bỏ các ví Hotwallet của ETF khác (chắc chắn không phải vault của ETF này)
        all_other_hotwallets = {w['address'] for name, wallets in self.etf_clusters.items() if name != etf_name for w in wallets if w.get('type') == 'Hot'}
        recipients = recipients - all_other_hotwallets
        return recipients

    def calculate_total_balances(self):
        """
        Tính tổng balance của các ví recipient/vault (đã biết và được phát hiện).
        """
        logger.info("💰 Calculating total balances from recipient wallets (vaults/known)...")
        self.balances = {}
        
        for name in Config.ETF_NAMES.values():
            all_recipient_wallets_entries = {}
            
            # 1. Thêm các ví Vault đã biết (KNOWN_ETF_WALLETS)
            for known_wallet in KNOWN_ETF_WALLETS.get(name, []):
                if known_wallet.get('type') == 'Vault':
                    all_recipient_wallets_entries[known_wallet['address']] = known_wallet['nametag']
            
            # 2. Thêm các ví Vault/Recipient được phát hiện (qua Hotwallet Outflow)
            main_wallets = self.etf_clusters.get(name, [])
            for wallet_entry in main_wallets:
                if wallet_entry.get('type') == 'Hot':
                    main_wallet_addr = wallet_entry['address']
                    # Lấy các ví nhận (vaults) từ Hotwallet này
                    recipients = self.get_recipient_wallets(main_wallet_addr, name) 
                    
                    for addr in recipients:
                        # Kiểm tra xem địa chỉ này có phải là Hotwallet của ETF này không
                        is_hot_wallet = any(w['address'] == addr and w.get('type') == 'Hot' for w in self.etf_clusters.get(name, []))
                        
                        # Chỉ thêm nếu không phải hotwallet và chưa có trong danh sách
                        if not is_hot_wallet and addr not in all_recipient_wallets_entries:
                            all_recipient_wallets_entries[addr] = f"{name} Vault Candidate (Discovered via {main_wallet_addr[:10]}...)"
            
            total_btc = 0.0
            wallet_details = []
            
            # 3. Tính balance cho tất cả các ví Vault đã thu thập
            for addr, nametag in all_recipient_wallets_entries.items():
                balance = get_address_balance(addr)
                if balance > 0:
                    total_btc += balance
                    wallet_details.append({
                        'address': addr,
                        'nametag': nametag,
                        'balance_btc': balance
                    })

            self.balances[name] = {
                'total_btc': total_btc,
                'wallet_count': len(wallet_details),
                'last_updated': datetime.now().isoformat(),
                'details': wallet_details
            }
            logger.info(f"Summary for {name}: {total_btc:,.2f} BTC in {len(wallet_details)} wallets.")
            
        db_save_etf_balances(self.balances)
        self.display_balances_summary()

    def display_balances_summary(self):
        """Hiển thị tóm tắt balance."""
        console.print("\n" + "="*80)
        console.print("[bold yellow]📊 TOTAL ETF BTC HOLDINGS SUMMARY (Vaults/Recipients)[/bold yellow]")
        console.print("="*80)
        
        table = Table(title="ETF Holdings (BTC)", show_header=True, header_style="bold blue")
        table.add_column("ETF", style="bold magenta")
        table.add_column("Total BTC", justify="right", style="bold yellow")
        table.add_column("Wallet Count", justify="right", style="green")
        table.add_column("Last Updated", style="dim")
        
        total_grand = 0.0
        # Sắp xếp theo tổng BTC giảm dần
        sorted_balances = sorted(self.balances.items(), key=lambda item: item[1]['total_btc'], reverse=True)
        
        for name, data in sorted_balances:
            total_grand += data['total_btc']
            table.add_row(
                name,
                f"{data['total_btc']:,.2f}",
                str(data['wallet_count']),
                datetime.fromisoformat(data['last_updated']).strftime('%Y-%m-%d %H:%M')
            )
            
        console.print(table)
        console.print(f"[bold white]GRAND TOTAL: {total_grand:,.2f} BTC[/bold white]")
        console.print("="*80)

    def run(self):
        """Chạy toàn bộ quy trình phát hiện và theo dõi ETF."""
        console.print("\n[bold green]=== 🚀 ETF BITCOIN FLOW DETECTOR STARTING 🚀 ===[/bold green]")
        
        # 1. Mở rộng Cluster Coinbase (Ví Custody)
        self.build_coinbase_cluster()
        
        # 2. Tải Dữ liệu Dòng Tiền ETF (USD -> BTC)
        etf_flows_df = self.fetch_etf_flows()
        if etf_flows_df.empty:
            logger.warning("Could not fetch ETF flow data. Exiting matching phase.")
            self.calculate_total_balances()
            return

        # 3. Tìm các Giao Dịch Lớn từ Custody
        custody_txs = self.fetch_large_custody_txs()
        
        # 4. Phân Tích & Khớp Giao Dịch (Aggregate Matching)
        self.analyze_and_match_txs(etf_flows_df, custody_txs)
        
        # 5. Tính Toán Tổng Balance (Vault/Recipient Wallets)
        self.calculate_total_balances()
        
        console.print("[bold green]=== ✅ ETF BITCOIN FLOW DETECTOR COMPLETE ===[/bold green]")

if __name__ == '__main__':
    detector = EtfDetector()
    detector.run()