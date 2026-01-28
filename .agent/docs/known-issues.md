# Known Issues & Fixes

> **Purpose**: Document bugs encountered and fixed so future agents don't repeat mistakes.
> 
> **How to use**: When you fix a bug, add it here with the symptom, root cause, and solution.

---

## Table of Contents
1. [Database Issues](#database-issues)
2. [Ingredient Mapping Pipeline](#ingredient-mapping-pipeline)
3. [Parsing & Normalization](#parsing--normalization)
4. [API & Caching](#api--caching)
5. [Script Execution](#script-execution)

---

## Database Issues

### FDC vs FatSecret Foreign Key Mismatch

**Date**: Dec 2025  
**Symptom**: Foreign key constraint error when creating `FdcServingCache` entries  
**Root Cause**: FDC uses integer IDs (`Int`), FatSecret uses string IDs (`String`). Code was passing wrong type.

**Fix**: Always check the schema before creating cache entries:
```typescript
// FDC: Integer ID
await prisma.fdcServingCache.create({ data: { fdcId: 12345, ... } })

// FatSecret: String ID
await prisma.fatSecretServingCache.create({ data: { foodId: "abc123", ... } })
```

**Files**: `src/lib/fatsecret/ai-backfill.ts`

---

## Ingredient Mapping Pipeline

### hasSuspiciousMacros() Never Called

**Date**: Jan 2026  
**Symptom**: Products with obviously wrong macros (e.g., 350 kcal strawberries) were being selected  
**Root Cause**: The `hasSuspiciousMacros()` function was defined but never actually called in the filter pipeline

**Fix**: Added call to `hasSuspiciousMacros()` in `filterCandidatesByTokens()` function

**Files**: `src/lib/fatsecret/filter-candidates.ts`

---

### Modifier Stripping Broke "Unsweetened" Products

**Date**: Jan 2026  
**Symptom**: "unsweetened coconut milk" mapped to "Coconut Cream (230 kcal)" instead of low-calorie coconut milk  
**Root Cause**: AI normalization was stripping "unsweetened" modifier

**Fix**: Added to preserved modifiers in AI system prompt:
- `unsweetened`, `sweetened`, `no sugar added`

**Files**: `src/lib/fatsecret/ai-normalize.ts`

---

### Brand Penalty Too Aggressive

**Date**: Jan 2026  
**Symptom**: Good branded products like "Silk Unsweetened Coconut Milk" were penalized in favor of wrong generic matches  
**Root Cause**: `SIMPLE_INGREDIENT_BRAND_PENALTY` was 0.3 (too high)

**Fix**: 
- Reduced penalty from 0.3 → 0.1
- Added logic: only penalize brands that don't have full query token coverage

**Files**: `src/lib/fatsecret/simple-rerank.ts`

---

### Token Scoring Too Permissive - Category-Changing Tokens

**Date**: Jan 2026  
**Symptom**: "1 bunch spinach" was mapping to "Spinach Noodles" because it had perfect token overlap on "spinach"  
**Root Cause**: Weak initial token scoring—API ranking was trusted too heavily (0.6 weight), and extra tokens like "noodles" weren't penalized enough

**Fix**: 
1. Rebalanced scoring weights:
   - `EXACT_MATCH`: 0.10 → 0.30 (reward precise matches)
   - `ORIGINAL_SCORE`: 0.60 → 0.45 (don't blindly trust API)
   - `EXTRA_TOKEN_PENALTY`: 0.25 → 0.35 (penalize unrelated words harder)
   - `TOKEN_BLOAT_PENALTY`: 0.10 → 0.15 per excess token

2. Added `CATEGORY_CHANGING_TOKENS` detection:
   - Heavy penalty (0.50) when candidate has tokens like "noodles", "pasta", "pie", "cake", etc. that completely transform the food category
   - e.g., "spinach" → "Spinach Noodles" now gets -0.50 penalty

3. Added `BENIGN_DESCRIPTOR_TOKENS` set:
   - Descriptors like "baby", "water", "fresh", "creamed" get reduced penalty (25% of full)
   - This allows "Water Spinach" and "Baby Spinach" to score well for "spinach" queries

4. Stricter token bloat threshold:
   - Was: Allow +2 extra tokens with no penalty
   - Now: Allow only +1 extra token with no penalty

**Files**: `src/lib/fatsecret/simple-rerank.ts`

**Test Cases**:
```bash
# Should map to spinach varieties (NOT noodles)
"1 bunch spinach" → "Water Spinach" ✓

# Should map to zucchini (NOT bone marrow)  
"4 medium baby marrows" → "Baby Zucchini" ✓

# Should map to bouillon (NOT vegetable)
"2 cube vegetable bouillon" → "Vegetable Bouillon" ✓
```

---

## Parsing & Normalization

### Prep Phrase Stripped Inside Words

**Date**: Jan 2026  
**Symptom**: "strawberries" was being modified because "raw" matched inside the word  
**Root Cause**: Regex for "raw" didn't use word boundaries

**Fix**: Use `\b` word boundaries for all prep phrase patterns:
```typescript
// Wrong
/raw/gi

// Correct
/\braw\b/gi
```

**Files**: `src/lib/fatsecret/normalization-rules.ts`

---

### Hyphenated Phrases Not Matching

**Date**: Jan 2026  
**Symptom**: "hard boiled eggs" and "hard-boiled eggs" treated differently  
**Root Cause**: Pattern only matched one variant

**Fix**: Use optional hyphen/space pattern:
```typescript
/hard[-\s]?boiled/gi
```

**Files**: `data/fatsecret/normalization-rules.json`

---

### Longer Patterns Not Matched First

**Date**: Jan 2026  
**Symptom**: "hard-boiled" was stripped to "hard-" because "boiled" was matched first  
**Root Cause**: Short patterns processed before long patterns

**Fix**: Sort patterns by length (descending) before applying:
```typescript
const sorted = patterns.sort((a, b) => b.length - a.length);
```

**Files**: `src/lib/fatsecret/normalization-rules.ts`

---

## API & Caching

### Stale ValidatedMapping Cache

**Date**: Jan 2026  
**Symptom**: Debug script shows correct mapping, but batch import still fails  
**Root Cause**: Old `ValidatedMapping` entry returning stale cached result

**Fix**: Clear mappings before testing:
```bash
npx ts-node scripts/clear-all-mappings.ts
```

**Files**: `scripts/clear-all-mappings.ts`

---

### Cache Keys Saved with Raw Input Instead of Canonical Form

**Date**: Jan 2026  
**Symptom**: Same ingredient maps correctly first time, but future queries fail to find cached entry  
**Root Cause**: When `shouldNormalizeLlm()` decides to skip the AI call (because a high-confidence match exists), `aiCanonicalBase` remains `undefined`. The save then falls back to `normalizeQuery(rawInput)` which does minimal cleaning, resulting in cache keys like `"0 311625 cup ground golden flaxseed meal"` instead of `"golden flaxseed meal"`.

**How it happened**:
1. Input: `"0.311625 cup ground golden flaxseed meal"`
2. Normalize gate sees high confidence match → skips LLM call
3. `aiCanonicalBase` stays `undefined`
4. Save uses `normalizeQuery(rawInput)` → `"0 311625 cup ground golden flaxseed meal"` (bad!)
5. Future query for `"golden flaxseed meal"` can't find cache entry

**Fix**: 
1. When saving to cache, use `aiCanonicalBase || normalizedName` where `normalizedName` is from `normalizeIngredientName()` 
2. This ensures cache keys are always canonical forms like `"golden flaxseed meal"`
3. Applied fix to BOTH:
   - `map-ingredient-with-fallback.ts` (new function)
   - `map-ingredient.ts` (old function still used by `resolve-ingredient.ts`)

**Files**: 
- `src/lib/fatsecret/map-ingredient-with-fallback.ts` (lines 1240-1250, 1285)
- `src/lib/fatsecret/map-ingredient.ts` (line 1369)

---

### Cached Mappings Missing Core Tokens

**Date**: Jan 2026  
**Symptom**: "vegetable bouillon" returns "Raw Vegetable" from cache, "golden flaxseed" returns "Golden Delicious Apples"  
**Root Cause**: Old cache entries from before scoring improvements were not being validated. Cache validation only checked category/modifier mismatches, not whether core ingredient tokens were actually present in the cached food name.

**Examples**:
- `"vegetable bouillon"` → `"Raw Vegetable"` (missing "bouillon")
- `"golden flaxseed"` → `"Golden Delicious Apples"` (missing "flaxseed")
- `"baby marrows"` → `"Pickled Zucchini"` (should be "Baby Zucchini")

**Fix**: 
1. Added `hasCoreTokenMismatch()` function in `filter-candidates.ts`
2. Validates that core ingredient tokens (50+ proteins, grains, produce, seasonings) exist in cached food name
3. Uses synonym mapping (e.g., "marrows" → "zucchini", "flaxseed" → "flax")
4. Applied to ALL cache lookup paths in both mapping functions

**Files**: 
- `src/lib/fatsecret/filter-candidates.ts` (added `CORE_FOOD_TOKENS`, `CORE_TOKEN_SYNONYMS`, `hasCoreTokenMismatch()`)
- `src/lib/fatsecret/map-ingredient-with-fallback.ts` (6+ cache lookup points)
- `src/lib/fatsecret/validated-mapping-helpers.ts`

---

### Ambiguous Units (container, scoop, etc.)

**Date**: Jan 2026  
**Symptom**: "1 container low fat yogurt" failed with no serving found  
**Root Cause**: "container" is ambiguous—could be 150g or 500g depending on product

**Fix**: 
1. Created `AMBIGUOUS_UNITS` set
2. Added AI estimation fallback
3. Cache estimates in `PortionOverride` table

**Files**: 
- `src/lib/ai/ambiguous-serving-estimator.ts`
- `src/lib/fatsecret/ambiguous-unit-backfill.ts`

---

## Script Execution

### Module Resolution Error in Scripts

**Date**: Dec 2025  
**Symptom**: `Cannot find module '@/lib/...'` when running scripts  
**Root Cause**: Using wrong tsconfig—main config uses "Bundler" resolution, scripts need "node"

**Fix**: Always use `tsconfig.scripts.json` for scripts:
```bash
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/your-script.ts
```

**Files**: `tsconfig.scripts.json`

---

## Adding New Issues

When you fix a bug, add it here using this template:

```markdown
### [Short Title]

**Date**: [Month Year]  
**Symptom**: [What went wrong from user perspective]  
**Root Cause**: [Technical reason it failed]

**Fix**: [What you changed]

**Files**: [Affected files]
```

---

## See Also

- [Debugging Quickstart](./debugging-quickstart.md) - Step-by-step debugging workflow
- [Ingredient Mapping Pipeline](./ingredient-mapping-pipeline.md) - Full system documentation
