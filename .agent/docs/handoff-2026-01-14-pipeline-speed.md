# Handoff: Pipeline Speed Optimization Investigation

**Date**: 2026-01-14  
**Previous Work**: Fixed three critical bugs causing batch import failures  
**Next Goal**: Investigate pipeline speed optimizations

---

## Summary of Fixed Issues

Three bugs were fixed in this session:

### 1. Recursive Deadlock (`_skipInFlightLock`)
**Location**: `src/lib/fatsecret/map-ingredient-with-fallback.ts`

When AI simplification returned a similar name (e.g., "2 tbsp salted butter" → "Salted Butter"), the recursive fallback call at line ~727 would try to acquire the same lock as the parent, causing deadlock.

**Fix**: Added `_skipInFlightLock?: boolean` option that bypasses lock acquisition in recursive calls.

### 2. Infinite Fallback Loop (`_skipFallback`)
**Location**: `src/lib/fatsecret/map-ingredient-with-fallback.ts`

After fixing deadlock, fallback kept calling itself: fallback → fallback → fallback...

**Fix**: Added `_skipFallback?: boolean` option that prevents recursive fallback calls.

### 3. Null Macro Filter Rejection
**Location**: `src/lib/fatsecret/filter-candidates.ts` line ~1017

`hasNullOrInvalidMacros()` returned `true` (invalid) when `nutrients` was null/undefined, rejecting ALL candidates without pre-populated nutrition data.

**Fix**: Changed to return `false` when no nutrition data exists.

---

## Current Performance

| Metric | Sequential | Parallel |
|--------|-----------|----------|
| 20 recipes | 16+ min | ~7 min |
| Per ingredient | ~3-5 sec | Concurrent |

---

## Optimization Investigation Areas

### 1. Lock Contention Strategy

**Current Behavior** (`src/lib/fatsecret/map-ingredient-with-fallback.ts` lines 280-314):
```typescript
const lockKey = getLockKey(baseName);
const existingLock = inFlightLocks.get(lockKey);

if (existingLock && !_skipInFlightLock) {
    await existingLock;  // BLOCKS until lock released
    // Then check cache...
}
```

**Problem**: If "butter" is being processed, all other "butter" requests wait. With many recipes containing common ingredients (eggs, butter, oil), this creates bottlenecks.

**Proposed Improvement - Skip & Retry Pattern**:
```typescript
// Instead of waiting, skip this ingredient and try later
if (existingLock && !_skipInFlightLock) {
    return { status: 'pending', lockKey };  // Signal to retry
}
```

The batch orchestrator would:
1. Process all non-locked ingredients first
2. Collect "pending" ingredients  
3. Retry pending after first pass (lock should be released)

### 2. Parallel FDC + FatSecret Calls

**Current** (`gatherCandidates`): FDC and FatSecret searches run in parallel, which is good.

**Potential Issue**: AI normalization calls may not be parallelized efficiently.

**Investigation**: Check if `aiNormalizeIngredient()` can be batched or cached more aggressively.

### 3. Database Query Optimization

**Current**: Each `prisma.ingredientFoodMap.create()` is sequential within the result loop.

**Potential**: Batch multiple creates into `prisma.ingredientFoodMap.createMany()`.

### 4. Cache Warming

**Current**: Cache is populated lazily during mapping.

**Potential**: Pre-warm cache for common ingredients before batch import.

---

## Key Files to Review

| File | Relevance |
|------|-----------|
| `src/lib/fatsecret/map-ingredient-with-fallback.ts` | Lock mechanism (lines 280-314), fallback (lines 710-780) |
| `src/lib/fatsecret/gather-candidates.ts` | Parallel candidate gathering |
| `src/lib/fatsecret/filter-candidates.ts` | Token filtering, `hasNullOrInvalidMacros` |
| `scripts/pilot-batch-import.ts` | Batch orchestration with Promise.allSettled |

---

## Testing Commands

```bash
# Clear mappings and run 20-recipe import
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/clear-all-mappings.ts
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/pilot-batch-import.ts 20

# Check database state
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/check-db-state.ts

# Test single ingredient
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/test-butter.ts
```

---

## ✅ Implemented Optimizations

### 1. Parallel Recipe Processing
**File**: `scripts/pilot-batch-import.ts`
- `RECIPE_CONCURRENCY = 10` — 10 recipes process simultaneously
- All ingredients per recipe parallel via `Promise.allSettled`

### 2. Skip-on-Lock Pattern  
**File**: `src/lib/fatsecret/map-ingredient-with-fallback.ts`
- Added `skipOnLock?: boolean` option and `MapIngredientPendingResult` type
- Returns `{ status: 'pending' }` instead of blocking
- Batch import retries pending items after first pass

### 3. Fire-and-Forget Deferred Hydration
**File**: `src/lib/fatsecret/deferred-hydration.ts`
- `queueForDeferredHydration()` kicks off hydration immediately
- Uses `.catch()` pattern — no await, no blocking
- Runner-ups hydrated in background while mapping continues

### 4. Preemptive Serving Backfill
**File**: `src/lib/fatsecret/serving-backfill.ts`
- Added `backfillCommonServings()` function
- Discrete items: whole, medium, large, piece
- Liquids: tbsp, cup, ml
- Default: tsp, tbsp, cup
- Controlled by `ENABLE_PREEMPTIVE_BACKFILL=true`

---

## Verification Results

**100-Recipe Batch Import:**

| Metric | Value |
|--------|-------|
| Recipes | 100 |
| Ingredients | 785 |
| Success Rate | 88.8% |
| Avg Confidence | 0.966 |
| High Confidence | 100% |

