# Mapping Pipeline Fix Log

This document tracks fixes applied to the ingredient mapping pipeline for future reference when diagnosing regressions.

---

## 2026-01-21: Mapping Summary Analysis Fixes

**Source**: `mapping-summary-2026-01-21T03-24-51.txt`

### Fix 1: Dimension Pattern Stripping
| Issue | `"1 5" long sweet potato"` → Long Rice Noodles |
|-------|------------------------------------------------|
| Root Cause | Parser didn't strip `5"` dimension marker |
| Fix | Added regex in `ingredient-line.ts` to remove `\b\d+['"]\s*` patterns |
| Test | `'1 5" long sweet potato'` → parses as `"long sweet potato"` |

### Fix 2: Dairy Physical State Guard
| Issue | `"1.5 cup milk lowfat"` → Lowfat Dry Milk (powder) |
|-------|-----------------------------------------------------|
| Root Cause | No guard for liquid vs dry form |
| Fix | Added `dry`, `powder`, `powdered` to milk exclusions in `filter-candidates.ts` |
| Test | `isCategoryMismatch('milk lowfat', 'Lowfat Dry Milk')` → true |

### Fix 3: Juice Token Enforcement
| Issue | `"pineapple juice"` → Pineapple (whole fruit) |
|-------|-----------------------------------------------|
| Root Cause | "juice" not enforced as required token |
| Fix | Verified `isFoodTypeMismatch` already requires "juice" when query ends with it |
| Test | Query ending with "juice" rejects candidates without "juice" |

### Fix 4: Tacos vs Nachos Guard
| Issue | `"tacos"` → nachos taco bell |
|-------|------------------------------|
| Root Cause | "taco" in brand name matched as food type |
| Fix | Added exclusion: tacos rejects nachos, chips |
| Test | `isCategoryMismatch('tacos', 'nachos taco bell')` → true |

### Fix 5: Specialty Pasta/Flour Guards
| Issue | `"linguini pasta"` → Chickpea Pasta |
|-------|-------------------------------------|
| Root Cause | No guard for specialty ingredient variants |
| Fix | Regular pasta rejects chickpea/lentil/gluten-free; regular flour rejects almond/coconut |
| Test | `isCategoryMismatch('linguini', 'Chickpea Pasta')` → true |

### Fix 6: Extra Lean Beef Guard
| Issue | `"extra lean ground beef"` → 85% Lean (standard) |
|-------|--------------------------------------------------|
| Root Cause | No distinction between extra lean (93%+) and standard (85%) |
| Fix | Added exclusion: extra lean rejects 85%/80%/73%/70% |
| Test | `isCategoryMismatch('extra lean ground beef', '85% Lean')` → true |

### Fix 7: Tomato Preparation State Guards
| Issue | `"crushed tomatoes"` → Fresh Tomatoes |
|-------|---------------------------------------|
| Root Cause | No guard for canned vs fresh preparation state |
| Fix | Bidirectional guards: crushed rejects fresh; fresh rejects crushed/diced/canned |
| Test | `isCategoryMismatch('crushed tomatoes', 'Fresh Tomatoes')` → true |
| Update | Added "fire roasted" and "tinned" (British) to canned tomato queries |


---

## Files Modified

- `src/lib/parse/ingredient-line.ts` - Dimension pattern stripping (lines 64-72), fl oz normalization, British→US terms
- `src/lib/fatsecret/filter-candidates.ts` - Category exclusion rules, `skipIfQueryContains` for tomato guards
- `src/lib/parse/unit.ts` - Added produce units (bunch, head, stalk, sprig, clove, leaf, ear, rib, bulb, crown, floret)
- `src/lib/fatsecret/simple-rerank.ts` - Rebalanced scoring weights, added category-changing token detection, benign descriptor handling
- `src/lib/fatsecret/filter-candidates.ts` - Added `hasCoreTokenMismatch()` for cache validation
- `src/lib/fatsecret/map-ingredient-with-fallback.ts` - Added core token validation to all cache lookup paths
- `src/lib/fatsecret/validated-mapping-helpers.ts` - Added core token validation to normalized cache lookups

### Additional Fixes (Same Session)

### Fix 8: fl oz Unit Normalization
| Issue | `"1 5 floz serving red wine"` → wrong parse |
|-------|----------------------------------------------|
| Root Cause | "fl oz" not joined, "1 5 floz" confuses parser |
| Fix | Preprocess "fl oz" → "floz", strip leading serving counts |
| Test | `parseIngredientLine('1 5 floz serving red wine')` → `qty:5, unit:"floz"` |

### Fix 9: British Term Translation
| Issue | `"4 cup tinned tomatoes"` → No match |
|-------|--------------------------------------|
| Root Cause | "tinned" is British term not in API |
| Fix | Preprocess British→US: tinned→canned, courgette→zucchini, etc. |
| Test | `parseIngredientLine('2 courgettes')` → `name: "zucchini"` |

### Fix 10: Calorie-Free → Sugar-Free Synonym
| Issue | `"calorie-free pancake syrup"` → No match |
|-------|------------------------------------------|
| Root Cause | "Calorie-free" rarely used in product names, "sugar-free" is standard |
| Fix | Preprocess "calorie-free" → "sugar free" in ingredient-line.ts |
| Test | `parseIngredientLine('calorie-free pancake syrup')` → `name: "sugar free pancake syrup"` |

### Fix 11: AI Parse Fallback
| Issue | Complex inputs like `"1 5 floz serving red wine"` fail to parse |
|-------|------------------------------------------------------------------|
| Root Cause | Regex parser confused by leading serving count ("1") |
| Fix | Created `ai-parse.ts` with `aiParseIngredient` as fallback when unit detection fails |
| Trigger | When regex parser returns `unit: null` but input matches `/\d+\s*(floz|oz|cup|tbsp|tsp|...)/` |
| Test | `"1 5 floz serving red wine"` → `{qty: 5, unit: "floz", name: "red wine"}` → "Red Table Wine" (147g, 125kcal) |
| File | `src/lib/fatsecret/ai-parse.ts`, integrated in `map-ingredient-with-fallback.ts` line 280 |

---

## 2026-01-22: Ingredient Mapping Accuracy Hardening

**Source**: Token overlap, dietary constraint, and confidence threshold issues

### Fix 12: Size Descriptor Parsing
| Issue | `"1 long sweet potato"` → Long Rice Noodles |
|-------|---------------------------------------------|
| Root Cause | "long" matched as food token instead of size qualifier |
| Fix | Added `long`, `short`, `tall`, `jumbo`, `xl` to `QUALIFIERS` in `qualifiers.ts` |
| Test | `parseIngredientLine('1 long sweet potato')` → `qualifiers: ["long"]`, name: `"sweet potato"` |

### Fix 13: Noise Word Filtering
| Issue | Token overlap causing false matches |
|-------|-------------------------------------|
| Root Cause | Words like "baby", "fresh", "long" matching unrelated products |
| Fix | Added `NOISE_WORDS` filter in `gather-candidates.ts` `assessConfidence()` |
| Words Filtered | `long`, `short`, `tall`, `baby`, `mini`, `fresh`, `raw`, etc. |
| Test | "long sweet potato" no longer matches "Long Rice Noodles" |

### Fix 14: British Synonym Expansion
| Issue | `"baby marrows"` → bone marrow products |
|-------|----------------------------------------|
| Root Cause | "marrow" is British for zucchini |
| Fix | Added `marrow/marrows → zucchini` synonym in `filter-candidates.ts` |
| Test | "baby marrows" → Zucchini (not bone marrow) |

### Fix 15: Strict Dietary Constraint Filter
| Issue | `"vegetarian mince"` → deer ground raw game meat |
|-------|--------------------------------------------------|
| Root Cause | No dietary enforcement for vegetarian/vegan queries |
| Fix | Added `isDietaryConstraintViolation()` function in `filter-candidates.ts` |
| Behavior | REJECTS ALL candidates with animal meat/seafood indicators for vegetarian/vegan/plant-based queries |
| Test | "vegetarian mince" → 0 meat candidates survive → triggers AI fallback |

### Fix 16: Minimum Confidence Thresholds
| Issue | Low-confidence mappings accepted (e.g., "burger relish" → "Black Bean Burger" @ 0.688) |
|-------|----------------------------------------------------------------------------------------|
| Root Cause | No minimum score required for acceptance |
| Fix | Added `MIN_RERANK_CONFIDENCE = 0.80` in `simple-rerank.ts` + `MIN_FALLBACK_CONFIDENCE = 0.80` in `map-ingredient-with-fallback.ts` |
| Test | Candidates with confidence < 0.80 are rejected → triggers fallback |

### Fix 17: Produce Size Estimation Improvement
| Issue | Scallions estimated at 150g (should be ~15g) |
|-------|---------------------------------------------|
| Root Cause | AI prompt lacked examples for thin/light produce |
| Fix | Improved `buildProduceSizePrompt()` in `ambiguous-serving-estimator.ts` with categorized examples |
| Categories | HEAVY (potato, avocado), MEDIUM (apple, tomato), THIN/LIGHT (scallion, celery), TINY (garlic) |
| Test | "1 medium scallion" → ~15g (not 150g) |

### Fix 18: Pipeline Debug Script
| Feature | New debug script for step-by-step pipeline tracing |
|---------|---------------------------------------------------|
| File | `scripts/debug-mapping-pipeline.ts` |
| Usage | `npx ts-node scripts/debug-mapping-pipeline.ts "ingredient" [options]` |
| Options | `--skip-cache` (skip cache), `--verbose` (more details), `--production` (call mapIngredientWithFallback directly, like pilot import), `--with-cleanup` (apply database cleanup patterns) |
| Output | 8 steps: Parse → Normalize → Cache → Gather → Filter → Gate → Rerank → Fallback |
| Production Mode | Use `--production` to run exact same code path as pilot batch import (Jan 2026) |

### Fix 19: Unit-like Words in MODIFIER_TOKENS
| Issue | `"1 bunch spinach"` → No candidates survived |
|-------|---------------------------------------------|
| Root Cause | "bunch" was treated as mandatory token, causing mismatch |
| Fix | Added `bunch`, `bundle`, `sprig`, `stalk`, `head`, `clove`, `buttery`, `nutty`, `tangy`, `zesty`, `spicy`, `mild` to MODIFIER_TOKENS in `filter-candidates.ts` |
| Test | "1 bunch spinach" now matches Spinach candidates |

### Fix 21: Produce Unit Recognition (bunch, head, stalk, etc.)
| Issue | `"1 bunch spinach"` → "Water Spinach" (different food than `"spinach"` → "Spinach") |
|-------|--------------------------------------------------------------------------------------|
| Root Cause | "bunch" wasn't recognized as a unit, so it stayed in the ingredient name. Query became "bunch spinach" instead of "spinach", causing different search results |
| Fix | Added produce-specific units to `countUnits` in `src/lib/parse/unit.ts`: `bunch/bunches`, `head/heads`, `stalk/stalks`, `sprig/sprigs`, `clove/cloves`, `leaf/leaves`, `ear/ears`, `rib/ribs`, `bulb/bulbs`, `crown/crowns`, `floret/florets` |
| Test | `"1 bunch spinach"` now parses as `{unit: "bunch", name: "spinach"}` → searches for "spinach" → matches same "Spinach" food as `"spinach"` query (0.98 confidence) |
| Impact | Ensures produce queries with unit descriptors map to the same food as queries without units |

---

## 2026-01-23: Token Scoring Improvements

**Source**: Walkthrough analysis - weak token matching allowing false positives

### Fix 22: Strengthened Token Scoring Weights
| Issue | `"1 bunch spinach"` → "Spinach Noodles" (category mismatch) |
|-------|-------------------------------------------------------------|
| Root Cause | Weak scoring weights - API ranking trusted too heavily (0.60), exact matches undervalued (0.10), extra tokens not penalized enough |
| Fix | Rebalanced weights in `simple-rerank.ts`: |
|     | - `EXACT_MATCH`: 0.10 → **0.30** (reward precise matches) |
|     | - `TOKEN_OVERLAP`: 0.10 → **0.15** (slightly increased) |
|     | - `ORIGINAL_SCORE`: 0.60 → **0.45** (don't blindly trust API) |
|     | - `EXTRA_TOKEN_PENALTY`: 0.25 → **0.35** (penalize unrelated words harder) |
|     | - `TOKEN_BLOAT_PENALTY`: 0.10 → **0.15** per excess token |
| Test | "spinach" → "Spinach" (0.98 confidence), "Spinach Noodles" filtered out |

### Fix 23: Category-Changing Token Detection
| Issue | Candidates with parasitic tokens (e.g., "noodles" in "Spinach Noodles") not penalized enough |
|-------|------------------------------------------------------------------------------------------------|
| Root Cause | No distinction between benign descriptors ("baby", "water") and category-changing tokens ("noodles", "pasta", "pie") |
| Fix | Added `CATEGORY_CHANGING_TOKENS` set (50+ tokens) in `simple-rerank.ts` with **0.50 penalty** when candidate has category-changing token NOT in query. Categories: pasta/noodles, baked goods, prepared dishes, beverages, snacks, spreads/condiments |
| Test | "spinach" → "Spinach Noodles" gets -0.50 penalty (filtered out by category exclusion, but defense-in-depth) |

### Fix 24: Benign Descriptor Token Handling
| Issue | Valid varieties like "Water Spinach" and "Baby Spinach" getting penalized as "extra tokens" |
|-------|------------------------------------------------------------------------------------------------|
| Root Cause | All extra tokens penalized equally - descriptors like "baby", "water", "fresh" were treated same as "noodles" |
| Fix | Added `BENIGN_DESCRIPTOR_TOKENS` set (size, freshness, quality, color, preparation descriptors) that receive only **25% of normal extra token penalty** |
| Test | "spinach" → "Water Spinach" and "Baby Spinach" score well (benign descriptors), "Spinach Noodles" heavily penalized (category-changing) |

### Fix 25: Stricter Token Bloat Threshold
| Issue | Candidates with 2+ extra tokens not penalized |
|-------|-------------------------------------------------|
| Root Cause | Allowed +2 extra tokens with no penalty |
| Fix | Reduced threshold: allow only **+1 extra token** with no penalty, then graduated penalties |
| Test | "spinach" (1 token) → "Spinach Noodles" (2 tokens) = +1 excess = penalty applied |

### Fix 26: Cache Core Token Validation (2026-01-23)
| Issue | Pilot batch import returning wrong cached mappings despite debug script working correctly |
|-------|-------------------------------------------------------------------------------------------|
| Root Cause | Stale cache entries from before scoring improvements were not being rejected. Cache validation only checked category/modifier mismatches, not whether core ingredient tokens were present in cached food name |
| Examples | "vegetable bouillon" → "Raw Vegetable" (missing "bouillon"), "golden flaxseed" → "Golden Delicious Apples" (missing "flaxseed") |
| Fix | Added `hasCoreTokenMismatch()` function in `filter-candidates.ts` that validates core ingredient tokens (50+ proteins, grains, produce, seasonings) exist in cached food name. Uses synonym mapping (e.g., "marrows" → "zucchini", "flaxseed" → "flax"). Applied to ALL cache lookup paths in `map-ingredient-with-fallback.ts` and `validated-mapping-helpers.ts` |
| Files | `src/lib/fatsecret/filter-candidates.ts`, `src/lib/fatsecret/map-ingredient-with-fallback.ts`, `src/lib/fatsecret/validated-mapping-helpers.ts` |
| Test | `hasCoreTokenMismatch('vegetable bouillon', 'Raw Vegetable')` → true (reject), `hasCoreTokenMismatch('vegetable bouillon', 'Vegetable Bouillon')` → false (accept), `hasCoreTokenMismatch('baby marrows', 'Baby Zucchini')` → false (accept via synonym) |

### Fix 27: Cache Key Fix When AI Normalize is Skipped (2026-01-23)
| Issue | Cache entries saved with raw input as key instead of canonical form when normalize gate skips AI |
|-------|--------------------------------------------------------------------------------------------------|
| Root Cause | When `shouldNormalizeLlm()` decides to skip the AI call, `aiCanonicalBase` remains `undefined`. The save then falls back to `normalizeQuery(rawInput)` which does minimal cleaning, resulting in cache keys like `"0 311625 cup ground golden flaxseed meal"` instead of `"golden flaxseed meal"` |
| Example | Input: `"0.311625 cup ground golden flaxseed meal"` → `normalize_gate.skipped_llm` → `normalizedForm` saved as `"0 311625 cup ground golden flaxseed meal"` (bad!) |
| Fix | When saving to cache, use `aiCanonicalBase || normalizedName` where `normalizedName` is from `normalizeIngredientName()` which properly strips prep phrases. This ensures cache keys are always canonical forms like `"golden flaxseed meal"` |
| Files | `src/lib/fatsecret/map-ingredient-with-fallback.ts` (lines 1240-1250, 1285) |
| Before | `normalizedForm: "0 311625 cup ground golden flaxseed meal"` |
| After | `normalizedForm: "golden flaxseed meal"` ✓ |

### Fix 20: AI Simplification Edge Cases
| Issue | `"burger relish"`, `"buttery cinnamon"`, `"vegetarian mince"` → Failed |
|-------|------------------------------------------------------------------------|
| Root Cause | AI simplification prompt lacked examples for these patterns |
| Fix | Added edge case examples to `ai-simplify.ts` prompt:  |
|     | - "burger relish" → "Pickle Relish" |
|     | - "buttery cinnamon" → "Cinnamon" |
|     | - "vegetarian mince" → "Meatless Crumbles" |
| Test | After cache clear, these items should map correctly |

---

## 2026-01-28: Product-Type Modifier Preservation

**Source**: `"Crushed Tomatoes"` mapping to raw `"Tomatoes"` instead of canned product

### Fix 28: Product-Type Modifier Preservation (MAJOR)
| Issue | `"Crushed Tomatoes"` → `"Tomatoes"` (raw) with low confidence |
|-------|---------------------------------------------------------------|
| Root Cause | `normalizeIngredientName()` stripped "crushed" from "Crushed Tomatoes" because it was in `prep_phrases`. API then searched for just "Tomatoes", missing canned products entirely. |
| Investigation | Debug logs showed `normalizedName = "Tomatoes"` (not "Crushed Tomatoes"). FDC search used query `"Tomatoes"`. "Crushed Tomatoes (Hunt's)" never appeared in candidates. Modifier boost correctly penalized "Tomatoes" (-0.100) but no correct candidate existed to win. |
| Fix | Implemented `PRODUCT_TYPE_MODIFIERS` system in `normalization-rules.ts`: when modifier appears as FIRST word, preserve it. |
| Modifiers | `canned`, `frozen`, `dried`, `crushed`, `diced`, `stewed`, `pickled`, `roasted`, `smoked`, `condensed`, `evaporated`, `powdered`, `instant`, `creamed` |
| Rule | First-word modifiers = product type (preserve). Non-first modifiers = prep instruction (strip). |
| Examples | `"canned pineapple"` → `"canned pineapple"` ✅ | `"pineapple, canned"` → `"pineapple"` ✅ |
| Before | `"Crushed Tomatoes"` → normalized to `"Tomatoes"` → API search `"Tomatoes"` → Winner: raw Tomatoes (0.592) → LOW_CONF |
| After | `"Crushed Tomatoes"` → normalized to `"Crushed Tomatoes"` → API search `"Crushed Tomatoes"` → Winner: Crushed Tomatoes (Tuttorosso) (1.365) → **0.98 confidence** |
| Files | `src/lib/fatsecret/normalization-rules.ts` |
| Test | `normalizeIngredientName("Canned Pineapple")` → `"Canned Pineapple"` (preserved) |
| Test | `normalizeIngredientName("chopped onion")` → `"onion"` (stripped, "chopped" is prep) |

---

## 2026-01-30: Serving Selection and Candidate Preference Fixes

**Source**: `mapping-summary-2026-01-30T06-01-33.txt` - incorrect serving calculations and candidate selection

### Fix 29: Count-Based Serving Multiplier Bug (MAJOR)
| Issue | `"10 large black olives"` → 460g (wrong), should be 46g |
|-------|--------------------------------------------------------|
| Root Cause | When selecting a serving like "10 large: 46g", the system used `numberOfUnits=1` (FatSecret doesn't set this correctly for count-based servings). This caused `gramsPerUnit = 46/1 = 46g`. Then `finalGrams = 46 * 10 = 460g` (10x too high). |
| Investigation | Debug showed serving "10 large" correctly matched but `unitsPerServing=1` instead of `10`. The count was in the description but not extracted. |
| Fix | Added regex extraction in `selectServing()` to parse count from serving descriptions: `^(\d+)\s+(small|medium|large|extra\s*large)`. Extracts the count (e.g., "10" from "10 large") and uses it as `unitsPerServing`. |
| Formula | Before: `gramsPerUnit = 46g / 1 = 46g each` → After: `gramsPerUnit = 46g / 10 = 4.6g each` |
| Result | `finalGrams = 4.6g * 10 = 46g` ✅ |
| Files | `src/lib/fatsecret/map-ingredient-with-fallback.ts` (lines 2021-2048) |
| Test | `"10 large black olives"` → 46g (was 460g), `"8 medium red peppers"` → 952g (was 80g) |

### Fix 30: Yeast Variant Preference
| Issue | `"1 package bakers yeast"` → Compressed (125g/package) instead of Active Dry (7g/package) |
|-------|--------------------------------------------------------------------------------------------|
| Root Cause | Both "Bakers Yeast (Compressed)" and "Bakers Yeast (Active Dry)" returned from FatSecret with identical confidence (1.000). Compressed listed first in API results. Margin check failed (both 1.000), forcing `simpleRerank` which kept Compressed. |
| Investigation | Compressed yeast comes in "cakes" (17g), Active Dry comes in "packets" (7g). Home bakers use packets, not fresh cakes. |
| Fix | Added explicit preference in `confidenceGate()`: when query contains "yeast" and both "Compressed" and "Active Dry" are candidates, return Active Dry immediately with 0.95 confidence, bypassing margin check. |
| Files | `src/lib/fatsecret/gather-candidates.ts` (lines 369-394) |
| Before | `"1 package bakers yeast"` → Compressed → 131kcal/125g |
| After | `"1 package bakers yeast"` → Active Dry → 20kcal/7g ✅ |
| Side Effect | Also deleted bad AI serving `ai_39077_package` (125g for Compressed) from FatSecretServingCache |

### Fix 31: Live Candidate Core Token Validation
| Issue | `"5 oz dry brown rice"` → `"dry brown (0% moisture) beans"` (completely wrong food) |
|-------|--------------------------------------------------------------------------------------|
| Root Cause | `hasCoreTokenMismatch` was only applied to CACHE lookups, not to live API candidates. Fresh results from FatSecret/FDC weren't being validated for core token presence. |
| Investigation | FDC returned "dry brown beans" which matched "dry" + "brown" tokens but was missing "rice". |
| Fix | Added core token validation filter to live candidate pipeline in `map-ingredient-with-fallback.ts` (lines 651-673). Filters out any candidate missing required core tokens. |
| Examples Fixed | `"dry brown rice"` no longer maps to `"dry brown beans"`, `"vegetable bouillon"` no longer maps to `"Raw Vegetable"` |
| Before | `"5 oz dry brown rice"` → `"dry brown (0% moisture) beans"` (0kcal - clearly wrong) |
| After | `"5 oz dry brown rice"` → `"Brown Rice"` via fallback ✅ |
| Before | `"2 cube vegetable bouillon"` → `"Vegetable Shortening"` (265kcal/30g) |
| After | `"2 cube vegetable bouillon"` → `"Vegetable Bouillon (Knorr)"` (24kcal/8g) ✅ |

### Fix 32: Bell Pepper Sanity Check False Positive
| Issue | `"1 large yellow bell pepper"` → 14g instead of ~164g |
|-------|-------------------------------------------------------|
| Root Cause | The AI serving estimator's `applySanityCheck` has a 'spices' category with keyword `'pepper'` and maxG=10. "bell yellow raw peppers" matched 'pepper' → clamped to 10g. Large = 1.4 * 10 = 14g. |
| Investigation | The `CATEGORY_LIMITS` was designed to catch spice estimation errors but `'pepper'` matched both black pepper (spice, ~3g) AND bell pepper (vegetable, ~164g). |
| Fix | Updated `CATEGORY_LIMITS` in `ambiguous-serving-estimator.ts` to: 1) Use specific spice terms ('black pepper', 'ground pepper', etc.) instead of generic 'pepper'. 2) Added `excludeKeywords` array to skip categories when bell/sweet pepper terms are present. 3) Added 'bell_peppers' category with correct limits (80-250g). |
| Files | `src/lib/ai/ambiguous-serving-estimator.ts` (lines 244-258, 269-273) |
| Before | `"1 large yellow bell pepper"` → 14g (clamped to spice limits!) |
| After | `"1 large yellow bell pepper"` → 154g ✅ |

## Summary

| Fix | Issue | Resolution |
|-----|-------|------------|
| 1 | Dimension patterns (`5"`) | Strip from ingredient lines |
| 2 | Dry milk state | Exclude powder/dry from liquid milk |
| 3 | Juice token | Enforce "juice" as required token |
| 4 | Tacos vs Nachos | Exclude by food type |
| 5 | Specialty pasta/flour | Exclude chickpea/almond variants |
| 6 | Extra lean beef | Exclude 85%/80% from "extra lean" |
| 7 | Tomato preparation | Bidirectional guards + skipIfQueryContains |
| 8 | fl oz parsing | Join "fl oz" → "floz" + strip serving counts |
| 9 | British terms | tinned→canned, courgette→zucchini, etc. |
| 10 | Calorie-free | Synonym to "sugar free" |
| 11 | AI Parse Fallback | Use AI when regex fails on complex inputs |
| 12 | Size descriptors | Parse "long/short/tall" as qualifiers |
| 13 | Noise word filter | Exclude from token matching |
| 14 | British synonyms | marrow → zucchini |
| 15 | Dietary constraints | Reject meat for vegetarian queries |
| 16 | Confidence thresholds | Minimum 0.80 for acceptance |
| 17 | Produce estimation | Categorized AI examples |
| 18 | Debug script | Step-by-step pipeline tracing |
| 19 | Unit-like tokens | bunch/buttery → MODIFIER_TOKENS |
| 21 | Produce unit recognition | bunch/head/stalk → recognized as units |
| 22 | Token scoring weights | Increased exact match, reduced API trust, stronger penalties |
| 23 | Category-changing tokens | Heavy penalty for parasitic tokens (noodles, pasta, pie, etc.) |
| 24 | Benign descriptors | Reduced penalty for valid descriptors (baby, water, fresh) |
| 25 | Token bloat threshold | Stricter: +1 token allowed (was +2) |
| 26 | Cache core token validation | Reject stale cache entries missing core ingredient tokens |
| 27 | Cache key fix when AI skipped | Use normalizedName instead of raw input for cache key |
| 28 | Product-type modifier preservation | Preserve canned/frozen/dried/crushed at start → correct API search |
| 29 | Count-based serving multiplier | Extract count from "10 large" descriptions → correct gram calculation |
| 30 | Yeast variant preference | Prefer Active Dry (packets) over Compressed (cakes) |
| 31 | Live candidate core token validation | Filter out candidates missing core tokens like "rice" or "bouillon" |
| 32 | Bell pepper sanity check false positive | Fix spice category matching bell peppers (154g instead of 14g) |
| 33 | **Sanity check removal** | Removed entire sanity check system - trust OpenRouter AI directly |

## Test Script

Run `npx tsx scripts/test-mapping-fixes.ts` to verify all fixes.

**Final Result**: 139/140 (99.3%) mapping success rate on 50-recipe pilot (347 ingredients after dedup).

### Note on Remaining Failures
- `buttery cinnamon powder` - fictional ingredient, no API match
- `burger relish` - AI simplification needed to map to "pickle relish"

---

## 2026-02-23: Systemic Scoring Defects (simple-rerank.ts)

**Source**: `mapping-summary-2026-02-11T17-25-24.txt` (200-recipe pilot, 2114 ingredients)
**File**: `src/lib/fatsecret/simple-rerank.ts`

Root cause was in `computeSimpleScore()` — three distinct defects allowing wrong prepared/processed food candidates to outscore the correct raw ingredient.

### Fix 34: Expand `CATEGORY_CHANGING_TOKENS`

| Issue | Multiple wrong mappings to prepared products |
|-------|----------------------------------------------|
| Examples | `"20 mint"` → Mint Patties (candy), `"5 sprig dill"` → Dill Cucumber Pickles, `"4 lemons crosswise"` → raw lemon peel |
| Root Cause | Tokens like `patties`, `pickles`, `marinara`, `peel` were missing from the set that triggers a 0.50 penalty when present in a candidate but not the query |
| Fix | Added to `CATEGORY_CHANGING_TOKENS`: `marinara`, `bisque`, `gravy`, `relish`, `julep`, `cocktail`, `spritzer`, `patty`, `patties`, `mints`, `pickle`, `pickles`, `pickled`, `sausage`, `sausages`, `hot dog`, `bratwurst`, `chorizo`, `salami`, `peel`, `rind` |
| Result | `"20 mint"` → MINT (0.98) ✅, `"5 sprig dill"` → Dill (0.98) ✅ |

### Fix 35: Remove Cooking Methods from `BENIGN_DESCRIPTOR_TOKENS`

| Issue | `"1 package cubed tofu"` → Fried Tofu (538kcal) instead of plain Tofu |
|-------|------------------------------------------------------------------------|
| Root Cause | `fried`, `creamed`, `roasted`, `baked`, `boiled`, `steamed`, `sauteed`, `buttered`, `breaded`, `stuffed`, `water` were classified as "benign" descriptors (only 25% extra-token penalty). When the query is plain `"tofu"`, `"Fried Tofu"` should be penalized heavily for the extra `fried` token. |
| Fix | Removed all cooking-method tokens from `BENIGN_DESCRIPTOR_TOKENS`. Kept `raw`, `fresh`, `frozen`, `canned`, `dried`, `dehydrated` (physical state, not cooking method). Kept size, color, and quality descriptors (baby, organic, red, etc.). |
| Result | `"cubed tofu"` → Fried Tofu score drops relative to Firm Tofu; falls below threshold → AI simplification fires → `"Tofu"` → TOFU (0.98) ✅ |

### Fix 36: Brand Penalty for Extra-Token Branded Candidates

| Issue | `"1 plum tomato"` → Italian Plum Tomato Marinara (Mezzetta) (130kcal) instead of raw plum tomato (~11kcal) |
|-------|-------------------------------------------------------------------------------------------------------------|
| Root Cause | `SIMPLE_INGREDIENT_BRAND_PENALTY` was skipped when a branded candidate contained all query tokens. `"Italian Plum Tomato Marinara (Mezzetta)"` contains `plum` + `tomato` → penalty skipped → it beat generic plum tomatoes despite the extra `Italian` + `Marinara` tokens. |
| Fix | Added check: if branded candidate covers all query tokens BUT has extra name tokens beyond the query, apply the penalty. Only truly exact-coverage branded items (e.g., `"Unsweetened Coconut Milk (Silk)"` for `"unsweetened coconut milk"`) are now penalty-free. |
| Result | Marinara no longer wins for `"plum tomato"` queries; pipeline falls to AI fallback → re-runs as `"Plum Tomatoes"` ✅ |

### Bonus Fix 37: Synonym-Aware `getCategoryChangePenalty`

| Issue | Adding `peel` to `CATEGORY_CHANGING_TOKENS` would have penalized `"Lemon Peel"` candidates for `"lemon zest"` queries (a regression) |
|-------|----------------------------------------------------------------------------------------------------------------------------------------|
| Root Cause | `getCategoryChangePenalty` checked `queryLower.includes(word)` — not aware of the `SYNONYMS` map (`zest ↔ peel`) |
| Fix | Expanded the query token set with all declared synonyms before the penalty check. `"lemon zest"` query now includes `"peel"` and `"rind"` in its expanded token set → no penalty for `"Lemon Peel"` candidates. |

### Change Index Update

| # | Category | Description |
|---|----------|-------------|
| 34 | Category-changing tokens | Added marinara, patties, pickles, peel, rind, sausage, julep + variants |
| 35 | Benign descriptor cleanup | Removed cooking methods (fried, creamed, roasted, etc.) from benign set |
| 36 | Brand penalty tightening | Penalize extra-token branded candidates even with full query coverage |
| 37 | Synonym-aware penalty | getCategoryChangePenalty checks SYNONYMS before firing |

---

## 2026-02-23 (Part 2): FDC Source Bias Removal (simple-rerank.ts)

**Source**: Follow-up investigation — `"1 plum tomato"` still failing after Fix 36 due to source scoring bias
**File**: `src/lib/fatsecret/simple-rerank.ts`

### Fix 38: Reduce FatSecret Source Bonus

| Issue | Generic FDC produce entries losing to branded FatSecret canned products |
|-------|-------------------------------------------------------------------------|
| Before | `SOURCE_FATSECRET: 0.15` — structural 0.15 advantage on every candidate from FatSecret |
| Fix | Reduced to `SOURCE_FATSECRET: 0.05` — now just a tiebreaker, not a structural bias |

### Fix 39: Remove Blanket FDC Source Penalty

| Issue | FDC generic entries penalised an extra −0.08 making them systematically worse than all FatSecret candidates |
|-------|-------------------------------------------------------------------------------------------------------------|
| Before | `score -= 0.08` applied to every FDC candidate |
| Fix | Penalty removed entirely. Serving data gaps are handled downstream during hydration, not at scoring time. FatSecret still preferred via the +0.05 tiebreaker. |

### Fix 40: Deduplicate Doubled FDC Names

| Issue | `"peeled plum tomatoes peeled plum tomatoes"` (CORA FDC) was hit by token bloat penalty for its own duplicated name |
|-------|----------------------------------------------------------------------------------------------------------------------|
| Root Cause | Some FDC entries store the description doubled (FDC data quality issue). Token bloat penalty counted the extra tokens as "candidate bloat" vs the query. |
| Fix | In `toRerankCandidate()`: detect when a FDC name is exactly its first half repeated, and deduplicate before scoring. |
| Result | `"1 plum tomato"` → `peeled plum tomatoes (CORA)` at **0.853 confidence, clear_winner** ✅ (was: dead-end AI fallback loop) |

### Change Index Update

| # | Category | Description |
|---|----------|-------------|
| 38 | Source bias | SOURCE_FATSECRET bonus 0.15 → 0.05 (tiebreaker only) |
| 39 | FDC penalty | Removed blanket −0.08 FDC penalty |
| 40 | FDC data quality | Deduplicate doubled FDC description names in toRerankCandidate |

---

## 2026-02-23 (Part 3): Ingredient Line Parser + Cache Tooling

**File**: `src/lib/parse/ingredient-line.ts`, `scripts/clear-ingredient-cache.ts`, `src/lib/fatsecret/simple-rerank.ts`

### Fix 41: Strip Alternative-Measurement Noise After Dash

| Issue | `"2 cup water - 1 to 2 cups"` → Water Spinach; `"0.25 tbsp basil - 1 teaspoon basil"` → wrong query |
|-------|--------------------------------------------------------------------------------------------------------|
| Root Cause | Parser kept everything after ` - ` as part of the ingredient name. Range expressions and cooking instruction annotations leaked into the API search query. |
| Fix | Added 3 regex patterns in `unitNormalized` block: strip ` - N to N unit`, ` - N unit ...`, and ` -per serving ...` patterns |
| Result | `"water - 1 to 2 cups"` → name `"water"` → **Water (0.98)** ✅; `"basil - 1 teaspoon basil"` → `"basil"` → **Basil (0.98)** ✅ |

### Fix 42: Spelling Corrections for Common Misspellings

| Issue | `"Canellini Beans"` → 0.00 confidence (6 occurrences across 200-recipe pilot) |
|-------|--------------------------------------------------------------------------------|
| Root Cause | Parser passed misspelled name directly to APIs; no fuzzy matching. |
| Fix | Added spelling correction block: `canellini → cannellini`, `chick pea → chickpeas`, `chilli → chili`, `jalapeno` accent variants |
| Result | `"Canellini Beans"` → name `"cannellini Beans"` → **Cannellini Beans (0.98)** ✅ |

### Fix 43: Cut-Shape Descriptors Added to `BENIGN_DESCRIPTOR_TOKENS`

| Issue | `"3 strips green peppers"` → roasted jarred strips (Jeff's Naturals) at 0.43 score — filter required `"strips"` as core token, eliminating raw `Green Bell Pepper` candidates |
|-------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Root Cause | `"strips"` was not in `BENIGN_DESCRIPTOR_TOKENS`, so it was treated as a required filter token AND incurred a full extra-token penalty on candidates that lacked it. |
| Fix | Added `strip`, `strips`, `sprig`, `sprigs`, `floret`, `florets`, `wedge`, `wedges`, `chunk`, `chunks`, `clove`, `cloves` to `BENIGN_DESCRIPTOR_TOKENS` |
| Result | Raw bell pepper candidates now survive filter and score correctly; roasted jarred products now compete fairly |

### Fix 44 (Tooling): Per-Ingredient Cache Clear Script

| Tool | `scripts/clear-ingredient-cache.ts` |
|------|--------------------------------------|
| Purpose | Clear `ValidatedMapping`, `IngredientFoodMap`, and `AiNormalizeCache` for specific ingredient terms without nuking the entire cache |
| Usage | `npx tsx scripts/clear-ingredient-cache.ts "mint" "canellini" "plum tomato"` |
| Why | Enables verifying fixes via full pipeline (without `--skip-cache`) on just the affected ingredients |

### Fix 45: Double Multiplier Bug in `selectServing` for Count-Based Servings

| Issue | `"20 grape tomatoes"` → 2460g (expected ~480g) |
|-------|------------------------------------------------|
| Root Cause | `selectServing` used `numberOfUnits` from the DB to divide `servingWeightGrams`. FatSecret frequently omits this field (`numberOfUnits=0` or null) for count-based servings. When a serving description reads "5 grape tomatoes = 123g", `unitsPerServing` defaulted to 1, giving `gramsPerUnit=123`. Multiplied by `qty=20` → 2460g. |
| Pre-existing partial fix | The `size_qualifiers` path (small/medium/large) already had a regex that extracted the count from the description (`/^(\d+)\s+(small|medium|large)/`). That path used `gramsPerUnit = grams / extractedCount`. The main return path did not. |
| Fix | Extended the same count-extraction regex (`/^(\d+)\s+\S/`) to the **final `unitsPerServing` computation** in `selectServing` at the bottom of the function. Now, any serving whose description starts with a number (e.g., "5 grape tomatoes", "3 crackers") correctly divides by that count. |
| File | `src/lib/fatsecret/map-ingredient-with-fallback.ts` |
| Script | `scripts/test-grape-tomatoes.ts` — verifies fix |
| Expected result | `"20 grape tomatoes"` → ~300–600g total (≈15–30g per tomato) |

### Fix 46: Qualifier-Only `mustHaveToken` Regression ("Popcorn → Buttermilk")

| Field | Detail |
|-------|--------|
| Issue | `"1 oz low fat popcorn"` → `"low fat buttermilk"` |
| Introduced by | Removing FatSecret source bias (Feb 2026). FatSecret's old +0.15 blanket bonus previously kept its popcorn candidates ahead of FDC dairy. Once both sources competed equally the latent filter flaw became decisive. |
| Root Cause | `deriveMustHaveTokens("low fat popcorn")` returned `["low"]` because `"low"` was not in `MODIFIER_TOKENS`. `"low fat buttermilk"` passed trivially (it contains `"low"`); `"popcorn"` was never required. Separately, `"Lowfat Popcorn Popped in Oil"` (the best FatSecret candidate) was eliminated because `"lowfat"` (compound) ≠ token `"low"`, leaving only weaker FatSecret entries that the FDC +0.03 tiebreaker then overcame. |
| Fix | `deriveMustHaveTokens` in `filter-candidates.ts`: (1) Added `'low', 'high', 'no', 'non', 'zero'` to `MODIFIER_TOKENS`. (2) Changed `slice(0,1)` → `slice(0,2)` — requires up to 2 core food noun tokens. `coreTokens=["popcorn"]` → buttermilk rejected at filter. |
| File | `src/lib/fatsecret/filter-candidates.ts` |
| Result | `"1 oz low fat popcorn"` → `"Oil Popped Popcorn (Low Fat)"` ✅ |
| General principle | Fixes the whole class of `"[qualifier] [noun]"` queries. No hand-curated category-change list needed. |

### Change Index

| # | Category | Description |
|---|----------|-------------|
| 41 | Noise stripping | Strip dash-appended range/alternative measurement annotations |
| 42 | Spelling corrections | canellini → cannellini; chilli → chili; jalapeño variants |
| 43 | Cut-shape tokens | strip/strips/sprig/floret/wedge/chunk/clove added to BENIGN_DESCRIPTOR_TOKENS |
| 44 | Tooling | clear-ingredient-cache.ts — per-term targeted cache clearing |
| 45 | Serving selection | Double Multiplier — extract embedded count from serving description in `selectServing` |
| 46 | Scoring/filter | Qualifier-only token regression — add `low/high/no/non/zero` to MODIFIER_TOKENS, require up to 2 core food noun tokens |
| 47 | Scoring | Remove FDC/FatSecret source bias — both sources now compete equally on name match quality |
| 48 | Scoring | Raw-state normalization — strip `raw`/`uncooked` from FDC names for scoring; +0.03 FDC tiebreaker for produce/meat |

---

## 2026-02-28: Ingredient Mapping Pipeline Hardening (Session 2)

**Source**: `handoff-feb24.md` — resolving remaining open issues from 300-recipe pilot import
**Files**: `filter-candidates.ts`, `simple-rerank.ts`, `ingredient-line.ts`, `map-ingredient-with-fallback.ts`

### Fix 49: "freshly" as mustHaveToken Kills Real Garlic Candidates

| Field | Detail |
|-------|--------|
| Issue | `"2 freshly garlic"` → Freshly Chile-Garlic Pork Bowl (920kcal branded meal) |
| Root Cause | `MODIFIER_TOKENS` had `'fresh'` but not `'freshly'` (adverb form). `deriveMustHaveTokens` kept `'freshly'` as a must-have token, filtering out all real garlic entries. Only branded "Freshly" meal products survived. |
| Fix | Added `'freshly'` to `MODIFIER_TOKENS` in `deriveMustHaveTokens` (`filter-candidates.ts`) |
| File | `src/lib/fatsecret/filter-candidates.ts` (L2367) |
| Result | `"2 freshly garlic"` → **raw garlic** (30g, 42.9 kcal) ✅ |

### Fix 50: Default-Ripeness Penalty for Green Tomato Candidates

| Field | Detail |
|-------|--------|
| Issue | `"Petite Tomatoes"` → green raw tomatoes (unripe/specialty item) |
| Root Cause | `getAttributeContradictionPenalty` only fired when query explicitly specified a color. "Petite tomatoes" has no color → no penalty for "green" candidates. FDC "green raw tomatoes" (0.552) outscored "grape raw tomatoes" (0.477) on token overlap. |
| Fix | Added default-ripeness penalty block in `getAttributeContradictionPenalty` (`simple-rerank.ts`): when query mentions `ASSUMED_RED_FOODS` (tomato/tomatoes) without specifying a color, apply 50% of `ATTRIBUTE_CONTRADICTION_PENALTY` to candidates containing `\bgreen\b`. |
| File | `src/lib/fatsecret/simple-rerank.ts` (~L436) |
| Result | `"petite tomatoes"` → **grape raw tomatoes** (123g) ✅ |
| Note | 50% penalty is intentionally softer to preserve explicit "green tomatoes" queries. `ASSUMED_RED_FOODS` list is extensible. |

### Fix 51: "juice/zest from N fruit" Parser Normalization

| Field | Detail |
|-------|--------|
| Issue | `"1 juice from 1 lemon"` → bottled real lemon juice from concentrate (240g) |
| Root Cause | Parser tokenized as `qty=1, name="juice from 1 lemon"`. The `"X from Y"` recipe phrasing (where ingredient = `Y X`) was not recognized. The resulting query matched FDC "bottled real lemon lemon juice from concentrate" (an entire bottle). |
| Fix | Added regex pre-processing in `ingredient-line.ts` that transforms `juice/zest from\|of N fruit` → `N fruit juice/zest` before tokenization. |
| File | `src/lib/parse/ingredient-line.ts` (L123) |
| Result | `"1 juice from 1 lemon"` → **raw lemon juice** (60g, 13.2 kcal) ✅ |
| Also verified | `"juice of 2 limes"` → raw lime juice (120g) ✅, `"zest from 1 orange"` → raw orange peel (10g) ✅ |

### Additional Fixes (Same Session, Earlier)

| Fix | Detail |
|-----|--------|
| B6 green peppers | Color contradiction filter + `MIN_RERANK_CONFIDENCE` 0.74→0.70 + fallback `!winner` guard (3 files) |
| A1 dill regression | Cleared stale ValidatedMapping + AiNormalizeCache for "dill" → now maps to Dill herb |
| D1 strawberry halves | Fixed `-y→-ies` plural mismatch in `hasCoreTokenMismatch` regex |

### Change Index

| # | Category | Description |
|---|----------|-------------|
| 49 | Filter/tokens | Added `'freshly'` to MODIFIER_TOKENS — prevents adverb from becoming must-have token |
| 50 | Scoring | Default-ripeness penalty — 50% contradiction penalty for "green" tomato when query doesn't specify color |
| 51 | Parser | `juice/zest from\|of N fruit` → `N fruit juice/zest` pre-processing normalization |

---

## 2026-03-02: Pilot Import Systematic Failures (Session 3)

**Source**: `mapping-summary-2026-03-02T06-28-24.txt` — 400-recipe pilot import systematic failures
**Files**: `filter-candidates.ts`, `ingredient-line.ts`

### Fix 52: Pure-Fat Foods Rejected by `hasNullOrInvalidMacros` (MAJOR)

| Field | Detail |
|-------|--------|
| Issue | All cooking oils (coconut, avocado, vegetable, sesame, canola, EVOO) → 0.00 confidence |
| Affected | 12+ summary lines (6 oil types × 2 attempts each) |
| Root Cause | `hasNullOrInvalidMacros` rejects foods where `calories > 50 && protein === 0 && carbs === 0`. Designed to catch corrupted data (e.g., red lentils with P:0, C:0, F:2.86, kcal:314). But **pure oils legitimately have 0 protein, 0 carbs** — they are 100% fat (~860-930 kcal/100g). All 20 coconut oil candidates were killed by this filter. |
| Fix | Added fat-exemption: when `fat > 50` (per 100g), the food is a pure fat/oil, and P=0/C=0 is valid nutritional data. |
| File | `src/lib/fatsecret/filter-candidates.ts` (L1397) |
| Before | `if ((protein ?? 0) === 0 && (carbs ?? 0) === 0) return true;` |
| After | `if ((protein ?? 0) === 0 && (carbs ?? 0) === 0 && fatValue <= 50) return true;` |
| Result | `"coconut oil"` → **Organic Virgin Coconut Oil (Spectrum)** (0.765) ✅ |
| Also | `"avocado oil"` → **AVOCADO OIL (SPECTRUM CULINARY)** (0.980) ✅ |

### Fix 53: Potato `hasSuspiciousMacros` Fat Threshold Too Strict

| Field | Detail |
|-------|--------|
| Issue | `"1 medium potato"` → 0.00 confidence (no candidates survived) |
| Root Cause | `INGREDIENT_MACRO_PROFILES` had `maxFatPer100g: 1` for potatoes. FDC reports raw potato at 2.4g fat/100g → flagged as `suspicious_macros` → rejected. After cooking-state filter removed baked/boiled/roasted variants, core token filter eliminated remaining branded candidates. |
| Fix | Raised `maxFatPer100g` from 1 to 5 for the vegetables profile. |
| File | `src/lib/fatsecret/filter-candidates.ts` (L1141) |
| Result | `"1 medium potato"` → **Potato** (1.000) ✅ |

### Fix 54: Strawberry Halves — "halves" Treated as Must-Have Token

| Field | Detail |
|-------|--------|
| Issue | `"2 cup strawberry halves"` → 0.00 confidence (18 candidates, 0 survived) |
| Root Cause | `deriveMustHaveTokens("strawberry halves")` produced `["strawberry", "halves"]`. "halves" is a cut-shape descriptor, NOT a food identity token. No API candidate name contains "halves" → ALL 18 candidates rejected. Previous D1 fix (`-y→-ies` plural support) was correct but irrelevant — the actual failure was the must-have token filter. |
| Fix | Added `'half', 'halves', 'quarter', 'quarters', 'third', 'thirds'` to `MODIFIER_TOKENS` in `deriveMustHaveTokens`. |
| File | `src/lib/fatsecret/filter-candidates.ts` (L2369) |
| Result | `"strawberry halves"` → **Strawberries** (0.980) ✅ |

### Fix 55: Compound Word + Brand Spelling Normalization

| Field | Detail |
|-------|--------|
| Issue | `"snowpeas"` → 0.00 (APIs expect "snow peas" with space) |
| Fix | Added compound word normalization: `snowpeas → snow peas`, `sugarsnap → sugar snap peas` |
| Also | Added brand-to-generic synonyms: `swerve → erythritol sweetener`, `splenda → sucralose sweetener` |
| File | `src/lib/parse/ingredient-line.ts` (L123-135) |
| Result | `"snowpeas"` → **SNOW PEAS** (0.980) ✅ |
| Note | Swerve/Splenda synonyms still fail — APIs may not have these niche sweetener products |

### Change Index

| # | Category | Description |
|---|----------|-------------|
| 52 | Filter/macros | Fat-exemption in `hasNullOrInvalidMacros` — pure-fat foods (fat>50g/100g) no longer rejected |
| 53 | Filter/macros | Potato `maxFatPer100g` raised 1→5 in `hasSuspiciousMacros` |
| 54 | Filter/tokens | Added `half/halves/quarter/quarters/third/thirds` to MODIFIER_TOKENS cut-shape section |
| 55 | Parser | Compound word normalization (snowpeas) + brand synonyms (swerve/splenda) |


---

### Fix 56: Dry Mustard - Multiple Filter Issues

| Field | Detail |
|-------|--------|
| Issue | `1 tsp or 1 packet dry mustard` -> 0.00 confidence |
| Root Causes | (1) `or 1 packet` noise in parsed input. (2) `dry` treated as must-have token. (3) `hasNullOrInvalidMacros` rejects Dry Mustard (cal:100, P/C/F:0). |
| Fixes | (a) Strip `or N unit` alternatives in parser. (b) `dry,wet,liquid,solid` -> MODIFIER_TOKENS. (c) `mustard` -> CORE_FOOD_TOKENS. |
| Files | `ingredient-line.ts` (L145), `filter-candidates.ts` (L932, L2363) |
| Result | `1 tsp or 1 packet dry mustard` -> **Mustard** (0.705) |

### Fix 57: Yellow Cherry Tomato - -o/-oes Plural Mismatch

| Field | Detail |
|-------|--------|
| Issue | `1 cup yellow cherry tomato` -> 0.00 |
| Root Cause | `hasCoreTokenMismatch` regex `\btomatos?\b` doesn't match tomatoes (-oes). |
| Fix | Added -o/-oes plural handling + reverse in `hasCoreTokenMismatch`. |
| File | `filter-candidates.ts` (L995) |
| Result | `yellow cherry tomato` -> **Cherry Tomatoes** (0.813) |

### Bonus: Splenda Now Works (via Fix 55 + 56)

Fix 55 brand synonyms + Fix 56 liquid in MODIFIER_TOKENS combined to resolve Splenda:
- `1 serving 1 packet splenda` -> **Liquid Sucralose (EZ-Sweetz)** (0.980)

### Change Index (Fixes 56-57)

| # | Category | Description |
|---|----------|-------------|
| 56 | Filter/tokens + Parser | dry/wet/liquid/solid to MODIFIER_TOKENS; mustard to CORE_FOOD_TOKENS; or N unit parser strip |
| 57 | Filter/plurals | -o/-oes plural handling in hasCoreTokenMismatch (tomato/tomatoes, potato/potatoes) |

### Fix 58: Strawberry Banana Greek Yogurt - Compound Product vs. Raw Produce

| Field | Detail |
|-------|--------|
| Issue | `5 oz strawberry banana Greek yogurt` -> 0.00 (ALL 18 candidates rejected) |
| Root Cause | `INGREDIENT_MACRO_PROFILES` has a `strawberry/berries` profile with `maxCalPer100g: 60`. Query contains `strawberry` -> profile fires. Greek yogurt candidates have 80-88 cal/100g -> ALL flagged as `suspicious_macros` -> ALL rejected. The profile is correct for fresh berries but wrong for strawberry-flavored products. |
| Fix | Added compound product exclusion in `hasSuspiciousMacros`: when query contains product terms (yogurt, ice cream, jam, smoothie, etc.), raw produce macro profiles are skipped. |
| File | `filter-candidates.ts` (L1247) |
| Result | `strawberry banana Greek yogurt` -> **Greek Yogurt Strawberry Banana (HEB)** (0.708) |

### Fix 59: Dietary-Prefix Stripping (fat-free, gluten-free, etc.)

| Field | Detail |
|-------|--------|
| Issue | (1) `fat free liquid egg substitute` -> 0.00 (score 0.688 < 0.70 threshold). (2) `gluten-free salad seasoning` -> 0.00 (zero relevant API results). |
| Root Cause | Dietary-attribute prefixes like `fat free` and `gluten-free` describe what is ABSENT from the food, not what it IS. They pollute API searches and scoring. `fat free` caused `CAGE FREE LIQUID EGG SUBSTITUTE` to barely miss the confidence threshold (`cage` != `fat`). `gluten-free` returned only GF breads/pastas, no seasonings. |
| Fix | Strip dietary-attribute prefixes in parser (before API search): `fat-free/nonfat`, `gluten-free`, `sugar-free`, `dairy-free`, `grain-free`, `nut-free`. The `critical_modifier_mismatch` filter still enforces modifier matching separately, if the best candidate happens to violate the dietary constraint. |
| File | `ingredient-line.ts` (L115) |
| Result | `fat free liquid egg substitute` -> **Egg Substitute (Liquid)** (0.882). `gluten-free salad seasoning` -> **Original Ranch Seasoning and Salad Dressing Mix** (0.950). |

### Change Index (Fixes 58-59)

| # | Category | Description |
|---|----------|-------------|
| 58 | Filter/macros | Compound product exclusion in `hasSuspiciousMacros` - skip produce profiles for yogurt/ice cream/jam/etc. |
| 59 | Parser | Dietary-prefix stripping (fat-free, gluten-free, sugar-free, dairy-free, grain-free, nut-free) |

---

## 2026-03-24: 100-Recipe Pilot Review Fixes

**Source**: `mapping-summary-2026-03-24T16-30-19.txt` — reviewed by separate QA agent. 17 issues identified (4 wrong matches, 9 nutrition anomalies, 4 questionable).

### Fix 60: Cinnamon Sticks → Cinnamon (Spice)

| Field | Detail |
|-------|--------|
| Issue | `5g cinnamon sticks` → Honey Maid Grahams Cinnamon Sticks (Nabisco) or CINNAMON STICKS (ROUNDY'S) with 0 kcal |
| Root Cause | APIs have no generic "cinnamon sticks" (spice). Only branded snack products and FDC entries with 0 kcal bad data. `cinnamon ground spices` was filtered out because `mustHaveTokens` required "sticks". |
| Fix | Added synonym rewrite `cinnamon sticks → cinnamon` in `normalization-rules.json`. Whole cinnamon sticks and ground cinnamon are nutritionally equivalent. |
| File | `data/fatsecret/normalization-rules.json` |
| Result | `5g cinnamon sticks` → **Cinnamon** (13 kcal, 0.98 confidence) |

### Fix 61: Tomato and Green Chili Mix

| Field | Detail |
|-------|--------|
| Issue | `tomato and green chili mix` → Green Tomatoes (wrong product) |
| Root Cause | Synonym rewrite existed in `DEFAULT_RULES` (TypeScript) but NOT in the JSON rules file which takes precedence. Correct FDC candidates scored below 0.70 threshold. |
| Fix | Added `tomato and green chili mix → diced tomatoes with green chilies` (and variants) to JSON rules. |
| File | `data/fatsecret/normalization-rules.json` |
| Result | → **DICED TOMATOES WITH GREEN CHILIES (ROUNDY'S)** (30 kcal, 0.862 confidence) |

### Fix 62: Corn Whole-Kernel (Dried → Canned)

| Field | Detail |
|-------|--------|
| Issue | `1 cup corn whole-kernel` → White Corn Kernels (Signature Select) — 740 kcal/185g (~400kcal/100g = dried corn) |
| Root Cause | "corn whole-kernel" matched branded dried/dehydrated corn kernel products. Canned/frozen corn is ~80-100 kcal/100g. |
| Fix | Added synonym rewrite `corn whole-kernel/kernel/kernels → canned corn`. |
| File | `data/fatsecret/normalization-rules.json` |
| Result | → **Canned Corn (Great Value)** (79 kcal/165g) — correct for canned product |

### Fix 63: Chicken Broth (Home Recipe → Commercial)

| Field | Detail |
|-------|--------|
| Issue | `chicken broth` → Chicken Broth (Home Recipe) — 86 kcal/cup vs commercial broth ~4-8 kcal/cup |
| Root Cause | FatSecret "Home Recipe" variant has much higher calories due to meat/bone content. Most recipes intend commercial packaged broth. |
| Fix | Added synonym rewrites `chicken/beef/vegetable broth → stock`. "Stock" search terms preferentially return commercial products. |
| File | `data/fatsecret/normalization-rules.json` |
| Result | → **CHICKEN BROTH (AHOLD)** (7 kcal/120g) — correct commercial product |

### Fix 64: Quick Oats Serving Weight

| Field | Detail |
|-------|--------|
| Issue | `1 cup quick oats` → Quick Rolled Oats (Fresh & Easy) — 160 kcal / 40g per cup (should be ~80-120g/cup) |
| Root Cause | Branded FatSecret entry had incorrect 40g/cup serving size. |
| Fix | Added synonym rewrite `quick oats → quick cooking oats`. Routes to USDA/FDC standard entry with correct 120g/cup. |
| File | `data/fatsecret/normalization-rules.json` |
| Result | → **QUICK ROLLED OATS (AUGASON FARMS)** (456 kcal/120g) — correct weight |

### Known Remaining Issue: Sherry Wine → Vinegar

| Field | Detail |
|-------|--------|
| Issue | `1.5 floz sherry wine` → vinegar sherry (SHERRY) — wine mapped to vinegar |
| Root Cause | FDC's only "sherry" entry is `vinegar sherry` with brand "SHERRY". No actual cooking wine/sherry wine in FDC or FatSecret. Synonym rewrites (`cooking sherry`, `dry sherry`) all match the vinegar entry. |
| Status | **Unfixable via synonym rewrite** — requires AI-generated food fallback or manual PortionOverride. Will be addressed in a future pass. |

### Change Index (Fixes 60-64)

| # | Category | Description |
|---|----------|-------------|
| 60 | Synonym | `cinnamon sticks → cinnamon` (spice-form equivalence) |
| 61 | Synonym | `tomato and green chili mix → diced tomatoes with green chilies` (JSON sync) |
| 62 | Synonym | `corn whole-kernel → canned corn` (dried vs canned data) |
| 63 | Synonym | `chicken/beef/vegetable broth → stock` (home recipe vs commercial) |
| 64 | Synonym | `quick oats → quick cooking oats` (correct serving weight) |

### Fix 65: Kidney Beans (Dry → Canned) — Synonym Rewrite

| Field | Detail |
|-------|--------|
| Issue | `32 oz light red kidney beans` → WEIS QUALITY 2077 kcal/907g (229kcal/100g = dry bean data) |
| Root Cause | FDC entries for kidney beans contain dry bean nutritional data (229kcal/100g). FatSecret has correct canned data (92kcal/100g) but FDC is preferred in sorting (exact match + FDC source priority at L872-873 in `map-ingredient-with-fallback.ts`). |
| Fix | Added synonym rewrite `kidney beans → canned kidney beans` and `light red kidney beans → canned light red kidney beans`. **Partially effective** — helps API search but FDC preference in sort still dominates. |
| File | `data/fatsecret/normalization-rules.json` |
| Status | **Requires pipeline change**: FDC exact-match preference in sort at lines 872-873 should be tempered by calorie density sanity check for canned goods category. |

### Fix 66: Veggie Spirals → Vegetable Rotini

| Field | Detail |
|-------|--------|
| Issue | `336 g veggie spirals pasta` → Pasta with Vegetables (a dish, not a pasta type) |
| Fix | Added synonym rewrite `veggie spirals pasta → vegetable rotini pasta`. Improved confidence from 0.748 → 0.876 but still maps to "Pasta with Vegetables". |
| File | `data/fatsecret/normalization-rules.json` |
| Result | Calorie density (125kcal/100g) is reasonable for pasta, so impact is low (~5-10% difference). |

### Fix 67: Splenda → Sucralose Packet

| Field | Detail |
|-------|--------|
| Issue | `1 packet splenda` → sucralose sweetener (LOWES FOODS) — 0 kcal but 100g serving weight with 100g carbs |
| Root Cause | FDC entry has 100g as default serving size. Actual Splenda packet is ~1g. Since 0 kcal, calorie impact is nil, but 100g weight is misleading. |
| Fix | Added synonym `splenda → sucralose packet`. Did not change result — FDC data issue. |
| Status | **Low impact** — 0 kcal means the weight error doesn't affect nutritional calculations. |

### Fix 68: Sherry Wine → White Wine

| Field | Detail |
|-------|--------|
| Issue | `1.5 floz sherry wine` → vinegar sherry (SHERRY) with brand "SHERRY" — wine mapped to vinegar |
| Root Cause | FDC's only "sherry" entry is `vinegar sherry` with brand "SHERRY". No cooking wine in FDC or FatSecret databases. Tried `cooking sherry`, `dry sherry`, `white wine` — all still match vinegar due to brand name. |
| Fix | Changed synonym to `sherry wine → white wine`. Still maps to vinegar due to FDC precedence. |
| Status | **Database gap** — requires AI-generated food fallback for cooking wines. |

### Fix 69: Dry Wine → Dry White Wine

| Field | Detail |
|-------|--------|
| Issue | `2 oz dry wine` → Rose Wine (0.784 confidence) |
| Fix | Added synonym `dry wine → dry white wine`. Rosé vs dry white is ~5-10 kcal per serving — acceptable variation. |
| File | `data/fatsecret/normalization-rules.json` |
| Result | Low impact improvement. |

### Fix 70: Vegetarian Patties → Veggie Burger

| Field | Detail |
|-------|--------|
| Issue | `10.5 oz vegetarian patties` → Organic Falafel Vegetarian Patties (Hannah) |
| Fix | Added synonym `vegetarian patties → veggie burger patties`. |
| File | `data/fatsecret/normalization-rules.json` |

### Fix 71: Salad Seasoning → Salad Seasoning Blend

| Field | Detail |
|-------|--------|
| Issue | `42 g salad seasoning` → Original Ranch Seasoning & Salad Dressing Mix (0.8g) showing 0 kcal/42g |
| Root Cause | FatSecret entry has per-serving data for 0.8g, not 42g. The serving `g (1g)` returns 0 kcal per 1g because the product is very low calorie per gram. |
| Fix | Added synonym `salad seasoning → salad seasoning blend`. |
| File | `data/fatsecret/normalization-rules.json` |
| Status | Result unchanged — the FatSecret entry's per-serving data is fundamentally wrong for this product. |

### Fix 72: Chunk Chicken Breast → Chicken Breast

| Field | Detail |
|-------|--------|
| Issue | `6 oz chunk chicken breast` → CHICKEN BREAST (GIANT EAGLE) with high fat (13.8g) |
| Fix | Added synonym `chunk chicken breast → chicken breast`. |
| File | `data/fatsecret/normalization-rules.json` |
| Result | Removes "chunk" modifier that may have led to processed/breaded product selection. |

### Issues Accepted (No Fix Needed)

| # | Issue | Reason |
|---|-------|--------|
| #2 | Creme brulee creamer → Original | ~10 kcal diff per serving — within acceptable tolerance |
| #9 | Avocado oil inconsistency | Correct (124kcal/14g) on re-run — non-deterministic branded selection |
| #10 | Honey weight discrepancy | Correct (84g/0.25cup) on re-run |
| #11 | Pork sausage ~30-40% high | Fresh Pork Sausage 303kcal/100g — within USDA range (300-340) |
| #12 | Center cut bacon 28g/slice | Branded data — 28g is raw thick-cut weight, reasonable |
| #15 | Beef stock cube → liquid stock | Actually correct: 0 kcal/10g cube (stock cubes are mostly salt) |
| #17 | Dry wine → Rosé | ~5 kcal diff per serving — negligible |

### Change Index (Fixes 65-72)

| # | Category | Description |
|---|----------|-------------|
| 65 | Synonym (partial) | `kidney beans → canned kidney beans` (FDC sort priority blocks full fix) |
| 66 | Synonym | `veggie spirals → vegetable rotini` (improved confidence, calorie density acceptable) |
| 67 | Synonym (no effect) | `splenda → sucralose packet` (FDC 100g serving, 0 kcal impact) |
| 68 | Synonym (no effect) | `sherry wine → white wine` (FDC database gap, no cooking wine) |
| 69 | Synonym | `dry wine → dry white wine` (marginal improvement) |
| 70 | Synonym | `vegetarian patties → veggie burger patties` |
| 71 | Synonym (no effect) | `salad seasoning → salad seasoning blend` |
| 72 | Synonym | `chunk chicken breast → chicken breast` |

---

## 2026-04-03: Anomaly Resolution Session (Pre-500 Pilot)

**Source**: Pre-pilot spot checks (Nutmeg, Corn, Lasagna failures)

### Fix 73: Nutmeg Semantic Inversion
| Field | Detail |
|-------|--------|
| Issue | `0.5 tsp nutmeg` → Virgil's Nutmeg Root Beer |
| Fix | Forced strict exclusion of beverage/soda categories when searching for pure spices. |

### Fix 74: Canned Corn Kettle Bloat
| Field | Detail |
|-------|--------|
| Issue | `1 can corn` → Palmetto Kettle Corn (excessive macros per 100g) |
| Fix | Disallowed popcorn/kettle variants when searching for generic canned corn vegetable entries. |

### Fix 75: Lasagna Noodles Category Mismatch
| Field | Detail |
|-------|--------|
| Issue | `4.5 oz lasagna` → Lasagna Entree (heavy pre-cooked dish) |
| Fix | Directed generic "lasagna" queries to resolve strictly to dry pasta/noodles unless specific modifiers denote a finished meal. |

### Change Index (Fixes 73-75)
| # | Category | Description |
|---|----------|-------------|
| 73 | Filter | Nutmeg -> Root Beer semantic inversion blocked |
| 74 | Filter | Corn -> Kettle Corn calorie bloat blocked |
| 75 | Filter | Lasagna -> Lasagna Entree category mismatch fixed |

---

## 2026-04-03: Anomaly Resolution Session (Pre-500 Pilot Part 2)

**Source**: Audit logs for weight bloat and semantic anomalies.
**Files**: src/lib/fatsecret/normalization-rules.ts, src/lib/fatsecret/map-ingredient-with-fallback.ts

### Fix 76: Semantic Inversion for Spices (Thyme, Mustard)
| Field | Detail |
|-------|--------|
| Issue | "ground thyme" ? fresh thyme (massive caloric undervaluation); "spice blend mustard" ? unmapped |
| Fix | Added exact synonym overrides: ground thyme ? dried thyme powder and spice blend mustard ? mustard powder. |

### Fix 77: FDC Sub-Piece Parsing Bloat (Herb Bunches)
| Field | Detail |
|-------|--------|
| Issue | "5 mint 1 bunch" ? 500g (AI fallback guessed 1 piece = 100g) because FDC pipeline bypassed heuristics. |
| Fix | Re-wired FDC mapping block to parse trailing units (unch/head/stalk) and injected UNIT_HEURISTIC_DEFAULTS directly into uildFdcResult. "5 mint 1 bunch" is now accurately 150g (30g per bunch). |

### Fix 78: Bare Query Fallback Enforcement
| Field | Detail |
|-------|--------|
| Issue | "Pancake Mix" ? resolved to massive box sizes due to poisoned cache bypassing unitless heuristics. |
| Fix | Confirmed heuristic actively functions; selectively cleared poisoned generic queries from cache to ensure 39g serving size triggers correctly. |

### Fix 79: Cooking Spray Fixes
| Field | Detail |
|-------|--------|
| Issue | 4 sprays cooking spray ? 400g can. |
| Fix | UNIT_HEURISTIC_DEFAULTS handles spray as  .25g. "4 sprays" now yields 1g. |

### Change Index (Fixes 76-79)
| # | Category | Description |
|---|----------|-------------|
| 76 | Synonym | Added overrides for ground thyme and spice blend mustard |
| 77 | Parser & FDC | Intercepted FDC unitless queries with UNIT_HEURISTIC_DEFAULTS to catch parser trailing units |
| 78 | Cache Mgt | Cleared bare queries from ValidatedMapping |
| 79 | Heuristic | Applied spray heuristic universally |

---

## 2026-04-05: Anomaly Resolution Session (Pre-500 Pilot Part 3)

**Source**: Final hardening checks prior to 500-recipe pilot import.
**Files**: src/lib/fatsecret/map-ingredient-with-fallback.ts, scripts/clear-ingredient-cache.ts

### Fix 80: Unitless Discrete Produce Parsing Bug (e.g. Eggs)
| Field | Detail |
|-------|--------|
| Issue | "1 extra egg" → fell back to 1g default weight instead of discrete weight. |
| Root Cause | The `selectServing` function assigned `null` unit instead of the discrete `"piece"` when the parser returned `null` for `unit` but `isDiscreteItem` was true. This bypassed the count-based serving backfill system later in the pipeline. |
| Fix | Updated `selectServing` to assign `'piece'` if `isDiscreteItem(ingredientName)` is true and `unit` is null. |

### Fix 81: Canned Corn -> Sweet Corn context rewrite
| Field | Detail |
|-------|--------|
| Issue | "1 can yellow corn" → mapped to "yellow corn grain" (raw dried grain at ~1400 kcal per can). |
| Root Cause | "canned" modifier is often stripped in parsing. The FDC preferred "yellow corn grain" over canned sweet corn. |
| Fix | Added context-dependent rewrite rule: if `parsed?.unit === 'can'` or `"canned"` is in raw string, rewrite "corn" to "sweet corn". "1 can yellow corn" → maps to "Yellow Sweet Corn" (~350-400 kcal/can). |

### Fix 82: Early Cache skipCache Flag Ignoral
| Field | Detail |
|-------|--------|
| Issue | The `earlyCacheHit` block at line 496 did not respect the `options.skipCache: true` argument. Fixing pipeline rules didn't affect cached results in the local debug script. |
| Root Cause | The argument was missing from the check: `const earlyCacheHit = await getValidatedMappingByNormalizedName()`. |
| Fix | Replaced with `const earlyCacheHit = skipCache ? null : await getValidatedMappingByNormalizedName()`. |

### Change Index (Fixes 80-82)
| # | Category | Description |
|---|----------|-------------|
| 80 | Serving | Discrete items with null unit now default to "piece" unit. |
| 81 | Synonym | "corn" with "can" unit context mapped to "sweet corn". |
| 82 | Cache | Local debugging tool fixes bypasses local cache correctly. |



---

## 2026-04-07: Phase 3 Pipeline Hardening

**Source**: 500-recipe pilot import summary review.
**Files**: src/lib/fatsecret/map-ingredient-with-fallback.ts, src/lib/ai/ambiguous-serving-estimator.ts, data/fatsecret/normalization-rules.json

### Fix 83: 404 Outage on FatSecret / OpenRouter Model Fallback
| Field | Detail |
|-------|--------|
| Issue | The pipeline halted due to 404 errors streaming consistently from OpenRouter API. |
| Fix | Updated .env directly to default to mistralai/mistral-nemo to restore AI generation capabilities natively to the pipeline. |

### Fix 84: High-Count Leafy Greens Inflation (Lettuce & Cabbages)
| Field | Detail |
|-------|--------|
| Issue | 8 lettuce mapped to 4000g (~500kcal) because 8 pieces assumes 8 whole heads of lettuce. |
| Fix | Established getDiscreteLeafyGreenDefault() in ambiguous-serving-estimator.ts to assign leafy greens 10g weights automatically when the query is high-count and unitless. |

### Fix 85: Late-Binding Macro Constraint Validation (MAJOR)
| Field | Detail |
|-------|--------|
| Issue | 8 oz parmesan cheese fat free successfully mapped to Fat Free Parmesan Cheese Topping but allowed 11.5g of fat through the pipeline. |
| Fix | Recreated hasCriticalModifierMismatch evaluation directly inside hydrateAndSelectServing. Once hydration computes accurate grams/macros, the pipeline immediately runs a calculated post-check. If >2g of fat is verified for a fat-free query, the candidate is definitively bounced back via null wrapper to the AI Fallback Estimator. |

### Fix 86: Expanded Synonym Substitutions
| Field | Detail |
|-------|--------|
| Issue | peppers in adobo sauce mapped poorly. |
| Fix | Added dictionary rewrite vectors in normalization-rules.json: omega blended cooking oil -> cooking oil, peppers in adobo sauce -> chipotle peppers in adobo sauce, garlic salt -> salt. |

### Change Index (Fixes 83-86)
| # | Category | Description |
|---|----------|-------------|
| 83 | API Config | Replaced unavailable AI models with Mistral Nemo. |
| 84 | Pipeline | Blocked leafy green weight-bloat via unitless inflation overrides. |
| 85 | Logic Flow | Initiated late-binding macro verification on all API candidates post-hydration. |
| 86 | Synonyms | Expanded dictionary entries for adobo and oils. |
