import gzip
import sys

with gzip.open('data/openfoodfacts.csv.gz', 'rt', encoding='utf-8', errors='replace') as f:
    header = f.readline()
    cols = header.split('\t')
    print(f'Total columns: {len(cols)}')
    for i, c in enumerate(cols):
        print(f'{i}: {c.strip()}')
    print('\n--- First data row ---')
    row1 = f.readline().split('\t')
    for i, val in enumerate(row1[:60]):
        if cols[i].strip() in ['code','product_name','brands','countries_tags','energy-kcal_100g','proteins_100g','carbohydrates_100g','fat_100g','serving_size','scans_n','completeness','lang','main_category_en']:
            print(f'  {cols[i].strip()}: {val.strip()[:80]}')
