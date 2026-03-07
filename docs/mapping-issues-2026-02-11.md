# Mapping Issues Report — 2026-02-11

**Source**: `logs/mapping-summary-2026-02-11T17-25-24.txt`
**Total Ingredients**: 2114 | **Failures (✗)**: 7 | **Flagged Issues**: ~40+

---

## Table of Contents

1. [Incorrect Matches (Wrong Food)](#1-incorrect-matches-wrong-food)
2. [Failed Mappings (No Match)](#2-failed-mappings-no-match)
3. [Nutritional Data Issues (Suspicious Calories/Weight)](#3-nutritional-data-issues)
4. [Root Cause Analysis (Per Debugging Workflow)](#4-root-cause-analysis)
5. [Previously Logged Fixes That Still Fail](#5-previously-logged-fixes-that-still-fail)
6. [Recommended Actions](#6-recommended-actions)

---

## 1. Incorrect Matches (Wrong Food)

These are entries marked `✓` but mapped to the **wrong food entirely**.

| # | Line | Raw Ingredient | Mapped To | Expected | Severity | Issue Pattern |
|---|------|---------------|-----------|----------|----------|---------------|
| 1 | 972 | `"2 cup water - 1 to 2 cups"` | Water Spinach (12kcal/60g) | Water (0kcal) | **HIGH** | Wrong Positional Candidate — "water" token matched "Water Spinach" instead of plain water |
| 2 | 982 | `"1 cup or red tomato"` | Tomato & Red Pepper Bisque (Planet Sub) (277kcal) | Tomatoes (~32kcal) | **HIGH** | Wrong Positional Candidate — "red tomato" matched a restaurant soup product |
| 3 | 987 | `"0.25 cup sun tomato halves"` | Sun-Dried Tomato Sausage (Aidells) (53kcal) | Sun-Dried Tomatoes (~35kcal) | **HIGH** | Wrong Positional Candidate — "sun tomato" matched sausage product containing "sun-dried tomato" in name |
| 4 | 1182 | `"1  plum tomato"` | Italian Plum Tomato Marinara (Mezzetta) (130kcal) | Plum Tomato (~11kcal) | **HIGH** | Wrong Positional Candidate — matched marinara sauce instead of raw produce |
| 5 | 1418 | `"20  mint"` | Mint Patties (Brach's) (933kcal/240g) | Mint (herb) (~1kcal) | **HIGH** | Wrong Positional Candidate — "mint" matched candy instead of herb; quantity "20" amplified to massive weight |
| 6 | 1359 | `"1 package cubed tofu"` | Fried Tofu (538kcal/200g) | Firm/Regular Tofu (~176kcal/200g) | **HIGH** | Modifier Stripping — "cubed" stripped, "tofu" matched "Fried Tofu" instead of plain tofu |
| 7 | 699, 1262 | `"4  lemons crosswise"` | raw lemon peel (28kcal/60g) | Lemons (~80kcal/268g) | **HIGH** | Wrong Positional Candidate — "lemon" matched peel instead of whole fruit; "crosswise" not stripped |
| 8 | 720 | `"8  lemons"` | raw lemon peel (56kcal/120g) | Lemons (~160kcal/536g) | **HIGH** | Wrong Positional Candidate — "lemons" matched peel instead of whole fruit |
| 9 | 811, 1312 | `"0.25 tsp dill"` | Dill Cucumber Pickles (0kcal) | Dill (herb/weed) (~0kcal) | **MEDIUM** | Wrong Positional Candidate — "dill" matched pickled product; nutrition similar but food is wrong |
| 10 | 866, 1233 | `"5 sprig dill"` | Dill Cucumber Pickles (5kcal/35g) | Dill (herb) (~2kcal) | **MEDIUM** | Same as above — "dill" matching pickles instead of herb |
| 11 | 838 | `"3 cup spinach"` | Creamed Spinach (Omaha Steaks) (high cal) | Spinach (raw) (~21kcal) | **HIGH** | Wrong Positional Candidate — matched prepared dish instead of raw produce |
| 12 | 490, 941, 1307 | `"1 medium tomato"` / `"0.25 cup tomato"` | Tomato (Arby's) (15kcal) | Tomato (raw) (~22kcal) | **MEDIUM** | Branded Drift — restaurant chain product selected over generic raw produce |
| 13 | 1367 | `"3  strips green peppers"` | Roasted Bell Pepper Strips (Jeff's Naturals) (64kcal/360g) | Green Bell Peppers (raw) (~20kcal) | **MEDIUM** | Processing State Trap — jarred roasted product matched instead of fresh produce; inflated weight |
| 14 | 1199 | `"Cherries"` | CHERRIES (LEHI VALLEY TRADING CO) (488kcal/150g) | Fresh Cherries (~77kcal/150g) | **HIGH** | Data Quality — 488kcal/150g suggests dried/candied cherries, not fresh; branded product mismatch |
| 15 | 1323 | `"3  strips yellow peppers"` | red peppers yellow peppers mixed pepper strips (RALEY'S) (108kcal/450g) | Yellow Bell Peppers (~30kcal) | **MEDIUM** | Branded/Mixed Product — mapped to mixed multi-pepper retail package instead of single pepper strips |

---

## 2. Failed Mappings (No Match)

These are entries marked `✗` with `[LOW_CONF]` or missing nutritional data.

| # | Lines | Raw Ingredient | Conf | Issue |
|---|-------|---------------|------|-------|
| 1 | 478, 780, 969 | `"Canellini Beans"` | 0.00 | **Spelling variant** — "Canellini" vs "Cannellini" (double-n). API search fails on misspelling. |
| 2 | 480, 782, 970 | `"16 oz canellini beans"` | 0.00 | Same as above — misspelled variant not resolved |
| 3 | 1348 | `"0.25 tsp spice blend mustard"` | 1.00 ✗ | **Hydration failure** — matched "Spice Blend Mustard (Sabrett)" at 1.00 confidence but no nutritional data returned (serving lookup failed) |

---

## 3. Nutritional Data Issues

### 3a. Suspiciously High Calories (Weight/Serving Issues)

| # | Line | Raw Ingredient | Mapped To | Kcal | Weight | Concern |
|---|------|---------------|-----------|------|--------|---------|
| 1 | 989 | `"30 oz cannellini beans"` | CANNELLINI BEANS (D'ALLESANDRO) | **2917kcal** | 850g | Dried bean density applied to what is likely canned weight; FDC data may be for dry beans |
| 2 | 1090 | `"10 oz red kidney beans"` | RED KIDNEY BEANS (365) | **944kcal** | 283g | Same issue — dry bean kcal density (~340kcal/100g) applied to canned-weight quantity |
| 3 | 1299 | `"20  grape tomatoes"` | Grape Tomatoes | 311kcal/**2460g** | 2460g | **Weight wildly wrong** — 20 grape tomatoes ≈ 200g, not 2460g. Possible serving multiplier bug (similar to Fix 29) |
| 4 | 1333 | `"18  organic grape tomatoes"` | Organic Grape Tomatoes | 386kcal/**1080g** | 1080g | Same issue — 18 grape tomatoes ≈ 180g, not 1080g. Serving count not extracted from description |
| 5 | 1369 | `"Cheddar Jack Cheese"` | CHEDDAR JACK CHEESE (PRICE RITE) | **1517kcal** | 425g | No quantity specified → defaulted to entire retail package weight (425g) |
| 6 | 1057 | `"4  sprays butter cooking spray"` | Butter Cooking Spray (Mazola) | 0kcal/**480g** | 480g | 4 sprays ≈ 2g, not 480g. "Spray" unit not properly handled, defaulted to container weight |

### 3b. Suspiciously Low Calories / Zero-Macro Trap

| # | Line | Raw Ingredient | Mapped To | Kcal | Weight | Concern |
|---|------|---------------|-----------|------|--------|---------|
| 1 | 909, 949 | `"2 tbsp italian seasoning"` | Italian Seasoning (Spice Classics) | **0kcal** | 11g | Zero-calorie for a seasoning blend is wrong; dried herbs ~3-5kcal/tbsp |
| 2 | 947 | `"1 tsp vanilla"` | Vanilla (Kreatures of Habit) | 17kcal | 4.6g | Branded product — generic "vanilla" should map to vanilla extract (~12kcal/tsp) |

### 3c. Quantity Parsing Issues

| # | Line | Raw Ingredient | Issue |
|---|------|---------------|-------|
| 1 | 756, 972 | `"2 cup water - 1 to 2 cups"` | Range expression not parsed — trailing "- 1 to 2 cups" causes search query to include "water" + noise words → "Water Spinach" |
| 2 | 978 | `"0.25 tbsp basil - 1 teaspoon basil"` | Alternative measurement appended — "- 1 teaspoon basil" treated as ingredient name |
| 3 | 994 | `"1 tbsp parmesan cheese -per serving sprinkle..."` | Cooking instructions leaked into ingredient name |

---

## 4. Root Cause Analysis (Per Debugging Workflow)

Cross-referencing issues against the documented debugging patterns from:
- `.agent/workflows/autonomous-validation.md` (Phase 4: Investigate)
- `debugging_workflow.md` (Common Issue Patterns)

### Pattern A: Wrong Positional Candidate (Issues #1-11)

**Workflow Reference**: `debugging_workflow.md` § 2 — "Wrong Positional Candidate"

> **Symptom**: API result #1 (or a high-ranking result) is a branded/prepared product that shares tokens with the query but is a completely different food category.

**Affected Items**: Water → Water Spinach, Mint → Mint Patties, Dill → Dill Cucumber Pickles, Plum Tomato → Marinara, Lemons → Lemon Peel, Spinach → Creamed Spinach, Red Tomato → Bisque

**Root Cause Chain**:
1. **Step 4 (Gather)**: API returns both correct and incorrect candidates
2. **Step 5 (Filter)**: `filterCandidatesByTokens()` does not reject the wrong candidate because it shares the core token (e.g., "dill" is in both "Dill" and "Dill Cucumber Pickles")
3. **Step 7 (Rerank)**: `simpleRerank()` scores the wrong candidate higher due to source preference boost (FatSecret) or because the wrong candidate has more token overlap (e.g., "Water Spinach" matches "water" token)
4. **Filter Gap**: `CATEGORY_CHANGING_TOKENS` (Fix 23) doesn't include all relevant dish/product tokens (e.g., "pickles", "patties", "bisque", "marinara", "peel")

**Debugging Steps** (from `autonomous-validation.md` Phase 4):
```powershell
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-mapping-pipeline.ts "20 mint" --skip-cache
```
Check Step 5 (Filter) and Step 7 (Rerank) output to see why "Mint Patties" outscored "Mint" herb.

### Pattern B: Spelling Variant / Synonym Gap (Issues: Canellini Beans)

**Workflow Reference**: `debugging_workflow.md` § 2 — "British/Regional Terms" (generalized to typo handling)

**Root Cause**: The misspelling "Canellini" (one 'n') does not match any API results for "Cannellini" (double 'n'). No fuzzy matching or synonym mapping exists for common misspellings.

**Fix Location**: `src/lib/parse/ingredient-line.ts` — add spelling correction map, or `gather-candidates.ts` — add "canellini" → "cannellini" synonym.

### Pattern C: Processing State Trap (Issues: Fried Tofu, Roasted Peppers)

**Workflow Reference**: `debugging_workflow.md` § 2 — "Processing State Trap"

> **Symptom**: Processed/prepared product scored significantly different from raw due to API rank.

**Root Cause**: "cubed tofu" → AI strips "cubed" → searches "tofu" → "Fried Tofu" ranks higher in API results. No guard exists to reject "fried" when query doesn't specify cooking method.

**Fix Location**: `filter-candidates.ts` — add processing state guards (fried/roasted/grilled should not match plain queries).

### Pattern D: Double Multiplier / Serving Extraction (Issues: Grape Tomatoes, Cooking Spray)

**Workflow Reference**: `debugging_workflow.md` § 2 — "Double Multiplier"

> **Symptom**: Quantity multiplied by a serving that already includes the count.

**Root Cause**: For "20 grape tomatoes", the serving description may be "1 cup" or a bulk weight. The system multiplies 20 × full serving weight instead of 20 × single-item weight. Fix 29 addressed this for olives but the pattern persists for produce items without explicit per-piece servings.

**Fix Location**: `selectServing()` in `map-ingredient-with-fallback.ts` — extend count extraction regex to handle produce items.

### Pattern E: Retail Container Trap (Issues: Cheddar Jack Cheese, Cooking Spray)

**Workflow Reference**: `debugging_workflow.md` § 2 — "Retail Container Trap"

> **Symptom**: Mapping selected a retail container serving (full package) for a generic unit-less request.

**Root Cause**: No quantity/unit specified → system defaults to full package weight from API data.

### Pattern F: Data Quality / Branded Drift (Issues: Cherries, Tomato Arby's, Italian Seasoning)

**Workflow Reference**: `debugging_workflow.md` § "Data Quality Pathology" and "Zero-Macro Product Trap"

**Root Cause**: API returns branded/specialty products (dried cherries, restaurant items) that have drastically different nutritional profiles from the generic food. Scoring doesn't adequately penalize brand-specific variants when the query is generic.

---

## 5. Previously Logged Fixes That Still Fail

The following fixes from `docs/mapping-fix-log.md` appear to have **regressed** or are not fully effective based on the current mapping summary:

### Fix 7: Tomato Preparation State Guards — PARTIALLY FAILING

| Fix Claim | Current Evidence |
|-----------|-----------------|
| "crushed rejects fresh; fresh rejects crushed/diced/canned" | Line 982: `"1 cup or red tomato"` → Tomato & Red Pepper Bisque (not fresh tomato). Line 1182: `"1 plum tomato"` → Italian Plum Tomato Marinara (not raw plum tomato). |
| **Diagnosis** | The guards work for explicit "crushed tomatoes" queries but don't protect **raw tomato queries** from mapping to branded sauce/soup products. The `isCategoryMismatch` logic doesn't have guards for "marinara", "bisque", "soup" as exclusions for raw tomato queries. |
| **Possible Cache Issue** | These may be stale `ValidatedMapping` or `early_cache` entries from before Fix 7 was applied. Check `selectionReason` — if `{early_cache}`, the fix is being bypassed entirely. |

### Fix 23: Category-Changing Token Detection — INCOMPLETE

| Fix Claim | Current Evidence |
|-----------|-----------------|
| "50+ category-changing tokens with 0.50 penalty" | Line 1418: `"20 mint"` → Mint Patties (candy). Line 811: `"dill"` → Dill Cucumber Pickles. Line 1182: `"plum tomato"` → Marinara sauce. |
| **Diagnosis** | The `CATEGORY_CHANGING_TOKENS` set is missing: `patties`, `pickles`, `marinara`, `bisque`, `peel`, `soup`. These allow prepared/processed products to pass through without penalty. |

### Fix 26: Cache Core Token Validation — POSSIBLY BYPASSED

| Fix Claim | Current Evidence |
|-----------|-----------------|
| "`hasCoreTokenMismatch()` validates core tokens exist in cached food name" | Line 982: `"red tomato"` → "Tomato & Red Pepper Bisque" — both "tomato" and "red" are present in the candidate name, so the core token check passes despite being a soup. |
| **Diagnosis** | Core token validation is a necessary but insufficient check. It validates token *presence* but not *food category*. "Tomato & Red Pepper Bisque" contains "tomato" and "red" so it passes, even though it's a soup. A **category exclusion** layer is needed on top of core token checks. |

### Fix 29: Count-Based Serving Multiplier — NOT APPLIED TO ALL PRODUCE

| Fix Claim | Current Evidence |
|-----------|-----------------|
| "Extract count from '10 large' descriptions → correct gram calculation" | Line 1299: `"20 grape tomatoes"` → 2460g (should be ~200g). Line 1333: `"18 organic grape tomatoes"` → 1080g (should be ~180g). |
| **Diagnosis** | Fix 29's regex `^(\d+)\s+(small|medium|large|extra\s*large)` only matches descriptions with size qualifiers. Grape tomatoes use servings like "1 cup" or "5 tomatoes" where the count isn't in `small/medium/large` format. The serving multiplier bug persists for count-based produce without explicit size descriptors. |

### Fix 31: Live Candidate Core Token Validation — PARTIAL GAPS

| Fix Claim | Current Evidence |
|-----------|-----------------|
| "Filter out candidates missing core tokens like 'rice' or 'bouillon'" | Line 987: `"sun tomato halves"` → Sun-Dried Tomato Sausage — "tomato" token is present but "sausage" should be a category-changing token rejection. |
| **Diagnosis** | Core token validation ensures the query's core token is present in the candidate, but doesn't prevent category drift when extra tokens (like "sausage") change the food category entirely. This is a defense-in-depth gap with Fix 23. |

### Spelling/Synonym Fixes — MISSING FOR COMMON VARIANTS

| Missing Fix | Current Evidence |
|-------------|-----------------|
| No fix for "canellini" misspelling | Lines 478, 480, 780, 782, 969, 970: `"Canellini Beans"` → fails with 0.00 confidence every time |
| **Diagnosis** | The synonym system (Fix 14) handles British terms (marrow → zucchini) but doesn't handle common misspellings. "Canellini" is a frequent user typo for "Cannellini". |

---

## 6. Recommended Actions

### Priority 1 — HIGH Severity Fixes

| Action | Target Files | Issue Numbers |
|--------|-------------|---------------|
| Add `patties`, `pickles`, `marinara`, `bisque`, `peel`, `soup`, `sausage`, `noodles` to `CATEGORY_CHANGING_TOKENS` | `src/lib/fatsecret/simple-rerank.ts` | #5, #9, #10, #2, #3, #4 |
| Add "canellini" → "cannellini" spelling correction | `src/lib/parse/ingredient-line.ts` or `gather-candidates.ts` | Failed mappings #1, #2 |
| Add processing state guard: plain queries reject "fried", "roasted" (jarred), "creamed" candidates | `src/lib/fatsecret/filter-candidates.ts` | #6, #11, #13 |
| Fix count-based serving for produce without size qualifiers (grape tomatoes, cherry tomatoes) | `src/lib/fatsecret/map-ingredient-with-fallback.ts` (`selectServing`) | 3a #3, #4 |
| Add "water" → plain water shortcut or guard against "Water Spinach" for water queries | `filter-candidates.ts` or `gather-candidates.ts` | #1 |

### Priority 2 — MEDIUM Severity Fixes

| Action | Target Files | Issue Numbers |
|--------|-------------|---------------|
| Prefer raw/generic produce over restaurant-branded items (Arby's Tomato) | `simple-rerank.ts` (brand penalty for restaurant chains) | #12 |
| Add "lemon" whole fruit preference over "lemon peel" when no modifier specified | `filter-candidates.ts` | #7, #8 |
| Handle range expressions in quantities (`"2 cup water - 1 to 2 cups"`) — strip after dash | `src/lib/parse/ingredient-line.ts` | 3c #1 |
| Handle cooking instructions appended after dash (`"parmesan cheese -per serving..."`) | `src/lib/parse/ingredient-line.ts` | 3c #3 |
| Handle retail container default when no qty specified | `selectServing()` — cap default to single serving | 3a #5, #6 |

### Priority 3 — Verification & Cache Purge

| Action | Purpose |
|--------|---------|
| Run `scripts/clear-all-mappings.ts` to purge all caches | Eliminate stale `ValidatedMapping` / `early_cache` entries that bypass new fixes |
| Re-run pilot batch import with `ENABLE_MAPPING_ANALYSIS=true` | Verify fixes against full dataset |
| Run `scripts/debug-mapping-pipeline.ts` on each HIGH severity item with `--skip-cache` | Confirm root cause before implementing fix |

---

## Debugging Quick Reference

Per `autonomous-validation.md` Phase 4, use these commands to investigate each issue:

```powershell
# Debug a specific ingredient
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-mapping-pipeline.ts "INGREDIENT" --skip-cache

# Full pipeline debug (production parity)
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-full-pipeline.ts --ingredient "INGREDIENT" --no-cache

# Clear all caches before testing
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/clear-all-mappings.ts

# Re-run pilot import
$env:ENABLE_MAPPING_ANALYSIS='true'; npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/pilot-batch-import.ts 100
```

---

*Generated: 2026-02-11 from mapping-summary-2026-02-11T17-25-24.txt*
*Cross-referenced against: autonomous-validation.md, debugging_workflow.md, mapping-fix-log.md*

