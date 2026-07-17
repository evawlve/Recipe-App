/**
 * Unified Candidate Gathering
 * 
 * Searches all data sources in parallel and returns a unified candidate list
 * for filtering and AI rerank selection.
 */

import { prisma } from '../db';
import { parseIngredientLine, type ParsedIngredient } from '../parse/ingredient-line';
import { normalizeIngredientName } from './normalization-rules';
import { logger } from '../logger';
import { searchOffSimple, searchOffSemantic } from '../openfoodfacts/search';
import { MEILISEARCH_ENABLED, SEARCH_PROVIDER } from './config';
import { searchMeili } from '../search/meilisearch-client';
import { SEMANTIC_SEARCH_ENABLED, warmupEmbedder } from '../search/query-embedding';

// Start loading the ONNX query-embedding model as soon as the mapping
// subsystem is loaded, so the first magic-log request doesn't pay for it.
warmupEmbedder();

// ============================================================
// Types
// ============================================================

export interface UnifiedCandidate {
    id: string;
    source: 'fdc' | 'openfoodfacts' | 'ai_generated';
    name: string;
    brandName?: string | null;
    score: number;
    /** Cosine similarity from semantic (vector) search, when the candidate was found or confirmed by it. */
    semanticSimilarity?: number;
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
    skipFdc?: boolean;
    maxPerSource?: number;
    aiSynonyms?: string[];  // AI-generated synonyms for retry searches
    skipOff?: boolean;     // Explicitly skip OpenFoodFacts (e.g. for quick gather gate checks)
    isBrandedQuery?: boolean;  // When true, always include OFF regardless of OFF_ENABLED flag
    targetBrand?: string;      // Matched brand name from static detector (e.g. "heinz") — used for FDC tiebreaking
    skipCache?: boolean;
    /**
     * Candidates from an earlier gather pass (e.g. the quick normalize-gate
     * check) to merge in instead of re-running the same searches. Use with
     * skipFdc when the seed already covers the FDC keyword sources.
     */
    seedCandidates?: UnifiedCandidate[];
}

// ============================================================
// Step 3: Multi-Query Gather Variants
// Modifier synonym groups for search expansion
// ============================================================

/**
 * Modifier synonym groups - each inner array represents equivalent terms.
 * Used to expand queries and find candidates with different modifier phrasings.
 * 
 * @example "fat free milk" → also search "nonfat milk", "skim milk"
 */
export const MODIFIER_SYNONYM_GROUPS: string[][] = [
    // Fat-free group (NOT the same as reduced-fat)
    ['fat free', 'fat-free', 'nonfat', 'non-fat', 'skim', '0%', 'zero fat'],
    // Reduced-fat group (separate from fat-free)
    ['reduced fat', 'low fat', 'lowfat', 'low-fat', 'light', 'lite', '2%', '1%'],
    // Sugar-free/unsweetened group - includes low-calorie equivalents
    // "sugar free cherry pie filling" should also find "low calorie cherry pie filling"
    ['unsweetened', 'no sugar added', 'sugar free', 'sugar-free', 'no sugar', 'zero sugar', 'low calorie', 'low-calorie', 'lite', 'light', 'diet'],
    // Whole grain group
    ['whole grain', 'whole wheat', 'wholegrain', 'wholewheat', 'whole-grain', 'whole-wheat'],
    // Extra lean group (ground meats)
    ['extra lean', 'extra-lean', '95%', '93%', '95% lean', '93% lean'],
    // Lean group (ground meats)
    ['lean', '90%', '85%', '90% lean', '85% lean', '90/10', '85/15'],
    // Organic group
    ['organic', 'certified organic'],
    // Regular/whole dairy
    ['whole', 'full fat', 'regular', 'full-fat'],
];

/**
 * Build expanded query variants with modifier synonyms.
 * Handles "fat free" ↔ "nonfat" ↔ "skim" style expansions.
 * 
 * @param parsed - Parsed ingredient (optional, can be null)
 * @param cleanedInput - The cleaned/normalized input string
 * @returns Array of query variants to search
 * 
 * @example
 * buildQueryVariants(parsed, "fat free milk") 
 * // → ["fat free milk", "nonfat milk", "skim milk", "fat-free milk", ...]
 */
export function buildQueryVariants(
    parsed: ParsedIngredient | null,
    cleanedInput: string
): string[] {
    const variants: string[] = [];
    const seen = new Set<string>();

    const addVariant = (v: string) => {
        const lower = v.toLowerCase().trim();
        if (lower && !seen.has(lower)) {
            seen.add(lower);
            variants.push(lower);
        }
    };

    // Start with the original cleaned input
    addVariant(cleanedInput);

    // Add parsed name if different
    if (parsed?.name && parsed.name.toLowerCase() !== cleanedInput.toLowerCase()) {
        addVariant(parsed.name);
    }

    const inputLower = cleanedInput.toLowerCase();

    // Find which modifier group(s) the input contains
    for (const group of MODIFIER_SYNONYM_GROUPS) {
        for (const modifier of group) {
            if (inputLower.includes(modifier)) {
                // Found a modifier - add variants with synonyms from the same group
                for (const synonym of group) {
                    if (synonym !== modifier) {
                        const variant = inputLower.replace(modifier, synonym);
                        addVariant(variant);
                    }
                }
                // Only expand one modifier group to avoid query explosion
                break;
            }
        }
    }

    // Limit to reasonable number of variants
    return variants.slice(0, 8);
}

// ============================================================
// Main Gather Function
// ============================================================

function mapFdcHitToCandidate(hit: any, query: string, position: number, targetBrand?: string) {
    let nutrients = hit.nutrientsPer100g || {};
    if (typeof nutrients === 'string') {
        try { nutrients = JSON.parse(nutrients); } catch (e) {}
    }
    let servings = hit.servings || [];
    if (typeof servings === 'string') {
        try { servings = JSON.parse(servings); } catch (e) {}
    }

    const dataType = hit.dataType || '';
    const isHighQuality = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'].some(t => dataType.includes(t));
    const baseScore = computePositionScore(query, hit.description, position, { isHighQualityFdc: isHighQuality });
    const priorityScore = computeFdcPriorityScore(query, hit.description, hit.brandName ?? null, targetBrand);

    return {
        id: `fdc_${hit.fdcId}`,
        source: 'fdc' as const,
        name: normalizeFdcName(hit.description),
        brandName: hit.brandName || null,
        score: baseScore,
        foodType: dataType || 'Generic',
        nutrition: {
            kcal: nutrients.calories ?? nutrients.kcal ?? nutrients.energy ?? 0,
            protein: nutrients.protein ?? 0,
            carbs: nutrients.carbs ?? nutrients.carbohydrate ?? 0,
            fat: nutrients.fat ?? nutrients.totalFat ?? 0,
            per100g: true,
        },
        servings: servings.map((s: any) => ({
            description: s.description,
            grams: s.grams
        })),
        rawData: {
            ...hit,
            nutrientsPer100g: nutrients,
            servings: servings
        },
        _priorityScore: priorityScore,
        _originalPosition: position,
    };
}

async function searchFdcLocal(query: string, limit: number, rawLine: string, targetBrand?: string): Promise<UnifiedCandidate[]> {
    const provider = SEARCH_PROVIDER;
    
    if (provider === 'meilisearch' && MEILISEARCH_ENABLED) {
        try {
            const hits = await searchMeili('fdc_foods', query, limit * 2);
            if (hits.length > 0) {
                const allCandidates = hits.map((hit, position) => mapFdcHitToCandidate(hit, query, position, targetBrand));

                // Stable sort by priorityScore (descending), then original position (ascending)
                allCandidates.sort((a, b) => {
                    const priorityDiff = b._priorityScore - a._priorityScore;
                    if (priorityDiff !== 0) return priorityDiff;
                    return a._originalPosition - b._originalPosition;
                });

                const mappedHits = allCandidates.slice(0, limit).map(({ _priorityScore, _originalPosition, ...candidate }) => candidate);
                logger.debug('gather.fdc.meilisearch_hit', { query, count: mappedHits.length });
                return mappedHits;
            }
        } catch (err) {
            logger.warn('gather.fdc.meilisearch_failed_fallback_to_postgres', { query, error: (err as Error).message });
        }
    } else if (provider === 'typesense') {
        try {
            const { searchTypesense } = await import('../search/typesense-client');
            const hits = await searchTypesense('fdc_foods', query, 'description,brandName', limit * 2);
            if (hits.length > 0) {
                const allCandidates = hits.map((hit, position) => mapFdcHitToCandidate(hit, query, position, targetBrand));

                allCandidates.sort((a, b) => {
                    const priorityDiff = b._priorityScore - a._priorityScore;
                    if (priorityDiff !== 0) return priorityDiff;
                    return a._originalPosition - b._originalPosition;
                });

                const mappedHits = allCandidates.slice(0, limit).map(({ _priorityScore, _originalPosition, ...candidate }) => candidate);
                logger.debug('gather.fdc.typesense_hit', { query, count: mappedHits.length });
                return mappedHits;
            }
        } catch (err) {
            logger.warn('gather.fdc.typesense_failed_fallback_to_postgres', { query, error: (err as Error).message });
        }
    } else if (provider === 'redisearch') {
        try {
            const { searchRediSearch } = await import('../search/redisearch-client');
            const hits = await searchRediSearch('fdc_foods', query, limit * 2);
            if (hits.length > 0) {
                const allCandidates = hits.map((hit, position) => mapFdcHitToCandidate(hit, query, position, targetBrand));

                allCandidates.sort((a, b) => {
                    const priorityDiff = b._priorityScore - a._priorityScore;
                    if (priorityDiff !== 0) return priorityDiff;
                    return a._originalPosition - b._originalPosition;
                });

                const mappedHits = allCandidates.slice(0, limit).map(({ _priorityScore, _originalPosition, ...candidate }) => candidate);
                logger.debug('gather.fdc.redisearch_hit', { query, count: mappedHits.length });
                return mappedHits;
            }
        } catch (err) {
            logger.warn('gather.fdc.redisearch_failed_fallback_to_postgres', { query, error: (err as Error).message });
        }
    }

    try {
        const queryLower = query.toLowerCase().trim();
        const results = await prisma.fdcFood.findMany({
            where: {
                description: {
                    contains: queryLower,
                    mode: 'insensitive'
                }
            },
            take: limit * 2, // Fetch more for priority sorting
            include: { servings: true }
        });

        const allCandidates = results.map((food, position) => {
            const dataType = food.dataType || '';
            const isHighQuality = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'].some(t => dataType.includes(t));
            const baseScore = computePositionScore(query, food.description, position, { isHighQualityFdc: isHighQuality });
            const priorityScore = computeFdcPriorityScore(query, food.description, food.brandName ?? null, targetBrand);

            const nutrients = (food.nutrientsPer100g as any) || {};

            return {
                id: `fdc_${food.fdcId}`,
                source: 'fdc' as const,
                name: normalizeFdcName(food.description),
                brandName: food.brandName || null,
                score: baseScore,
                foodType: dataType || 'Generic',
                nutrition: {
                    kcal: nutrients.calories ?? nutrients.kcal ?? nutrients.energy ?? 0,
                    protein: nutrients.protein ?? 0,
                    carbs: nutrients.carbs ?? nutrients.carbohydrate ?? 0,
                    fat: nutrients.fat ?? nutrients.totalFat ?? 0,
                    per100g: true,
                },
                servings: food.servings.map(s => ({
                    description: s.description,
                    grams: s.grams
                })),
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

        return allCandidates.slice(0, limit).map(({ _priorityScore, _originalPosition, ...candidate }) => candidate);
    } catch (err) {
        logger.warn('gather.fdc.local_search_failed', { query, error: (err as Error).message });
        return [];
    }
}

export async function gatherCandidates(
    rawLine: string,
    parsed: ParsedIngredient | null,
    normalizedName: string,
    options: GatherOptions = {}
): Promise<UnifiedCandidate[]> {
    const {
        skipFdc = false,
        skipOff = false,
        isBrandedQuery = false,
        targetBrand,
        maxPerSource = 8,  // Get top 8 from each source to ensure we find generic names
    } = options;

    // Feature flag: run OFF when explicitly branded OR env flag is set
    const offEnabled = isBrandedQuery || process.env.OFF_ENABLED === 'true';

    const trimmed = rawLine.trim();
    if (!trimmed) return [];

    const searchQuery = normalizedName || parsed?.name?.trim() || trimmed;

    // Expand British → American synonyms for the search query
    const expandedQueries = expandWithSynonyms(searchQuery);
    const primaryQuery = expandedQueries[0]; // Original query
    const britishSynonyms = expandedQueries.slice(1); // American equivalents

    const searchPromises: Promise<UnifiedCandidate[]>[] = [];

    // Local FDC search (for generic components)
    if (!skipFdc) {
        searchPromises.push(searchFdcLocal(primaryQuery, maxPerSource, rawLine, targetBrand));
        for (const britSyn of britishSynonyms.slice(0, 2)) {
            searchPromises.push(searchFdcLocal(britSyn, 4, rawLine, targetBrand));
        }
        if (options.aiSynonyms) {
            for (const syn of options.aiSynonyms.slice(0, 2)) {
                searchPromises.push(searchFdcLocal(syn, 2, rawLine, targetBrand));
            }
        }
    }

    // Local OFF search (for branded components)
    if (offEnabled && !skipOff) {
        searchPromises.push(
            searchOffSimple(primaryQuery, {
                limit: maxPerSource,
                isBrandedQuery,
            })
        );
    }

    // Semantic recall over the OFF embeddings — catches phrasings keyword
    // search misses ("protein yogurt" → "Oikos Triple Zero"). No-op unless
    // SEMANTIC_SEARCH_ENABLED=true.
    if (offEnabled && !skipOff && SEMANTIC_SEARCH_ENABLED) {
        searchPromises.push(
            searchOffSemantic(primaryQuery, {
                limit: maxPerSource,
                isBrandedQuery,
            })
        );
    }

    const results = await Promise.allSettled(searchPromises);

    // Collect candidates (deduplicate by ID)
    const candidates: UnifiedCandidate[] = [];
    const byId = new Map<string, UnifiedCandidate>();

    // Seed with candidates from a previous gather pass (already id-prefixed)
    for (const c of options.seedCandidates ?? []) {
        if (!byId.has(c.id)) {
            byId.set(c.id, c);
            candidates.push(c);
        }
    }

    for (const result of results) {
        if (result.status === 'fulfilled') {
            for (const c of result.value) {
                let id = c.id;
                if (c.source === 'fdc' && !id.startsWith('fdc_')) {
                    id = `fdc_${id}`;
                }

                const existing = byId.get(id);
                if (!existing) {
                    const candidate = { ...c, id };
                    byId.set(id, candidate);
                    candidates.push(candidate);
                } else if (c.semanticSimilarity !== undefined) {
                    // Keyword and semantic search agree on this candidate —
                    // keep the keyword version but carry the similarity signal.
                    existing.semanticSimilarity = Math.max(
                        existing.semanticSimilarity ?? 0,
                        c.semanticSimilarity
                    );
                }
            }
        }
    }

    logger.info('gather.candidates.complete', {
        rawLine,
        totalUnique: candidates.length,
        offEnabled,
        isBrandedQuery,
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

// ============================================================
// Noise Words (size/prep descriptors that shouldn't affect matching)
// ============================================================

/**
 * Words that describe size, preparation, or state but aren't the core ingredient.
 * These are filtered from token matching to prevent false confidence.
 * 
 * Without this: "long sweet potato" matches "Long Rice Noodles" (1/3 tokens = "long")
 * With this: "long" is filtered, only "sweet" + "potato" are required to match
 */
const NOISE_WORDS = new Set([
    // Size descriptors
    'long', 'short', 'tall', 'baby', 'mini', 'giant', 'jumbo',
    // Unit-like words that shouldn't affect food matching
    'bunch', 'bundle', 'sprig', 'stalk',
    // Common prep/flavor words that appear in product names
    'fresh', 'raw', 'whole', 'pure', 'natural', 'organic', 'buttery',
    // State descriptors
    'new', 'young', 'old',
]);

/**
 * Assess match confidence between query and a candidate result.
 * Uses token overlap and API position to determine confidence.
 * 
 * IMPORTANT: Filters out NOISE_WORDS from query tokens to prevent
 * false matches like "long sweet potato" → "Long Rice Noodles"
 */
export function assessConfidence(query: string, candidate: UnifiedCandidate): number {
    // Filter out noise words from query - these shouldn't affect matching
    const queryTokens = new Set(
        query.toLowerCase().split(/\s+/)
            .filter(t => t.length > 2 && !NOISE_WORDS.has(t))
    );
    const resultTokens = new Set(
        candidate.name.toLowerCase().split(/\s+/).filter(t => t.length > 2)
    );

    if (queryTokens.size === 0) return 0;

    // Token overlap coverage (now based on core tokens only)
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
    // NOTE: Words like 'rice' use word-boundary regex to avoid matching
    // compound foods where the word is a modifier (e.g., 'rice vinegar', 'rice paper')
    const BASIC_PRODUCE_PATTERNS: RegExp[] = [
        /\bpotato(es)?\b/i, /\bspinach\b/i, /\bbroccoli\b/i, /\bcarrots?\b/i,
        // 'rice' only when it's the core food, not a modifier
        // Matches: "rice", "brown rice", "fried rice", "jasmine rice"
        // Does NOT match: "rice vinegar", "rice wine", "rice paper", "rice noodles"
        /\brice\b(?!\s+(vinegar|wine|paper|noodle|flour|milk|bran|syrup|cake|cracker|wrapper))/i,
    ];
    
    // Explicitly prevent bypass for "canned", "cooked", "dried" variants, 
    // as they have significantly different nutrition from raw counterparts
    const isBasicProduce = BASIC_PRODUCE_PATTERNS.some(p => p.test(queryLower)) 
        && !/\b(canned|cooked|dried)\b/i.test(queryLower);

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

    // YEAST VARIANT PREFERENCE: When candidates include both "Compressed" and "Active Dry" yeast,
    // prefer Active Dry because home bakers typically use packets (7g each), not fresh cakes (17g each).
    // This prevents "1 package yeast" from mapping to Compressed at 125g/package.
    // IMPORTANT: Return early after swap to bypass margin check (both have 1.000 confidence)
    if (queryLower.includes('yeast') && candidates.length >= 2) {
        const compressedIdx = candidates.findIndex(c =>
            c.name.toLowerCase().includes('compressed')
        );
        const activeDryIdx = candidates.findIndex(c =>
            c.name.toLowerCase().includes('active dry')
        );

        // If Compressed is ranked higher than Active Dry, select Active Dry directly
        if (compressedIdx !== -1 && activeDryIdx !== -1 && compressedIdx < activeDryIdx) {
            const activeDry = candidates[activeDryIdx];
            logger.info('confidence_gate.yeast_rerank', {
                query,
                swappedFrom: candidates[compressedIdx].name,
                selectedDirect: activeDry.name,
            });
            // Return immediately to bypass margin check (both have same confidence)
            return {
                skipAiRerank: true,
                selected: activeDry,
                confidence: 0.95,  // High confidence for explicit preference
                reason: 'yeast_variant_preference'
            };
        }
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

// British to American ingredient translations
const BRITISH_TO_AMERICAN: Record<string, string[]> = {
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
    'marrow': ['zucchini', 'zucchini squash', 'summer squash'],
    'marrows': ['zucchini', 'zucchini squash', 'summer squash'],
    'baby marrows': ['zucchini', 'baby zucchini', 'small zucchini'],
    'single cream': ['light cream', 'half and half', 'coffee cream'],
    'light cream': ['half and half', 'coffee cream', 'table cream', 'cream'],
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
    'chilli': ['chili', 'hot pepper'],
    'chilli pepper': ['chili pepper', 'hot pepper', 'hot chili pepper'],
    'chilli peppers': ['chili peppers', 'hot peppers', 'hot chili peppers'],
    'chillies': ['chilies', 'hot peppers'],
    'blood orange peel': ['orange peel', 'citrus peel', 'orange zest'],
    'cara cara orange peel': ['orange peel', 'citrus peel'],
    'navel orange peel': ['orange peel', 'citrus peel'],
    'meyer lemon peel': ['lemon peel', 'citrus peel', 'lemon zest'],
    'bergamot peel': ['lemon peel', 'citrus peel'],
    'key lime peel': ['lime peel', 'citrus peel', 'lime zest'],
    'persian lime peel': ['lime peel', 'citrus peel'],
    'red pepper flakes': ['cayenne', 'crushed red pepper', 'red pepper spice'],
    'pepper flakes': ['cayenne', 'crushed red pepper', 'red pepper'],
};

// Dietary modifier synonyms
const DIETARY_SYNONYMS: Record<string, string[]> = {
    'fat free': ['nonfat', 'non-fat', 'fat-free'],
    'fat-free': ['nonfat', 'non-fat', 'fat free'],
    'nonfat': ['fat free', 'non-fat', 'fat-free'],
    'non-fat': ['fat free', 'nonfat', 'fat-free'],
    'low fat': ['reduced fat', 'lowfat', 'low-fat', 'lite', 'light'],
    'lowfat': ['reduced fat', 'low fat', 'low-fat', 'lite', 'light'],
    'reduced fat': ['low fat', 'lowfat', 'low-fat', 'lite', 'light'],
    'whole milk': ['full fat milk'],
    'skim milk': ['nonfat milk', 'fat free milk'],
    'sugar free': ['no sugar', 'unsweetened', 'sugar-free', 'diet', 'zero sugar'],
    'sugar-free': ['no sugar', 'unsweetened', 'sugar free', 'diet', 'zero sugar'],
    'unsweetened': ['no sugar', 'sugar free', 'sugar-free'],
    'low calorie': ['diet', 'sugar free', 'sugar-free', 'zero calorie', 'calorie free', 'lite', 'light'],
    'low-calorie': ['diet', 'sugar free', 'sugar-free', 'zero calorie', 'calorie free', 'lite', 'light'],
    'diet': ['low calorie', 'sugar free', 'sugar-free', 'zero calorie', 'lite'],
    'zero calorie': ['diet', 'sugar free', 'calorie free', 'low calorie'],
    'calorie free': ['zero calorie', 'diet', 'sugar free', 'low calorie'],
    'reduced fat ground': ['lean ground', '90% lean ground', '93% lean ground', '90/10 ground', 'extra lean ground'],
    'low fat ground': ['lean ground', '90% lean ground', '85% lean ground', 'extra lean ground'],
    'reduced fat ground pork': ['lean ground pork', '90% lean ground pork', '93% lean ground pork', 'extra lean ground pork'],
    'reduced fat ground beef': ['lean ground beef', '90% lean ground beef', '93% lean ground beef', '85% lean ground beef', 'extra lean ground beef'],
    'reduced fat ground turkey': ['lean ground turkey', '93% lean ground turkey', '99% fat free ground turkey', 'extra lean ground turkey'],
    'reduced fat ground chicken': ['lean ground chicken', '93% lean ground chicken', 'extra lean ground chicken'],
    'lean ground beef': ['90% lean ground beef', '85% lean ground beef', '93% lean ground beef'],
    'lean ground pork': ['90% lean ground pork', '93% lean ground pork'],
    'lean ground turkey': ['93% lean ground turkey', '99% fat free ground turkey'],
};

// Form/processing synonyms
const FORM_SYNONYMS: Record<string, string[]> = {
    'flakes': ['crushed', 'flaked'],
    'flaked': ['crushed', 'flakes'],
    'crushed': ['flakes', 'flaked'],
    'powder': ['ground', 'powdered'],
    'powdered': ['ground', 'powder'],
    'ground': ['powder', 'powdered'],
    'dried': ['dehydrated', 'dry'],
    'dehydrated': ['dried', 'dry'],
    'minced': ['chopped', 'diced', 'crushed'],
    'chopped': ['minced', 'diced'],
    'diced': ['chopped', 'minced'],
    'sliced': ['cut', 'slices'],
    'slices': ['sliced', 'cut'],
    'whole': ['intact', 'uncut'],
};

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

function computeFdcPriorityScore(query: string, foodName: string, brandName?: string | null, targetBrand?: string): number {
    const queryLower = query.toLowerCase().trim();
    const nameLower = foodName.toLowerCase().trim();

    const singularize = (word: string): string => {
        if (word.endsWith('oes')) return word.slice(0, -2);
        if (word.endsWith('es')) return word.slice(0, -2);
        if (word.endsWith('s')) return word.slice(0, -1);
        return word;
    };

    const DISH_INDICATORS = ['bread', 'flour', 'pancake', 'cake', 'cookie', 'pie', 'salad', 'soup', 'stew',
        'sauce', 'chip', 'chips', 'snack', 'snacks', 'babyfood', 'baby food', 'toddler',
        'fast food', 'mashed', 'puff', 'stick', 'sticks', 'fried', 'hash brown', 'frozen', 'canned'];
    const isDishLike = DISH_INDICATORS.some(dish => nameLower.includes(dish));

    if (isDishLike) {
        return 10;
    }

    const querySingular = singularize(queryLower);
    const nameWords = nameLower.split(/[,\s]+/).filter(w => w.length > 0);
    const nameFirstWord = nameWords[0] || '';
    const nameFirstSingular = singularize(nameFirstWord);

    const brandBonus = (
        targetBrand &&
        brandName &&
        brandName.toLowerCase().includes(targetBrand.toLowerCase())
    ) ? 20 : 0;

    if (nameLower === queryLower || nameLower === querySingular) {
        return 100 + brandBonus;
    }

    if (nameWords.length <= 2 && (nameFirstWord === queryLower || nameFirstWord === querySingular || nameFirstSingular === querySingular)) {
        return 90 + brandBonus;
    }

    const RAW_INDICATORS = ['raw', 'flesh', 'skin', 'fresh', 'plain', 'whole'];
    const hasRawIndicator = RAW_INDICATORS.some(ind => nameLower.includes(ind));
    if (hasRawIndicator && (nameFirstWord === queryLower || nameFirstWord === querySingular || nameFirstSingular === querySingular)) {
        return 80 + brandBonus;
    }

    if (nameFirstWord === queryLower || nameFirstWord === querySingular || nameFirstSingular === querySingular) {
        return 70 + brandBonus;
    }

    if (nameLower.includes(queryLower) || nameLower.includes(querySingular)) {
        return 40 + brandBonus;
    }

    return 20 + brandBonus;
}

function expandWithSynonyms(query: string): string[] {
    const lower = query.toLowerCase();
    const expanded: string[] = [query];

    for (const [british, american] of Object.entries(BRITISH_TO_AMERICAN)) {
        if (lower.includes(british)) {
            for (const us of american) {
                const americanized = lower.replace(british, us);
                if (!expanded.map(e => e.toLowerCase()).includes(americanized)) {
                    expanded.push(americanized);
                }
            }
        }
    }

    for (const [modifier, synonyms] of Object.entries(DIETARY_SYNONYMS)) {
        if (lower.includes(modifier)) {
            for (const syn of synonyms) {
                const variant = lower.replace(modifier, syn);
                if (!expanded.map(e => e.toLowerCase()).includes(variant)) {
                    expanded.push(variant);
                }
            }
            break;
        }
    }

    for (const [form, synonyms] of Object.entries(FORM_SYNONYMS)) {
        if (lower.includes(form)) {
            for (const syn of synonyms) {
                const variant = lower.replace(form, syn);
                if (!expanded.map(e => e.toLowerCase()).includes(variant)) {
                    expanded.push(variant);
                }
            }
            break;
        }
    }

    return expanded;
}

function computePositionScore(
    query: string,
    foodName: string,
    position: number,
    options?: { isHighQualityFdc?: boolean }
): number {
    let score = Math.max(0.5, 0.95 - (position * 0.02));

    const queryLower = query.toLowerCase().replace(/[0-9]+/g, '').trim();
    const foodLower = foodName.toLowerCase().trim();

    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    const mainIngredient = queryWords[queryWords.length - 1] || queryLower;
    const foodWords = foodLower.split(/\s+/).filter(w => w.length > 2);
    const foodMain = foodWords[foodWords.length - 1] || foodLower;

    if (mainIngredient === foodMain || mainIngredient === foodLower || foodMain === queryLower) {
        score *= 1.5;
    } else if (foodLower === mainIngredient || foodLower.startsWith(mainIngredient)) {
        score *= 1.4;
    } else if (foodLower.includes(mainIngredient)) {
        score *= 1.1;
    }
    const queryCore = mainIngredient;

    const queryMods = detectDietaryModifier(query);
    const foodMods = detectDietaryModifier(foodName);

    if (queryMods.fatFree) {
        if (foodMods.fatFree) {
            score *= 1.1;
        } else if (foodMods.reducedFat) {
            score *= 0.4;
        } else if (foodMods.whole) {
            score *= 0.3;
        } else {
            score *= 0.7;
        }
    } else if (queryMods.reducedFat) {
        if (foodMods.reducedFat) {
            score *= 1.1;
        } else if (foodMods.fatFree) {
            score *= 0.6;
        } else if (foodMods.whole) {
            score *= 0.4;
        }
    }

    if (queryMods.unsweetened) {
        if (foodMods.unsweetened) {
            score *= 1.1;
        } else if (foodMods.sweetened) {
            score *= 0.3;
        } else {
            score *= 0.7;
        }
    }

    const BASIC_PRODUCE = ['potato', 'potatoes', 'lentil', 'lentils', 'beans', 'chickpea', 'chickpeas', 'rice', 'pasta', 'spinach', 'broccoli', 'carrot', 'carrots'];
    const isBasicProduce = BASIC_PRODUCE.some(p => foodLower.includes(p) || queryCore.includes(p));

    if (isBasicProduce && !queryMods.fatFree && !queryMods.reducedFat) {
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
            foodLower.includes('roasted') ||
            foodLower.includes('sauteed') ||
            foodLower.includes('au gratin') ||
            foodLower.includes('mashed');

        if (hasNoFatIndicator) {
            score *= 1.25;
        } else if (hasFatAddedIndicator) {
            score *= 0.6;
        }
    }

    if (options?.isHighQualityFdc) {
        if (isBasicProduce) {
            score *= 1.6;
        } else {
            score *= 1.15;
        }
    }

    const significantWords = queryLower.split(/\s+/).filter(w =>
        w.length > 2 &&
        !['tomato', 'tomatoes', 'fresh', 'raw', 'vegetable', 'fruit', 'organic'].includes(w)
    );

    for (const word of significantWords) {
        const singular = word.endsWith('s') ? word.slice(0, -1) : word;

        if (!foodLower.includes(word) && !foodLower.includes(singular)) {
            if (['salsa', 'soup', 'stew', 'juice', 'puree', 'paste', 'sauce'].includes(singular)) {
                score *= 0.5;
            } else {
                score *= 0.85;
            }
        }
    }

    const DISH_TERMS = ['smoothie', 'pie', 'cake', 'cheesecake', 'cupcake', 'pancake', 'bread', 'muffin', 'juice', 'sauce', 'soup', 'stew', 'casserole', 'salad', 'pizza', 'sandwich', 'burger', 'dip', 'jam', 'jelly', 'yogurt', 'ice cream', 'shake', 'drink', 'beverage', 'flavored', 'hummus', 'guacamole', 'salsa'];

    const queryHasDishTerm = DISH_TERMS.some(term => queryLower.includes(term));

    if (!queryHasDishTerm) {
        const foodWords = foodLower.split(/\s+/).map(w => w.replace(/[^a-z]/g, ''));

        for (const term of DISH_TERMS) {
            if (foodWords.includes(term) || foodWords.includes(term + 's')) {
                score *= 0.6;
                break;
            }
        }
    }

    return Math.max(0, Math.min(1, score));
}

function normalizeFdcName(description: string): string {
    const parts = description.split(/,\s*/);
    if (parts.length <= 1) return description;

    const mainNoun = parts[0].toLowerCase();
    const qualifiers = parts.slice(1).map(p => p.toLowerCase().trim());

    return [...qualifiers, mainNoun].join(' ').trim();
}
