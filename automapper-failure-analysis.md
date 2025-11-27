# Auto-Map Failure Analysis Report

## Executive Summary

**Current Performance**: 🎯 **97.9% Success Rate**
- Total recipes analyzed: **39**
- Total ingredients: **282**
- Successfully mapped: **276**
- Unmapped: **6**
- Recipes with any unmapped ingredients: **4**

## Unmapped Ingredients Breakdown

### Complete List of Failures

1. **"breasts bone and skin removed chicken into strips"**
   - Qty: Unknown  
   - Unit: Unknown
   - Recipe: General Tsao Chicken
   - **Issue**: Parsing artifact - directional text mixed into ingredient name

2. **"tsps ginger"**
   - Contains measurement unit in the name itself
   - **Issue**: Parser didn't strip "tsps" from the ingredient name

3. **"breasts bone and skin removed chicken breasts"**
   - Similar to #1
   - **Issue**: Parsing artifact with redundant descriptive text

4. **"unit chicken"**
   - **Issue**: Generic/ambiguous term - "unit" is likely a parsing error

5. **"lemon yields lemon"**
   - **Issue**: Parsing artifact with "yields" instruction mixed in

6. **"tbsps cornstarch"**
   - Contains measurement unit in the name
   - **Issue**: Parser didn't strip "tbsps" from the ingredient name

## Root Cause Analysis

### Category 1: Measurements in Ingredient Name (33% of failures)
- `tsps ginger`
- `tbsps cornstarch`

**Why it happens**: The ingredient parser is not consistently stripping measurement units from the ingredient name field.

**Impact**: Medium - Fairly easy to fix with parser improvements.

### Category 2: Parsing Artifacts (50% of failures)
- `breasts bone and skin removed chicken into strips`
- `breasts bone and skin removed chicken breasts`  
- `lemon yields lemon`

**Why it happens**: The ingredient line extraction from recipe text is including directional/preparation text that should be filtered out.

**Impact**: High - These are fundamental parsing issues that affect readability and matching.

### Category 3: Ambiguous/Generic Terms (17% of failures)
- `unit chicken`

**Why it happens**: Likely a parsing error where the actual quantity/unit got confused with the ingredient name.

**Impact**: Low - Rare occurrence, may need manual intervention.

## Recommendations (Prioritized)

### Priority 1: Fix Core Parsing Issues ⭐⭐⭐

**Action**: Improve ingredient line parser in [`src/lib/parse/ingredient-line.ts`](file:///c:/Dev/Recipe%20App/src/lib/parse/ingredient-line.ts)

1. **Strip measurement units from ingredient names**:
   - Pattern: `/(\\d+\\s*)?(tbsps?|tsps?|cups?|oz|lb|gram?s?|kg)\\s+/i`
   - Example: `"2 tbsps cornstarch"` → name should be `"cornstarch"`, not `"tbsps cornstarch"`

2. **Filter out directional/preparation phrases**:
   - Remove phrases like: "bone and skin removed", "cut into", "yields", "divided"
   - Use regex patterns or a blacklist of common preparation terms

3. **Validate ingredient names**:
   - Flag names < 3 characters (like "unit") for review
   - Flag names with multiple repetitions (like "lemon yields lemon")

**Expected impact**: Would fix 5 out of 6 failures (83%)

### Priority 2: Add Fallback Normalization ⭐⭐

**Action**: Create normalization rules in [`src/lib/nutrition/normalize.ts`](file:///c:/Dev/Recipe%20App/src/lib/nutrition/normalize.ts)

Even if parsing isn't perfect, the auto-mapper can apply cleanup rules:

```typescript
function cleanIngredientName(name: string): string {
  let cleaned = name;
  
  // Remove leading measurements
  cleaned = cleaned.replace(/^(\\d+\\s*)?(tbsps?|tsps?|cups?)\\s+/i, '');
  
  // Remove preparation phrases
  const prepPhrases = [
    'bone and skin removed',
    'cut into strips',
    'cut into',
    'divided',
    'yields'
  ];
  prepPhrases.forEach(phrase => {
    cleaned = cleaned.replace(new RegExp(phrase, 'gi'), '');
  });
  
  // Clean up extra whitespace
  cleaned = cleaned.replace(/\\s+/g, ' ').trim();
  
  return cleaned;
}
```

**Expected impact**: Catches parsing errors before they reach the mapper

### Priority 3: Monitor & Alert ⭐

**Action**: Add monitoring for suspicious ingredient names

1. Log warnings when:
   - Ingredient name contains measurement units
   - Name is < 3 characters
   - Name contains "yields", "divided", etc.

2. Create a weekly report of these warnings for manual review

3. Build up a library of known bad patterns to auto-fix

## Success Factors

Despite the 6 failures, the auto-mapper is performing excellently (97.9% success):

✅ **Global Ingredient Mappings** are working - reducing redundant API calls  
✅ **FatSecret + FDC Fallback** provides comprehensive coverage  
✅ **AI Serving Backfill** handles volume-based ingredients well  
✅ **Confidence thresholds** prevent low-quality matches from being saved  

The failures are **not mapping logic issues** - they are **input quality issues** from the ingredient parser.

## Next Steps

1. **Immediate** (today): Implement Priority 1 parser fixes
2. **Short-term** (this week): Add Priority 2 normalization rules  
3. **Ongoing**: Set up Priority 3 monitoring to catch regressions

After these fixes, we should expect **>99% mapping success rate** on clean recipe imports.

---

**Generated**: 2025-11-24  
**Analysis Scripts**:
- [`analyze-unmapped-ingredients.ts`](file:///c:/Dev/Recipe%20App/scripts/analyze-unmapped-ingredients.ts)
- [`deep-dive-unmapped.ts`](file:///c:/Dev/Recipe%20App/scripts/deep-dive-unmapped.ts)
