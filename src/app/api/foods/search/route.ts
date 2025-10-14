import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { searchFoods, FDCFood } from '@/lib/usda';
import { FoodSource } from '@prisma/client';

/**
 * Search foods by name or brand with smart query expansion and ranking
 * GET /api/foods/search?s=...
 * 
 * Enhanced Strategy:
 * 1. Query expansion: original, no-brand, bigrams
 * 2. Local search with ranking for each expanded query
 * 3. If < 10 results, search USDA FDC API (Branded first, then Foundation/SR)
 * 4. Merge and re-rank all results
 * 5. Return top 10 ranked results
 */

// Brand tokens to remove for no-brand queries
const BRAND_TOKENS = [
  "kodiak", "real good", "optimum nutrition", "quest", "chobani", "fage", 
  "oikos", "kirkland", "costco", "trader joe", "whole foods", "aldi", 
  "walmart", "target", "sam's", "atkins", "quest nutrition", "protein", 
  "whey", "isolate", "concentrate", "casein", "plant", "vegan", "organic"
];

// Stopwords to remove
const STOPWORDS = new Set([
  "the", "brand", "original", "classic", "natural", "organic", "fresh",
  "premium", "select", "choice", "best", "new", "improved", "light",
  "low", "fat", "free", "sugar", "free", "diet", "zero", "calorie"
]);

interface ExpandedQuery {
  original: string;
  noBrand: string;
  bigrams: string[];
}

interface RankedFood {
  id: string;
  name: string;
  brand: string | null;
  source: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  score: number;
}
/**
 * Expand query into multiple search variants
 */
function expandQuery(query: string): ExpandedQuery {
  const normalized = query.toLowerCase().trim();
  
  // Tokenize and clean
  const tokens = normalized
    .replace(/[^\w\s-]/g, ' ') // Remove special chars except hyphens
    .split(/\s+/)
    .filter(token => token.length > 0 && !STOPWORDS.has(token));
  
  // Create no-brand version
  let noBrandTokens = [...tokens];
  for (const brandToken of BRAND_TOKENS) {
    const brandWords = brandToken.split(/\s+/);
    // Remove brand tokens if they appear as consecutive words
    for (let i = 0; i <= noBrandTokens.length - brandWords.length; i++) {
      const slice = noBrandTokens.slice(i, i + brandWords.length);
      if (slice.join(' ') === brandToken) {
        noBrandTokens.splice(i, brandWords.length);
        break;
      }
    }
  }
  
  // Extract bigrams (consecutive word pairs)
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  
  return {
    original: normalized,
    noBrand: noBrandTokens.join(' '),
    bigrams
  };
}

/**
 * Calculate ranking score for a food item
 */
function calculateScore(food: any, query: ExpandedQuery): number {
  const name = (food.name || '').toLowerCase();
  const brand = (food.brand || '').toLowerCase();
  const fullText = `${name} ${brand}`.trim();
  
  let score = 0;
  
  // Brand exact match (3 points)
  const brandExact = brand && query.original.includes(brand) ? 1 : 0;
  score += 3 * brandExact;
  
  // Name contains bigram (2 points)
  const nameContainsBigram = query.bigrams.some(bigram => name.includes(bigram)) ? 1 : 0;
  score += 2 * nameContainsBigram;
  
  // Starts with first token (1.5 points)
  const firstToken = query.original.split(' ')[0];
  const startsWith = name.startsWith(firstToken) ? 1 : 0;
  score += 1.5 * startsWith;
  
  // Contains all key tokens (1 point)
  const keyTokens = query.original.split(' ').filter(t => t.length > 1);
  const contains = keyTokens.every(token => fullText.includes(token)) ? 1 : 0;
  score += 1 * contains;
  
  // Distance penalty (0.5 points deduction)
  const distance = calculateLevenshteinDistance(
    normalizeForDistance(query.original),
    normalizeForDistance(name)
  );
  score -= 0.5 * Math.min(distance / 10, 1); // Cap penalty at 0.5
  
  return Math.max(score, 0); // Ensure non-negative
}

/**
 * Calculate Levenshtein distance between two strings
 */
function calculateLevenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,     // deletion
        matrix[j - 1][i] + 1,     // insertion
        matrix[j - 1][i - 1] + cost // substitution
      );
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Normalize string for distance calculation
 */
function normalizeForDistance(str: string): string {
  return str.toLowerCase().replace(/[^\w]/g, '');
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('s');
    
    if (!query || query.trim().length < 2) {
      return NextResponse.json({ error: 'Search query must be at least 2 characters' }, { status: 400 });
    }

    // Step 1: Expand query into multiple variants
    const expandedQuery = expandQuery(query);
    console.log(`🔍 Expanded query:`, expandedQuery);

    // Step 2: Search local database with multiple queries
    const allLocalResults = new Map<string, any>();
    
    // Search with original query
    const originalResults = await searchLocalFoods(expandedQuery.original);
    originalResults.forEach(food => allLocalResults.set(food.id, food));
    
    // Search with no-brand query (if different)
    if (expandedQuery.noBrand !== expandedQuery.original) {
      const noBrandResults = await searchLocalFoods(expandedQuery.noBrand);
      noBrandResults.forEach(food => allLocalResults.set(food.id, food));
    }
    
    // Search with bigrams
    for (const bigram of expandedQuery.bigrams) {
      const bigramResults = await searchLocalFoods(bigram);
      bigramResults.forEach(food => allLocalResults.set(food.id, food));
    }

    // Step 3: Rank and sort local results
    const localFoods = Array.from(allLocalResults.values())
      .map(food => ({
        ...food,
        score: calculateScore(food, expandedQuery)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    console.log(`🔍 Local results: ${localFoods.length} (top score: ${localFoods[0]?.score || 0})`);

    // Step 4: If we have < 10 results, search USDA FDC
    let fdcFoods: FDCFood[] = [];
    if (localFoods.length < 10) {
      console.log(`🔍 Searching USDA for: "${query}"`);
      
      try {
        // Try Branded first, then Foundation/SR if needed
        fdcFoods = await searchFoods(query);
        console.log(`📊 USDA results: ${fdcFoods.length}`);
        
        // Step 5: Upsert FDC results to database
        if (fdcFoods.length > 0) {
          console.log(`💾 Upserting ${fdcFoods.length} FDC foods to database...`);
          await upsertFDCFoods(fdcFoods);
          console.log(`✅ Successfully upserted FDC foods`);
          
          // Re-search local database to include newly upserted foods
          const updatedLocalResults = new Map<string, any>();
          
          // Re-run all queries on updated database
          const updatedOriginalResults = await searchLocalFoods(expandedQuery.original);
          updatedOriginalResults.forEach(food => updatedLocalResults.set(food.id, food));
          
          if (expandedQuery.noBrand !== expandedQuery.original) {
            const updatedNoBrandResults = await searchLocalFoods(expandedQuery.noBrand);
            updatedNoBrandResults.forEach(food => updatedLocalResults.set(food.id, food));
          }
          
          for (const bigram of expandedQuery.bigrams) {
            const updatedBigramResults = await searchLocalFoods(bigram);
            updatedBigramResults.forEach(food => updatedLocalResults.set(food.id, food));
          }
          
          // Re-rank all results including new USDA foods
          const allResults = Array.from(updatedLocalResults.values())
            .map(food => ({
              ...food,
              score: calculateScore(food, expandedQuery)
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
          
          return NextResponse.json({
            success: true,
            data: allResults,
            sources: {
              local: localFoods.length,
              fdc: fdcFoods.length,
              total: allResults.length
            }
          });
        }
      } catch (error) {
        console.error('FDC search error:', error);
        // Continue with local results only
      }
    }
    
    return NextResponse.json({
      success: true,
      data: localFoods,
      sources: {
        local: localFoods.length,
        fdc: fdcFoods.length,
        total: localFoods.length
      }
    });
  } catch (error) {
    console.error('Food search error:', error);
    return NextResponse.json(
      { error: 'Failed to search foods' },
      { status: 500 }
    );
  }
}

/**
 * Search local foods with a single query
 */
async function searchLocalFoods(query: string): Promise<any[]> {
  if (!query.trim()) return [];
  
  return await prisma.food.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { brand: { contains: query, mode: 'insensitive' } }
      ]
    },
    take: 20 // Get more results for ranking
  });
}

/**
 * Upsert FDC foods to database
 */
async function upsertFDCFoods(fdcFoods: FDCFood[]): Promise<void> {
  for (const fdcFood of fdcFoods) {
    try {
      await prisma.food.upsert({
        where: { fdcId: fdcFood.fdcId },
        update: {
          name: fdcFood.name,
          brand: fdcFood.brand,
          source: fdcFood.source,
          calories: fdcFood.per100g.calories,
          proteinG: fdcFood.per100g.proteinG,
          carbsG: fdcFood.per100g.carbsG,
          fatG: fdcFood.per100g.fatG,
          fiberG: fdcFood.per100g.fiberG,
          sugarG: fdcFood.per100g.sugarG,
          updatedAt: new Date(),
        },
        create: {
          name: fdcFood.name,
          brand: fdcFood.brand,
          source: fdcFood.source,
          fdcId: fdcFood.fdcId,
          calories: fdcFood.per100g.calories,
          proteinG: fdcFood.per100g.proteinG,
          carbsG: fdcFood.per100g.carbsG,
          fatG: fdcFood.per100g.fatG,
          fiberG: fdcFood.per100g.fiberG,
          sugarG: fdcFood.per100g.sugarG,
        },
      });
    } catch (error) {
      console.error('Error upserting FDC food:', error, fdcFood);
      // Continue with other foods
    }
  }
}

/**
 * Deduplicate foods by name+brand (case insensitive)
 */
function deduplicateFoods(foods: any[]): any[] {
  const seen = new Set<string>();
  const deduplicated: any[] = [];

  for (const food of foods) {
    const key = `${(food.name || '').toLowerCase()}+${(food.brand || '').toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(food);
    }
  }

  return deduplicated;
}
