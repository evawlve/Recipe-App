# Mapping Non-Determinism Fix - Handoff

**Date**: 2026-01-09
**Session Focus**: Fixing taco filter + quinoa non-determinism

---

## Changes Made

### 1. Taco Exclusion Removed ✅
**File**: [filter-candidates.ts:640-645](file:///C:/Dev/Recipe%20App/src/lib/fatsecret/filter-candidates.ts#L640-L645)

**Problem**: The taco exclusion rule was backwards:
- Filtered out actual tacos ("Taco with Beef, Cheese")
- Kept irrelevant items ("bean burrito taco bell")

**Fix**: Removed the rule entirely. Let scoring decide.

---

### 2. Deterministic Tiebreaker Added ✅
**File**: [simple-rerank.ts:373-383](file:///C:/Dev/Recipe%20App/src/lib/fatsecret/simple-rerank.ts#L373-L383)

**Problem**: When candidates had equal scores, JS `sort()` was non-deterministic.

**Fix**: Multi-level tiebreaker:
```typescript
scored.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
    // Prefer non-branded (generic) foods
    const aHasBrand = a.candidate.brandName ? 1 : 0;
    const bHasBrand = b.candidate.brandName ? 1 : 0;
    if (aHasBrand !== bHasBrand) return aHasBrand - bHasBrand;
    // Final tiebreaker: ID for absolute determinism
    return a.candidate.id.localeCompare(b.candidate.id);
});
```

---

### 3. In-Flight Lock Added ⚠️ NEEDS TESTING
**File**: [map-ingredient-with-fallback.ts:87-101, 261-298, 405-420, 1273-1280](file:///C:/Dev/Recipe%20App/src/lib/fatsecret/map-ingredient-with-fallback.ts)

**Problem**: Parallel batch processing caused race conditions:
- Thread A and Thread B both map "quinoa" simultaneously
- Both miss cache, both run full pipeline
- Each gets slightly different API results → different winners

**Fix**: In-flight mutex:
1. Before processing, check if another thread is already mapping same `normalizedName`
2. If yes, wait and re-check cache after lock releases
3. If no, register lock, process, release lock when done

**Status**: Implemented but last test batch only processed 35 ingredients (should be 697). May need debugging.

---

## Verification Results (Last Full Batch)

From `mapping-summary-2026-01-09T05-17-52.txt`:

| Issue | Before | After |
|-------|--------|-------|
| Tacos | "bean burrito" (wrong) | "Taco Meat" ✅ |
| Quinoa | Inconsistent (QUINOA vs TJ's) | Still inconsistent ⚠️ |

---

## Remaining Issues

### Quinoa Non-Determinism
The in-flight lock should fix this, but the last test run was incomplete.

**To verify**: 
```bash
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/clear-all-mappings.ts
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/pilot-batch-import.ts 100
```

Then search for quinoa in the summary:
```bash
Select-String -Path "logs\mapping-summary-*.txt" -Pattern "quinoa"
```

All entries should map to the SAME food.

---

## Files Modified

| File | Change |
|------|--------|
| `filter-candidates.ts` | Removed taco exclusion rule |
| `simple-rerank.ts` | Added deterministic sort tiebreaker |
| `map-ingredient-with-fallback.ts` | Added in-flight lock mechanism |
| `validated-mapping-helpers.ts` | Added `orderBy` to `findByTokenSet` (earlier fix) |
