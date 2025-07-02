import pandas as pd
import json

with open('public/nametags/addresses-1.json', 'r', encoding='utf-8') as f:
    raw_data = json.load(f)
data = pd.DataFrame.from_dict(raw_data, orient='index')
def check_deposit(row):
    labels = row.get('Labels', {})
    for label_key in labels:
        name_tag = labels[label_key].get('Name Tag', '')
        if 'Exchange' in name_tag or 'Deposit' in name_tag:
            return True
    return False
data['is_deposit'] = data.apply(check_deposit, axis=1)
print(data['is_deposit'].value_counts().to_dict())