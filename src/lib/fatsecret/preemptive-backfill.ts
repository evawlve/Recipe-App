/**
 * Pre-emptive Backfill for Modifier-Aware Servings
 * 
 * Generates common category-specific servings with prep modifiers
 * (e.g., produce gets "cup cubed/sliced/diced", aromatics get "tbsp minced")
 * 
 * Works for both FatSecret and FDC food sources.
 */

import { logger } from '../logger';
import { insertAiServing, type InsertAiServingOptions } from './ai-backfill';

// ============================================================
// Category-to-Serving Mappings
// ============================================================

export interface PreemptiveServing {
    unit: string;           // e.g., "cup", "tbsp"
    modifier?: string;      // e.g., "cubed", "minced"
    priority: number;       // Lower = more important (generated first)
}

/**
 * Category-specific serving definitions.
 * Each category defines common volume/count servings that should be pre-generated.
 */
export const CATEGORY_PREEMPTIVE_SERVINGS: Record<string, PreemptiveServing[]> = {
    // Fruits & Vegetables (solid produce that can be prepped)
    produce: [
        { unit: 'cup', modifier: 'chopped', priority: 1 },
        { unit: 'cup', modifier: 'diced', priority: 2 },
        { unit: 'cup', modifier: 'cubed', priority: 3 },
        { unit: 'cup', modifier: 'sliced', priority: 4 },
        { unit: 'cup', priority: 5 },  // base without modifier
    ],

    // Aromatics (garlic, onion, ginger, shallots)
    aromatics: [
        { unit: 'tbsp', modifier: 'minced', priority: 1 },
        { unit: 'tsp', modifier: 'minced', priority: 2 },
        { unit: 'tbsp', modifier: 'chopped', priority: 3 },
        { unit: 'clove', priority: 4 },  // garlic-specific
        { unit: 'tbsp', modifier: 'grated', priority: 5 },  // ginger-specific
    ],

    // Leafy greens (volume varies dramatically by prep)
    greens: [
        { unit: 'cup', modifier: 'chopped', priority: 1 },
        { unit: 'cup', modifier: 'packed', priority: 2 },
        { unit: 'cup', priority: 3 },  // loose leaves
    ],

    // Cheese
    cheese: [
        { unit: 'cup', modifier: 'shredded', priority: 1 },
        { unit: 'tbsp', modifier: 'grated', priority: 2 },
        { unit: 'cup', modifier: 'cubed', priority: 3 },
        { unit: 'oz', priority: 4 },
        { unit: 'slice', priority: 5 },
    ],

    // Proteins (count-based, sometimes cubed for stir-fry)
    proteins: [
        { unit: 'oz', priority: 1 },
        { unit: 'piece', priority: 2 },
        { unit: 'cup', modifier: 'cubed', priority: 3 },
        { unit: 'cup', modifier: 'shredded', priority: 4 },
    ],

    // Liquids (no modifiers needed)
    liquids: [
        { unit: 'cup', priority: 1 },
        { unit: 'tbsp', priority: 2 },
        { unit: 'tsp', priority: 3 },
        { unit: 'ml', priority: 4 },
    ],

    // Powders/Spices (no modifiers needed)
    powders: [
        { unit: 'tbsp', priority: 1 },
        { unit: 'tsp', priority: 2 },
    ],

    // Nuts and seeds
    nuts: [
        { unit: 'cup', modifier: 'chopped', priority: 1 },
        { unit: 'cup', priority: 2 },  // whole
        { unit: 'tbsp', priority: 3 },
        { unit: 'oz', priority: 4 },
    ],

    // Herbs (fresh)
    herbs: [
        { unit: 'tbsp', modifier: 'chopped', priority: 1 },
        { unit: 'tsp', modifier: 'minced', priority: 2 },
        { unit: 'cup', modifier: 'packed', priority: 3 },
        { unit: 'sprig', priority: 4 },
    ],

    // Snacks (chips, crackers, pretzels, popcorn, etc.)
    snacks: [
        { unit: 'cup', priority: 1 },
        { unit: 'oz', priority: 2 },
        { unit: 'piece', priority: 3 },
        { unit: 'serving', priority: 4 },
    ],
};

// ============================================================
// Food Name to Category Detection
// ============================================================

interface CategoryPattern {
    category: string;
    patterns: RegExp[];
}

const CATEGORY_PATTERNS: CategoryPattern[] = [
    {
        category: 'aromatics',
        patterns: [
            /\bgarlic\b/i,
            /\bonion\b/i,
            /\bshallot\b/i,
            /\bginger\b/i,
            /\bleek\b/i,
            /\bscallion\b/i,
            /\bgreen onion\b/i,
            /\bchive\b/i,
        ],
    },
    {
        category: 'greens',
        patterns: [
            /\bspinach\b/i,
            /\bkale\b/i,
            /\blettuce\b/i,
            /\barugula\b/i,
            /\bchard\b/i,
            /\bcollard\b/i,
            /\bmustard green\b/i,
            /\bbok choy\b/i,
            /\bcabbage\b/i,
        ],
    },
    {
        category: 'cheese',
        patterns: [
            /\bcheese\b/i,
            /\bcheddar\b/i,
            /\bmozzarella\b/i,
            /\bparmesan\b/i,
            /\bfeta\b/i,
            /\bgouda\b/i,
            /\bbrie\b/i,
            /\bcamembert\b/i,
            /\bricotta\b/i,
        ],
    },
    {
        category: 'proteins',
        patterns: [
            /\bchicken\b/i,
            /\bbeef\b/i,
            /\bpork\b/i,
            /\bturkey\b/i,
            /\blamb\b/i,
            /\bfish\b/i,
            /\bsalmon\b/i,
            /\btuna\b/i,
            /\bshrimp\b/i,
            /\btofu\b/i,
            /\btempeh\b/i,
            /\bsteak\b/i,
            /\bbreast\b/i,
            /\bthigh\b/i,
            /\bfillet\b/i,
        ],
    },
    {
        category: 'liquids',
        patterns: [
            /\bmilk\b/i,
            /\bwater\b/i,
            /\bjuice\b/i,
            /\bbroth\b/i,
            /\bstock\b/i,
            /\boil\b/i,
            /\bvinegar\b/i,
            /\bsauce\b/i,
            /\bwine\b/i,
            /\bcream\b/i,
        ],
    },
    {
        category: 'powders',
        patterns: [
            /\bflour\b/i,
            /\bsugar\b/i,
            /\bpowder\b/i,
            /\bcocoa\b/i,
            /\bcinnamon\b/i,
            /\bpaprika\b/i,
            /\bcumin\b/i,
            /\bturmeric\b/i,
            /\bspice\b/i,
            /\bsalt\b/i,
            /\bpepper\b/i,
        ],
    },
    {
        category: 'nuts',
        patterns: [
            /\balmond\b/i,
            /\bwalnut\b/i,
            /\bpecan\b/i,
            /\bcashew\b/i,
            /\bpeanut\b/i,
            /\bpistachio\b/i,
            /\bhazelnut\b/i,
            /\bseed\b/i,
            /\bsesame\b/i,
            /\bsunflower\b/i,
            /\bpumpkin seed\b/i,
        ],
    },
    {
        category: 'herbs',
        patterns: [
            /\bbasil\b/i,
            /\bparsley\b/i,
            /\bcilantro\b/i,
            /\bmint\b/i,
            /\brosemary\b/i,
            /\bthyme\b/i,
            /\boregano\b/i,
            /\bdill\b/i,
            /\bsage\b/i,
            /\btarragon\b/i,
        ],
    },
    {
        category: 'snacks',
        patterns: [
            /\bchip\b/i,
            /\bchips\b/i,
            /\btortilla chip\b/i,
            /\bpotato chip\b/i,
            /\bcracker\b/i,
            /\bcrackers\b/i,
            /\bpretzel\b/i,
            /\bpopcorn\b/i,
            /\bnachos\b/i,
            /\bcheeto\b/i,
            /\bdorito\b/i,
            /\bcorn chip\b/i,
            /\bgranola bar\b/i,
            /\benergy bar\b/i,
            /\bprotein bar\b/i,
            /\brice cake\b/i,
            /\bpita chip\b/i,
            /\bbagel chip\b/i,
        ],
    },
    {
        category: 'produce',
        patterns: [
            /\bapple\b/i,
            /\bpotato\b/i,
            /\bcarrot\b/i,
            /\btomato\b/i,
            /\bpepper\b/i,
            /\bcucumber\b/i,
            /\bzucchini\b/i,
            /\bsquash\b/i,
            /\bpumpkin\b/i,
            /\bcelery\b/i,
            /\bbroccoli\b/i,
            /\bcauliflower\b/i,
            /\beggplant\b/i,
            /\bmushroom\b/i,
            /\bbean\b/i,
            /\bpea\b/i,
            /\bcorn\b/i,
            /\basparagus\b/i,
            /\bfruit\b/i,
            /\bvegetable\b/i,
            /\bberr/i,  // berry, berries
            /\bmelon\b/i,
            /\bmango\b/i,
            /\bpineapple\b/i,
            /\bbanana\b/i,
            /\borange\b/i,
            /\blemon\b/i,
            /\blime\b/i,
            /\bgrape\b/i,
            /\bpeach\b/i,
            /\bpear\b/i,
            /\bplum\b/i,
            /\bavocado\b/i,
        ],
    },
];

/**
 * Detect the food category from the food name.
 * Returns the most specific matching category.
 */
export function detectFoodCategory(foodName: string): string | null {
    const lowerName = foodName.toLowerCase();

    for (const { category, patterns } of CATEGORY_PATTERNS) {
        for (const pattern of patterns) {
            if (pattern.test(lowerName)) {
                return category;
            }
        }
    }

    return null;
}

// ============================================================
// Pre-emptive Backfill Functions
// ============================================================

export interface PreemptiveBackfillResult {
    foodId: string;
    category: string | null;
    servingsGenerated: number;
    servingsFailed: number;
    details: Array<{
        serving: string;
        success: boolean;
        reason?: string;
    }>;
}

/**
 * Generate pre-emptive modifier-aware servings for a food item.
 * 
 * @param foodId - FatSecret or FDC food ID (FDC IDs should be prefixed with "fdc_")
 * @param foodName - Name of the food (used to detect category)
 * @param options - Additional options
 * @returns Results of the backfill operation
 */
export async function generatePreemptiveServings(
    foodId: string,
    foodName: string,
    options: {
        maxServings?: number;
        dryRun?: boolean;
        specificCategory?: string;
    } = {}
): Promise<PreemptiveBackfillResult> {
    const { maxServings = 3, dryRun = false, specificCategory } = options;

    const category = specificCategory ?? detectFoodCategory(foodName);
    const result: PreemptiveBackfillResult = {
        foodId,
        category,
        servingsGenerated: 0,
        servingsFailed: 0,
        details: [],
    };

    if (!category) {
        logger.debug('No category detected for preemptive backfill', { foodId, foodName });
        return result;
    }

    const servingDefs = CATEGORY_PREEMPTIVE_SERVINGS[category];
    if (!servingDefs || servingDefs.length === 0) {
        logger.debug('No preemptive servings defined for category', { foodId, category });
        return result;
    }

    // Sort by priority and take top N
    const sortedServings = [...servingDefs].sort((a, b) => a.priority - b.priority);
    const servingsToGenerate = sortedServings.slice(0, maxServings);

    for (const servingDef of servingsToGenerate) {
        const servingLabel = servingDef.modifier
            ? `${servingDef.unit} ${servingDef.modifier}`
            : servingDef.unit;

        const aiOptions: InsertAiServingOptions = {
            dryRun,
            targetServingUnit: servingDef.unit,
            prepModifier: servingDef.modifier,
            isOnDemandBackfill: false,  // Pre-emptive = higher confidence threshold
        };

        try {
            const aiResult = await insertAiServing(foodId, 'volume', aiOptions);

            result.details.push({
                serving: servingLabel,
                success: aiResult.success,
                reason: aiResult.reason,
            });

            if (aiResult.success) {
                result.servingsGenerated++;
            } else {
                result.servingsFailed++;
            }
        } catch (error) {
            result.details.push({
                serving: servingLabel,
                success: false,
                reason: (error as Error).message,
            });
            result.servingsFailed++;
        }
    }

    logger.info(
        'Completed preemptive backfill',
        {
            foodId,
            foodName,
            category,
            generated: result.servingsGenerated,
            failed: result.servingsFailed,
        },
    );

    return result;
}

// ============================================================
// Modifier Extraction from Parsed Ingredients
// ============================================================

/**
 * Known prep modifiers that affect serving density.
 * Ordered by specificity (longer phrases first).
 */
export const KNOWN_PREP_MODIFIERS = [
    // Compound modifiers (check first)
    'finely chopped',
    'finely diced',
    'finely minced',
    'coarsely chopped',
    'roughly chopped',
    'thinly sliced',
    'thickly sliced',
    // Single modifiers
    'cubed',
    'diced',
    'sliced',
    'chopped',
    'minced',
    'grated',
    'shredded',
    'mashed',
    'pureed',
    'crushed',
    'julienned',
    'packed',
    'crumbled',
    'torn',
    'halved',
    'quartered',
];

/**
 * Extract prep modifier from an ingredient line or parsed modifiers array.
 * Returns the first matching known modifier.
 */
export function extractPrepModifier(
    rawLine: string,
    parsedModifiers?: string[]
): string | undefined {
    // First check parsed modifiers if available
    if (parsedModifiers && parsedModifiers.length > 0) {
        for (const modifier of parsedModifiers) {
            const lower = modifier.toLowerCase();
            if (KNOWN_PREP_MODIFIERS.includes(lower)) {
                // Simplify compound modifiers to base form
                if (lower.includes('chopped')) return 'chopped';
                if (lower.includes('diced')) return 'diced';
                if (lower.includes('minced')) return 'minced';
                if (lower.includes('sliced')) return 'sliced';
                return lower;
            }
        }
    }

    // Fall back to scanning the raw line
    const lowerLine = rawLine.toLowerCase();
    for (const modifier of KNOWN_PREP_MODIFIERS) {
        if (lowerLine.includes(modifier)) {
            // Simplify compound modifiers to base form
            if (modifier.includes('chopped')) return 'chopped';
            if (modifier.includes('diced')) return 'diced';
            if (modifier.includes('minced')) return 'minced';
            if (modifier.includes('sliced')) return 'sliced';
            return modifier;
        }
    }

    return undefined;
}

/**
 * Check if a serving description already includes the given modifier.
 */
export function servingHasModifier(servingDescription: string, modifier: string): boolean {
    return servingDescription.toLowerCase().includes(modifier.toLowerCase());
}

/**
 * Find a serving that matches both unit and modifier.
 * Returns null if not found.
 */
export function findServingWithModifier<T extends { description?: string | null; measurementDescription?: string | null }>(
    servings: T[],
    unit: string,
    modifier?: string
): T | null {
    const targetLabel = modifier ? `${unit} ${modifier}` : unit;
    const targetLabelAlt = modifier ? `${modifier} ${unit}` : unit;  // Some labels might be "minced tbsp"

    for (const serving of servings) {
        const desc = (serving.description ?? serving.measurementDescription ?? '').toLowerCase();
        if (desc.includes(targetLabel.toLowerCase()) || desc.includes(targetLabelAlt.toLowerCase())) {
            return serving;
        }
    }

    // If no modifier match, try just the unit as fallback
    if (modifier) {
        for (const serving of servings) {
            const desc = (serving.description ?? serving.measurementDescription ?? '').toLowerCase();
            if (desc.includes(unit.toLowerCase()) && !desc.includes(modifier.toLowerCase())) {
                // Found unit without modifier - could be used as fallback
                return null;  // Return null to trigger on-demand backfill
            }
        }
    }

    return null;
}


