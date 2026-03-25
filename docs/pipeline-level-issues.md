# Pipeline-Level Mapping Issues

> These issues cannot be resolved with synonym rewrites alone. They require changes to the mapping pipeline logic or addition of new data sources.

---

## 1. FDC Sort Preference Over FatSecret for Canned Goods

**Symptom**: `32 oz light red kidney beans` → WEIS QUALITY 2077 kcal/907g (229kcal/100g = **dry** bean data)

**Root Cause**: In `map-ingredient-with-fallback.ts` (L872-873), exact-match FDC entries are sorted above FatSecret entries:
```typescript
if (aIsExactMatch && a.source === 'fdc' && (!bIsExactMatch || b.source !== 'fdc')) return -1;
```

FatSecret has correct **canned** kidney bean data (92kcal/100g from Great Value, Bush's Best, etc.), but it loses to FDC's dry bean data in sorting.

**Proposed Fix**: Add a calorie density sanity check after sorting. For common canned goods categories (beans, corn, tomatoes, soups), if FDC entry has >180kcal/100g and FatSecret has <120kcal/100g, prefer the FatSecret entry. Alternatively, add a new API source (e.g., Nutritionix or USDA SR Legacy) that provides better canned goods data.

**Affected Ingredients**: kidney beans, black beans, chickpeas, navy beans (any bean variant where dry vs canned data differs 2-3x).

---

## 2. No Cooking Wine in FDC/FatSecret Databases

**Symptom**: `1.5 floz sherry wine` → vinegar sherry (SHERRY) — wine mapped to vinegar

**Root Cause**: FDC's only "sherry" entry is `vinegar sherry` with brand name "SHERRY". No actual cooking wine, sherry wine, or marsala wine exists in either FDC or FatSecret. Every synonym rewrite (`cooking sherry`, `dry sherry`, `white wine`, `sherry`) still matches the vinegar entry because the FDC brand name "SHERRY" gets a high text-match score.

**Proposed Fix**: 
1. Add cooking wines (sherry, marsala, mirin, rice wine) to the AI-generated food fallback system
2. Or add a new data source that includes wine nutritional data
3. Or add a category-level filter: if query contains "wine" and candidate contains "vinegar", reject the candidate

**Affected Ingredients**: sherry wine, marsala wine, cooking wine, rice wine (when used as ingredients)

---

## 3. FatSecret Per-Serving Data Errors

**Symptom**: `42g salad seasoning` → Original Ranch Seasoning & Salad Dressing Mix (0.8g) showing **0 kcal for 42g**

**Root Cause**: The FatSecret entry has a serving size of 0.8g. When the pipeline requests per-gram data, it returns 0 kcal because 1g of this seasoning blend rounds to 0 kcal. The actual product should show ~60-80 kcal for 42g (seasoning blends are ~150-200kcal/100g).

**Proposed Fix**:
1. Add a minimum calorie density check: if a dry/powder product shows 0 kcal for >10g, flag for review
2. Or multiply the per-serving values by the actual gram amount rather than using per-gram rounding
3. Or cross-validate against FDC data when FatSecret returns suspiciously low values

**Affected Ingredients**: Any dry seasoning blend, spice mix, or powdered product where per-serving size is very small (<1g)
