import { NextRequest, NextResponse } from 'next/server';
// Sentry disabled - can be re-enabled in the future
// import * as Sentry from '@sentry/nextjs';
import { withSpan } from '@/lib/obs/withSpan';
import { capture } from '@/lib/obs/capture';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Search foods by name or brand from local database only
 * GET /api/foods/search?s=...
 * 
 * Returns foods with servingOptions derived from units + density/category
 */


export async function GET(req: NextRequest) {
  // Sentry disabled
  // Sentry.setTag('endpoint', 'foods-search');
  // Skip execution during build time
  if (process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
    process.env.BUILD_TIME === 'true') {
    return NextResponse.json({ error: "Not available during build" }, { status: 503 });
  }

  // Import only when not in build mode
  const { prisma } = await import("@/lib/db");
  const { getCurrentUser } = await import("@/lib/auth");
  const { deriveServingOptions } = await import("@/lib/units/servings");
  const { logger } = await import("@/lib/logger");
  const { rankCandidates } = await import("@/lib/foods/rank");
  const { kcalBandForQuery } = await import("@/lib/foods/plausibility");
  const { computeTotals } = await import("@/lib/nutrition/compute");
  const { computeImpactPreview } = await import("@/lib/nutrition/impact");
  const { tokens, normalizeQuery } = await import("@/lib/search/normalize");
  const { FATSECRET_CACHE_MODE, FATSECRET_CACHE_MODE_HELPERS } = await import('@/lib/fatsecret/config');
  const {
    searchFatSecretCacheFoods,
    buildCacheCandidate,
    buildCacheFoodResponse,
  } = await import('@/lib/fatsecret/cache-search');

  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('s');
    const withImpact = searchParams.get('withImpact') === '1';
    const recipeId = searchParams.get('recipeId');
    const verification = searchParams.get('verification');
    const source = searchParams.get('source');

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ error: 'Search query must be at least 2 characters' }, { status: 400 });
    }

    const q = query.trim();

    // Load current totals if impact is requested
    let currentTotals: any = null;
    let goal: any = 'general';
    if (withImpact && recipeId) {
      try {
        const result = await computeTotals(recipeId);
        const { provisional, lowConfidenceShare, unmappedCount, ...totals } = result;
        currentTotals = {
          calories: totals.calories,
          protein: totals.proteinG,
          carbs: totals.carbsG,
          fat: totals.fatG,
          fiber: totals.fiberG,
          sugar: totals.sugarG
        };

        // Get goal from existing nutrition record if available
        const existingNutrition = await withSpan('db.nutrition.findUnique', async () => prisma.nutrition.findUnique({
          where: { recipeId }
        }));
        goal = existingNutrition?.goal ?? 'general';
      } catch (error) {
        console.warn('Failed to load current totals for impact calculation:', error);
        // Continue without impact calculation
      }
    }

    const qn = normalizeQuery(q);
    const toks = tokens(qn);
    const modeHelpers = FATSECRET_CACHE_MODE_HELPERS;
    const shouldServeCache = modeHelpers.shouldServeCache;
    const isShadow = FATSECRET_CACHE_MODE === 'shadow';
    const kcalBand = kcalBandForQuery(q);

    const buildImpact = (
      per100: {
        kcal100: number;
        protein100: number;
        carbs100: number;
        fat100: number;
        fiber100?: number | null;
        sugar100?: number | null;
      },
      servingOptions: Array<{ label: string; grams: number }>,
    ) => {
      if (!withImpact || !currentTotals) return null;
      const defaultGrams = servingOptions[0]?.grams ?? 100;
      const impact = computeImpactPreview({
        currentTotals,
        foodPer100: per100,
        servingGrams: defaultGrams,
        goal,
      });
      return {
        perServing: impact.perServing,
        deltas: impact.deltas,
        nextScore: impact.nextScore,
        deltaScore: impact.deltaScore,
        assumedServingLabel: servingOptions[0]?.label ?? '100 g',
      };
    };

    const runLegacySearch = async () => {
      const andORs = toks.map(t => ({
        OR: [
          { name: { contains: t, mode: 'insensitive' } },
          { brand: { contains: t, mode: 'insensitive' } },
          { aliases: { some: { alias: { contains: t, mode: 'insensitive' } } } },
        ]
      }));

      const whereClause: any = {
        AND: andORs
      };

      if (verification) {
        whereClause.verification = verification;
      }

      if (source) {
        whereClause.source = source;
      }

      const foods = await withSpan('db.food.findMany.search', async () => prisma.food.findMany({
        where: whereClause,
        include: {
          units: true,
          barcodes: true,
          aliases: true
        },
        take: 200
      }));

      const foodsById = new Map(foods.map((f) => [f.id, f]));

      const candidates = foods.map(f => ({
        food: {
          id: f.id,
          name: f.name,
          brand: f.brand,
          source: f.source,
          verification: f.verification as any,
          kcal100: f.kcal100,
          protein100: f.protein100,
          carbs100: f.carbs100,
          fat100: f.fat100,
          densityGml: f.densityGml,
          categoryId: f.categoryId,
          popularity: f.popularity,
        },
        aliases: (f.aliases ?? []).map(a => a.alias),
        barcodes: (f.barcodes ?? []).map(b => b.gtin),
        usedByUserCount: 0,
      }));

      const ranked = rankCandidates(candidates, {
        query: q,
        kcalBand
      });

      const data = ranked.slice(0, 30).map(({ candidate, confidence }) => {
        const f = foodsById.get(candidate.food.id);
        if (!f) return null;
        const servingOptions = deriveServingOptions({
          units: f.units?.map(u => ({ label: u.label, grams: u.grams })),
          densityGml: f.densityGml ?? undefined,
          categoryId: f.categoryId ?? null,
        });

        const item: any = {
          id: f.id,
          name: f.name,
          brand: f.brand,
          categoryId: f.categoryId,
          source: f.source,
          verification: f.verification,
          densityGml: f.densityGml,
          kcal100: f.kcal100,
          protein100: f.protein100,
          carbs100: f.carbs100,
          fat100: f.fat100,
          fiber100: f.fiber100,
          sugar100: f.sugar100,
          popularity: f.popularity,
          confidence,
          servingOptions,
        };

        const impactPayload = buildImpact(
          {
            kcal100: f.kcal100,
            protein100: f.protein100,
            carbs100: f.carbs100,
            fat100: f.fat100,
            fiber100: f.fiber100 ?? undefined,
            sugar100: f.sugar100 ?? undefined
          },
          servingOptions,
        );
        if (impactPayload) {
          item.impact = impactPayload;
        }

        return item;
      }).filter(Boolean);

      return { data, count: foods.length };
    };

    const runCacheSearch = async () => {
      const cachedFoods = await searchFatSecretCacheFoods(q, 200);
      if (cachedFoods.length === 0) {
        return { data: [] as any[], count: 0 };
      }
      const candidates = cachedFoods.map(buildCacheCandidate);
      const ranked = rankCandidates(candidates, { query: q, kcalBand });
      const cacheById = new Map(cachedFoods.map((f) => [f.id, f]));
      const data = ranked.slice(0, 30).map(({ candidate, confidence }) => {
        const food = cacheById.get(candidate.food.id);
        if (!food) return null;
        const base = buildCacheFoodResponse(food, confidence);
        const impactPayload = buildImpact(
          {
            kcal100: base.kcal100,
            protein100: base.protein100,
            carbs100: base.carbs100,
            fat100: base.fat100,
            fiber100: base.fiber100,
            sugar100: base.sugar100,
          },
          base.servingOptions,
        );
        return impactPayload ? { ...base, impact: impactPayload } : base;
      }).filter(Boolean);
      return { data, count: cachedFoods.length };
    };

    let responseData: any[] = [];
    if (shouldServeCache) {
      const cacheResult = await runCacheSearch();
      if (cacheResult.data.length > 0) {
        responseData = cacheResult.data;
        logger.info(
          {
            feature: 'mapping_v2',
            step: 'cache_served',
            q,
            cacheCount: cacheResult.count,
            cacheMode: FATSECRET_CACHE_MODE,
          },
          'fatsecret_cache_search',
        );
      } else {
        // ACCURACY FIX: No legacy fallback - only serve FatSecret/FDC cache
        // This prevents showing prepared foods (Denny's, McDonald's) and outdated USDA data
        responseData = [];
        logger.info(
          {
            feature: 'mapping_v2',
            step: 'cache_empty_no_results',
            q,
            cacheMode: FATSECRET_CACHE_MODE,
          },
          'fatsecret_cache_search',
        );
      }
    } else {
      const legacyResult = await runLegacySearch();
      responseData = legacyResult.data;
      if (isShadow) {
        const cacheResult = await runCacheSearch();
        logger.info(
          {
            feature: 'mapping_v2',
            step: 'search_shadow_compare',
            q,
            legacyCount: legacyResult.count,
            cacheCount: cacheResult.count,
          },
          'fatsecret_cache_shadow',
        );
      }
    }

    logger.info('mapping_v2', {
      feature: 'mapping_v2',
      step: shouldServeCache ? 'search_rank_cache' : 'search_rank',
      q,
      cacheMode: FATSECRET_CACHE_MODE,
      resultCount: responseData.length,
      topId: responseData[0]?.id,
      topConfidence: responseData[0]?.confidence,
    });

    return NextResponse.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    capture(error, { endpoint: 'foods-search' });
    return NextResponse.json(
      { error: 'Failed to search foods' },
      { status: 500 }
    );
  }
}
