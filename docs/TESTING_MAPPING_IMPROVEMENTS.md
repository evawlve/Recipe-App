# Testing Mapping Improvements Guide

This guide covers how to test the ingredient mapping improvements, including unit tests, recipe imports, and coverage reports.

## Running Unit Tests

### Run the Specific Chicken Sausage Test

```bash
# Using npm (recommended)
npm test -- src/lib/fatsecret/__tests__/map-ingredient.test.ts -t "chicken sausage"

# Using npx (alternative)
npx jest src/lib/fatsecret/__tests__/map-ingredient.test.ts -t "chicken sausage"

# Run all map-ingredient tests
npm test -- src/lib/fatsecret/__tests__/map-ingredient.test.ts

# Run in watch mode (auto-reruns on file changes)
npm test -- --watch src/lib/fatsecret/__tests__/map-ingredient.test.ts
```

### Run All FatSecret Mapping Tests

```bash
npm test -- src/lib/fatsecret
```

### Run All Tests

```bash
npm test
```

## Testing with Real Recipes

### 1. Import Recipes from FatSecret

The recipe import script automatically imports recipes and runs auto-mapping:

```bash
# Basic usage
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-recipe-import.ts \
  --query="chicken soup" \
  --max-results=5 \
  --author-id="YOUR_USER_ID"

# Options:
# --query: Search query for FatSecret recipes
# --max-results: Number of recipes to import (default: 3)
# --author-id: Your user ID (required for recipe ownership)
# --dump: Optional path to dump recipe JSON before import (for debugging)

# Example: Import chicken recipes
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-recipe-import.ts \
  --query="chicken sausage" \
  --max-results=10 \
  --author-id="your-user-id-here"

# Example: Import and dump to file for inspection
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-recipe-import.ts \
  --query="chicken soup" \
  --max-results=5 \
  --author-id="your-user-id-here" \
  --dump=./data/fatsecret/recipes-dump.json
```

**What it does:**
- Searches FatSecret recipes API
- Creates recipe records in your database
- Parses ingredients from recipe
- **Automatically runs `autoMapIngredients()`** to map all ingredients
- Logs results for each recipe

### 2. Check Auto-Mapping Results

After importing recipes, check the logs for:
- How many ingredients were mapped
- Which ingredients failed to map (confidence too low)
- Any errors during mapping

### 3. Run Coverage Report

Generate a report showing mapping coverage:

```bash
# Basic usage (prints to console)
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-coverage-report.ts

# Save to file
npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-coverage-report.ts \
  --output=./data/fatsecret/ingredient_map_coverage.txt

# Or using the npm script (if available)
npm run fatsecret:coverage-report
```

**What the report shows:**
- Total `IngredientFoodMap` rows
- How many are mapped with FatSecret IDs
- How many are mapped with legacy food IDs
- Coverage percentage (FatSecret vs legacy)
- Unmapped ingredient count

## Manual Testing Checklist

### Test Cases to Verify

1. **Chicken Sausage → Chicken Sausage (not pork)**
   ```bash
   # Import a recipe with chicken sausage
   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-recipe-import.ts \
     --query="chicken sausage" \
     --max-results=3 \
     --author-id="your-user-id"
   ```
   - Check that "chicken sausage" ingredients map to chicken sausage foods
   - Verify confidence > 0.7
   - Confirm no pork/Italian sausage mappings

2. **Meat Type Mismatches**
   - Test: "chicken breast" should NOT map to "pork chop"
   - Test: "beef steak" should NOT map to "chicken breast"
   - Test: "turkey sausage" should NOT map to "pork sausage"

3. **Canned vs Fresh**
   - Test: "canned tomatoes" should map to canned, not fresh
   - Test: "fresh tomatoes" should map to fresh, not canned

4. **Cooked vs Raw**
   - Test: "raw chicken" should map to raw, not cooked
   - Test: "cooked chicken" should map to cooked, not raw

5. **Ambiguous Queries (AI Rerank)**
   - Test: "sausage" (without meat type) - should use AI rerank
   - Test: "oil" (without type) - should use AI rerank
   - Check logs for `fatsecret.map.ai_rerank_used` entries

6. **Weighted Token Matching**
   - Test: "chicken sausage" - "chicken" should be weighted higher than "sausage"
   - Test: "olive oil" - "olive" should be weighted higher than "oil"

## Monitoring & Debugging

### Check Logs for Mismatches

The new logging will show when mismatches are detected:

```bash
# Look for these log entries:
# - fatsecret.map.meat_mismatch
# - fatsecret.map.chicken_sausage_mismatch
# - fatsecret.map.cook_state_conflict
# - fatsecret.map.ai_rerank_used
```

### Query Database for Mapping Results

```sql
-- Check recent mappings
SELECT 
  i.name as ingredient_name,
  i.qty,
  i.unit,
  m."fatsecretFoodId",
  m."fatsecretServingId",
  m."fatsecretGrams",
  m."fatsecretConfidence",
  m."useOnce"
FROM "Ingredient" i
LEFT JOIN "IngredientFoodMap" m ON i.id = m."ingredientId"
WHERE i."recipeId" IN (
  SELECT id FROM "Recipe" 
  WHERE "createdAt" > NOW() - INTERVAL '1 hour'
  ORDER BY "createdAt" DESC
  LIMIT 10
)
ORDER BY i."recipeId", i."createdAt";

-- Check unmapped ingredients
SELECT 
  i.name,
  i.qty,
  i.unit,
  r.title as recipe_title
FROM "Ingredient" i
JOIN "Recipe" r ON i."recipeId" = r.id
LEFT JOIN "IngredientFoodMap" m ON i.id = m."ingredientId" AND m."fatsecretFoodId" IS NOT NULL
WHERE m.id IS NULL
ORDER BY r."createdAt" DESC
LIMIT 50;
```

## Expected Improvements

After these changes, you should see:

1. **Better Meat Type Matching**
   - "chicken sausage" → chicken sausage (not pork)
   - Confidence scores > 0.7 for correct matches
   - Multiplicative penalties prevent wrong matches

2. **Improved Ambiguous Query Handling**
   - AI rerank used more frequently for ambiguous queries
   - Better results for queries like "sausage" without meat type

3. **Better Token Weighting**
   - Distinctive words (chicken, olive) prioritized over common words (sausage, oil)
   - More accurate matches for compound ingredients

4. **Better Coverage**
   - More ingredients mapped successfully
   - Higher confidence scores overall
   - Fewer false positives

## Next Steps After Testing

1. **Review Coverage Report**
   - Check if coverage improved
   - Identify remaining unmapped ingredients
   - Look for patterns in failures

2. **Check Logs for Patterns**
   - Review mismatch logs
   - Identify common failure cases
   - Consider adding more heuristics if needed

3. **Test Edge Cases**
   - Try unusual ingredient names
   - Test with different cuisines
   - Test with brand names

4. **Monitor Production**
   - Watch for user-reported mapping issues
   - Track confidence scores over time
   - Adjust thresholds if needed

## Troubleshooting

### Tests Fail

```bash
# Run with verbose output
npm test -- --verbose src/lib/fatsecret/__tests__/map-ingredient.test.ts

# Run specific test
npm test -- -t "maps chicken sausage"
```

### Recipe Import Fails

- Check that `FATSECRET_CLIENT_ID` and `FATSECRET_CLIENT_SECRET` are set in `.env`
- Verify database connection
- Check that user ID exists in database

### Low Coverage

- Check that FatSecret cache is populated (`npm run fatsecret:cache:verify`)
- Review unmapped ingredients for patterns
- Consider lowering `FATSECRET_MIN_CONFIDENCE` threshold (not recommended)
- Check logs for common failure reasons

