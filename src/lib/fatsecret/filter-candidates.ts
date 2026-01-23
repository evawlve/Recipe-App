/**
 * Unified Candidate Filtering
 * 
 * Applies must-have token filtering to candidates from all sources
 * with special handling for specialty ingredients and FDC formats.
 */

import type { UnifiedCandidate } from './gather-candidates';
import { logger } from '../logger';

// ============================================================
// Types
// ============================================================

export interface FilterOptions {
    debug?: boolean;
    rawLine?: string;  // Original input for modifier detection
}

export interface FilterResult {
    filtered: UnifiedCandidate[];
    removedCount: number;
    reason?: string;
}

// ============================================================
// Stop Words (units and common measurement words)
// ============================================================

const STOP_WORDS = new Set([
    'cup', 'cups', 'tbsp', 'tbsps', 'tablespoon', 'tablespoons',
    'tsp', 'tsps', 'teaspoon', 'teaspoons',
    'oz', 'ounce', 'ounces', 'g', 'gram', 'grams', 'kg', 'ml', 'l', 'liter', 'liters',
    'packet', 'packets', 'serving', 'servings',
    'medium', 'small', 'large', 'piece', 'pieces',
]);

// ============================================================
// Token Synonyms (British → American translations for filtering)
// ============================================================

const TOKEN_SYNONYMS: Record<string, string[]> = {
    // British baking terms → American
    'icing': ['powdered', 'confectioner', 'confectioners'],
    'caster': ['superfine', 'baker'],
    'courgette': ['zucchini'],
    'courgettes': ['zucchini'],
    'aubergine': ['eggplant'],
    'aubergines': ['eggplant', 'eggplants'],
    'coriander': ['cilantro'],
    'rocket': ['arugula'],
    'mange': ['snow', 'snap'],  // mange tout → snow peas
    'mangetout': ['snow', 'snap'],
    'swede': ['rutabaga'],
    // British "marrow" is zucchini (CRITICAL: prevent "baby marrows" → "bone marrow")
    'marrow': ['zucchini', 'courgette', 'squash'],
    'marrows': ['zucchini', 'courgettes', 'squash'],
    'single': ['light', 'half'],  // single cream → light cream
    'double': ['heavy', 'whipping'],  // double cream → heavy cream
    // NOTE: 'mince' maps to 'ground' (cooking method), NOT 'beef' - that loses vegetarian context
    'mince': ['ground'],
    'minced': ['ground'],
    'prawns': ['shrimp'],
    'gammon': ['ham'],
    'rashers': ['bacon', 'strips'],
    'streaky': ['bacon'],
    'biscuit': ['cookie', 'cookies'],
    'biscuits': ['cookies'],
    'chips': ['fries', 'french'],
    'crisps': ['chips', 'potato'],
    'tinned': ['canned'],
    // Reverse mappings (American → British for completeness)
    'powdered': ['icing', 'confectioner'],
    'cilantro': ['coriander'],
    'zucchini': ['courgette'],
    'eggplant': ['aubergine'],
    'shrimp': ['prawns', 'prawn'],
    // Singular/Plural variations
    'chilies': ['chili', 'chilli', 'chillies'],
    'chili': ['chilies', 'chilli', 'chillies'],
    'peppers': ['pepper'],
    'pepper': ['peppers'],
    'tomatoes': ['tomato'],
    'tomato': ['tomatoes'],
    'onions': ['onion'],
    'onion': ['onions'],
    'carrots': ['carrot'],
    'carrot': ['carrots'],
    'potatoes': ['potato'],
    'potato': ['potatoes'],
    'celeries': ['celery'],
    'celery': ['celeries'],
    'mushrooms': ['mushroom'],
    'mushroom': ['mushrooms'],
    // Cremini mushroom spelling variants (cremini = crimini = baby bella)
    'cremini': ['crimini', 'baby bella', 'baby bellas'],
    'crimini': ['cremini', 'baby bella', 'baby bellas'],
    'beans': ['bean'],
    'bean': ['beans'],
    'peas': ['pea'],
    'pea': ['peas'],
};

// ============================================================
// Dynamic Singular/Plural Helpers
// ============================================================

/**
 * Convert plural to singular form
 * e.g., berries → berry, potatoes → potato, eggs → egg
 */
function singularize(word: string): string {
    if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y'; // berries → berry
    if (word.endsWith('oes')) return word.slice(0, -2); // potatoes → potato
    if (word.endsWith('es') && word.length > 3) return word.slice(0, -2); // tomatoes → tomato
    if (word.endsWith('s') && word.length > 2) return word.slice(0, -1); // eggs → egg
    return word;
}

/**
 * Convert singular to plural form
 * e.g., berry → berries, potato → potatoes, egg → eggs
 */
function pluralize(word: string): string {
    if (word.endsWith('y') && !/[aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies'; // berry → berries
    if (word.endsWith('o')) return word + 'es'; // potato → potatoes
    if (word.endsWith('s') || word.endsWith('x') || word.endsWith('ch') || word.endsWith('sh')) return word + 'es';
    return word + 's';
}

/**
 * Get all singular/plural variants of a word
 */
function getSingularPluralVariants(word: string): string[] {
    const variants = [word];
    const singular = singularize(word);
    const plural = pluralize(word);
    if (singular !== word) variants.push(singular);
    if (plural !== word) variants.push(plural);
    // Also try pluralizing the singular (handles irregular forms)
    const pluralOfSingular = pluralize(singular);
    if (!variants.includes(pluralOfSingular)) variants.push(pluralOfSingular);
    return variants;
}

// ============================================================
// Specialty Patterns (lenient filtering for these)
// ============================================================

const SPECIALTY_PATTERNS = [
    /coconut\s+(flour|oil|milk|cream|sugar|water)/i,
    /almond\s+(flour|milk|butter|meal)/i,
    /oat\s+(flour|milk|bran)/i,
    /rice\s+(flour|milk|vinegar)/i,
    /cassava\s+(flour|starch)/i,
    /tapioca\s+(flour|starch)/i,
    /flax(seed)?\s+(meal|oil)/i,
    /chia\s+(seeds?)/i,
    /monk\s*fruit/i,
    /erythritol/i,
    /stevia/i,
    /unsweetened\s+\w+\s+milk/i, // unsweetened coconut milk, etc.
];

// ============================================================
// Spice/Seasoning Unit Detection
// ============================================================

// Units that typically indicate spices/seasonings (small quantities)
const SPICE_UNITS = new Set([
    'dash', 'dashes', 'pinch', 'pinches', 'tsp', 'tsps', 'teaspoon', 'teaspoons',
    'tbsp', 'tbsps', 'tablespoon', 'tablespoons', 'sprinkle', 'shake',
    // Note: 'dash' is critical for "1 dash pepper" → black pepper (not bell pepper)
]);

// Units that typically indicate vegetables (larger quantities)
const VEGETABLE_UNITS = new Set([
    'cup', 'cups', 'piece', 'pieces', 'whole', 'medium', 'large', 'small',
    'lb', 'lbs', 'pound', 'pounds', 'oz', 'ounce', 'ounces',
]);

// Ambiguous ingredients that need unit context to resolve
const AMBIGUOUS_INGREDIENTS: Record<string, { spiceForm: string; vegetableForm: string }> = {
    'pepper': { spiceForm: 'black pepper', vegetableForm: 'bell pepper' },
    'peppers': { spiceForm: 'black pepper', vegetableForm: 'bell peppers' },
};

/**
 * Check if rawLine contains a spice-indicating unit
 */
function detectSpiceContext(rawLine: string): { isSpice: boolean; isVegetable: boolean } {
    const lower = rawLine.toLowerCase();
    const hasSpiceUnit = Array.from(SPICE_UNITS).some(u => lower.includes(u));
    const hasVegetableUnit = Array.from(VEGETABLE_UNITS).some(u => lower.includes(u));
    return { isSpice: hasSpiceUnit && !hasVegetableUnit, isVegetable: hasVegetableUnit && !hasSpiceUnit };
}

/**
 * Check if ingredient is ambiguous and candidate is the wrong form
 */
function isWrongFormForContext(rawLine: string, normalizedName: string, candidateName: string): boolean {
    const normLower = normalizedName.toLowerCase();
    const candLower = candidateName.toLowerCase();

    for (const [ambiguous, forms] of Object.entries(AMBIGUOUS_INGREDIENTS)) {
        if (normLower.includes(ambiguous)) {
            const context = detectSpiceContext(rawLine);

            if (context.isSpice) {
                // User wants spice - reject vegetable pepper forms
                // Be specific: reject bell peppers, sweet peppers, and generic "peppers" (vegetable brand names)
                // NOT "red pepper flakes", "crushed red pepper", "black pepper", etc.

                // Check if candidate is explicitly a spice form (these are GOOD matches)
                const isSpicePepper = (
                    candLower.includes('black pepper') ||
                    candLower.includes('white pepper') ||
                    candLower.includes('ground pepper') ||
                    candLower.includes('pepper flake') ||
                    candLower.includes('crushed pepper') ||
                    candLower.includes('peppercorn') ||
                    candLower.includes('cayenne') ||
                    candLower.includes('pepper powder') ||
                    candLower.includes('seasoning') ||
                    candLower.includes('table grind') ||
                    candLower.includes('cracked pepper')
                );

                // Check if candidate is a suspicious branded/generic product
                // "PEPPER (NFL)" or "PEPPERS (Martinez & Sons)" are likely NOT spices
                const isSuspiciousBrandedProduct = (
                    // Pattern: "PEPPER (BRAND)" where brand is in parentheses
                    /^pepper(s)?\s*\([^)]+\)$/i.test(candLower.trim()) ||
                    // Very short name that's just "pepper" or "peppers" - too ambiguous
                    /^pepper(s)?$/i.test(candLower.trim())
                );

                // If it's a spice form (and not suspicious), it's a good match - don't reject
                if (isSpicePepper && !isSuspiciousBrandedProduct) {
                    return false;
                }

                // If it's a suspicious branded product in spice context, reject it
                if (isSuspiciousBrandedProduct) {
                    return true; // Wrong form - suspicious product, not a spice
                }

                // Check if candidate is a vegetable pepper form (these are BAD matches for spice context)
                const isVegetablePepper = (
                    candLower.includes('bell pepper') ||
                    candLower.includes('sweet pepper') ||
                    candLower.includes('stuffed pepper') ||
                    // Generic "PEPPERS" brand name without spice qualifiers is likely vegetable
                    (candLower === 'peppers' || candLower.match(/^peppers?\s*\(/)) ||
                    // Color + pepper without any spice indicators is vegetable (e.g., "green bell pepper")
                    // BUT allow: "red pepper" (spice), "cayenne pepper", "red or cayenne pepper"
                    (candLower.includes('pepper') &&
                        (candLower.includes('green') || candLower.includes('yellow') || candLower.includes('orange')) &&
                        !candLower.includes('flake') && !candLower.includes('crushed') && !candLower.includes('cayenne'))
                );
                // Note: "red pepper" without "bell" is a valid spice (cayenne family)
                // Only reject if explicitly "red bell pepper" or "red sweet pepper"
                if (isVegetablePepper) {
                    return true; // Wrong form - vegetable pepper
                }
            } else if (context.isVegetable) {
                // User wants vegetable - reject spice forms
                if (candLower.includes('black pepper') || candLower.includes('ground pepper') ||
                    candLower.includes('pepper powder') || candLower.includes('peppercorn')) {
                    return true; // Wrong form
                }
            }
        }
    }
    return false;
}

// ============================================================
// Cooking State Disambiguation
// ============================================================

// Foods where cooking state matters nutritionally.
// Recipes typically measure RAW ingredients. Default to raw unless explicitly stated as cooked.
// Examples of nutritional differences:
// - Raw chicken breast: ~120 kcal/100g vs Cooked: ~165 kcal/100g (water loss)
// - Dry quinoa: ~360 kcal/100g vs Cooked: ~120 kcal/100g (water absorption)
const FOODS_WITH_COOKING_STATE = [
    // Grains & Starches (absorb water when cooked → lower cal/100g)
    'quinoa', 'rice', 'pasta', 'oatmeal', 'oats', 'barley',
    'couscous', 'bulgur', 'farro', 'millet', 'sorghum',
    'buckwheat', 'spelt', 'kamut', 'freekeh', 'wheat berries',
    'noodles', 'spaghetti', 'macaroni', 'penne', 'fusilli',

    // Legumes (absorb water when cooked)
    'lentils', 'lentil', 'beans', 'chickpeas', 'peas',
    'black beans', 'kidney beans', 'pinto beans', 'navy beans',

    // Poultry
    'chicken', 'chicken breast', 'chicken thigh', 'chicken leg',
    'turkey', 'turkey breast', 'duck', 'goose',

    // Beef
    'beef', 'steak', 'ground beef', 'beef tenderloin', 'sirloin',
    'ribeye', 'filet mignon', 'brisket', 'roast beef',

    // Pork
    'pork', 'pork chop', 'pork loin', 'pork tenderloin',
    'bacon', 'ham', 'pork belly', 'pork shoulder',

    // Other meats
    'lamb', 'lamb chop', 'veal', 'venison', 'bison', 'goat',
    'sausage', 'bratwurst', 'chorizo',

    // Seafood
    'salmon', 'tuna', 'cod', 'tilapia', 'halibut', 'trout',
    'shrimp', 'prawns', 'lobster', 'crab', 'scallops',
    'mussels', 'clams', 'oysters', 'calamari', 'squid',
    'fish', 'fish fillet',

    // Eggs
    'egg', 'eggs',

    // Vegetables that change significantly when cooked
    'potato', 'potatoes', 'sweet potato', 'yam',
    'spinach', 'kale', 'broccoli', 'cauliflower',
    'carrots', 'carrot', 'beets', 'beet',
];

/**
 * Check if grain query explicitly specifies cooking state.
 * 
 * RULE: Recipes typically measure raw/dry ingredients.
 * Default to RAW/DRY unless user explicitly says "cooked", "prepared", etc.
 * 
 * Examples:
 * - "4 cups quinoa" → DRY (will be cooked as part of recipe)
 * - "2 cups cooked quinoa" → COOKED (explicitly stated)
 * - "200g rice" → DRY
 */
export function detectGrainCookingContext(rawLine: string, normalizedName: string): { preferCooked: boolean; preferDry: boolean } {
    const lower = rawLine.toLowerCase();
    const normLower = normalizedName.toLowerCase();

    // Check if this is a grain/legume
    const isGrain = FOODS_WITH_COOKING_STATE.some(g => normLower.includes(g));
    if (!isGrain) {
        return { preferCooked: false, preferDry: false };
    }

    // All cooking method indicators
    const COOKING_KEYWORDS = [
        'cooked', 'prepared', 'boiled', 'steamed',
        'roasted', 'grilled', 'baked', 'fried',
        'sauteed', 'sautéed', 'braised', 'stewed',
        'broiled', 'poached', 'smoked', 'pan-fried',
        'rotisserie', 'barbecued', 'bbq', 'scrambled'
    ];

    // Check for EXPLICIT cooking state in query (check both rawLine and normalizedName)
    const hasCookedKeyword = COOKING_KEYWORDS.some(k =>
        lower.includes(k) || normLower.includes(k)
    );

    if (hasCookedKeyword) {
        return { preferCooked: true, preferDry: false };
    }

    // DEFAULT: Prefer dry/raw for all grains (recipes measure raw ingredients)
    return { preferCooked: false, preferDry: true };
}

/**
 * Check if food candidate has wrong cooking state.
 * 
 * Without explicit "cooked" in query → reject cooked candidates
 * With explicit "cooked" in query → reject non-cooked candidates
 */
export function isWrongCookingStateForGrain(rawLine: string, normalizedName: string, candidateName: string): boolean {
    const context = detectGrainCookingContext(rawLine, normalizedName);
    const candLower = candidateName.toLowerCase();

    // If no preference (not a food with cooking state), don't filter
    if (!context.preferCooked && !context.preferDry) {
        return false;
    }

    // All cooking method indicators (candidate is cooked)
    const COOKING_INDICATORS = [
        'cooked', 'prepared', 'boiled', 'steamed',
        'roasted', 'grilled', 'baked', 'fried',
        'sauteed', 'sautéed', 'braised', 'stewed',
        'broiled', 'poached', 'smoked', 'pan-fried',
        'rotisserie', 'barbecued', 'bbq'
    ];

    const candidateIsCooked = COOKING_INDICATORS.some(ind => candLower.includes(ind));

    // Raw/uncooked indicators
    const RAW_INDICATORS = ['raw', 'uncooked', 'fresh'];
    const candidateIsRaw = RAW_INDICATORS.some(ind => candLower.includes(ind));

    if (context.preferDry && candidateIsCooked && !candidateIsRaw) {
        return true; // User wants raw (default) but candidate is cooked
    }

    if (context.preferCooked && !candidateIsCooked) {
        // User explicitly wants cooked - reject candidates without cooking indicators
        // Exception: don't reject if the candidate has specific cooking terms in brand context
        // (e.g., "Perdue Chicken Breast" might still be precooked)
        return true;
    }

    return false;
}
// ============================================================

// Product categories that are typically NOT raw ingredients
const PRODUCT_CATEGORIES = new Set([
    'bar', 'bars', 'cake', 'cakes', 'pie', 'pies', 'cookie', 'cookies',
    'spread', 'spreads', 'dip', 'dips', 'yogurt', 'pudding', 'ice cream',
    'cereal', 'granola', 'muffin', 'muffins', 'bread', 'bagel', 'bagels',
    'ravioli', 'pasta', 'sauce', 'dressing', 'smoothie', 'shake',
    'protein bar', 'nutrition bar', 'snack bar', 'energy bar',
    'cream cheese', 'chip', 'chips', 'cracker', 'crackers',
    // Restaurant/prepared items
    'rings', 'ring', 'nuggets', 'nugget', 'patty', 'patties',
    'burger', 'burgers', 'fries', 'strips', 'strip',
    'wrap', 'wraps', 'sandwich', 'sandwiches',
]);

// Raw ingredient patterns that shouldn't match processed products
const RAW_INGREDIENT_SUFFIXES = new Set([
    'zest', 'juice', 'peel', 'rind', 'extract', 'oil',
    'flour', 'sugar', 'salt', 'pepper', 'powder', 'spice',
    'leaf', 'leaves', 'seed', 'seeds', 'clove', 'cloves',
]);

/**
 * Detect if a query ingredient would be a "flavor" in a compound product
 * e.g., "lemon zest" in "Blueberry & Lemon Zest Cream Cheese Spread"
 */
function isCompoundProductMismatch(normalizedName: string, candidateName: string): boolean {
    const queryLower = normalizedName.toLowerCase().trim();
    const candidateLower = candidateName.toLowerCase().trim();

    // If query is very short (1-2 words) and contains a raw ingredient suffix
    const queryWords = queryLower.split(/\s+/);
    const lastWord = queryWords[queryWords.length - 1];
    const isRawIngredient = RAW_INGREDIENT_SUFFIXES.has(lastWord);

    if (!isRawIngredient) return false; // Only apply to raw ingredients

    // Check if candidate is a product category
    const isProduct = Array.from(PRODUCT_CATEGORIES).some(cat => candidateLower.includes(cat));

    if (!isProduct) return false; // Only filter products

    // Check if query starts the candidate name (good match)
    // e.g., "lemon zest" matches "Lemon Zest" but NOT "Blueberry Lemon Zest Cake"
    if (candidateLower.startsWith(queryLower)) {
        return false; // Good match - query is the primary ingredient
    }

    // Check if query appears after other ingredients (bad - it's a flavor)
    // Look for patterns like "X & Y", "X with Y", "X flavored"
    const flavorPatterns = [
        /\b\w+\s+(&|and|with|,)\s+/i, // Something before with ampersand/and/comma
        /\bflavou?red?\b/i,           // "flavored" keyword
    ];

    const hasMultipleIngredients = flavorPatterns.some(p => p.test(candidateLower));

    if (hasMultipleIngredients && candidateLower.includes(queryLower)) {
        // Query is in a multi-ingredient product but not at the start
        return true; // Mismatch - it's just a flavor
    }

    return false;
}

/**
 * Detect if a simple ingredient query would incorrectly match a branded product
 * e.g., "onion" should NOT match "Blazing Bagels Onion" (a bagel product)
 * 
 * This applies when:
 * - Query is 1-2 words (simple ingredient)
 * - Candidate has a brand name with unrelated words
 * - The query word appears in a branded product context
 */
function isBrandedProductForSimpleQuery(
    normalizedName: string,
    candidateName: string,
    candidateBrand?: string | null
): boolean {
    const queryLower = normalizedName.toLowerCase().trim();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    // Only apply to simple 1-2 word queries
    if (queryWords.length > 2) return false;

    const candidateLower = candidateName.toLowerCase().trim();

    // Check for brand names that indicate a product FIRST
    // e.g., "ONION" from brand "BLAZING BAGELS" should be rejected
    if (candidateBrand) {
        const brandLower = candidateBrand.toLowerCase();
        // Known product brands that suggest processed foods
        const productBrands = [
            'bagel', 'bagels', 'bread', 'pizza', 'burrito', 'wrap', 'sandwich',
            'deli', 'bakery', 'restaurant', 'kitchen', 'cafe', 'grill',
            'frozen', 'prepared', 'ready', 'meal', 'denny'
        ];
        if (productBrands.some(b => brandLower.includes(b))) {
            return true; // Reject products masquerading as simple ingredients
        }
    }

    // Check if candidate is in a product category BEFORE starts-with
    // e.g., "onion rings" should be rejected even though it starts with "onion"
    const productCategory = Array.from(PRODUCT_CATEGORIES).find(cat => candidateLower.includes(cat));

    if (productCategory) {
        // Only reject if the product category is NOT part of the query
        // e.g. "pepper sauce" contains "sauce", so "Hot Pepper Sauce" is fine
        // e.g. "onion" does NOT contain "rings", so "Onion Rings" is rejected
        if (!queryLower.includes(productCategory)) {
            return true;
        }
    }

    // If candidate starts with the query, no bad brand, and not a product mismatch → good match
    // e.g., "onion" → "Onion" or "Onion Chopped"
    if (candidateLower.startsWith(queryLower)) return false;
    // (Brand check moved to the beginning of the function)

    // Check if query appears AFTER brand/product words
    // e.g., "BLAZING BAGELS ONION" - "onion" is at the end after brand
    const candidateWords = candidateLower.split(/\s+/);
    const queryIndex = candidateWords.indexOf(queryWords[0]);

    if (queryIndex > 1) {
        // Query word is after 2+ other words - likely a product with ingredient as modifier
        // But verify it's not just a descriptor like "fresh onion"
        const beforeWords = candidateWords.slice(0, queryIndex);
        const descriptors = ['fresh', 'raw', 'chopped', 'diced', 'sliced', 'minced', 'organic', 'dried'];
        const allDescriptors = beforeWords.every(w => descriptors.includes(w));

        if (!allDescriptors) {
            // There are non-descriptor words before the query - it's a product
            return true;
        }
    }

    return false;
}

// ============================================================
// Category Mismatch Detection
// ============================================================

// Categories that should NOT be confused
const CATEGORY_EXCLUSIONS: Array<{ query: string[]; excludeIfContains: string[] }> = [
    // Cream (dairy) should NOT match ice cream (frozen dessert)
    { query: ['cream', 'single cream', 'double cream', 'light cream', 'heavy cream'], excludeIfContains: ['ice cream', 'sherbet', 'gelato', 'frozen'] },
    // Ice (frozen water) should NOT match ice cream (dessert) or Ice Breakers/Ice Cubes (candy/gum brands)
    // NOTE: "Ice Cubes" (brand) and "ice cubes" (frozen water) are different - exclude brand searches
    { query: ['ice', 'crushed ice', 'shaved ice'], excludeIfContains: ['ice cream', 'icecream', 'sherbet', 'gelato', 'iced coffee', 'iced tea', 'ice breakers', 'icebreakers', 'ice cubes', 'gum', 'mint', 'mints', 'candy', 'candies', 'rice', 'risotto', 'moritz'] },
    // Actual ice cube queries should also avoid candy brands including Moritz (chocolate ice cubes)
    { query: ['ice cubes', 'ice cube'], excludeIfContains: ['ice cream', 'icecream', 'sherbet', 'gelato', 'iced coffee', 'iced tea', 'ice breakers', 'icebreakers', 'gum', 'mint', 'mints', 'candy', 'candies', 'sarita', 'mentos', 'orbit', 'moritz', 'chocolate'] },
    // Raw sugar should NOT match sugar cookies, but specialty sugars are OK
    // Note: 'icing sugar' and 'powdered sugar' should match their correct forms
    { query: ['sugar'], excludeIfContains: ['cookie', 'cookies', 'candy', 'candies', 'cake'] },
    // Flour should NOT match baked goods
    { query: ['flour'], excludeIfContains: ['bread', 'cake', 'cookie', 'muffin', 'pie'] },
    // Oil should NOT match oil-based dressings/sauces (only pure oils wanted)
    { query: ['oil'], excludeIfContains: ['dressing', 'sauce', 'mayonnaise'] },
    // Zest should NOT match cakes/desserts named with zest as flavor
    { query: ['zest', 'lemon zest', 'orange zest', 'lime zest'], excludeIfContains: ['cake', 'cookie', 'bar', 'muffin', 'bread', 'pie', 'cream cheese'] },
    // Extract should NOT match baked goods with that extract flavor
    { query: ['extract', 'vanilla extract', 'almond extract'], excludeIfContains: ['cake', 'cookie', 'bar', 'muffin', 'ice cream'] },
    // BEVERAGES should NOT match candy/confectionery
    {
        query: ['milk', 'almond milk', 'oat milk', 'soy milk', 'coconut milk', 'rice milk', 'cashew milk'],
        excludeIfContains: ['candy', 'candies', 'chocolate candy', 'confection', 'lollipop', 'bonbon', 'truffle']
    },
    // Unsweetened coconut milk BEVERAGE should NOT match canned coconut cream
    // Carton coconut milk is ~15-25 kcal/cup, canned cream is ~570 kcal/cup
    {
        query: ['unsweetened coconut milk', 'coconut milk unsweetened'],
        excludeIfContains: ['cream', 'canned', 'full fat', 'liquid, canned']
    },
    // Chilies/peppers should NOT match mixed canned products OR cream cheese spreads
    // CRITICAL: Include both American (chili) and British (chilli) spellings
    {
        query: ['chilies', 'chili', 'chilli', 'chillies', 'chili pepper', 'chilli pepper',
            'chili peppers', 'chilli peppers', 'green chilies', 'green chili',
            'jalapeno', 'serrano', 'hot pepper', 'hot peppers'],
        excludeIfContains: ['diced tomatoes', 'canned tomatoes', 'tomato sauce',
            'cream cheese', 'cheese spread', 'dip', 'hummus', 'hazelnuts', 'mango']
    },
    // Raw vegetables should NOT match juice/processed forms (unless query asks for juice)
    {
        query: ['tomato', 'tomatoes'],
        excludeIfContains: ['juice', 'paste', 'sauce', 'puree', 'ketchup']
    },
    // Paste ingredients should NOT match soup/prepared forms
    {
        query: ['miso paste', 'tomato paste', 'curry paste'],
        excludeIfContains: ['soup', 'broth', 'stew']
    },
    // === NEW: Priority 1 False Positive Fixes ===
    // Simple vinegar should NOT match dressings
    {
        query: ['vinegar', 'white vinegar', 'apple cider vinegar', 'balsamic vinegar', 'red wine vinegar'],
        excludeIfContains: ['dressing', 'vinaigrette', 'marinade', 'sauce']
    },
    // Acai should NOT match tomato-based products
    {
        query: ['acai', 'acai puree', 'acai berry'],
        excludeIfContains: ['tomato', 'puree', 'paste', 'sauce']
    },
    // Plum tomatoes should NOT match plum fruit (the fruit, not the tomato variety)
    {
        query: ['plum tomatoes', 'plum tomato', 'roma tomatoes', 'roma tomato'],
        excludeIfContains: ['raw plum', 'raw plums', 'plum fruit', 'dried plum', 'prune', 'plums,', 'fresh plum']
    },
    // Cilantro (leaves) should NOT match coriander (seeds)
    {
        query: ['cilantro', 'fresh cilantro', 'cilantro leaves'],
        excludeIfContains: ['coriander seed', 'coriander ground', 'ground coriander']
    },
    // Seeds bread should NOT match pickles or unrelated products
    {
        query: ['seeds bread', 'mixed seeds bread', 'seeded bread', 'multigrain bread'],
        excludeIfContains: ['pickle', 'pickles', 'relish']
    },
    // === NEW: Color modifier fixes for bell peppers ===
    // Green bell pepper should NOT match red/yellow/orange bell peppers
    {
        query: ['green bell pepper', 'green pepper', 'green capsicum'],
        excludeIfContains: ['red bell pepper', 'red pepper', 'yellow bell pepper', 'yellow pepper', 'orange bell pepper', 'orange pepper']
    },
    {
        query: ['red bell pepper', 'red pepper', 'red capsicum'],
        excludeIfContains: ['green bell pepper', 'green pepper', 'yellow bell pepper', 'yellow pepper', 'orange bell pepper', 'orange pepper']
    },
    {
        query: ['yellow bell pepper', 'yellow pepper', 'yellow capsicum'],
        excludeIfContains: ['red bell pepper', 'red pepper', 'green bell pepper', 'green pepper', 'orange bell pepper', 'orange pepper']
    },
    // === NEW: Cornmeal should NOT match prepared dishes ===
    {
        query: ['cornmeal', 'corn meal', 'polenta'],
        excludeIfContains: ['mush', 'porridge', 'grits', 'made with milk', 'made with water', 'cooked']
    },
    // === NEW: Splenda (sucralose) should NOT match Splenda Naturals (stevia) or food products ===
    // These are different sweeteners with different properties
    // Also exclude food products that happen to be "sweetened with splenda"
    {
        query: ['splenda', 'splenda packet', 'splenda packets'],
        excludeIfContains: ['stevia', 'naturals', 'monk fruit', 'pineapple', 'fruit', 'yogurt', 'pudding', 'jello', 'jell-o', 'gelatin', 'drink', 'beverage', 'juice', 'syrup', 'jam', 'preserves', 'sweetened with']
    },
    // === NEW: Rolled oats should NOT match quick/instant oats ===
    // Different products with different cooking properties
    {
        query: ['rolled oats', 'old fashioned oats', 'old-fashioned oats'],
        excludeIfContains: ['quick', 'instant', '1 minute', 'one minute']
    },
    // === NEW: Vegetable oil spread / fat spread should NOT match cream cheese-based dips ===
    // "Garden Vegetable Spread" is a cream cheese dip, NOT a butter substitute
    {
        query: ['vegetable spread', 'vegetable oil spread', 'fat spread', 'margarine', 'butter substitute'],
        excludeIfContains: ['cream cheese', 'garden vegetable', 'hickory', 'dip', 'cheese spread']
    },
    // === NEW: Milk fat level exclusions ===
    // Lowfat milk should NOT match nonfat milk (different nutrition)
    {
        query: ['lowfat milk', 'low fat milk', 'low-fat milk', 'milk lowfat', 'milk low fat', '1% milk', '2% milk', 'reduced fat milk'],
        excludeIfContains: ['nonfat', 'non-fat', 'skim', 'fat free', 'fat-free', 'whole milk', 'dry', 'powder', 'powdered', 'dried']
    },
    {
        query: ['nonfat milk', 'non-fat milk', 'skim milk', 'fat free milk', 'fat-free milk'],
        excludeIfContains: ['lowfat', 'low fat', 'low-fat', '1%', '2%', 'reduced fat', 'whole milk', 'dry', 'powder', 'powdered', 'dried']
    },
    {
        query: ['whole milk', 'full fat milk'],
        excludeIfContains: ['nonfat', 'non-fat', 'skim', 'lowfat', 'low fat', 'low-fat', '1%', '2%', 'reduced fat', 'fat free', 'fat-free', 'dry', 'powder', 'powdered', 'dried']
    },
    // === NEW: Liquid milk (any type) should NOT match dry/powdered milk ===
    // Physical state mismatch: volume units (cup, ml) imply LIQUID milk
    // "1.5 cup milk lowfat" → should NOT match "Lowfat Dry Milk" (powder, 653kcal vs ~75kcal)
    {
        query: ['milk', 'milk lowfat', 'lowfat milk', 'low fat milk', 'milk low fat', 'whole milk', 'skim milk'],
        excludeIfContains: ['dry milk', 'dried milk', 'powdered milk', 'milk powder', 'dry nonfat', 'dry lowfat']
    },
    // === NEW: Ground Meat Exclusions ===
    // "ground chuck", "ground beef" should NOT match steak cuts
    // Ground meat has different fat distribution and cooking properties
    {
        query: ['ground chuck', 'ground beef', 'ground pork', 'ground turkey', 'ground lamb', 'ground meat', 'minced beef', 'minced meat'],
        excludeIfContains: ['steak', 'roast', 'chop', 'tenderloin', 'ribeye', 'sirloin', 'strip', 'filet', 'loin', 'eye steak', 'chuck eye']
    },
    // === REMOVED: Taco Exclusions ===
    // Previous rule was filtering out actual tacos ("Taco with Beef, Cheese") 
    // while keeping "bean burrito" (no excluded terms). Let scoring handle this.
    // === NEW: Smoothies should NOT match fresh fruit ===
    {
        query: ['strawberry', 'strawberries', 'banana', 'bananas', 'mango', 'mangoes', 'pineapple', 'pineapples', 'fruit'],
        excludeIfContains: ['smoothie', 'shake', 'yogurt', 'ice cream', 'topping', 'jam', 'jelly', 'syrup', 'pie']
    },
    // === NEW: Simple mushrooms should NOT match stuffed mushrooms ===
    // "8 piece crimini mushrooms" → plain mushrooms, NOT "STUFFED CREMINI MUSHROOMS"
    {
        query: ['mushroom', 'mushrooms', 'crimini', 'cremini', 'portobello', 'shiitake', 'button mushroom'],
        excludeIfContains: ['stuffed', 'filled', 'with cheese', 'with cream cheese', 'appetizer']
    },
    // === NEW: Simple coconut should prefer solid forms over liquid ===
    // "unsweetened coconut" without "milk" should NOT match coconut milk
    {
        query: ['coconut', 'unsweetened coconut', 'shredded coconut', 'coconut flakes', 'desiccated coconut'],
        excludeIfContains: ['coconut milk', 'coconut water', 'coconut cream', 'coconut beverage']
    },
    // === NEW: Sugar substitute should prefer pure sweeteners ===
    // "sugar substitute" should NOT match maltodextrin-based products (100g carbs = not low calorie!)
    // The FatSecret "Low Calorie Sugar Substitute (Powdered)" is actually maltodextrin with 100g carbs
    // Also exclude "cream substitute" which is a completely different product category
    // Prefer sucralose, aspartame, stevia, monk fruit (true zero/low calorie)
    {
        query: ['sugar substitute', 'sweetener', 'artificial sweetener', 'low calorie sweetener', 'zero calorie sweetener', 'powdered sugar substitute'],
        excludeIfContains: ['low calorie sugar substitute', 'granulated sugar substitute', 'maltodextrin', 'cream substitute']
    },
    // === NEW: Fresh herbs should NOT match candy/mints ===
    // "mint" (herb) should NOT map to "Mints (Wilhelmina)" candy
    // "1 tbsp mint" is fresh mint leaves, not breath mints
    {
        query: ['mint', 'fresh mint', 'mint leaves', 'peppermint leaves', 'spearmint', 'spearmint leaves'],
        excludeIfContains: ['candy', 'candies', 'mints', 'confection', 'breath mint', 'after dinner',
            'wilhelmina', 'altoids', 'tic tac', 'mentos', 'gum', 'chocolate mint']
    },
    // === NEW: Canned fish should NOT match raw fish ===
    // "1 can tuna" or "canned tuna" should NOT map to "raw yellowfin tuna"
    // NOTE: This requires checking the rawLine for "can" unit, handled in filterCandidates
    {
        query: ['canned tuna', 'canned salmon', 'canned sardines', 'canned mackerel',
            'canned fish', 'tuna can', 'salmon can'],
        excludeIfContains: ['raw', 'fresh', 'sashimi', 'sushi grade']
    },
    // === NEW: Raw garlic should NOT match pickled garlic ===
    {
        query: ['garlic', 'raw garlic', 'fresh garlic', 'garlic bulb'],
        excludeIfContains: ['pickled', 'pickles', 'pickl']
    },
    // === Priority 2: Tacos vs Nachos Food Type Mismatch ===
    // "tacos" should NOT map to "nachos" - these are different Mexican foods
    // Tacos = folded tortilla with filling
    // Nachos = chips with toppings
    // The issue: "nachos taco bell" contains "taco" in brand name, not food type
    {
        query: ['taco', 'tacos', 'soft taco', 'hard taco', 'beef taco', 'chicken taco', 'fish taco'],
        excludeIfContains: ['nacho', 'nachos', 'chips', 'tortilla chips']
    },
    {
        query: ['nacho', 'nachos'],
        excludeIfContains: ['taco', 'tacos', 'burrito', 'burritos']
    },
    // Also guard burritos from tacos/nachos
    {
        query: ['burrito', 'burritos', 'beef burrito', 'chicken burrito', 'bean burrito'],
        excludeIfContains: ['taco', 'tacos', 'nacho', 'nachos']
    },
    // === Priority 2: Specialty Pasta/Flour Guards ===
    // Regular pasta should NOT match specialty pasta variants (different nutrition)
    // "linguini pasta" should NOT map to "chickpea pasta" or "lentil pasta"
    // These specialty variants have very different macros (higher protein, fiber)
    {
        query: ['linguine', 'linguini', 'spaghetti', 'penne', 'fettuccine', 'rigatoni', 'fusilli',
            'macaroni', 'rotini', 'farfalle', 'angel hair', 'pasta', 'noodles'],
        excludeIfContains: ['chickpea', 'lentil', 'black bean', 'edamame', 'quinoa pasta', 'rice pasta',
            'gluten free', 'gluten-free', 'protein pasta', 'veggie pasta']
    },
    // Specialty pastas should explicitly include their base ingredient
    {
        query: ['chickpea pasta', 'chickpea noodles'],
        excludeIfContains: ['regular', 'semolina', 'durum', 'wheat pasta']
    },
    {
        query: ['lentil pasta', 'red lentil pasta'],
        excludeIfContains: ['regular', 'semolina', 'durum', 'wheat pasta']
    },
    // === Priority 2: Specialty Flour Guards ===
    // "all purpose flour" should NOT match "almond flour" or "coconut flour"
    {
        query: ['flour', 'all purpose flour', 'all-purpose flour', 'plain flour', 'white flour', 'wheat flour'],
        excludeIfContains: ['almond flour', 'coconut flour', 'oat flour', 'rice flour', 'chickpea flour',
            'cassava flour', 'tapioca flour', 'buckwheat flour', 'gluten free', 'gluten-free']
    },
    // === Priority 3: Extra Lean Ground Meat Guards ===
    // "Extra lean" ground beef typically means 93-96% lean
    // Should NOT match standard 85% lean (significantly more fat/calories)
    {
        query: ['extra lean ground beef', 'extra-lean ground beef', 'extra lean beef',
            'extra lean ground turkey', 'extra-lean ground turkey'],
        excludeIfContains: ['85%', '80%', '73%', '70%', '85 lean', '80 lean', '73 lean', '70 lean']
    },
    // Standard ground beef should NOT match lean/extra lean (calorie difference matters)
    {
        query: ['ground beef', 'ground chuck'],
        excludeIfContains: ['extra lean', 'extra-lean', '95%', '96%', '97%', '93%', '95 lean', '96 lean', '97 lean', '93 lean']
    },
    // === Priority 3: Canned/Prepared Tomato State Guards ===
    // "Crushed tomatoes" and "diced tomatoes" are canned products with different density/nutrition
    // Should NOT match raw/fresh tomatoes
    {
        query: ['crushed tomatoes', 'crushed tomato'],
        excludeIfContains: ['raw', 'fresh', 'cherry', 'grape', 'plum', 'roma', 'beefsteak', 'heirloom']
    },
    {
        query: ['diced tomatoes', 'diced tomato', 'canned tomatoes', 'canned tomato', 'tinned tomatoes', 'tinned tomato', 'fire roasted tomatoes', 'fire-roasted tomatoes'],
        excludeIfContains: ['raw', 'fresh', 'cherry', 'grape', 'plum', 'roma', 'beefsteak', 'heirloom']
    },
    // Fresh tomatoes should NOT match canned/processed
    // BUT: If query explicitly has canned-related terms, skip this rule entirely
    {
        query: ['tomato', 'tomatoes', 'cherry tomatoes', 'grape tomatoes', 'roma tomatoes'],
        excludeIfContains: ['crushed', 'diced', 'canned', 'stewed', 'sun dried', 'paste'],
        // Skip this rule if query already contains a canned/prepared modifier
        skipIfQueryContains: ['fire roasted', 'fire-roasted', 'crushed', 'diced', 'canned', 'tinned', 'stewed', 'sun dried', 'sun-dried']
    },
    // === NEW: Critical Mapping Failure Fixes (Jan 2026) ===
    // Sweet potato should NOT match noodles (fixes "long sweet potato" → "Long Rice Noodles")
    {
        query: ['sweet potato', 'sweet potatoes', 'yam', 'yams'],
        excludeIfContains: ['noodles', 'rice noodles', 'vermicelli', 'pasta', 'glass noodles', 'cellophane']
    },
    // British marrows (zucchini) should NOT match bone marrow (meat byproduct)
    {
        query: ['baby marrows', 'marrow', 'marrows', 'vegetable marrow'],
        excludeIfContains: ['bone marrow', 'caribou', 'moose', 'alaska', 'native', 'beef marrow', 'roasted marrow']
    },
    // Relish (condiment) should NOT match meat products
    {
        query: ['relish', 'burger relish', 'dill relish', 'sweet relish', 'pickle relish', 'hot dog relish'],
        excludeIfContains: ['turkey burger', 'beef burger', 'hamburger', 'cheeseburger', 'patty', 'turkey patty',
            'chicken burger', 'veggie burger', 'fish burger', 'burger king', 'mcdonalds']
    },
    // Vegetarian/vegan products should NOT match animal meat OR baked goods containing "mince"
    {
        query: ['vegetarian mince', 'vegan mince', 'plant-based mince', 'meatless mince', 'veggie mince',
            'vegetarian ground', 'vegan ground', 'plant-based ground', 'meatless ground'],
        excludeIfContains: ['beef', 'pork', 'chicken', 'turkey', 'lamb', 'ground meat', 'ground beef',
            'ground pork', 'ground chicken', 'ground turkey', 'ground lamb',
            'mince pie', 'mince tart', 'mincemeat', 'fruit mince', 'christmas mince']
    },
    // Red pepper (spice) should NOT match black pepper when in spice context
    // Note: This is handled by spice context detection, but adding explicit guard
    {
        query: ['red pepper', 'crushed red pepper', 'red pepper flakes', 'cayenne'],
        excludeIfContains: ['black pepper', 'white pepper', 'peppercorn', 'green peppercorn']
    },
    // === NEW: Leafy greens should NOT match pasta/noodle products ===
    // "1 bunch spinach" should map to raw spinach, NOT "Spinach Noodles"
    // "bunch" is a produce unit indicator
    {
        query: ['spinach', 'bunch spinach', 'baby spinach', 'fresh spinach', 'raw spinach',
            'kale', 'bunch kale', 'collard greens', 'swiss chard', 'arugula', 'lettuce'],
        excludeIfContains: ['noodle', 'noodles', 'pasta', 'spaghetti', 'linguine', 'fettuccine',
            'macaroni', 'lasagna', 'ravioli', 'tortellini', 'gnocchi', 'dip', 'artichoke dip']
    },
];


// Type for category exclusions with optional skip condition
type CategoryExclusion = {
    query: string[];
    excludeIfContains: string[];
    skipIfQueryContains?: string[];
};

// ============================================================
// Food Type Guard (e.g., "mixed seeds bread" MUST contain "bread")
// ============================================================

// Food types that should be REQUIRED when they appear at the end of a query
const REQUIRED_FOOD_TYPES = [
    'bread', 'cheese', 'milk', 'cream', 'butter', 'yogurt',
    'dressing', 'sauce', 'soup', 'salad', 'juice', 'oil'
];

/**
 * Check if query ends with a food type that MUST be present in the candidate.
 * e.g., "mixed seeds bread" → candidate MUST contain "bread"
 *       "garlic butter" → candidate MUST contain "butter"
 */
export function isFoodTypeMismatch(query: string, candidateName: string, candidateBrand?: string | null): boolean {
    const queryLower = query.toLowerCase().trim();
    const candidateLower = [candidateName, candidateBrand].filter(Boolean).join(' ').toLowerCase();

    // Check if query ends with a required food type
    for (const foodType of REQUIRED_FOOD_TYPES) {
        // Check if query ends with this food type (e.g., "mixed seeds bread")
        // Also check for "X bread" pattern anywhere in query
        if (queryLower.endsWith(foodType) || queryLower.endsWith(foodType + 's')) {
            // Candidate MUST contain the food type
            const hasFoodType = candidateLower.includes(foodType) ||
                candidateLower.includes(foodType + 's');
            if (!hasFoodType) {
                return true; // Mismatch - candidate doesn't have required food type
            }
        }
    }

    return false;
}


/**
 * Check if query ingredient falls into wrong category
 * e.g., "cream" should NOT match "Ice Cream Single Dip"
 * 
 * BUT: If the query ITSELF contains the excluded term, skip the exclusion.
 * e.g., "tomato sauce" query should match "TOMATO SAUCE" candidate
 *       even though "tomato" exclusion includes "sauce".
 */
export function isCategoryMismatch(
    normalizedName: string,
    candidateName: string,
    candidateBrand?: string | null
): boolean {
    const queryLower = normalizedName.toLowerCase().trim();
    const candidateLower = [candidateName, candidateBrand].filter(Boolean).join(' ').toLowerCase().trim();

    for (const exclusion of CATEGORY_EXCLUSIONS) {
        const { query, excludeIfContains, skipIfQueryContains } = exclusion as CategoryExclusion;
        // Check if query matches any pattern
        const queryMatches = query.some(q =>
            queryLower === q ||
            queryLower.endsWith(' ' + q) ||
            queryLower.startsWith(q + ' ')
        );

        if (queryMatches) {
            // Check if this rule should be skipped based on query content
            if (skipIfQueryContains?.some(term => queryLower.includes(term))) {
                continue; // Skip this rule - query itself contains a term that overrides this rule
            }

            // Check if candidate contains excluded categories
            // BUT skip if the query itself contains the excluded term!
            const hasExclusion = excludeIfContains.some(excl => {
                const candidateHasExcl = candidateLower.includes(excl);
                const queryAlsoHasExcl = queryLower.includes(excl);
                // Only exclude if candidate has it BUT query doesn't ask for it
                return candidateHasExcl && !queryAlsoHasExcl;
            });
            if (hasExclusion) {
                return true; // Category mismatch
            }
        }
    }

    return false;
}

// ============================================================
// Macro Sanity Check (Priority 4 - Wrong Macros)
// ============================================================

// Expected macro profiles for basic ingredients (per 100g)
// These help reject candidates with clearly wrong nutrition data
const INGREDIENT_MACRO_PROFILES: Array<{
    ingredients: string[];
    maxCalPer100g?: number;   // e.g., ice/water should have ~0 calories
    maxFatPer100g?: number;   // e.g., lentils should have <2g fat
    minFatPer100g?: number;   // e.g., olives should have >10g fat
    maxCarbPer100g?: number;
    minCarbPer100g?: number;
    minProteinPer100g?: number; // e.g., whey protein should have >40g protein
}> = [
        // Ice/water should have ~0 calories (catches candy branded as "Ice Cubes")
        {
            ingredients: ['ice', 'ice cubes', 'ice cube', 'crushed ice', 'shaved ice', 'water'],
            maxCalPer100g: 5,  // Allow tiny margin for measurement error
        },
        // Legumes should be low-fat (< 2g per 100g)
        {
            ingredients: ['lentils', 'lentil', 'chickpeas', 'chickpea', 'black beans', 'kidney beans', 'pinto beans'],
            maxFatPer100g: 3,  // Allow slight margin
        },
        // Olives should be high-fat, low-carb
        {
            ingredients: ['olives', 'olive', 'kalamata'],
            minFatPer100g: 8,
            maxCarbPer100g: 8,
        },
        // Raw vegetables should be very low-fat
        {
            ingredients: ['potato', 'potatoes', 'carrot', 'carrots', 'broccoli', 'spinach', 'lettuce'],
            maxFatPer100g: 1,
        },
        // Fresh berries should be low-calorie (catches processed/dried berry products like FRUTSTIX)
        {
            ingredients: ['strawberry', 'strawberries', 'blueberry', 'blueberries', 'raspberry', 'raspberries', 'blackberry', 'blackberries', 'berry', 'berries'],
            maxCalPer100g: 60,  // Fresh berries are ~30-50 kcal/100g
        },
        // Protein powders should have high protein, low carbs (catches wrong macro profiles)
        {
            ingredients: ['whey protein', 'protein powder', 'whey isolate', 'casein protein', 'protein isolate'],
            minProteinPer100g: 40,  // Protein powders should be at least 40% protein
            maxCarbPer100g: 35,     // Should not be mostly carbs
        },
        // Unsweetened coconut milk BEVERAGE should be low-calorie (not canned coconut cream)
        {
            ingredients: ['unsweetened coconut milk', 'coconut milk unsweetened'],
            maxCalPer100g: 50,  // Carton coconut milk is ~15-25 kcal/100g, canned cream is ~190+
        },
        // Sugar substitutes / sweeteners should be very low calorie
        // Pure sucralose/stevia/aspartame packets are ~0-4 kcal
        // Bulked sweeteners with maltodextrin (like "Low Calorie Sugar Substitute Powdered") are higher
        // but should still be under ~100 kcal/100g (vs sugar at 400 kcal/100g)
        {
            ingredients: ['sugar substitute', 'sweetener', 'splenda', 'stevia', 'sucralose', 'aspartame', 'monk fruit', 'erythritol'],
            maxCalPer100g: 100,  // Even bulked sweeteners should be well under regular sugar's 400 kcal/100g
        },
        // Ground beef 85% lean should have max ~18g fat/100g (15% fat + margin)
        // This catches cases where user specifies "ground beef" and we normalize to "85% lean"
        // but the API returns a fattier product like 70/30 or 73/27
        // USDA 85% lean raw: ~215 kcal/100g, 15g fat, 20g protein
        // USDA 70% lean raw: ~332 kcal/100g, 30g fat, 14g protein
        // Note: Uses partial matching - "ground beef 85 lean" will match "ground beef 85"
        {
            ingredients: ['ground beef 85', 'ground beef 85%', '85/15 ground beef', '85% lean ground beef', '85 lean ground beef', 'ground beef 85 lean'],
            maxFatPer100g: 20,  // Allow some margin for cooking method variance
            maxCalPer100g: 260, // 85% lean should be under 220 kcal, this allows some margin
        },
        // Dried spices/seasonings should have reasonable calorie density
        // Pure dried peppers, herbs, and spices are typically ~280-320 kcal/100g
        // Catches products with incorrect/inflated nutrition data
        {
            ingredients: ['pepper flakes', 'crushed red pepper', 'red pepper flakes', 'chili flakes', 'cayenne',
                'paprika', 'cumin', 'oregano', 'basil', 'thyme', 'rosemary', 'sage', 'garlic powder',
                'onion powder', 'cinnamon', 'nutmeg', 'ginger powder', 'turmeric', 'curry powder',
                'chili powder', 'black pepper', 'white pepper'],
            maxCalPer100g: 400,  // Pure dried spices are ~280-320 kcal/100g, allow margin
        },
        // Dark chocolate should match cocoa percentage - 70%+ has specific macro profile
        // 70% dark: ~550-600 kcal/100g, 40-45g carbs, 40-45g fat
        // Catches mapping to sweeter chocolates with higher carbs
        {
            ingredients: ['70% dark chocolate', '70% cocoa', '70% cacao', 'dark chocolate 70'],
            maxCarbPer100g: 50,  // 70% dark should have ~40-45g carbs, not 60g
        },
    ];

/**
 * Check if candidate has suspicious macros that don't match expected profile
 * for the queried ingredient. Returns true if macros are suspicious.
 */
export function hasSuspiciousMacros(
    query: string,
    candidateNutrients?: { calories?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null } | null
): boolean {
    if (!candidateNutrients) return false;  // No data = can't check

    const queryLower = query.toLowerCase();
    // Normalize common variations for matching
    const queryNormalized = queryLower
        .replace(/(\d+)\s*%/g, '$1')  // "85%" → "85"
        .replace(/-/g, ' ');  // "part-skim" → "part skim"

    for (const profile of INGREDIENT_MACRO_PROFILES) {
        // Check both exact includes AND normalized pattern matching
        const matchesIngredient = profile.ingredients.some(ing => {
            const ingNormalized = ing.replace(/(\d+)\s*%/g, '$1').replace(/-/g, ' ');
            // Match if query contains ingredient pattern OR vice versa
            // This handles "ground beef 85 lean" matching "ground beef 85"
            return queryLower.includes(ing) ||
                queryNormalized.includes(ingNormalized) ||
                ingNormalized.includes(queryNormalized.split(' ').slice(0, 3).join(' ')); // First 3 words
        });

        if (!matchesIngredient) continue;

        // Check calorie bounds (e.g., ice/water should have ~0 calories)
        if (profile.maxCalPer100g != null && candidateNutrients.calories != null) {
            if (candidateNutrients.calories > profile.maxCalPer100g) {
                return true; // Calories too high for this ingredient type
            }
        }

        // Check fat bounds
        if (profile.maxFatPer100g != null && candidateNutrients.fat != null) {
            if (candidateNutrients.fat > profile.maxFatPer100g) {
                return true; // Fat too high for this ingredient type
            }
        }
        if (profile.minFatPer100g != null && candidateNutrients.fat != null) {
            if (candidateNutrients.fat < profile.minFatPer100g) {
                return true; // Fat too low for this ingredient type (e.g., olives)
            }
        }

        // Check carb bounds
        if (profile.maxCarbPer100g != null && candidateNutrients.carbs != null) {
            if (candidateNutrients.carbs > profile.maxCarbPer100g) {
                return true; // Carbs too high
            }
        }
        if (profile.minCarbPer100g != null && candidateNutrients.carbs != null) {
            if (candidateNutrients.carbs < profile.minCarbPer100g) {
                return true; // Carbs too low
            }
        }

        // Check protein bounds (e.g., whey protein should have >40g protein per 100g)
        if (profile.minProteinPer100g != null && candidateNutrients.protein != null) {
            if (candidateNutrients.protein < profile.minProteinPer100g) {
                return true; // Protein too low for this ingredient type
            }
        }
    }

    return false;
}

/**
 * STRICT PHYSICS CHECK
 * Reject candidates with impossible nutrition data (e.g. >100g fat per 100g)
 * This catches bad data from the API (like "Strawberry (Tony's)" with 113g carbs)
 */
export function hasImpossibleMacros(
    candidateNutrients?: { calories?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null } | null
): boolean {
    if (!candidateNutrients) return false;

    // Allow small margin for rounding errors (e.g. 100.5g)
    const MAX_LIMIT = 102;

    if ((candidateNutrients.carbs ?? 0) > MAX_LIMIT) return true;
    if ((candidateNutrients.fat ?? 0) > MAX_LIMIT) return true;
    if ((candidateNutrients.protein ?? 0) > MAX_LIMIT) return true;

    // Calories: Pure fat is ~900kcal/100g. Pure alcohol is ~700. 
    // Anything over 950 is basically impossible.
    if ((candidateNutrients.calories ?? 0) > 950) return true;

    return false;
}

// ============================================================
// Null/Invalid Macro Validation
// ============================================================

/**
 * Check if nutrition data has null or invalid macros (data quality issue).
 * Foods with null macros should be rejected from selection.
 * 
 * We are stricter for foods with significant calories - they should have
 * both protein AND carbs data (since these are the main calorie sources).
 * 
 * NOTE: If no nutrition data exists at all, we return FALSE (not invalid),
 * since we can't validate what we don't have. The data will be validated
 * later when the candidate is hydrated with full nutrition info.
 */
export function hasNullOrInvalidMacros(
    nutrients?: { kcal?: number | null; calories?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null } | null
): boolean {
    // If nutrients object doesn't exist, we can't validate - allow through
    // (will be validated after hydration when we have actual data)
    if (!nutrients) return false;

    // Check for kcal (we accept either kcal or calories field)
    const calories = nutrients.kcal ?? nutrients.calories;
    // If no calorie data, skip this validation (will be checked after hydration)
    if (calories == null) return false;

    // Reject if ALL macros are null (at least one should be present)
    if (nutrients.protein == null && nutrients.carbs == null && nutrients.fat == null) {
        return true;
    }

    // For foods with significant calories (>50 kcal/100g), we need BOTH protein AND carbs
    // This catches cases like red lentils where fat=2.86 but protein/carbs are null
    // (A food with 314 kcal but only 2.86g fat can't be valid - macros don't add up)
    if (calories > 50) {
        // If protein AND carbs are both null, that's suspicious for a caloric food
        if (nutrients.protein == null && nutrients.carbs == null) {
            return true;
        }
        // ALSO: If protein AND carbs are BOTH ZERO, that's equally suspicious
        // This catches corrupted data like red lentils with P:0, C:0, F:2.86, kcal:314
        // Real lentils have ~25g protein and ~60g carbs per 100g
        if ((nutrients.protein ?? 0) === 0 && (nutrients.carbs ?? 0) === 0) {
            return true;
        }
    }

    return false;
}

// ============================================================
// Simple Ingredient → Processed Product Validation
// ============================================================

// Categories of simple ingredients with expected calorie ranges
// Used to catch when fresh ingredients map to processed products
const SIMPLE_INGREDIENT_CATEGORIES: Array<{
    terms: string[];           // Terms that identify this category
    maxCalPer100g: number;     // Max expected calories for this category
    description: string;       // For logging
    processedIndicators: string[];  // Words that suggest processed product
}> = [
        // Fresh vegetables and produce (<60 kcal/100g typically)
        {
            terms: [
                'pepper', 'peppers', 'chili', 'chilli', 'chile', 'jalapeno', 'serrano', 'habanero',
                'tomato', 'tomatoes', 'onion', 'onions', 'garlic', 'ginger',
                'carrot', 'carrots', 'celery', 'cucumber', 'lettuce', 'spinach', 'kale',
                'broccoli', 'cauliflower', 'cabbage', 'zucchini', 'squash', 'eggplant',
                'mushroom', 'mushrooms', 'asparagus', 'artichoke', 'leek', 'leeks',
                'radish', 'radishes', 'turnip', 'turnips', 'beet', 'beets',
                'green bean', 'green beans', 'snap peas', 'snow peas',
            ],
            maxCalPer100g: 80,  // Fresh veg is typically 10-50 kcal/100g
            description: 'fresh_vegetable',
            processedIndicators: ['cream cheese', 'spread', 'dip', 'sauce', 'dressing', 'chips', 'fried', 'battered'],
        },
        // Fresh herbs (<50 kcal/100g)
        {
            terms: [
                'basil', 'cilantro', 'parsley', 'mint', 'oregano', 'thyme', 'rosemary',
                'dill', 'chives', 'tarragon', 'sage', 'bay leaf', 'bay leaves',
            ],
            maxCalPer100g: 60,
            description: 'fresh_herb',
            processedIndicators: ['pesto', 'sauce', 'dressing', 'spread', 'butter'],
        },
        // Fresh fruits (<80 kcal/100g typically)
        {
            terms: [
                'lemon', 'lime', 'orange', 'grapefruit', 'tangerine',
                'apple', 'pear', 'peach', 'plum', 'apricot', 'nectarine',
                'strawberry', 'strawberries', 'blueberry', 'blueberries',
                'raspberry', 'raspberries', 'blackberry', 'blackberries',
                'grape', 'grapes', 'cherry', 'cherries',
                'watermelon', 'cantaloupe', 'honeydew', 'melon',
                'pineapple', 'mango', 'papaya', 'kiwi',
            ],
            maxCalPer100g: 80,
            description: 'fresh_fruit',
            processedIndicators: ['jam', 'jelly', 'preserve', 'syrup', 'candy', 'dried', 'juice', 'pie', 'cake', 'smoothie'],
        },
        // Raw proteins (<200 kcal/100g for lean cuts)
        {
            terms: [
                'chicken breast', 'turkey breast', 'pork tenderloin', 'beef sirloin',
                'fish fillet', 'salmon fillet', 'tilapia', 'cod', 'halibut',
                'shrimp', 'prawns', 'scallops', 'crab', 'lobster',
                'tofu', 'tempeh', 'seitan',
            ],
            maxCalPer100g: 220,
            description: 'raw_protein',
            processedIndicators: ['breaded', 'battered', 'fried', 'nugget', 'patty', 'burger', 'stick', 'finger'],
        },
        // Spices and dried seasonings (<350 kcal/100g but usually used in tiny amounts)
        {
            terms: [
                'cumin', 'coriander seed', 'turmeric', 'paprika', 'curry powder',
                'chili powder', 'cayenne', 'cinnamon', 'nutmeg', 'clove', 'cloves',
                'cardamom', 'allspice', 'ginger powder', 'garlic powder', 'onion powder',
            ],
            maxCalPer100g: 400,
            description: 'spice',
            processedIndicators: ['blend', 'mix', 'rub', 'with', 'flavored'],
        },
        // Fresh dairy basics (<100 kcal/100g for milk/yogurt)
        {
            terms: [
                'milk', 'skim milk', 'lowfat milk', 'nonfat milk',
                'buttermilk', 'kefir',
            ],
            maxCalPer100g: 80,
            description: 'fresh_dairy_liquid',
            processedIndicators: ['shake', 'smoothie', 'ice cream', 'frozen', 'chocolate', 'flavored'],
        },
        // Eggs (<160 kcal/100g)
        {
            terms: ['egg', 'eggs', 'egg white', 'egg whites', 'egg yolk', 'egg yolks'],
            maxCalPer100g: 180,
            description: 'egg',
            processedIndicators: ['sandwich', 'muffin', 'biscuit', 'mcmuffin', 'croissant', 'burrito'],
        },
        // Grains dry (<380 kcal/100g)
        {
            terms: [
                'rice', 'quinoa', 'oats', 'barley', 'bulgur', 'couscous',
                'farro', 'millet', 'buckwheat',
            ],
            maxCalPer100g: 400,
            description: 'dry_grain',
            processedIndicators: ['cake', 'pudding', 'cereal bar', 'granola bar', 'crispy', 'puffed'],
        },
        // Legumes dry (<360 kcal/100g)
        {
            terms: [
                'lentil', 'lentils', 'chickpea', 'chickpeas', 'black beans',
                'kidney beans', 'pinto beans', 'navy beans', 'cannellini',
                'split peas', 'dal', 'dhal',
            ],
            maxCalPer100g: 380,
            description: 'legume',
            processedIndicators: ['hummus', 'falafel', 'burger', 'patty', 'chips', 'snack'],
        },
    ];

/**
 * Check if a simple ingredient query is incorrectly matching a processed product.
 * 
 * e.g., "chili peppers" (fresh veg, ~40 kcal) → "Chilli Peppers Cream Cheese" (233 kcal) = MISMATCH
 * e.g., "strawberries" (fresh fruit, ~32 kcal) → "Strawberry Jam" (250 kcal) = MISMATCH
 * 
 * Used both for candidate filtering AND alias validation.
 */
export function isSimpleIngredientToProcessedMismatch(
    query: string,
    candidateName: string,
    nutrients?: { kcal?: number | null; calories?: number | null } | null
): boolean {
    const queryLower = query.toLowerCase().trim();
    const candidateLower = candidateName.toLowerCase();

    // Only apply to simple queries (1-3 words)
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length > 4) return false;

    const caloriesPer100g = nutrients?.kcal ?? nutrients?.calories;

    for (const category of SIMPLE_INGREDIENT_CATEGORIES) {
        // Check if query matches this category
        const matchesTerm = category.terms.some(term =>
            queryLower.includes(term) || term.includes(queryLower)
        );

        if (!matchesTerm) continue;

        // Check 1: If we have calorie data and it exceeds threshold + candidate has processed indicators
        if (caloriesPer100g != null && caloriesPer100g > category.maxCalPer100g) {
            const hasProcessedIndicator = category.processedIndicators.some(ind =>
                candidateLower.includes(ind)
            );
            if (hasProcessedIndicator) {
                return true;  // Clear mismatch: high-cal processed product for simple ingredient
            }
        }

        // Check 2: Even without calorie data, flag if candidate has processed indicators
        // AND the calorie threshold is low (fresh produce/herbs)
        if (category.maxCalPer100g <= 100) {
            const hasProcessedIndicator = category.processedIndicators.some(ind =>
                candidateLower.includes(ind)
            );
            // Also check if query starts with candidate (good) vs candidate having extra product words
            const candidateHasExtraProductWords = candidateLower.length > queryLower.length + 20;

            if (hasProcessedIndicator && candidateHasExtraProductWords) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Comprehensive alias validation for mapping synonyms.
 * Before saving a synonym as an alias, validate the mapping makes sense for that synonym.
 * 
 * Returns { valid: false, reason: string } if alias should NOT be saved.
 */
export function validateAliasMapping(
    synonymToSave: string,
    foodName: string,
    nutrients?: { kcal?: number | null; calories?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null } | null
): { valid: boolean; reason?: string } {
    // Check 1: Simple ingredient → processed product mismatch
    if (isSimpleIngredientToProcessedMismatch(synonymToSave, foodName, nutrients)) {
        return {
            valid: false,
            reason: `simple_ingredient_to_processed: "${synonymToSave}" should not map to "${foodName}"`
        };
    }

    // Check 2: Category mismatch (using existing function)
    if (isCategoryMismatch(synonymToSave, foodName)) {
        return {
            valid: false,
            reason: `category_mismatch: "${synonymToSave}" should not map to "${foodName}"`
        };
    }

    // Check 3: Food type mismatch - synonym ending with food type must match
    if (isFoodTypeMismatch(synonymToSave, foodName)) {
        return {
            valid: false,
            reason: `food_type_mismatch: "${synonymToSave}" requires different food type than "${foodName}"`
        };
    }

    // Check 4: Null macros - don't save aliases to foods with bad data
    if (hasNullOrInvalidMacros(nutrients)) {
        return {
            valid: false,
            reason: `null_macros: "${foodName}" has null/invalid nutrition data`
        };
    }

    return { valid: true };
}

// ============================================================
// Replacement/Replacer Mismatch (e.g., "egg replacer" vs "egg")
// ============================================================

const REPLACER_TERMS = [
    'replacer',
    'replacement',
    'substitute',
    'substitution',
];

export function isReplacementMismatch(
    query: string,
    candidateName: string,
    candidateBrand?: string | null
): boolean {
    const queryLower = query.toLowerCase();
    const candidateLower = [candidateName, candidateBrand].filter(Boolean).join(' ').toLowerCase();

    const queryWantsReplacement = REPLACER_TERMS.some(term => queryLower.includes(term));
    if (!queryWantsReplacement) return false;

    const candidateHasReplacement = REPLACER_TERMS.some(term => candidateLower.includes(term));
    return !candidateHasReplacement;
}


/**
 * Detect if a single-ingredient query incorrectly matches a multi-ingredient product
 * e.g., "green chilies" should NOT match "Diced Tomatoes & Green Chilies"
 * 
 * The query ingredient appears in the product, but it's NOT the primary ingredient.
 */
export function isMultiIngredientMismatch(normalizedName: string, candidateName: string): boolean {
    const queryLower = normalizedName.toLowerCase().trim();
    const candidateLower = candidateName.toLowerCase().trim();

    // Only apply to simple queries (1-2 words after filtering stop words)
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length > 3) return false; // Complex query, skip check

    // Check for multi-ingredient patterns: "X & Y", "X and Y", "X with Y"
    const multiMatch = candidateLower.match(/^(.+?)\s+(&|and|with)\s+(.+)$/i);
    if (!multiMatch) return false; // Not a multi-ingredient product

    const beforeConnector = multiMatch[1];
    const afterConnector = multiMatch[3];

    // Check if query matches the part AFTER the connector (secondary ingredient)
    const queryMainToken = queryWords[queryWords.length - 1]; // Last word is usually the main ingredient

    // If query's main token is in the "after" part but NOT in the "before" part,
    // the query is a secondary ingredient in this mixed product
    const inAfter = afterConnector.includes(queryMainToken);
    const inBefore = beforeConnector.includes(queryMainToken);

    if (inAfter && !inBefore) {
        return true; // Mismatch - query is secondary ingredient
    }

    return false;
}

// ============================================================
// Modifier Pre-Filter (Aggressive)
// ============================================================

// Dietary modifiers that should only match when explicitly requested
const DIET_MODIFIERS = [
    // Fat-related (with both space and hyphen variants)
    'nonfat', 'non-fat', 'lowfat', 'low-fat', 'low fat', 'reduced fat', 'reduced-fat',
    'fat free', 'fat-free', 'lite', 'light', 'skim', 'part skim', 'part-skim',
    'fat reduced', 'extra lean', 'extra-lean',
    // Sweetness-related  
    'unsweetened', 'no sugar', 'sugar free', 'sugar-free', 'no added sugar',
    // Dietary restrictions
    'gluten free', 'gluten-free', 'dairy free', 'dairy-free', 'lactose free', 'lactose-free',
    'vegan', 'vegetarian', 'keto', 'paleo',
    // Sodium
    'low sodium', 'low-sodium', 'no salt', 'salt free', 'salt-free', 'reduced sodium', 'reduced-sodium',
    // Calorie
    'low calorie', 'low-calorie', 'diet', 'zero calorie', 'calorie free', 'calorie-free',
];

/**
 * Check if text contains any dietary modifiers
 */
function hasModifier(text: string): { hasMod: boolean; modifiers: string[] } {
    const lower = text.toLowerCase();
    const found = DIET_MODIFIERS.filter(mod => lower.includes(mod));
    return { hasMod: found.length > 0, modifiers: found };
}

/**
 * Check if candidate has unwanted modifiers that query doesn't have,
 * OR if candidate is MISSING required modifiers that query has.
 * 
 * e.g., "milk" → "Nonfat Milk" (unwanted modifier)
 * e.g., "lowfat milk" → "Whole Milk" (missing required modifier)
 */
function hasUnwantedModifier(normalizedName: string, candidateName: string): boolean {
    const queryMods = hasModifier(normalizedName);
    const candidateMods = hasModifier(candidateName);

    // If query has no modifiers but candidate does → unwanted
    if (!queryMods.hasMod && candidateMods.hasMod) {
        return true;
    }

    // If query HAS modifiers but candidate doesn't → missing required
    // e.g., "lowfat milk" query should NOT match "Whole Milk" candidate
    if (queryMods.hasMod && !candidateMods.hasMod) {
        return true;
    }

    // If both have modifiers, check if they're compatible
    // e.g., "lowfat milk" should not match "nonfat milk" or "whole milk"
    if (queryMods.hasMod && candidateMods.hasMod) {
        // Check if at least one of the query modifiers is present in candidate
        const hasMatchingMod = queryMods.modifiers.some(qMod =>
            candidateMods.modifiers.some(cMod =>
                qMod === cMod || cMod.includes(qMod) || qMod.includes(cMod)
            )
        );
        if (!hasMatchingMod) {
            return true;
        }
    }

    return false;
}

// ============================================================
// Critical Modifier Enforcement (Option A)
// Only catches nutritionally significant mismatches:
// - Fat content (2% → whole, lowfat → regular)
// - Calorie content (low calorie → regular)
// ============================================================

// Fat percentage modifiers that are nutritionally distinct
const FAT_PERCENTAGE_MODIFIERS = ['2%', '1%', 'skim', 'whole', 'half-and-half', 'half and half'];
const LOW_FAT_MODIFIERS = ['lowfat', 'low-fat', 'low fat', 'reduced fat', 'reduced-fat', 'lite', 'light', 'nonfat', 'non-fat', 'fat free', 'fat-free', 'skim', 'part-skim', 'part skim'];
const CALORIE_MODIFIERS = ['low calorie', 'low-calorie', 'diet', 'zero calorie', 'calorie free', 'calorie-free', 'sugar free', 'sugar-free'];

/**
 * Check for CRITICAL modifier mismatches only.
 * These are nutritionally significant and should be enforced:
 * - "2% milk" should NOT match "Whole Milk" 
 * - "low calorie soda" should NOT match regular soda
 * 
 * For FatSecret/cache sources: STRICT - require modifier in name (FatSecret has proper naming)
 * For FDC: LENIENT - only reject explicit "whole" (FDC uses different naming conventions)
 */
export function hasCriticalModifierMismatch(
    query: string,
    candidateName: string,
    source: 'fatsecret' | 'fdc' | 'cache'
): boolean {
    const queryLower = query.toLowerCase();
    const candLower = candidateName.toLowerCase();

    // Check fat percentage (e.g., "2% milk" vs "whole milk")
    const queryFatPct = FAT_PERCENTAGE_MODIFIERS.find(m => queryLower.includes(m));
    const candFatPct = FAT_PERCENTAGE_MODIFIERS.find(m => candLower.includes(m));

    if (queryFatPct && candFatPct && queryFatPct !== candFatPct) {
        // Query asks for specific fat%, candidate has different fat%
        return true;
    }

    // Check low-fat modifiers - TIERED approach:
    // - STRICT: nonfat, fat-free, fat free → candidate MUST have nonfat/fat-free (not just light)
    // - LENIENT: low-fat, reduced fat, light, lite → candidate can have any low-fat modifier

    const STRICT_NONFAT = ['nonfat', 'non-fat', 'fat free', 'fat-free', 'fatfree', 'extra light', 'extra-light'];
    const NONFAT_CANDIDATES = ['nonfat', 'non-fat', 'fat free', 'fat-free', 'fatfree', 'fat not added', '0% fat', 'zero fat'];

    const queryHasStrictNonfat = STRICT_NONFAT.some(m => queryLower.includes(m));
    const candHasNonfat = NONFAT_CANDIDATES.some(m => candLower.includes(m));

    if (queryHasStrictNonfat) {
        // Query asks for nonfat/fat-free - REQUIRE nonfat/fat-free in candidate
        // "Light Italian Dressing" does NOT satisfy "nonfat Italian dressing"
        if (!candHasNonfat) {
            return true; // Reject - candidate doesn't meet strict nonfat requirement
        }
    }

    // For other low-fat modifiers (light, low-fat, etc.), keep existing logic
    // IMPORTANT: lowfat/reduced-fat is DIFFERENT from nonfat/fat-free
    // "lowfat milk" should NOT match "Milk (Nonfat)" - they have different nutrition!
    const LENIENT_LOW_FAT = ['lowfat', 'low-fat', 'low fat', 'reduced fat', 'reduced-fat', 'lite', 'light', 'part-skim', 'part skim'];
    // Note: removed 'skim' from LENIENT_LOW_FAT as skim milk IS nonfat
    // Added 'part-skim' and 'part skim' for cheese queries like "part-skim mozzarella"
    const queryHasLowFat = LENIENT_LOW_FAT.some(m => queryLower.includes(m)) && !queryHasStrictNonfat;

    // Check if candidate has LENIENT low-fat modifiers (not nonfat)
    const candHasLenientLowFat = LENIENT_LOW_FAT.some(m => candLower.includes(m));
    const candHasWhole = candLower.includes('whole') && !candLower.includes('whole grain') && !candLower.includes('whole wheat');

    if (queryHasLowFat) {
        // Query wants LOW-FAT (1-2% fat), NOT nonfat/fat-free
        // Reject nonfat candidates - they are nutritionally different!
        if (candHasNonfat) {
            return true; // Reject - user wants lowfat, not nonfat
        }

        // For all sources: require the candidate to have a low-fat modifier
        // This prevents "reduced fat colby" from matching full-fat "COLBY AND MONTEREY JACK CHEESE"
        if (!candHasLenientLowFat) {
            // Special exception: FDC sometimes uses different naming without explicit modifiers
            // Only allow if candidate explicitly says "whole" (definitely wrong)
            // OR if it doesn't have any fat-related modifier at all (likely full-fat)
            if (source === 'fdc' && candHasWhole) {
                return true; // Reject - explicitly "whole" when query asks for low-fat
            }
            // For FatSecret/cache: always require low-fat modifier
            if (source === 'fatsecret' || source === 'cache') {
                return true; // Reject - candidate should have low-fat modifier
            }
            // For FDC with no "whole": still reject if we're looking for reduced-fat
            // (This catches cases like "COLBY CHEESE" when query is "reduced fat colby")
            if (source === 'fdc') {
                return true; // Reject - FDC candidate without low-fat modifier
            }
        }
    }

    // Check calorie modifiers
    // IMPORTANT: "light", "lite" and "low calorie" are functionally equivalent
    // A "Light Mayonnaise" candidate DOES satisfy a "low calorie mayonnaise" query
    // For frozen treats: "no sugar added" and "fat free" are equivalent to "sugar free"
    const ALL_LOW_CAL_MODIFIERS = [
        ...CALORIE_MODIFIERS,
        'light', 'lite',  // These are equivalent to "low calorie" for condiments/dressings
        'no sugar added', 'no added sugar',  // Equivalent to "sugar free" for frozen treats
        'fat free', 'fat-free',  // Often used interchangeably with "sugar free" for frozen desserts
    ];
    const queryHasLowCal = CALORIE_MODIFIERS.some(m => queryLower.includes(m));
    const candHasLowCal = ALL_LOW_CAL_MODIFIERS.some(m => candLower.includes(m));

    if (queryHasLowCal && !candHasLowCal) {
        // Query explicitly asks for low-calorie, candidate doesn't have it
        // (but "light" and "lite" are acceptable substitutes)
        return true;
    }

    return false;
}

// ============================================================
// Strict Dietary Exclusion (Vegetarian/Vegan/Plant-Based)
// ============================================================

/**
 * STRICT dietary constraint filter.
 * When query contains vegetarian/vegan/plant-based, REJECT ALL meat candidates.
 * 
 * This ensures "vegetarian mince" NEVER maps to "ground beef", "deer meat", etc.
 * If no suitable plant-based candidates exist, the mapping should FAIL
 * and trigger AI fallback rather than produce a false mapping.
 * 
 * @returns true if candidate should be REJECTED (dietary violation)
 */
export function isDietaryConstraintViolation(
    rawLine: string,
    candidateName: string,
    candidateBrand?: string | null
): boolean {
    const queryLower = rawLine.toLowerCase();
    const candidateLower = [candidateName, candidateBrand].filter(Boolean).join(' ').toLowerCase();

    // Detect if query requires vegetarian/vegan/plant-based
    const VEGETARIAN_INDICATORS = [
        'vegetarian', 'vegan', 'plant-based', 'plant based', 'meatless',
        'meat-free', 'meat free', 'veggie', 'vegetable-based'
    ];
    const requiresVegetarian = VEGETARIAN_INDICATORS.some(ind => queryLower.includes(ind));

    if (!requiresVegetarian) {
        return false;  // No dietary constraint
    }

    // STRICT: Reject ANY meat-related candidate
    const MEAT_INDICATORS = [
        // Animal meats
        'beef', 'pork', 'chicken', 'turkey', 'lamb', 'mutton', 'veal', 'venison',
        'bison', 'buffalo', 'deer', 'elk', 'moose', 'caribou', 'goat', 'rabbit',
        'duck', 'goose', 'pheasant', 'quail', 'game meat', 'game bird',
        // Ground/processed meats
        'ground meat', 'ground beef', 'ground pork', 'ground turkey', 'ground chicken',
        'minced meat', 'minced beef', 'minced pork',
        'sausage', 'bacon', 'ham', 'prosciutto', 'salami', 'pepperoni',
        'hot dog', 'bratwurst', 'chorizo', 'kielbasa',
        // Seafood (for strict vegetarian)
        'fish', 'salmon', 'tuna', 'cod', 'tilapia', 'shrimp', 'prawn', 'crab',
        'lobster', 'scallop', 'mussel', 'clam', 'oyster', 'anchovy', 'sardine',
        // Bone/animal products
        'bone marrow', 'bone broth', 'gelatin', 'lard', 'tallow', 'suet',
        // Common patterns that indicate meat
        'raw meat', 'cooked meat', 'roast beef', 'steak', 'chop', 'rib',
    ];

    const hasMeatIndicator = MEAT_INDICATORS.some(meat => candidateLower.includes(meat));

    if (hasMeatIndicator) {
        // Log the rejection for debugging
        logger.debug('filter.dietary_constraint_violation', {
            query: rawLine,
            candidate: candidateName,
            reason: 'vegetarian_query_meat_candidate'
        });
        return true;  // REJECT - dietary constraint violation
    }

    return false;
}


// ============================================================
// Main Filter Function
// ============================================================

export function filterCandidatesByTokens(
    candidates: UnifiedCandidate[],
    normalizedName: string,
    options: FilterOptions = {}
): FilterResult {
    const { debug = false, rawLine } = options;

    // Use rawLine for modifier detection if available, otherwise fall back to normalizedName
    const modifierCheckSource = rawLine || normalizedName;

    if (candidates.length === 0) {
        return { filtered: [], removedCount: 0 };
    }

    // Extract must-have tokens
    const mustHaveTokens = deriveMustHaveTokens(normalizedName);

    if (mustHaveTokens.length === 0) {
        // No tokens to filter by - keep all
        return { filtered: candidates, removedCount: 0 };
    }

    // Filter candidates
    const filtered = candidates.filter(candidate => {
        const candidateName = normalizeCandidateName(candidate);
        const candidateTokens = tokenize(candidateName);

        // Check for CRITICAL nutritional modifier mismatches (Option A)
        // This catches: 2% milk → Whole Milk, low calorie soda → regular soda
        // Does NOT block minor preferences like unsweetened, organic (handled by scoring)
        if (rawLine && hasCriticalModifierMismatch(rawLine, candidate.name, candidate.source)) {
            if (debug) {
                logger.info('filter.candidates.critical_modifier_mismatch', {
                    query: rawLine,
                    candidate: candidate.name,
                });
            }
            return false;
        }

        // Replacement-specific mismatch (e.g., "egg replacer" should not match "egg")
        if (isReplacementMismatch(modifierCheckSource, candidate.name, candidate.brandName)) {
            if (debug) {
                logger.info('filter.candidates.replacement_mismatch', {
                    query: modifierCheckSource,
                    candidate: candidate.name,
                });
            }
            return false;
        }

        // Check for ambiguous ingredients with wrong context (e.g., "1 dash pepper" → spice, not bell pepper)
        if (rawLine && isWrongFormForContext(rawLine, normalizedName, candidate.name)) {
            return false;
        }

        // STRICT dietary constraint (vegetarian/vegan queries → reject ALL meat candidates)
        if (rawLine && isDietaryConstraintViolation(rawLine, candidate.name, candidate.brandName)) {
            if (debug) {
                logger.info('filter.candidates.dietary_constraint_violation', {
                    query: rawLine,
                    candidate: candidate.name,
                });
            }
            return false;
        }

        // Basic Token Check (Sanity Check)
        // Ensure at least the core identity is present
        const hasRequiredTokens = mustHaveTokens.every(token => {
            // Direct match in tokenized set (already word-bounded)
            if (candidateTokens.has(token)) {
                return true;
            }
            // Word boundary match in full name (prevents "ice" matching "rice")
            // Use regex with word boundaries instead of includes()
            const wordBoundaryRegex = new RegExp(`\\b${token}\\b`, 'i');
            if (wordBoundaryRegex.test(candidateName)) {
                return true;
            }

            // Dynamic singular/plural variant check
            // e.g., "strawberry" should match candidates with "strawberries"
            const variants = getSingularPluralVariants(token);
            for (const variant of variants) {
                if (variant !== token) {
                    if (candidateTokens.has(variant)) {
                        return true;
                    }
                    const variantRegex = new RegExp(`\\b${variant}\\b`, 'i');
                    if (variantRegex.test(candidateName)) {
                        return true;
                    }
                }
            }

            // Try synonym matches (for British → American translations)
            const synonyms = TOKEN_SYNONYMS[token];
            if (synonyms) {
                return synonyms.some(syn =>
                    candidateTokens.has(syn) || new RegExp(`\\b${syn}\\b`, 'i').test(candidateName)
                );
            }
            return false;
        });

        if (!hasRequiredTokens) return false;

        // ============================================================
        // Disqualifier Token Check
        // ============================================================
        // Reject candidates with completely unrelated words (e.g., "cadillac" for "flaxseed meal")
        // This catches false positives where modifier tokens are ignored but unrelated words remain
        const UNRELATED_INDICATORS = new Set([
            'cadillac', 'cocktail', 'martini', 'margarita', 'daiquiri', 'mojito',
            'cosmopolitan', 'manhattan', 'negroni', 'aperol', 'spritz',
            'alcoholic', 'liqueur', 'liquor', 'spirits', 'bourbon', 'vodka', 'rum', 'gin', 'whiskey',
            'grill', 'restaurant', 'cafe', 'diner', 'bistro', 'kitchen',
            'auto', 'car', 'vehicle', 'truck', 'automotive'
        ]);

        const candidateWords = candidateName.split(/\s+/).filter(w => w.length > 3);
        const queryWords = new Set(normalizedName.toLowerCase().split(/\s+/).filter(w => w.length > 3));

        for (const word of candidateWords) {
            // Skip words that appear in query
            if (queryWords.has(word)) continue;

            // Skip words that are related to must-have tokens
            if (mustHaveTokens.some(token => word.includes(token) || token.includes(word))) continue;

            // Skip words that have synonyms (they're ingredient-related)
            if (TOKEN_SYNONYMS[word]) continue;

            // Check for completely unrelated indicators
            if (UNRELATED_INDICATORS.has(word)) {
                if (debug) {
                    logger.info('filter.candidates.disqualifier_word', {
                        query: normalizedName,
                        candidate: candidate.name,
                        disqualifier: word,
                    });
                }
                return false; // Reject - unrelated word found
            }
        }

        // Category mismatch detection (e.g., "almond milk" vs "chocolate candy")
        if (isCategoryMismatch(normalizedName, candidate.name, candidate.brandName)) {
            if (debug) {
                logger.info('filter.candidates.category_mismatch', {
                    query: normalizedName,
                    candidate: candidate.name,
                });
            }
            return false;
        }

        // Multi-ingredient product mismatch (e.g., "green chilies" vs "Diced Tomatoes & Green Chilies")
        if (isMultiIngredientMismatch(normalizedName, candidate.name)) {
            if (debug) {
                logger.info('filter.candidates.multi_ingredient_mismatch', {
                    query: normalizedName,
                    candidate: candidate.name,
                });
            }
            return false;
        }

        if (isFoodTypeMismatch(normalizedName, candidate.name, candidate.brandName)) {
            if (debug) {
                logger.info('filter.candidates.food_type_mismatch', {
                    query: normalizedName,
                    candidate: candidate.name,
                });
            }
            return false;
        }

        // Grain cooking state check (e.g., "4 cups quinoa" should NOT match dry QUINOA)
        // Volume units (cups) with grains → prefer cooked
        // Weight units (g, oz) with grains → prefer dry
        if (rawLine && isWrongCookingStateForGrain(rawLine, normalizedName, candidate.name)) {
            if (debug) {
                logger.info('filter.candidates.wrong_cooking_state', {
                    query: normalizedName,
                    rawLine,
                    candidate: candidate.name,
                });
            }
            return false;
        }

        // Helper to extract nutrients for checks
        let nutrientsToCheck: any = null;
        if (candidate.nutrition && candidate.nutrition.per100g) {
            nutrientsToCheck = {
                calories: candidate.nutrition.kcal,
                protein: candidate.nutrition.protein,
                fat: candidate.nutrition.fat,
                carbs: candidate.nutrition.carbs
            };
        } else if (candidate.rawData && candidate.rawData.nutrientsPer100g) {
            nutrientsToCheck = candidate.rawData.nutrientsPer100g;
        } else {
            nutrientsToCheck = candidate.rawData;
        }

        // Check for IMPOSSIBLE macros (bad API data)
        // e.g. "Strawberry" with 113g carbs
        if (hasImpossibleMacros(nutrientsToCheck)) {
            if (debug) logger.info('filter.candidates.impossible_macros', { candidate: candidate.name, nutrients: nutrientsToCheck });
            return false;
        }

        // Check for NULL/INVALID macros (corrupted data)
        // e.g. Red lentils with P:0, C:0, kcal:314 - this is bad data
        if (hasNullOrInvalidMacros(nutrientsToCheck)) {
            if (debug) logger.info('filter.candidates.null_or_invalid_macros', { candidate: candidate.name, nutrients: nutrientsToCheck });
            return false;
        }

        // Check for SUSPICIOUS macros that don't match expected profile
        // e.g. "strawberry" → FRUTSTIX (85 kcal/100g vs expected 32), "whey protein" with more carbs than protein
        // Use rawLine for this check as AI normalization may strip important modifiers like "unsweetened"
        const queryForMacroCheck = rawLine || normalizedName;
        if (hasSuspiciousMacros(queryForMacroCheck, nutrientsToCheck)) {
            if (debug) logger.info('filter.candidates.suspicious_macros', { query: queryForMacroCheck, candidate: candidate.name, nutrients: nutrientsToCheck });
            return false;
        }

        return true;

    });

    const removedCount = candidates.length - filtered.length;

    if (debug && removedCount > 0) {
        logger.info('filter.candidates.removed', {
            normalizedName,
            mustHaveTokens,
            before: candidates.length,
            after: filtered.length,
            removed: candidates
                .filter(c => !filtered.includes(c))
                .slice(0, 3)
                .map(c => c.name),
        });
    }

    return {
        filtered,
        removedCount,
        reason: removedCount > 0 ? 'removed_by_must_have_tokens' : undefined,
    };
}

// ============================================================
// Token Derivation
// ============================================================

export function deriveMustHaveTokens(normalizedName: string): string[] {
    const tokens = normalizedName
        .toLowerCase()
        .split(/[^\w]+/)
        .filter(t => t.length > 2 && !STOP_WORDS.has(t));

    if (tokens.length === 0) return [];

    // Check if this is a specialty ingredient
    const nameLower = normalizedName.toLowerCase();

    // Plum/Roma tomatoes should require the tomato token (avoid plum fruit matches)
    if (/(plum|roma)\s+tomato/.test(nameLower)) {
        return ['tomato'];
    }
    const isSpecialty = SPECIALTY_PATTERNS.some(p => p.test(nameLower));

    if (isSpecialty && tokens.length > 1) {
        // For specialty items, find the most distinctive token
        // Skip common qualifiers like "unsweetened" to find the main ingredient
        const qualifiers = new Set(['unsweetened', 'sweetened', 'organic', 'raw', 'fresh', 'dried']);

        const distinctiveTokens = tokens.filter(t => !qualifiers.has(t));
        if (distinctiveTokens.length > 0) {
            // Return just the first distinctive token (e.g., "coconut" from "unsweetened coconut milk")
            return distinctiveTokens.slice(0, 1);
        }

        // Fallback to first token if all are qualifiers
        return tokens.slice(0, 1);
    }

    // For queries with dietary/modifier tokens, be more lenient
    // These are "nice to have" but shouldn't be required for basic matching
    const MODIFIER_TOKENS = new Set([
        'reduced', 'calorie', 'calories', 'lowfat', 'nonfat', 'light', 'lite',
        'fat', 'free', 'sugar', 'sodium', 'salt', 'unsalted', 'salted',
        'whole', 'skim', 'part', 'extra', 'lean', 'diet',
        // Dietary preference modifiers (these describe HOW the food is made, not WHAT it is)
        'vegetarian', 'vegan', 'plant', 'meatless', 'dairy',
        // Size/age modifiers
        'baby', 'mini', 'small', 'large', 'jumbo', 'young', 'mature',
        // Unit-like words that shouldn't be mandatory tokens
        'bunch', 'bundle', 'sprig', 'stalk', 'head', 'clove',
        // Flavor/texture descriptors
        'buttery', 'nutty', 'tangy', 'zesty', 'spicy', 'mild',
        // Color/variety modifiers  
        'dark', 'golden', 'white', 'red', 'green', 'yellow', 'black',
        // Form modifiers
        'granules', 'granulated', 'flakes', 'powder', 'powdered', 'ground', 'dried', 'fresh', 'frozen',
        // Processing modifiers
        'toasted', 'roasted', 'raw', 'cooked', 'canned', 'diced', 'sliced', 'chopped',
        // Texture modifiers
        'creamy', 'smooth', 'chunky', 'thick', 'thin',
        // Prep/state modifiers
        'undrained', 'drained', 'rinsed', 'peeled', 'seeded', 'pitted', 'shelled',
        'unsweetened', 'sweetened', 'organic', 'natural', 'pure', 'plain',
        // Cooking descriptors (often in candidate names, not core ingredient)
        'broth', 'bouillon', 'consomme', 'stock',
    ]);

    // Check if this is a multi-word British term that should match as a phrase
    // For these, we only require the non-British tokens (e.g., "peas" from "mange tout snap peas")
    const BRITISH_MULTI_WORD = [
        'mange tout', 'spring onion', 'spring onions',
        'single cream', 'double cream', 'icing sugar',
        'caster sugar', 'plain flour', 'self raising',
        'coriander leaves', 'rocket leaves',
    ];

    // Check if name CONTAINS any British multi-word term
    const containsBritishTerm = BRITISH_MULTI_WORD.some(term => nameLower.includes(term));
    if (containsBritishTerm) {
        // For British multi-word terms, only require tokens that AREN'T part of the British phrase
        // e.g., "mange tout snap peas" → only require "snap" or "peas"
        const britishTokens = new Set(['mange', 'tout', 'spring', 'single', 'double',
            'icing', 'caster', 'plain', 'self', 'raising', 'coriander', 'rocket']);
        const nonBritishTokens = tokens.filter(t => !britishTokens.has(t));

        if (nonBritishTokens.length > 0) {
            // Return just the non-British tokens (like "peas" or "snap")
            return nonBritishTokens.slice(0, 2);
        }
        // If all tokens are British terms, just return the last one
        return tokens.slice(-1);
    }

    // For compound ingredients with "&" or "and", only require ONE of the components
    // e.g., "baby spinach & kale" → only require "spinach" (not both "spinach" AND "kale")
    if (nameLower.includes('&') || nameLower.includes(' and ')) {
        const parts = nameLower.split(/\s*[&]\s*|\s+and\s+/);
        if (parts.length >= 2) {
            // Get core tokens from the first component only
            const firstPartTokens = parts[0].split(/[^\w]+/).filter(t =>
                t.length > 2 && !STOP_WORDS.has(t) && !MODIFIER_TOKENS.has(t)
            );
            if (firstPartTokens.length > 0) {
                return firstPartTokens.slice(0, 1);  // Just require first component's core token
            }
        }
    }

    // Separate core tokens from modifier tokens
    const coreTokens = tokens.filter(t => !MODIFIER_TOKENS.has(t));

    // LENIENT APPROACH: Only require 1 core token
    // The goal is to avoid obviously wrong choices, not to be strict
    // If we have any core tokens, just require the first one
    if (coreTokens.length >= 1) {
        return coreTokens.slice(0, 1);
    }

    // If ALL tokens are modifiers (rare), just use the first token
    return tokens.slice(0, 1);
}

// ============================================================
// Helper Functions
// ============================================================

function normalizeCandidateName(candidate: UnifiedCandidate): string {
    const parts = [candidate.name];
    if (candidate.brandName) parts.push(candidate.brandName);
    return parts.join(' ').toLowerCase();
}

function tokenize(text: string): Set<string> {
    return new Set(
        text
            .toLowerCase()
            .split(/[^\w]+/)
            .filter(t => t.length > 2)
    );
}
