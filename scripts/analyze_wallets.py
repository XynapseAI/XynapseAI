import pandas as pd
import sys
import json
import requests
import time
import os
import pickle
import schedule
from datetime import datetime, timedelta, UTC # Import UTC for timezone-aware datetimes
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import glob

# Correctly import detect_large_flow (ensure this file exists and is updated as provided below)
from detect_large_flow import detect_large_flow

# --- Configuration ---
INTERNAL_API_TOKEN = '15b376a10d763eae02df767206d26f79a330792b4a197ac8f83d63bd55b14c74'
RECAPTCHA_TOKEN = '15b376a10d763eae02df767206d26f79a330792b4a197ac8f83d63bd55b14c75' # Adjust if needed

ETHERSCAN_API_BASE_URL = 'http://localhost:3000/api/etherscan'
NAMETAGS_DIR = 'public/nametags'
CACHE_DIR = 'cache'
RESULTS_DIR = 'results'

# Ensure directories exist
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(RESULTS_DIR, exist_ok=True)

# Global Nametags Cache
GLOBAL_NAMETAGS = {}

def load_all_nametags():
    """Loads all nametags from JSON files in the NAMETAGS_DIR into GLOBAL_NAMETAGS."""
    global GLOBAL_NAMETAGS
    print(f"Loading nametags from {NAMETAGS_DIR}...")
    json_files = glob.glob(os.path.join(NAMETAGS_DIR, '*.json'))
    count = 0
    for file_path in json_files:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for address, details in data.items():
                    # Normalize address to lowercase
                    GLOBAL_NAMETAGS[address.lower()] = details.get('Labels', {}).get('0', {}).get('Name Tag', 'Unknown')
                    count += 1
        except (json.JSONDecodeError, FileNotFoundError, UnicodeDecodeError) as e:
            print(f"Error loading nametag file {file_path}: {e}")
            continue
    print(f"Loaded {count} nametags.")

# Load nametags at script startup
load_all_nametags()

@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=4, max=10),
    retry=retry_if_exception_type(requests.exceptions.HTTPError),
    before_sleep=lambda retry_state: print(f"Retrying API call (attempt {retry_state.attempt_number})...")
)
def fetch_blockchain_data(wallet_address, action='transactions', force_refresh=False, limit=500, chain='ethereum'):
    """
    Fetches blockchain data (transactions/token transfers) for a wallet address from the local proxy.
    Caches data to disk.
    """
    cache_file = os.path.join(CACHE_DIR, f"{wallet_address}_{action}_{chain}.pkl")

    if not force_refresh and os.path.exists(cache_file):
        try:
            with open(cache_file, 'rb') as f:
                data = pickle.load(f)
                print(f"Using cached data for {wallet_address} ({action}, {chain}): {len(data)} records")
                return data[:limit] # Return only up to the limit from cache
        except (pickle.UnpicklingError, EOFError) as e:
            print(f"Error reading cache file {cache_file}: {e}. Refreshing data.")
            os.remove(cache_file) # Remove corrupted cache file
    
    try:
        print(f"Fetching {action} for {wallet_address} on chain {chain} via API (limit: {limit})")
        
        payload = {
            'action': action,
            'address': wallet_address,
            'chain': chain
        }
        
        response = requests.post(ETHERSCAN_API_BASE_URL, json=payload, headers={
            'Content-Type': 'application/json',
            'X-Internal-Token': INTERNAL_API_TOKEN
        })
        response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)
        data = response.json().get('data', [])

        if action == 'transactions':
            # Sort by block_time in descending order (newest first)
            data = sorted(data, key=lambda x: datetime.strptime(x.get('block_time', '1970-01-01T00:00:00.000Z'), '%Y-%m-%dT%H:%M:%S.%fZ') if '.' in x.get('block_time', '') else datetime.strptime(x.get('block_time', '1970-01-01T00:00:00Z'), '%Y-%m-%dT%H:%M:%SZ'), reverse=True)[:limit]
        
        with open(cache_file, 'wb') as f:
            pickle.dump(data, f)
        print(f"Fetched and cached {len(data)} {action} for {wallet_address} ({chain}) to {cache_file}")
        return data
    except requests.HTTPError as e:
        print(f"Error fetching {action} for {wallet_address} on {chain}: {e}")
        if e.response is not None:
            print(f"Response details: {e.response.text}")
        if e.response is not None and e.response.status_code == 429:
            print(f"Rate limit hit for {wallet_address} on {chain}. Retrying...")
            raise # Re-raise to trigger tenacity retry
        return []
    except requests.RequestException as e:
        print(f"Error fetching {action} for {wallet_address} on {chain}: {e}")
        return []
    except Exception as e:
        print(f"An unexpected error occurred in fetch_blockchain_data for {wallet_address}: {e}")
        return []


def get_nametag_local_or_api(wallet_address):
    """
    Retrieves the nametag for a wallet, preferring local cache over API.
    """
    normalized_address = wallet_address.lower()
    if normalized_address in GLOBAL_NAMETAGS:
        return GLOBAL_NAMETAGS[normalized_address]
    
    # If not in local cache, try to fetch from API
    nametag = _fetch_nametag_from_api(wallet_address)
    if nametag != 'Unknown':
        GLOBAL_NAMETAGS[normalized_address] = nametag # Cache newly fetched nametag
    return nametag

def _fetch_nametag_from_api(wallet_address):
    """Internal function to fetch nametag from API."""
    url = 'http://localhost:3000/api/nametags'
    try:
        response = requests.get(url, params={'address': wallet_address}, headers={
            'X-Internal-Token': INTERNAL_API_TOKEN
        })
        response.raise_for_status()
        data = response.json()
        if data['success'] and data['data'].get(wallet_address.lower()):
            nametag = data['data'][wallet_address.lower()]['Labels'].get('0', {}).get('Name Tag', 'Unknown')
            return nametag
        return 'Unknown'
    except requests.RequestException as e:
        print(f"Error fetching nametag for {wallet_address} from API: {e}")
        return 'Unknown'


def fetch_gemini_analysis(wallet_address, tx_data, is_deposit_confidence=0):
    """
    Fetches Gemini AI analysis for a wallet based on its transaction data.
    Includes deposit confidence in the prompt.
    """
    url = 'http://localhost:3000/api/gemini'
    if not tx_data:
        return 'No transaction data available for analysis.'
    
    df = pd.DataFrame(tx_data)
    df['value_usd'] = df['value'].apply(lambda x: int(x, 16) / 1e18 * 2000 if x is not None else 0)

    summary = {
        'total_transactions': len(df),
        'incoming_transactions': len(df[df['to'].str.lower() == wallet_address.lower()]),
        'outgoing_transactions': len(df[df['from'].str.lower() == wallet_address.lower()]),
        'total_value_usd': df['value_usd'].sum(),
        'unique_senders': len(df[df['to'].str.lower() == wallet_address.lower()]['from'].unique()),
    }
    
    prompt = f"""
Phân tích hành vi giao dịch của ví {wallet_address}.
Tóm tắt:
- Tổng số giao dịch: {summary['total_transactions']}
- Giao dịch đến: {summary['incoming_transactions']}
- Giao dịch đi: {summary['outgoing_transactions']}
- Tổng giá trị (USD): {summary['total_value_usd']:.2f}
- Số người gửi duy nhất: {summary['unique_senders']}
Dựa trên phân tích tự động, ví này được xác định là ví deposit với độ tin cậy {is_deposit_confidence:.0f}%.
Hãy phân tích thêm để xác nhận ví này có phải là ví deposit (ví dụ: được sử dụng bởi các sàn giao dịch) hay không? Cung cấp phân tích ngắn gọn (150-200 từ) bằng Markdown, giải thích rõ ràng lý do.
"""
    try:
        print(f"Calling Gemini for analysis of {wallet_address}...")
        response = requests.post(url, json={
            'prompt': prompt,
            'deepSearch': False,
            'recaptchaToken': RECAPTCHA_TOKEN
        }, headers={
            'Content-Type': 'application/json',
            'X-Internal-Token': INTERNAL_API_TOKEN
        })
        response.raise_for_status()
        data = response.json()
        analysis = data.get('answer', 'No analysis returned from Gemini.')
        return analysis
    except requests.RequestException as e:
        print(f"Error fetching Gemini analysis for {wallet_address}: {e}")
        if 'response' in locals() and response.text:
            print(f"Response details: {response.text}")
        return 'Unable to fetch Gemini analysis.'

def add_nametag_to_file(wallet_address, nametag_value):
    """
    Adds or updates a nametag for a wallet address in a JSON file within public/nametags.
    This creates a new JSON file for the wallet if it doesn't exist.
    """
    # Create a unique filename for the wallet's nametag, e.g., 0x..._nametag.json
    nametag_file = os.path.join(NAMETAGS_DIR, f"{wallet_address.lower()}_nametag.json")
    
    # Structure the data according to your existing nametags format
    data_to_save = {
        wallet_address.lower(): {
            "Labels": {
                "0": {
                    "Name Tag": nametag_value
                }
            }
        }
    }
    
    try:
        with open(nametag_file, 'w', encoding='utf-8') as f:
            json.dump(data_to_save, f, indent=2, ensure_ascii=False)
        print(f"Added/Updated nametag '{nametag_value}' for {wallet_address} to {nametag_file}")
        
        # Also update the in-memory GLOBAL_NAMETAGS cache
        GLOBAL_NAMETAGS[wallet_address.lower()] = nametag_value
        
    except Exception as e:
        print(f"Error saving nametag for {wallet_address} to file: {e}")

def save_analysis(analysis_data):
    """
    Saves or updates wallet analysis data in wallet_analysis.json.
    """
    results_file = os.path.join(RESULTS_DIR, 'wallet_analysis.json')
    
    existing_data = []
    if os.path.exists(results_file) and os.path.getsize(results_file) > 0:
        try:
            with open(results_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
        except json.JSONDecodeError:
            print(f"Warning: {results_file} is corrupted or empty. Starting with new data.")
            existing_data = []

    analysis_data['timestamp'] = datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S')
    updated = False
    # Normalize wallet address for comparison
    analysis_wallet_lower = analysis_data['wallet'].lower()
    for i, item in enumerate(existing_data):
        if item.get('wallet', '').lower() == analysis_wallet_lower:
            existing_data[i] = analysis_data
            updated = True
            break
    if not updated:
        existing_data.append(analysis_data)

    with open(results_file, 'w', encoding='utf-8') as f:
        json.dump(existing_data, f, indent=2, ensure_ascii=False) # Use ensure_ascii=False for Vietnamese characters
    print(f"Saved analysis for {analysis_data['wallet']} to {results_file}")

def save_large_flow(large_flow_data):
    """
    Saves large flow data detected by detect_large_flow into large_flows.json.
    `large_flow_data` is expected to be a dictionary with 'wallet' and 'large_flows' (a list).
    """
    results_file = os.path.join(RESULTS_DIR, 'large_flows.json')
    
    existing_data = []
    if os.path.exists(results_file) and os.path.getsize(results_file) > 0:
        try:
            with open(results_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
        except json.JSONDecodeError:
            print(f"Warning: {results_file} is corrupted or empty. Starting with new data.")
            existing_data = []

    if 'large_flows' in large_flow_data and isinstance(large_flow_data['large_flows'], list):
        for flow in large_flow_data['large_flows']:
            flow_to_save = {
                "source_wallet_scanned": large_flow_data.get('source_wallet_scanned', 'N/A'), # The original wallet that was scanned for discovery
                "from": flow.get('from'),
                "to": flow.get('to'),
                "value_usd": flow.get('value_usd'),
                "tx_hash": flow.get('tx_hash'),
                "block_time": flow.get('block_time'),
                "from_nametag": flow.get('from_nametag', 'Unknown'),
                "to_nametag": flow.get('to_nametag', 'Unknown'),
                "timestamp_recorded": datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S') # When this record was created
            }
            existing_data.append(flow_to_save)
    else:
        # Fallback for unexpected format or no large flows found for the source wallet
        flow_to_save = {
            "source_wallet_scanned": large_flow_data.get('source_wallet_scanned', 'N/A'),
            "error_info": "No large flows detected or unexpected format for this scan cycle.",
            "timestamp_recorded": datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S')
        }
        existing_data.append(flow_to_save)

    with open(results_file, 'w', encoding='utf-8') as f:
        json.dump(existing_data, f, indent=2, ensure_ascii=False)
    print(f"Saved large flow data to {results_file}")

def identify_deposit_wallet(wallet_address, primary_target_wallet, chain='ethereum', enable_gemini=True):
    """
    Identifies if a wallet is a potential deposit wallet based on transaction patterns
    within the last 7 days and optionally fetches Gemini analysis.
    This version includes a check for sending funds back to a primary target wallet.
    """
    print(f"Analyzing wallet {wallet_address} on {chain} for deposit characteristics (target: {primary_target_wallet})...")
    # Fetch up to 500 latest transactions. Filtering will happen on this data.
    tx_data = fetch_blockchain_data(wallet_address, action='transactions', force_refresh=True, limit=500, chain=chain)
    
    nametag = get_nametag_local_or_api(wallet_address)

    if not tx_data:
        result = {
            "wallet": wallet_address,
            "is_deposit": False, # Initially set to False
            "deposit_confidence_percentage": 0,
            "nametag": nametag,
            "gemini_analysis": "No transactions found to analyze.",
            "reason": "No transactions found",
            "metrics": {}
        }
        save_analysis(result)
        return result

    df = pd.DataFrame(tx_data)
    df['value_usd'] = df['value'].apply(lambda x: int(x, 16) / 1e18 * 2000 if x is not None else 0)
    df['block_time_dt'] = df['block_time'].apply(
        lambda x: datetime.strptime(x, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=UTC) if '.' in x else datetime.strptime(x, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=UTC)
    )

    now = datetime.now(UTC)
    
    # Filter for transactions within the last 7 days for deposit wallet criteria
    last_7_days = now - timedelta(days=7)
    recent_txs_7d = df[df['block_time_dt'] > last_7_days]

    # --- Criteria for Deposit Wallet & Confidence Scoring ---
    confidence_score = 0
    reason_parts = []
    
    # 1. Incoming transactions in the last 24 hours (within the 7-day window)
    last_24_hours = now - timedelta(hours=24)
    incoming_txs_24h = recent_txs_7d[(recent_txs_7d['to'].str.lower() == wallet_address.lower()) & (recent_txs_7d['block_time_dt'] > last_24_hours)]
    if len(incoming_txs_24h) > 10: # More than 10 incoming txs in 24h
        confidence_score += 20 # 20%
        reason_parts.append("High incoming transaction volume in 24h.")
    else:
        reason_parts.append(f"Low incoming transaction volume in 24h ({len(incoming_txs_24h)} txs).")

    # 2. FEW unique senders (from different addresses) to this wallet in the last 24 hours
    # This reflects that a deposit wallet is usually used by one user, sending from their own few addresses.
    unique_senders_to_ví2 = incoming_txs_24h['from'].nunique()
    if unique_senders_to_ví2 > 0 and unique_senders_to_ví2 < 20: # Fewer than 5 unique senders (e.g., 1-4)
        confidence_score += 20 # 20% for this strong indicator
        reason_parts.append(f"Few unique senders ({unique_senders_to_ví2}) to this wallet in 24h.")
    elif unique_senders_to_ví2 == 0:
        reason_parts.append("No incoming transactions in 24h to check unique senders.")
    else:
        reason_parts.append(f"Many unique senders ({unique_senders_to_ví2}) to this wallet in 24h.")
    
    # 3. Sends money back to the primary_target_wallet within the last 7 days (NEW CRITERION)
    # This checks if the wallet sends a significant portion of its outgoing transactions back to the specific "Ví 1"
    outgoing_to_primary_target = recent_txs_7d[
        (recent_txs_7d['from'].str.lower() == wallet_address.lower()) &
        (recent_txs_7d['to'].str.lower() == primary_target_wallet.lower())
    ]
    total_outgoing_txs = len(recent_txs_7d[recent_txs_7d['from'].str.lower() == wallet_address.lower()])
    
    if total_outgoing_txs > 0 and len(outgoing_to_primary_target) / total_outgoing_txs >= 0.5: # At least 50% of outgoing goes back to target
        confidence_score += 30 # 30% for this strong indicator
        reason_parts.append(f"Significant portion of outgoing transactions sent back to target wallet {primary_target_wallet}.")
    elif len(outgoing_to_primary_target) > 0:
        confidence_score += 15 # Partial credit if some go back
        reason_parts.append(f"Some outgoing transactions sent back to target wallet {primary_target_wallet}.")
    else:
        reason_parts.append(f"No outgoing transactions sent back to target wallet {primary_target_wallet}.")

    # 4. No significant smart contract interaction (as 'to' address) in the last 7 days
    has_complex_incoming_interaction = any(
        (recent_txs_7d['to'].str.lower() == wallet_address.lower()) & 
        (recent_txs_7d['input'] != '0x')
    )
    if not has_complex_incoming_interaction:
        confidence_score += 15 # 15%
        reason_parts.append("No complex incoming smart contract interactions.")
    else:
        reason_parts.append("Has complex incoming smart contract interactions.")

    # 5. Few distinct outgoing destinations (excluding the primary target wallet itself if it's the only one)
    # This is to capture "user-like" behavior where funds are sent out to few specific destinations (potentially just the exchange)
    non_contract_outgoing_txs_7d = recent_txs_7d[recent_txs_7d['from'].str.lower() == wallet_address.lower()]
    num_unique_outgoing_destinations = non_contract_outgoing_txs_7d['to'].nunique()
    
    # If it sends only to the primary_target_wallet, that's a very good sign
    if num_unique_outgoing_destinations == 1 and non_contract_outgoing_txs_7d['to'].iloc[0].lower() == primary_target_wallet.lower():
        confidence_score += 15 # Another 15%
        reason_parts.append("Sends exclusively to the primary target wallet.")
    elif num_unique_outgoing_destinations >= 1 and num_unique_outgoing_destinations <= 3: # Allows for a few more destinations if not exclusively the target
        confidence_score += 5 # Smaller bonus
        reason_parts.append(f"Sends to few unique destinations ({num_unique_outgoing_destinations}).")
    else:
        reason_parts.append(f"Sends to many unique destinations ({num_unique_outgoing_destinations}).")

    final_reason = " ".join(reason_parts)
    
    # Cap confidence at 100%
    confidence_score = min(confidence_score, 100)
    
    # If confidence is 70% or more, consider it a deposit wallet
    is_deposit = confidence_score >= 70
    
    gemini_analysis = "Gemini analysis skipped."
    if enable_gemini and (is_deposit or (nametag and nametag != 'Unknown')):
        gemini_analysis = fetch_gemini_analysis(wallet_address, tx_data, confidence_score)

    metrics = {
        "incoming_txs_24h": len(incoming_txs_24h),
        "unique_senders_to_ví2_24h": unique_senders_to_ví2, # Updated metric name
        "total_outgoing_txs_7d": total_outgoing_txs,
        "outgoing_to_primary_target_7d": len(outgoing_to_primary_target),
        "unique_outgoing_destinations_7d": num_unique_outgoing_destinations,
        "has_complex_incoming_interaction_7d": has_complex_incoming_interaction
    }

    result = {
        "wallet": wallet_address,
        "is_deposit": is_deposit,
        "deposit_confidence_percentage": confidence_score,
        "nametag": nametag,
        "reason": final_reason,
        "metrics": metrics,
        "gemini_analysis": gemini_analysis
    }
    save_analysis(result)
    
    # Auto-tagging logic: If confidence is high and no existing nametag
    if confidence_score >= 70 and nametag == 'Unknown':
        new_nametag_value = f"Auto-detected Deposit Wallet (Conf: {confidence_score:.0f}%)"
        add_nametag_to_file(wallet_address, new_nametag_value)
        result["nametag"] = new_nametag_value # Update nametag in the returned result
        
    return result

def fetch_periodic(chain='ethereum', scan_source_address=None):
    """
    Periodically fetches transaction data from source wallets to discover
    and analyze related wallets, saving results.
    """
    results_file = os.path.join(RESULTS_DIR, 'wallet_analysis.json')
    analyzed_wallets = set()
    if os.path.exists(results_file) and os.path.getsize(results_file) > 0:
        try:
            with open(results_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            analyzed_wallets = {d['wallet'].lower() for d in existing_data}
        except json.JSONDecodeError:
            print(f"Warning: {results_file} is corrupted or empty. Starting with fresh analyzed_wallets set.")
            analyzed_wallets = set()
    
    source_addresses_for_scan_round = []
    if scan_source_address:
        # If a specific source is provided, use only that for this run
        source_addresses_for_scan_round.append(scan_source_address.lower())
    else:
        # Logic to iterate ALL nametags to find "Ví 1" (high volume wallets)
        print("Scanning all nametags to identify high-volume 'Ví 1' candidates...")
        # Get all addresses from GLOBAL_NAMETAGS to consider as potential Ví 1
        all_known_wallets = list(GLOBAL_NAMETAGS.keys())
        
        # Limit the number of wallets to process in one periodic cycle to manage API calls
        # We'll prioritize active wallets found during discovery first
        max_source_wallets_per_cycle = 50 # Limit how many potential Ví1 we check in one run

        # We'll use a more active approach: iterate through a sample of ALL known wallets
        # to find those with high transaction volume in the last 24h.
        # This is a heuristic to find 'Ví 1' like exchange hot wallets.
        
        # For a truly large-scale scan of ALL nametags, you might need a more robust queuing system.
        # For now, let's take a sample of ALL known wallets to check for high volume.
        sample_size_for_active_check = min(200, len(all_known_wallets))
        import random
        wallets_to_check_for_activity = random.sample(all_known_wallets, sample_size_for_active_check)

        high_volume_wallets = []
        for wallet_to_check in wallets_to_check_for_activity:
            print(f"Checking activity for {wallet_to_check}...")
            tx_data_for_activity = fetch_blockchain_data(wallet_to_check, action='transactions', force_refresh=False, limit=100, chain=chain) # Get fewer for just activity check
            if tx_data_for_activity:
                df_activity = pd.DataFrame(tx_data_for_activity)
                df_activity['block_time_dt'] = df_activity['block_time'].apply(
                    lambda x: datetime.strptime(x, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=UTC) if '.' in x else datetime.strptime(x, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=UTC)
                )
                now = datetime.now(UTC)
                last_24h_activity = now - timedelta(hours=24)
                recent_txs_activity = df_activity[df_activity['block_time_dt'] > last_24h_activity]
                
                # Criteria for "high transaction volume" for Ví 1 (e.g., > 50 transactions in 24h)
                if len(recent_txs_activity) > 50: # Adjust this threshold as needed
                    high_volume_wallets.append(wallet_to_check)
            time.sleep(0.5) # Small delay
            
        source_addresses_for_scan_round = high_volume_wallets[:max_source_wallets_per_cycle]
        
        if not source_addresses_for_scan_round:
            print("No high-volume source addresses ('Ví 1') found in current scan cycle. Exiting periodic fetch.")
            return

    print(f"Using {len(source_addresses_for_scan_round)} high-volume source addresses ('Ví 1') for discovery.")

    all_involved_wallets_for_analysis = set() # This will hold the "Ví 2" candidates
    for source_addr_ví1 in source_addresses_for_scan_round:
        print(f"Fetching transactions from high-volume 'Ví 1' ({source_addr_ví1}) to discover 'Ví 2' wallets...")
        tx_data_for_discovery = fetch_blockchain_data(source_addr_ví1, action='transactions', force_refresh=True, limit=500, chain=chain)
        
        if not tx_data_for_discovery:
            print(f"No transactions fetched for discovery from {source_addr_ví1}.")
            time.sleep(1)
            continue
        
        df_discovery = pd.DataFrame(tx_data_for_discovery)
        df_discovery['block_time_dt'] = df_discovery['block_time'].apply(
            lambda x: datetime.strptime(x, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=UTC) if '.' in x else datetime.strptime(x, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=UTC)
        )

        now = datetime.now(UTC)
        last_24h_discovery = now - timedelta(hours=24) 
        
        # Filter discovery transactions to only include the last 24 hours
        recent_incoming_txs_to_ví1 = df_discovery[
            (df_discovery['block_time_dt'] > last_24h_discovery) &
            (df_discovery['to'].str.lower() == source_addr_ví1.lower())
        ]

        if recent_incoming_txs_to_ví1.empty:
            print(f"No recent (last 24h) incoming transactions for discovery to {source_addr_ví1}.")
        else:
            # Collect only 'from' addresses (Ví 2 candidates) from incoming transactions to Ví 1
            for _, tx in recent_incoming_txs_to_ví1.iterrows():
                all_involved_wallets_for_analysis.add(tx['from'].lower())
            
            # --- Detect and Save Large Flows (still relevant for Ví 1) ---
            large_flow_result = detect_large_flow(
                source_addr_ví1, 
                fetch_blockchain_data_func=fetch_blockchain_data, 
                get_nametag_func=get_nametag_local_or_api,
                chain=chain
            )
            if large_flow_result and large_flow_result['large_flows']:
                print(f"Detected {len(large_flow_result['large_flows'])} large flows from {source_addr_ví1}.")
                save_large_flow({
                    'source_wallet_scanned': source_addr_ví1,
                    'large_flows': large_flow_result['large_flows']
                })
            else:
                print(f"No large flows detected or processed for {source_addr_ví1} in the last 24 hours.")
        time.sleep(1) # Small delay to avoid overwhelming APIs

    # Filter out wallets that have already been analyzed
    unanalyzed_ví2_wallets = [w for w in all_involved_wallets_for_analysis if w not in analyzed_wallets]
    
    print(f"Found {len(unanalyzed_ví2_wallets)} unanalyzed 'Ví 2' wallets to consider for deposit status.")

    max_wallets_per_cycle_for_ví2 = 20 # Limit analysis per cycle to manage API calls
    processed_count = 0
    for wallet_addr_ví2 in unanalyzed_ví2_wallets:
        if processed_count >= max_wallets_per_cycle_for_ví2:
            print(f"Reached max 'Ví 2' wallets ({max_wallets_per_cycle_for_ví2}) for this cycle. Remaining wallets will be processed in next run.")
            break
        print(f"Identifying deposit status for 'Ví 2' ({wallet_addr_ví2}) on chain {chain}, with 'Ví 1' as potential target: {source_addr_ví1}")
        
        # Pass the current 'Ví 1' (source_addr_ví1) as the primary_target_wallet for 'Ví 2' analysis
        result = identify_deposit_wallet(wallet_addr_ví2, primary_target_wallet=source_addr_ví1, chain=chain, enable_gemini=True) 
        print(json.dumps(result, indent=2, ensure_ascii=False))
        processed_count += 1
        time.sleep(1) # Delay between wallet analyses

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No action provided. Usage: python analyze_wallets.py [action] [--wallet <address>] [--chain <chain>] [--source <address>]"}))
        sys.exit(1)
    
    action = sys.argv[1]
    default_chain = 'ethereum' 

    if action == 'identify':
        if len(sys.argv) < 3:
            print(json.dumps({"error": "No wallet address provided for 'identify' action."}))
            sys.exit(1)
        wallet_address = sys.argv[2]
        
        chain_arg_idx = sys.argv.index('--chain') + 1 if '--chain' in sys.argv else -1
        chain = sys.argv[chain_arg_idx] if chain_arg_idx != -1 and chain_arg_idx < len(sys.argv) else default_chain

        # For single 'identify', there's no specific 'Ví 1' context. 
        # We can use the wallet itself as a placeholder for primary_target_wallet, 
        # or remove the specific 'sends back to Ví 1' criterion for single identification.
        # For simplicity, let's pass the wallet itself as primary_target_wallet, 
        # meaning it will check if it sends back to itself (which it won't, so that specific criterion will fail).
        # A more robust solution might be to prompt the user for primary_target_wallet or derive it differently.
        # For now, let's use a dummy value or make the criterion optional for 'identify'
        result = identify_deposit_wallet(wallet_address, primary_target_wallet=wallet_address, chain=chain, enable_gemini=True) 
        print(json.dumps(result, indent=2, ensure_ascii=False))
    elif action == 'fetch-periodic':
        chain_arg_idx = sys.argv.index('--chain') + 1 if '--chain' in sys.argv else -1
        source_addr_arg_idx = sys.argv.index('--source') + 1 if '--source' in sys.argv else -1

        chain = sys.argv[chain_arg_idx] if chain_arg_idx != -1 and chain_arg_idx < len(sys.argv) else default_chain
        
        scan_source_address = sys.argv[source_addr_arg_idx] if source_addr_arg_idx != -1 and source_addr_arg_idx < len(sys.argv) else None

        # Adjusted schedule to 1 minute for faster testing
        schedule.every(1).minute.do(fetch_periodic, chain=chain, scan_source_address=scan_source_address)
        print(f"Starting periodic fetch for chain {chain}, scanning from provided source or nametags at {datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S')}. Next run in 1 minute.")
        while True:
            schedule.run_pending()
            time.sleep(1)
    else:
        print(json.dumps({"error": "Invalid action. Supported actions: identify, fetch-periodic"}))
        sys.exit(1)