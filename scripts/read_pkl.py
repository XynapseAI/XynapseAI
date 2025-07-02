import pickle
import os

def read_pkl_file(file_path):
    """
    Reads data from a .pkl file.
    """
    if not os.path.exists(file_path):
        print(f"Lỗi: File không tồn tại tại đường dẫn '{file_path}'")
        return None
    
    try:
        with open(file_path, 'rb') as f: # Mở file ở chế độ đọc nhị phân ('rb')
            data = pickle.load(f) # Tải dữ liệu từ file
        print(f"Đã đọc thành công file '{file_path}'")
        return data
    except Exception as e:
        print(f"Lỗi khi đọc file '{file_path}': {e}")
        return None

# Ví dụ sử dụng: 0x2e354b3fa774331580bd257c864c23c0ab9d104a
# Thay thế 'your_wallet_address' và 'your_chain' bằng thông tin thực tế của bạn
wallet_address = '0x2e354b3fa774331580bd257c864c23c0ab9d104a' # Địa chỉ ví bạn muốn xem
chain = 'ethereum' # Chuỗi blockchain (ví dụ: 'ethereum', 'bsc')
file_type = 'transactions' # Loại dữ liệu (ví dụ: 'transactions')

# Xây dựng đường dẫn đến file
cache_dir = 'cache'
pkl_file_name = f"{wallet_address}_{file_type}_{chain}.pkl"
file_path = os.path.join(cache_dir, pkl_file_name)

# Gọi hàm để đọc file
cached_data = read_pkl_file(file_path)

if cached_data:
    print("\nDữ liệu đọc được:")
    # Các file .pkl thường chứa list các dictionary (mỗi dict là 1 transaction)
    # Hoặc có thể là một DataFrame nếu bạn lưu DataFrame trực tiếp
    if isinstance(cached_data, list):
        print(f"Số lượng bản ghi: {len(cached_data)}")
        # In ra 5 bản ghi đầu tiên để xem cấu trúc
        for i, record in enumerate(cached_data[:5]):
            print(f"--- Bản ghi {i+1} ---")
            for key, value in record.items():
                # In ra các key và value của từng bản ghi, có thể cần làm đẹp thêm
                if isinstance(value, str) and len(value) > 100: # Cắt bớt chuỗi quá dài
                    print(f"  {key}: {value[:100]}...")
                else:
                    print(f"  {key}: {value}")
            print("-" * 20)
    elif isinstance(cached_data, pd.DataFrame):
        print("Dữ liệu là DataFrame:")
        print(cached_data.head()) # In ra 5 dòng đầu của DataFrame
    else:
        print(cached_data) # In ra nếu nó là kiểu dữ liệu khác