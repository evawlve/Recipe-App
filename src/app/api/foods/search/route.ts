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

  // Check API Key
  const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('api_key');
  const expectedApiKey = process.env.DEV_API_KEY || 'adminAPI_dev_key_bypass';
  if (!apiKey || apiKey !== expectedApiKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
  const { FATSECRET_CACHE_MODE, FATSECRET_CACHE_MODE_HELPERS } = await import('@/lib/mapping/config');
  const {
    searchFatSecretCacheFoods,
    buildCacheCandidate,
    buildCacheFoodResponse,
  } = await import('@/lib/mapping/cache-search');

  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('s');
    const withImpact = searchParams.get('withImpact') === '1';
    const recipeId = searchParams.get('recipeId');
    const verification = searchParams.get('verification');
    const source = searchParams.get('source');
    const isLocalSearch = searchParams.get('local') === 'true' || searchParams.get('bypassCache') === 'true';

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

      const ranked = rankCandidates(candidates as any, {
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
      const ranked = rankCandidates(candidates as any, { query: q, kcalBand });
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

    const runLocalSearch = async () => {
      const { gatherCandidates } = await import('@/lib/mapping/gather-candidates');
      const { mapUsdaToCategory } = await import('@/ops/usda/category-map');
      const { queryTokenCoverage, coverageTokens, findMisspelledTokens } =
        await import('@/lib/search/query-token-coverage');
      const fallbackCandidates = await gatherCandidates(q, null, q, { isBrandedQuery: true });

      // Detect likely typos by using the curated FDC candidates as the
      // dictionary: a fuzzy-eligible query token that no FDC name contains
      // but that sits one edit budget away from one ("yougurt" ~ "yogurt")
      // is a misspelling. Products literally *named* with the misspelling
      // are junk entries riding the typo — demote them so the correctly
      // spelled food they're shadowing can win.
      const fdcVocab = new Set<string>();
      for (const c of fallbackCandidates) {
        if (c.source === 'fdc') {
          for (const t of coverageTokens(c.name)) fdcVocab.add(t);
        }
      }
      const misspelledToks = findMisspelledTokens(q, fdcVocab);
      const isJunkNamed = (c: typeof fallbackCandidates[number]) => {
        if (misspelledToks.size === 0) return false;
        const nameToks = new Set(coverageTokens(c.name));
        for (const t of misspelledToks) {
          if (nameToks.has(t)) return true;
        }
        return false;
      };

      const category = mapUsdaToCategory(q);
      const isProduceQuery = category === 'fruit' || category === 'veg';

      // FDC and OFF scores live on different scales (computePositionScore
      // ~0–1.5 vs computeOffScore ~0–10), so they can't be compared or fed
      // into the confidence formula raw. Normalize each per source, and
      // weight FDC by how much of the query its name actually covers —
      // engine typo-expansion can surface FDC rows that share no real
      // token with the query (e.g. "ryse" pulling in "rye flour").
      const relevanceById = new Map<string, { coverage: number; relevance: number }>();
      for (const c of fallbackCandidates) {
        const coverage = queryTokenCoverage(q, c.name, c.brandName);
        let relevance = c.source === 'fdc'
          ? Math.min(1, (c.score || 0) / 1.5) * coverage
          : Math.min(1, Math.max(0, (c.score || 0) / 10));
        if (isJunkNamed(c)) relevance *= 0.5;
        relevanceById.set(c.id, { coverage, relevance });
      }

      // Hybrid vector fallback: when no candidate genuinely matches the
      // query's wording (weak keyword relevance across the board), the
      // semantic hits are the honest signal — rank them by cosine
      // similarity instead of the near-zero keyword-normalized score that
      // would otherwise bury them. Junk-named candidates stay demoted.
      const bestKeywordRelevance = fallbackCandidates.reduce(
        (best, c) => Math.max(best, relevanceById.get(c.id)?.relevance ?? 0), 0);
      if (bestKeywordRelevance < 0.45) {
        let promoted = 0;
        for (const c of fallbackCandidates) {
          const sim = c.semanticSimilarity;
          if (sim === undefined || isJunkNamed(c)) continue;
          const entry = relevanceById.get(c.id);
          if (entry && sim > entry.relevance) {
            entry.relevance = Math.min(0.9, sim);
            promoted++;
          }
        }
        if (promoted > 0) {
          logger.info('local_search_semantic_fallback', {
            feature: 'mapping_v2',
            step: 'semantic_fallback_promoted',
            q,
            promoted,
            bestKeywordRelevance: Number(bestKeywordRelevance.toFixed(3)),
          });
        }
      }
      const relevanceOf = (c: typeof fallbackCandidates[number]) =>
        relevanceById.get(c.id) ?? { coverage: 0, relevance: 0 };

      // Sort and filter candidates
      let sortedCandidates = [...fallbackCandidates];

      // If it is a generic produce query, filter out openfoodfacts entries that have 0/null macros
      if (isProduceQuery) {
        sortedCandidates = sortedCandidates.filter(c => {
          if (c.source === 'openfoodfacts') {
            const hasMacros = c.nutrition && (c.nutrition.kcal > 0 || c.nutrition.protein > 0 || c.nutrition.carbs > 0);
            return hasMacros;
          }
          return true;
        });
      }

      sortedCandidates.sort((a, b) => {
        // 1. If it's a produce query, prioritize FDC (USDA) generic foods —
        //    but only ones matching every query token, so a produce word
        //    inside a branded query ("ryse blueberry muffin") can't hoist
        //    unrelated USDA rows above a near-exact branded match
        if (isProduceQuery) {
          const aFdcMatch = a.source === 'fdc' && relevanceOf(a).coverage >= 1;
          const bFdcMatch = b.source === 'fdc' && relevanceOf(b).coverage >= 1;
          if (aFdcMatch && !bFdcMatch) return -1;
          if (bFdcMatch && !aFdcMatch) return 1;
        }

        // 2. Prioritize candidates that have macro data over those that have zero macros
        const aHasMacros = a.nutrition && (a.nutrition.kcal > 0 || a.nutrition.protein > 0 || a.nutrition.carbs > 0);
        const bHasMacros = b.nutrition && (b.nutrition.kcal > 0 || b.nutrition.protein > 0 || b.nutrition.carbs > 0);
        if (aHasMacros && !bHasMacros) return -1;
        if (bHasMacros && !aHasMacros) return 1;

        // 3. Otherwise rank by normalized relevance
        return relevanceOf(b).relevance - relevanceOf(a).relevance;
      });

      // Collapse near-duplicate entries (same normalized name + macro signature)
      // so generic queries like "grapes" return one representative per food
      // instead of 15+ near-identical OFF rows.
      const { dedupeCandidates } = await import('@/lib/search/dedupe-candidates');
      const beforeDedupe = sortedCandidates.length;
      sortedCandidates = dedupeCandidates(sortedCandidates);
      if (sortedCandidates.length < beforeDedupe) {
        logger.info('local_search_dedupe', {
          feature: 'mapping_v2',
          step: 'local_search_dedupe',
          q,
          beforeCount: beforeDedupe,
          afterCount: sortedCandidates.length,
        });
      }

      const data = sortedCandidates.map(c => {
        const raw = c.rawData ?? {};
        const nutrients = raw.nutrientsPer100g || {};
        
        let servingOptions = (c.servings || []).map(s => ({
          label: s.description,
          grams: s.grams ?? 100
        }));
        
        if (servingOptions.length === 0) {
          if (raw.servingSize) {
            servingOptions.push({
              label: raw.servingSize,
              grams: raw.servingGrams ?? 100
            });
          } else {
            servingOptions.push({
              label: '100 g',
              grams: 100
            });
          }
        }

        const item: any = {
          id: c.id,
          name: c.name,
          brand: c.brandName ?? null,
          source: c.source === 'openfoodfacts' ? 'off' : (c.source === 'fdc' ? 'usda' : c.source),
          verification: c.source === 'fdc' ? 'verified' : 'unverified',
          kcal100: c.nutrition?.kcal ?? 0,
          protein100: c.nutrition?.protein ?? 0,
          carbs100: c.nutrition?.carbs ?? 0,
          fat100: c.nutrition?.fat ?? 0,
          fiber100: nutrients.fiber ?? 0,
          sugar100: nutrients.sugars ?? nutrients.sugar ?? 0,
          sodium100: nutrients.sodium ?? 0,
          confidence: Math.min(1.0, Math.max(0.1, relevanceOf(c).relevance)),
          servingOptions
        };

        const impactPayload = buildImpact(
          {
            kcal100: item.kcal100,
            protein100: item.protein100,
            carbs100: item.carbs100,
            fat100: item.fat100,
            fiber100: item.fiber100,
            sugar100: item.sugar100
          },
          servingOptions,
        );
        if (impactPayload) {
          item.impact = impactPayload;
        }

        return item;
      });

      return { data, count: sortedCandidates.length };
    };

    let responseData: any[] = [];
    if (isLocalSearch) {
      const localResult = await runLocalSearch();
      responseData = localResult.data;
      logger.info(
        'local_search_direct',
        {
          feature: 'mapping_v2',
          step: 'local_search_direct_executed',
          q,
          resultCount: responseData.length,
        },
      );
    } else if (shouldServeCache) {
      const cacheResult = await runCacheSearch();
      if (cacheResult.data.length > 0) {
        responseData = cacheResult.data;
        logger.info(
          'fatsecret_cache_search',
          {
            feature: 'mapping_v2',
            step: 'cache_served',
            q,
            cacheCount: cacheResult.count,
            cacheMode: FATSECRET_CACHE_MODE,
          },
        );
      } else {
        const localResult = await runLocalSearch();
        responseData = localResult.data;
        logger.info(
          'fatsecret_cache_search',
          {
            feature: 'mapping_v2',
            step: 'cache_empty_fallback_executed',
            q,
            fallbackCount: responseData.length,
            cacheMode: FATSECRET_CACHE_MODE,
          },
        );
      }
    } else {
      const legacyResult = await runLegacySearch();
      responseData = legacyResult.data;
      if (isShadow) {
        const cacheResult = await runCacheSearch();
        logger.info(
          'fatsecret_cache_shadow',
          {
            feature: 'mapping_v2',
            step: 'search_shadow_compare',
            q,
            legacyCount: legacyResult.count,
            cacheCount: cacheResult.count,
          },
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
