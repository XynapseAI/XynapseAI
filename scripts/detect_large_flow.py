import pandas as pd
import json
import sys
import requests
from datetime import datetime, timedelta, UTC # Import UTC for timezone-aware datetimes

# IMPORTANT: These are dummy functions for standalone testing.
# When detect_large_flow is imported and called by analyze_wallets.py,
# the actual functions from analyze_wallets.py will be passed in.
def _dummy_fetch_blockchain_data(wallet_address, action='transactions', force_refresh=False, limit=500, chain='ethereum'):
    print(f"DUMMY: Fetching blockchain data for {wallet_address}. Please run via analyze_wallets.py for real data.")
    return []

def _dummy_get_nametag_local_or_api(wallet_address):
    print(f"DUMMY: Getting nametag for {wallet_address}. Please run via analyze_wallets.py for real data.")
    return 'Unknown'


def detect_large_flow(wallet_address, fetch_blockchain_data_func, get_nametag_func, chain='ethereum', large_value_threshold=1000000):
    """
    Detects large value transactions for a given wallet address within the last 24 hours.
    It takes fetch_blockchain_data_func and get_nametag_func as arguments from analyze_wallets.py.
    
    Args:
        wallet_address (str): The blockchain address to analyze.
        fetch_blockchain_data_func (function): A function (from analyze_wallets) to fetch transaction data.
        get_nametag_func (function): A function (from analyze_wallets) to get nametags.
        chain (str): The blockchain chain (e.g., 'ethereum').
        large_value_threshold (float): The USD value threshold for a transaction to be considered 'large'.
        
    Returns:
        dict: A dictionary containing the wallet address and a list of detected large flows.
    """
    # Use the passed fetch_blockchain_data_func to get transaction data
    # We fetch 500 latest transactions, then filter by time.
    tx_data = fetch_blockchain_data_func(wallet_address, action='transactions', force_refresh=True, limit=500, chain=chain)

    if not tx_data:
        # print(f"No transactions found for {wallet_address} to detect large flows.") # Optional: uncomment for debugging
        return {"wallet": wallet_address, "large_flows": [], "error": "No transactions found"}

    df = pd.DataFrame(tx_data)
    
    # Handle potential None values in 'value' column
    df['value_usd'] = df['value'].apply(lambda x: int(x, 16) / 1e18 * 2000 if x is not None else 0)
    
    # Convert 'block_time' to datetime objects, handling UTC timezone
    df['block_time_dt'] = df['block_time'].apply(
        lambda x: datetime.strptime(x, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=UTC) if '.' in x else datetime.strptime(x, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=UTC)
    )

    now = datetime.now(UTC) # Use timezone-aware UTC datetime
    last_24h = now - timedelta(hours=24)

    # Filter transactions for the last 24 hours AND meeting the large value threshold
    recent_large_txs = df[
        (df['block_time_dt'] > last_24h) & 
        (df['value_usd'] >= large_value_threshold)
    ]

    large_flows_found = []
    # Iterate over the filtered transactions and collect details
    for _, tx in recent_large_txs.iterrows():
        # Use the passed get_nametag_func for both 'from' and 'to' addresses
        from_nametag = get_nametag_func(tx['from'])
        to_nametag = get_nametag_func(tx['to'])

        large_flows_found.append({
            'from': tx['from'],
            'to': tx['to'],
            'value_usd': tx['value_usd'],
            'tx_hash': tx['hash'],
            'block_time': tx['block_time'],
            'from_nametag': from_nametag,
            'to_nametag': to_nametag
        })
    
    return {"wallet": wallet_address, "large_flows": large_flows_found}

if __name__ == "__main__":
    # This block is for standalone testing of detect_large_flow.py.
    # In a real scenario, it's called by analyze_wallets.py.
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No wallet address provided. Usage: python detect_large_flow.py <wallet_address>"}))
        sys.exit(1)
    
    wallet_address = sys.argv[1]
    
    # When running standalone, we use the dummy functions defined above.
    # For actual use, analyze_wallets.py will pass its own functions.
    print("Running detect_large_flow.py in STANDALONE mode. Data fetching will be mocked.")
    result = detect_large_flow(
        wallet_address,
        fetch_blockchain_data_func=_dummy_fetch_blockchain_data, # Use dummy function for standalone
        get_nametag_func=_dummy_get_nametag_local_or_api       # Use dummy function for standalone
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))