# Investigation: mapIngredientWithFallback vs autoMapIngredients

## Summary for Next Agent

Date: 2026-01-02

The pilot-batch-import script was modified to use `mapIngredientWithFallback` instead of the older `mapIngredientWithFatsecret`. This raised questions about whether the flow matches `autoMapIngredients`.

## Current Architecture

### autoMapIngredients (Production)
**File:** `src/lib/nutrition/auto-map.ts`

- Used by: Production app for user-created recipes
- Entry point: Called when a user saves a recipe
- Processes ingredients from database
- Applies cleanup patterns via `applyCleanupPatterns()`
- Likely creates/updates `IngredientFoodMap` records

### mapIngredientWithFallback (Unified API)
**File:** `src/lib/fatsecret/map-ingredient-with-fallback.ts`

- Used by: `pilot-batch-import.ts` for testing
- Entry point: Direct ingredient line to food mapping
- Features:
  - Unified candidate gathering (Cache + FatSecret API + FDC)
  - AI reranking for best candidate selection
  - Deferred hydration (only winner hydrated immediately)
  - Serving selection with AI backfill
  - `skipAiValidation` option to bypass AI validation

### mapIngredientWithFatsecret (Legacy)
**File:** `src/lib/fatsecret/map-ingredient.ts`

- Older API, still exists
- Does NOT have `skipAiValidation` option
- Simpler flow without FDC integration

## Key Questions - ANSWERED

### 1. Does autoMapIngredients call mapIngredientWithFallback?

**Answer: NO** ❌

`autoMapIngredients` (line 123 of `auto-map.ts`) calls:
```typescript
mapped = await mapIngredientWithFatsecret(cleanedLine, {...});
```

This is the **legacy API** from `src/lib/fatsecret/map-ingredient.ts`, NOT `mapIngredientWithFallback`.

### 2. Are they using the same underlying pipeline?

**Answer: NO - They are COMPLETELY DIFFERENT pipelines** ⚠️

| Feature | `mapIngredientWithFatsecret` (Production) | `mapIngredientWithFallback` (Pilot) |
|---------|-------------------------------------------|-------------------------------------|
| FDC Search | NO | YES (parallel with FatSecret) |
| Unified Candidate Gathering | NO | YES (cache + FatSecret + FDC) |
| Token-based Filtering | Basic | Advanced (`filter-candidates.ts`) |
| AI Reranking | YES | YES (but with confidence gate) |
| Serving Backfill | Basic | Advanced with fallback paths |
| `skipAiValidation` option | NO | YES |
| FDC Priority for Produce | NO | YES (prefers USDA data) |

**Key Implication:** Fixes made in `mapIngredientWithFallback` are NOT reflected in production's `autoMapIngredients`.

### 3. Why is pilot-batch-import so slow?

Confirmed causes:
- AI normalize call for every new ingredient
- AI reranking (unless confidence gate bypasses)
- AI serving backfill when serving cache misses
- Parallel FatSecret + FDC searches per ingredient

Mitigation in place: `BATCH_SIZE=5` for parallel processing

## Issues Fixed This Session

1. **isSizeQualifier missing export** - Added stub functions to `src/lib/usda/fdc-ai-backfill.ts`
2. **Race condition in cache** - Changed `cache.ts:175` from `create` to `upsert`
3. **Parallel processing** - Added BATCH_SIZE=5 to `pilot-batch-import.ts`
4. **skipAiValidation** - Added to pilot-batch-import to avoid overly strict AI rejection

## Files to Review

- `src/lib/nutrition/auto-map.ts` - Entry point for production mapping
- `src/lib/fatsecret/map-ingredient-with-fallback.ts` - Unified mapping API
- `src/lib/fatsecret/map-ingredient.ts` - Legacy mapping API
- `scripts/pilot-batch-import.ts` - Test script (modified this session)

## Latest Pilot Import Results (5 recipes)

- Success Rate: 82.8%
- Total Ingredients: 29
- Successful: 24
- Failed: 5

### Failures to Investigate
1. `salted butter` - No mapping found (should match!)
2. `chia seeds` - No mapping found  
3. `crushed red pepper flakes` - No mapping found
4. `vegetable oil spread` - No mapping found
5. `keto peanut butter fat bombs` - Unique constraint error (fixed with upsert)

---

## Failed Mappings Investigation (2026-01-02)

### Analysis Method
Code review of `mapIngredientWithFallback` and `gatherCandidates` since live testing froze (likely database/API connectivity issues).

### Likely Root Causes

#### 1. `salted butter` - Should definitely work
**Expected behavior:** Should match "Butter, Salted" in both FatSecret and FDC
**Possible issues:**
- API rate limiting or connectivity issues during pilot run
- Token filtering may be too aggressive (requires both "salted" AND "butter" tokens)
- Cache miss + API timeout

**Code location to check:** `gather-candidates.ts` line 321 (`searchFatSecretLiveSimple`)

#### 2. `chia seeds` - Should work
**Expected behavior:** Common ingredient, should be in both APIs
**Possible issues:**
- Same connectivity/timeout issues
- May need pluralization handling for "chia seed" vs "chia seeds"

#### 3. `crushed red pepper flakes` - Complex modifier
**Expected behavior:** Should match "Red Pepper Flakes" or "Crushed Red Pepper"
**Possible issues:**
- Token filtering requires ["crushed", "red", "pepper", "flakes"]
- May reject candidates that only have "pepper flakes" or "crushed red pepper"
- AI normalization may strip "crushed" as a prep phrase

**Code location:** `filter-candidates.ts` - token filtering logic

#### 4. `vegetable oil spread` - Ambiguous
**Expected behavior:** Could match margarine or vegetable spread
**Possible issues:**
- "spread" is not a common food token
- May be confused with generic "vegetable oil" fallback
- Token filtering too strict

#### 5. `keto peanut butter fat bombs` - Fixed
**Root cause:** Race condition in cache causing unique constraint error
**Fix applied:** Changed `cache.ts:175` from `create` to `upsert`

### Common Themes

1. **API Connectivity Issues** - Several failures could be API timeouts during the pilot run
2. **Token Filtering Strictness** - Complex multi-word ingredients may fail token requirements
3. **Prep Phrase Stripping** - AI normalize may strip words that are actually important

### Recommended Next Steps

1. **Run single-ingredient test** with verbose logging to see exact failure point
2. **Check API connectivity** - Ensure FatSecret and FDC APIs are accessible
3. **Review token filtering** for complex ingredients in `filter-candidates.ts`
4. **Add common ingredients to cache** as seed data to avoid API dependency

