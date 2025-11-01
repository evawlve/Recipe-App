import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { batchFetchAliases, fetchAliasesForFood, clearAliasCache } from '../alias-cache';
import { prisma } from '@/lib/db';

// Mock Prisma
jest.mock('@/lib/db', () => ({
  prisma: {
    foodAlias: {
      findMany: jest.fn(),
    },
    food: {
      findMany: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('alias-cache', () => {
  beforeEach(() => {
    clearAliasCache();
    jest.clearAllMocks();
  });

  afterEach(() => {
    clearAliasCache();
  });

  describe('batchFetchAliases', () => {
    it('should fetch aliases for multiple foods', async () => {
      const mockAliases = [
        { foodId: 'food1', alias: 'chicken' },
        { foodId: 'food1', alias: 'poultry' },
        { foodId: 'food2', alias: 'beef' },
        { foodId: 'food2', alias: 'meat' },
      ];

      mockPrisma.foodAlias.findMany.mockResolvedValue(mockAliases as any);

      const result = await batchFetchAliases(['food1', 'food2']);

      expect(mockPrisma.foodAlias.findMany).toHaveBeenCalledWith({
        where: { foodId: { in: ['food1', 'food2'] } },
        select: { foodId: true, alias: true },
      });

      expect(result.get('food1')).toEqual(['chicken', 'poultry']);
      expect(result.get('food2')).toEqual(['beef', 'meat']);
    });

    it('should return empty array for foods without aliases', async () => {
      mockPrisma.foodAlias.findMany.mockResolvedValue([
        { foodId: 'food1', alias: 'chicken' },
      ] as any);

      const result = await batchFetchAliases(['food1', 'food2']);

      expect(result.get('food1')).toEqual(['chicken']);
      expect(result.get('food2')).toEqual([]);
    });

    it('should cache results and avoid duplicate queries', async () => {
      const mockAliases = [
        { foodId: 'food1', alias: 'chicken' },
      ];

      mockPrisma.foodAlias.findMany.mockResolvedValue(mockAliases as any);

      // First call - should query database
      const result1 = await batchFetchAliases(['food1']);
      expect(mockPrisma.foodAlias.findMany).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result2 = await batchFetchAliases(['food1']);
      expect(mockPrisma.foodAlias.findMany).toHaveBeenCalledTimes(1); // Still 1

      expect(result1.get('food1')).toEqual(['chicken']);
      expect(result2.get('food1')).toEqual(['chicken']);
    });

    it('should handle empty food list', async () => {
      const result = await batchFetchAliases([]);
      
      expect(mockPrisma.foodAlias.findMany).not.toHaveBeenCalled();
      expect(result.size).toBe(0);
    });

    it('should normalize cache key by sorting food IDs', async () => {
      const mockAliases = [
        { foodId: 'food1', alias: 'chicken' },
        { foodId: 'food2', alias: 'beef' },
      ];

      mockPrisma.foodAlias.findMany.mockResolvedValue(mockAliases as any);

      // First call with unsorted IDs
      await batchFetchAliases(['food2', 'food1']);
      expect(mockPrisma.foodAlias.findMany).toHaveBeenCalledTimes(1);

      // Second call with sorted IDs - should hit cache
      await batchFetchAliases(['food1', 'food2']);
      expect(mockPrisma.foodAlias.findMany).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  describe('fetchAliasesForFood', () => {
    it('should fetch aliases for a single food', async () => {
      const mockAliases = [
        { foodId: 'food1', alias: 'chicken' },
        { foodId: 'food1', alias: 'poultry' },
      ];

      mockPrisma.foodAlias.findMany.mockResolvedValue(mockAliases as any);

      const result = await fetchAliasesForFood('food1');

      expect(result).toEqual(['chicken', 'poultry']);
    });

    it('should return empty array for food without aliases', async () => {
      mockPrisma.foodAlias.findMany.mockResolvedValue([] as any);

      const result = await fetchAliasesForFood('food1');

      expect(result).toEqual([]);
    });
  });

  describe('clearAliasCache', () => {
    it('should clear the cache', async () => {
      const mockAliases = [
        { foodId: 'food1', alias: 'chicken' },
      ];

      mockPrisma.foodAlias.findMany.mockResolvedValue(mockAliases as any);

      // First call - queries database
      await batchFetchAliases(['food1']);
      expect(mockPrisma.foodAlias.findMany).toHaveBeenCalledTimes(1);

      // Clear cache
      clearAliasCache();

      // Second call - queries database again
      await batchFetchAliases(['food1']);
      expect(mockPrisma.foodAlias.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('cache expiration', () => {
    it('should expire cache entries after TTL', async () => {
      jest.useFakeTimers();

      const mockAliases = [
        { foodId: 'food1', alias: 'chicken' },
      ];

      mockPrisma.foodAlias.findMany.mockResolvedValue(mockAliases as any);

      // First call
      await batchFetchAliases(['food1']);
      expect(mockPrisma.foodAlias.findMany).toHaveBeenCalledTimes(1);

      // Advance time by 61 seconds (past 60s TTL)
      jest.advanceTimersByTime(61000);

      // Second call - should query again
      await batchFetchAliases(['food1']);
      expect(mockPrisma.foodAlias.findMany).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });
});

