# Serving Selection Debugging Guide

Reference for debugging and fixing serving-related issues in ingredient mapping.

---

## Common Serving Issues

### 1. Volume Unit Conversion Failures

**Symptom:** `no_suitable_serving_found` for volume units like `cup`, `tbsp`

**Root Cause:** FatSecret API stores volume serving metadata inconsistently:
- A serving with `measurementDescription: "ml"` may have `metricServingUnit: "g"` (wrong)
- This blocks the `volumeToMl[metricUnit]` lookup in `selectServing()`

**Solution:** The `extractServingVolumeUnit()` function now:
1. Parses the description first (e.g., "2 tbsp", "100 ml")
2. Falls back to `metricServingUnit` only if description parsing fails
3. Uses `volumeMl` field for standalone volume units like "ml"

**Volume Conversions:**
```
1 cup = 240 ml
1 tbsp = 15 ml
1 tsp = 5 ml
1 fl oz = 30 ml
```

**Debug Query:**
```sql
SELECT measurementDescription, metricServingUnit, metricServingAmount, volumeMl 
FROM "FatSecretServingCache" 
WHERE foodId = '<id>';
```

---

### 2. Discrete Item Serving Selection

**Symptom:** Items like "2 beef franks" return inflated grams (280g instead of 90g)

**Root Cause:** For unitless ingredients, `selectServing()` prioritizes whole-item patterns:
- `/medium/`, `/large/`, `/small/` → Good for produce ("1 cucumber" → "medium" ~300g)
- Bad for discrete items ("2 beef franks" → "medium" 140g × 2 = 280g ❌)

**Solution:** Added `isDiscreteItem()` check from `serving-backfill.ts`:
- Skips whole-item pattern matching for franks, sausages, hot dogs, etc.
- Falls back to ANY serving with valid grams (usually the default "serving")

**Discrete Items List:**
- frank, franks, sausage, sausages, hotdog, hot dog
- wiener, wieners, link, links
- tortilla, bread, bagel, egg, etc.

**Correct Flow:**
```
"2 beef franks" 
  → isDiscreteItem("beef franks") = true
  → Skip medium/large patterns
  → Use default "serving" (45g) × 2 = 90g ✓
```

---

### 3. Size-Based Servings (Ambiguous Units)

**Symptom:** Units like `medium`, `large`, `small` return wrong weights

**Root Cause:** These are "ambiguous units" that depend on the specific food:
- "1 medium apple" → ~180g
- "1 medium potato" → ~150g
- "1 medium frank" → 140g (but we want per-item, not per-size)

**Solution:** Ambiguous units trigger AI estimation via `getOrCreateAmbiguousServing()`:
- Uses food name to estimate appropriate weight
- Lower confidence threshold (user can override)

---

## Debugging Checklist

### Step 1: Check Serving Cache
```typescript
const servings = await prisma.fatSecretServingCache.findMany({
  where: { foodId: '<id>' }
});
servings.forEach(s => console.log({
  desc: s.measurementDescription,
  grams: s.servingWeightGrams,
  isDefault: s.isDefault,
  volumeMl: s.volumeMl,
  metricUnit: s.metricServingUnit
}));
```

### Step 2: Check Default Serving
- Is `isDefault: true` set correctly?
- Does it have valid `servingWeightGrams`?
- Is `measurementDescription === "serving"` for discrete items?

### Step 3: Check Volume Data
- Does `volumeMl` contain correct value?
- Does `metricServingUnit` match (g vs ml)?

### Step 4: Run Debug Script
```powershell
npx ts-node scripts/debug-mapping-issue.ts --ingredient "1 cup honey"
```

---

## Key Files

| File | Purpose |
|------|---------|
| `map-ingredient-with-fallback.ts` | Main mapping + `selectServing()` function |
| `serving-backfill.ts` | `isDiscreteItem()`, `backfillOnDemand()` |
| `ambiguous-unit-backfill.ts` | AI estimation for size units |
| `unit-type.ts` | Unit classification (volume/count/mass) |

---

## selectServing() Priority Order

For **unitless** ingredients (no unit specified):

1. **PRIORITY 0:** Default "serving" with `isDefault: true` and valid grams
2. **PRIORITY 1:** Whole-item patterns (medium/large/small) — *SKIPPED for discrete items*
3. **PRIORITY 2:** Count patterns (clove, piece, slice)
4. **PRIORITY 3:** Discrete item fallback — any serving with valid grams
5. **AI Backfill:** If nothing found, trigger AI estimation

For **volume** units (cup, tbsp, tsp):

1. Exact unit match in description
2. Volume-to-volume conversion (e.g., tbsp → cup via ml)
3. Density-based estimate (180g/cup default)

---

## Test Commands

```powershell
# Test volume conversion
npx ts-node scripts/debug-mapping-issue.ts --ingredient "0.25 cup honey"

# Test discrete items
npx ts-node scripts/test-beef-franks.ts

# Clear cached mapping before retesting
npx ts-node -e "require('./src/lib/db').prisma.validatedMapping.deleteMany({where: {normalizedForm: 'honey'}})"
```
