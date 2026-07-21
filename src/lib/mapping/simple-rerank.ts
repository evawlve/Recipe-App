/**
 * Simple Reranking Module
 * 
 * Replaces AI reranking with a fast, deterministic scoring algorithm.
 * Uses token overlap, source preference, and name similarity.
 */

import { logger } from '../logger';
import { extractModifierConstraints, applyModifierConstraints, type ModifierConstraints, type ConstraintResult } from './modifier-constraints';
import { detectGrainCookingContext } from './filter-candidates';
import { assessRankTimePlausibility } from './macro-plausibility';
import { isDenylistedOffRecord } from './corrupt-denylist';

export interface RerankCandidate {
    id: string;
    name: string;
    brandName?: string;
    foodType?: string;
    score: number;
    source: 'fatsecret' | 'fdc' | 'cache' | 'openfoodfacts' | 'ai_generated';
    nutrition?: {
        kcal: number;
        protein: number;
        carbs: number;
        fat: number;
        per100g: boolean;
    };
    /**
     * True when the query counts pieces ("13 tortilla chips") and this
     * candidate's OFF label serving natively enumerates that same piece
     * ("14 chips (28g)"). Precomputed by the mapper; earns COUNT_LABEL_BOOST
     * when the caller passes preferCountLabeled.
     */
    countLabelMatch?: boolean;
    /**
     * True when this candidate carries genuine gram-quantified serving data
     * (OFF label servingGrams, or FDC servings with grams) AND the request's
     * shape would actually bill by serving (unitless / count / container —
     * not an explicit weight or volume). Precomputed by the mapper; earns
     * SERVING_LABEL_BOOST so a serving-less record can't win a near-tie and
     * silently flatten a can/bar/sleeve request to 100g.
     */
    servingLabelMatch?: boolean;
}

export interface AiNutritionEstimate {
    caloriesPer100g: number;
    proteinPer100g: number;
    carbsPer100g: number;
    fatPer100g: number;
    confidence: number;
}

export interface SimpleRerankResult {
    winner: RerankCandidate;
    confidence: number;
    reason: string;
}

// ============================================================
// Scoring Weights
// ============================================================

const WEIGHTS = {
    EXACT_MATCH: 0.30,       // Exact name match bonus (INCREASED - precise matches should win)
    TOKEN_OVERLAP: 0.15,     // Token overlap ratio (slightly increased)
    // SOURCE_FATSECRET removed — FDC and FatSecret compete equally on name match quality
    NO_BRAND: 0.05,          // Prefer generic over branded (reduced)
    SHORT_NAME: 0.02,        // Prefer shorter, simpler names (minimal)
    ORIGINAL_SCORE: 0.45,    // API score (REDUCED - don't blindly trust API ranking)
    SIMPLE_INGREDIENT_BRAND_PENALTY: 0.1,  // Reduced - was 0.3 which over-penalized good branded matches
    EXTRA_TOKEN_PENALTY: 0.35,  // INCREASED - strongly penalize candidates with extra unrelated words
    TOKEN_BLOAT_PENALTY: 0.15,   // Penalty per excess token beyond +1 (max 0.45 total) - INCREASED
    // Phrase matching (Jan 2026)
    EXACT_PHRASE_BOOST: 0.15,  // Boost when candidate contains exact multi-word phrases from query
    // Nutrition scoring (Jan 2026)
    NUTRITION_CALORIE_SCORING: 0.12,  // Primary: calorie matching
    NUTRITION_MACRO_SCORING: 0.10,    // Secondary: macro sanity check (increased from 0.03)
    MISSING_MACRO_PENALTY: 0.15,      // Penalty for candidates with P:0, C:0 when AI expects values
    UNSPECIFIED_LEAN_PENALTY: 0.20,   // Penalty for lean variants when query doesn't specify lean %
    // Category-changing token penalty (Jan 2026)
    CATEGORY_CHANGE_PENALTY: 0.50,    // Heavy penalty when candidate has tokens that change food category
    // Semantic modifier matching (Jan 2026)
    MODIFIER_MATCH_BOOST: 0.20,       // Boost when candidate matches query's form modifiers (crushed, canned, dried, cube)
    WORD_COVERAGE_BONUS: 0.15,        // Bonus for candidates containing ALL query words in order
    // Attribute contradiction penalty (Fix 49, Feb 2026)
    ATTRIBUTE_CONTRADICTION_PENALTY: 0.35,  // Penalty when query says "green" but candidate says "red"
    // Missing cooking state penalty (Batch 4, Mar 2026)
    MISSING_COOKING_STATE_PENALTY: 0.40, // Penalty when query says "fried" but candidate doesn't
    // Count-labeled SKU preference (Cluster A pt2, Jul 2026)
    COUNT_LABEL_BOOST: 0.08,  // Tie-break toward SKUs whose label declares a per-piece count when the user is counting pieces. Deliberately small: must not beat EXACT_MATCH or token penalties.
    // Serving-shape preference (PR D pt2, Jul 2026)
    SERVING_LABEL_BOOST: 0.05,  // Tie-break toward records with real serving data when the request bills by serving. Smaller than COUNT_LABEL_BOOST: it must only break near-ties (equal-name "Red Bull" with vs without a 250ml label), never override identity signals.
    // Decisive same-brand preference (brand-hijack fix, Jul 2026)
    DECISIVE_BRAND_BOOST: 0.35,  // Only fires behind hasDecisiveBrandContext + non-brand token coverage; a cross-brand candidate must not win on flavor-token coverage alone when the user named a brand unambiguously.
    // Cooked-grain preference for volume-unit lines (cooked-vs-dry fix, Jul 2026)
    GRAIN_COOKED_VOLUME_BOOST: 0.35,  // Fires only under softCooked grain context; paired with a partition tiebreak because a dry exact-match ("White Rice", ~350 kcal/100g) otherwise outscores any cooked record on name quality.
};


// Nutrition scoring thresholds
const NUTRITION_CALORIE_VARIANCE_THRESHOLD = 0.30;  // 30% difference triggers penalty
const NUTRITION_CONFIDENCE_GATE = 0.70;             // Only apply if AI confidence >= 0.7

// Modifiers/descriptors we should ignore in matching
// ⚠️ ONLY truly neutral words belong here. Form-changing tokens (powder, paste, seed, etc.)
// MUST remain visible to scoring so they get penalized via CATEGORY_CHANGING_TOKENS when the
// query doesn't ask for that form. See Fix 49 (Feb 2026).
const IGNORE_TOKENS = new Set([
    'raw', 'fresh', 'organic', 'natural', 'whole',
    'all', 'purpose', 'pure', 'real', 'original',
    'liquid',  // "liquid" rarely changes food identity (liquid vs solid creamer ≈ same)
]);

// Benign descriptor tokens - these add context but don't change food category
// These should receive REDUCED extra token penalty (not eliminated, but less harsh)
// e.g., "baby spinach", "organic spinach" are still spinach variants
//
// NOTE: Cooking-method tokens (fried, creamed, roasted, etc.) are intentionally
// NOT listed here. When the query is plain "tofu" and the candidate is "Fried Tofu",
// "fried" fundamentally changes the food — it must carry a full extra-token penalty.
// Only truly neutral descriptors (size, color, quality) belong here.
const BENIGN_DESCRIPTOR_TOKENS = new Set([
    // Size/age descriptors
    'baby', 'mini', 'small', 'medium', 'large', 'jumbo', 'giant', 'young', 'mature',
    // Freshness/source state (physical state, not cooking method)
    'raw', 'fresh', 'frozen', 'canned', 'dried', 'dehydrated',
    // Quality/type descriptors
    'organic', 'natural', 'wild', 'farmed', 'domestic', 'imported',
    // Color descriptors (for produce varieties)
    'red', 'green', 'yellow', 'orange', 'white', 'purple', 'black', 'golden',
    // Preparation descriptors (physical cut only — not cooking method)
    'chopped', 'diced', 'sliced', 'minced', 'crushed', 'ground', 'whole', 'halved',
    'shredded', 'grated', 'cubed', 'julienne', 'peeled', 'skinless', 'boneless',
    // Cut-shape descriptors (describe how food is cut, not what it is)
    // e.g. "3 strips green peppers" should still match "Green Bell Pepper"
    'strip', 'strips', 'sprig', 'sprigs', 'floret', 'florets',
    'wedge', 'wedges', 'chunk', 'chunks', 'clove', 'cloves',
    // Common variety descriptors
    'sweet', 'sour', 'bitter', 'spicy', 'hot', 'mild',
    // Plant parts
    'leaf', 'leaves', 'stalk', 'stalks', 'stem', 'stems', 'root', 'roots',
]);

// Tokens representing the DEFAULT (uncooked) state — get ZERO extra-token penalty when the
// query doesn't specify cooking state. Rationale: when a recipe says "chicken breast" or
// "grape tomatoes" with no qualifier, raw is the implicit default. FDC entries often append
// "raw" to their names (e.g. "grape raw tomatoes", "Chicken Breast, Raw"). Penalizing this
// would unfairly bias away from nutritionally accurate USDA data.
// Cooked states (baked, roasted, etc.) still get the normal 25% benign penalty — they
// represent a genuinely different food state from the unspecified raw default.
const RAW_STATE_TOKENS = new Set(['raw', 'uncooked']);

function querySpeaksCookingState(query: string): boolean {
    const ALL_COOKING_STATES = new Set([
        'raw', 'uncooked', 'fresh',
        'cooked', 'baked', 'boiled', 'steamed', 'roasted', 'grilled', 'fried',
        'braised', 'poached', 'smoked', 'cured', 'salted', 'pickled',
    ]);
    return tokenize(query).some(t => ALL_COOKING_STATES.has(t));
}

/**
 * Strip raw-state tokens from a candidate name for scoring purposes.
 * When the query doesn't specify cooking state, "grape raw tomatoes" → "grape tomatoes"
 * so it can achieve exact-match parity with "Grape Tomatoes" from FatSecret.
 * This is purely for scoring — the original food name is still stored/displayed.
 */
function normalizeCandidateNameForScoring(candidateName: string, query: string): string {
    if (querySpeaksCookingState(query)) return candidateName;  // Query specifies state — don't strip
    const tokens = tokenize(candidateName);
    const filtered = tokens.filter(t => !RAW_STATE_TOKENS.has(t));
    return filtered.join(' ');
}

// ============================================================
// Prep Modifier Stripping (Feb 2026)
// ============================================================
// Strips non-nutritional prep modifiers from the rerank query so scoring
// operates on food identity only. "green peppers cut in strips" → "green peppers"
//
// IMPORTANT: Identity-changing modifiers (dried, ground, roasted, etc.) are
// NEVER stripped — they change what the food IS, not how it's prepared.

/** Prep words that describe physical cutting/shape — safe to strip */
const PREP_CUTTING_WORDS = new Set([
    'cut', 'diced', 'chopped', 'minced', 'sliced', 'julienned', 'cubed',
    'halved', 'quartered', 'shredded', 'grated', 'mashed', 'torn',
    'strips', 'chunks', 'pieces', 'rings', 'wedges',
]);

/** Prep actions that don't change nutritional identity */
const PREP_ACTION_WORDS = new Set([
    'peeled', 'seeded', 'cored', 'deveined', 'trimmed', 'pitted',
    'husked', 'shelled', 'stemmed', 'deseeded', 'washed', 'rinsed',
    'drained', 'squeezed', 'pressed',
]);

/** Size qualifiers used as prep instructions, not food size */
const PREP_SIZE_QUALIFIERS = new Set([
    'finely', 'roughly', 'coarsely', 'thinly', 'thickly',
]);

/** All prep words combined for fast lookup */
const ALL_PREP_WORDS = new Set([
    ...PREP_CUTTING_WORDS,
    ...PREP_ACTION_WORDS,
    ...PREP_SIZE_QUALIFIERS,
]);

/**
 * Strip non-nutritional prep modifiers from a rerank query.
 * This ensures scoring operates on food identity only.
 *
 * Safe to strip: "cut in strips", "finely diced", "peeled and deveined"
 * NOT stripped:  "dried", "ground", "roasted", "frozen", "canned" (identity-changing)
 *
 * @example
 *   stripPrepModifiers("green peppers cut in strips") → "green peppers"
 *   stripPrepModifiers("finely diced onion")          → "onion"
 *   stripPrepModifiers("ground cinnamon")             → "ground cinnamon"  // preserved
 *   stripPrepModifiers("dried cranberries")           → "dried cranberries" // preserved
 */
export function stripPrepModifiers(query: string): string {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);

    // Filter out prep words and connectors ("in", "and", "or") that only appear
    // between prep phrases (we only strip connectors if they're adjacent to prep words)
    const CONNECTORS = new Set(['in', 'and', 'or', 'into']);
    const filtered: string[] = [];

    for (let i = 0; i < words.length; i++) {
        const word = words[i];

        if (ALL_PREP_WORDS.has(word)) {
            continue; // Strip prep word
        }

        // Strip connectors only if surrounded by prep context
        // e.g., "cut in strips" → strip "in" because "cut" and "strips" are both prep
        if (CONNECTORS.has(word)) {
            const prevIsPrep = i > 0 && ALL_PREP_WORDS.has(words[i - 1]);
            const nextIsPrep = i < words.length - 1 && ALL_PREP_WORDS.has(words[i + 1]);
            if (prevIsPrep || nextIsPrep) {
                continue; // Strip connector in prep context
            }
        }

        filtered.push(word);
    }

    // Safety: never return empty — fall back to original query
    if (filtered.length === 0) {
        return query.toLowerCase().trim();
    }

    return filtered.join(' ');
}

/**
 * Detect if the query is for fresh produce or unprocessed meat.
 * Used as a tiebreaker to prefer FDC (USDA) data for these categories
 * since FDC has authoritative nutritional data for raw produce and meats.
 */
function isProduceOrMeat(query: string): boolean {
    const q = query.toLowerCase();
    // Common produce keywords
    const PRODUCE = [
        'tomato', 'tomatoes', 'pepper', 'peppers', 'onion', 'onions', 'garlic',
        'spinach', 'kale', 'lettuce', 'arugula', 'cucumber', 'zucchini', 'squash',
        'broccoli', 'cauliflower', 'carrot', 'carrots', 'celery', 'asparagus',
        'mushroom', 'mushrooms', 'eggplant', 'artichoke', 'beet', 'beets',
        'potato', 'potatoes', 'sweet potato', 'yam', 'corn', 'pea', 'peas',
        'bean', 'beans', 'lentil', 'lentils', 'chickpea', 'chickpeas',
        'apple', 'apples', 'banana', 'bananas', 'orange', 'lemon', 'lime',
        'grape', 'grapes', 'berry', 'berries', 'strawberry', 'blueberry',
        'raspberry', 'cherry', 'cherries', 'mango', 'pineapple', 'peach',
        'pear', 'plum', 'watermelon', 'melon', 'avocado',
    ];
    // Unprocessed meat/seafood keywords
    const MEAT = [
        'chicken', 'turkey', 'beef', 'pork', 'lamb', 'veal', 'bison', 'venison',
        'salmon', 'tuna', 'cod', 'tilapia', 'shrimp', 'scallop', 'lobster',
        'crab', 'clam', 'oyster', 'halibut', 'trout', 'sardine', 'anchovy',
        'duck', 'goose', 'rabbit',
    ];
    return [...PRODUCE, ...MEAT].some(term => q.includes(term));
}

// Synonyms for matching (bidirectional)
const SYNONYMS: Record<string, string[]> = {
    'zest': ['peel', 'rind'],
    'peel': ['zest', 'rind'],
    'rind': ['zest', 'peel'],
    // Spelling variants (include singular forms since tokenizer stems words)
    'scallop': ['skallop'],   // Singular/stemmed form
    'skallop': ['scallop'],
    'scallops': ['skallops'],  // Plural form (for raw text matching)
    'skallops': ['scallops'],
};

// Brands known to produce nutrition bars/snacks that shouldn't match produce
const BAR_BRANDS = new Set([
    'luna', 'clif', 'kind', 'rxbar', 'larabar', 'quest', 'perfect bar',
    'power crunch', 'think!', 'one', 'built', 'barebells', 'pure protein',
]);

// ============================================================
// Category-Changing Tokens (Jan 2026)
// ============================================================
// Tokens that completely transform the food category when present.
// If the query is for a simple ingredient like "spinach" but the 
// candidate has "noodles", it's a completely different food category.
// These should NOT just get an "extra token" penalty - they should
// get a HEAVY penalty because they change the entire nature of the food.

const CATEGORY_CHANGING_TOKENS = new Set([
    // Pasta/noodle products (turn produce → carb-heavy pasta)
    'noodle', 'noodles', 'pasta', 'spaghetti', 'linguine', 'fettuccine',
    'macaroni', 'lasagna', 'ravioli', 'tortellini', 'gnocchi', 'penne',
    'fusilli', 'rigatoni', 'rotini', 'vermicelli',
    // Baked goods (turn ingredients → high-calorie desserts)
    'cake', 'pie', 'tart', 'cookie', 'cookies', 'muffin', 'bread',
    'cupcake', 'cheesecake', 'brownie', 'pastry', 'croissant', 'donut',
    'waffle', 'pancake', 'biscuit', 'scone',
    // Prepared dishes (turn raw → complex dishes)
    'soup', 'stew', 'casserole', 'salad', 'sandwich', 'burger', 'wrap',
    'pizza', 'quesadilla', 'enchilada', 'burrito', 'taco',
    'bowl', 'entree', 'platter',  // Fix 49: prepared-meal containers
    // Sauces / condiments (turn raw produce → processed product)
    'marinara', 'bisque', 'gravy', 'relish',
    // Beverages/processed (turn solid → liquid/processed)
    'smoothie', 'shake', 'juice', 'drink', 'beverage', 'soda', 'lemonade',
    'julep', 'cocktail', 'spritzer',
    // Snacks/confections
    'candy', 'candies', 'chocolate', 'bar', 'chip', 'chips', 'fries',
    'fritter', 'nugget', 'nuggets', 'stick', 'sticks',
    'patty', 'patties', 'mints',
    'caramel', 'candied', 'glazed', 'coated', 'frosted',  // Fix 49: confection modifiers
    // Spreads/condiments
    'dip', 'spread', 'hummus', 'guacamole', 'sauce', 'dressing',
    'jam', 'jelly', 'preserves', 'butter',
    // Pickled/preserved products (turn fresh herb → preserved product)
    'pickle', 'pickles', 'pickled',
    // Processed meat products
    'sausage', 'sausages', 'hot dog', 'bratwurst', 'chorizo', 'salami',
    // Part-of-whole (when query is for whole fruit/veg)
    // e.g. "lemons" → "lemon peel" or "lemon zest" is wrong unless query asks for it
    'peel', 'rind',
    // Dairy products (when not queried)
    'ice cream', 'yogurt', 'pudding', 'custard', 'mousse',
    // Grain/legume cross-contamination (turn simple grain → multi-ingredient product)
    // e.g., "quinoa" ≠ "Lentil Quinoa Rice Mix"
    'lentil', 'lentils', 'rice',
    // ============================================================
    // Form-change tokens (Fix 49, Feb 2026)
    // ============================================================
    // These change the PHYSICAL FORM of a food, producing a fundamentally
    // different product with different caloric density / nutritional profile.
    //   "tomato" (18 kcal/100g)  ≠ "Tomato powder" (302 kcal/100g)
    //   "fennel" (31 kcal/100g)  ≠ "Fennel Seed"   (345 kcal/100g)
    // Only penalized when NOT present in the query — "garlic powder" query
    // still matches "Garlic Powder" fine since "powder" is in the query.
    'powder', 'powdered',
    'flake', 'flakes',
    'paste',
    'puree',
    'concentrate',
    'extract',
    'seed', 'seeds',
    'oil',           // "olive" ≠ "olive oil"
    'flour',         // "almond" ≠ "almond flour"
    'granulated',    // "garlic" ≠ "granulated garlic"
    'dry',           // "milk" ≠ "dry milk" (42 vs 355 kcal/100g)
]);

/**
 * Check if candidate has category-changing tokens that are NOT in the query.
 * This catches "spinach" → "Spinach Noodles" type mismatches.
 * 
 * Synonym-aware: if the query uses "zest" and the candidate has "peel",
 * the penalty is suppressed because they are declared synonyms.
 * 
 * Returns the penalty amount (0 to CATEGORY_CHANGE_PENALTY)
 */
function getCategoryChangePenalty(query: string, candidateName: string): number {
    const queryLower = query.toLowerCase();
    const candLower = candidateName.toLowerCase();

    // Build an expanded set of query tokens including declared synonyms
    // so that "lemon zest" query doesn't penalize "Lemon Peel" candidate
    const queryWords = queryLower
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);
    const expandedQueryTokens = new Set(queryWords);
    for (const word of queryWords) {
        const synList = SYNONYMS[word];
        if (synList) {
            for (const syn of synList) expandedQueryTokens.add(syn);
        }
    }

    // Tokenize candidate name
    const candidateWords = candLower
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);

    // Check each candidate word against category-changing tokens
    for (const word of candidateWords) {
        if (CATEGORY_CHANGING_TOKENS.has(word)) {
            // Is this category-changing token in the query (or covered by a synonym)?
            // If so, it's intentional (e.g., "spinach pasta" query, or "lemon zest" → peel)
            if (!expandedQueryTokens.has(word)) {
                // Query doesn't have this token or any synonym for it — parasitic!
                // Return heavy penalty
                return WEIGHTS.CATEGORY_CHANGE_PENALTY;
            }
        }
    }

    return 0; // No category-changing tokens found
}

// ============================================================
// Attribute Contradiction Penalty (Fix 49, Feb 2026)
// ============================================================
// When the query specifies a distinguishing attribute (e.g., a color like "green")
// and the candidate specifies a DIFFERENT value for the same attribute (e.g., "red"),
// apply a heavy penalty. This is stronger than a simple extra-token penalty because
// it represents a direct contradiction, not just unrelated information.
//
// Example: "green peppers" → "ROASTED RED BELL PEPPER STRIPS (MEZZETTA)"
//   Query has color "green", candidate has color "red" → contradiction penalty.
//
// This is general and scalable: covers all color-distinguished produce varieties
// (red/green/yellow peppers, red/green/yellow onions, etc.) without per-food rules.

const FOOD_COLORS = new Set([
    'red', 'green', 'yellow', 'orange', 'white', 'purple',
    'black', 'golden', 'brown', 'pink', 'blue',
]);

function getAttributeContradictionPenalty(query: string, candidateName: string): number {
    const queryTokens = tokenize(query);
    const candTokens = tokenize(candidateName);

    const queryColors = queryTokens.filter(t => FOOD_COLORS.has(t));
    const candColors = candTokens.filter(t => FOOD_COLORS.has(t));

    // Only fire when query specifies exactly one color and candidate specifies
    // a different one (with the query's color absent from the candidate).
    // This avoids false positives for multi-color queries like "red and green peppers".
    if (queryColors.length === 1 && candColors.length >= 1) {
        const queryColor = queryColors[0];
        const candHasQueryColor = candTokens.some(t => t === queryColor);
        const candHasDifferentColor = candColors.some(c => c !== queryColor);

        if (!candHasQueryColor && candHasDifferentColor) {
            logger.debug('getAttributeContradictionPenalty.color_mismatch', {
                query,
                candidate: candidateName,
                queryColor,
                candColors,
            });
            return WEIGHTS.ATTRIBUTE_CONTRADICTION_PENALTY;
        }
    }

    // Default-ripeness penalty: when query mentions "tomato" without specifying "green",
    // penalize candidates with "green" since green tomatoes are unripe/specialty.
    // Most recipe references to "tomatoes", "petite tomatoes", "cherry tomatoes" etc.
    // mean red/ripe varieties. Use a softer penalty (50%) to prefer red without hard-blocking.
    if (queryColors.length === 0) {
        const queryLower = query.toLowerCase();
        const candLower = candidateName.toLowerCase();
        const ASSUMED_RED_FOODS = ['tomato', 'tomatoes'];
        const isAssumedRed = ASSUMED_RED_FOODS.some(f => queryLower.includes(f));
        if (isAssumedRed && /\bgreen\b/.test(candLower)) {
            logger.debug('getAttributeContradictionPenalty.default_ripeness', {
                query,
                candidate: candidateName,
                reason: 'green_tomato_without_explicit_green_query',
            });
            return WEIGHTS.ATTRIBUTE_CONTRADICTION_PENALTY * 0.5;
        }
    }

    return 0;
}

// ============================================================
// Missing Cooking State Penalty (Batch 4, Mar 2026)
// ============================================================
// When the query explicitly asks for a cooking state (like "fried", "roasted", "baked")
// and the candidate does not contain that state, apply a harsh penalty. This prevents
// "fried shallots" from matching raw "Shallots" and losing all its oil density.

const COOKING_STATES = new Set([
    'fried', 'roasted', 'baked', 'steamed', 'boiled', 'grilled', 'smoked',
    'poached', 'braised', 'toasted', 'caramelized', 'sautéed', 'sauteed'
]);

function getMissingCookingStatePenalty(query: string, candidateName: string): number {
    const queryTokens = tokenize(query);
    const candTokens = tokenize(candidateName);

    // Find all explicitly requested cooking states in the query
    const requestedStates = queryTokens.filter(t => COOKING_STATES.has(t));
    
    // If no specific cooking states were requested, no penalty
    if (requestedStates.length === 0) return 0;

    // Check if the candidate is missing ANY of the requested states
    const missingState = requestedStates.some(state => !candTokens.includes(state));

    if (missingState) {
        logger.debug('getMissingCookingStatePenalty.fired', {
            query,
            candidate: candidateName,
            requestedStates,
            candTokens
        });
        return WEIGHTS.MISSING_COOKING_STATE_PENALTY;
    }

    return 0;
}

// ============================================================
// Canned Bean Contradiction Penalty (Batch 4)
// ============================================================
// When the query requests "canned beans", penalize candidates with dry bean nutrition.
// Canned beans are typically < 150 kcal/100g due to water weight.
// Dry beans are typically > 300 kcal/100g.
// This allows the AI to correctly choose branded canned beans (e.g. Bush's Best)
// over raw FDC equivalents lacking the "canned" specification.
function getCannedBeanContradictionPenalty(query: string, candidate: RerankCandidate): number {
    const queryLower = query.toLowerCase();
    
    // Only apply if user requested legumes (using word boundaries to prevent 'pea' matching 'peanut')
    const isLegumeRequest = /\b(bean|beans|chickpea|chickpeas|lentil|lentils|pea|peas)\b/.test(queryLower);
    if (!isLegumeRequest) return 0;

    // Do NOT penalize if the user explicitly requested dry/dried/raw forms 
    // or if they specified "green beans" / "string beans" / "vanilla beans" / "coffee beans"
    if (queryLower.includes('dry') || queryLower.includes('dried') || queryLower.includes('raw')) return 0;
    if (/(vanilla|coffee|jelly|cocoa|castor)\s+bean/.test(queryLower)) return 0;
    
    // DEBUG: Let's see what the nutrition actually is!
    logger.debug('getCannedBeanContradictionPenalty.checking', { candidate: candidate.name, nutrition: candidate.nutrition });

    // If the candidate has > 200 kcal/100g, it is a dry legume.
    if (candidate.nutrition && candidate.nutrition.per100g && candidate.nutrition.kcal != null) {
        if (candidate.nutrition.kcal > 200) {
            logger.debug('getCannedBeanContradictionPenalty.fired', {
                query,
                candidate: candidate.name,
                kcal: candidate.nutrition.kcal,
                reason: 'dry_bean_selected_for_canned_request',
            });
            // Massive penalty to forcefully override the FDC API bonus
            return 0.6;
        }
    }
    
    return 0;
}

// ============================================================
// Processed Meat Penalty (Batch 5, Mar 2026)
// ============================================================
// When the query is for plain/unprocessed meat or poultry (chicken breast, turkey,
// ground beef, etc.), penalize candidates that have >2g carbs/100g. Plain raw meat
// has near-zero carbs. Carbs indicate the product is breaded, seasoned, marinated,
// or is processed deli meat (with fillers). This prevents:
//   "chicken breast" → "CHICKEN BREAST (GIANT EAGLE)" (7.2g carbs, pre-seasoned)
//   "lean ground turkey" → "LEAN TURKEY (HERITAGE FARM)" (16.2g carbs, seasoned)
//   "chicken halves" → "CHICKEN (BUDDIG)" (16.1g carbs, deli lunch meat)

const PLAIN_MEAT_QUERIES = [
    'chicken', 'chicken breast', 'chicken thigh', 'chicken leg', 'chicken wing',
    'chicken half', 'chicken halves', 'chicken quarter',
    'turkey', 'turkey breast', 'ground turkey', 'lean turkey', 'lean ground turkey',
    'beef', 'ground beef', 'steak', 'sirloin', 'ribeye', 'filet',
    'pork', 'pork chop', 'pork loin', 'pork tenderloin', 'ground pork',
    'lamb', 'lamb chop', 'ground lamb', 'veal',
    'duck', 'duck breast', 'goose',
];

// Skip penalty if query contains these words (user wants processed/seasoned form)
const PROCESSED_MEAT_SKIP_TERMS = [
    'breaded', 'fried', 'seasoned', 'marinated', 'glazed', 'teriyaki',
    'bbq', 'barbecue', 'buffalo', 'deli', 'lunch meat', 'lunchmeat',
    'nugget', 'nuggets', 'tender', 'tenders', 'strip', 'strips',
    'patty', 'patties', 'sausage', 'hot dog', 'jerky',
];

function getProcessedMeatPenalty(query: string, candidate: RerankCandidate): number {
    const queryLower = query.toLowerCase();

    // Only apply to plain meat queries
    const isPlainMeatQuery = PLAIN_MEAT_QUERIES.some(term => queryLower.includes(term));
    if (!isPlainMeatQuery) return 0;

    // Skip if user explicitly wants processed form
    if (PROCESSED_MEAT_SKIP_TERMS.some(term => queryLower.includes(term))) return 0;

    // Check candidate nutrition for unexpected carbs
    if (!candidate.nutrition?.per100g || candidate.nutrition.carbs == null) return 0;

    // Plain meat has 0-1g carbs/100g. Anything >2g is processed/seasoned.
    const carbsPer100g = candidate.nutrition.carbs;
    if (carbsPer100g > 2) {
        logger.debug('getProcessedMeatPenalty.fired', {
            query,
            candidate: candidate.name,
            carbs: carbsPer100g,
            reason: 'unexpected_carbs_in_meat',
        });
        // Scale penalty by how many carbs: 2-5g = moderate, >5g = heavy
        return carbsPer100g > 5 ? 0.40 : 0.25;
    }

    return 0;
}

// ============================================================
// Core Scoring Logic
// ============================================================

// Simple English plural stemmer (banana/bananas, onion/onions)
function stem(word: string): string {
    if (word.endsWith('ies') && word.length > 4) {
        return word.slice(0, -3) + 'y';  // berries → berry
    }
    if (word.endsWith('es') && word.length > 3) {
        if (word.endsWith('ches') || word.endsWith('shes') || word.endsWith('sses') || word.endsWith('xes')) {
            return word.slice(0, -2);  // peaches → peach
        }
        if (word.endsWith('oes')) {
            return word.slice(0, -2);  // potatoes → potato
        }
    }
    if (word.endsWith('s') && word.length > 3 && !word.endsWith('ss')) {
        return word.slice(0, -1);  // onions → onion, bananas → banana
    }
    return word;
}

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1 && !IGNORE_TOKENS.has(t))
        .map(t => stem(t));  // Apply stemming to all tokens
}

/** Check if two tokens match (including synonyms) */
function tokensMatch(queryToken: string, candidateToken: string): boolean {
    if (queryToken === candidateToken) return true;
    const synonyms = SYNONYMS[queryToken];
    return synonyms ? synonyms.includes(candidateToken) : false;
}

function computeTokenOverlap(query: string, candidateName: string): number {
    const queryTokens = new Set(tokenize(query));
    const candidateTokens = tokenize(candidateName);

    if (queryTokens.size === 0 || candidateTokens.length === 0) {
        return 0;
    }

    // Count matches including synonyms
    const matches = candidateTokens.filter(ct =>
        [...queryTokens].some(qt => tokensMatch(qt, ct))
    ).length;
    // Jaccard-like: matches / union size
    const union = new Set([...queryTokens, ...candidateTokens]).size;
    return matches / union;
}

function isExactMatch(query: string, candidateName: string): boolean {
    const queryTokens = tokenize(query);
    const candTokens = tokenize(candidateName);

    // Exact match = candidate contains all query tokens (or synonyms) with no significant extras
    if (queryTokens.length === 0) return false;

    // All query tokens must be in candidate (including synonyms)
    const allQueryInCandidate = queryTokens.every(qt =>
        candTokens.some(ct => tokensMatch(qt, ct))
    );
    // Candidate should not have extra tokens (prevents "banana" → "Banana Peppers")
    const extraTokens = candTokens.filter(ct =>
        !queryTokens.some(qt => tokensMatch(qt, ct))
    );

    return allQueryInCandidate && extraTokens.length === 0;
}

/**
 * Calculate boost for candidates that contain exact multi-word phrases from the query.
 * This helps break ties when token-based matching scores similarly.
 * 
 * Example: Query "fat free mayonnaise"
 * - "Fat Free Mayonnaise" contains "fat free" → gets boost
 * - "Light Mayonnaise" does NOT contain "fat free" → no boost
 * 
 * @param query - The normalized ingredient name  
 * @param candidateName - The candidate food name
 * @returns Boost value (0 to WEIGHTS.EXACT_PHRASE_BOOST)
 */
function getExactPhraseBoost(query: string, candidateName: string): number {
    const queryLower = query.toLowerCase();
    const candLower = candidateName.toLowerCase();

    // Important multi-word modifiers that should be matched exactly
    const IMPORTANT_PHRASES = [
        'fat free', 'nonfat', 'non fat', 'non-fat',
        'low fat', 'lowfat', 'reduced fat',
        'sugar free', 'no sugar', 'unsweetened',
        'low sodium', 'no salt', 'reduced sodium',
        'extra lean', 'lean',
        'whole grain', 'whole wheat', 'multigrain',
        'fire roasted', 'fire-roasted',
        'sun dried', 'sun-dried',
        'oven roasted', 'oven-roasted',
    ];

    // Check if query contains any important phrases
    for (const phrase of IMPORTANT_PHRASES) {
        if (queryLower.includes(phrase)) {
            // Query has this phrase - check if candidate has it too
            if (candLower.includes(phrase)) {
                return WEIGHTS.EXACT_PHRASE_BOOST;  // Full boost
            }
        }
    }

    return 0;  // No boost
}

/**
 * Calculate boost for candidates that match the query's semantic modifiers.
 * 
 * Semantic modifiers are words that describe the FORM of the ingredient:
 * - Preparation: crushed, diced, sliced, minced, ground, cubed
 * - Preservation: canned, dried, frozen, fresh
 * - Form variants: cube (stock cube → bouillon cube requires "cube" match)
 * 
 * Example: Query "crushed tomatoes"
 * - "Crushed Tomatoes (Canned)" contains "crushed" AND "canned" → gets boost
 * - "Tomatoes" does NOT contain "crushed" → no boost
 * 
 * Example: Query "beef stock cube"  
 * - "Beef Bouillon Cube" contains "cube" → gets boost
 * - "Beef Stock" does NOT contain "cube" → no boost
 * 
 * @param query - The normalized ingredient name
 * @param candidateName - The candidate food name
 * @returns Boost value (0 to WEIGHTS.MODIFIER_MATCH_BOOST)
 */
function getModifierMatchBoost(query: string, candidateName: string): number {
    const queryLower = query.toLowerCase();
    const candLower = candidateName.toLowerCase();

    // Semantic modifiers that change the nature/form of the ingredient
    const SEMANTIC_MODIFIERS = [
        // Preparation modifiers (change texture/form)
        'crushed', 'diced', 'sliced', 'minced', 'ground', 'cubed', 'pureed', 'mashed',
        'chopped', 'shredded', 'grated', 'julienne', 'halved', 'quartered',
        // Preservation/state modifiers (change nutritional density)
        'canned', 'dried', 'frozen', 'fresh', 'dehydrated', 'pickled', 'smoked',
        'roasted', 'toasted', 'blanched',
        // Form variants (important for stocks/broths)
        'cube', 'cubes', 'bouillon', 'concentrate', 'paste', 'powder', 'liquid',
        // Fat/lean modifiers
        'lean', 'extra lean', 'low fat', 'fat free', 'whole',
    ];

    // Find modifiers present in the query
    const queryModifiers = SEMANTIC_MODIFIERS.filter(mod => queryLower.includes(mod));

    if (queryModifiers.length === 0) {
        return 0;  // No modifiers in query, no boost needed
    }

    // Count how many query modifiers appear in the candidate
    let matchCount = 0;
    for (const mod of queryModifiers) {
        if (candLower.includes(mod)) {
            matchCount++;
        }
    }

    // Boost based on proportion of modifiers matched
    if (matchCount === 0) {
        // PENALTY: Query has modifiers but candidate has NONE of them
        // e.g., "crushed tomatoes" → "Tomatoes" (no "crushed")
        return -WEIGHTS.MODIFIER_MATCH_BOOST * 0.5;  // Half penalty
    }

    // Partial to full boost based on match ratio
    const matchRatio = matchCount / queryModifiers.length;
    return matchRatio * WEIGHTS.MODIFIER_MATCH_BOOST;
}

/**
 * Calculate bonus for candidates where ALL query words appear in order.
 * 
 * This gives preference to candidates that fully contain the query as a phrase
 * rather than just having overlapping tokens.
 * 
 * Example: Query "crushed tomatoes"
 * - "Crushed Tomatoes" → all words present, gets bonus
 * - "Crushed Red Tomatoes" → all words present, gets bonus  
 * - "Tomatoes" → missing "crushed", no bonus
 * - "Tomato Crush" → wrong order, reduced bonus
 * 
 * @param query - The normalized ingredient name
 * @param candidateName - The candidate food name
 * @returns Bonus value (0 to WEIGHTS.WORD_COVERAGE_BONUS)
 */
function getWordCoverageBonus(query: string, candidateName: string): number {
    const queryLower = query.toLowerCase();
    const candLower = candidateName.toLowerCase();

    // Tokenize both (skip very short words)
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    const candWords = candLower.split(/\s+/).filter(w => w.length > 2);

    if (queryWords.length === 0) return 0;

    // Check if ALL query words appear in candidate
    let allPresent = true;
    let inOrderCount = 0;
    let lastFoundIndex = -1;

    for (const qWord of queryWords) {
        // Allow plural/singular matching
        const found = candWords.findIndex((cWord, idx) =>
            idx > lastFoundIndex && (
                cWord === qWord ||
                cWord === qWord + 's' ||
                cWord === qWord + 'es' ||
                qWord === cWord + 's' ||
                qWord === cWord + 'es' ||
                cWord.startsWith(qWord) ||
                qWord.startsWith(cWord)
            )
        );

        if (found === -1) {
            allPresent = false;
            break;
        }

        // Track if words appear in order
        if (found > lastFoundIndex) {
            inOrderCount++;
        }
        lastFoundIndex = found;
    }

    if (!allPresent) {
        return 0;  // Not all words present, no bonus
    }

    // Full bonus if all words are in order, partial if rearranged
    const orderRatio = inOrderCount / queryWords.length;
    return orderRatio * WEIGHTS.WORD_COVERAGE_BONUS;
}


/**
 * Calculate penalty for candidates with excessive tokens vs query.
 * A simple query like "chilli peppers" (2 tokens) shouldn't highly rank
 * a complex product like "Chilli Peppers Cream Cheese (VIOLIFE)" (5+ tokens).
 * 
 * This catches compound products that happen to contain the query words
 * but are categorically different (fresh ingredient vs processed product).
 * 
 * @param query - The normalized ingredient name
 * @param candidateName - The candidate food name
 * @param isBranded - If true (user wants branded), be more lenient
 * @returns 0 (no penalty) to 0.45 (heavy penalty)
 */
function getTokenBloatPenalty(
    query: string,
    candidateName: string,
    isBranded?: boolean
): number {
    // Remove parenthetical brand names for token counting
    // e.g., "Chilli Peppers Cream Cheese (VIOLIFE)" → "Chilli Peppers Cream Cheese"
    const candidateClean = candidateName.replace(/\([^)]+\)/g, '').trim();

    // Tokenize both (filters out 1-char tokens)
    const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const candTokens = candidateClean.toLowerCase().split(/\s+/).filter(t => t.length > 1);

    const excess = candTokens.length - queryTokens.length;

    // If user explicitly wants branded items, be lenient (allow up to +3 tokens)
    if (isBranded && excess <= 3) return 0;

    // Allow only 1 extra token with no penalty (e.g., "Fresh" or "Organic")
    // STRICTER than before - was 2, now 1 (Jan 2026)
    if (excess <= 1) return 0;

    // Graduated penalty: 0.15 per excess token beyond +1, capped at 0.45
    // STRICTER than before - penalty per token increased (Jan 2026)
    return Math.min(0.45, (excess - 1) * WEIGHTS.TOKEN_BLOAT_PENALTY);
}

/**
 * Penalty for candidates with lean/fat percentages when query doesn't specify one.
 * 
 * Problem: "ground beef" → "Organic 85% Lean Ground Beef" instead of generic.
 * Generic ground beef (~80/20) has different nutrition than lean variants.
 * 
 * Regex patterns match: "85%", "93% lean", "85/15", "90/10", "(lean)" alone, etc.
 * 
 * @param query - The normalized ingredient name
 * @param candidateName - The candidate food name
 * @returns Penalty (0 or UNSPECIFIED_LEAN_PENALTY)
 */
function getLeanPercentagePenalty(query: string, candidateName: string): number {
    const queryLower = query.toLowerCase();
    const candLower = candidateName.toLowerCase();

    // Patterns that indicate query specifies lean preference
    const LEAN_QUERY_PATTERNS = [
        /\b\d{2,3}\s*%/,              // "85%", "93 %"
        /\b\d{2,3}\s*\/\s*\d{1,2}\b/, // "85/15", "90/10"
        /\blean\b/,                   // "lean", "extra lean"
    ];

    // Check if query already specifies lean - no penalty if so
    const querySpecifiesLean = LEAN_QUERY_PATTERNS.some(p => p.test(queryLower));
    if (querySpecifiesLean) {
        return 0;  // User wants lean - don't penalize lean candidates
    }

    // Patterns that indicate candidate is a lean variant
    const LEAN_CANDIDATE_PATTERNS = [
        /\b\d{2,3}\s*%\s*(lean)?/i,   // "85% lean", "93%"
        /\b\d{2,3}\s*\/\s*\d{1,2}\b/, // "85/15", "90/10"
        /\(lean\)/i,                  // "(lean)" label
    ];

    // Only apply to ground meat queries to avoid false positives
    const GROUND_MEAT_TERMS = ['ground beef', 'ground turkey', 'ground pork', 'ground chicken', 'ground lamb'];
    const isGroundMeatQuery = GROUND_MEAT_TERMS.some(term => queryLower.includes(term));

    if (!isGroundMeatQuery) {
        return 0;  // Only penalize for ground meat queries
    }

    // Check if candidate has lean percentage
    const candidateHasLean = LEAN_CANDIDATE_PATTERNS.some(p => p.test(candLower));
    if (candidateHasLean) {
        return WEIGHTS.UNSPECIFIED_LEAN_PENALTY;
    }

    return 0;
}

/**
 * Extract lean percentage from food name for display annotation.
 * Returns the lean % (e.g., "85%") or null if not found.
 * 
 * This is used to annotate food names when a lean variant is selected
 * for a generic ground meat query, so users know what they're getting.
 * 
 * @param candidateName - The food name to extract from
 * @returns The lean percentage string (e.g., "85% Lean") or null
 */
export function extractLeanPercentage(candidateName: string): string | null {
    // Match patterns like "85%", "85% Lean", "93% lean"
    const percentMatch = candidateName.match(/\b(\d{2,3})\s*%\s*(lean)?/i);
    if (percentMatch) {
        return `${percentMatch[1]}% Lean`;
    }

    // Match patterns like "85/15", "90/10"
    const ratioMatch = candidateName.match(/\b(\d{2,3})\s*\/\s*(\d{1,2})\b/);
    if (ratioMatch) {
        return `${ratioMatch[1]}% Lean`;
    }

    return null;
}

/**
 * Check if query is for generic ground meat (no lean % specified).
 * Used to determine if we should annotate the food name with lean %.
 */
export function isGenericGroundMeatQuery(query: string): boolean {
    const queryLower = query.toLowerCase();

    // Check if it's a ground meat query
    const GROUND_MEAT_TERMS = ['ground beef', 'ground turkey', 'ground pork', 'ground chicken', 'ground lamb'];
    const isGroundMeatQuery = GROUND_MEAT_TERMS.some(term => queryLower.includes(term));
    if (!isGroundMeatQuery) return false;

    // Check if query already specifies lean
    const LEAN_QUERY_PATTERNS = [
        /\b\d{2,3}\s*%/,              // "85%", "93 %"
        /\b\d{2,3}\s*\/\s*\d{1,2}\b/, // "85/15", "90/10"
        /\blean\b/,                   // "lean", "extra lean"
    ];

    return !LEAN_QUERY_PATTERNS.some(p => p.test(queryLower));
}

function computeSimpleScore(candidate: RerankCandidate, query: string, isBranded?: boolean, targetBrand?: string): number {
    let score = 0;

    // Normalize candidate name for scoring: strip raw-state tokens when query doesn't specify.
    // e.g. FDC "grape raw tomatoes" → scored as "grape tomatoes" → exact-match parity with
    // FatSecret "Grape Tomatoes". The original name is preserved for display.
    const scoringName = normalizeCandidateNameForScoring(candidate.name, query);

    // 1. Exact match bonus
    if (isExactMatch(query, scoringName)) {
        score += WEIGHTS.EXACT_MATCH;
    }

    // 2. Token overlap
    const overlap = computeTokenOverlap(query, scoringName);
    score += overlap * WEIGHTS.TOKEN_OVERLAP;

    // 2b. Penalty for extra tokens (words in candidate but not in query)
    // This prevents "banana" → "Banana Peppers" by penalizing the extra "peppers"
    const queryTokens = tokenize(query);
    const candTokens = tokenize(scoringName);
    // Don't count synonyms as extra tokens (e.g., "peel" isn't extra when query is "zest")
    const extraTokens = candTokens.filter(ct =>
        !queryTokens.some(qt => tokensMatch(qt, ct))
    );

    if (queryTokens.length > 0 && extraTokens.length > 0) {
        // Separate extra tokens into three buckets:
        // 1. Raw-state extras (raw, uncooked) — ZERO penalty when query doesn't specify cooking state
        //    These are the implicit default; FDC names often include "raw" for produce/meat.
        // 2. Other benign extras (baby, organic, baked, roasted…) — 25% penalty
        //    Cooked states ARE penalized since they differ from the raw default.
        // 3. Problematic extras (noodles, sauce, etc.) — full penalty
        const querySpecifiesCookingState = querySpeaksCookingState(query);
        const rawStateExtras = extraTokens.filter(t =>
            RAW_STATE_TOKENS.has(t) && !querySpecifiesCookingState
        );
        const remainingExtras = extraTokens.filter(t =>
            !(RAW_STATE_TOKENS.has(t) && !querySpecifiesCookingState)
        );
        const benignExtras = remainingExtras.filter(t => BENIGN_DESCRIPTOR_TOKENS.has(t));
        const problematicExtras = remainingExtras.filter(t => !BENIGN_DESCRIPTOR_TOKENS.has(t));

        if (rawStateExtras.length > 0) {
            logger.debug('computeSimpleScore.raw_state_exempt', {
                query,
                candidate: candidate.name,
                exempted: rawStateExtras,
            });
        }

        // Full penalty for problematic extras
        if (problematicExtras.length > 0) {
            const extraRatio = problematicExtras.length / (queryTokens.length + extraTokens.length);
            score -= extraRatio * WEIGHTS.EXTRA_TOKEN_PENALTY;
        }

        // Reduced penalty (25% of full) for benign descriptors
        // "baby spinach" has "baby" as benign → small penalty, still viable
        if (benignExtras.length > 0) {
            const benignRatio = benignExtras.length / (queryTokens.length + extraTokens.length);
            score -= benignRatio * WEIGHTS.EXTRA_TOKEN_PENALTY * 0.25;
        }
        // cookingStateExtras: zero penalty (no deduction applied)
    }

    // 2c. Token bloat penalty (catches compound products for simple queries)
    // e.g., "chilli peppers" (2 tokens) → "Chilli Peppers Cream Cheese" (4 tokens) = penalty
    const tokenBloatPenalty = getTokenBloatPenalty(query, candidate.name, isBranded);
    score -= tokenBloatPenalty;

    // 2c-2. Category-changing token penalty (Jan 2026)
    // Heavy penalty when candidate has parasitic tokens that completely change the food category
    // e.g., "spinach" → "Spinach Noodles" (noodles is category-changing)
    const categoryChangePenalty = getCategoryChangePenalty(query, candidate.name);
    score -= categoryChangePenalty;

    // 2d. Exact phrase boost (Jan 2026)
    // Boost candidates that contain exact multi-word phrases from query
    // e.g., "fat free mayonnaise" → "Fat Free Mayonnaise" gets boost over "Light Mayonnaise"
    const phraseBoost = getExactPhraseBoost(query, candidate.name);
    score += phraseBoost;

    // 2e. Lean percentage penalty (Jan 2026)
    // Penalize lean variants (85%, 93/7, etc.) when query doesn't specify lean
    // e.g., "ground beef" should prefer generic (~80/20) over "85% Lean Ground Beef"
    const leanPenalty = getLeanPercentagePenalty(query, candidate.name);
    score -= leanPenalty;

    // 2f. Semantic modifier match boost (Jan 2026)
    // Boost candidates that match the query's form modifiers (crushed, canned, dried, cube)
    // e.g., "crushed tomatoes" → "Crushed Tomatoes (Canned)" gets boost over "Tomatoes"
    // e.g., "beef stock cube" → "Beef Bouillon Cube" gets boost over "Beef Stock"
    const modifierBoost = getModifierMatchBoost(query, candidate.name);
    score += modifierBoost;

    // 2g. Word coverage bonus (Jan 2026)
    // Bonus for candidates where ALL query words appear (in order preferred)
    // e.g., "crushed tomatoes" → "Crushed Tomatoes" gets bonus over "Tomatoes"
    const wordCoverageBonus = getWordCoverageBonus(query, candidate.name);
    score += wordCoverageBonus;

    // 2h. Attribute contradiction penalty (Fix 49, Feb 2026)
    // Heavy penalty when query specifies one color/variety and candidate has a different one.
    // e.g., "green peppers" → "Red Bell Pepper" gets penalty (green ≠ red)
    const contradictionPenalty = getAttributeContradictionPenalty(query, candidate.name);
    score -= contradictionPenalty;

    // 2i. Missing cooking state penalty (Batch 4, Mar 2026)
    // Heavy penalty when query explicitly specifies a cooking state and candidate doesn't match.
    // e.g., "fried shallots" → "Shallots" gets penalty.
    const cookingStatePenalty = getMissingCookingStatePenalty(query, candidate.name);
    score -= cookingStatePenalty;
    
    // 2j. Canned Bean Contradiction Penalty (Batch 4, Mar 2026)
    // Heavy penalty when the query asks for canned beans, but the candidate has dry bean nutrition (>200 kcal/100g).
    const cannedBeanPenalty = getCannedBeanContradictionPenalty(query, candidate);
    score -= cannedBeanPenalty;

    // 2k. Processed Meat Penalty (Batch 5, Mar 2026)
    // Penalize meat candidates with unexpected carbs (>2g/100g = breaded/seasoned/deli)
    const processedMeatPenalty = getProcessedMeatPenalty(query, candidate);
    score -= processedMeatPenalty;

    // 3. Source tiebreaker — FDC wins for produce and unprocessed meat
    // When name-match scores are equal, prefer FDC (USDA) for its authoritative
    // nutritional accuracy on raw produce and meats (e.g. Grape Tomatoes: FDC=35 kcal/100g
    // vs FatSecret=13 kcal/100g). This is a small nudge, not a blanket preference.
    if (candidate.source === 'fdc' && isProduceOrMeat(query)) {
        score += 0.03;  // Small enough not to override a genuine name-quality difference
    }


    // 4. Prefer generic over branded (but smarter about it)
    if (!candidate.brandName) {
        // Prefer generic ONLY when the user didn't name a brand. When the query
        // names a brand (isBranded, or the static/lexicon detector matched one),
        // a brandless candidate is a WORSE match — granting it the no-brand bonus
        // is what let brandless records beat "ghost" et al. Suppress it here so
        // the brand-match bonus below wins deterministically without the LLM.
        if (!isBranded && !targetBrand) {
            score += WEIGHTS.NO_BRAND;
        }
    } else {
        const brandLower = candidate.brandName.toLowerCase().trim();
        const queryLower = query.toLowerCase().trim();

        // Check if query effectively IS the brand or contains it clearly
        // e.g. query "egg beaters" matches brand "egg beaters"
        const queryContainsBrand = queryLower.includes(brandLower) || brandLower.includes(queryLower);

        if (queryContainsBrand) {
            // User asked for this brand - give a positive bonus (not just zero penalty).
            // This is the key fix for ties like "Tomato Ketchup (Heinz)" vs "TOMATO KETCHUP (WEIS)"
            // when the query is "Heinz Tomato Ketchup".
            if (isBranded) {
                // Strong bonus: query explicitly names this brand AND we know it's a branded query.
                score += 0.25;
            } else if (targetBrand && brandLower === targetBrand.toLowerCase()) {
                // Static brand detector matched this exact brand — moderate bonus
                score += 0.15;
            }
            // If neither isBranded nor targetBrand: no penalty but no bonus either
        } else {
            const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
            const candNameLower = candidate.name.toLowerCase();

            // Check if branded item has BETTER token coverage than a generic would
            // e.g., "unsweetened coconut milk" → "Unsweetened Coconut Milk (Silk)" has ALL query tokens
            const allQueryTokensInName = queryWords.every(qw => candNameLower.includes(qw));

            // Count tokens in the candidate name (excluding brand in parens) vs query
            const candidateNameOnly = candidate.name.replace(/\([^)]+\)/g, '').trim();
            const candidateNameTokens = candidateNameOnly.toLowerCase().split(/\s+/).filter(w => w.length > 2);
            const extraCandidateTokens = candidateNameTokens.filter(ct => !queryWords.some(qw => ct.includes(qw) || qw.includes(ct)));
            const hasExtraNameTokens = extraCandidateTokens.length > 0;

            if (allQueryTokensInName && !hasExtraNameTokens) {
                // Branded item matches ALL query tokens AND has no extra name tokens - no penalty
                // e.g., "Unsweetened Coconut Milk (Silk)" for "unsweetened coconut milk"
            } else if (allQueryTokensInName && hasExtraNameTokens) {
                // Branded item covers all query tokens BUT has extra tokens in its name
                // e.g., "Italian Plum Tomato Marinara (Mezzetta)" for "plum tomato"
                // → The extra "Italian" + "Marinara" tokens indicate it's a different product
                score -= WEIGHTS.SIMPLE_INGREDIENT_BRAND_PENALTY;
            } else if (queryWords.length <= 2) {
                // Apply brand penalty for simple ingredients where branded doesn't have full coverage
                score -= WEIGHTS.SIMPLE_INGREDIENT_BRAND_PENALTY;
            }

            // Extra penalty for known bar/snack brands on produce-like queries
            if (BAR_BRANDS.has(brandLower)) {
                // Severe penalty - Luna, Clif, etc. should never match "lemon zest"
                score -= WEIGHTS.SIMPLE_INGREDIENT_BRAND_PENALTY * 2;
            }
        }
    }

    // 5. Prefer shorter, simpler names
    const nameLength = candidate.name.length;
    if (nameLength < 30) {
        score += WEIGHTS.SHORT_NAME * (1 - nameLength / 60);
    }

    // 6. Original API score (normalized to 0-1)
    score += Math.min(candidate.score, 1) * WEIGHTS.ORIGINAL_SCORE;

    return score;
}

// ============================================================
// Nutrition Scoring (Jan 2026)
// ============================================================

/**
 * Compute nutrition score based on AI estimate vs candidate's actual nutrition.
 * Only applies when:
 * - AI confidence >= NUTRITION_CONFIDENCE_GATE (0.7)
 * - Candidate has per-100g nutrition data
 * 
 * Returns a score between -WEIGHTS.NUTRITION_CALORIE_SCORING and +WEIGHTS.NUTRITION_CALORIE_SCORING
 */
function computeNutritionScore(
    candidate: RerankCandidate,
    aiEstimate?: AiNutritionEstimate
): { score: number; reason?: string } {
    // Skip if no AI estimate or low confidence
    if (!aiEstimate || aiEstimate.confidence < NUTRITION_CONFIDENCE_GATE) {
        return { score: 0 };
    }

    // Skip if candidate doesn't have per-100g nutrition
    if (!candidate.nutrition?.per100g || candidate.nutrition.kcal == null) {
        return { score: 0 };
    }

    let score = 0;
    const reasons: string[] = [];

    // 1. Calorie scoring (primary signal - weight 0.12)
    const estimatedCalories = aiEstimate.caloriesPer100g;
    const actualCalories = candidate.nutrition.kcal;

    if (estimatedCalories > 0 && actualCalories >= 0) {
        const calorieDiff = Math.abs(actualCalories - estimatedCalories) / estimatedCalories;

        if (calorieDiff <= NUTRITION_CALORIE_VARIANCE_THRESHOLD) {
            // Within threshold: small bonus based on closeness
            const closenessBonus = (1 - (calorieDiff / NUTRITION_CALORIE_VARIANCE_THRESHOLD));
            score += closenessBonus * WEIGHTS.NUTRITION_CALORIE_SCORING * aiEstimate.confidence;
            reasons.push(`kcal_match:+${(closenessBonus * WEIGHTS.NUTRITION_CALORIE_SCORING * aiEstimate.confidence).toFixed(3)}`);
        } else if (calorieDiff > 2.0) {
            // EXTREME mismatch (>200% off) — heavy penalty to reject wrong food categories
            // e.g., kettle corn (545 kcal/100g) vs expected plain corn (~86 kcal/100g) = 533% off
            // This penalty is strong enough to overcome API score advantages
            const extremePenalty = 0.35 * aiEstimate.confidence;
            score -= extremePenalty;
            reasons.push(`kcal_extreme_mismatch:-${extremePenalty.toFixed(3)}`);
        } else {
            // Outside threshold but not extreme: standard penalty
            const penaltyAmount = Math.min(calorieDiff, 1);  // Cap at 100% difference
            score -= penaltyAmount * WEIGHTS.NUTRITION_CALORIE_SCORING * aiEstimate.confidence;
            reasons.push(`kcal_mismatch:-${(penaltyAmount * WEIGHTS.NUTRITION_CALORIE_SCORING * aiEstimate.confidence).toFixed(3)}`);
        }
    }

    // 2. Missing macros detection (Option B fix)
    // If candidate shows P:0, C:0 but AI expects meaningful values, it's likely bad data
    const candidateProtein = candidate.nutrition.protein ?? 0;
    const candidateCarbs = candidate.nutrition.carbs ?? 0;
    const candidateFat = candidate.nutrition.fat ?? 0;

    const aiExpectsProtein = aiEstimate.proteinPer100g > 5;
    const aiExpectsCarbs = aiEstimate.carbsPer100g > 5;

    // Check for suspiciously missing macros (P:0 AND C:0 when both expected)
    if (aiExpectsProtein && aiExpectsCarbs && candidateProtein === 0 && candidateCarbs === 0) {
        score -= WEIGHTS.MISSING_MACRO_PENALTY * aiEstimate.confidence;
        reasons.push('missing_macros');
    }

    // 3. Macro sanity check (secondary signal)
    // Penalize if macros are WAY off (50% variance)
    const macroDiffThreshold = 0.50;
    if (aiExpectsProtein) {
        const proteinDiff = Math.abs(candidateProtein - aiEstimate.proteinPer100g) / aiEstimate.proteinPer100g;
        if (proteinDiff > macroDiffThreshold) {
            score -= WEIGHTS.NUTRITION_MACRO_SCORING * aiEstimate.confidence;
            reasons.push('protein_mismatch');
        }
    }
    if (aiEstimate.fatPer100g > 3) {
        const fatDiff = Math.abs(candidateFat - aiEstimate.fatPer100g) / aiEstimate.fatPer100g;
        if (fatDiff > macroDiffThreshold) {
            score -= WEIGHTS.NUTRITION_MACRO_SCORING * aiEstimate.confidence;
            reasons.push('fat_mismatch');
        }
    }

    // 4. Unexpected carbs in protein-dominant foods (Mar 2026)
    // When AI expects near-zero carbs (<2g/100g) and high protein (>15g/100g) — typical
    // of raw meat/poultry — but candidate shows meaningful carbs (>1g/100g), it's likely
    // a seasoned/breaded/processed branded product, not the plain ingredient.
    // e.g., CHICKEN BREAST (GIANT EAGLE) has 1% carbs → seasoned, not raw.
    const aiExpectsNearZeroCarbs = aiEstimate.carbsPer100g < 2;
    const aiExpectsHighProtein = aiEstimate.proteinPer100g > 15;
    if (aiExpectsNearZeroCarbs && aiExpectsHighProtein && candidateCarbs > 1) {
        score -= WEIGHTS.NUTRITION_MACRO_SCORING * aiEstimate.confidence;
        reasons.push('unexpected_carbs_in_protein');
    }

    return {
        score,
        reason: reasons.length > 0 ? reasons.join(',') : undefined
    };
}

// ============================================================
// Decisive Brand Gate (brand-hijack fix, Jul 2026)
// ============================================================

/**
 * Product-form tokens that, adjacent to a detected single-word brand token,
 * make the brand reading unambiguous ("ghost protein", "built bar") as opposed
 * to coincidental English usage ("ghost pepper", "one apple").
 */
const BRAND_PRODUCT_CONTEXT_TOKENS = new Set([
    'protein', 'whey', 'isolate', 'casein', 'powder', 'shake', 'bar', 'bars',
    'energy', 'drink', 'preworkout', 'pre-workout', 'bcaa', 'aminos',
    'creatine', 'gamer', 'greens', 'electrolytes', 'hydration',
]);

/**
 * A brand hit is "decisive" only when the evidence spans two words: either the
 * detected brand itself is multi-word ("one bar", "optimum nutrition"), or the
 * single brand token sits directly next to a product-form token in the text.
 * Single-word brands that double as common English words ("ghost", "one",
 * "built") never qualify on their own.
 */
export function hasDecisiveBrandContext(text: string, targetBrand: string): boolean {
    const brandTokens = targetBrand.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (brandTokens.length === 0) return false;
    if (brandTokens.length >= 2) return true;
    const tokens = text.toLowerCase().split(/[\s,()[\]{}]+/).filter(t => t.length > 0);
    const idx = tokens.indexOf(brandTokens[0]);
    if (idx === -1) return false;
    const prev = tokens[idx - 1];
    const next = tokens[idx + 1];
    return (prev !== undefined && BRAND_PRODUCT_CONTEXT_TOKENS.has(prev))
        || (next !== undefined && BRAND_PRODUCT_CONTEXT_TOKENS.has(next));
}

/**
 * Whole-token brand match: the candidate must carry the detected brand's first
 * token as a full word — in its brand field OR its name, because OFF records
 * often embed the brand in the name with an empty brand field ("Ghost Whey
 * Protein (Cinnabon)", brand ""). Substring matching is unsafe ("one" would
 * match "Toblerone"); requiring every detected token is too strict because
 * lexicon entries can be brand+form ("one bar" vs brand "ONE Brands").
 */
export function candidateMatchesTargetBrand(brandName: string | undefined, candidateName: string, targetBrand: string): boolean {
    const brandTokens = targetBrand.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (brandTokens.length === 0) return false;
    const candTokens = `${candidateName} ${brandName ?? ''}`.toLowerCase()
        .split(/[\s,()[\]{}]+/).filter(Boolean);
    return candTokens.includes(brandTokens[0]);
}

/**
 * The decisive boost additionally requires the same-brand candidate to look
 * like the product the user described: its NAME (not brand) must cover at
 * least one non-brand query token. Keeps "Ghost Energy Drink" from hijacking
 * "ghost protein cinnamon roll" just for sharing the brand.
 */
function coversNonBrandQueryToken(candidateName: string, query: string, targetBrand: string): boolean {
    const brandTokens = new Set(targetBrand.toLowerCase().trim().split(/\s+/).filter(Boolean));
    const queryTokens = query.toLowerCase().split(/[\s,()[\]{}]+/)
        .filter(t => t.length > 2 && !brandTokens.has(t));
    if (queryTokens.length === 0) return false;
    const nameLower = candidateName.toLowerCase();
    return queryTokens.some(t => nameLower.includes(t));
}

// ============================================================
// Main Rerank Function
// ============================================================

/**
 * Simple rerank: Pick the best candidate using token-based scoring.
 * No AI calls - fast and deterministic.
 * 
 * @param query - The normalized ingredient name
 * @param candidates - List of candidates from APIs
 * @param aiNutritionEstimate - Optional AI-estimated nutrition for scoring
 * @param rawLine - Optional raw ingredient line for modifier constraint extraction
 */
export function simpleRerank(
    query: string,
    candidates: RerankCandidate[],
    aiNutritionEstimate?: AiNutritionEstimate,
    rawLine?: string,
    isBranded?: boolean,
    targetBrand?: string,
    preferCountLabeled?: boolean
): { winner: RerankCandidate | null; confidence: number; reason: string; sortedCandidates: RerankCandidate[] } {
    if (candidates.length === 0) {
        return {
            winner: null,
            confidence: 0,
            reason: 'no_candidates',
            sortedCandidates: []
        };
    }

    if (candidates.length === 1) {
        const singleConfidence = Math.min(candidates[0].score, 0.95);

        // MINIMUM CONFIDENCE THRESHOLD (Jan 2026)
        // If the only candidate has low confidence, reject it to trigger fallback.
        // This prevents "burger relish" → "Black Bean Burger" at 0.68 confidence.
        // NOTE: Lowered from 0.80 to 0.75 to match main threshold
        const MIN_SINGLE_CANDIDATE_CONFIDENCE = 0.75;
        if (singleConfidence < MIN_SINGLE_CANDIDATE_CONFIDENCE) {
            logger.info('simple_rerank.single_candidate_rejected', {
                candidate: candidates[0].name,
                confidence: singleConfidence.toFixed(3),
                threshold: MIN_SINGLE_CANDIDATE_CONFIDENCE,
                reason: 'confidence_below_threshold'
            });
            return {
                winner: null,
                confidence: singleConfidence,
                reason: 'confidence_below_threshold',
                sortedCandidates: candidates
            };
        }

        return {
            winner: candidates[0],
            confidence: singleConfidence,
            reason: 'single_candidate',
            sortedCandidates: candidates
        };
    }

    // Step 4: Extract modifier constraints from the raw line (or query)
    const constraints = extractModifierConstraints(rawLine || query);

    // Decisive brand gate (brand-hijack fix, Jul 2026): when the query names a
    // brand with two-word evidence, same-brand candidates that also cover a
    // non-brand query token get a boost big enough to overturn a cross-brand
    // competitor's flavor-token coverage lead (the n-seg-21 / n-brand-02 class).
    const decisiveBrandActive = !!targetBrand
        && hasDecisiveBrandContext(rawLine || query, targetBrand);
    const isDecisiveBrandCandidate = (c: RerankCandidate): boolean =>
        decisiveBrandActive
        && candidateMatchesTargetBrand(c.brandName, c.name, targetBrand!)
        && coversNonBrandQueryToken(c.name, query, targetBrand!);

    // Cooked-grain preference (cooked-vs-dry fix, Jul 2026): a volume-unit
    // grain line prefers cooked records. A candidate "looks cooked" by name
    // OR by nutrition — cooked grains sit at ~100-170 kcal/100g while dry ones
    // are ~330-380, a clean separation — because many cooked records are
    // neutrally named ("White Rice" at 162 kcal/100g).
    // Variety guard: the normalizer strips variety adjectives from the query
    // ("white rice" → "rice"), so check the RAW line — "1 cup white rice" must
    // not partition up "cooked wild rice" over a cooked white-rice record.
    const grainSoftCooked = !!detectGrainCookingContext(rawLine || query, query).softCooked;
    const GRAIN_VARIETY_TOKENS = ['white', 'brown', 'wild', 'jasmine', 'basmati', 'black', 'red', 'glutinous', 'sticky'];
    const rawLower = (rawLine || query).toLowerCase();
    const queryVarieties = grainSoftCooked
        ? GRAIN_VARIETY_TOKENS.filter(v => new RegExp(`\\b${v}\\b`).test(rawLower))
        : [];
    // Raw-line food tokens for the within-partition tiebreak ("white rice
    // cooked" covers 2 of {white, rice}; "cream of rice cooked" covers 1).
    const GRAIN_LINE_NOISE = new Set(['cup', 'cups', 'bowl', 'bowls', 'serving', 'servings', 'one', 'two', 'three', 'and', 'with', 'the']);
    const rawFoodTokens = grainSoftCooked
        ? rawLower.split(/[^a-z]+/).filter(t => t.length > 2 && !GRAIN_LINE_NOISE.has(t))
        : [];
    const isCookedGrainCandidate = (c: RerankCandidate): boolean => {
        if (!grainSoftCooked) return false;
        // Nutrition window: cooked grains run ~97-170 kcal with carbs >= ~20;
        // dry grains ~330-380. The carbs floor keeps low-kcal NON-grain rows
        // (rice milk at 47 kcal / 9g carbs) out of the partition.
        const looksCooked = /\b(cooked|boiled|steamed|prepared)\b/i.test(c.name)
            || (c.nutrition?.per100g === true
                && c.nutrition.kcal > 60 && c.nutrition.kcal <= 250
                && c.nutrition.carbs >= 12);
        if (!looksCooked) return false;
        if (queryVarieties.length > 0) {
            const nameLower = c.name.toLowerCase();
            const candVarieties = GRAIN_VARIETY_TOKENS.filter(v => new RegExp(`\\b${v}\\b`).test(nameLower));
            if (candVarieties.length > 0 && !candVarieties.some(v => queryVarieties.includes(v))) {
                return false;
            }
        }
        return true;
    };
    const grainRawCoverage = (c: RerankCandidate): number => {
        if (rawFoodTokens.length === 0) return 0;
        const nameLower = c.name.toLowerCase();
        return rawFoodTokens.filter(t => new RegExp(`\\b${t}\\b`).test(nameLower)).length;
    };

    // Plausibility partition (PR D pt3): a candidate whose per-100g macros trip
    // a deterministic floor for this query (sweetener kcal<250, produce kcal<12
    // or >150, legume kcal<50, lean-cut protein<18, zero-protein protein food)
    // — or whose OFF record is on the triage-confirmed corrupt denylist — must
    // never outrank a plausible candidate on raw score alone (the lemon-383
    // kJ-as-kcal class). Floor-hits are sorted BELOW, never dropped: an
    // all-floor pool is a comparative no-op, so corpus-gap queries can't
    // strand. The denylist check here is rerank-side demotion only — the
    // mapper-side hard drop lives with the filter stage.
    // Kill-switch: RANK_PLAUSIBILITY_PARTITION="0" restores today's ordering.
    const plausibilityPartitionActive = process.env.RANK_PLAUSIBILITY_PARTITION !== '0';
    const isPlausibilityFloorHit = (c: RerankCandidate): boolean => {
        if (!plausibilityPartitionActive) return false;
        if (isDenylistedOffRecord(c.id)) return true;
        // No per-100g nutrition → nothing to assess → not flagged.
        if (!c.nutrition?.per100g) return false;
        return assessRankTimePlausibility(query, c.name, c.nutrition).floorHit;
    };

    // Score all candidates (base score + nutrition score + modifier constraints)
    const scored = candidates
        .map(c => {
            // Apply modifier constraints (Step 4)
            const constraintResult = applyModifierConstraints(
                { name: c.name, brandName: c.brandName },
                constraints
            );

            // Skip rejected candidates entirely
            if (constraintResult.rejected) {
                return null;
            }

            const baseScore = computeSimpleScore(c, query, isBranded, targetBrand);
            const nutritionResult = computeNutritionScore(c, aiNutritionEstimate);

            // Apply constraint penalty
            const constraintPenalty = constraintResult.penalty * 0.5; // Scale penalty to reasonable range

            const countLabelBoost = (preferCountLabeled && c.countLabelMatch) ? WEIGHTS.COUNT_LABEL_BOOST : 0;
            const servingLabelBoost = c.servingLabelMatch ? WEIGHTS.SERVING_LABEL_BOOST : 0;
            const decisiveBrandBoost = isDecisiveBrandCandidate(c) ? WEIGHTS.DECISIVE_BRAND_BOOST : 0;
            const grainCookedBoost = isCookedGrainCandidate(c) ? WEIGHTS.GRAIN_COOKED_VOLUME_BOOST : 0;

            return {
                candidate: c,
                score: baseScore + nutritionResult.score - constraintPenalty + countLabelBoost + servingLabelBoost + decisiveBrandBoost + grainCookedBoost,
                baseScore,
                nutritionScore: nutritionResult.score,
                nutritionReason: nutritionResult.reason,
                constraintPenalty,
                constraintReason: constraintResult.reason,
                countLabelBoost,
                decisiveBrandBoost,
                grainCookedBoost,
                grainCookedCoverage: grainCookedBoost > 0 ? grainRawCoverage(c) : 0,
                plausibilityFloorHit: isPlausibilityFloorHit(c),
            };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

    // If all candidates were rejected by constraints, fall back to original scoring without constraints
    if (scored.length === 0) {
        logger.warn('simple_rerank.all_rejected', {
            query,
            rawLine,
            candidateCount: candidates.length,
            constraints: {
                requiredTokens: constraints.requiredTokens.slice(0, 3),
                bannedTokens: constraints.bannedTokens.slice(0, 3)
            }
        });
        // Re-score without constraint rejection (still apply penalties)
        const fallbackScored = candidates.map(c => {
            const baseScore = computeSimpleScore(c, query, isBranded, targetBrand);
            const nutritionResult = computeNutritionScore(c, aiNutritionEstimate);
            const countLabelBoost = (preferCountLabeled && c.countLabelMatch) ? WEIGHTS.COUNT_LABEL_BOOST : 0;
            const servingLabelBoost = c.servingLabelMatch ? WEIGHTS.SERVING_LABEL_BOOST : 0;
            const decisiveBrandBoost = isDecisiveBrandCandidate(c) ? WEIGHTS.DECISIVE_BRAND_BOOST : 0;
            const grainCookedBoost = isCookedGrainCandidate(c) ? WEIGHTS.GRAIN_COOKED_VOLUME_BOOST : 0;
            return {
                candidate: c,
                score: baseScore + nutritionResult.score + countLabelBoost + servingLabelBoost + decisiveBrandBoost + grainCookedBoost,
                baseScore,
                nutritionScore: nutritionResult.score,
                nutritionReason: nutritionResult.reason,
                constraintPenalty: 0,
                constraintReason: 'fallback_no_rejection',
                countLabelBoost,
                decisiveBrandBoost,
                grainCookedBoost,
                grainCookedCoverage: grainCookedBoost > 0 ? grainRawCoverage(c) : 0,
                plausibilityFloorHit: isPlausibilityFloorHit(c),
            };
        });
        scored.push(...fallbackScored);
    }

    // Sort by score descending, with deterministic tiebreaker (ID) to ensure stable results
    // This prevents non-determinism when candidates have equal scores
    scored.sort((a, b) => {
        // Decisive brand partition: when the gate is active, gated same-brand
        // candidates always rank above cross-brand ones — a hijacker's exact
        // flavor-name coverage must not outscore the brand the user named.
        // Within the partition, normal score order still picks the best record.
        if (decisiveBrandActive) {
            const aDecisive = a.decisiveBrandBoost > 0 ? 1 : 0;
            const bDecisive = b.decisiveBrandBoost > 0 ? 1 : 0;
            if (aDecisive !== bDecisive) return bDecisive - aDecisive;
        }

        // Cooked-grain partition: same pattern — under softCooked context a
        // cooked record must beat a dry exact-match ("White Rice" @350 kcal)
        // whose name quality otherwise outscores any boost. Within the
        // partition, prefer candidates covering more raw-line food tokens
        // ("white rice cooked" over "cream of rice cooked" for "white rice"),
        // then fall through to score order.
        if (grainSoftCooked) {
            const aCooked = a.grainCookedBoost > 0 ? 1 : 0;
            const bCooked = b.grainCookedBoost > 0 ? 1 : 0;
            if (aCooked !== bCooked) return bCooked - aCooked;
            if (aCooked && bCooked && a.grainCookedCoverage !== b.grainCookedCoverage) {
                return b.grainCookedCoverage - a.grainCookedCoverage;
            }
        }

        // Plausibility partition (PR D pt3): strictly BELOW the decisive-brand
        // and cooked-grain partitions — those deliberate preferences may pick
        // a floor-hit record, but among ordinary candidates an implausible or
        // denylisted one only wins when nothing plausible exists (all-floor is
        // a no-op by construction). No-floor sorts first.
        if (plausibilityPartitionActive) {
            const aFloor = a.plausibilityFloorHit ? 1 : 0;
            const bFloor = b.plausibilityFloorHit ? 1 : 0;
            if (aFloor !== bFloor) return aFloor - bFloor;
        }

        const scoreDiff = b.score - a.score;
        if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;

        // Tiebreaker 1: Prefer candidates with exact phrase matches from query
        // e.g., "fat free mayonnaise" → "Fat Free Mayonnaise" beats "Light Mayonnaise"
        const aPhraseBst = getExactPhraseBoost(query, a.candidate.name) > 0 ? 1 : 0;
        const bPhraseBst = getExactPhraseBoost(query, b.candidate.name) > 0 ? 1 : 0;
        if (bPhraseBst !== aPhraseBst) return bPhraseBst - aPhraseBst;

        // Tiebreaker 2: brand preference.
        // When the query names a brand, prefer the candidate whose brand matches
        // it (a brandless record is the wrong answer for "ghost ..."). Otherwise
        // fall back to the historical preference for generic/non-branded foods.
        const namedBrand = (targetBrand ?? '').toLowerCase().trim();
        if (isBranded || namedBrand) {
            const aMatchesBrand = a.candidate.brandName && namedBrand
                && a.candidate.brandName.toLowerCase().includes(namedBrand) ? 1 : 0;
            const bMatchesBrand = b.candidate.brandName && namedBrand
                && b.candidate.brandName.toLowerCase().includes(namedBrand) ? 1 : 0;
            if (aMatchesBrand !== bMatchesBrand) return bMatchesBrand - aMatchesBrand;
        } else {
            const aHasBrand = a.candidate.brandName ? 1 : 0;
            const bHasBrand = b.candidate.brandName ? 1 : 0;
            if (aHasBrand !== bHasBrand) return aHasBrand - bHasBrand;
        }

        // Tiebreaker 3: nutrition closeness — prefer candidate whose per-100g
        // calories are closest to the AI estimate. This resolves cases like
        // rice vinegar where all branded entries score identically on name
        // matching, but seasoned (45 kcal/tbsp) vs plain (0 kcal/tbsp) differ hugely.
        if (aiNutritionEstimate &&
            aiNutritionEstimate.confidence >= NUTRITION_CONFIDENCE_GATE &&
            aiNutritionEstimate.caloriesPer100g > 0) {
            const aHasNutr = a.candidate.nutrition?.per100g && a.candidate.nutrition.kcal != null;
            const bHasNutr = b.candidate.nutrition?.per100g && b.candidate.nutrition.kcal != null;
            if (aHasNutr && bHasNutr) {
                const aDev = Math.abs(a.candidate.nutrition!.kcal - aiNutritionEstimate.caloriesPer100g);
                const bDev = Math.abs(b.candidate.nutrition!.kcal - aiNutritionEstimate.caloriesPer100g);
                if (Math.abs(aDev - bDev) > 0.5) {  // Only break tie if difference is meaningful
                    return aDev - bDev;  // Lower deviation wins (sorts first)
                }
            }
        }

        // Final tiebreaker: sort by ID for absolute determinism
        return a.candidate.id.localeCompare(b.candidate.id);
    });

    // Per-candidate score breakdown (Bug 3 fix, Feb 2026)
    // Shows ALL score components for top candidates to aid debugging.
    // Enable: set DEBUG_RERANK_SCORES=true or pass debug option.
    if (process.env.DEBUG_RERANK_SCORES === 'true') {
        console.log(`\n  ── Rerank Scores for "${query}" (${scored.length} candidates) ──`);
        scored.slice(0, 10).forEach((s, i) => {
            // Re-compute individual score components for the breakdown
            const scoringName = normalizeCandidateNameForScoring(s.candidate.name, query);
            const exact = isExactMatch(query, scoringName) ? WEIGHTS.EXACT_MATCH : 0;
            const overlap = computeTokenOverlap(query, scoringName) * WEIGHTS.TOKEN_OVERLAP;
            const catChange = getCategoryChangePenalty(query, s.candidate.name);
            const contradiction = getAttributeContradictionPenalty(query, s.candidate.name);
            const bloat = getTokenBloatPenalty(query, s.candidate.name, isBranded);
            const phrase = getExactPhraseBoost(query, s.candidate.name);
            const modifier = getModifierMatchBoost(query, s.candidate.name);
            const coverage = getWordCoverageBonus(query, s.candidate.name);
            const apiScore = Math.min(s.candidate.score, 1) * WEIGHTS.ORIGINAL_SCORE;
            const fdcBoost = (s.candidate.source === 'fdc' && isProduceOrMeat(query)) ? 0.03 : 0;
            const brand = !s.candidate.brandName ? WEIGHTS.NO_BRAND : 0;
            const nutrDev = (aiNutritionEstimate && s.candidate.nutrition?.per100g && s.candidate.nutrition.kcal != null)
                ? Math.abs(s.candidate.nutrition.kcal - aiNutritionEstimate.caloriesPer100g).toFixed(0)
                : '—';

            console.log(
                `  ${String(i + 1).padStart(3)}. ${s.candidate.name.slice(0, 45).padEnd(45)} ` +
                `total=${s.score.toFixed(3)} base=${s.baseScore.toFixed(3)} ` +
                `[exact=${exact.toFixed(2)} overlap=${overlap.toFixed(2)} api=${apiScore.toFixed(2)} ` +
                `catΔ=-${catChange.toFixed(2)} contra=-${contradiction.toFixed(2)} bloat=-${bloat.toFixed(2)} ` +
                `phrase=${phrase.toFixed(2)} mod=${modifier.toFixed(2)} cover=${coverage.toFixed(2)} ` +
                `fdc=${fdcBoost.toFixed(2)} brand=${brand.toFixed(2)}] ` +
                `nutr=${s.nutritionScore.toFixed(3)} nutrDev=${nutrDev} constr=-${s.constraintPenalty.toFixed(3)} ` +
                `cnt=${((s as any).countLabelBoost ?? 0).toFixed(2)} dbrand=${((s as any).decisiveBrandBoost ?? 0).toFixed(2)} ` +
                `floor=${s.plausibilityFloorHit ? 1 : 0} src=${s.candidate.source}`
            );
        });
        console.log();
    }

    const top = scored[0];
    const second = scored[1];

    // Fix 50 (Feb 2026): Compute gap against the first DISTINCT runner-up.
    // Duplicate API entries (e.g., two "Strawberries" from FatSecret with different IDs)
    // create a near-zero gap that artificially suppresses confidence.
    // We normalize names (lowercase, strip brand) to find the real competitor.
    const topNameNorm = top.candidate.name.toLowerCase().replace(/\s*\(.*\)\s*$/, '').trim();
    let effectiveRunnerUp = second;
    for (let i = 1; i < scored.length; i++) {
        const candNameNorm = scored[i].candidate.name.toLowerCase().replace(/\s*\(.*\)\s*$/, '').trim();
        if (candNameNorm !== topNameNorm) {
            effectiveRunnerUp = scored[i];
            break;
        }
    }
    const gap = top.score - effectiveRunnerUp.score;

    // Determine confidence based on score and gap
    let confidence = Math.min(0.5 + top.score * 0.5, 0.95);
    if (gap > 0.1) {
        confidence = Math.min(confidence + 0.1, 0.95);
    }

    // Determine reason
    let reason = 'simple_rerank';
    if (isExactMatch(query, top.candidate.name)) {
        reason = 'exact_match';
        confidence = Math.min(confidence + 0.1, 0.98);
    } else if (gap > 0.15) {
        reason = 'clear_winner';
    } else if (gap < 0.05) {
        reason = 'close_match';
    }

    // A cooked-partition winner's low name-match score is EXPECTED (query
    // "rice" vs "white medium-grain cooked unenriched rice") — floor its
    // confidence so the deliberate cooked preference isn't discarded by the
    // minimum-confidence rejection below and re-replaced with the dry top1.
    if (grainSoftCooked && top.grainCookedBoost > 0) {
        confidence = Math.max(confidence, 0.75);
        reason = 'cooked_grain_preference';
    }

    if (decisiveBrandActive && top.decisiveBrandBoost > 0) {
        logger.info('simple_rerank.decisive_brand_winner', {
            query,
            targetBrand,
            winner: top.candidate.name,
            winnerBrand: top.candidate.brandName,
        });
    }

    logger.debug('simple_rerank.result', {
        query,
        winner: top.candidate.name,
        winnerScore: top.score.toFixed(3),
        winnerBaseScore: top.baseScore.toFixed(3),
        winnerNutritionScore: top.nutritionScore.toFixed(3),
        winnerNutritionReason: top.nutritionReason,
        runnerUp: second.candidate.name,
        runnerUpScore: second.score.toFixed(3),
        effectiveRunnerUp: effectiveRunnerUp.candidate.name,
        effectiveRunnerUpScore: effectiveRunnerUp.score.toFixed(3),
        gap: gap.toFixed(3),
        confidence: confidence.toFixed(2),
        reason,
        winnerPlausibilityFloorHit: top.plausibilityFloorHit,
    });

    // MINIMUM CONFIDENCE THRESHOLD (Jan 2026)
    // Reject low-confidence winners to trigger fallback recovery.
    // This prevents "burger relish" → "Black Bean Burger" at 0.68 confidence.
    // NOTE: Lowered from 0.80 → 0.74 → 0.70 to allow close semantic matches like:
    //   - "sugar free" ↔ "no sugar added" (cherry pie filling)
    //   - "plum tomatoes" ↔ "whole peeled plum tomatoes" (0.741 conf)
    //   - "green peppers cut in strips" ↔ "bell green raw peppers" (0.72 conf)
    const MIN_RERANK_CONFIDENCE = 0.70;

    if (confidence < MIN_RERANK_CONFIDENCE) {
        logger.info('simple_rerank.winner_rejected', {
            winner: top.candidate.name,
            confidence: confidence.toFixed(3),
            threshold: MIN_RERANK_CONFIDENCE,
            reason: 'confidence_below_threshold'
        });
        return {
            winner: null,
            confidence,
            reason: 'confidence_below_threshold',
            sortedCandidates: scored.map(s => s.candidate),
        };
    }

    return {
        winner: top.candidate,
        confidence,
        reason,
        sortedCandidates: scored.map(s => s.candidate),
    };
}

/**
 * Convert UnifiedCandidate to RerankCandidate format.
 * Helper for integrating with existing pipeline.
 */
export function toRerankCandidate(candidate: {
    id: string;
    name: string;
    brandName?: string | null;
    foodType?: string | null;
    score: number;
    source: 'fatsecret' | 'fdc' | 'cache' | 'openfoodfacts' | 'ai_generated';
    nutrition?: {
        kcal: number;
        protein: number;
        carbs: number;
        fat: number;
        per100g: boolean;
    };
    countLabelMatch?: boolean;
    servingLabelMatch?: boolean;
}): RerankCandidate {
    // Some FDC entries have doubled descriptions (a known FDC data quality issue).
    // e.g. "peeled plum tomatoes peeled plum tomatoes" → "peeled plum tomatoes"
    // Deduplicating prevents the token bloat penalty from unfairly hurting these entries.
    let name = candidate.name;
    if (candidate.source === 'fdc') {
        const half = Math.floor(name.length / 2);
        const firstHalf = name.slice(0, half).trim();
        const secondHalf = name.slice(half).trim();
        if (firstHalf && firstHalf === secondHalf) {
            name = firstHalf;
        }
    }

    return {
        id: candidate.id,
        name,
        brandName: candidate.brandName || undefined,
        foodType: candidate.foodType || undefined,
        score: candidate.score,
        source: candidate.source,
        nutrition: candidate.nutrition,
        countLabelMatch: candidate.countLabelMatch,
        servingLabelMatch: candidate.servingLabelMatch,
    };
}
