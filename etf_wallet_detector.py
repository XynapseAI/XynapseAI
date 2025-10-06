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
from typing import Set, Dict, List, Any, Tuple

# --- ĐỊNH NGHĨA CẤU HÌNH ---
class Config:
    MEMPOOL_BASE = 'https://mempool.space/api'
    BITBO_URL = 'https://bitbo.io/treasuries/etf-flows/'
    # Tăng tolerance cho Aggregate Matching
    MATCH_TOLERANCE_PCT = 0.005 # 0.5% tolerance cho khớp tổng
    SINGLE_TX_TOLERANCE_PCT = 0.001 # 0.1% tolerance cho khớp 1-1
    SPLIT_TX_MIN_OUTPUTS = 5
    
    # 1. SEED WALLETS FOR COINBASE CUSTODY CLUSTERING (CHỈ DÙNG 1 VÍ THEO YÊU CẦU)
    COINBASE_SEED_BTC = ['3MqUP6G1daVS5YTD8fz3QgwjZortWwxXFd'] # Hot Wallet
    COINBASE_SEED_EVM = [
        '0xDfD76BbFEB9Eb8322F3696d3567e03f894C40d6c', 
        '0x1E7016f7C23859d097668C27B72C170eD7129A10', 
        '0xceB69F6342eCE283b2F5c9088Ff249B5d0Ae66ea', 
        '0xCD531Ae9EFCCE479654c4926dec5F6209531Ca7b'
    ]
    COINBASE_LEGACY_SEEDS = [
        '3J7cUjBZxvGRCwFBz3q23zAsnhFfZrDSSU' # Gas/Deposit
    ] 

    ETF_TICKERS = ['IBIT', 'FBTC', 'BITB', 'ARKB', 'EZBC']
    ETF_NAMES = {
        'IBIT': 'BlackRock IBIT', 'FBTC': 'Fidelity FBTC', 'BITB': 'Bitwise BITB', 
        'ARKB': 'ARK 21Shares ARKB', 'EZBC': 'Franklin Templeton EZBC'
    }
    COINBASE_CLUSTER_FILE = 'coinbase_cluster.json' 
    ETF_CLUSTERS_FILE = 'etf_wallet_clusters.json' 
    MATCH_HISTORY_FILE = 'etf_match_history.json'
    BALANCES_FILE = 'etf_balances.json' 
    CLUSTER_BUILD_MAX_ADDRESSES = 1000 
    CLUSTER_BUILD_TX_DEPTH = 200  # Giảm để tối ưu tốc độ
    REQUEST_DELAY = 0.3
    DAYS_TO_SCAN = 30 
    MIN_BTC_THRESHOLD = 50 
    TXS_LIMIT_PER_ADDR = 100  # Tăng nhẹ để tìm nhiều outflow hơn
    MIN_TRANSFER_AMOUNT = 0.01 
    MAX_TXS_FOR_BALANCE = 2000  # Giảm từ 10000 để tối ưu tốc độ

    # Thêm config cho IBIT specific: target balance ~300 BTC với tolerance
    IBIT_TARGET_BALANCE = 300.0
    IBIT_BALANCE_TOLERANCE = 0.1  # 10% tolerance, i.e., 270-330 BTC

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

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
console = Console()

def load_json_file(filename: str, default_value: Any) -> Any:
    """Loads JSON file, handles errors."""
    try:
        with open(filename, 'r') as f: return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError): return default_value

def save_json_file(data: Any, filename: str):
    """Saves data to JSON file, handling nametagging for Coinbase cluster."""
    with open(filename, 'w') as f: 
        if filename == Config.COINBASE_CLUSTER_FILE and isinstance(data, set):
            data_to_save = []
            for addr in data:
                nametag = "Coinbase Prime Custody Hotwallet" if addr in Config.COINBASE_SEED_BTC else "Coinbase Custody Cluster Wallet"
                data_to_save.append({'address': addr, 'nametag': nametag})
            json.dump(data_to_save, f, indent=4, default=str)
        else:
            json.dump(data, f, indent=4, default=str)

def fetch_data(url: str, is_json: bool = True):
    """Fetches data from a URL with delay."""
    try:
        time.sleep(Config.REQUEST_DELAY)
        response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
        response.raise_for_status()
        return response.json() if is_json else response.text
    except requests.RequestException as e:
        return None

def get_full_tx(txid: str) -> Dict[str, Any] | None:
    return fetch_data(f"{Config.MEMPOOL_BASE}/tx/{txid}")

def get_address_txs_paginated(address: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Fetches paginated transactions for an address."""
    all_txs = []
    last_txid = None
    url_base = f"{Config.MEMPOOL_BASE}/address/{address}/txs/chain"
    
    while len(all_txs) < limit:
        url = url_base
        if last_txid: url += f"/{last_txid}"
        
        txs_batch = fetch_data(url)
        if txs_batch is None: 
            break
        if not isinstance(txs_batch, list) or not txs_batch: break
        
        all_txs.extend(txs_batch)
        if len(txs_batch) < 25: break
        last_txid = txs_batch[-1]['txid']
        
    return all_txs[:limit]

def sats_to_btc(sats: int) -> float:
    return sats / 100_000_000

def get_address_balance(address: str) -> float:
    """Fetches the current BTC balance of an address."""
    try:
        data = fetch_data(f"{Config.MEMPOOL_BASE}/address/{address}")
        if not data: return 0.0
        balance = data['chain_stats']['funded_txo_sum'] - data['chain_stats']['spent_txo_sum']
        return sats_to_btc(balance)
    except Exception:
        return 0.0

def is_cold_wallet(address: str) -> bool:
    """Check if an address is a potential cold wallet (high balance, low tx count)."""
    try:
        data = fetch_data(f"{Config.MEMPOOL_BASE}/address/{address}")
        if not data: return False
        balance = get_address_balance(address)
        tx_count = data['chain_stats']['tx_count']
        return balance > Config.MIN_BTC_THRESHOLD and tx_count < 10 
    except:
        return False

def is_ibit_vault_candidate(address: str, target: float = Config.IBIT_TARGET_BALANCE, tol: float = Config.IBIT_BALANCE_TOLERANCE) -> bool:
    """Check if address is a potential IBIT vault based on balance ~300 BTC."""
    balance = get_address_balance(address)
    lower = target * (1 - tol)
    upper = target * (1 + tol)
    return lower <= balance <= upper

class EtfDetector:
    def __init__(self):
        loaded_cb_cluster = load_json_file(Config.COINBASE_CLUSTER_FILE, [{'address': a, 'nametag': 'Seed'} for a in Config.COINBASE_SEED_BTC])
        self.coinbase_cluster: Set[str] = set(entry['address'] for entry in loaded_cb_cluster if isinstance(entry, dict) and 'address' in entry)
        self.coinbase_cluster.update(Config.COINBASE_SEED_BTC)
        loaded_etf_clusters = load_json_file(Config.ETF_CLUSTERS_FILE, {})
        self.etf_clusters: Dict[str, List[Dict[str, str]]] = defaultdict(list, loaded_etf_clusters)
        for name, wallets in KNOWN_ETF_WALLETS.items():
            for wallet in wallets:
                if wallet.get('type') == 'Hot':
                    if not any(w.get('address') == wallet['address'] for w in self.etf_clusters.get(name, [])):
                        self.etf_clusters.setdefault(name, []).append({'address': wallet['address'], 'nametag': wallet['nametag'], 'type': 'Hot'})
        
        self.match_history: Dict[str, List[Dict[str, Any]]] = load_json_file(Config.MATCH_HISTORY_FILE, {})
        self.balances: Dict[str, Any] = load_json_file(Config.BALANCES_FILE, {})

    def get_high_activity_addresses(self, cluster: Set[str], num: int = 50) -> List[str]:
        """Select high-activity addresses from cluster to use as 'hot' sources for outflows."""
        logger.info(f"🔥 Selecting top {num} high-activity addresses from cluster (sampling {min(100, len(cluster))} for efficiency)...")
        sample_addrs = random.sample(list(cluster), min(100, len(cluster)))  # Sample to limit API calls
        activities = []
        for addr in sample_addrs:
            data = fetch_data(f"{Config.MEMPOOL_BASE}/address/{addr}")
            if data:
                tx_count = data['chain_stats']['tx_count']
                activities.append((addr, tx_count))
        activities.sort(key=lambda x: x[1], reverse=True)
        high_activity = [a[0] for a in activities[:num]]
        logger.info(f"Selected {len(high_activity)} high-activity addresses.")
        return high_activity

    def build_coinbase_cluster(self):
        """
        Clustering BTC: Sử dụng UTXO-linking/Change-address (Heuristics) 
        để mở rộng cụm ví Coinbase Custody.
        """
        logger.info("🔥 Starting advanced Coinbase BTC cluster building (UTXO/Change-address heuristic)...")
        to_process = list(self.coinbase_cluster)
        processed = set()
        initial_size = len(self.coinbase_cluster)
        
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
                txs = get_address_txs_paginated(address, limit=Config.CLUSTER_BUILD_TX_DEPTH)
                if not txs: continue
                
                for tx_summary in txs:
                    if tx_summary.get('txid') in self.match_history.get('processed_txs_cb', []): continue

                    tx_detail = get_full_tx(tx_summary['txid'])
                    if not tx_detail: continue
                    
                    # 1. UTXO-linking Heuristic
                    vin_addresses = {vin['prevout']['scriptpubkey_address'] for vin in tx_detail.get('vin', []) if vin.get('prevout')}
                    if len(vin_addresses) > 1 and address in vin_addresses:
                        for addr in vin_addresses:
                            if addr not in self.coinbase_cluster:
                                self.coinbase_cluster.add(addr); to_process.append(addr)
                    
                    # 2. Change Address Heuristic
                    if address in vin_addresses and len(tx_detail.get('vout', [])) == 2:
                        output_addresses = {vout['scriptpubkey_address'] for vout in tx_detail['vout'] if 'scriptpubkey_address' in vout}
                        potential_change_addrs = output_addresses - vin_addresses
                        
                        if len(potential_change_addrs) == 1:
                            change_addr = potential_change_addrs.pop()
                            if change_addr not in self.coinbase_cluster:
                                self.coinbase_cluster.add(change_addr); to_process.append(change_addr)
                    
                    self.match_history.setdefault('processed_txs_cb', []).append(tx_summary['txid'])
            
            except Exception as e:
                logger.error(f"Error processing address {address}: {e}")
                continue

        save_json_file(self.coinbase_cluster, Config.COINBASE_CLUSTER_FILE)
        save_json_file(self.match_history, Config.MATCH_HISTORY_FILE)
        logger.info(f"✅ Coinbase BTC cluster building complete. Total addresses: {len(self.coinbase_cluster)} (Found {len(self.coinbase_cluster) - initial_size} new)")

    def fetch_etf_flows(self):
        """Tải dữ liệu dòng tiền ETF từ Bitbo.io."""
        logger.info("📡 Fetching ETF flow data from Bitbo.io...")
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            }
            response = requests.get(Config.BITBO_URL, headers=headers)
            response.raise_for_status()
            html = response.text
            if not html: return pd.DataFrame()
            
            dfs = pd.read_html(io.StringIO(html))
            if not dfs: return pd.DataFrame()
            
            df = dfs[0].copy()
            
            col_indices = [0, 1, 2, 5, 6, 8]
            df = df.iloc[:, col_indices]
            df.columns = ['Date', 'IBIT_USD_M', 'FBTC_USD_M', 'ARKB_USD_M', 'BITB_USD_M', 'EZBC_USD_M']
            
            summary_rows = ['Total', 'Average', 'Maximum', 'Minimum']
            df = df[~df['Date'].astype(str).isin(summary_rows)]
            
            df['Date'] = pd.to_datetime(df['Date'], format='%b %d, %Y', errors='coerce')
            df.dropna(subset=['Date'], inplace=True)
            
            usd_m_cols = ['IBIT_USD_M', 'FBTC_USD_M', 'ARKB_USD_M', 'BITB_USD_M', 'EZBC_USD_M']
            for col in usd_m_cols:
                df[col] = df[col].astype(str).str.replace(',', '').astype(float).fillna(0)
                usd_col = col.replace('_M', '')
                df[usd_col] = df[col] * 1_000_000
            
            df = df[['Date', 'IBIT_USD', 'FBTC_USD', 'ARKB_USD', 'BITB_USD', 'EZBC_USD']].set_index('Date')
            df = df.sort_index()
            
            end_date = datetime.now().date()
            start_date = end_date - timedelta(days=Config.DAYS_TO_SCAN)
            df = df[(df.index.date >= start_date) & (df.index.date <= end_date)]
            
            logger.info(f"✅ Fetched ETF flows for {len(df)} days.")
            return df

        except Exception as e:
            logger.error(f"Error fetching/parsing ETF flows: {e}")
            return pd.DataFrame()

    def fetch_large_custody_txs(self):
        """Tìm kiếm các giao dịch lớn đi ra từ ví Coinbase Custody (cluster), ưu tiên high-activity addrs."""
        logger.info("🔍 Searching for large outgoing TXs from high-activity Coinbase Custody addresses...")
        custody_txs = []
        
        # Sử dụng high-activity addresses thay vì random sample
        addresses_to_scan = self.get_high_activity_addresses(self.coinbase_cluster, 50)
        
        for address in addresses_to_scan:
            txs = get_address_txs_paginated(address, limit=Config.TXS_LIMIT_PER_ADDR)
            
            for tx_summary in txs:
                if tx_summary.get('status', {}).get('confirmed') != True: continue
                if tx_summary['txid'] in [t['txid'] for t in custody_txs]: continue 
                
                tx_detail = get_full_tx(tx_summary['txid'])
                if not tx_detail: continue
                
                is_input_from_cluster = any(
                    vin and vin.get('prevout') and vin['prevout'].get('scriptpubkey_address') in self.coinbase_cluster 
                    for vin in tx_detail.get('vin', [])
                )
                
                if is_input_from_cluster:
                    outflow_btc = 0
                    for vout in tx_detail.get('vout', []):
                        out_address = vout.get('scriptpubkey_address')
                        if out_address and out_address not in self.coinbase_cluster:
                            outflow_btc += sats_to_btc(vout.get('value', 0))
                    
                    if outflow_btc >= Config.MIN_BTC_THRESHOLD:
                        tx_detail['status'] = tx_summary.get('status', {})
                        tx_detail['outflow_btc'] = outflow_btc 
                        tx_detail['time'] = datetime.fromtimestamp(tx_detail['status']['block_time'])
                        custody_txs.append(tx_detail)

        logger.info(f"✅ Found {len(custody_txs)} large custody TXs to analyze.")
        return custody_txs
        
    def get_btc_price(self, date: datetime.date) -> float:
        """Fetches BTC price for a specific date (simplified for the script)."""
        try:
            resp = requests.get(f'https://api.coingecko.com/api/v3/coins/bitcoin/history?date={date.strftime("%d-%m-%Y")}')
            resp.raise_for_status()
            data = resp.json()
            if data and data.get('market_data') and data['market_data'].get('current_price') and data['market_data']['current_price'].get('usd'):
                return data['market_data']['current_price']['usd']
        except:
            pass
        try:
            resp = requests.get(f'{Config.MEMPOOL_BASE}/v1/prices')
            return resp.json().get('USD', 60000)
        except:
            return 60000 

    def find_aggregate_match(self, target_btc: float, available_txs: List[Dict[str, Any]], used_txids: Set[str]) -> Tuple[List[Dict[str, Any]], str] | Tuple[None, None]:
        """
        Tìm kiếm một tập hợp các giao dịch (TXs) có tổng outflow khớp với target_btc.
        Sử dụng thuật toán "Gần đúng Khớp Tổng" đơn giản.
        """
        candidate_txs = [tx for tx in available_txs if tx['txid'] not in used_txids]
        candidate_txs.sort(key=lambda x: x['outflow_btc'], reverse=True) # Ưu tiên TX lớn
        for tx in candidate_txs:
            tx_net = tx['outflow_btc']
            if abs(tx_net - target_btc) / target_btc < Config.SINGLE_TX_TOLERANCE_PCT:
                return [tx], 'Single Match'
        best_match_txs = []
        best_match_sum = 0
        current_sum = 0
        current_group = []
        
        for tx in candidate_txs:
            if current_sum + tx['outflow_btc'] <= target_btc * (1 + Config.MATCH_TOLERANCE_PCT):
                current_sum += tx['outflow_btc']
                current_group.append(tx)
            if abs(current_sum - target_btc) / target_btc < Config.MATCH_TOLERANCE_PCT:
                return current_group, 'Aggregate Match'
            if abs(current_sum - target_btc) < abs(best_match_sum - target_btc) or not best_match_txs:
                best_match_sum = current_sum
                best_match_txs = list(current_group)
        if best_match_txs and abs(best_match_sum - target_btc) / target_btc < Config.MATCH_TOLERANCE_PCT:
             if len(best_match_txs) > 1:
                 return best_match_txs, 'Aggregate Match'
             return None, None
        
        return None, None

    def analyze_and_match_txs(self, etf_flows_df: pd.DataFrame, custody_txs: List[Dict[str, Any]]):
        """
        Phân tích và khớp giao dịch: Áp dụng Aggregate Matching.
        """
        logger.info("Analyzing transactions with Enhanced Aggregate Matching Algorithm...")
        potential_matches = []
        
        txs_by_date = defaultdict(list)
        for tx in custody_txs:
            tx_date = tx['time'].strftime('%Y-%m-%d')
            txs_by_date[tx_date].append(tx)

        for date_str, txs_on_date in txs_by_date.items():
            date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
            if date_obj not in etf_flows_df.index.date: continue

            daily_flows = etf_flows_df.loc[etf_flows_df.index.date == date_obj].iloc[0]
            sorted_flows = []
            
            price = self.get_btc_price(date_obj) 
            for ticker in Config.ETF_TICKERS:
                inflow_usd = daily_flows.get(f'{ticker}_USD', 0)
                if inflow_usd > 0 and price > 0:
                    inflow_btc = inflow_usd / price
                    sorted_flows.append({'ticker': ticker, 'inflow_btc': inflow_btc})
            
            sorted_flows.sort(key=lambda x: x['inflow_btc'], reverse=True)
            daily_used_txids = set()

            for flow in sorted_flows:
                ticker = flow['ticker']
                etf_name = Config.ETF_NAMES[ticker]
                inflow_btc_expected = flow['inflow_btc']
                tx_group, match_type = self.find_aggregate_match(
                    inflow_btc_expected, 
                    txs_on_date, 
                    daily_used_txids
                )
                
                if tx_group:
                    group_outflow_btc = sum(tx['outflow_btc'] for tx in tx_group)
                    
                    for tx in tx_group:
                        daily_used_txids.add(tx['txid'])
                        for vout in tx['vout']:
                            addr = vout.get('scriptpubkey_address')
                            output_btc = sats_to_btc(vout.get('value', 0))

                            if addr and addr not in self.coinbase_cluster and output_btc >= Config.MIN_TRANSFER_AMOUNT:
                                is_main_recipient = False
                                if match_type == 'Single Match':
                                    is_main_recipient = abs(output_btc - inflow_btc_expected) / inflow_btc_expected < Config.SINGLE_TX_TOLERANCE_PCT * 2 
                                elif match_type == 'Aggregate Match':
                                    is_main_recipient = output_btc >= Config.MIN_BTC_THRESHOLD * 0.5 
                                    
                                if is_main_recipient:
                                    is_change = addr in {vin.get('prevout', {}).get('scriptpubkey_address') for vin in tx.get('vin', []) if vin.get('prevout')}
                                    if is_change: continue
                                    wallet_type = 'Hot'
                                    if is_cold_wallet(addr):
                                        wallet_type = 'Vault Candidate' 

                                    nametag = f"{etf_name} Prime Hotwallet (Group Match)" if wallet_type == 'Hot' else f"{etf_name} Vault Candidate (Group Match)" 
                                    
                                    match_data = {
                                        'ticker': ticker, 'date': date_str, 'txid': tx['txid'], 
                                        'btc_amount': output_btc, 'wallet': addr, 'type': match_type,
                                        'nametag': nametag, 'group_outflow_btc': group_outflow_btc,
                                        'is_custody_interaction': True
                                    }
                                    potential_matches.append(match_data)
                                    if match_type == 'Single Match':
                                        break 
                    if match_type == 'Single Match':
                        break
                    if match_type == 'Aggregate Match':
                        logger.info(f"🎉 Found Aggregate Match for {etf_name} ({inflow_btc_expected:.2f} BTC) with {len(tx_group)} TXs (Sum: {group_outflow_btc:.2f} BTC)")
                        break 
        
        self.update_clusters_with_matches(potential_matches)

    def update_clusters_with_matches(self, matches: List[Dict[str, Any]]):
        """Cập nhật cluster ví ETF (ví trung gian/hotwallet)."""
        if not matches:
            logger.info("No new potential matches found.")
            return
        table = Table(title="✨ Potential New ETF Wallet Matches (Hotwallets) ✨")
        table.add_column("Date", style="cyan"); table.add_column("Ticker", style="magenta"); 
        table.add_column("Type", style="green"); table.add_column("BTC Amount", justify="right", style="yellow"); 
        table.add_column("Wallet Address", style="blue"); table.add_column("Nametag", style="bold white"); table.add_column("TXID", style="dim")
        
        new_confirmations = False
        for match in matches:
            wallet = match['wallet']; etf_name = Config.ETF_NAMES[match['ticker']]
            nametag = match.get('nametag', f"{etf_name} Hotwallet") 
            if wallet not in self.match_history: self.match_history[wallet] = []
            
            if not any(h['txid'] == match['txid'] and h['wallet'] == wallet for h in self.match_history[wallet]):
                match['nametag'] = nametag 
                self.match_history[wallet].append(match)
                table.add_row(
                    match['date'], match['ticker'], match['type'], 
                    f"{match['btc_amount']:.2f}", wallet, nametag, 
                    f"[link=https://mempool.space/tx/{match['txid']}]{match['txid'][:10]}...[/link]"
                )
                
                is_confirmed = len(self.match_history[wallet]) >= 2 and match.get('is_custody_interaction', False)
                
                if is_confirmed and not any(w.get('address') == wallet for w in self.etf_clusters.get(etf_name, [])):
                    wallet_type = 'Hot' if 'Hotwallet' in nametag else 'Vault'
                    self.etf_clusters.setdefault(etf_name, []).append({'address': wallet, 'nametag': nametag, 'type': wallet_type})
                    logger.info(f"🎉 CONFIRMED new {wallet_type} for {etf_name}: {wallet} ({nametag}) (found {len(self.match_history[wallet])} matches)")
                    new_confirmations = True
        
        if table.row_count > 0:
            console.print(table)
        
        save_json_file(self.etf_clusters, Config.ETF_CLUSTERS_FILE)
        save_json_file(self.match_history, Config.MATCH_HISTORY_FILE)
        
        if new_confirmations:
            self.display_confirmed_wallets()

    def display_confirmed_wallets(self):
        """Hiển thị các ví ETF (ví trung gian/hotwallet) đã xác nhận."""
        logger.info("Displaying all confirmed main ETF wallets (Hotwallets)...")
        hot_wallets_count = sum(len([w for w in wallets if w.get('type') == 'Hot']) for wallets in self.etf_clusters.values())
        table = Table(title=f"✅ Confirmed Main ETF Wallets (Hot) (Total: {hot_wallets_count})")
        table.add_column("ETF Name", style="bold green")
        table.add_column("Wallet Address", style="blue")
        table.add_column("Nametag", style="bold white")
        table.add_column("Match Count", justify="right", style="yellow")
        
        for name, wallets in self.etf_clusters.items():
            if not wallets: continue
            for wallet_entry in wallets:
                if wallet_entry.get('type') == 'Hot': 
                    wallet = wallet_entry['address']
                    nametag = wallet_entry.get('nametag', f"{name} Hotwallet")
                    match_count = len(self.match_history.get(wallet, []))
                    table.add_row(name, wallet, nametag, str(match_count))
        
        if table.row_count > 0:
            console.print(table)

    def get_recipient_wallets(self, main_wallet: str, etf_name: str) -> Set[str]:
        """
        Nâng cấp: Find unique **recipient wallets** (ví thứ 3/vault) 
        từ các giao dịch **outgoing** của main ETF wallet (ví trung gian). 
        Thêm filter cho IBIT: chỉ giữ recipients có balance ~300 BTC.
        """
        logger.info(f"🔍 Scanning recipients (vaults) for main wallet: {main_wallet} (Limit: {Config.MAX_TXS_FOR_BALANCE} TXs)")
        recipients = set()
        
        all_txs_summary = get_address_txs_paginated(main_wallet, limit=Config.MAX_TXS_FOR_BALANCE)
        etf_hotwallets = {w['address'] for w in self.etf_clusters.get(etf_name, []) if w.get('type') == 'Hot'}
        
        for tx_summary in all_txs_summary:
            try:
                tx_detail = get_full_tx(tx_summary['txid'])
                if not tx_detail: continue
                vin_addresses = {vin['prevout']['scriptpubkey_address'] for vin in tx_detail.get('vin', []) if vin.get('prevout')}
                is_outgoing_tx = main_wallet in vin_addresses
                
                if is_outgoing_tx:
                    vout_list = tx_detail.get('vout', [])
                    outputs = []
                    for vout in vout_list:
                        addr = vout.get('scriptpubkey_address')
                        amount_btc = sats_to_btc(vout.get('value', 0))
                        if addr and amount_btc > 0:
                            outputs.append((addr, amount_btc))

                    for addr, amount_btc in outputs:
                        if addr in etf_hotwallets:
                             continue
                        if amount_btc < Config.MIN_TRANSFER_AMOUNT: 
                             continue
                        if amount_btc >= Config.MIN_BTC_THRESHOLD or is_cold_wallet(addr):
                            # Thêm filter IBIT-specific nếu là BlackRock IBIT
                            if etf_name == 'BlackRock IBIT' and not is_ibit_vault_candidate(addr):
                                continue
                            recipients.add(addr)
                                
            except Exception as e:
                logger.warning(f"Error processing TX {tx_summary['txid']} for recipients: {e}")
                continue
        all_other_hotwallets = {w['address'] for name, wallets in self.etf_clusters.items() if name != etf_name for w in wallets if w.get('type') == 'Hot'}
        recipients = recipients - all_other_hotwallets
        
        logger.info(f"Found {len(recipients)} unique recipient wallets/vaults for {main_wallet} (filtered for IBIT ~300 BTC)")
        return recipients

    def calculate_total_balances(self):
        """
        Tính tổng balance của các ví recipient (ví thứ 3/vault)
        bao gồm cả các ví Vault đã biết từ đầu.
        """
        logger.info("💰 Calculating total balances from recipient wallets (vaults/known)...")
        self.balances = {}
        
        for name in Config.ETF_NAMES.values():
            all_recipient_wallets_entries = {}
            for known_wallet in KNOWN_ETF_WALLETS.get(name, []):
                if known_wallet.get('type') == 'Vault':
                    all_recipient_wallets_entries[known_wallet['address']] = known_wallet['nametag']
            main_wallets = self.etf_clusters.get(name, [])
            for wallet_entry in main_wallets:
                if wallet_entry.get('type') == 'Hot':
                    main_wallet_addr = wallet_entry['address']
                    recipients = self.get_recipient_wallets(main_wallet_addr, name) 
                    
                    for addr in recipients:
                        is_hot_wallet = any(w['address'] == addr and w.get('type') == 'Hot' for w in self.etf_clusters.get(name, []))
                        
                        if not is_hot_wallet and addr not in all_recipient_wallets_entries:
                            all_recipient_wallets_entries[addr] = f"{name} Vault Candidate (Discovered via {main_wallet_addr[:10]}...)"
            total_btc = 0.0
            wallet_details = []
            
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
            
        save_json_file(self.balances, Config.BALANCES_FILE)
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
        sorted_balances = sorted(self.balances.items(), key=lambda item: item[1]['total_btc'], reverse=True)
        
        for name, data in sorted_balances:
            total_grand += data['total_btc']
            table.add_row(
                name,
                f"{data['total_btc']:,.2f}",
                str(data['wallet_count']),
                datetime.fromisoformat(data['last_updated']).strftime('%Y-%m-%d %H:%M')
            )
        
        table.add_section()
        table.add_row(
            "[bold white]GRAND TOTAL[/bold white]",
            f"[bold green]{total_grand:,.2f}[/bold green]",
            "",
            ""
        )
        console.print(table)
        
    def run(self):
        """Chạy toàn bộ quy trình phát hiện và phân tích."""
        console.print("\n" + "="*80)
        console.print("[bold yellow]🚀 STARTING OPTIMIZED ETF BTC HOLDINGS TRACKER[/bold yellow]")
        console.print("="*80)

        # BƯỚC 1: Xây dựng cluster Coinbase Custody (giữ nguyên logic)
        self.build_coinbase_cluster()
        
        # BƯỚC 2: Tải dữ liệu flow và khớp nối để tìm ví Hot
        etf_flows_df = self.fetch_etf_flows()
        custody_txs = self.fetch_large_custody_txs()
        
        if not etf_flows_df.empty and custody_txs:
            self.analyze_and_match_txs(etf_flows_df, custody_txs)
        else:
            logger.warning("⚠️ Could not fetch flows or large TXs. Skipping matching step.")
        
        self.display_confirmed_wallets()
        
        # BƯỚC 3: Từ ví Hot, khám phá ví Vault và tính tổng số dư (với filter IBIT ~300 BTC)
        self.calculate_total_balances()
        
        console.print("\n" + "="*80)
        console.print("[bold green]✅ OPTIMIZED TRACKING COMPLETE[/bold green]")
        console.print("="*80)

# --- Điểm Bắt Đầu Chạy Script ---
if __name__ == "__main__":
    detector = EtfDetector()
    detector.run()