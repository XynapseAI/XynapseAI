import os
import time
import pandas as pd
import json
from dune_client.query import QueryBase, QueryParameter
from dune_client.client import DuneClient

# ===================== CONFIG =====================
DUNE_API_KEY = "9psVOPeopImGJco7a5PXlXBwmMbZu8WC"
QUERY_ID = 5768574  # Update sau khi sửa SQL
BATCH_SIZE = 1000  # Tăng batch để nhanh hơn (với SQL dedup)
MAX_ROWS = 100000  # Fetch 100k unique addresses (tối ưu cho Plus plan)
# Path tương đối vào thư mục Next
BASE_DIR = os.path.dirname(__file__)
OUTPUT_CSV = os.path.join(BASE_DIR, "dune_labels_non_dex.csv")
OUTPUT_JSON = os.path.join(BASE_DIR, "dune_labels_non_dex.json")
CHECKPOINT_FILE = os.path.join(BASE_DIR, "dune_checkpoint.txt")
TIMEOUT_SECONDS = 600
RETRY_COUNT = 3
RETRY_DELAY = 10
BATCH_DELAY = 0  # Không delay để tăng tốc
# ==================================================

def load_checkpoint():
    """Đọc offset từ file checkpoint nếu tồn tại."""
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE, 'r') as f:
            return int(f.read().strip())
    return 0

def save_checkpoint(offset):
    """Lưu offset vào file checkpoint."""
    with open(CHECKPOINT_FILE, 'w') as f:
        f.write(str(offset))

def append_to_json(data, filename):
    """Thêm dữ liệu vào file JSON (append mode)."""
    if not data:
        return
    mode = 'a' if os.path.exists(filename) else 'w'
    with open(filename, mode, encoding='utf-8') as f:
        if mode == 'w':
            f.write('[')  # Bắt đầu JSON array
        else:
            f.seek(0, os.SEEK_END)
            f.seek(f.tell() - 1)  # Xóa dấu ] cuối
            if f.tell() > 1:
                f.write(',')
        json.dump(data, f, indent=4)
        f.write(']')

def run_and_wait(dune, query, start_time, performance_tier=None):
    """Thực thi truy vấn và chờ kết quả với retry và timeout. Hỗ trợ fallback performance."""
    try:
        execution = dune.execute_query(query, performance=performance_tier)
        job_id = execution.execution_id
        print(f"▶️ Started execution {job_id} on {performance_tier or 'default'} cluster")
    except Exception as e:
        if 'This performance tier is not available' in str(e):
            print(f"⚠️ {performance_tier} not available. Fallback to medium...")
            try:
                execution = dune.execute_query(query, performance='medium')
                job_id = execution.execution_id
                print(f"▶️ Started execution {job_id} on medium cluster")
            except Exception as e2:
                if 'This performance tier is not available' in str(e2):
                    print("⚠️ Medium also not available. Fallback to default...")
                    execution = dune.execute_query(query)  # Default (None)
                    job_id = execution.execution_id
                    print(f"▶️ Started execution {job_id} on default cluster")
                else:
                    raise e2
        else:
            raise e

    while True:
        if time.time() - start_time > TIMEOUT_SECONDS:
            raise Exception(f"❌ Timeout sau {TIMEOUT_SECONDS}s.")
        
        status = dune.get_execution_status(job_id)
        state = status.state
        print(f"⏳ Waiting... (state: {state})")

        if str(state) == "ExecutionState.COMPLETED":
            print("✅ Query completed. Fetching results...")
            for retry in range(RETRY_COUNT):
                try:
                    result = dune.get_execution_results(job_id)
                    rows = result.result.rows if hasattr(result, 'result') and result.result else []
                    print(f"Raw result rows: {rows[:2] if rows else '[]'}")
                    print(f"Total rows returned: {len(rows)}")
                    return rows
                except Exception as e:
                    print(f"⚠️ Retry {retry+1}/{RETRY_COUNT}: {e}. Chờ {RETRY_DELAY}s...")
                    time.sleep(RETRY_DELAY)
            raise Exception(f"❌ Không lấy được kết quả sau {RETRY_COUNT} retry.")
        elif str(state) in ("ExecutionState.FAILED", "ExecutionState.CANCELLED"):
            error_msg = getattr(status, 'error', 'Unknown error')
            raise Exception(f"❌ Query failed with state {state}: {error_msg}")
        
        time.sleep(5)

def fetch_batch(dune, start_row, end_row):
    """Lấy một batch dữ liệu."""
    print(f"Fetching rows from {start_row + 1} to {end_row}")
    query = QueryBase(
        query_id=QUERY_ID,
        params=[
            QueryParameter.number_type(name="start", value=start_row),  # OFFSET
            QueryParameter.number_type(name="batch_size", value=BATCH_SIZE),  # LIMIT
        ]
    )
    start_time = time.time()
    rows = run_and_wait(dune, query, start_time, performance_tier='large')  # Thử large trước, fallback tự động
    print(f"📦 Fetched {len(rows)} rows: {rows[:2] if rows else '[]'}")
    return rows

def main():
    dune = DuneClient(api_key=DUNE_API_KEY)
    current_offset = load_checkpoint()
    total_rows_fetched = current_offset

    print(f"Thư mục hiện tại: {os.getcwd()}")
    print(f"Tiếp tục từ offset: {current_offset}")

    csv_exists = os.path.exists(OUTPUT_CSV)
    json_exists = os.path.exists(OUTPUT_JSON)

    while True:
        if MAX_ROWS and total_rows_fetched >= MAX_ROWS:
            print("🏁 Reached MAX_ROWS limit. Stopping.")
            break

        start_row = current_offset
        end_row = current_offset + BATCH_SIZE
        print(f"Current offset: {current_offset}, Batch: {start_row + 1}-{end_row}")

        try:
            rows = fetch_batch(dune, start_row, end_row)
            if not rows:
                print("⚠️ No more rows to fetch. Stopping.")
                break

            df = pd.DataFrame(rows)
            if all(col in df.columns for col in ['address', 'name', 'category']):
                df = df[['address', 'name', 'category']]
                # Không cần dedup nữa vì SQL đã xử lý unique addresses
            
            df.to_csv(OUTPUT_CSV, mode='a', index=False, header=not csv_exists)
            append_to_json(df.to_dict('records'), OUTPUT_JSON)
            
            total_rows_fetched += len(df)
            current_offset += len(df)  # Tăng theo unique rows
            csv_exists = True
            json_exists = True
            save_checkpoint(current_offset)
            
            print(f"💾 Saved batch to {OUTPUT_CSV} & {OUTPUT_JSON}. Total rows: {total_rows_fetched}")
            time.sleep(BATCH_DELAY)

        except Exception as e:
            print(f"❌ Lỗi trong batch: {e}. Stopping.")
            break

    print(f"\nTotal rows fetched: {total_rows_fetched}")
    if total_rows_fetched > 0:
        print(f"✅ Hoàn tất! Kiểm tra file tại {OUTPUT_CSV} & {OUTPUT_JSON}")
    else:
        print("⚠️ No data was fetched to save.")

if __name__ == "__main__":
    main()