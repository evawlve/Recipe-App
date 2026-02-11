/**
 * Simple Reranking Module
 * 
 * Replaces AI reranking with a fast, deterministic scoring algorithm.
 * Uses token overlap, source preference, and name similarity.
 */

import { logger } from '../logger';
import { extractModifierConstraints, applyModifierConstraints, type ModifierConstraints, type ConstraintResult } from './modifier-constraints';

export interface RerankCandidate {
    id: string;
    name: string;
    brandName?: string;
    foodType?: string;
    score: number;
    source: 'fatsecret' | 'fdc' | 'cache';
    nutrition?: {
        kcal: number;
        protein: number;
        carbs: number;
        fat: number;
        per100g: boolean;
    };
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
    SOURCE_FATSECRET: 0.15,  // Prefer FatSecret (better servings) - INCREASED from 0.1
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
};


// Nutrition scoring thresholds
const NUTRITION_CALORIE_VARIANCE_THRESHOLD = 0.30;  // 30% difference triggers penalty
const NUTRITION_CONFIDENCE_GATE = 0.70;             // Only apply if AI confidence >= 0.7

// Modifiers/descriptors we should ignore in matching
const IGNORE_TOKENS = new Set([
    'raw', 'fresh', 'organic', 'natural', 'whole',
    'all', 'purpose', 'pure', 'real', 'original',
    // Form descriptors - shouldn't affect core food identity matching
    // e.g., "powdered sugar substitute" should match sugar substitutes, not "Cream Substitute (Powdered)"
    'powdered', 'granulated', 'liquid', 'dry', 'powder',
]);

// Benign descriptor tokens - these add context but don't change food category
// These should receive REDUCED extra token penalty (not eliminated, but less harsh)
// e.g., "baby spinach", "water spinach", "creamed spinach" are all still spinach
const BENIGN_DESCRIPTOR_TOKENS = new Set([
    // Size/age descriptors
    'baby', 'mini', 'small', 'medium', 'large', 'jumbo', 'giant', 'young', 'mature',
    // Freshness/state descriptors  
    'raw', 'fresh', 'frozen', 'canned', 'dried', 'dehydrated', 'cooked', 'steamed',
    'boiled', 'roasted', 'grilled', 'baked', 'fried', 'sauteed',
    // Quality/type descriptors
    'organic', 'natural', 'wild', 'farmed', 'domestic', 'imported',
    // Color descriptors (for produce varieties)
    'red', 'green', 'yellow', 'orange', 'white', 'purple', 'black', 'golden',
    // Preparation descriptors
    'chopped', 'diced', 'sliced', 'minced', 'crushed', 'ground', 'whole', 'halved',
    'shredded', 'grated', 'cubed', 'julienne', 'peeled', 'skinless', 'boneless',
    // Common variety descriptors
    'sweet', 'sour', 'bitter', 'spicy', 'hot', 'mild',
    // Plant parts
    'leaf', 'leaves', 'stalk', 'stalks', 'stem', 'stems', 'root', 'roots',
    // Water/liquid varieties (like "water spinach", "water chestnut")
    'water',
    // Cooking additions
    'creamed', 'buttered', 'breaded', 'stuffed',
]);

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
    // Beverages/processed (turn solid → liquid/processed)
    'smoothie', 'shake', 'juice', 'drink', 'beverage', 'soda', 'lemonade',
    // Snacks/confections
    'candy', 'candies', 'chocolate', 'bar', 'chip', 'chips', 'fries',
    'fritter', 'nugget', 'nuggets', 'stick', 'sticks',
    // Spreads/condiments
    'dip', 'spread', 'hummus', 'guacamole', 'sauce', 'dressing',
    'jam', 'jelly', 'preserves', 'butter',
    // Dairy products (when not queried)
    'ice cream', 'yogurt', 'pudding', 'custard', 'mousse',
]);

/**
 * Check if candidate has category-changing tokens that are NOT in the query.
 * This catches "spinach" → "Spinach Noodles" type mismatches.
 * 
 * Returns the penalty amount (0 to CATEGORY_CHANGE_PENALTY)
 */
function getCategoryChangePenalty(query: string, candidateName: string): number {
    const queryLower = query.toLowerCase();
    const candLower = candidateName.toLowerCase();

    // Tokenize candidate name
    const candidateWords = candLower
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);

    // Check each candidate word against category-changing tokens
    for (const word of candidateWords) {
        if (CATEGORY_CHANGING_TOKENS.has(word)) {
            // Is this category-changing token also in the query?
            // If so, it's intentional (e.g., "spinach pasta" query)
            if (!queryLower.includes(word)) {
                // Query doesn't have this token - it's parasitic!
                // Return heavy penalty
                return WEIGHTS.CATEGORY_CHANGE_PENALTY;
            }
        }
    }

    return 0; // No category-changing tokens found
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

function computeSimpleScore(candidate: RerankCandidate, query: string): number {
    let score = 0;

    // 1. Exact match bonus
    if (isExactMatch(query, candidate.name)) {
        score += WEIGHTS.EXACT_MATCH;
    }

    // 2. Token overlap
    const overlap = computeTokenOverlap(query, candidate.name);
    score += overlap * WEIGHTS.TOKEN_OVERLAP;

    // 2b. Penalty for extra tokens (words in candidate but not in query)
    // This prevents "banana" → "Banana Peppers" by penalizing the extra "peppers"
    const queryTokens = tokenize(query);
    const candTokens = tokenize(candidate.name);
    // Don't count synonyms as extra tokens (e.g., "peel" isn't extra when query is "zest")
    const extraTokens = candTokens.filter(ct =>
        !queryTokens.some(qt => tokensMatch(qt, ct))
    );

    if (queryTokens.length > 0 && extraTokens.length > 0) {
        // Separate benign descriptors from problematic extra tokens
        // Benign descriptors get reduced penalty, category-changers get full penalty
        const benignExtras = extraTokens.filter(t => BENIGN_DESCRIPTOR_TOKENS.has(t));
        const problematicExtras = extraTokens.filter(t => !BENIGN_DESCRIPTOR_TOKENS.has(t));

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
    }

    // 2c. Token bloat penalty (catches compound products for simple queries)
    // e.g., "chilli peppers" (2 tokens) → "Chilli Peppers Cream Cheese" (4 tokens) = penalty
    const tokenBloatPenalty = getTokenBloatPenalty(query, candidate.name);
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

    // 3. Source preference
    // Prefer FDC for categories where FatSecret data is unreliable (e.g., vinegar, stock cubes)
    // Otherwise strongly prefer FatSecret because it has better serving data coverage
    const queryLower = query.toLowerCase();
    const isVinegar = queryLower.includes('vinegar');
    // FatSecret beef stock has incomplete nutrition (0kcal issue) - prefer FDC
    const isStockBouillon = queryLower.includes('stock') || queryLower.includes('bouillon') || queryLower.includes('broth');

    if ((isVinegar || isStockBouillon) && candidate.source === 'fdc') {
        score += WEIGHTS.SOURCE_FATSECRET + 0.05;  // Boost FDC for these categories above FatSecret
    } else if (candidate.source === 'fatsecret' || candidate.source === 'cache') {
        score += WEIGHTS.SOURCE_FATSECRET;
    } else if (candidate.source === 'fdc') {
        // FDC often has incomplete serving data, apply mild penalty to prefer FatSecret
        score -= 0.08;
    }

    // 4. Prefer generic over branded (but smarter about it)
    if (!candidate.brandName) {
        score += WEIGHTS.NO_BRAND;
    } else {
        const brandLower = candidate.brandName.toLowerCase().trim();
        const queryLower = query.toLowerCase().trim();

        // Check if query effectively IS the brand or contains it clearly
        // e.g. query "egg beaters" matches brand "egg beaters"
        const queryContainsBrand = queryLower.includes(brandLower) || brandLower.includes(queryLower);

        if (queryContainsBrand) {
            // User asked for this brand - NO PENALTY
        } else {
            const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
            const candNameLower = candidate.name.toLowerCase();

            // Check if branded item has BETTER token coverage than a generic would
            // e.g., "unsweetened coconut milk" → "Unsweetened Coconut Milk (Silk)" has ALL query tokens
            const allQueryTokensInName = queryWords.every(qw => candNameLower.includes(qw));

            if (allQueryTokensInName) {
                // Branded item matches all query tokens - minimal/no penalty
                // This prevents penalizing "Unsweetened Coconut Milk (Silk)" for query "unsweetened coconut milk"
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
        } else {
            // Outside threshold: penalty
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
    if (aiEstimate.fatPer100g > 5) {
        const fatDiff = Math.abs(candidateFat - aiEstimate.fatPer100g) / aiEstimate.fatPer100g;
        if (fatDiff > macroDiffThreshold) {
            score -= WEIGHTS.NUTRITION_MACRO_SCORING * aiEstimate.confidence;
            reasons.push('fat_mismatch');
        }
    }

    return {
        score,
        reason: reasons.length > 0 ? reasons.join(',') : undefined
    };
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
    rawLine?: string
): SimpleRerankResult | null {
    if (candidates.length === 0) {
        return null;
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
            return null;  // Reject - let fallback handle it
        }

        return {
            winner: candidates[0],
            confidence: singleConfidence,
            reason: 'single_candidate',
        };
    }

    // Step 4: Extract modifier constraints from the raw line (or query)
    const constraints = extractModifierConstraints(rawLine || query);

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

            const baseScore = computeSimpleScore(c, query);
            const nutritionResult = computeNutritionScore(c, aiNutritionEstimate);

            // Apply constraint penalty
            const constraintPenalty = constraintResult.penalty * 0.5; // Scale penalty to reasonable range

            return {
                candidate: c,
                score: baseScore + nutritionResult.score - constraintPenalty,
                baseScore,
                nutritionScore: nutritionResult.score,
                nutritionReason: nutritionResult.reason,
                constraintPenalty,
                constraintReason: constraintResult.reason,
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
            const baseScore = computeSimpleScore(c, query);
            const nutritionResult = computeNutritionScore(c, aiNutritionEstimate);
            return {
                candidate: c,
                score: baseScore + nutritionResult.score,
                baseScore,
                nutritionScore: nutritionResult.score,
                nutritionReason: nutritionResult.reason,
                constraintPenalty: 0,
                constraintReason: 'fallback_no_rejection',
            };
        });
        scored.push(...fallbackScored);
    }

    // Sort by score descending, with deterministic tiebreaker (ID) to ensure stable results
    // This prevents non-determinism when candidates have equal scores
    scored.sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;

        // Tiebreaker 1: Prefer candidates with exact phrase matches from query
        // e.g., "fat free mayonnaise" → "Fat Free Mayonnaise" beats "Light Mayonnaise"
        const aPhraseBst = getExactPhraseBoost(query, a.candidate.name) > 0 ? 1 : 0;
        const bPhraseBst = getExactPhraseBoost(query, b.candidate.name) > 0 ? 1 : 0;
        if (bPhraseBst !== aPhraseBst) return bPhraseBst - aPhraseBst;

        // Tiebreaker 2: prefer non-branded (generic) foods
        const aHasBrand = a.candidate.brandName ? 1 : 0;
        const bHasBrand = b.candidate.brandName ? 1 : 0;
        if (aHasBrand !== bHasBrand) return aHasBrand - bHasBrand;

        // Final tiebreaker: sort by ID for absolute determinism
        return a.candidate.id.localeCompare(b.candidate.id);
    });

    const top = scored[0];
    const second = scored[1];
    const gap = top.score - second.score;

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

    logger.debug('simple_rerank.result', {
        query,
        winner: top.candidate.name,
        winnerScore: top.score.toFixed(3),
        winnerBaseScore: top.baseScore.toFixed(3),
        winnerNutritionScore: top.nutritionScore.toFixed(3),
        winnerNutritionReason: top.nutritionReason,
        runnerUp: second.candidate.name,
        runnerUpScore: second.score.toFixed(3),
        gap: gap.toFixed(3),
        confidence: confidence.toFixed(2),
        reason,
    });

    // MINIMUM CONFIDENCE THRESHOLD (Jan 2026)
    // Reject low-confidence winners to trigger fallback recovery.
    // This prevents "burger relish" → "Black Bean Burger" at 0.68 confidence.
    // NOTE: Lowered from 0.80 to 0.74 to allow close semantic matches like:
    //   - "sugar free" ↔ "no sugar added" (cherry pie filling)
    //   - "plum tomatoes" ↔ "whole peeled plum tomatoes" (0.741 conf)
    const MIN_RERANK_CONFIDENCE = 0.74;

    if (confidence < MIN_RERANK_CONFIDENCE) {
        logger.info('simple_rerank.winner_rejected', {
            winner: top.candidate.name,
            confidence: confidence.toFixed(3),
            threshold: MIN_RERANK_CONFIDENCE,
            reason: 'confidence_below_threshold'
        });
        return null;  // Reject - let fallback handle it
    }

    return {
        winner: top.candidate,
        confidence,
        reason,
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
    source: 'fatsecret' | 'fdc' | 'cache';
    nutrition?: {
        kcal: number;
        protein: number;
        carbs: number;
        fat: number;
        per100g: boolean;
    };
}): RerankCandidate {
    return {
        id: candidate.id,
        name: candidate.name,
        brandName: candidate.brandName || undefined,
        foodType: candidate.foodType || undefined,
        score: candidate.score,
        source: candidate.source,
        nutrition: candidate.nutrition,
    };
}
