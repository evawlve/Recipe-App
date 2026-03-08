# Mapping Issues Handoff - 2026-01-09 (Critical)

> **Status**: 5 critical issues persist after cache validation fix
> **Pilot Run**: 100 recipes, 697 ingredients, 100% technical success
> **New Concern**: Non-deterministic results detected

---

## 🚨 Critical Issues

### 1. TACOS → Bean Burrito (NON-DETERMINISTIC)

```
Run 1 (03:16): "8 tacos" → "bean burrito taco bell" | (3344 kcal / 1600g)
Run 2 (04:07): "8 tacos" → "bean burrito taco bell" | (2508 kcal / 1200g)
```

**Problems**:
- Wrong product (should be taco shells, not bean burrito)
- Different calories across runs for SAME input
- Cache should be deterministic

**Possible Causes**:
- Multiple ValidatedMapping entries for same normalizedForm
- Race condition in concurrent writes
- Non-deterministic portion calculation

### 2. Quinoa Inconsistency (SAME TEXT → DIFFERENT PRODUCTS)

```
Line 55:  "4 1/2 cups quinoa" → "QUINOA"            (1944 kcal / 540g)
Line 121: "4 1/2 cups quinoa" → "Quinoa (TJ's)"     (2880 kcal / 792g)
```

**Gap**: 936 kcal difference for identical input!

**Root Cause**: Should be impossible with proper cache keying

### 3. Pineapple Juice → Raw Pineapple

```
"1.5 cup pineapple juice" → "Pineapple" | (112 kcal / 232.5g)
```

- Mapping juice to whole fruit
- ~40% calorie underestimate

### 4. Ground Beef → Generic Beef

```
"16 oz ground beef" → "Beef" | (1306 kcal / 453.6g)
```

- Should map to "ground beef" specifically
- Missing the "ground" qualifier in search/filter

### 5. Crushed Red Pepper Flakes (6x Overestimate)

```
"2 tsp crushed red pepper flakes" → (72 kcal / 4.6g)
```

- Expected: ~11-12 kcal
- Issue: Wrong serving size or product

---

## 🔴 Non-Determinism Investigation

The fact that the same input produces different outputs is a **critical bug**.

### Check ValidatedMapping for Duplicates

```sql
SELECT "normalizedForm", COUNT(*) as cnt, 
       array_agg("foodName"), array_agg("id")
FROM "ValidatedMapping" 
WHERE "normalizedForm" IN ('taco', 'quinoa')
GROUP BY "normalizedForm"
HAVING COUNT(*) > 1;
```

### Check Cache Key Uniqueness

In `validated-mapping-helpers.ts`, the cache uses:
- `normalizedForm_source` as unique key
- Should prevent duplicates

### Debug Commands

```bash
# Debug tacos
npx ts-node scripts/debug-mapping-issue.ts --ingredient "8 tacos"

# Debug quinoa
npx ts-node scripts/debug-mapping-issue.ts --ingredient "4 1/2 cups quinoa"

# Search cache for duplicates
npx ts-node scripts/debug-mapping-issue.ts --search "quinoa"
```

---

## 🎯 Priority Actions

| Priority | Issue | Action |
|----------|-------|--------|
| **P0** | Non-deterministic tacos | Check for duplicate cache entries |
| **P0** | Quinoa inconsistency | Verify cache key uniqueness |
| **P1** | Pineapple juice | Add "juice" vs "fruit" filter |
| **P1** | Ground beef | Preserve "ground" in normalization |
| **P2** | Crushed pepper | Fix serving size calculation |

---

## Key Files

| File | Relevance |
|------|-----------|
| `validated-mapping-helpers.ts` | Cache key logic, duplicate prevention |
| `filter-candidates.ts` | Product type filtering |
| `gather-candidates.ts` | Search query construction |
| `simple-rerank.ts` | Scoring, token matching |

---

## What Was Tried

1. ✅ Added `rawLine` param to cache lookup for cooking state validation
2. ✅ Added `isWrongCookingStateForGrain()` check in cache
3. ✅ Added `hasCriticalModifierMismatch()` check in cache
4. ❌ Issues persist - root cause is different than assumed
