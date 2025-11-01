# FoodAlias Batching Optimization

## Overview

This document describes the optimization implemented to eliminate N+1 queries when fetching food aliases during ingredient mapping and feed construction.

## Problem

Previously, the `autoMapIngredients` function in `src/lib/nutrition/auto-map.ts` performed a database query **for each ingredient** in a loop:

```typescript
for (const ingredient of ingredients) {
  // N+1 query - one query per ingredient!
  const matchingFoods = await prisma.food.findMany({
    where: {
      OR: [
        { name: { contains: ingredient.name, mode: 'insensitive' } },
        { name: { contains: ingredient.name.toLowerCase(), mode: 'insensitive' } }
      ]
    },
    take: 5
  });
  // ... match and map logic
}
```

For a recipe with 10 ingredients, this would result in:
- 1 query to fetch ingredients
- 10 queries to find matching foods (N+1 issue)
- Potentially more queries to fetch aliases if needed

## Solution

### 1. Batched Alias Cache (`src/lib/foods/alias-cache.ts`)

Created a new utility module that provides:

- **LRU Cache**: In-memory cache with 1-minute TTL to avoid redundant alias fetches across requests
- **Batched Queries**: Single query to fetch aliases for multiple foods at once
- **Map-based Lookup**: Returns `Map<foodId, alias[]>` for O(1) lookups

Key functions:
- `batchFetchAliases(foodIds: string[])` - Fetch aliases for multiple foods in one query
- `fetchAliasesForFood(foodId: string)` - Convenience wrapper for single food
- `batchFetchFoodsWithAliases(foodIds: string[])` - Fetch foods and aliases in parallel
- `clearAliasCache()` - Clear cache (useful for testing)

### 2. Refactored Auto-Mapping (`src/lib/nutrition/auto-map.ts`)

Optimized the ingredient mapping flow:

**Before:**
```typescript
for (const ingredient of ingredients) {
  const matchingFoods = await prisma.food.findMany({ /* ... */ }); // N queries
  // ... match logic
}
```

**After:**
```typescript
// 1. Batch query all potential matching foods at once
const searchConditions = unmappedIngredients.flatMap(ingredient => [
  { name: { contains: ingredient.name, mode: 'insensitive' } },
  // ...
]);

const allCandidateFoods = await prisma.food.findMany({
  where: { OR: searchConditions },
  take: unmappedIngredients.length * 10
});

// 2. Batch fetch aliases for all candidate foods
const aliasMap = await batchFetchAliases(foodIds);

// 3. Match ingredients against pre-fetched data (in-memory)
for (const ingredient of unmappedIngredients) {
  const matchingFoods = filterMatchingFoods(ingredient.name, foodsWithAliases);
  // ... match logic
}
```

## Performance Improvements

### Query Reduction

For a recipe with 10 ingredients:

**Before:**
- 1 query (fetch ingredients)
- 10 queries (find matching foods per ingredient)
- **Total: 11 queries**

**After:**
- 1 query (fetch ingredients)
- 1 query (fetch all matching foods)
- 1 query (batch fetch aliases)
- **Total: 3 queries**

**Improvement: ~73% reduction in database queries**

### Cache Benefits

With the 1-minute LRU cache:
- Repeated requests for the same foods within 1 minute hit the cache
- Reduces database load during peak usage
- Particularly beneficial for common ingredients used across multiple recipes

## Usage Examples

### Batch Fetch Aliases

```typescript
import { batchFetchAliases } from '@/lib/foods/alias-cache';

// Fetch aliases for multiple foods
const foodIds = ['food1', 'food2', 'food3'];
const aliasMap = await batchFetchAliases(foodIds);

// Lookup aliases for a specific food
const aliases = aliasMap.get('food1'); // string[]
```

### Fetch Foods with Aliases

```typescript
import { batchFetchFoodsWithAliases } from '@/lib/foods/alias-cache';

// Fetch foods and their aliases in parallel
const foods = await batchFetchFoodsWithAliases(['food1', 'food2']);

// Each food has aliases attached
foods.forEach(food => {
  console.log(food.name, food.aliases);
});
```

### Clear Cache (Testing)

```typescript
import { clearAliasCache } from '@/lib/foods/alias-cache';

// Clear the cache (useful in tests or after bulk updates)
clearAliasCache();
```

## Implementation Notes

### When to Use Batched Queries

✅ **Use batched queries when:**
- Fetching aliases for multiple foods in a loop
- Processing multiple ingredients that need food matching
- Building feeds or lists that require alias data

✅ **Already optimized (no changes needed):**
- Single food queries using Prisma's `include: { aliases: true }`
- Food search endpoint (uses Prisma's JOIN optimization)

### Cache Strategy

The LRU cache uses a simple eviction strategy:
- **Size limit**: 100 entries (configurable)
- **TTL**: 60 seconds (1 minute)
- **Key format**: `"foodIds:id1,id2,id3"` (sorted)

This provides a good balance between:
- Memory usage (limited cache size)
- Freshness (1-minute TTL ensures relatively up-to-date data)
- Performance (avoids repeated queries within short time windows)

### Database Indexes

The following indexes support efficient alias lookups (see `prisma/migrations/20251101024941_add_foodalias_indexes/`):

```prisma
model FoodAlias {
  // ...
  @@index([foodId])  // For batch queries: WHERE foodId IN (...)
  @@index([alias])   // For alias searches
  @@unique([foodId, alias])  // Prevents duplicates
}
```

## Testing Considerations

When testing, remember to:
1. Clear the cache between tests: `clearAliasCache()`
2. Test with various batch sizes
3. Verify cache behavior (hits/misses)
4. Test TTL expiration

## Future Improvements

Potential enhancements:
1. Add cache metrics (hit rate, eviction count)
2. Make cache size and TTL configurable via environment variables
3. Consider Redis for distributed caching in multi-instance deployments
4. Add cache warming for frequently used foods

## Related Files

- `src/lib/foods/alias-cache.ts` - Batching utility and cache
- `src/lib/nutrition/auto-map.ts` - Auto-mapping with batched queries
- `prisma/schema.prisma` - FoodAlias model definition
- `prisma/migrations/20251101024941_add_foodalias_indexes/` - Database indexes

