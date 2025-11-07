# USDA Saturation System

This system fills the local database with generic USDA foods (treated as verified) while maintaining strong deduplication and coverage.

## Overview

**Goal**: Fill the local DB with as many generic USDA foods as possible, keeping only two sources:
- `source='usda'` (verified)
- `source='community'` (unverified until promoted)

No live USDA calls at runtime. The modal always searches the local DB; if nothing is great, users can Quick Create.

## Files Created

### Configuration
- `src/ops/usda/config.ts` - Import filters and configuration
- `src/ops/usda/category-map.ts` - USDA to category mapping logic
- `src/ops/usda/dedupe.ts` - Extended with canonical names and macro fingerprints

### Scripts
- `scripts/usda-saturate.ts` - Main saturation script with keyword sweep
- `data/usda/keywords-common.txt` - Common foods keyword list

### Tests
- `src/ops/usda/__tests__/saturate-smoke.test.ts` - Smoke tests for dedupe and category mapping

## Usage

### 1. Prepare USDA Data
Put your USDA dump at `./data/usda/fdc.jsonl` (or `.json`).

### 2. Run Dry Run
Gauge input size first:
```bash
npm run usda:saturate -- --file=./data/usda/fdc.jsonl --dry-run
```

### 3. Focused Keyword Sweep
Start with common keywords:
```bash
npm run usda:saturate -- --file=./data/usda/fdc.jsonl --keywords="$(tr '\n' ',' < data/usda/keywords-common.txt)"
```

### 4. Full Saturation Pass
```bash
npm run usda:saturate -- --file=./data/usda/fdc.jsonl
```

## Import Filters

The system includes comprehensive filters to exclude:
- Branded items
- Baby foods
- Supplements
- Meal kits
- Restaurant items
- Niche products with inconsistent macros

## Category Mapping

Automatically maps USDA foods to your categories:
- `oil` - Oils and fats
- `flour` - Flours and starches
- `meat` - Proteins (chicken, beef, etc.)
- `dairy` - Milk, yogurt, cheese
- `veg` - Vegetables
- `fruit` - Fruits
- And more...

## Strong Deduplication

Uses two-level deduplication:
1. **Canonical names** - Normalized food names
2. **Macro fingerprints** - Bucketed nutritional values

Prevents near-duplicates across USDA & curated items.

## Verification

Check results:
```bash
# Admin stats
curl -s http://localhost:3002/api/admin/food-stats | jq .

# Search examples
curl -s "http://localhost:3002/api/foods/search?s=avocado" | jq '.data[0] | {name,source,verification,servingOptions}'
curl -s "http://localhost:3002/api/foods/search?s=chicken breast" | jq '.data[0] | {name,categoryId,confidence}'
```

## Acceptance Checklist

- [ ] Import filters exclude branded/baby/supplement/restaurant items
- [ ] Category mapping fills categoryId for >80% of common foods
- [ ] Dedupe prevents near-duplicates across USDA & curated items
- [ ] Every imported food gets: per-100g macros, auto-units (via category), and alias (canonical name)
- [ ] `/api/admin/food-stats` shows large counts for source=usda
- [ ] Search returns high-confidence matches for broad terms (oil, egg, rice, greek yogurt, peanut butter, broccoli, banana, whey)

## Script Options

```bash
# Basic usage
npm run usda:saturate -- --file=./data/usda/fdc.jsonl

# Dry run
npm run usda:saturate -- --file=./data/usda/fdc.jsonl --dry-run

# Keyword sweep
npm run usda:saturate -- --file=./data/usda/fdc.jsonl --keywords=rice,oil,egg --max-per-keyword=50

# Custom filters (modify config.ts)
npm run usda:saturate -- --file=./data/usda/fdc.jsonl
```

## Expected Results

After successful saturation, you should see:
- Thousands of `source: usda` + `verification: verified` rows
- Proper categories, serving options, and aliases
- No branded clutter
- Strong deduplication
- High-confidence search matches for common foods
