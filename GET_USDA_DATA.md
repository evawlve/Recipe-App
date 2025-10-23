# How to Get USDA FoodData Central Data

## Option 1: Download from USDA (Recommended)

1. **Visit FoodData Central**: https://fdc.nal.usda.gov/download-datasets.html
2. **Download "Foundation Foods"** dataset (most comprehensive)
3. **Extract the JSON file** and place it at `./data/usda/fdc.jsonl`

## Option 2: Use USDA API (Alternative)

If you prefer to fetch data programmatically:

```bash
# Download Foundation Foods (smaller, good for testing)
curl -o ./data/usda/fdc.jsonl "https://fdc.nal.usda.gov/fdc-datasets/Foundation_Foods_foundation_food_json_2024-10-15.zip"

# Or download Survey Foods (larger, more comprehensive)
curl -o ./data/usda/fdc.jsonl "https://fdc.nal.usda.gov/fdc-datasets/Survey_Foods_foundation_food_json_2024-10-15.zip"
```

## Option 3: Use Sample Data (For Testing)

The system already includes sample data for testing:
- `./data/usda/sample-fdc.jsonl` - 5 sample foods for testing

## File Format Expected

The system expects JSONL format (one JSON object per line):
```json
{"fdcId": 1, "description": "Olive oil, extra virgin", "dataType": "SR Legacy", "foodNutrients": [...]}
{"fdcId": 2, "description": "Chicken breast, raw", "dataType": "SR Legacy", "foodNutrients": [...]}
```

## Once You Have the Data

```bash
# Test with dry run first
npm run usda:saturate -- --file=./data/usda/fdc.jsonl --dry-run

# Run keyword sweep
npm run usda:saturate -- --file=./data/usda/fdc.jsonl --keywords="$(tr '\n' ',' < data/usda/keywords-common.txt)"

# Full saturation
npm run usda:saturate -- --file=./data/usda/fdc.jsonl
```

## Expected Results

With real USDA data, you should see:
- Thousands of foods imported
- Proper filtering (no branded/baby/supplement items)
- Category mapping working
- Strong deduplication
- High-confidence search results
