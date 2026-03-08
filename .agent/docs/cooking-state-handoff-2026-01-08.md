# Cooking State Disambiguation Handoff - 2026-01-08

## Summary

Implemented cooking state disambiguation to ensure raw/cooked ingredients map to the correct nutritional data. Default behavior is to prefer **raw/dry** for all foods unless explicitly stated as cooked.

## Current Status

**Test Results:** 23 passed, 14 failed out of 37 test cases

### ✅ Working Cases
- Grains (quinoa, rice, pasta, oats) - correctly distinguish raw vs cooked
- Query cooking keywords detected: `cooked, prepared, boiled, steamed, roasted, grilled, baked, fried, sautéed, braised, stewed, broiled, poached, smoked, scrambled`

### ❌ Failing Cases (Data Availability Issue)
The filter correctly rejects non-cooked candidates, but FatSecret/FDC don't have cooked variants for:
- **Eggs**: "2 scrambled eggs" → only "Egg" available (no scrambled/fried/boiled variants)
- **Meats**: "grilled steak", "cooked ground beef" → only raw products
- **Vegetables**: "cooked spinach" → only "Spinach" available

## Investigation Needed

Run debug script on failing items to see what candidates are available:

```bash
# See what candidates exist for these items
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-mapping-issue.ts --ingredient "2 scrambled eggs"
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-mapping-issue.ts --ingredient "2 cups cooked spinach"
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-mapping-issue.ts --ingredient "8 oz grilled steak"
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-mapping-issue.ts --ingredient "1 lb cooked ground beef"
```

## Key Files Modified

### Core Logic
- **`src/lib/fatsecret/filter-candidates.ts`** - Cooking state filter implementation
  - `FOODS_WITH_COOKING_STATE` array (line ~235) - expanded to include meats, seafood, eggs, vegetables
  - `detectGrainCookingContext()` (line ~291) - detects cooking keywords in query
  - `isWrongCookingStateForGrain()` (line ~320) - rejects candidates with wrong cooking state

### Test Files
- **`scripts/test-cooking-state.ts`** - Targeted test script with 37 test cases

### Debug Scripts
- **`scripts/debug-mapping-issue.ts`** - Debug individual ingredient mappings

## Reference Documentation

- **[Debugging Quickstart](.agent/docs/debugging-quickstart.md)** - How to debug mapping issues
- **[Ingredient Mapping Pipeline](.agent/docs/ingredient-mapping-pipeline.md)** - Full pipeline documentation
- **[Previous Handoff](.agent/docs/mapping-issue-handoff-2026-01-08.md)** - Earlier session notes

## Options for Remaining Failures

1. **Strict (current)** - Return nothing if no cooked variant found
2. **Fallback to raw** - If no cooked variant, use raw with logging
3. **Manual overrides** - Add curated mappings for common cooked items

## Test Command

```bash
# Run all cooking state tests
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/test-cooking-state.ts
```
