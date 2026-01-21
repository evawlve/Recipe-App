/**
 * Default Count Grams
 * 
 * Step 7 of AI Cost Reduction Refactor:
 * Provides deterministic serving estimates for common count units without LLM.
 * Falls back to this before attempting LLM estimation.
 * 
 * Sources:
 * - USDA FoodData Central (primary)
 * - Common nutritional references
 * - FatSecret cached serving data analysis
 */

// ============================================================
// Types
// ============================================================

export interface CountDefault {
    /** Weight in grams */
    grams: number;
    /** Confidence level (0.7-0.95 typically) */
    confidence: number;
    /** Source of this default */
    source: 'seed' | 'derived' | 'usda';
}

interface SeedEntry {
    /** Base gram weight for default size */
    grams: number;
    /** Confidence in this estimate */
    confidence: number;
    /** Optional size variants */
    sizes?: {
        small?: number;
        medium?: number;
        large?: number;
    };
    /** Aliases that should match this food */
    aliases?: string[];
}

// ============================================================
// Seed Data: Common Count-Based Servings
// These are well-established weights from USDA and nutritional references
// ============================================================

const COUNT_DEFAULTS: Record<string, SeedEntry> = {
    // ===== EGGS =====
    'egg': { grams: 50, confidence: 0.95, sizes: { small: 38, medium: 44, large: 50 }, aliases: ['eggs', 'chicken egg'] },
    'egg white': { grams: 33, confidence: 0.9, aliases: ['egg whites'] },
    'egg yolk': { grams: 17, confidence: 0.9, aliases: ['egg yolks'] },

    // ===== FRUITS =====
    'apple': { grams: 182, confidence: 0.9, sizes: { small: 149, medium: 182, large: 223 }, aliases: ['apples'] },
    'banana': { grams: 118, confidence: 0.95, sizes: { small: 81, medium: 118, large: 136 }, aliases: ['bananas'] },
    'orange': { grams: 131, confidence: 0.9, sizes: { small: 96, medium: 131, large: 184 }, aliases: ['oranges'] },
    'lemon': { grams: 58, confidence: 0.85, aliases: ['lemons'] },
    'lime': { grams: 67, confidence: 0.85, aliases: ['limes'] },
    'avocado': { grams: 201, confidence: 0.9, sizes: { small: 136, medium: 201, large: 304 }, aliases: ['avocados'] },
    'peach': { grams: 150, confidence: 0.85, sizes: { small: 130, medium: 150, large: 175 }, aliases: ['peaches'] },
    'pear': { grams: 178, confidence: 0.85, sizes: { small: 148, medium: 178, large: 209 }, aliases: ['pears'] },
    'plum': { grams: 66, confidence: 0.85, aliases: ['plums'] },
    'kiwi': { grams: 69, confidence: 0.85, aliases: ['kiwis', 'kiwifruit'] },
    'mango': { grams: 336, confidence: 0.85, aliases: ['mangos', 'mangoes'] },
    'grapefruit': { grams: 256, confidence: 0.85, sizes: { small: 200, medium: 256, large: 325 }, aliases: ['grapefruits'] },
    'strawberry': { grams: 12, confidence: 0.8, sizes: { small: 7, medium: 12, large: 18 }, aliases: ['strawberries'] },
    'blueberry': { grams: 1.5, confidence: 0.7, aliases: ['blueberries'] },

    // ===== VEGETABLES =====
    'potato': { grams: 213, confidence: 0.9, sizes: { small: 170, medium: 213, large: 284 }, aliases: ['potatoes'] },
    'sweet potato': { grams: 180, confidence: 0.9, sizes: { small: 130, medium: 180, large: 225 }, aliases: ['sweet potatoes'] },
    'tomato': { grams: 123, confidence: 0.9, sizes: { small: 91, medium: 123, large: 182 }, aliases: ['tomatoes'] },
    'onion': { grams: 150, confidence: 0.85, sizes: { small: 70, medium: 150, large: 225 }, aliases: ['onions'] },
    'carrot': { grams: 72, confidence: 0.85, sizes: { small: 50, medium: 72, large: 85 }, aliases: ['carrots'] },
    'celery stalk': { grams: 40, confidence: 0.85, aliases: ['celery stalks', 'celery'] },
    'cucumber': { grams: 301, confidence: 0.85, aliases: ['cucumbers'] },
    'bell pepper': { grams: 164, confidence: 0.85, sizes: { small: 119, medium: 164, large: 186 }, aliases: ['bell peppers', 'pepper'] },
    'garlic clove': { grams: 3, confidence: 0.9, aliases: ['garlic cloves', 'clove garlic'] },
    'mushroom': { grams: 18, confidence: 0.8, aliases: ['mushrooms'] },
    'zucchini': { grams: 196, confidence: 0.85, sizes: { small: 118, medium: 196, large: 323 }, aliases: ['zucchinis', 'courgette'] },
    'broccoli floret': { grams: 11, confidence: 0.75, aliases: ['broccoli florets'] },
    'cauliflower floret': { grams: 13, confidence: 0.75, aliases: ['cauliflower florets'] },
    'corn ear': { grams: 103, confidence: 0.85, sizes: { small: 77, medium: 103, large: 127 }, aliases: ['corn on the cob', 'ear of corn'] },

    // ===== BREAD & BAKED GOODS =====
    'bread slice': { grams: 30, confidence: 0.85, aliases: ['slice bread', 'bread'] },
    'tortilla': { grams: 45, confidence: 0.8, sizes: { small: 25, medium: 45, large: 70 }, aliases: ['tortillas'] },
    'english muffin': { grams: 57, confidence: 0.85, aliases: ['english muffins'] },
    'bagel': { grams: 98, confidence: 0.8, sizes: { small: 71, medium: 98, large: 131 }, aliases: ['bagels'] },
    'croissant': { grams: 57, confidence: 0.8, sizes: { small: 40, medium: 57, large: 67 }, aliases: ['croissants'] },
    'pancake': { grams: 38, confidence: 0.75, aliases: ['pancakes', 'hotcake'] },
    'waffle': { grams: 75, confidence: 0.8, aliases: ['waffles'] },
    'muffin': { grams: 113, confidence: 0.75, sizes: { small: 66, medium: 113, large: 139 }, aliases: ['muffins'] },

    // ===== DAIRY & CHEESE =====
    'cheese slice': { grams: 21, confidence: 0.85, aliases: ['slice cheese', 'american cheese slice'] },
    'cheese stick': { grams: 28, confidence: 0.85, aliases: ['string cheese', 'cheese sticks'] },

    // ===== MEAT & PROTEIN =====
    'chicken breast': { grams: 174, confidence: 0.85, sizes: { small: 140, medium: 174, large: 225 }, aliases: ['chicken breasts'] },
    'chicken thigh': { grams: 116, confidence: 0.85, aliases: ['chicken thighs'] },
    'chicken wing': { grams: 34, confidence: 0.85, aliases: ['chicken wings', 'wing'] },
    'bacon strip': { grams: 12, confidence: 0.85, aliases: ['bacon strips', 'strip bacon', 'bacon slice'] },
    'sausage link': { grams: 45, confidence: 0.8, aliases: ['sausage links', 'breakfast sausage'] },
    'sausage patty': { grams: 27, confidence: 0.8, aliases: ['sausage patties'] },
    'hot dog': { grams: 45, confidence: 0.85, aliases: ['hot dogs', 'frankfurter'] },
    'shrimp': { grams: 5, confidence: 0.75, sizes: { small: 3, medium: 5, large: 8 }, aliases: ['shrimps', 'prawn'] },

    // ===== NUTS & SEEDS =====
    'almond': { grams: 1.2, confidence: 0.85, aliases: ['almonds'] },
    'walnut half': { grams: 4, confidence: 0.85, aliases: ['walnut halves', 'walnut'] },
    'cashew': { grams: 1.5, confidence: 0.85, aliases: ['cashews'] },
    'pecan half': { grams: 2.5, confidence: 0.85, aliases: ['pecan halves', 'pecan'] },

    // ===== CONDIMENTS & SWEETENERS =====
    'sugar packet': { grams: 4, confidence: 0.9, aliases: ['packet sugar', 'sugar packets'] },
    'sweetener packet': { grams: 1, confidence: 0.9, aliases: ['packet sweetener', 'sweetener packets', 'splenda packet'] },
    'ketchup packet': { grams: 9, confidence: 0.85, aliases: ['packet ketchup'] },
    'mayonnaise packet': { grams: 12, confidence: 0.85, aliases: ['mayo packet', 'packet mayo'] },
    'butter pat': { grams: 5, confidence: 0.9, aliases: ['pat butter', 'pat of butter'] },

    // ===== STOCK & BOUILLON =====
    'bouillon cube': { grams: 4, confidence: 0.9, aliases: ['stock cube', 'broth cube', 'bullion cube'] },

    // ===== OTHER COMMON ITEMS =====
    'cookie': { grams: 30, confidence: 0.7, sizes: { small: 15, medium: 30, large: 45 }, aliases: ['cookies'] },
    'cracker': { grams: 4, confidence: 0.75, aliases: ['crackers'] },
    'olive': { grams: 4, confidence: 0.8, sizes: { small: 3, medium: 4, large: 5 }, aliases: ['olives'] },
    'pickle': { grams: 35, confidence: 0.75, aliases: ['pickles'] },
    'ice cube': { grams: 30, confidence: 0.85, aliases: ['ice cubes', 'ice'] },
};

// Build lookup map with aliases
const ALIAS_MAP = new Map<string, string>();
for (const [key, value] of Object.entries(COUNT_DEFAULTS)) {
    ALIAS_MAP.set(key.toLowerCase(), key);
    if (value.aliases) {
        for (const alias of value.aliases) {
            ALIAS_MAP.set(alias.toLowerCase(), key);
        }
    }
}

// ============================================================
// Main Function
// ============================================================

/**
 * Get default grams for a count-based serving.
 * 
 * @param foodName - The food name to look up
 * @param unit - The unit (typically "each", "piece", or count)
 * @param size - Optional size qualifier
 * @returns Default weight info or null if not found
 * 
 * @example
 * getDefaultCountServing("egg", "each") // → { grams: 50, confidence: 0.95, source: 'seed' }
 * getDefaultCountServing("banana", "each", "medium") // → { grams: 118, confidence: 0.95, source: 'seed' }
 * getDefaultCountServing("tortilla", "each", "small") // → { grams: 25, confidence: 0.8, source: 'seed' }
 */
export function getDefaultCountServing(
    foodName: string,
    unit: string,
    size?: 'small' | 'medium' | 'large'
): CountDefault | null {
    const nameLower = foodName.toLowerCase().trim();

    // Find the canonical key
    let canonicalKey = ALIAS_MAP.get(nameLower);

    // If not found directly, try partial matching
    if (!canonicalKey) {
        // Try matching the last word (usually the ingredient)
        const words = nameLower.split(/\s+/);
        const lastWord = words[words.length - 1];
        canonicalKey = ALIAS_MAP.get(lastWord);

        // Try last two words
        if (!canonicalKey && words.length >= 2) {
            const lastTwo = words.slice(-2).join(' ');
            canonicalKey = ALIAS_MAP.get(lastTwo);
        }
    }

    if (!canonicalKey) return null;

    const entry = COUNT_DEFAULTS[canonicalKey];
    if (!entry) return null;

    // Get gram weight based on size
    let grams = entry.grams;
    if (size && entry.sizes?.[size]) {
        grams = entry.sizes[size];
    }

    return {
        grams,
        confidence: entry.confidence,
        source: 'seed',
    };
}

/**
 * Check if a food name has default count data available.
 */
export function hasDefaultCountData(foodName: string): boolean {
    const nameLower = foodName.toLowerCase().trim();
    return ALIAS_MAP.has(nameLower);
}

/**
 * Get all available size variants for a food.
 */
export function getDefaultSizes(foodName: string): {
    small?: number;
    medium?: number;
    large?: number;
} | null {
    const nameLower = foodName.toLowerCase().trim();
    const canonicalKey = ALIAS_MAP.get(nameLower);
    if (!canonicalKey) return null;

    const entry = COUNT_DEFAULTS[canonicalKey];
    return entry?.sizes || null;
}
