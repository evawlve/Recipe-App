import type { AiGeneratedFood } from '@prisma/client';
import { prisma } from '../db';

export interface CacheFoodOptions {
  client?: any;
  source?: string;
  legacyFoodId?: string;
  searchQuery?: string;
  allowNextBest?: boolean;
}

export interface CachedFoodResult {
  food: AiGeneratedFood;
  refreshed: boolean;
}

export function isCacheEntryFresh(entry: any): boolean {
  return false;
}

export async function getCachedFood(id: string) {
  if (!id) return null;
  return prisma.aiGeneratedFood.findUnique({
    where: { id },
    include: {
      servings: true,
    },
  });
}

export async function ensureFoodCached(
  id: string,
  options: CacheFoodOptions = {},
): Promise<CachedFoodResult | null> {
  if (!id) return null;
  const existing = await getCachedFood(id);
  if (existing) {
    return { food: existing, refreshed: false };
  }
  return null;
}

export async function upsertFoodFromApi(
  id: string,
  options: CacheFoodOptions = {},
): Promise<AiGeneratedFood | null> {
  return null;
}
