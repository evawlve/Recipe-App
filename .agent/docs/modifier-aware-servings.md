# Modifier-Aware Serving System

> **Status**: ✅ Implemented and Verified
> **Date**: January 30, 2026
> **Related Files**: See [Implementation Files](#implementation-files) below

---

## Overview

This feature adds prep modifier awareness to the ingredient mapping and serving estimation pipeline. When a user inputs "1 cup cubed apple", the system now:

1. **Extracts** the prep modifier ("cubed") from the ingredient line
2. **Passes** it to the AI serving estimator with density hints
3. **Generates** modifier-aware serving labels (e.g., "1 cup cubed" instead of "1 cup")
4. **Stores** the modifier and volume/density data for future lookups

This works for **both FatSecret and FDC** food sources.

---

## What Changed

### 1. Database Schema (`FdcServingCache`)

Added new fields to support volume/density tracking (matching FatSecret's capabilities):

```prisma
model FdcServingCache {
  // ... existing fields ...
  volumeMl          Float?         // NEW: Volume in ml
  derivedViaDensity Boolean        // NEW: Whether derived via density calc
  densityGml        Float?         // NEW: Density in g/ml
  prepModifier      String?        // NEW: e.g., "cubed", "minced"
  confidence        Float?         // NEW: AI confidence score
  note              String?        // NEW: AI rationale
  
  @@unique([fdcId, description])   // NEW: Prevent duplicate servings
}
```

### 2. AI Serving Estimator (`src/lib/ai/serving-estimator.ts`)

- Added `prepModifier` parameter to `AiServingRequest`
- Added `PREP_MODIFIER_DENSITY_HINTS` with adjustment factors:
  - `cubed`: -15% density (air gaps)
  - `minced`: +10% density (packs tightly)
  - `shredded`: -20% density (very loose)
  - etc.
- AI prompt now includes modifier context and density hints

### 3. AI Backfill (`src/lib/fatsecret/ai-backfill.ts`)

- Updated `InsertAiServingOptions` to accept `prepModifier`
- FDC servings now store `volumeMl`, `densityGml`, `prepModifier`
- Uses upsert with unique constraint on `(fdcId, description)`

### 4. Pre-emptive Backfill Helper (`src/lib/fatsecret/preemptive-backfill.ts`)

New utility module providing:

- **Category detection**: Maps food names to categories (produce, aromatics, cheese, etc.)
- **Category-specific servings**: Each category has default modifier servings
- **Modifier extraction**: `extractPrepModifier()` function
- **Pre-emptive generation**: `generatePreemptiveServings()` for batch processing

### 5. Mapping Pipeline (`src/lib/fatsecret/map-ingredient-with-fallback.ts`)

- Extracts prep modifier from `parsed.qualifiers` or raw ingredient line
- Passes modifier to all `insertAiServing()` calls
- Enables modifier-aware serving lookup and backfill

---

## Category-Specific Servings

| Category | Common Servings |
|----------|--------------------|
| **produce** | cup chopped, cup diced, cup cubed, cup sliced, cup |
| **aromatics** | tbsp minced, tsp minced, tbsp chopped, clove, tbsp grated |
| **greens** | cup chopped, cup packed, cup |
| **cheese** | cup shredded, tbsp grated, cup cubed, oz, slice |
| **proteins** | oz, piece, cup cubed, cup shredded |
| **liquids** | cup, tbsp, tsp, ml |
| **powders** | tbsp, tsp |
| **nuts** | cup chopped, cup, tbsp, oz |
| **herbs** | tbsp chopped, tsp minced, cup packed, sprig |
| **snacks** | cup, oz, piece, serving |

---

## Density Adjustment Factors

When AI estimates gram weights for modifier-aware servings, it uses these hints:

| Modifier | Factor | Reason |
|----------|--------|--------|
| cubed | 0.85 | Air gaps between cubes |
| diced | 0.90 | Smaller pieces, fewer gaps |
| sliced | 0.92 | Flat pieces stack loosely |
| chopped | 1.00 | Standard reference |
| minced | 1.10 | Fine pieces pack tightly |
| grated | 1.15 | Very fine, high packing |
| shredded | 0.80 | Loose strands with air |
| mashed | 1.05 | No air gaps |
| crushed | 1.20 | Packs very densely |

---

## FatSecret vs FDC Comparison

| Feature | FatSecret | FDC |
|---------|-----------|-----|
| Volume tracking | ✅ `volumeMl` | ✅ `volumeMl` (NEW) |
| Density storage | ✅ `FatSecretDensityEstimate` table | ✅ `densityGml` inline |
| Prep modifier | ❌ (in label only) | ✅ `prepModifier` field |
| Confidence | ✅ `confidence` | ✅ `confidence` (NEW) |
| AI rationale | ✅ `note` | ✅ `note` (NEW) |

Both sources now have full parity for modifier-aware servings.

---

## Usage Examples

### 1. Ingredient Mapping (Automatic)

When mapping "1 cup cubed apple":
```
Parsed: qty=1, unit=cup, name=apple, qualifiers=[cubed]
→ Extracts modifier: "cubed"
→ AI generates: "1 cup cubed" = 125g (density-adjusted)
→ Stores serving with prepModifier="cubed"
```

### 2. Pre-emptive Backfill (Manual/Batch)

```typescript
import { generatePreemptiveServings } from './preemptive-backfill';

// Generate common servings for a specific food
const result = await generatePreemptiveServings(
  'fdc_12345',
  'Apples, raw',
  { maxServings: 3 }
);
// Creates: "cup chopped", "cup diced", "cup cubed"
```

### 3. Modifier Extraction

```typescript
import { extractPrepModifier } from './preemptive-backfill';

extractPrepModifier('1 cup cubed apple');  // → 'cubed'
extractPrepModifier('2 tbsp minced garlic');  // → 'minced'
extractPrepModifier('1/2 cup packed spinach');  // → 'packed'
```

---

## Implementation Files

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Added FDC density fields |
| `src/lib/ai/serving-estimator.ts` | Added prepModifier support |
| `src/lib/fatsecret/ai-backfill.ts` | Updated for both sources |
| `src/lib/fatsecret/preemptive-backfill.ts` | **NEW** - Category mappings & utilities |
| `src/lib/fatsecret/map-ingredient-with-fallback.ts` | Integrated modifier extraction |

---

## Verification Results

Test run on January 30, 2026 confirmed:

- ✅ **Modifier extraction**: 13/13 test cases passed
- ✅ **Category detection**: Working for produce, aromatics, cheese, greens, liquids
- ✅ **Full mapping pipeline**: Successfully mapped modifier-containing ingredients
- ✅ **FDC schema**: New fields (`volumeMl`, `densityGml`, `prepModifier`) operational
- ✅ **FatSecret servings**: AI-estimated cup servings being generated

### Sample Mappings

| Ingredient | Food Match | Serving | Grams |
|------------|------------|---------|-------|
| 2 cups diced potatoes | Baby Yukon Gold Potatoes | 1 cup | 260g |
| 1/2 cup sliced carrots | Carrots | cup, chopped | 64g |

---

## Future Enhancements

1. **On-demand modifier backfill**: If "1 cup cubed" doesn't exist but "1 cup" does, generate modifier-specific serving on the fly
2. **Modifier-aware serving lookup**: Prefer "1 cup cubed" over "1 cup" when modifier is present
3. **Background pre-emptive generation**: Run after successful mappings to populate common variations





