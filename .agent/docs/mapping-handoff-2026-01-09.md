# Mapping Issues Handoff - 2026-01-09

## Status Summary
**Pilot Run**: 100 recipes, 697 ingredients, 100% technical success rate
**Issue**: Several critical mapping inaccuracies found requiring investigation

---

## 🔴 Critical Issues

### 1. TACOS → Bean Burrito (Line 173) - REGRESSION
```
"8 tacos" → "bean burrito taco bell" | (3344kcal/1600g)
```
- **Problem**: Mapping to fast food meal instead of taco shells
- **Expected**: Should map to taco shells (~60 kcal each, 480 total)
- **Action**: Need exclusion rule or dish vs component filter

### 2. Quinoa Mapping Inconsistency (Lines 55 vs 121, 218, 250)
```
Line 55:  "4 1/2 cups quinoa" → "QUINOA" (1944kcal/540g)
Line 121: "4 1/2 cups quinoa" → "Quinoa (Trader Joe's)" (2880kcal/792g)
```
- **Problem**: SAME text → DIFFERENT products
- **Root Cause**: Likely stale cache entry vs fresh mapping
- **Action**: Clear quinoa entries and verify cache key consistency

---

## 🟠 Moderate Issues

### 3. Pineapple Juice → Raw Pineapple (Line 209)
```
"1.5 cup pineapple juice" → "Pineapple" | (112kcal/232.5g)
```
- Underestimating by ~40%

### 4. Ground Beef → Generic Beef (Lines 62, 89)
```
"16 oz ground beef" → "Beef" | (1306kcal/453.6g)
```
- Should map to ground beef specifically

### 5. Crushed Red Pepper Flakes (Line 24) - PERSISTING
```
"2 tsp crushed red pepper flakes" → (72kcal/4.6g)
```
- 6x overestimate (expected ~11-12 kcal)
- **Status**: Known issue from previous runs

---

## 🟡 Minor Issues

### 6. Lemon Juice → Whole Lemon (Line 60)
```
"0.25 fl oz lemon juice" → "Lemon"
```
- Minor impact due to small quantity

---

## Investigation Commands

```bash
# Debug specific ingredients
npx ts-node scripts/debug-mapping-issue.ts --ingredient "8 tacos"
npx ts-node scripts/debug-mapping-issue.ts --ingredient "4 1/2 cups quinoa"
npx ts-node scripts/debug-mapping-issue.ts --ingredient "1.5 cup pineapple juice"

# Check cache for duplicates
npx ts-node scripts/debug-mapping-issue.ts --search "quinoa"
```

---

## Key Files

| File | Relevance |
|------|-----------|
| `filter-candidates.ts` | Exclusion rules, dish vs component |
| `gather-candidates.ts` | Search query construction |
| `simple-rerank.ts` | Scoring weights |
| `validated-mapping-helpers.ts` | Cache key logic |

---

## Completed This Session

- ✅ Cooking State Disambiguation (37/37 tests pass)
- ✅ USDA cooking conversion fallback with "(Cooked)" suffix
- ✅ Cache validation for cooking state
- ✅ Documentation in `ingredient-mapping-pipeline.md`
