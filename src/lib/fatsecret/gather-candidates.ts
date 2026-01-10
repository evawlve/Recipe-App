/**
 * Unified Candidate Gathering
 * 
 * Searches all data sources in parallel and returns a unified candidate list
 * for filtering and AI rerank selection.
 */

import { prisma } from '../db';
import { FatSecretClient } from './client';
import { searchFatSecretCacheFoods, extractCacheNutrients, type CacheFoodRecord } from './cache-search';
import { parseIngredientLine, type ParsedIngredient } from '../parse/ingredient-line';
import { normalizeIngredientName } from './normalization-rules';
import { fdcApi } from '../usda/fdc-api';
import { logger } from '../logger';

// Create a default client instance
const defaultClient = new FatSecretClient();

// ============================================================
// Types
// ============================================================

export interface UnifiedCandidate {
    id: string;
    source: 'cache' | 'fatsecret' | 'fdc';
    name: string;
    brandName?: string | null;
    score: number;
    foodType?: string;
    nutrition?: {
        kcal: number;
        protein: number;
        carbs: number;
        fat: number;
        per100g: boolean;
    };
    servings?: Array<{
        description: string;
        grams: number | null;
        isDefault?: boolean;
    }>;
    rawData: any;
}

export interface GatherOptions {
    client?: FatSecretClient;
    skipCache?: boolean;
    skipLiveApi?: boolean;
    skipFdc?: boolean;
    maxPerSource?: number;
    aiSynonyms?: string[];  // AI-generated synonyms for retry searches
}

// ============================================================
// Main Gather Function
// ============================================================

export async function gatherCandidates(
    rawLine: string,
    parsed: ParsedIngredient | null,
    normalizedName: string,
    options: GatherOptions = {}
): Promise<UnifiedCandidate[]> {
    const {
        client = defaultClient,
        skipLiveApi = false,
        skipFdc = false,
        maxPerSource = 8,  // Get top 8 from each source to ensure we find generic names
    } = options;

    const trimmed = rawLine.trim();
    if (!trimmed) return [];

    // Use the normalizedName as the primary search query
    // This ensures generic fallbacks like "oil" → "vegetable oil" are actually searched for
    // Falls back to parsed name or rawLine if normalized is missing
    const searchQuery = normalizedName || parsed?.name?.trim() || trimmed;

    // Expand British → American synonyms for the search query
    // e.g., "single cream" → ["single cream", "light cream", "half and half", "coffee cream"]
    const expandedQueries = expandWithSynonyms(searchQuery);
    const primaryQuery = expandedQueries[0]; // Original query
    const britishSynonyms = expandedQueries.slice(1); // American equivalents

    // Search FatSecret Live and FDC in parallel
    // NOTE: We do NOT search cache here for candidates - cache is for hydration/storing food details
    // The APIs should return proper rankings (e.g., "banana" → Banana fruit as #1)
    // Mixing cache results with API results pollutes rankings with previously cached items
    const searchPromises: Promise<UnifiedCandidate[]>[] = [
        skipLiveApi ? Promise.resolve([]) : searchFatSecretLiveSimple(client, primaryQuery, maxPerSource, rawLine),
        skipFdc ? Promise.resolve([]) : searchFdcSimple(primaryQuery, maxPerSource, rawLine),
    ];

    // Add British → American synonym searches (e.g., "single cream" → "light cream")
    // These are hardcoded conversions, distinct from AI-generated synonyms
    for (const britSyn of britishSynonyms.slice(0, 2)) { // Limit to 2 to avoid rate limits
        if (!skipLiveApi) {
            searchPromises.push(searchFatSecretLiveSimple(client, britSyn, 4, rawLine));
        }
        if (!skipFdc) {
            searchPromises.push(searchFdcSimple(britSyn, 4, rawLine));
        }
    }

    // If we have AI synonyms, add searches for them too (up to 2, to avoid rate limits)
    // Only if the main query is different from the synonym
    const synonymsToSearch = (options.aiSynonyms || [])
        .filter(syn => syn && syn.toLowerCase() !== searchQuery.toLowerCase())
        .slice(0, 2);

    for (const syn of synonymsToSearch) {
        if (!skipLiveApi) {
            searchPromises.push(searchFatSecretLiveSimple(client, syn, 2, rawLine)); // Limit synonym results to 2
        }
    }

    const results = await Promise.allSettled(searchPromises);

    // Collect candidates (deduplicate by ID)
    const candidates: UnifiedCandidate[] = [];
    const seenIds = new Set<string>();

    for (const result of results) {
        if (result.status === 'fulfilled') {
            for (const c of result.value) {
                // Determine ID (prepend fdc_ for FDC results if not already done)
                // Note: searchFdcSimple already returns proper IDs, but let's be safe
                // Actually searchFdcSimple returns IDs like "12345", so we need to prefix them here if not already prefixed
                // But wait, the original code prefixed them in the loop.
                // Let's standardise the ID handling.
                let id = c.id;
                if (c.source === 'fdc' && !id.startsWith('fdc_')) {
                    id = `fdc_${id}`;
                }

                if (!seenIds.has(id)) {
                    seenIds.add(id);
                    candidates.push({ ...c, id });
                }
            }
        }
    }

    logger.info('gather.candidates.complete', {
        rawLine,
        liveCount: results[0].status === 'fulfilled' ? results[0].value.length : 0,
        fdcCount: results[1].status === 'fulfilled' ? results[1].value.length : 0,
        synonymMatches: results.slice(2).reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value.length : 0), 0),
        totalUnique: candidates.length,
    });

    return candidates;
}

// ============================================================
// Confidence Gate (Early Exit for High-Confidence Matches)
// ============================================================

const CONFIDENCE_THRESHOLD = 0.85;  // Skip AI if confidence >= this
const MARGIN_THRESHOLD = 0.10;      // Require clear winner (margin between top 2)

export interface ConfidenceGateResult {
    skipAiRerank: boolean;
    selected?: UnifiedCandidate;
    confidence: number;
    reason: string;
}

/**
 * Assess match confidence between query and a candidate result.
 * Uses token overlap and API position to determine confidence.
 */
export function assessConfidence(query: string, candidate: UnifiedCandidate): number {
    const queryTokens = new Set(
        query.toLowerCase().split(/\s+/).filter(t => t.length > 2)
    );
    const resultTokens = new Set(
        candidate.name.toLowerCase().split(/\s+/).filter(t => t.length > 2)
    );

    if (queryTokens.size === 0) return 0;

    // Token overlap coverage
    const overlap = [...queryTokens].filter(t => resultTokens.has(t)).length;
    const coverage = overlap / queryTokens.size;

    // Position bonus (API's #1 result gets a boost)
    const positionBonus = candidate.score >= 0.95 ? 0.1 :
        candidate.score >= 0.90 ? 0.05 : 0;

    // Exact/near-exact match bonus
    const queryLower = query.toLowerCase().trim();
    const candidateLower = candidate.name.toLowerCase().trim();

    if (queryLower === candidateLower) {
        return 1.0;  // Perfect match
    }

    if (candidateLower.includes(queryLower) || queryLower.includes(candidateLower)) {
        return Math.min(1.0, coverage + positionBonus + 0.15);  // Contains bonus
    }

    return Math.min(1.0, coverage + positionBonus);
}

/**
 * Confidence gate to decide if we can skip AI reranking.
 * Only skips if:
 * 1. Top result has high confidence (>= 0.85)
 * 2. There's a clear margin between top 1 and top 2 (>= 0.10)
 * 
 * SPECIAL CASE: Basic produce (potatoes, lentils, etc.) ALWAYS bypasses AI
 * because FDC/USDA data is more reliable than AI selection for these items.
 * 
 * This reduces AI API calls for obvious matches while still using
 * AI for ambiguous cases like "pepper" (bell pepper vs black pepper).
 */
export function confidenceGate(
    query: string,
    candidates: UnifiedCandidate[]
): ConfidenceGateResult {
    if (candidates.length === 0) {
        return {
            skipAiRerank: false,
            confidence: 0,
            reason: 'no_candidates'
        };
    }

    const queryLower = query.toLowerCase();

    // BASIC PRODUCE: Always skip AI rerank - FDC/USDA data is more reliable
    // AI tends to select FatSecret candidates with inflated fat values
    const BASIC_PRODUCE = ['potato', 'potatoes', 'lentil', 'lentils', 'beans', 'chickpea', 'chickpeas', 'rice', 'spinach', 'broccoli', 'carrot', 'carrots'];
    const isBasicProduce = BASIC_PRODUCE.some(p => queryLower.includes(p));

    if (isBasicProduce && candidates.length > 0) {
        const top1 = candidates[0];
        logger.info('confidence_gate.basic_produce_bypass', {
            query,
            selectedName: top1.name,
            source: top1.source,
            score: top1.score,
        });
        return {
            skipAiRerank: true,
            selected: top1,
            confidence: top1.score,
            reason: 'basic_produce_bypass'
        };
    }

    const top1 = candidates[0];
    const top2 = candidates[1];
    const top1Conf = assessConfidence(query, top1);

    // Check confidence threshold
    if (top1Conf < CONFIDENCE_THRESHOLD) {
        return {
            skipAiRerank: false,
            confidence: top1Conf,
            reason: `confidence_below_threshold (${top1Conf.toFixed(3)} < ${CONFIDENCE_THRESHOLD})`
        };
    }

    // Check margin (clear winner)
    if (top2) {
        const top2Conf = assessConfidence(query, top2);
        const margin = top1Conf - top2Conf;

        if (margin < MARGIN_THRESHOLD) {
            return {
                skipAiRerank: false,
                confidence: top1Conf,
                reason: `margin_too_small (${margin.toFixed(3)} < ${MARGIN_THRESHOLD})`
            };
        }
    }

    // MISSING MACROS CHECK (Option D fix)
    // If the top candidate has P:0 AND C:0, it likely has bad/incomplete nutrition data
    // Force AI rerank to potentially find a better candidate with complete macros
    // This is especially important for nutritious foods like seeds, nuts, grains, meat, legumes
    const NUTRITIOUS_KEYWORDS = ['seed', 'seeds', 'nut', 'nuts', 'grain', 'grains', 'lentil', 'lentils',
        'bean', 'beans', 'pea', 'peas', 'chickpea', 'chickpeas', 'quinoa', 'oat', 'oats',
        'rice', 'meat', 'beef', 'pork', 'chicken', 'turkey', 'fish', 'salmon', 'tuna',
        'egg', 'eggs', 'cheese', 'yogurt', 'tofu', 'tempeh'];
    const queryLowerForMacros = query.toLowerCase();
    const isNutritiousFood = NUTRITIOUS_KEYWORDS.some(kw => queryLowerForMacros.includes(kw));

    if (isNutritiousFood && top1.nutrition) {
        const hasZeroProtein = (top1.nutrition.protein ?? 0) === 0;
        const hasZeroCarbs = (top1.nutrition.carbs ?? 0) === 0;
        // If BOTH protein AND carbs are zero, this is suspicious for a nutritious food
        if (hasZeroProtein && hasZeroCarbs) {
            logger.info('confidence_gate.missing_macros_detected', {
                query,
                candidateName: top1.name,
                nutrition: top1.nutrition,
            });
            return {
                skipAiRerank: false,
                confidence: top1Conf,
                reason: `missing_macros (P:0 C:0 for nutritious food)`
            };
        }
    }

    // High confidence + clear winner → skip AI
    logger.info('confidence_gate.early_exit', {
        query,
        selectedName: top1.name,
        confidence: top1Conf,
    });

    return {
        skipAiRerank: true,
        selected: top1,
        confidence: top1Conf,
        reason: 'high_confidence_clear_winner'
    };
}


// ============================================================
// SIMPLIFIED Cache Search (fallback when API unavailable)
// ============================================================

async function searchCacheSimple(
    query: string,
    limit: number
): Promise<UnifiedCandidate[]> {
    try {
        const foods = await searchFatSecretCacheFoods(query, limit);

        return foods.map((food, position) => {
            const cacheNutrition = extractCacheNutrients(food);
            return {
                id: food.id,
                source: 'cache' as const,
                name: food.name,
                brandName: food.brandName,
                // Position-based score, slightly lower than live API to prefer fresh data
                score: Math.max(0.4, 0.90 - (position * 0.05)),
                foodType: food.foodType || 'Generic',
                // Convert cache nutrition to unified format
                nutrition: cacheNutrition.calories != null ? {
                    kcal: cacheNutrition.calories,
                    protein: cacheNutrition.protein ?? 0,
                    carbs: cacheNutrition.carbs ?? 0,
                    fat: cacheNutrition.fat ?? 0,
                    per100g: true,
                } : undefined,
                rawData: food,
            };
        });
    } catch (err) {
        logger.warn('gather.cache.search_failed', { query, error: (err as Error).message });
        return [];
    }
}

// ============================================================
// SIMPLIFIED FatSecret Live API Search
// ============================================================

async function searchFatSecretLiveSimple(
    client: FatSecretClient,
    query: string,  // This is the normalizedName
    limit: number,
    rawLine: string
): Promise<UnifiedCandidate[]> {
    try {
        const results = await client.searchFoodsV4(query, { maxResults: limit });

        return results.map((food, position) => ({
            id: food.id,
            source: 'fatsecret' as const,
            name: food.name,
            brandName: food.brandName,
            // Use query (normalizedName) for name matching, rawLine is kept for modifier detection
            score: computePositionScore(query, food.name, position),
            foodType: food.foodType || 'Generic',
            rawData: food,
        }));
    } catch (err) {
        logger.warn('gather.live.search_failed', { query, error: (err as Error).message });
        return [];
    }
}



// ============================================================
// SIMPLIFIED FDC Search with Safety Rerank
// ============================================================

/**
 * Compute a priority score for FDC result based on name simplicity.
 * Higher score = simpler name = more likely to be the raw ingredient.
 * 
 * Priority tiers:
 * - 100: Exact match (query matches name exactly)
 * - 90:  Simple name (1-2 words, starts with query)
 * - 80:  Raw/flesh/skin variants (e.g., "Potatoes, flesh and skin, raw")
 * - 70:  Query is first word
 * - 40:  Contains query somewhere
 * - 10:  Compound product (bread, flour, pancakes, etc.)
 */
function computeFdcPriorityScore(query: string, foodName: string): number {
    const queryLower = query.toLowerCase().trim();
    const nameLower = foodName.toLowerCase().trim();

    // Singularize helper (potatoes → potato)
    const singularize = (word: string): string => {
        if (word.endsWith('oes')) return word.slice(0, -2);
        if (word.endsWith('es')) return word.slice(0, -2);
        if (word.endsWith('s')) return word.slice(0, -1);
        return word;
    };

    // CHECK DISH INDICATORS FIRST - before any name matching!
    // Products like "Potato flour", "Bread, potato" should be deprioritized
    const DISH_INDICATORS = ['bread', 'flour', 'pancake', 'cake', 'cookie', 'pie', 'salad', 'soup', 'stew',
        'sauce', 'chip', 'chips', 'snack', 'snacks', 'babyfood', 'baby food', 'toddler',
        'fast food', 'mashed', 'puff', 'stick', 'sticks', 'fried', 'hash brown', 'frozen', 'canned'];
    const isDishLike = DISH_INDICATORS.some(dish => nameLower.includes(dish));

    if (isDishLike) {
        return 10; // Very low priority for dishes/processed products
    }

    const querySingular = singularize(queryLower);
    const nameWords = nameLower.split(/[,\s]+/).filter(w => w.length > 0);
    const nameFirstWord = nameWords[0] || '';
    const nameFirstSingular = singularize(nameFirstWord);

    // Exact match (potatoes === potatoes)
    if (nameLower === queryLower || nameLower === querySingular) {
        return 100;
    }

    // Simple name match (1-2 words, query is primary)
    // e.g., "Potatoes" or "Potato" for query "potatoes"
    if (nameWords.length <= 2 && (nameFirstWord === queryLower || nameFirstWord === querySingular || nameFirstSingular === querySingular)) {
        return 90;
    }

    // Raw/basic form variants (e.g., "Potatoes, flesh and skin, raw")
    const RAW_INDICATORS = ['raw', 'flesh', 'skin', 'fresh', 'plain', 'whole'];
    const hasRawIndicator = RAW_INDICATORS.some(ind => nameLower.includes(ind));
    if (hasRawIndicator && (nameFirstWord === queryLower || nameFirstWord === querySingular || nameFirstSingular === querySingular)) {
        return 80;
    }

    // Query is first word (e.g., "Potatoes, baked, flesh")
    if (nameFirstWord === queryLower || nameFirstWord === querySingular || nameFirstSingular === querySingular) {
        return 70;
    }

    // Contains query somewhere
    if (nameLower.includes(queryLower) || nameLower.includes(querySingular)) {
        return 40;
    }

    return 20; // Default
}

async function searchFdcSimple(query: string, limit: number, rawLine: string): Promise<UnifiedCandidate[]> {
    try {
        // Helper to get plural form (potato → potatoes)
        const pluralize = (word: string): string => {
            if (word.endsWith('o')) return word + 'es';  // potato → potatoes
            if (word.endsWith('y')) return word.slice(0, -1) + 'ies';  // berry → berries
            return word + 's';
        };

        // FDC API returns DIFFERENT results for singular vs plural!
        // e.g., "potato" → "Bread, potato", "Flour, potato"
        //       "potatoes" → "POTATOES" (raw ingredient)
        // So we search BOTH forms and merge results
        const queryLower = query.toLowerCase().trim();
        const pluralQuery = queryLower.endsWith('s') ? queryLower : pluralize(queryLower);
        const singularQuery = queryLower.endsWith('s') ? queryLower.slice(0, -1) : queryLower;

        // Fetch more results initially for re-ranking (2.5x requested limit)
        const fetchLimit = Math.min(limit * 2, 16);  // Reduced since we're doing 2 queries

        // Search both forms in parallel
        const [singularResults, pluralResults] = await Promise.all([
            fdcApi.searchFoods({ query: singularQuery, pageSize: fetchLimit }),
            singularQuery !== pluralQuery
                ? fdcApi.searchFoods({ query: pluralQuery, pageSize: fetchLimit })
                : Promise.resolve({ foods: [] })
        ]);

        // Merge and dedupe results (by fdcId)
        const seenIds = new Set<string>();
        const allFoods: any[] = [];

        // Add plural results first (usually better for raw ingredients)
        for (const food of pluralResults?.foods || []) {
            if (!seenIds.has(String(food.fdcId))) {
                seenIds.add(String(food.fdcId));
                allFoods.push({ ...food, _queryForm: 'plural' });
            }
        }
        // Then add singular results
        for (const food of singularResults?.foods || []) {
            if (!seenIds.has(String(food.fdcId))) {
                seenIds.add(String(food.fdcId));
                allFoods.push({ ...food, _queryForm: 'singular' });
            }
        }

        if (allFoods.length === 0) return [];

        // Map all results with their original position
        const allCandidates = allFoods.map((food: any, position: number) => {
            const nutrients = food.foodNutrients || [];
            const getNutrientValue = (ids: number[]) => {
                const n = nutrients.find((x: any) => ids.includes(x.nutrientId));
                return n?.value || 0;
            };

            const dataType = food.dataType || '';
            const isHighQuality = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'].some(t => dataType.includes(t));
            const baseScore = computePositionScore(query, food.description, position, { isHighQualityFdc: isHighQuality });
            const priorityScore = computeFdcPriorityScore(query, food.description);

            return {
                id: String(food.fdcId),
                source: 'fdc' as const,
                name: normalizeFdcName(food.description),
                brandName: food.brandName || null,
                score: baseScore,
                foodType: dataType || 'Generic',
                nutrition: {
                    // Energy: 1008 (SR Legacy), 2047 (Atwater General), 2048 (Atwater Specific)
                    kcal: getNutrientValue([1008, 2047, 2048]),
                    // Protein: 1003
                    protein: getNutrientValue([1003]),
                    // Carbs: 1005
                    carbs: getNutrientValue([1005]),
                    // Fat: 1004
                    fat: getNutrientValue([1004]),
                    per100g: true,
                },
                rawData: food,
                _priorityScore: priorityScore,
                _originalPosition: position,
            };
        });

        // Stable sort by priorityScore (descending), then original position (ascending)
        allCandidates.sort((a, b) => {
            const priorityDiff = b._priorityScore - a._priorityScore;
            if (priorityDiff !== 0) return priorityDiff;
            return a._originalPosition - b._originalPosition;
        });

        // Check if we promoted any candidates
        const promotedCandidates = allCandidates.filter((c, newPos) =>
            newPos < limit && c._originalPosition >= limit
        );

        // Log rerank results
        if (promotedCandidates.length > 0 || allCandidates.length > 0) {
            logger.info('fdc.rerank', {
                query,
                fetchedCount: allCandidates.length,
                promotedCount: promotedCandidates.length,
                promoted: promotedCandidates.slice(0, 3).map(c => ({
                    name: c.name,
                    from: c._originalPosition,
                    priority: c._priorityScore,
                })),
                finalTop3: allCandidates.slice(0, 3).map(c => ({
                    name: c.name,
                    origPos: c._originalPosition,
                    priority: c._priorityScore,
                })),
            });
        }

        // Take top N and remove internal properties
        return allCandidates.slice(0, limit).map(({ _priorityScore, _originalPosition, ...candidate }) => candidate);
    } catch (err) {
        logger.warn('gather.fdc.search_failed', { query, error: (err as Error).message });
        return [];
    }
}


// ============================================================
// Search Query Building
// ============================================================

// British to American ingredient translations
// Also includes common search term expansions for better API coverage
const BRITISH_TO_AMERICAN: Record<string, string[]> = {
    // Ice cubes → also search "ice" (FDC returns "ICE" for "ice" but not "ice cubes")
    'ice cubes': ['ice', 'frozen water'],
    'ice cube': ['ice', 'frozen water'],
    'courgette': ['zucchini', 'zucchini squash'],
    'courgettes': ['zucchini', 'zucchini squash'],
    'aubergine': ['eggplant'],
    'aubergines': ['eggplant', 'eggplants'],
    'coriander': ['cilantro', 'fresh cilantro'],
    'rocket': ['arugula', 'arugula salad'],
    'spring onion': ['green onion', 'scallion', 'scallions'],
    'spring onions': ['green onions', 'scallions'],
    'mange tout': ['snow peas', 'sugar snap peas'],
    'mangetout': ['snow peas', 'sugar snap peas'],
    'swede': ['rutabaga'],
    'single cream': ['light cream', 'half and half', 'coffee cream'],
    'light cream': ['half and half', 'coffee cream', 'table cream', 'cream'],  // Fallbacks if 'light cream' has no results
    'double cream': ['heavy cream', 'heavy whipping cream', 'whipping cream'],
    'clotted cream': ['heavy cream'],
    'caster sugar': ['superfine sugar', 'baker\'s sugar'],
    'icing sugar': ['powdered sugar', 'confectioners sugar'],
    'bicarbonate of soda': ['baking soda'],
    'plain flour': ['all purpose flour', 'all-purpose flour'],
    'self raising flour': ['self rising flour'],
    'self-raising flour': ['self rising flour'],
    'mince': ['ground beef', 'ground meat'],
    'minced beef': ['ground beef'],
    'minced pork': ['ground pork'],
    'prawns': ['shrimp'],
    'king prawns': ['large shrimp', 'jumbo shrimp'],
    'gammon': ['ham', 'ham steak'],
    'rashers': ['bacon', 'bacon strips'],
    'streaky bacon': ['bacon'],
    'back bacon': ['canadian bacon'],
    'biscuit': ['cookie', 'cookies'],
    'biscuits': ['cookies'],
    'chips': ['french fries', 'fries'],
    'crisps': ['potato chips', 'chips'],
    'jam': ['jelly', 'preserves'],
    'jelly': ['gelatin', 'jello'],
    'tin': ['can', 'canned'],
    'tinned': ['canned'],
};

// Dietary modifier synonyms (used in search expansion)
const DIETARY_SYNONYMS: Record<string, string[]> = {
    // Fat-free group (NOT the same as reduced-fat)
    'fat free': ['nonfat', 'non-fat', 'fat-free'],
    'fat-free': ['nonfat', 'non-fat', 'fat free'],
    'nonfat': ['fat free', 'non-fat', 'fat-free'],
    'non-fat': ['fat free', 'nonfat', 'fat-free'],
    // Reduced-fat group (separate from fat-free)
    'low fat': ['reduced fat', 'lowfat', 'low-fat', 'lite', 'light'],
    'lowfat': ['reduced fat', 'low fat', 'low-fat', 'lite', 'light'],
    'reduced fat': ['low fat', 'lowfat', 'low-fat', 'lite', 'light'],
    // Whole/skim (dairy)
    'whole milk': ['full fat milk'],
    'skim milk': ['nonfat milk', 'fat free milk'],
    // Sugar modifiers
    'sugar free': ['no sugar', 'unsweetened', 'sugar-free', 'diet', 'zero sugar'],
    'sugar-free': ['no sugar', 'unsweetened', 'sugar free', 'diet', 'zero sugar'],
    'unsweetened': ['no sugar', 'sugar free', 'sugar-free'],
    // Calorie modifiers (for sodas, syrups, dressings, etc.)
    'low calorie': ['diet', 'sugar free', 'sugar-free', 'zero calorie', 'calorie free', 'lite', 'light'],
    'low-calorie': ['diet', 'sugar free', 'sugar-free', 'zero calorie', 'calorie free', 'lite', 'light'],
    'diet': ['low calorie', 'sugar free', 'sugar-free', 'zero calorie', 'lite'],
    'zero calorie': ['diet', 'sugar free', 'calorie free', 'low calorie'],
    'calorie free': ['zero calorie', 'diet', 'sugar free', 'low calorie'],
    // Ground meat fat modifiers → lean ratios (applies to pork, beef, turkey, chicken)
    // USDA FDC uses "90% lean", "85% lean" etc. Also try ratio formats like "90/10"
    'reduced fat ground': ['lean ground', '90% lean ground', '93% lean ground', '90/10 ground', 'extra lean ground'],
    'low fat ground': ['lean ground', '90% lean ground', '85% lean ground', 'extra lean ground'],
    'reduced fat ground pork': ['lean ground pork', '90% lean ground pork', '93% lean ground pork', 'extra lean ground pork'],
    'reduced fat ground beef': ['lean ground beef', '90% lean ground beef', '93% lean ground beef', '85% lean ground beef', 'extra lean ground beef'],
    'reduced fat ground turkey': ['lean ground turkey', '93% lean ground turkey', '99% fat free ground turkey', 'extra lean ground turkey'],
    'reduced fat ground chicken': ['lean ground chicken', '93% lean ground chicken', 'extra lean ground chicken'],
    // Also handle queries that already have "lean" but need more specific versions
    'lean ground beef': ['90% lean ground beef', '85% lean ground beef', '93% lean ground beef'],
    'lean ground pork': ['90% lean ground pork', '93% lean ground pork'],
    'lean ground turkey': ['93% lean ground turkey', '99% fat free ground turkey'],
};


function expandWithSynonyms(query: string): string[] {
    const lower = query.toLowerCase();
    const expanded: string[] = [query];

    // Check for British terms and add American equivalents
    for (const [british, american] of Object.entries(BRITISH_TO_AMERICAN)) {
        if (lower.includes(british)) {
            // Add American versions
            for (const us of american) {
                const americanized = lower.replace(british, us);
                if (!expanded.map(e => e.toLowerCase()).includes(americanized)) {
                    expanded.push(americanized);
                }
            }
        }
    }

    // Check for dietary modifiers and add synonyms for search coverage
    for (const [modifier, synonyms] of Object.entries(DIETARY_SYNONYMS)) {
        if (lower.includes(modifier)) {
            // Add variations with different modifier terms
            for (const syn of synonyms) {
                const variant = lower.replace(modifier, syn);
                if (!expanded.map(e => e.toLowerCase()).includes(variant)) {
                    expanded.push(variant);
                }
            }
            break;  // Only expand one modifier to avoid explosion
        }
    }

    return expanded;
}

function buildSearchQueries(normalizedName: string, parsed: ParsedIngredient | null, aiSynonyms: string[] = []): string[] {
    const queries: string[] = [];
    const seen = new Set<string>();

    // Helper to get singular form (eggs → egg, potatoes → potato)
    const singularize = (word: string): string => {
        if (word.endsWith('ies')) return word.slice(0, -3) + 'y'; // berries → berry
        if (word.endsWith('oes')) return word.slice(0, -2); // potatoes → potato
        if (word.endsWith('es')) return word.slice(0, -2); // tomatoes → tomato
        if (word.endsWith('s') && word.length > 2) return word.slice(0, -1); // eggs → egg
        return word;
    };

    // Helper to get plural form (egg → eggs, potato → potatoes)
    const pluralize = (word: string): string => {
        if (word.endsWith('y') && !/[aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies'; // berry → berries
        if (word.endsWith('o')) return word + 'es'; // potato → potatoes
        if (word.endsWith('s') || word.endsWith('x') || word.endsWith('ch') || word.endsWith('sh')) return word + 'es';
        return word + 's';
    };

    // Helper to add both singular and plural forms
    const addWithVariants = (query: string) => {
        const lower = query.toLowerCase();
        const words = lower.split(/\s+/);
        const lastWord = words[words.length - 1];

        // Add original
        if (!seen.has(lower)) {
            queries.push(query);
            seen.add(lower);
        }

        // Add singular variant (if it ends with 's')
        if (lastWord.endsWith('s') && lastWord.length > 2) {
            const singular = [...words.slice(0, -1), singularize(lastWord)].join(' ');
            if (!seen.has(singular)) {
                queries.push(singular);
                seen.add(singular);
            }
        }

        // Add plural variant (if it doesn't end with 's')
        if (!lastWord.endsWith('s') && lastWord.length > 2) {
            const plural = [...words.slice(0, -1), pluralize(lastWord)].join(' ');
            if (!seen.has(plural)) {
                queries.push(plural);
                seen.add(plural);
            }
        }
    };

    // Primary: normalized name and its synonyms
    if (normalizedName) {
        const expanded = expandWithSynonyms(normalizedName);
        for (const q of expanded) {
            addWithVariants(q);
        }
    }

    // Parsed name if different
    if (parsed?.name && !seen.has(parsed.name.toLowerCase())) {
        const expanded = expandWithSynonyms(parsed.name);
        for (const q of expanded) {
            addWithVariants(q);
        }
    }

    // Add AI-generated synonyms
    for (const synonym of aiSynonyms) {
        if (synonym && !seen.has(synonym.toLowerCase())) {
            queries.push(synonym);
            seen.add(synonym.toLowerCase());
        }
    }

    return queries.slice(0, 10); // Limit to 10 expressions (increased for singular/plural variants)
}

// ============================================================
// Cache Search
// ============================================================

// rawLine is used for dietary modifier detection (more reliable than search query)
async function searchCache(queries: string[], limit: number, rawLine: string): Promise<UnifiedCandidate[]> {
    const candidates: UnifiedCandidate[] = [];
    const seenIds = new Set<string>();

    for (const query of queries) {
        try {
            const results = await searchFatSecretCacheFoods(query, limit);

            // Track position within this query's results
            let position = 0;
            for (const food of results) {
                if (seenIds.has(food.id)) continue;
                seenIds.add(food.id);

                // Use position-based scoring with rawLine for modifier detection
                const score = computePositionScore(rawLine, food.name, position);

                candidates.push({
                    id: food.id,
                    source: 'cache',
                    name: food.name,
                    brandName: food.brandName,
                    score,
                    foodType: food.foodType || 'Generic',
                    nutrition: extractCacheNutritionForCandidate(food),
                    servings: extractCacheServings(food),
                    rawData: food,
                });

                position++;
            }
        } catch (err) {
            logger.warn('gather.cache.search_failed', { query, error: (err as Error).message });
        }
    }

    return candidates;
}

// ============================================================
// Live FatSecret API Search
// ============================================================

// rawLine is used for dietary modifier detection (more reliable than search query)
async function searchFatSecretLive(
    client: FatSecretClient,
    queries: string[],
    limit: number,
    rawLine: string
): Promise<UnifiedCandidate[]> {
    const candidates: UnifiedCandidate[] = [];
    const seenIds = new Set<string>();

    for (const query of queries) {
        try {
            const results = await client.searchFoodsV4(query, { maxResults: limit });

            // Track position within this query's results
            let position = 0;
            for (const food of results) {
                if (seenIds.has(food.id)) continue;
                seenIds.add(food.id);

                // Use position-based scoring with rawLine for modifier detection
                const score = computePositionScore(rawLine, food.name, position);

                candidates.push({
                    id: food.id,
                    source: 'fatsecret',
                    name: food.name,
                    brandName: food.brandName,
                    score,
                    foodType: food.foodType || 'Generic',
                    rawData: food,
                });

                position++;
            }
        } catch (err) {
            logger.warn('gather.live.search_failed', { query, error: (err as Error).message });
        }
    }

    return candidates;
}

// ============================================================
// Dietary Modifier Detection (shared)
// ============================================================
const DIETARY_MODIFIERS = {
    fatFree: ['fat free', 'fat-free', 'nonfat', 'non-fat', 'skim'],
    reducedFat: ['reduced fat', 'low fat', 'lowfat', 'low-fat', 'lite', 'light', '2%', '1%'],
    unsweetened: ['unsweetened', 'no sugar', 'sugar free', 'sugar-free', 'no added sugar'],
    sweetened: ['sweetened', 'sugar', 'honey'],
    whole: ['whole', 'full fat', 'regular'],
};

function detectDietaryModifier(text: string): {
    fatFree: boolean;
    reducedFat: boolean;
    unsweetened: boolean;
    sweetened: boolean;
    whole: boolean;
} {
    const lower = text.toLowerCase();
    return {
        fatFree: DIETARY_MODIFIERS.fatFree.some(t => lower.includes(t)),
        reducedFat: DIETARY_MODIFIERS.reducedFat.some(t => lower.includes(t)),
        unsweetened: DIETARY_MODIFIERS.unsweetened.some(t => lower.includes(t)),
        sweetened: DIETARY_MODIFIERS.sweetened.some(t => lower.includes(t)),
        whole: DIETARY_MODIFIERS.whole.some(t => lower.includes(t)),
    };
}

/**
 * Calculate position-based score with dietary modifier penalties
 * TRUSTS the API order - #1 result = 0.95, #2 = 0.93, etc.
 * Only penalizes for OBVIOUS dietary modifier mismatches
 */
function computePositionScore(
    query: string,
    foodName: string,
    position: number,
    options?: { isHighQualityFdc?: boolean }
): number {
    // Base score from position (respects API order)
    // Position 0 = 0.95, Position 1 = 0.93, Position 9 = 0.77
    let score = Math.max(0.5, 0.95 - (position * 0.02));

    const queryLower = query.toLowerCase().replace(/[0-9]+/g, '').trim();
    const foodLower = foodName.toLowerCase().trim();

    if (queryLower.includes('salsa') && foodLower.includes('roma')) {
        logger.info('computePositionScore.debug', { queryLower, foodLower, baseScore: score });
    }

    // ============================================================
    // Exact/Near-Exact Name Match Boost
    // ============================================================
    // "potatoes" should match "POTATOES" (1.5x boost), not "Boiled Potato" (no boost)
    // Extract the MAIN ingredient word (usually the last significant word)
    // e.g., "4 medium potatoes" → "potatoes"
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    const mainIngredient = queryWords[queryWords.length - 1] || queryLower; // Last word is usually the ingredient
    const foodWords = foodLower.split(/\s+/).filter(w => w.length > 2);
    const foodMain = foodWords[foodWords.length - 1] || foodLower;

    // Check for exact main ingredient match (potatoes = potatoes)
    if (mainIngredient === foodMain || mainIngredient === foodLower || foodMain === queryLower) {
        if (queryLower.includes('salsa') && foodLower.includes('roma')) logger.info('boost.exact_ingredient', { mainIngredient, foodMain });
        score *= 1.5;  // 50% boost for exact ingredient match
    } else if (foodLower === mainIngredient || foodLower.startsWith(mainIngredient)) {
        if (queryLower.includes('salsa') && foodLower.includes('roma')) logger.info('boost.simple_name', { mainIngredient, foodLower });
        score *= 1.4;  // 40% boost for simple name match (POTATOES = potatoes query)
    } else if (foodLower.includes(mainIngredient)) {
        if (queryLower.includes('salsa') && foodLower.includes('roma')) logger.info('boost.contains', { mainIngredient, foodLower });
        score *= 1.1;  // 10% boost for contains (diced potatoes contains potatoes)
    }
    // "Boiled Potato" when query is "potatoes" - foodMain is "potato" which doesn't match "potatoes"
    // Extract queryCore for use later
    const queryCore = mainIngredient;



    const queryMods = detectDietaryModifier(query);
    const foodMods = detectDietaryModifier(foodName);

    // ============================================================
    // Dietary Modifier Mismatch Penalties
    // ============================================================
    // Only penalize for OBVIOUS mismatches (user asked for X, got Y)

    // Fat modifiers (mutually exclusive groups)
    if (queryMods.fatFree) {
        if (foodMods.fatFree) {
            score *= 1.1;  // Bonus for exact match
        } else if (foodMods.reducedFat) {
            score *= 0.4;  // Wrong modifier - user wanted fat-free, got reduced
        } else if (foodMods.whole) {
            score *= 0.3;  // Definitely wrong - user wanted fat-free, got whole
        } else {
            score *= 0.7;  // No modifier - might be okay, small penalty
        }
    } else if (queryMods.reducedFat) {
        if (foodMods.reducedFat) {
            score *= 1.1;
        } else if (foodMods.fatFree) {
            score *= 0.6;  // Different modifier
        } else if (foodMods.whole) {
            score *= 0.4;
        }
    }

    // Sugar modifiers
    if (queryMods.unsweetened) {
        if (foodMods.unsweetened) {
            score *= 1.1;
        } else if (foodMods.sweetened) {
            score *= 0.3;  // Definitely wrong
        } else {
            score *= 0.7;
        }
    }

    // ============================================================
    // Basic Vegetables/Legumes: Prefer "fat not added" & "boiled" versions
    // ============================================================
    // For basic produce like potatoes, lentils, when no fat modifier in query,
    // boost candidates with "fat not added", "boiled", "plain" in the name
    // and penalize candidates that suggest added fat ("roasted", generic without qualifier)
    // NOTE: queryLower and foodLower already defined above

    const BASIC_PRODUCE = ['potato', 'potatoes', 'lentil', 'lentils', 'beans', 'chickpea', 'chickpeas', 'rice', 'pasta', 'spinach', 'broccoli', 'carrot', 'carrots'];
    const isBasicProduce = BASIC_PRODUCE.some(p => foodLower.includes(p) || queryCore.includes(p));


    if (isBasicProduce && !queryMods.fatFree && !queryMods.reducedFat) {
        // Query is for basic produce without explicit fat modifier
        // Check food name for fat-related indicators

        const hasNoFatIndicator =
            foodLower.includes('fat not added') ||
            foodLower.includes('without fat') ||
            foodLower.includes('no fat') ||
            foodLower.includes('boiled') ||
            foodLower.includes('steamed') ||
            foodLower.includes('plain') ||
            foodLower.includes('raw') ||
            foodLower.includes('mature seeds');

        const hasFatAddedIndicator =
            foodLower.includes('fat added') ||
            foodLower.includes('with oil') ||
            foodLower.includes('fried') ||
            foodLower.includes('roasted') ||  // Often implies oil
            foodLower.includes('sauteed') ||
            foodLower.includes('au gratin') ||
            foodLower.includes('mashed');  // Often has butter

        if (hasNoFatIndicator) {
            score *= 1.25;  // Significant boost for explicitly low-fat versions
        } else if (hasFatAddedIndicator) {
            score *= 0.6;   // Penalty for versions with added fat
        }
        // Note: Generic names like "Potato" or "Cooked Lentils" get no change,
        // but the no-fat versions will now outscore them
    }

    // Boost for high-quality FDC items (SR Legacy, Foundation)
    // Extra boost for basic produce since USDA data is more accurate
    if (options?.isHighQualityFdc) {
        if (isBasicProduce) {
            score *= 1.6;  // 60% boost for FDC with basic produce (USDA data is best source)
        } else {
            score *= 1.15;  // 15% boost for other FDC items
        }
    }

    // ============================================================
    // Missing Query Term Penalty
    // ============================================================
    // If the query contains significant words ("salsa", "soup") that are missing
    // from the food name, penalize significantly.
    // e.g., Query: "tomato salsa" -> Food: "roma tomato" (Missing "salsa") -> Penalty!

    const significantWords = queryLower.split(/\s+/).filter(w =>
        w.length > 2 &&
        !['tomato', 'tomatoes', 'fresh', 'raw', 'vegetable', 'fruit', 'organic'].includes(w)
    );

    for (const word of significantWords) {
        // Singularize for check (salsas -> salsa)
        const singular = word.endsWith('s') ? word.slice(0, -1) : word;

        if (!foodLower.includes(word) && !foodLower.includes(singular)) {
            // Check if it's truly a missing important concept
            // (Exclude cases where the concept is implied or handled by other logic)
            if (['salsa', 'soup', 'stew', 'juice', 'puree', 'paste', 'sauce'].includes(singular)) {
                score *= 0.5; // Heavy penalty for missing form/dish type
                if (queryLower.includes('salsa') && foodLower.includes('roma')) {
                    logger.info('penalty.missing_term', { word, score });
                }
            } else {
                score *= 0.85; // Moderate penalty for other missing words
            }
        }
    }

    // ============================================================
    // Unexpected Dish Term Penalty
    // ============================================================
    // If the food name contains dish-modifying words ("smoothie", "pie", "cake")
    // that are NOT in the query, penalize.
    // e.g., Query: "strawberry" -> Food: "Strawberry Smoothie" (Unexpected "smoothie") -> Penalty!

    const DISH_TERMS = ['smoothie', 'pie', 'cake', 'bread', 'muffin', 'juice', 'sauce', 'soup', 'stew', 'casserole', 'salad', 'pizza', 'sandwich', 'burger', 'dip', 'jam', 'jelly', 'yogurt', 'ice cream', 'shake'];

    // Only apply if query itself isn't asking for a dish
    const queryHasDishTerm = DISH_TERMS.some(term => queryLower.includes(term));

    if (!queryHasDishTerm) {
        const foodWords = foodLower.split(/\s+/).map(w => w.replace(/[^a-z]/g, '')); // Simple word extraction

        for (const term of DISH_TERMS) {
            if (foodWords.includes(term) || foodWords.includes(term + 's')) {
                score *= 0.6; // Heavy penalty for unexpected dish form
                // Log for debugging specific cases
                if (queryLower.includes('strawberry') && foodLower.includes('smoothie')) {
                    logger.info('penalty.unexpected_dish', { term, score });
                }
                break; // Apply penalty once is enough
            }
        }
    }

    return Math.max(0, Math.min(1, score));
}



// rawLine is used for dietary modifier detection (more reliable than search query)
async function searchFdcMultiple(queries: string[], limit: number, rawLine: string): Promise<UnifiedCandidate[]> {
    const candidates: UnifiedCandidate[] = [];
    const seenIds = new Set<string>();

    for (const query of queries) {
        try {
            const results = await fdcApi.searchFoods({ query, pageSize: limit });
            if (!results?.foods?.length) continue;

            // Track position within this query's results
            let position = 0;
            for (const food of results.foods) {
                if (seenIds.has(String(food.fdcId))) continue;
                seenIds.add(String(food.fdcId));

                // Extract nutrients from search result
                const nutrients = (food as any).foodNutrients || [];
                const getNutrientValue = (ids: number[]) => {
                    const n = nutrients.find((x: any) => ids.includes(x.nutrientId));
                    return n?.value || 0;
                };

                // Normalize FDC name format (e.g., "beef, ground, 80% lean" → "80% lean ground beef")
                const normalizedName = normalizeFdcName(food.description);
                const dataType = food.dataType || '';
                const baseScore = computePositionScore(rawLine, normalizedName, position, {
                    isHighQualityFdc: ['Foundation', 'SR Legacy', 'Survey (FNDDS)'].some(t => dataType.includes(t))
                });

                candidates.push({
                    id: String(food.fdcId),
                    source: 'fdc' as const,
                    name: normalizedName,
                    brandName: food.brandName || null,
                    score: baseScore,
                    foodType: dataType || 'Generic',
                    nutrition: {
                        kcal: getNutrientValue([1008, 2047, 2048]),
                        protein: getNutrientValue([1003]),
                        carbs: getNutrientValue([1005]),
                        fat: getNutrientValue([1004]),
                        per100g: true,
                    },
                    rawData: food,
                });

                position++;
            }
        } catch (err) {
            logger.warn('gather.fdc.search_failed', { query, error: (err as Error).message });
        }
    }

    return candidates;
}

// Legacy single-query function (keeping for compatibility)
async function searchFdc(query: string, limit: number, rawLine: string): Promise<UnifiedCandidate[]> {
    return searchFdcMultiple([query], limit, rawLine);
}

// ============================================================
// FDC Name Normalization
// ============================================================

/**
 * Normalize FDC name formats like "Beef, ground, 80% lean" to "80% lean ground beef"
 */
function normalizeFdcName(description: string): string {
    // Pattern: "Noun, adjective1, adjective2, ..." → "adjective1 adjective2 noun"
    const parts = description.split(/,\s*/);
    if (parts.length <= 1) return description;

    // First part is usually the main noun
    const mainNoun = parts[0].toLowerCase();
    const qualifiers = parts.slice(1).map(p => p.toLowerCase().trim());

    // Reconstruct as "qualifiers mainNoun"
    return [...qualifiers, mainNoun].join(' ').trim();
}

// ============================================================
// Modifier Detection for Scoring Penalties
// ============================================================

// Modifiers that should only match when explicitly requested
const DIET_MODIFIERS = [
    // Fat-related
    'nonfat', 'non-fat', 'lowfat', 'low-fat', 'low fat', 'reduced fat',
    'fat free', 'fat-free', 'lite', 'light', 'skim', 'part skim', 'part-skim',
    'fat reduced', 'extra lean', 'lean',
    // Sweetness-related
    'unsweetened', 'no sugar', 'sugar free', 'sugar-free', 'no added sugar',
    'sweetened', 'lightly sweetened',
    // Dietary restrictions
    'gluten free', 'gluten-free', 'dairy free', 'dairy-free', 'lactose free',
    'vegan', 'vegetarian', 'keto', 'paleo',
    // Health/organic
    'organic', 'natural', 'all natural', 'whole grain', 'whole wheat',
    'multigrain', 'multi-grain', 'enriched', 'fortified',
    // Sodium
    'low sodium', 'no salt', 'salt free', 'reduced sodium', 'unsalted',
    // Calorie
    'low calorie', 'diet', 'zero calorie', 'calorie free',
];

/**
 * Check if text contains any diet/health modifiers
 */
function detectModifiers(text: string): string[] {
    const lower = text.toLowerCase();
    return DIET_MODIFIERS.filter(mod => lower.includes(mod));
}

// Product noise words (common in complex product names but not ingredients)
const PRODUCT_NOISE_WORDS = new Set([
    'with', 'lollipop', 'candy', 'bar', 'cake', 'cookie', 'muffin',
    'bread', 'sauce', 'dressing', 'spread', 'toppings', 'flavor',
    'style', 'recipe', 'homemade', 'original', 'classic',
]);

// ============================================================
// Brand Detection
// ============================================================

const KNOWN_BRANDS = new Set([
    // Major grocery chains
    'trader joe', 'trader joes', 'whole foods', 'costco', 'kroger', 'walmart',
    'target', 'safeway', 'albertsons', 'publix', 'wegmans', 'aldi', 'lidl',
    // Store brands
    'great value', 'kirkland', 'simply nature', '365', 'market pantry',
    'good & gather', 'o organics', 'signature select',
    // Popular food brands
    'organic valley', 'horizon', 'stonyfield', 'chobani', 'fage', 'oikos',
    'dannon', 'yoplait', 'kashi', 'kind', 'clif', 'rxbar', 'quest',
    'silk', 'almond breeze', 'califia', 'oatly', 'so delicious',
    'applegate', 'oscar mayer', 'tyson', 'perdue', 'foster farms',
    'barilla', 'delallo', 'rao', 'bertolli', 'classico', 'prego',
    'heinz', 'hunts', 'muir glen', 'red gold',
    'tillamook', 'sargento', 'kraft', 'philadelphia', 'cabot',
    'kerrygold', 'land o lakes', 'challenge', 'plugra',
    'bob red mill', 'bobs red mill', 'king arthur', 'gold medal',
    'nutrisystem', 'lean cuisine', 'healthy choice', 'amy',
    'simply', 'minute maid', 'tropicana', 'ocean spray',
    'lindt', 'ghirardelli', 'godiva', 'hershey', 'nestle',
]);

/**
 * Check if query contains a known brand name
 * If user mentions a brand, we should NOT penalize branded candidates
 */
function detectBrandInQuery(query: string): boolean {
    const lower = query.toLowerCase();
    return Array.from(KNOWN_BRANDS).some(brand => lower.includes(brand));
}

function computeBaseScore(query: string, foodName: string, brandName?: string | null): number {
    const queryLower = query.toLowerCase();
    const foodLower = foodName.toLowerCase();
    const brandLower = brandName?.toLowerCase() || '';

    // Token extraction
    const queryTokens = new Set(queryLower.split(/\s+/).filter(t => t.length > 2));
    const foodTokens = new Set(foodLower.split(/\s+/).filter(t => t.length > 2));
    const queryTokenArray = Array.from(queryTokens);
    const foodTokenArray = Array.from(foodTokens);

    // Calculate overlap
    let overlap = 0;
    for (const t of queryTokens) {
        if (foodTokens.has(t) || brandLower.includes(t)) overlap++;
    }

    let score = queryTokens.size > 0 ? overlap / queryTokens.size : 0;

    // Exact match bonus
    if (queryLower === foodLower) return 1.0;

    // Contains bonus (but with caveats)
    if (foodLower.includes(queryLower)) {
        // Check if query is at the START of food name (primary ingredient)
        if (foodLower.startsWith(queryLower)) {
            score = 0.9 + score * 0.1;  // High score for primary ingredient
        } else {
            // Query is in the middle/end - might be a flavor or secondary ingredient
            score = 0.6 + score * 0.2;
        }
    } else if (queryLower.includes(foodLower)) {
        score = 0.8 + score * 0.2;
    }

    // ============================================================
    // Token Ratio Penalty: Penalize complex products
    // ============================================================
    // If candidate has many more tokens than query, it's likely a complex product
    // e.g., "chili powder" (2 tokens) vs "Muecas Lollipop with Chili Powder" (5 tokens)
    const tokenRatio = foodTokenArray.length / Math.max(queryTokenArray.length, 1);
    if (tokenRatio > 2.0) {
        // Food has more than 2x the tokens of query - significant complexity
        score *= 0.5;
    } else if (tokenRatio > 1.5) {
        // Food has 1.5-2x tokens - moderate complexity
        score *= 0.7;
    }

    // ============================================================
    // Compound Product Detection: Check for product noise words
    // ============================================================
    const hasProductNoiseWords = foodTokenArray.some(t => PRODUCT_NOISE_WORDS.has(t));
    const queryHasProductWords = queryTokenArray.some(t => PRODUCT_NOISE_WORDS.has(t));

    if (hasProductNoiseWords && !queryHasProductWords) {
        // Food is a complex product but query is a simple ingredient
        score *= 0.6;
    }

    // ============================================================
    // Multi-ingredient Detection: "X with Y", "X & Y", "X and Y"
    // ============================================================
    const multiIngredientPatterns = [
        /\bwith\b/i,
        /\b&\b/,
        /\band\b/i,
        /,/,  // Comma often indicates multiple components
    ];

    const foodHasMultipleIngredients = multiIngredientPatterns.some(p => p.test(foodLower));
    const queryHasMultipleIngredients = multiIngredientPatterns.some(p => p.test(queryLower));

    if (foodHasMultipleIngredients && !queryHasMultipleIngredients) {
        // Food has multiple ingredients but query is simple - penalize
        score *= 0.6;
    }

    // ============================================================
    // Modifier Penalty Logic (Enhanced)
    // ============================================================
    const queryModifiers = detectModifiers(queryLower);
    const foodModifiers = detectModifiers(foodLower);

    // Group related modifiers that should match each other
    const MODIFIER_GROUPS: string[][] = [
        ['lowfat', 'low-fat', 'low fat', 'reduced fat', 'lite', 'light'],
        ['nonfat', 'non-fat', 'fat free', 'fat-free', 'skim'],
        ['unsweetened', 'no sugar', 'sugar free', 'sugar-free', 'no added sugar'],
        ['gluten free', 'gluten-free'],
        ['dairy free', 'dairy-free', 'lactose free'],
    ];

    function findModifierGroup(mod: string): string[] | undefined {
        return MODIFIER_GROUPS.find(group => group.includes(mod));
    }

    function modifiersMatch(queryMods: string[], foodMods: string[]): boolean {
        for (const qMod of queryMods) {
            const group = findModifierGroup(qMod);
            if (group) {
                // Check if any modifier in the same group is in food
                if (foodMods.some(fMod => group.includes(fMod))) {
                    return true;
                }
            } else {
                // Exact match for modifiers not in a group
                if (foodMods.includes(qMod)) {
                    return true;
                }
            }
        }
        return false;
    }

    if (queryModifiers.length === 0 && foodModifiers.length > 0) {
        // Query wants REGULAR, food has modifiers → penalize
        score *= 0.5;
    } else if (queryModifiers.length > 0 && foodModifiers.length === 0) {
        // Query wants MODIFIED, food is regular → STRONG penalty
        // e.g., "lowfat milk" should NOT match "Whole Milk"
        score *= 0.4;
    } else if (queryModifiers.length > 0 && foodModifiers.length > 0) {
        // Both have modifiers - check if they match (considering groups)
        if (modifiersMatch(queryModifiers, foodModifiers)) {
            // Matching modifiers - bonus
            score *= 1.2;
            if (score > 1.0) score = 1.0;
        } else {
            // Different modifiers (e.g., "lowfat" vs "gluten-free") → penalize
            score *= 0.5;
        }
    }

    // ============================================================
    // Brand Preference: Penalize branded items for generic queries
    // ============================================================
    const queryHasBrand = detectBrandInQuery(queryLower);
    if (!queryHasBrand && brandName && brandLower) {
        // User didn't ask for a brand but candidate is branded
        // Apply gentle penalty to prefer generic items
        score *= 0.85;
    }

    // Ensure score is within bounds
    return Math.max(0, Math.min(1, score));
}

// ============================================================
// Cache Nutrition/Serving Extraction
// ============================================================

function extractCacheNutritionForCandidate(food: CacheFoodRecord): UnifiedCandidate['nutrition'] | undefined {
    // Use the cache-search helper to extract nutrients from the food's nutrientsPer100g
    const nutrients = extractCacheNutrients(food);
    if (!nutrients.calories && !nutrients.protein && !nutrients.carbs && !nutrients.fat) {
        return undefined;
    }

    return {
        kcal: nutrients.calories || 0,
        protein: nutrients.protein || 0,
        carbs: nutrients.carbs || 0,
        fat: nutrients.fat || 0,
        per100g: true,
    };
}

function extractCacheServings(food: CacheFoodRecord): UnifiedCandidate['servings'] {
    if (!food.servings?.length) return undefined;

    return food.servings.map(s => ({
        description: s.measurementDescription || 'serving',
        grams: s.servingWeightGrams || s.metricServingAmount || null,
        isDefault: s.isDefault || false,
    }));
}
