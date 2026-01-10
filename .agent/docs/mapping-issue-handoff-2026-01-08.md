# Mapping Issue Handoff - January 2026

This document summarizes the investigation into ingredient mapping discrepancies from `mapping-summary-2026-01-08T03-44-06.txt` and provides guidance for fixing the remaining issues.

## Quick Links

- **Debugging Guide**: [debugging-quickstart.md](file:///C:/Dev/Recipe%20App/.agent/docs/debugging-quickstart.md)
- **Pipeline Documentation**: [ingredient-mapping-pipeline.md](file:///C:/Dev/Recipe%20App/.agent/docs/ingredient-mapping-pipeline.md)
- **Debug Script**: `scripts/debug-mapping-issue.ts`
- **Latest Mapping Summary**: `logs/mapping-summary-2026-01-08T03-44-06.txt`
- **Detailed Analysis JSON**: `logs/mapping-analysis-2026-01-08T03-44-06.json`

---

## Issues Fixed ✅

### 1. Ground Meat → Steak Exclusion
**File**: [filter-candidates.ts](file:///C:/Dev/Recipe%20App/src/lib/fatsecret/filter-candidates.ts)

Added exclusion rule at ~line 498:
```typescript
{
    query: ['ground chuck', 'ground beef', 'ground pork', 'ground turkey', 'ground lamb', 'ground meat', 'minced beef', 'minced meat'],
    excludeIfContains: ['steak', 'roast', 'chop', 'tenderloin', 'ribeye', 'sirloin', 'strip', 'filet', 'loin', 'eye steak', 'chuck eye']
}
```

**Verification**: `debug-mapping-issue.ts --ingredient "2 lbs ground chuck"` → "Ground Chuck" @ 0.98 confidence

### 2. Taco → Baked Taco Shell Exclusion
**File**: [filter-candidates.ts](file:///C:/Dev/Recipe%20App/src/lib/fatsecret/filter-candidates.ts)

Enhanced existing taco exclusion to include `'baked taco'`:
```typescript
{
    query: ['taco', 'tacos', 'taco shell', 'taco shells'],
    excludeIfContains: ['taco meat', '...', 'baked taco']  // Added 'baked taco'
}
```

**Verification**: `debug-mapping-issue.ts --ingredient "8 tacos"` → "Crunchy Taco" @ 0.92 confidence

### 3. Macro Profiles Added
**File**: [filter-candidates.ts](file:///C:/Dev/Recipe%20App/src/lib/fatsecret/filter-candidates.ts)

Added profiles at ~line 690-707:
- **Dried spices**: `maxCalPer100g: 400` (pure spices are ~280-320 kcal/100g)
- **70% dark chocolate**: `maxCarbPer100g: 50` (rejects products with >50g carbs)

---

## Issues Remaining 🔧

### 1. Crushed Red Pepper Flakes - Serving Size Error

**Problem**: McCormick Crushed Red Pepper Flakes on FatSecret has **4.6g per tsp** (should be ~1.8g)
- Results in 72kcal for 2 tsp instead of ~12kcal
- **6x overestimate!**

**Root Cause**: Upstream FatSecret vendor data quality issue

**FDC Candidates Are Unusable**:
- `fdc_2052376`: 0 kcal/100g (impossible)
- `fdc_2454832`: 500 kcal, 100g carbs/100g (impossible)

**Recommended Fix**: Add `PortionOverride` entry
```typescript
// In src/lib/units/portion-overrides.ts or via database
{
    normalizedForm: 'crushed red pepper flakes',
    unit: 'tsp',
    grams: 1.8,  // Standard density for crushed dried pepper
    source: 'curated'
}
```

**Verification Command**:
```bash
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-mapping-issue.ts --ingredient "2 tsp crushed red pepper flakes"
```

---

### 2. Dark Chocolate 70% → Wrong Product Selection

**Problem**: `"100 g organic pure dark 70% dark chocolate"` → `"Sweet or Dark Chocolate"` (59.6g carbs)
- 70% dark chocolate should have ~40-45g carbs
- Generic "Sweet or Dark Chocolate" is a lower cocoa percentage product

**Root Cause**: During initial batch import, the scoring selected the generic product over specific "70% Dark Chocolate Wedges" candidates. Then ALL synonyms (`70% dark chocolate`, `70% cocoa dark chocolate`, etc.) were cached with this wrong mapping.

**Cache Evidence** (from `logs/cache-check.txt`):
```
"dark chocolate 70%" → "Sweet or Dark Chocolate"
"70% cocoa dark chocolate" → "Sweet or Dark Chocolate"
"organic 70% dark chocolate" → "Sweet or Dark Chocolate"
```

**Recommended Fixes** (choose one):

**Option A - Scoring Boost for Percentage Match**:
In `simple-rerank.ts` or scoring logic, add bonus for candidates that match a percentage in the query:
```typescript
// If query contains "70%", boost candidates containing "70%"
if (queryContainsPercentage && candidateContainsSamePercentage) {
    score += 0.2;  // Significant boost
}
```

**Option B - Macro Profile (already added)**:
The macro profile `maxCarbPer100g: 50` for 70% dark chocolate should reject "Sweet or Dark Chocolate" (59.6g carbs).

**Required**: Clear bad cache entries first:
```bash
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/clear-choc-quinoa-cache.ts
```

---

### 3. Quinoa - Dry vs Cooked Ambiguity

**Problem**: `"4 1/2 cups quinoa"` → `"QUINOA"` (dry) with 1944kcal/540g (3.6 kcal/g)
- Dry quinoa: ~360 kcal/100g (3.6 kcal/g)
- Cooked quinoa: ~120 kcal/100g (1.2 kcal/g)
- **Potential 3x overestimate!**

**Root Cause**: No disambiguation for volume units with grains. "Cups" almost always means **cooked** in recipes.

> [!IMPORTANT]
> User specifically stated: **"We definitely don't want raw=cooked for any food unless specified!"**
> Default should be RAW for weight units (g, oz, lb), but COOKED for volume units (cups) with grains/pasta/rice.

**Recommended Fix - Unit-Context Disambiguation**:

In `filter-candidates.ts` or serving selection, add logic:
```typescript
const VOLUME_MEANS_COOKED = ['quinoa', 'rice', 'pasta', 'oatmeal', 'oats', 'barley', 'couscous', 'bulgur'];

function preferCookedForVolumeUnits(normalizedName: string, unit: string): boolean {
    const isVolumeUnit = ['cup', 'cups'].includes(unit.toLowerCase());
    const isGrain = VOLUME_MEANS_COOKED.some(g => normalizedName.includes(g));
    return isVolumeUnit && isGrain;
}

// Then in candidate filtering/scoring:
if (preferCookedForVolumeUnits(normalizedName, unit)) {
    // Boost candidates with "cooked" in name
    // OR exclude candidates with "dry", "uncooked", "raw" in name
}
```

**Alternative - Serving Selection Override**:
In serving selection, when no explicit cooking state and volume unit is used:
- For grains: prefer servings labeled "cooked" over "dry"

---

## Debugging Tools

### Primary Debug Script
```bash
# Full pipeline debug with raw API results
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-mapping-issue.ts --ingredient "YOUR INGREDIENT" --showRaw
```

### Clear Specific Cache Entries
```bash
# Clear chocolate and quinoa bad mappings
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/clear-choc-quinoa-cache.ts

# Clear specific mappings
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/clear-specific-mappings.ts
```

### Check Cache Contents
```bash
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/check-choc-quinoa-cache.ts
```

### Run Pilot Batch Import
```bash
# Clear ALL mappings first
npx ts-node --project tsconfig.scripts.json -r tsconfig-paths/register scripts/clear-all-mappings.ts

# Run with analysis enabled
$env:ENABLE_MAPPING_ANALYSIS='true'; npm run pilot-import 100
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/fatsecret/filter-candidates.ts` | Category exclusions, macro profiles |
| `src/lib/fatsecret/simple-rerank.ts` | Candidate scoring and selection |
| `src/lib/fatsecret/validated-mapping-helpers.ts` | Cache save/lookup logic |
| `src/lib/fatsecret/serving-backfill.ts` | Serving size estimation |
| `src/lib/units/portion-overrides.ts` | Manual serving size overrides |

---

## Summary Checklist

- [x] Ground meat → steak exclusion
- [x] Taco → baked taco exclusion
- [x] Spice macro profile (max 400 kcal/100g)
- [x] 70% dark chocolate macro profile (max 50g carbs)
- [ ] **Crushed red pepper**: Add PortionOverride (1 tsp = 1.8g)
- [ ] **Dark chocolate 70%**: Clear cache + verify macro profile works OR add percentage scoring
- [ ] **Quinoa**: Add unit-context disambiguation (cups → prefer cooked for grains)
- [ ] Run pilot batch import to verify all fixes
