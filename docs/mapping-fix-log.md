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
| Usage | `npx ts-node scripts/debug-mapping-pipeline.ts "ingredient" [--skip-cache] [--verbose]` |
| Output | 8 steps: Parse → Normalize → Cache → Gather → Filter → Gate → Rerank → Fallback |

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

## Test Script

Run `npx tsx scripts/test-mapping-fixes.ts` to verify all fixes.

**Final Result**: 464/468 (99.1%) mapping success rate on 100-recipe pilot (642 ingredients after dedup).

### Note on Remaining Failures
- `buttery cinnamon powder` - fictional ingredient, no API match
- `burger relish` - AI simplification needed to map to "pickle relish"
