# Density Resolution Strategy

## Problem
Not all foods have explicit `densityGml` values, especially when importing from USDA API. We need a strategy to handle volume-to-grams conversions when density is unknown.

## Solution: Multi-Tier Approach

### Tier 1: Known Density (Best)
- Food has explicit `densityGml` in database
- **Accuracy**: High
- **User Alert**: None needed

### Tier 2: Calculated from FoodUnits (Good)
- Calculate density from existing volume-based FoodUnits
- Example: "1 cup = 240g" → density = 240g / 240ml = 1.0 g/ml
- **Accuracy**: High (if FoodUnit is accurate)
- **User Alert**: "Volume conversion calculated from serving size data"
- **Script**: `scripts/calculate-missing-density.ts`

### Tier 3: Category-Based Defaults (Fair)
- Use category-specific density estimates
- Examples:
  - `dairy`: 1.03 g/ml (milk, yogurt)
  - `protein`: 1.05 g/ml (cooked meats)
  - `vegetable`: 0.95 g/ml
  - `fruit`: 0.95 g/ml
- **Accuracy**: Moderate (reasonable estimates)
- **User Alert**: "Volume conversion estimated based on [category] category"
- **File**: `src/lib/units/density.ts`

### Tier 4: Generic Fallback (Last Resort)
- Use 1.0 g/ml (water density)
- **Accuracy**: Low (may be inaccurate)
- **User Alert**: "Volume conversion using generic estimate (may be inaccurate)"

### Tier 5: Cannot Convert (User Action Required)
- No density available, no category match
- **User Alert**: "Cannot convert volume to grams - density unknown"
- **UI**: Show manual serving selection

## Implementation

### Current Status
✅ Tier 1: Implemented (explicit densityGml)
✅ Tier 2: Implemented (calculate from FoodUnits)
✅ Tier 3: Implemented (category defaults)
✅ Tier 4: Implemented (1.0 g/ml fallback)
✅ Tier 5: Implemented (returns null, UI handles)

### Future: Optional OpenAI Integration
For foods without density, we could optionally use OpenAI to estimate:
- **When**: User opts in, or admin-triggered batch job
- **Input**: Food name, category, nutrition data
- **Output**: Estimated densityGml
- **Storage**: Save to database so we don't need to call again
- **Cost**: Only call once per food, then cache

**Example Prompt**:
```
Estimate the density (g/ml) for: "Greek Yogurt, 2% fat"
Category: dairy
Nutrition per 100g: 59 kcal, 10g protein, 4g carbs, 1.5g fat

Return only a number (e.g., 1.03) representing grams per milliliter.
```

## User Experience

### When Conversion Works
- Show resolved grams
- Optionally show density source (if estimated)
- Allow user to override if needed

### When Conversion Fails
- Show: "Cannot convert [volume] to grams - density unknown"
- Provide serving size dropdown
- Allow manual gram entry
- Optionally: "Request density calculation" button (future OpenAI integration)

## Files Modified
- `src/lib/units/density.ts` - Enhanced with category defaults and metadata
- `src/lib/units/servings.ts` - Uses `resolveDensityGml`
- `src/lib/nutrition/resolve-grams.ts` - Handles volume unit matching
- `scripts/calculate-missing-density.ts` - Calculates density from FoodUnits

## Next Steps
1. ✅ Enhanced category defaults
2. ⏳ Add UI alerts for estimated density (in IngredientMappingCard)
3. ⏳ Optional: OpenAI integration for missing densities
4. ⏳ Batch job to calculate densities for all foods missing it




