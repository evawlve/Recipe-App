import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { deriveServingOptions } from '@/lib/units/servings';
import { logger } from '@/lib/logger';
import { rankCandidates } from '@/lib/foods/rank';
import { kcalBandForQuery } from '@/lib/foods/plausibility';
import { computeTotals } from '@/lib/nutrition/compute';
import { computeImpactPreview } from '@/lib/nutrition/impact';

/**
 * Search foods by name or brand from local database only
 * GET /api/foods/search?s=...
 * 
 * Returns foods with servingOptions derived from units + density/category
 */


export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('s');
    const withImpact = searchParams.get('withImpact') === '1';
    const recipeId = searchParams.get('recipeId');
    
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
        const existingNutrition = await prisma.nutrition.findUnique({
          where: { recipeId }
        });
        goal = existingNutrition?.goal ?? 'general';
      } catch (error) {
        console.warn('Failed to load current totals for impact calculation:', error);
        // Continue without impact calculation
      }
    }

    // Search local database with units and barcodes included
    const foods = await prisma.food.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { brand: { contains: q, mode: 'insensitive' } }
        ]
      },
      include: {
        units: true,
        barcodes: true,
        aliases: true
      },
      take: 200
    });

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
    console.error('Food search error:', error);
    return NextResponse.json(
      { error: 'Failed to search foods' },
      { status: 500 }
    );
  }
}

