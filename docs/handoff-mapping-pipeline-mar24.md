# Handoff: Ingredient Mapping Pipeline Validation

**Date**: 2026-03-24
**Branch**: `fix/mapping-pipeline-serving-bugs`
**Status**: Two pilot imports completed (100 recipes each), 13 synonym rewrites applied (fixes 60-72)

---

## What Was Done

### Two Pilot Import Cycles
1. **Batch 1**: 831 mappings, 0 failures, 0.958 avg confidence → 17 issues found (2.0%)
2. **Batch 2**: 809 mappings, 2 failures, 0.951 avg confidence → 25 issues found (3.1%)

### Fixes Applied (fixes 60-72 in `docs/mapping-fix-log.md`)
All fixes are synonym rewrites in `data/fatsecret/normalization-rules.json`:

| # | Fix | Status |
|---|-----|--------|
| 60 | `cinnamon sticks → cinnamon` | ✅ Verified |
| 61 | `tomato and green chili mix → diced tomatoes with green chilies` | ✅ Verified |
| 62 | `corn whole-kernel → canned corn` (79kcal vs 740kcal) | ✅ Verified |
| 63 | `chicken/beef/vegetable broth → stock` (7kcal vs 86kcal) | ✅ Verified |
| 64 | `quick oats → quick cooking oats` (456kcal/120g vs 160kcal/40g) | ✅ Verified |
| 65-72 | kidney beans, veggie spirals, splenda, sherry wine, dry wine, vegetarian patties, salad seasoning, chicken breast | Partially effective |

---

## Known Pipeline-Level Issues (documented in `docs/pipeline-level-issues.md`)

### 1. FDC Sort Preference Over FatSecret
- **Location**: `map-ingredient-with-fallback.ts` lines 872-873
- **Impact**: Dried bean data (229kcal/100g) beats canned data (92kcal/100g) because FDC exact matches sort first
- **Affects**: kidney beans, cannellini beans, black beans, chickpeas — all beans show 2-3x overcounting

### 2. No Cooking Wine in FDC/FatSecret
- **Impact**: `sherry wine` always maps to `vinegar sherry (SHERRY)` — FDC brand name causes false match
- **Fix needed**: Category filter (if query has "wine" and candidate has "vinegar", reject) or AI fallback

### 3. FatSecret Per-Serving Rounding
- **Impact**: Dry products with tiny per-serving sizes (0.8g) round to 0 kcal when scaled
- **Affects**: salad seasoning, some spice blends

---

## Open Issues From Batch 2 Review (for next agent)

### 🔴 HIGH PRIORITY — Serving/Weight Resolution Bugs

| Issue | Description | Suggested Fix Approach |
|-------|-------------|----------------------|
| **Yellow zucchini** → baby squash (6kcal/30g for 2 large) | Produce backfill yielding baby variant, 15-20x under | Check why `yellow zucchini` matches baby squash; may need synonym rewrite `yellow zucchini → zucchini` |
| **Red onion "large"** → 38g (should be ~175g) | Serving selection picking wrong serving for "large" | Debug serving resolution for `1 large red onion` — check produce backfill |
| **Grape tomatoes** → 2214g container weight | 18 pieces = entire container, 20x over | Count-default correction should handle this — debug with `18 organic grape tomatoes` |
| **Ham 4 slices** → 400g (should be ~100g) | Slice serving not selected correctly | Debug `4 slice ham` — may need slice-weight adjustment |
| **Mozzarella 1 slice** → 100g (should be ~28g) | Missing slice serving | Debug `1 slice mozzarella` — slice serving selection |
| **Cooking spray** → 40g for 0.33 spray | Spray unit not handled | Debug `0.3333 second spray cooking spray` — spray unit conversion needed |
| **Mini avocado** → 201g full size | "Mini" modifier not reducing weight | Synonym rewrite `mini avocado → small avocado` or weight adjustment |

### 🟡 MEDIUM PRIORITY — Wrong Product Category

| Issue | Description | Suggested Fix Approach |
|-------|-------------|----------------------|
| **Rice vinegar** → seasoned (Mizkan/Nakano) | Plain maps to seasoned, 20x overcounting per tbsp | Synonym rewrite `rice vinegar → plain rice vinegar` |
| **Garlic powder** → fresh garlic (10+ occurrences) | Low per-instance impact but systematic | Synonym rewrite `garlic powder → ground garlic powder` |
| **Onion powder** → fresh onions (5+ occurrences) | Same pattern as garlic powder | Synonym rewrite `onion powder → ground onion powder` |
| **Sour cream** → light sour cream | 25% undercounting | Synonym rewrite to avoid "light" variant |
| **Pitted cherries** → maraschino | Fresh vs processed mismatch | Synonym rewrite `pitted cherries → fresh cherries` |
| **Sesame seed oil** → 7.5g/tbsp (should be 14g) | Same half-tbsp pattern as avocado oil | Check FatSecret serving data for this product |

### 🟠 RECURRING FROM BATCH 1 (still not fully fixed)

| Issue | Notes |
|-------|-------|
| Quick oats 40g/cup | Fix 64 applied but batch 2 shows `Quick Oats (First Street)` at 40g winning over AUGASON FARMS at 120g |
| Splenda 100g serving | FDC data issue, 0 calorie impact |
| Creme brulee creamer → original | ~10 kcal diff, acceptable |
| Oil half-tbsp weights | Affects sesame oil, occasionally avocado oil |

---

## Key Files & Tools

| File | Purpose |
|------|---------|
| `data/fatsecret/normalization-rules.json` | **Primary fix location** — synonym rewrites applied at normalize step |
| `docs/mapping-fix-log.md` | Fix history (fixes 1-72), root causes, test results |
| `docs/pipeline-level-issues.md` | Issues requiring code changes (FDC preference, database gaps) |
| `src/scripts/debug-ingredient.ts` | Debug single ingredient: `npx tsx src/scripts/debug-ingredient.ts "1 cup quick oats"` |
| `src/scripts/gather-candidates.ts` | See all candidates: `npx tsx src/scripts/gather-candidates.ts "quick oats"` |
| `src/scripts/check-cache-entry.ts` | Clear cache: `npx tsx src/scripts/check-cache-entry.ts "quick oats" --clear` |
| `scripts/pilot-batch-import.ts` | Run import: `$env:ENABLE_MAPPING_ANALYSIS='true'; npx tsx scripts/pilot-batch-import.ts 100` |
| `scripts/clear-all-mappings.ts` | Nuclear option: clears ALL mapping caches |

## Workflow

1. **Debug in isolation**: `npx tsx src/scripts/debug-ingredient.ts "ingredient text"`
2. **Identify root cause**: Check if it's synonym, serving, filter, or data issue
3. **Apply fix**: Add synonym rewrite to `normalization-rules.json` (try scalable fixes first)
4. **Clear cache**: `npx tsx src/scripts/check-cache-entry.ts "ingredient" --clear`
5. **Verify**: Re-run debug script, confirm fix works
6. **Document**: Add fix entry to `docs/mapping-fix-log.md`
7. **Batch test**: Run pilot import when all fixes applied

> **Important**: The JSON rules file (`normalization-rules.json`) is the **source of truth** — `DEFAULT_RULES` in `normalization-rules.ts` is only a fallback if JSON is missing. Always edit the JSON file.

---

## Summary Logs

- Batch 1: `logs/mapping-summary-2026-03-24T16-30-19.txt`
- Batch 2: `logs/mapping-summary-2026-03-25T00-23-15.txt`
- Batch 1 review: `C:\Users\diega\.gemini\antigravity\brain\99de9884-321f-4891-983f-95c94a71242b\mapping_review.md.resolved`
- Batch 2 review: `C:\Users\diega\.gemini\antigravity\brain\99de9884-321f-4891-983f-95c94a71242b\mapping_review_2.md.resolved`
