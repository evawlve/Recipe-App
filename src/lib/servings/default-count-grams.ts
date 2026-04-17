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
    'lime': { grams: 67, confidence: 0.85, aliases: ['limes', 'lime juice'] },
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
    'grape tomato': { grams: 5, confidence: 0.85, sizes: { small: 4, medium: 5, large: 7 }, aliases: ['grape tomatoes'] },
    'cherry tomato': { grams: 17, confidence: 0.85, sizes: { small: 12, medium: 17, large: 22 }, aliases: ['cherry tomatoes'] },
    'onion': { grams: 150, confidence: 0.85, sizes: { small: 70, medium: 150, large: 225 }, aliases: ['onions'] },
    'carrot': { grams: 72, confidence: 0.85, sizes: { small: 50, medium: 72, large: 85 }, aliases: ['carrots'] },
    'baby carrot': { grams: 10, confidence: 0.85, aliases: ['baby carrots', 'baby cut carrots', 'baby-cut carrots'] },
    'celery stalk': { grams: 40, confidence: 0.85, aliases: ['celery stalks', 'celery'] },
    'cucumber': { grams: 301, confidence: 0.85, aliases: ['cucumbers'] },
    'persian cucumber': { grams: 60, confidence: 0.85, sizes: { small: 40, medium: 60, large: 90 }, aliases: ['persian cucumbers', 'mini cucumber', 'mini cucumbers', 'baby cucumber', 'baby cucumbers'] },
    'bell pepper': { grams: 164, confidence: 0.85, sizes: { small: 119, medium: 164, large: 186 }, aliases: ['bell peppers', 'pepper', 'peppers'] },
    'poblano pepper': { grams: 65, confidence: 0.85, aliases: ['poblano peppers', 'poblano'] },
    'anaheim pepper': { grams: 45, confidence: 0.85, aliases: ['anaheim peppers', 'anaheim chili', 'anaheim chile'] },
    'leek': { grams: 89, confidence: 0.85, aliases: ['leeks'] },
    'lettuce leaf': { grams: 15, confidence: 0.85, aliases: ['lettuce leaves', 'lettuce'] },
    'lettuce head': { grams: 500, confidence: 0.85, aliases: ['lettuce heads'] },
    'garlic clove': { grams: 3, confidence: 0.9, aliases: ['garlic cloves', 'clove garlic'] },
    'mushroom': { grams: 18, confidence: 0.8, aliases: ['mushrooms'] },
    'zucchini': { grams: 196, confidence: 0.85, sizes: { small: 118, medium: 196, large: 323 }, aliases: ['zucchinis', 'courgette'] },
    'broccoli floret': { grams: 11, confidence: 0.75, aliases: ['broccoli florets'] },
    'cauliflower floret': { grams: 13, confidence: 0.75, aliases: ['cauliflower florets'] },
    'corn ear': { grams: 103, confidence: 0.85, sizes: { small: 77, medium: 103, large: 127 }, aliases: ['corn on the cob', 'ear of corn'] },
    // THIN/LIGHT produce - important to have small weights
    'scallion': { grams: 15, confidence: 0.9, sizes: { small: 10, medium: 15, large: 25 }, aliases: ['scallions'] },
    'green onion': { grams: 15, confidence: 0.9, sizes: { small: 10, medium: 15, large: 25 }, aliases: ['green onions'] },
    'spring onion': { grams: 15, confidence: 0.9, sizes: { small: 10, medium: 15, large: 25 }, aliases: ['spring onions'] },
    'mint': { grams: 30, confidence: 0.85, aliases: ['fresh mint', 'mint bunch'] },
    'cilantro': { grams: 30, confidence: 0.85, aliases: ['fresh cilantro', 'cilantro bunch'] },
    'parsley': { grams: 30, confidence: 0.85, aliases: ['fresh parsley', 'parsley bunch'] },
    'basil': { grams: 30, confidence: 0.85, aliases: ['fresh basil', 'basil bunch'] },
    'thyme': { grams: 15, confidence: 0.85, aliases: ['fresh thyme', 'thyme bunch'] },
    'rosemary': { grams: 15, confidence: 0.85, aliases: ['fresh rosemary', 'rosemary bunch'] },

    // ===== BREAD & BAKED GOODS =====
    'bread slice': { grams: 30, confidence: 0.85, aliases: ['slice bread', 'bread'] },
    'tortilla': { grams: 45, confidence: 0.8, sizes: { small: 25, medium: 45, large: 70 }, aliases: ['tortillas'] },
    'english muffin': { grams: 57, confidence: 0.85, aliases: ['english muffins'] },
    'bagel': { grams: 98, confidence: 0.8, sizes: { small: 71, medium: 98, large: 131 }, aliases: ['bagels'] },
    'croissant': { grams: 57, confidence: 0.8, sizes: { small: 40, medium: 57, large: 67 }, aliases: ['croissants'] },
    'pancake': { grams: 38, confidence: 0.75, aliases: ['pancakes', 'hotcake'] },
    'waffle': { grams: 75, confidence: 0.8, aliases: ['waffles'] },
    'muffin': { grams: 113, confidence: 0.75, sizes: { small: 66, medium: 113, large: 139 }, aliases: ['muffins'] },
    'wonton wrapper': { grams: 7, confidence: 0.85, aliases: ['wonton wrappers', 'wonton skin', 'wonton skins', 'wonton wrap'] },

    // ===== DAIRY & CHEESE =====
    'cheese slice': { grams: 21, confidence: 0.85, aliases: ['slice cheese', 'american cheese slice', 'mozzarella slice', 'slice mozzarella', 'provolone slice', 'slice provolone'] },
    'cheese stick': { grams: 28, confidence: 0.85, aliases: ['string cheese', 'cheese sticks'] },

    // ===== MEAT & PROTEIN =====
    'ham slice': { grams: 25, confidence: 0.85, aliases: ['slice ham', 'deli ham slice', 'sliced ham'] },
    'chicken breast': { grams: 174, confidence: 0.85, sizes: { small: 140, medium: 174, large: 225 }, aliases: ['chicken breasts', 'breast', 'breasts'] },
    'chicken thigh': { grams: 116, confidence: 0.85, aliases: ['chicken thighs'] },
    'chicken wing': { grams: 34, confidence: 0.85, aliases: ['chicken wings', 'wing'] },
    'chicken skin': { grams: 15, confidence: 0.85, aliases: ['chicken skins', 'skin'] },
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
    'sweetener packet': { grams: 1, confidence: 0.9, aliases: [
        'packet sweetener', 'sweetener packets', 'splenda packet',
        // Bare-name aliases: "1 packet sweetener" often parses as foodName=sweetener, unit=packet
        'sweetener', 'splenda', 'sucralose', 'stevia packet', 'aspartame packet',
    ] },
    'ketchup packet': { grams: 9, confidence: 0.85, aliases: ['packet ketchup'] },
    'mustard packet': { grams: 5, confidence: 0.85, aliases: ['packet mustard', 'mustard'] },
    'mayonnaise packet': { grams: 12, confidence: 0.85, aliases: ['mayo packet', 'packet mayo'] },
    'butter pat': { grams: 5, confidence: 0.9, aliases: ['pat butter', 'pat of butter'] },

    // ===== PANTRY DEFAULTS (High Frequency) =====
    'garlic salt teaspoon': { grams: 6, confidence: 0.95, aliases: ['tsp garlic salt', 'garlic salt tsp'] },
    'garlic salt tbsp': { grams: 18, confidence: 0.95, aliases: ['tablespoon garlic salt', 'garlic salt tablespoon'] },
    'omega blended cooking oil tablespoon': { grams: 14, confidence: 0.95, aliases: ['tbsp omega blended cooking oil', 'omega blended cooking oil tbsp', 'omega blended cooking oil tablespoon'] },
    'omega blended cooking oil teaspoon': { grams: 4.7, confidence: 0.95, aliases: ['tsp omega blended cooking oil', 'omega blended cooking oil tsp', 'omega blended cooking oil teaspoon'] },

    // ===== STOCK & BOUILLON =====
    'bouillon cube': { grams: 4, confidence: 0.9, aliases: ['stock cube', 'broth cube', 'bullion cube'] },

    // ===== OTHER COMMON ITEMS =====
    'cookie': { grams: 30, confidence: 0.7, sizes: { small: 15, medium: 30, large: 45 }, aliases: ['cookies'] },
    'cracker': { grams: 4, confidence: 0.75, aliases: ['crackers'] },
    'olive': { grams: 4, confidence: 0.8, sizes: { small: 3, medium: 4, large: 5 }, aliases: ['olives'] },
    'kalamata olive': { grams: 4, confidence: 0.8, sizes: { small: 3, medium: 4, large: 5 }, aliases: ['kalamata olives', 'kalamata'] },
    'pickle': { grams: 35, confidence: 0.75, aliases: ['pickles'] },
    'ice cube': { grams: 30, confidence: 0.85, aliases: ['ice cubes', 'ice'] },
    'spray': { grams: 0.25, confidence: 0.9, aliases: ['sprays', 'squirt', 'squirts'] },
    // Cooking spray duration: 1 second of spray ≈ 0.25g oil
    'second': { grams: 0.25, confidence: 0.85, aliases: ['seconds'] },

    // ===== SUPPLEMENTS & POWDERS =====
    'protein powder scoop': { grams: 30, confidence: 0.9, aliases: ['scoop protein powder', 'protein scoop'] },
    'whey protein scoop': { grams: 30, confidence: 0.9, aliases: ['scoop whey protein', 'whey scoop'] },
    'whey protein isolate scoop': { grams: 30, confidence: 0.9, aliases: ['scoop whey isolate', 'isolate scoop'] },
    'collagen scoop': { grams: 11, confidence: 0.85, aliases: ['scoop collagen', 'collagen powder scoop'] },
    'creatine scoop': { grams: 5, confidence: 0.9, aliases: ['scoop creatine'] },
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
    // Sub-piece units (chunk, bite, strip) represent CUT portions of a food item.
    // Seed data has whole-item weights (e.g., mango = 336g) which would be wrong
    // for "14 mango chunks" (~12g each). Skip defaults and let LLM estimate.
    const SUB_PIECE_UNITS = new Set(['chunk', 'chunks', 'bite', 'bites', 'strip', 'strips', 'wedge', 'wedges', 'segment', 'segments']);
    if (SUB_PIECE_UNITS.has(unit.toLowerCase().trim())) {
        return null;
    }

    const nameLower = foodName.toLowerCase().trim();
    const unitLower = (unit || '').toLowerCase().trim();

    // Find the canonical key using combined name + unit first (for specific unit overrides like "garlic salt tbsp")
    let canonicalKey = ALIAS_MAP.get(`${nameLower} ${unitLower}`) || ALIAS_MAP.get(nameLower);

    // If not found directly, try partial matching
    // IMPORTANT: Try LONGER matches first! "organic grape tomatoes" should match
    // "grape tomato" (5g) not "tomato" (123g). Checking last-word first would
    // match "tomatoes" → "tomato" and miss the more specific "grape tomato" entry.
    if (!canonicalKey) {
        const words = nameLower.split(/\s+/);

        // Try last two words first (more specific: "grape tomatoes" → "grape tomato")
        if (words.length >= 2) {
            const lastTwo = words.slice(-2).join(' ');
            canonicalKey = ALIAS_MAP.get(lastTwo);
        }

        // Then try last word only (less specific: "tomatoes" → "tomato")
        if (!canonicalKey) {
            const lastWord = words[words.length - 1];
            canonicalKey = ALIAS_MAP.get(lastWord);
        }
    }

    // If no match found by food name, check if the unit itself has a default (e.g., 'spray', 'second')
    if (!canonicalKey && unit) {
        canonicalKey = ALIAS_MAP.get(unit.toLowerCase().trim());
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

// ============================================================
// Sub-Piece Defaults
// ============================================================

/**
 * Typical weight fraction for sub-piece units relative to whole-food weight.
 * A "chunk" of mango (~336g whole) is roughly 1/16 of the fruit (~20g).
 */
const SUB_PIECE_FRACTIONS: Record<string, number> = {
    'chunk': 0.06,    // ~1/16 of whole (mango chunk ~20g, apple chunk ~11g)
    'chunks': 0.06,
    'bite': 0.04,     // ~1/25 of whole
    'bites': 0.04,
    'wedge': 0.125,   // ~1/8 of whole (lemon wedge ~7g, apple wedge ~23g)
    'wedges': 0.125,
    'slice': 0.05,    // ~1/20 of whole
    'slices': 0.05,
    'strip': 0.03,    // ~1/33 of whole
    'strips': 0.03,
    'segment': 0.08,  // ~1/12 of whole (orange segment ~11g)
    'segments': 0.08,
    'sprig': 0.1,     // ~1/10 of bunch for herbs
    'sprigs': 0.1,
    'leaf': 0.02,     // ~1/50 of bunch for herbs
    'leaves': 0.02,
};

/**
 * Get default grams for a sub-piece unit (chunk, bite, wedge, strip, segment).
 * 
 * Derives per-piece weight as a fraction of the whole-food weight from seed data.
 * Used as a deterministic fallback before expensive & unreliable AI estimation.
 *
 * @example
 * getSubPieceDefault("mango", "chunk")   // → { grams: 20, confidence: 0.7, source: 'derived' }
 * getSubPieceDefault("apple", "wedge")   // → { grams: 23, confidence: 0.7, source: 'derived' }
 * getSubPieceDefault("unknown", "chunk") // → null
 */
export function getSubPieceDefault(
    foodName: string,
    subUnit: string
): CountDefault | null {
    const fraction = SUB_PIECE_FRACTIONS[subUnit.toLowerCase().trim()];
    if (fraction == null) return null;

    // Find the parent food's whole weight using "each" lookup
    // (passes through the existing alias/partial-match logic)
    const wholeFoodDefault = getDefaultCountServing(foodName, 'each');
    if (!wholeFoodDefault) return null;

    const grams = Math.max(1, Math.round(wholeFoodDefault.grams * fraction));

    return {
        grams,
        confidence: 0.7,  // Lower confidence since it's a proportion estimate
        source: 'derived',
    };
}
