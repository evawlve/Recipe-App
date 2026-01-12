# Mapping Fixes Handoff - 2026-01-10

## Session Summary

Implemented 3 mapping fixes from `mapping-summary-2026-01-10T03-00-36.txt` analysis:

### Completed Fixes

| Fix | File | Status |
|-----|------|--------|
| Ambiguous unit backfill integration | [map-ingredient-with-fallback.ts](file:///C:/Dev/Recipe%20App/src/lib/fatsecret/map-ingredient-with-fallback.ts#L1192-L1248) | ✅ Committed |
| Dish term penalty (cheesecake, cupcake, pancake) | [gather-candidates.ts](file:///C:/Dev/Recipe%20App/src/lib/fatsecret/gather-candidates.ts#L1097) | ✅ Committed |
| Ice/water zero-calorie early exit | [map-ingredient-with-fallback.ts](file:///C:/Dev/Recipe%20App/src/lib/fatsecret/map-ingredient-with-fallback.ts#L190-L231) | ✅ Committed |

**Commit:** `b951eaf` - "fix: add 3 mapping fixes - ambiguous unit backfill, dish term penalty, ice/water zero-cal"

**Pilot Result:** 100% success (125/125 mappings)

---

## Open Issue: "stberry halves" → "Strawberry-Flavored Drink"

### Problem
The typo `"2 cup stberry halves"` is mapping to `"Strawberry-Flavored Drink"` instead of `"Strawberries"`.

### Evidence
From `mapping-summary-2026-01-10T03-59-40.txt` lines 47 & 131:
```
✓ [0.82] "2 cup stberry halves" → "Strawberry-Flavored Drink" | (250kcal/500g)
```

### Investigation Needed

1. **What is the AI normalized form?**
   - Check `AiNormalizeCache` for `"2 cup stberry halves"`
   - Verify what `aiNormalizeIngredient()` returns as `normalized_name`
   - Is the typo being corrected to "strawberry" or something else?

2. **How are candidates being gathered?**
   - What search terms are being used after normalization?
   - Is "Strawberry-Flavored Drink" appearing as a candidate?
   - Where does "Strawberries" rank in the candidate list?

3. **How are candidates being scored?**
   - Check `computePositionScore()` for the "Strawberry-Flavored Drink" candidate
   - The dish term penalty should apply to "Drink" but it's not in `DISH_TERMS`
   - Consider adding: `drink`, `beverage`, `flavored`, `juice` (if not already present)

### Debug Commands

```bash
# Check AI normalization cache for the input
npx tsx -e "
const { prisma } = require('./src/lib/db');
(async () => {
  const cached = await prisma.aiNormalizeCache.findFirst({
    where: { rawLine: { contains: 'stberry' } }
  });
  console.log('AI Normalize Cache:', JSON.stringify(cached, null, 2));
})();
"

# Debug full mapping flow with logging
npx tsx scripts/debug-mapping-issue.ts "2 cup stberry halves"
```

### Potential Fixes

1. **Add drink-related terms to DISH_TERMS:**
   ```typescript
   const DISH_TERMS = [..., 'drink', 'beverage', 'flavored'];
   ```

2. **Boost raw ingredient matches over processed products:**
   - Add penalty for "Flavored" when query doesn't contain it

3. **Check if AI normalization is returning correct base name:**
   - `stberry` should normalize to `strawberry`
   - `halves` should be preserved as a prep phrase

---

## Files Modified This Session

| File | Changes |
|------|---------|
| `src/lib/fatsecret/map-ingredient-with-fallback.ts` | +import ambiguous unit backfill, +ice/water early exit, +ambiguous unit handling in hydrateAndSelectServing |
| `src/lib/fatsecret/gather-candidates.ts` | +cheesecake/cupcake/pancake to DISH_TERMS |
| `scripts/test-mapping-fixes.ts` | New test script for verifying fixes |

## Related Files for Investigation

- [ai-normalize.ts](file:///C:/Dev/Recipe%20App/src/lib/fatsecret/ai-normalize.ts) - AI normalization logic
- [gather-candidates.ts](file:///C:/Dev/Recipe%20App/src/lib/fatsecret/gather-candidates.ts) - Candidate gathering and scoring
- [simple-rerank.ts](file:///C:/Dev/Recipe%20App/src/lib/fatsecret/simple-rerank.ts) - Final reranking
- [filter-candidates.ts](file:///C:/Dev/Recipe%20App/src/lib/fatsecret/filter-candidates.ts) - Candidate filtering
