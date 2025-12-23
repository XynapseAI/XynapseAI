# train_wallet_classifier.py (fixed version)
import os
import json
import pandas as pd
import numpy as np
import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.metrics import classification_report
import psycopg2
from dotenv import load_dotenv

# Load env (DATABASE_URL)
load_dotenv()
DATABASE_URL = os.getenv('DATABASE_URL')

def connect_db():
    """Connect to PostgreSQL from DATABASE_URL"""
    conn_str = DATABASE_URL.replace('postgresql://', '')  # Parse
    user_pass, host_port_db = conn_str.split('@')
    user, passw = user_pass.split(':')
    host_port, db = host_port_db.split('/')
    host, port = host_port.split(':')
    conn = psycopg2.connect(
        dbname=db, user=user, password=passw, host=host, port=port
    )
    return conn

def fetch_data():
    """Query Prisma models: nametags for labels, large_flows for txs"""
    conn = connect_db()
    cur = conn.cursor()
    
    # Get labeled wallets (labels from nametag)
    cur.execute("""
        SELECT address, nametag 
        FROM nametags 
        WHERE nametag IS NOT NULL
    """)
    nametags = pd.DataFrame(cur.fetchall(), columns=['address', 'nametag'])
    
    # Get txs from large_flows (or your tx table)
    cur.execute("""
        SELECT from_address, to_address, value_usd, block_time 
        FROM large_flows
    """)
    txs = pd.DataFrame(cur.fetchall(), columns=['from_address', 'to_address', 'value_usd', 'block_time'])
    
    cur.close()
    conn.close()
    
    return nametags, txs

def compute_features(nametags, txs):
    """Compute features per wallet, similar to JS"""
    data = []
    for _, row in nametags.iterrows():
        wallet = row['address'].lower()
        # Filter txs involving this wallet
        wallet_txs = txs[(txs['from_address'].str.lower() == wallet) | (txs['to_address'].str.lower() == wallet)]
        
        if len(wallet_txs) == 0:
            continue
        
        # Features - Convert Decimal to float for all sums
        total_value = float(wallet_txs['value_usd'].sum())
        tx_count = len(wallet_txs)
        # Degree: unique counterparts (simplified, no adjacency full)
        counterparts = set(wallet_txs['from_address'].unique()) | set(wallet_txs['to_address'].unique())
        counterparts.discard(wallet)
        degree = len(counterparts)
        # Velocity: txs per day (simplified)
        times = pd.to_datetime(wallet_txs['block_time']).sort_values()
        if len(times) > 1:
            days = (times.iloc[-1] - times.iloc[0]).days or 1
            velocity = tx_count / days
        else:
            velocity = 0
        # Unique tokens: assume 1 for simplicity (add if have tokenSymbol)
        unique_tokens = 1  # Adjust if data has
        # Sell ratio: outflow / inflow
        inflow_df = wallet_txs[wallet_txs['to_address'].str.lower() == wallet]
        outflow_df = wallet_txs[wallet_txs['from_address'].str.lower() == wallet]
        inflow = float(inflow_df['value_usd'].sum()) if not inflow_df.empty else 0.0
        outflow = float(outflow_df['value_usd'].sum()) if not outflow_df.empty else 0.0
        sell_ratio = outflow / inflow if inflow > 0 else 0
        # Airdrop score: high unique in sources, low avg value
        in_sources = inflow_df['from_address'].nunique()
        avg_in_value = inflow / len(inflow_df) if inflow > 0 and len(inflow_df) > 0 else 0
        airdrop_score = 1 if (in_sources > 10 and avg_in_value < 100) else 0
        # Interaction with exchanges: assume from nametags (simplified, count if counterpart has 'Exchange' in nametag)
        exchange_inter = 0
        for cp in counterparts:
            matching = nametags[nametags['address'].str.lower() == cp.lower()]
            if not matching.empty and 'exchange' in matching['nametag'].values[0].lower():
                exchange_inter += 1
        # Entropy: simplified
        entropy = 0  # Add computeTxEntropy if needed
        
        features = [
            np.log1p(total_value),
            np.log1p(tx_count),
            degree,
            velocity,
            unique_tokens,
            sell_ratio,
            airdrop_score,
            exchange_inter,
            entropy
        ]
        
        # Label: simplify from nametag (e.g., if 'Binance' → 'Exchange')
        nametag = row['nametag'].lower()
        if 'exchange' in nametag or 'binance' in nametag:
            label = 'Exchange'
        elif 'whale' in nametag:
            label = 'Whale'
        elif 'airdrop' in nametag:
            label = 'Airdrop'
        elif 'seller' in nametag:
            label = 'Seller Cluster'
        elif 'nft' in nametag:
            label = 'NFT Collector'
        elif 'institution' in nametag:
            label = 'Institution'
        else:
            continue  # Skip unlabeled
        
        data.append({'features': features, 'label': label})
    
    df = pd.DataFrame(data)
    print(f"Computed {len(df)} samples")  # Debug: Check số lượng data
    return df

def train_model(df):
    """Train NN classifier"""
    if len(df) == 0:
        print("No data to train.")
        return
    
    X = np.array(df['features'].tolist())
    le = LabelEncoder()
    y = le.fit_transform(df['label'])
    
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    X_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.2, random_state=42)
    
    model = tf.keras.Sequential([
        tf.keras.layers.Dense(9, activation='relu', input_shape=(X.shape[1],)),  # 9 features → 9 hidden
        tf.keras.layers.Dense(len(le.classes_), activation='softmax')  # Multi-class output
    ])
    
    model.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])
    model.fit(X_train, y_train, epochs=100, batch_size=32, validation_data=(X_test, y_test))
    
    # Evaluate
    y_pred = np.argmax(model.predict(X_test), axis=1)
    print(classification_report(y_test, y_pred, target_names=le.classes_))
    
    # Export weights
    weights = {
        'layer1': model.layers[0].get_weights()[0].tolist(),
        'layer1_bias': model.layers[0].get_weights()[1].tolist(),
        'layer2': model.layers[1].get_weights()[0].tolist(),
        'layer2_bias': model.layers[1].get_weights()[1].tolist()
    }
    with open('pretrained_weights.json', 'w') as f:
        json.dump(weights, f)
    print("Exported pretrained_weights.json")

if __name__ == "__main__":
    nametags, txs = fetch_data()
    df = compute_features(nametags, txs)
    train_model(df)