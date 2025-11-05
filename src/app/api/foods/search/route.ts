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

    // Normalize query for better matching
    const qn = normalizeQuery(q);
    const toks = tokens(qn);

    // Search local database with normalized tokens
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

    // Add filters
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

    // Build candidates for ranking
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
      usedByUserCount: 0, // TODO: hydrate later
    }));

    // Rank candidates
    const ranked = rankCandidates(candidates, { 
      query: q, 
      kcalBand: kcalBandForQuery(q) 
    });

    // Build response with confidence and serving options
    const data = ranked.slice(0, 30).map(({ candidate, confidence }) => {
      const f = foods.find(x => x.id === candidate.food.id)!;
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

      // Add impact calculation if requested
      if (withImpact && currentTotals) {
        const per100 = { 
          kcal100: f.kcal100, 
          protein100: f.protein100, 
          carbs100: f.carbs100, 
          fat100: f.fat100, 
          fiber100: f.fiber100 ?? undefined, 
          sugar100: f.sugar100 ?? undefined 
        };
        const defaultGrams = servingOptions[0]?.grams ?? 100;
        const impact = computeImpactPreview({
          currentTotals, 
          foodPer100: per100, 
          servingGrams: defaultGrams, 
          goal
        });
        item.impact = {
          perServing: impact.perServing,
          deltas: impact.deltas,
          nextScore: impact.nextScore,
          deltaScore: impact.deltaScore,
          assumedServingLabel: servingOptions[0]?.label ?? '100 g',
        };
      }

      return item;
    });

    // Log structured event per request
    logger.info('mapping_v2', {
      feature: 'mapping_v2',
      step: 'search_rank',
      q,
      resultCount: data.length,
      topId: data[0]?.id,
      topConfidence: data[0]?.confidence,
    });
    
    return NextResponse.json({
      success: true,
      data
    });
  } catch (error) {
    capture(error, { endpoint: 'foods-search' });
    return NextResponse.json(
      { error: 'Failed to search foods' },
      { status: 500 }
    );
  }
}

