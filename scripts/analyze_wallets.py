# scripts/analyze_wallets.py
import pandas as pd
import sys
import json
import requests
import time
import os
import pickle
import schedule
from datetime import datetime, timedelta, UTC
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from firebase_admin import credentials, firestore, initialize_app
from detect_large_flow import detect_large_flow
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# --- Configuration ---
try:
    INTERNAL_API_TOKEN = os.environ['INTERNAL_API_TOKEN']
    RECAPTCHA_TOKEN = os.environ['RECAPTCHA_TOKEN']
    ETHERSCAN_API_BASE_URL = os.environ['ETHERSCAN_API_BASE_URL']
    NAMETAGS_DIR = os.environ.get('NAMETAGS_DIR', 'public/nametags')
    FIREBASE_PROJECT_ID = os.environ['FIREBASE_PROJECT_ID']
    FIREBASE_CLIENT_EMAIL = os.environ['FIREBASE_CLIENT_EMAIL']
    FIREBASE_PRIVATE_KEY = os.environ['FIREBASE_PRIVATE_KEY'].replace('\\n', '\n')
    FIREBASE_DATABASE_URL = os.environ['FIREBASE_DATABASE_URL']
    FIREBASE_TOKEN_URI = os.environ['FIREBASE_TOKEN_URI']
    FIREBASE_AUTH_URI = os.environ['FIREBASE_AUTH_URI']
    FIREBASE_AUTH_PROVIDER_X509_CERT_URL = os.environ['FIREBASE_AUTH_PROVIDER_X509_CERT_URL']
    FIREBASE_CLIENT_ID = os.environ['FIREBASE_CLIENT_ID']
    FIREBASE_PRIVATE_KEY_ID = os.environ['FIREBASE_PRIVATE_KEY_ID']
    FIREBASE_CLIENT_X509_CERT_URL = os.environ['FIREBASE_CLIENT_X509_CERT_URL']
except KeyError as e:
    print(f"Error: Missing environment variable {e}")
    sys.exit(1)

CACHE_DIR = 'cache'

# Deposit wallet analysis thresholds
DEPOSIT_MIN_INCOMING_TXS_24H = 50
DEPOSIT_MAX_UNIQUE_SENDERS_24H = 10
DEPOSIT_MIN_OUTGOING_TO_TARGET_RATIO = 0.3
DEPOSIT_MAX_OUTGOING_DESTINATIONS = 5
DEPOSIT_CONFIDENCE_THRESHOLD = 60

# Initialize Firebase Admin SDK
try:
    cred = credentials.Certificate({
        'type': 'service_account',
        'project_id': FIREBASE_PROJECT_ID,
        'private_key_id': FIREBASE_PRIVATE_KEY_ID,
        'private_key': FIREBASE_PRIVATE_KEY,
        'client_email': FIREBASE_CLIENT_EMAIL,
        'client_id': FIREBASE_CLIENT_ID,
        'auth_uri': FIREBASE_AUTH_URI,
        'token_uri': FIREBASE_TOKEN_URI,
        'auth_provider_x509_cert_url': FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
        'client_x509_cert_url': FIREBASE_CLIENT_X509_CERT_URL
    })
    initialize_app(cred, {
        'databaseURL': FIREBASE_DATABASE_URL
    })
    db = firestore.client()
except Exception as e:
    print(f"Error initializing Firebase Admin SDK: {e}")
    sys.exit(1)

# Ensure directories exist
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(NAMETAGS_DIR, exist_ok=True)

# Global Nametags Cache
GLOBAL_NAMETAGS = {}

def load_all_nametags():
    """
    Loads all nametags from Firestore and local JSON files into GLOBAL_NAMETAGS.
    """
    global GLOBAL_NAMETAGS
    print("Loading nametags from Firestore and JSON...")
    try:
        # Load from Firestore
        nametags_ref = db.collection('nametags').get()
        count = 0
        for doc in nametags_ref:
            address = doc.id.lower()
            data = doc.to_dict()
            # Get the first available label's Name Tag, or 'Unknown'
            labels = data.get('Labels', {})
            first_label = next(iter(labels), 'deposit') if labels else 'deposit'
            GLOBAL_NAMETAGS[address] = labels.get(first_label, {}).get('Name Tag', 'Unknown')
            count += 1
        print(f"Loaded {count} nametags from Firestore.")

        # Load from local JSON files
        files = [f for f in os.listdir(NAMETAGS_DIR) if f.startswith('addresses-') and f.endswith('.json')]
        for file in files:
            try:
                file_path = os.path.join(NAMETAGS_DIR, file)
                with open(file_path, 'r', encoding='utf-8') as f:
                    json_data = json.load(f)
                for address, data in json_data.items():
                    address = address.lower()
                    if address not in GLOBAL_NAMETAGS:  # Prioritize Firestore
                        labels = data.get('Labels', {})
                        first_label = next(iter(labels), 'deposit') if labels else 'deposit'
                        GLOBAL_NAMETAGS[address] = labels.get(first_label, {}).get('Name Tag', 'Unknown')
                count += len(json_data)
            except Exception as e:
                print(f"Error loading nametags from {file}: {e}")
        print(f"Total loaded {count} nametags from Firestore and JSON.")
    except Exception as e:
        print(f"Error loading nametags: {e}")

# Load nametags at startup
load_all_nametags()

@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=4, max=10),
    retry=retry_if_exception_type(requests.exceptions.HTTPError),
    before_sleep=lambda retry_state: print(f"Retrying API call (attempt {retry_state.attempt_number})...")
)
def fetch_blockchain_data(wallet_address, action='transactions', force_refresh=False, limit=500, chain='ethereum'):
    """
    Fetches blockchain data (transactions or token transfers) for a wallet from the local proxy.
    Caches results to disk to reduce API calls.
    """
    cache_file = os.path.join(CACHE_DIR, f"{wallet_address}_{action}_{chain}.pkl")
    if not force_refresh and os.path.exists(cache_file):
        try:
            with open(cache_file, 'rb') as f:
                data = pickle.load(f)
                print(f"Using cached data for {wallet_address} ({action}, {chain}): {len(data)} records")
                return data[:limit]
        except (pickle.UnpicklingError, EOFError) as e:
            print(f"Error reading cache file {cache_file}: {e}. Fetching fresh data.")
            os.remove(cache_file)

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
        response.raise_for_status()
        data = response.json().get('data', [])
        if action == 'transactions':
            data = sorted(data, key=lambda x: datetime.strptime(
                x.get('block_time', '1970-01-01T00:00:00.000Z'),
                '%Y-%m-%dT%H:%M:%S.%fZ' if '.' in x.get('block_time', '') else '%Y-%m-%dT%H:%M:%SZ'
            ), reverse=True)[:limit]
        with open(cache_file, 'wb') as f:
            pickle.dump(data, f)
        print(f"Fetched and cached {len(data)} {action} for {wallet_address} ({chain}) to {cache_file}")
        return data
    except requests.HTTPError as e:
        print(f"HTTP error fetching {action} for {wallet_address} on {chain}: {e}")
        if e.response is not None:
            print(f"Response details: {e.response.text}")
        if e.response is not None and e.response.status_code == 429:
            print(f"Rate limit hit for {wallet_address} on {chain}. Retrying...")
            raise
        return []
    except requests.RequestException as e:
        print(f"Network error fetching {action} for {wallet_address} on {chain}: {e}")
        return []
    except Exception as e:
        print(f"Unexpected error in fetch_blockchain_data for {wallet_address}: {e}")
        return []

def get_nametag_local_or_api(wallet_address):
    """
    Retrieves the nametag for a wallet, preferring local cache over Firestore and JSON.
    """
    normalized_address = wallet_address.lower()
    if normalized_address in GLOBAL_NAMETAGS:
        return GLOBAL_NAMETAGS[normalized_address]
    
    nametag = _fetch_nametag_from_firestore(wallet_address)
    if nametag != 'Unknown':
        GLOBAL_NAMETAGS[normalized_address] = nametag
    return nametag

def _fetch_nametag_from_firestore(wallet_address):
    """
    Fetches nametag from Firestore if not found in local cache.
    """
    try:
        doc_ref = db.collection('nametags').document(wallet_address.lower())
        doc = doc_ref.get()
        if doc.exists:
            data = doc.to_dict()
            labels = data.get('Labels', {})
            first_label = next(iter(labels), 'deposit') if labels else 'deposit'
            return labels.get(first_label, {}).get('Name Tag', 'Unknown')
        return 'Unknown'
    except Exception as e:
        print(f"Error fetching nametag for {wallet_address} from Firestore: {e}")
        return 'Unknown'

def fetch_gemini_analysis(wallet_address, tx_data, confidence_score=0):
    """
    Fetches AI analysis from Gemini API for a wallet based on transaction data.
    """
    url = f"{ETHERSCAN_API_BASE_URL.replace('/api/etherscan', '')}/api/gemini"
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
Analyze the transaction behavior of wallet {wallet_address}.
Summary:
- Total transactions: {summary['total_transactions']}
- Incoming transactions: {summary['incoming_transactions']}
- Outgoing transactions: {summary['outgoing_transactions']}
- Total value (USD): {summary['total_value_usd']:.2f}
- Unique senders: {summary['unique_senders']}
Automated analysis suggests this is a deposit wallet with {confidence_score:.0f}% confidence.
Provide a concise analysis (150-200 words) in Markdown to confirm if this is likely a deposit wallet (e.g., used by exchanges). Explain reasoning clearly.
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
        return data.get('answer', 'No analysis returned from Gemini.')
    except requests.RequestException as e:
        print(f"Error fetching Gemini analysis for {wallet_address}: {e}")
        if 'response' in locals() and response.text:
            print(f"Response details: {response.text}")
        return 'Unable to fetch Gemini analysis.'

def add_nametag_to_firestore(wallet_address, nametag_value):
    """
    Adds or updates a nametag for a wallet in Firestore and local JSON.
    """
    normalized_address = wallet_address.lower()
    labels = {
        'deposit': {
            'Name Tag': nametag_value,
            'Description': 'Auto-generated by deposit wallet analysis',
            'Subcategory': 'Deposit',
            'image': '/icons/default.png'
        }
    }
    
    try:
        # Save to Firestore
        doc_ref = db.collection('nametags').document(normalized_address)
        doc_ref.set({'Labels': labels}, merge=True)
        print(f"Added/Updated nametag '{nametag_value}' for {wallet_address} in Firestore")

        # Save to local JSON
        file_suffix = normalized_address[2:8]  # Use first 6 characters of address after 0x
        file_path = os.path.join(NAMETAGS_DIR, f"addresses-{file_suffix}.json")
        file_data = {}
        if os.path.exists(file_path):
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    file_data = json.load(f)
            except Exception as e:
                print(f"Error reading JSON file {file_path}: {e}")
        
        file_data[normalized_address] = {
            'Address': wallet_address,
            'Labels': labels
        }
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(file_data, f, indent=2, ensure_ascii=False)
        print(f"Added/Updated nametag '{nametag_value}' for {wallet_address} in JSON {file_path}")

        # Update cache
        GLOBAL_NAMETAGS[normalized_address] = nametag_value
    except Exception as e:
        print(f"Error saving nametag for {wallet_address}: {e}")

def save_analysis(analysis_data):
    """
    Saves or updates wallet analysis data in Firestore.
    """
    try:
        analysis_data['timestamp'] = datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S')
        doc_ref = db.collection('wallet_analysis').document(analysis_data['wallet'].lower())
        doc_ref.set(analysis_data, merge=True)
        print(f"Saved analysis for {analysis_data['wallet']} to Firestore")
    except Exception as e:
        print(f"Error saving analysis for {analysis_data['wallet']} to Firestore: {e}")

def save_large_flow(large_flow_data):
    """
    Saves large flow data detected by detect_large_flow into Firestore, avoiding duplicates based on tx_hash.
    """
    try:
        if 'large_flows' in large_flow_data and isinstance(large_flow_data['large_flows'], list):
            existing_tx_hashes = set()
            tx_hashes = [flow.get('tx_hash') for flow in large_flow_data['large_flows']]
            for i in range(0, len(tx_hashes), 30):  # Firestore 'in' query limit is 30
                chunk = tx_hashes[i:i+30]
                try:
                    docs = db.collection('large_flows').where('tx_hash', 'in', chunk).get()
                    existing_tx_hashes.update(doc.to_dict().get('tx_hash') for doc in docs)
                except Exception as e:
                    print(f"Warning: Error checking existing tx_hashes in Firestore: {e}")

            new_flows = []
            for flow in large_flow_data['large_flows']:
                if flow.get('tx_hash') not in existing_tx_hashes:
                    flow_to_save = {
                        "source_wallet_scanned": large_flow_data.get('source_wallet_scanned', 'N/A'),
                        "from": flow.get('from'),
                        "to": flow.get('to'),
                        "value_usd": flow.get('value_usd'),
                        "tx_hash": flow.get('tx_hash'),
                        "block_time": flow.get('block_time'),
                        "from_nametag": flow.get('from_nametag', 'Unknown'),
                        "to_nametag": flow.get('to_nametag', 'Unknown'),
                        "timestamp_recorded": datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S')
                    }
                    new_flows.append(flow_to_save)
            
            if new_flows:
                batch = db.batch()
                for flow in new_flows:
                    doc_ref = db.collection('large_flows').document()
                    batch.set(doc_ref, flow)
                batch.commit()
                print(f"Saved {len(new_flows)} new large flows to Firestore")
            else:
                print("No new large flows to save (all transactions already exist in Firestore)")
        else:
            flow_to_save = {
                "source_wallet_scanned": large_flow_data.get('source_wallet_scanned', 'N/A'),
                "error_info": "No large flows detected or unexpected format for this scan cycle.",
                "timestamp_recorded": datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S')
            }
            db.collection('large_flows').add(flow_to_save)
            print("Saved no large flows record to Firestore")
    except Exception as e:
        print(f"Error saving large flow data to Firestore: {e}")

def identify_deposit_wallet(wallet_address, primary_target_wallet, chain='ethereum', enable_gemini=True):
    """
    Identifies if a wallet is a potential deposit wallet based on transaction patterns
    within the last 7 days, checking if it sends funds back to a primary target wallet.
    """
    print(f"Analyzing wallet {wallet_address} on {chain} for deposit characteristics (target: {primary_target_wallet})...")
    tx_data = fetch_blockchain_data(wallet_address, action='transactions', force_refresh=True, limit=500, chain=chain)
    
    nametag = get_nametag_local_or_api(wallet_address)
    if not tx_data:
        result = {
            "wallet": wallet_address,
            "is_deposit": False,
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
        lambda x: datetime.strptime(x, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=UTC) if '.' in x 
        else datetime.strptime(x, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=UTC)
    )

    now = datetime.now(UTC)
    last_7_days = now - timedelta(days=7)
    recent_txs_7d = df[df['block_time_dt'] > last_7_days]

    confidence_score = 0
    reason_parts = []
    
    last_24_hours = now - timedelta(hours=24)
    incoming_txs_24h = recent_txs_7d[(recent_txs_7d['to'].str.lower() == wallet_address.lower()) & 
                                     (recent_txs_7d['block_time_dt'] > last_24_hours)]
    if len(incoming_txs_24h) > DEPOSIT_MIN_INCOMING_TXS_24H:
        confidence_score += 20
        reason_parts.append(f"High incoming transaction volume in 24h ({len(incoming_txs_24h)} txs).")
    else:
        reason_parts.append(f"Low incoming transaction volume in 24h ({len(incoming_txs_24h)} txs).")

    unique_senders = incoming_txs_24h['from'].nunique()
    if unique_senders > 0 and unique_senders < DEPOSIT_MAX_UNIQUE_SENDERS_24H:
        confidence_score += 20
        reason_parts.append(f"Few unique senders ({unique_senders}) in 24h.")
    elif unique_senders == 0:
        reason_parts.append("No incoming transactions in 24h to check unique senders.")
    else:
        reason_parts.append(f"Many unique senders ({unique_senders}) in 24h.")

    outgoing_to_target = recent_txs_7d[
        (recent_txs_7d['from'].str.lower() == wallet_address.lower()) &
        (recent_txs_7d['to'].str.lower() == primary_target_wallet.lower())
    ]
    total_outgoing_txs = len(recent_txs_7d[recent_txs_7d['from'].str.lower() == wallet_address.lower()])
    
    if total_outgoing_txs > 0 and len(outgoing_to_target) / total_outgoing_txs >= DEPOSIT_MIN_OUTGOING_TO_TARGET_RATIO:
        confidence_score += 30
        reason_parts.append(f"Significant portion ({len(outgoing_to_target)/total_outgoing_txs:.2%}) of outgoing txs to target wallet.")
    elif len(outgoing_to_target) > 0:
        confidence_score += 15
        reason_parts.append(f"Some outgoing transactions to target wallet ({len(outgoing_to_target)} txs).")
    else:
        reason_parts.append("No outgoing transactions to target wallet.")

    has_complex_incoming = any(
        (recent_txs_7d['to'].str.lower() == wallet_address.lower()) & 
        (recent_txs_7d['input'] != '0x')
    )
    if not has_complex_incoming:
        confidence_score += 15
        reason_parts.append("No complex incoming smart contract interactions.")
    else:
        reason_parts.append("Has complex incoming smart contract interactions.")

    outgoing_txs_7d = recent_txs_7d[recent_txs_7d['from'].str.lower() == wallet_address.lower()]
    num_unique_outgoing = outgoing_txs_7d['to'].nunique()
    
    if num_unique_outgoing == 1 and outgoing_txs_7d['to'].iloc[0].lower() == primary_target_wallet.lower():
        confidence_score += 15
        reason_parts.append("Sends exclusively to the primary target wallet.")
    elif num_unique_outgoing >= 1 and num_unique_outgoing <= DEPOSIT_MAX_OUTGOING_DESTINATIONS:
        confidence_score += 5
        reason_parts.append(f"Sends to few unique destinations ({num_unique_outgoing}).")
    else:
        reason_parts.append(f"Sends to many unique destinations ({num_unique_outgoing}).")

    final_reason = " ".join(reason_parts)
    confidence_score = min(confidence_score, 100)
    is_deposit = confidence_score >= DEPOSIT_CONFIDENCE_THRESHOLD
    
    gemini_analysis = "Gemini analysis skipped."
    if enable_gemini and (is_deposit or (nametag and nametag != 'Unknown')):
        gemini_analysis = fetch_gemini_analysis(wallet_address, tx_data, confidence_score)

    metrics = {
        "incoming_txs_24h": len(incoming_txs_24h),
        "unique_senders_24h": unique_senders,
        "total_outgoing_txs_7d": total_outgoing_txs,
        "outgoing_to_target_7d": len(outgoing_to_target),
        "unique_outgoing_destinations_7d": num_unique_outgoing,
        "has_complex_incoming_interaction_7d": has_complex_incoming
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
    
    if confidence_score >= DEPOSIT_CONFIDENCE_THRESHOLD and nametag == 'Unknown':
        new_nametag = f"Auto-detected Deposit Wallet (Conf: {confidence_score:.0f}%)"
        add_nametag_to_firestore(wallet_address, new_nametag)
        result["nametag"] = new_nametag
        
    return result

def fetch_periodic(chain='ethereum', scan_source_address=None):
    """
    Periodically fetches transaction data from source wallets to discover and analyze related wallets.
    """
    analyzed_wallets = set()
    try:
        docs = db.collection('wallet_analysis').get()
        analyzed_wallets = {doc.id.lower() for doc in docs}
    except Exception as e:
        print(f"Warning: Error loading analyzed wallets from Firestore: {e}. Starting with empty set.")

    source_wallets = []
    if scan_source_address:
        source_wallets.append(scan_source_address.lower())
    else:
        print("Scanning nametags to identify high-volume source wallets...")
        all_wallets = list(GLOBAL_NAMETAGS.keys())
        sample_size = min(200, len(all_wallets))
        import random
        wallets_to_check = random.sample(all_wallets, sample_size)

        high_volume_wallets = []
        for wallet in wallets_to_check:
            print(f"Checking activity for {wallet}...")
            tx_data = fetch_blockchain_data(wallet, action='transactions', force_refresh=False, limit=100, chain=chain)
            if tx_data:
                df = pd.DataFrame(tx_data)
                df['block_time_dt'] = df['block_time'].apply(
                    lambda x: datetime.strptime(x, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=UTC) if '.' in x 
                    else datetime.strptime(x, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=UTC)
                )
                now = datetime.now(UTC)
                last_24h = now - timedelta(hours=24)
                recent_txs = df[df['block_time_dt'] > last_24h]
                
                if len(recent_txs) > 200:
                    high_volume_wallets.append(wallet)
            time.sleep(0.5)
        
        source_wallets = high_volume_wallets[:50]

    if not source_wallets:
        print("No high-volume source wallets found in current scan cycle. Exiting.")
        return

    print(f"Using {len(source_wallets)} high-volume source wallets for discovery.")

    related_wallets = set()
    for source_wallet in source_wallets:
        print(f"Fetching transactions from source wallet {source_wallet} to discover related wallets...")
        tx_data = fetch_blockchain_data(source_wallet, action='transactions', force_refresh=True, limit=500, chain=chain)
        
        if not tx_data:
            print(f"No transactions fetched for {source_wallet}.")
            time.sleep(1)
            continue
        
        df = pd.DataFrame(tx_data)
        df['block_time_dt'] = df['block_time'].apply(
            lambda x: datetime.strptime(x, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=UTC) if '.' in x 
            else datetime.strptime(x, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=UTC)
        )

        now = datetime.now(UTC)
        last_24h = now - timedelta(hours=24)
        recent_incoming_txs = df[
            (df['block_time_dt'] > last_24h) &
            (df['to'].str.lower() == source_wallet.lower())
        ]

        if recent_incoming_txs.empty:
            print(f"No recent incoming transactions for {source_wallet}.")
        else:
            for _, tx in recent_incoming_txs.iterrows():
                related_wallets.add(tx['from'].lower())
            
            large_flow_result = detect_large_flow(
                source_wallet, 
                fetch_blockchain_data_func=fetch_blockchain_data, 
                get_nametag_func=get_nametag_local_or_api,
                chain=chain
            )
            if large_flow_result and large_flow_result['large_flows']:
                print(f"Detected {len(large_flow_result['large_flows'])} large flows from {source_wallet}.")
                save_large_flow({
                    'source_wallet_scanned': source_wallet,
                    'large_flows': large_flow_result['large_flows']
                })
            else:
                print(f"No large flows detected for {source_wallet}.")
        time.sleep(1)

    unanalyzed_wallets = [w for w in related_wallets if w not in analyzed_wallets]
    print(f"Found {len(unanalyzed_wallets)} unanalyzed related wallets for deposit analysis.")

    max_wallets_per_cycle = 20
    processed_count = 0
    for wallet in unanalyzed_wallets:
        if processed_count >= max_wallets_per_cycle:
            print(f"Reached max wallets ({max_wallets_per_cycle}) for this cycle.")
            break
        print(f"Analyzing related wallet {wallet} on chain {chain}, with target: {source_wallet}")
        result = identify_deposit_wallet(wallet, primary_target_wallet=source_wallet, chain=chain, enable_gemini=True)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        processed_count += 1
        time.sleep(1)

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

        result = identify_deposit_wallet(wallet_address, primary_target_wallet=wallet_address, chain=chain, enable_gemini=True)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    elif action == 'fetch-periodic':
        chain_arg_idx = sys.argv.index('--chain') + 1 if '--chain' in sys.argv else -1
        source_addr_arg_idx = sys.argv.index('--source') + 1 if '--source' in sys.argv else -1

        chain = sys.argv[chain_arg_idx] if chain_arg_idx != -1 and chain_arg_idx < len(sys.argv) else default_chain
        scan_source_address = sys.argv[source_addr_arg_idx] if source_addr_arg_idx != -1 and source_addr_arg_idx < len(sys.argv) else None

        schedule.every(1).minutes.do(fetch_periodic, chain=chain, scan_source_address=scan_source_address)
        print(f"Starting periodic fetch for chain {chain} at {datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S')}.")
        while True:
            schedule.run_pending()
            time.sleep(1)
    else:
        print(json.dumps({"error": "Invalid action. Supported actions: identify, fetch-periodic"}))
        sys.exit(1)