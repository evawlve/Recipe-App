# Mapping Issues Session Handoff

**Date**: 2026-01-11  
**Session**: Mapping Log Analysis & Fixes

---

## Completed Work

### Issue 2: Lentils Density (ml → grams) ✅

**Problem**: FatSecret `RED LENTILS` serving uses `60ml` (not grams), causing incorrect weight calculation.

**Fix**: Added category-based density inference in `density.ts`:
- `inferCategoryFromName()` with keyword patterns for 20+ food categories
- Updated `gramsForServing()` to use category density (legume: 0.90, rice: 0.85, etc.)

**Files Modified**:
- `src/lib/units/density.ts` - Added `CATEGORY_KEYWORDS` and `inferCategoryFromName()`
- `src/lib/fatsecret/map-ingredient-with-fallback.ts` - Updated `gramsForServing()` signature

---

### Issue 3: "To Taste" Parsing ✅

**Problem**: `"1 1 salt, to taste"` returned null (mapping failure).

**Fix**: Now defaults to `1 tsp` with `isEstimatedQuantity: true` flag for user notification.

**File Modified**: `src/lib/parse/ingredient-line.ts`

---

### Issue 4: Rice Defaults to Brown ✅

**Problem**: Generic "rice" mapped to "Brown Rice" instead of more common white rice.

**Fix**: Added RICE DEFAULT rule to AI normalize system prompt.

**File Modified**: `src/lib/fatsecret/ai-normalize.ts`

---

### Future Improvement Documented

Added to `ingredient-mapping-pipeline.md`:
- **Eager AI Density Backfill**: Consider switching from lazy (category-based) to eager (AI-estimated) density when logging feature ships.

---

## Deferred: Issue 1 - Chilli Peppers → Cream Cheese

### The Problem

`"2 chilli peppers"` mapped to `"chilli peppers cream cheese (VIOLIFE)"` - a branded cream cheese product instead of fresh vegetables.

### Root Cause Analysis

The existing filter `isSimpleIngredientToProcessedMismatch()` in `filter-candidates.ts` (line 1140) was designed to catch this exact case but didn't trigger, likely due to:
1. Poisoned cache entry from a previous incorrect mapping
2. Filter not being applied during all code paths

### Proposed Investigation Routes

#### Route 1: Multi-Ingredient Detection in AI Normalize
Detect when AI normalize identifies multiple ingredients in a single line:

```
Input: "1 tsp sour cream and ketchup"
AI detects: ["sour cream", "ketchup"]
→ Split into 2 lines → Process each through normal pipeline
```

**Challenge**: Distinguishes between:
- `"sour cream and ketchup"` (TWO ingredients) 
- `"chili peppers cream cheese"` (ONE compound product)

#### Route 2: Failure-Based Retry with Line Modification
If initial mapping fails (no candidate, serving failure), analyze the failure type:

```
Attempt 1: "chilli peppers cream cheese" → Fails (no exact match)
Analyze: Could this be a compound ingredient?
Attempt 2: Split into "chilli peppers" + "cream cheese" → Retry separately
```

#### Route 3: Enhanced canonicalBase Generation
Teach AI normalize to be more conservative with canonicalBase:
- Don't strip words that might form a compound product name
- Preserve full naming when product could be a single branded item

#### Route 4: Candidate Validation with Nutrition Sanity Check
Before accepting a candidate, validate nutrition profile:
- Fresh chilli peppers: ~40 kcal/100g
- Cream cheese product: ~233 kcal/100g
- Mismatch → Reject and try alternatives

### Recommended Next Steps

1. **Clear poisoned cache entries** for chilli peppers
2. **Verify filter is applied** in all candidate selection paths
3. **Prototype multi-ingredient detection** in AI normalize with safe splitting logic
4. **Add integration tests** for compound ingredient edge cases

---

## Files Summary

| File | Changes |
|------|---------|
| `src/lib/units/density.ts` | Added `inferCategoryFromName()` with keyword patterns |
| `src/lib/fatsecret/map-ingredient-with-fallback.ts` | Updated `gramsForServing()` to use category density |
| `src/lib/parse/ingredient-line.ts` | "To taste" → 1 tsp default with flag |
| `src/lib/fatsecret/ai-normalize.ts` | Rice defaults to white rice |
| `.agent/docs/ingredient-mapping-pipeline.md` | Added future improvement note |

---

## Verification Commands

```bash
# Test category inference
npx ts-node -e "console.log(require('./src/lib/units/density').inferCategoryFromName('RED LENTILS'))"

# Test "to taste" parsing  
npx ts-node -e "console.log(require('./src/lib/parse/ingredient-line').parseIngredientLine('salt, to taste'))"

# Full batch verification
npx ts-node scripts/clear-all-mappings.ts
$env:ENABLE_MAPPING_ANALYSIS='true'; npm run pilot-import 100
```
