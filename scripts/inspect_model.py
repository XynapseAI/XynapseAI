import joblib
import pandas as pd

# Tải mô hình
model = joblib.load('deposit_wallet_classifier.pkl')

# In thông tin mô hình
print("Model parameters:", model.get_params())
print("Feature names:", ['incoming_transactions', 'avg_incoming_value', 'large_outgoing_transactions', 'unique_senders'])
print("Feature importances:", model.feature_importances_)

# Tạo DataFrame để hiển thị tầm quan trọng của đặc trưng
feature_importance = pd.DataFrame({
    'Feature': ['incoming_transactions', 'avg_incoming_value', 'large_outgoing_transactions', 'unique_senders'],
    'Importance': model.feature_importances_
})
print("\nFeature Importance:")
print(feature_importance.sort_values(by='Importance', ascending=False))