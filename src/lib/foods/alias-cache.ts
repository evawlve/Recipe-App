import { prisma } from '@/lib/db';

/**
 * Simple LRU Cache implementation for food aliases
 */
class LRUCache<K, V> {
  private cache = new Map<K, { value: V; expiry: number }>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number = 1000, ttlMs: number = 60000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    // Check if expired
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }
    
    // Move to end (mark as recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // Remove if exists (to update position)
    this.cache.delete(key);
    
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    
    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttlMs
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

// Cache key format: "foodIds:id1,id2,id3" (sorted)
const aliasCache = new LRUCache<string, Map<string, string[]>>(100, 60000); // 1 min TTL

/**
 * Batch fetch food aliases for multiple foodIds
 * Returns a Map<foodId, alias[]> for efficient lookups
 * 
 * @param foodIds - Array of food IDs to fetch aliases for
 * @returns Map of foodId to array of alias strings
 */
export async function batchFetchAliases(foodIds: string[]): Promise<Map<string, string[]>> {
  if (foodIds.length === 0) {
    return new Map();
  }

  // Create cache key from sorted foodIds
  const sortedIds = [...foodIds].sort();
  const cacheKey = `foodIds:${sortedIds.join(',')}`;
  
  // Check cache first
  const cached = aliasCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Query all aliases in one batch
  const aliases = await prisma.foodAlias.findMany({
    where: { 
      foodId: { in: foodIds } 
    },
    select: {
      foodId: true,
      alias: true
    }
  });

  // Convert to Map<foodId, alias[]>
  const aliasMap = new Map<string, string[]>();
  
  for (const { foodId, alias } of aliases) {
    const existing = aliasMap.get(foodId) || [];
    existing.push(alias);
    aliasMap.set(foodId, existing);
  }

  // Ensure all foodIds have an entry (even if empty)
  for (const foodId of foodIds) {
    if (!aliasMap.has(foodId)) {
      aliasMap.set(foodId, []);
    }
  }

  // Cache the result
  aliasCache.set(cacheKey, aliasMap);

  return aliasMap;
}

/**
 * Fetch aliases for a single food (uses batched implementation)
 * 
 * @param foodId - Single food ID
 * @returns Array of alias strings
 */
export async function fetchAliasesForFood(foodId: string): Promise<string[]> {
  const aliasMap = await batchFetchAliases([foodId]);
  return aliasMap.get(foodId) || [];
}

/**
 * Clear the alias cache (useful for testing or after bulk updates)
 */
export function clearAliasCache(): void {
  aliasCache.clear();
}

/**
 * Batch fetch foods with their aliases included
 * More efficient than Prisma's include when you need to query many foods
 * 
 * @param foodIds - Array of food IDs
 * @returns Array of foods with aliases attached
 */
export async function batchFetchFoodsWithAliases(foodIds: string[]) {
  if (foodIds.length === 0) {
    return [];
  }

  // Fetch foods and aliases in parallel
  const [foods, aliasMap] = await Promise.all([
    prisma.food.findMany({
      where: { id: { in: foodIds } },
      include: {
        units: true,
        barcodes: true
      }
    }),
    batchFetchAliases(foodIds)
  ]);

  // Attach aliases to foods
  return foods.map(food => ({
    ...food,
    aliases: (aliasMap.get(food.id) || []).map(alias => ({ alias, foodId: food.id }))
  }));
}

