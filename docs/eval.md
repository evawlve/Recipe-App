# Evaluation System Documentation

## Overview

The evaluation system provides automated testing and metrics tracking for ingredient parsing and food mapping. It uses a versioned gold dataset and generates baseline metrics reports.

## Gold Dataset

### Versioning

The gold dataset is versioned and immutable:
- `eval/gold.v1.csv` - Initial 100 test cases (Sprint 0)
- `eval/gold.v2.csv` - +150 cases for piece/leaf/clove overrides (Sprint 2)
- `eval/gold.v3.csv` - +100 cases for international synonyms (Sprint 4)
- `eval/gold.v4.csv` - +100 branded cases (Sprint 5)
- `eval/gold.v5.csv` - +50 user-pain cases (Sprint 7)

### CSV Schema

```csv
id,raw_line,expected_food_name,expected_grams,expected_source,expected_source_tier,form,unit_type,cuisine_tag,difficulty,expected_food_id_hint,expected_unit_hint,notes
```

**Columns:**
- `id` - Unique identifier
- `raw_line` - Raw ingredient line to parse
- `expected_food_name` - Expected food name match
- `expected_grams` - Expected grams value
- `expected_source` - Expected source (usda, template, community)
- `expected_source_tier` - Expected resolution tier (override | usda_portion | density | heuristic | branded)
- `form` - Form (raw/cooked/canned/prepared)
- `unit_type` - Unit type (piece/leaf/clove/volume/mass)
- `cuisine_tag` - Optional cuisine tag
- `difficulty` - Difficulty level (easy/medium/hard)
- `expected_food_id_hint` - Stable substring/regex to disambiguate expected food (prevents name drift)
- `expected_unit_hint` - Unit type enum (leaf|clove|yolk|white|piece|slice|sheet|stalk) for unit-hint plumbing
- `notes` - Optional notes

### Coverage

**gold.v1.csv (100 cases):**
- Eggs, proteins, vegetables, grains, oils, dairy
- Ambiguity cases: egg white vs yolk, garlic variants
- Difficulty distribution: ~60% easy, ~30% medium, ~10% hard
- At least 20 piece/leaf/clove cases
- At least 10 volume→density cases
- At least 10 branded cases (flagged for Sprint 5)

### Future Expansion Plan

- **Sprint 2**: +150 cases → `gold.v2.csv` (piece/leaf/clove overrides)
- **Sprint 4**: +100 cases → `gold.v3.csv` (international synonyms)
- **Sprint 5**: +100 branded → `gold.v4.csv` (branded on-demand)
- **Sprint 7**: +50 user-pain → `gold.v5.csv` (beta feedback)

## Evaluation Harness

### Usage

```bash
# Run evaluation
npx ts-node eval/run.ts

# Output: reports/eval-baseline-YYYYMMDD.json
```

### Metrics Tracked

- **P@1 (Precision at 1)**: Percentage of cases where the top-ranked food match is correct
- **MAE (Mean Absolute Error)**: Average absolute difference between expected and actual grams
- **Provisional Rate**: Percentage of cases that fall back to assumed serving

### Baseline Metrics (gold.v1)

Source: `reports/eval-baseline-20251108.json` (updated baseline with 1493 foods)
- **Mapping P@1**: 38.0%
- **Portion MAE**: 114.0 g
- **Provisional Rate**: 34.0%

**Note:** Baseline updated to reflect current database state with 1493 foods. Lower P@1 (38% vs 47%) is expected due to more candidate foods affecting search ranking.

### Local Evaluation

**Run eval locally during sprints:**
```bash
# Ensure database is seeded
npm run usda:saturate:mini  # or use your full dataset

# Run evaluation
npm run eval

# Check results in reports/eval-baseline-YYYYMMDD.json
```

**Compare against baseline:**
- Current baseline: 38% P@1, 114.0g MAE
- Track improvements over time by comparing local results
- Update baseline in `docs/Sprint_0_Report.md` when making significant improvements

**Why local-only?**
- CI database state differs from local (mini dataset vs full dataset)
- Local evaluation provides more accurate and consistent results
- Run eval manually during sprints to track progress

## Reports

Evaluation reports are stored in `reports/`:
- `reports/eval-baseline-YYYYMMDD.json` - Baseline metrics report
- `reports/parser-bench-YYYYMMDD.json` - Parser performance benchmarks

## Notes

- Baseline is intentionally rough; many misses stem from portion resolution (unit hints) and candidate ranking (uncooked vs cooked)
- Branded path validated separately via smoke script; `ENABLE_BRANDED_SEARCH` remains false
- Gold drift: without ID/regex hints, name changes can break P@1; mitigated via `expected_food_id_hint`

