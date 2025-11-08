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

Source: `reports/eval-baseline-20251106.json`
- **Mapping P@1**: 47.0%
- **Portion MAE**: 114.9 g
- **Provisional Rate**: 32.0%

### CI Integration

**Exit Gate Requirements:**
- CI job `eval:baseline` runs `eval/run.ts` on main and PR head
- PR fails if:
  - P@1 drops >1.5% (when `ENABLE_PORTION_V2=false`)
  - MAE increases >2g (when `ENABLE_PORTION_V2=false`)
- Artifacts (JSON report) stored per run

## Reports

Evaluation reports are stored in `reports/`:
- `reports/eval-baseline-YYYYMMDD.json` - Baseline metrics report
- `reports/parser-bench-YYYYMMDD.json` - Parser performance benchmarks

## Notes

- Baseline is intentionally rough; many misses stem from portion resolution (unit hints) and candidate ranking (uncooked vs cooked)
- Branded path validated separately via smoke script; `ENABLE_BRANDED_SEARCH` remains false
- Gold drift: without ID/regex hints, name changes can break P@1; mitigated via `expected_food_id_hint`

