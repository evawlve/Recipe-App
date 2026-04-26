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
    unit: string;           // e.g., "cup", "tbsp", "chip", "cookie"
    modifier?: string;      // e.g., "cubed", "minced"
    priority: number;       // Lower = more important (generated first)
    /**
     * Override gap type for this specific serving.
     * Defaults to 'volume'. Use 'count' for label-style count-based servings
     * (e.g., "13 chips", "3 crackers", "1 slice").
     */
    gapType?: 'volume' | 'count';
}

/**
 * Category-specific serving definitions.
 * Each category defines common volume/count servings that should be pre-generated.
 */
export const CATEGORY_PREEMPTIVE_SERVINGS: Record<string, PreemptiveServing[]> = {
    // ─── Fresh Produce ──────────────────────────────────────────
    // Fruits & Vegetables (solid produce that can be prepped)
    produce: [
        { unit: 'cup', modifier: 'chopped', priority: 1 },
        { unit: 'cup', modifier: 'diced', priority: 2 },
        { unit: 'cup', modifier: 'cubed', priority: 3 },
        { unit: 'cup', modifier: 'sliced', priority: 4 },
        { unit: 'cup', priority: 5 },
    ],

    // Aromatics (garlic, onion, ginger, shallots)
    aromatics: [
        { unit: 'tbsp', modifier: 'minced', priority: 1 },
        { unit: 'tsp', modifier: 'minced', priority: 2 },
        { unit: 'tbsp', modifier: 'chopped', priority: 3 },
        { unit: 'clove', priority: 4, gapType: 'count' },
        { unit: 'tbsp', modifier: 'grated', priority: 5 },
    ],

    // Leafy greens
    greens: [
        { unit: 'cup', modifier: 'chopped', priority: 1 },
        { unit: 'cup', modifier: 'packed', priority: 2 },
        { unit: 'cup', priority: 3 },
    ],

    // ─── Dairy ──────────────────────────────────────────────────
    // Hard/semi-hard cheese (cheddar, mozzarella, parmesan, etc.)
    cheese: [
        { unit: 'cup', modifier: 'shredded', priority: 1 },
        { unit: 'tbsp', modifier: 'grated', priority: 2 },
        { unit: 'oz', priority: 3 },
        { unit: 'slice', priority: 4, gapType: 'count' },
    ],

    // Soft cheese / yogurt / cream cheese (no shredding)
    soft_dairy: [
        { unit: 'cup', priority: 1 },
        { unit: 'tbsp', priority: 2 },
        { unit: 'oz', priority: 3 },
    ],

    // Packaged yogurt (single-serve containers)
    yogurt: [
        { unit: 'container', priority: 1, gapType: 'count' },
        { unit: 'cup', priority: 2 },
        { unit: 'oz', priority: 3 },
    ],

    // Ice cream / frozen desserts
    ice_cream: [
        { unit: 'cup', priority: 1 },
        { unit: 'tbsp', priority: 2 },
        { unit: 'scoop', priority: 3, gapType: 'count' },
    ],

    // ─── Proteins ───────────────────────────────────────────────
    // Whole-cut proteins (chicken breast, steak, fillet, etc.)
    proteins: [
        { unit: 'oz', priority: 1 },
        { unit: 'piece', priority: 2, gapType: 'count' },
        { unit: 'cup', modifier: 'cubed', priority: 3 },
        { unit: 'cup', modifier: 'shredded', priority: 4 },
    ],

    // Deli meats / cold cuts (per-slice label serving)
    deli_meat: [
        { unit: 'slice', priority: 1, gapType: 'count' },
        { unit: 'oz', priority: 2 },
        { unit: 'cup', modifier: 'chopped', priority: 3 },
    ],

    // ─── Grains & Carbs ─────────────────────────────────────────
    // Bread, rolls, buns, bagels, English muffins
    bread: [
        { unit: 'slice', priority: 1, gapType: 'count' },
        { unit: 'oz', priority: 2 },
    ],

    // Tortillas, wraps, pitas
    tortilla: [
        { unit: 'tortilla', priority: 1, gapType: 'count' },
        { unit: 'oz', priority: 2 },
    ],

    // Ready-to-eat cereal (dry)
    cereal: [
        { unit: 'cup', priority: 1 },          // "3/4 cup" is very common
        { unit: 'oz', priority: 2 },
    ],

    // Pasta, rice, grains (dry — volume when uncooked)
    grains_dry: [
        { unit: 'cup', priority: 1 },
        { unit: 'oz', priority: 2 },
    ],

    // Pasta, rice, grains (cooked — per cup cooked)
    grains_cooked: [
        { unit: 'cup', priority: 1 },
    ],

    // ─── Snacks & Packaged Foods ─────────────────────────────────
    // Chips, crisps, puffs — label says "X chips"
    chips: [
        { unit: 'chip', priority: 1, gapType: 'count' },   // AI knows "13 chips = 28g"
        { unit: 'oz', priority: 2 },
        { unit: 'cup', priority: 3 },
    ],

    // Crackers — label says "X crackers"
    crackers: [
        { unit: 'cracker', priority: 1, gapType: 'count' },
        { unit: 'oz', priority: 2 },
    ],

    // Cookies — label says "X cookies"
    cookies: [
        { unit: 'cookie', priority: 1, gapType: 'count' },
        { unit: 'oz', priority: 2 },
    ],

    // Pretzels, popcorn, puffs
    snacks: [
        { unit: 'cup', priority: 1 },
        { unit: 'oz', priority: 2 },
        { unit: 'piece', priority: 3, gapType: 'count' },
    ],

    // Granola / energy bars — label says "1 bar"
    bars: [
        { unit: 'bar', priority: 1, gapType: 'count' },
        { unit: 'oz', priority: 2 },
    ],

    // Candy, chocolate pieces
    candy: [
        { unit: 'piece', priority: 1, gapType: 'count' },
        { unit: 'oz', priority: 2 },
        { unit: 'cup', priority: 3 },
    ],

    // ─── Condiments & Liquids ────────────────────────────────────
    // Sauces, dressings, ketchup, mustard, mayo, syrup, honey
    condiments: [
        { unit: 'tbsp', priority: 1 },
        { unit: 'tsp', priority: 2 },
        { unit: 'cup', priority: 3 },
    ],

    // Oils (dense liquids — tbsp is standard)
    oils: [
        { unit: 'tbsp', priority: 1 },
        { unit: 'tsp', priority: 2 },
        { unit: 'cup', priority: 3 },
    ],

    // Beverages (juice, soda, sports drinks, water)
    beverages: [
        { unit: 'cup', priority: 1 },           // 8 fl oz / 240ml
        { unit: 'fl oz', priority: 2 },
        { unit: 'ml', priority: 3 },
    ],

    // Powders/Spices
    powders: [
        { unit: 'tbsp', priority: 1 },
        { unit: 'tsp', priority: 2 },
    ],

    // ─── Other ──────────────────────────────────────────────────
    // Nuts and seeds
    nuts: [
        { unit: 'cup', modifier: 'chopped', priority: 1 },
        { unit: 'cup', priority: 2 },
        { unit: 'tbsp', priority: 3 },
        { unit: 'oz', priority: 4 },
    ],

    // Dried fruit (raisins, cranberries, dates)
    dried_fruit: [
        { unit: 'cup', priority: 1 },
        { unit: 'tbsp', priority: 2 },
        { unit: 'oz', priority: 3 },
    ],

    // Fresh herbs
    herbs: [
        { unit: 'tbsp', modifier: 'chopped', priority: 1 },
        { unit: 'tsp', modifier: 'minced', priority: 2 },
        { unit: 'cup', modifier: 'packed', priority: 3 },
        { unit: 'sprig', priority: 4, gapType: 'count' },
    ],

    // Frozen / prepared meals — label says "1 meal" or "1 package"
    frozen_meal: [
        { unit: 'meal', priority: 1, gapType: 'count' },
        { unit: 'cup', priority: 2 },
        { unit: 'oz', priority: 3 },
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
    // ── Specific snack types FIRST (before generic 'snacks') ──────
    {
        category: 'chips',
        patterns: [
            /\bchip\b/i, /\bchips\b/i,
            /\bdorito/i, /\bpringle/i, /\bfrito/i, /\bcheeto/i,
            /\btortilla chip/i, /\bpotato chip/i, /\bcorn chip/i,
            /\bpita chip/i, /\bbagel chip/i, /\bkettl/i,
        ],
    },
    {
        category: 'crackers',
        patterns: [
            /\bcracker\b/i, /\bcrackers\b/i,
            /\btriscuit/i, /\bwheat thin/i, /\britz\b/i,
            /\bgraham cracker/i, /\brice cake/i, /\bcrisp\b/i,
        ],
    },
    {
        category: 'cookies',
        patterns: [
            /\bcookie\b/i, /\bcookies\b/i,
            /\boreo/i, /\bnewton\b/i, /\bchips ahoy/i,
            /\bbrownies?\b/i, /\bwafer\b/i, /\bmacaroon/i,
        ],
    },
    {
        category: 'bars',
        patterns: [
            /\bgranola bar/i, /\benergy bar/i, /\bprotein bar/i,
            /\bclif bar/i, /\bnature valley/i, /\bnugget/i,
            /\bkind bar/i, /\bquest bar/i, /\blarabar/i,
        ],
    },
    {
        category: 'candy',
        patterns: [
            /\bcandy\b/i, /\bm&m/i, /\bm & m/i,
            /\bskittles/i, /\breeses/i, /\bsnickers/i,
            /\bstarburst/i, /\bgummy/i, /\bjelly bean/i,
            /\blicorice/i, /\bchocolate\b/i, /\btruffles?\b/i,
        ],
    },
    // ── Bread & grains ────────────────────────────────────────────
    {
        category: 'bread',
        patterns: [
            /\bbread\b/i, /\bbagel\b/i, /\benglish muffin/i,
            /\bbun\b/i, /\broll\b/i, /\bciabatta/i,
            /\bsourdough/i, /\bwhite bread/i, /\bwhole wheat/i,
            /\bmultigrain/i, /\bnaan\b/i, /\bflatbread/i,
        ],
    },
    {
        category: 'tortilla',
        patterns: [
            /\btortilla\b/i, /\bwrap\b/i, /\bpita\b/i,
            /\blavash/i, /\bflour tortilla/i, /\bcorn tortilla/i,
        ],
    },
    {
        category: 'cereal',
        patterns: [
            /\bcereal\b/i, /\bgranola\b/i,
            /\bcheerios/i, /\bfrosted flake/i, /\bcorn flake/i,
            /\bspecial k/i, /\bfruit loop/i, /\bkix\b/i,
            /\bcap'n crunch/i, /\bhoney bunch/i, /\bmuesli/i,
            /\boatmeal\b/i, /\binstant oat/i,
        ],
    },
    {
        category: 'grains_dry',
        patterns: [
            /\bpasta\b/i, /\bspaghetti\b/i, /\bpenne\b/i,
            /\bfusilli/i, /\brigatoni/i, /\bnoodle/i,
            /\brice\b/i, /\bquinoa\b/i, /\bcouscous/i,
            /\bbarley\b/i, /\bfarro\b/i, /\bbulgur/i,
            /\boats\b/i, /\brolled oat/i, /\bsteel[- ]cut/i,
        ],
    },
    // ── Dairy ─────────────────────────────────────────────────────
    {
        category: 'yogurt',
        patterns: [
            /\byogurt\b/i, /\byoghurt\b/i,
            /\bchobani/i, /\bfage\b/i, /\boikos/i,
            /\bskyr\b/i, /\bkefir\b/i,
        ],
    },
    {
        category: 'ice_cream',
        patterns: [
            /\bice cream\b/i, /\bgelato\b/i, /\bsorbet\b/i,
            /\bfrozen yogurt/i, /\bfro-yo/i,
            /\bhaagen-dazs/i, /\bben & jerry/i, /\btillamook/i,
        ],
    },
    {
        category: 'soft_dairy',
        patterns: [
            /\bcream cheese/i, /\bcottage cheese/i,
            /\bsour cream/i, /\bricotta\b/i, /\bquark\b/i,
            /\bmascarpone/i, /\blabneh/i,
        ],
    },
    {
        category: 'cheese',
        patterns: [
            /\bcheese\b/i, /\bcheddar\b/i, /\bmozzarella\b/i,
            /\bparmesan\b/i, /\bfeta\b/i, /\bgouda\b/i,
            /\bbrie\b/i, /\bcamembert\b/i, /\bgruyere/i,
            /\bmonterey jack/i, /\bcolby/i, /\bprovol/i,
        ],
    },
    // ── Proteins ──────────────────────────────────────────────────
    {
        category: 'deli_meat',
        patterns: [
            /\bham\b/i, /\bsalami\b/i, /\bpepperoni/i,
            /\bpastrami/i, /\bcorned beef/i, /\bturkey breast/i,
            /\bprosciutto/i, /\bdeli/i, /\bcold cut/i,
            /\bsausage\b/i, /\bbologne/i, /\bhot dog/i,
        ],
    },
    {
        category: 'proteins',
        patterns: [
            /\bchicken\b/i, /\bbeef\b/i, /\bpork\b/i,
            /\bturkey\b/i, /\blamb\b/i, /\bfish\b/i,
            /\bsalmon\b/i, /\btuna\b/i, /\bshrimp\b/i,
            /\btofu\b/i, /\btempeh\b/i, /\bsteak\b/i,
            /\bbreast\b/i, /\bthigh\b/i, /\bfillet\b/i,
        ],
    },
    // ── Condiments / Liquids ──────────────────────────────────────
    {
        category: 'oils',
        patterns: [
            /\boil\b/i, /\bolive oil/i, /\bcanola/i,
            /\bvegetable oil/i, /\bcoconut oil/i, /\bsesame oil/i,
        ],
    },
    {
        category: 'condiments',
        patterns: [
            /\bketchup/i, /\bmustard/i, /\bmayonnaise/i,
            /\bbbq sauce/i, /\bsoy sauce/i, /\bworcestershire/i,
            /\bhotsauce/i, /\bhot sauce/i, /\bsriracha/i,
            /\bdressing\b/i, /\bvinaigrette/i, /\bsalsa/i,
            /\bsauce\b/i, /\bsyrup\b/i, /\bhoney\b/i,
            /\bjam\b/i, /\bjelly\b/i, /\bpreserve/i,
            /\bhummus/i, /\bguacamole/i,
        ],
    },
    {
        category: 'beverages',
        patterns: [
            /\bjuice\b/i, /\bsoda\b/i, /\bpop\b/i,
            /\bcoca[- ]cola/i, /\bpepsi/i, /\bsprite/i,
            /\bsports drink/i, /\bgatorade/i, /\bpowerade/i,
            /\benergy drink/i, /\bred bull/i, /\bmonster\b/i,
            /\bkombucha/i, /\biced tea/i,
        ],
    },
    // ── Frozen meals ──────────────────────────────────────────────
    {
        category: 'frozen_meal',
        patterns: [
            /\bfrozen meal/i, /\bfrozen dinner/i, /\bmicrowave meal/i,
            /\bstouffe/i, /\bhealthy choice/i, /\blean cuisine/i,
            /\bbirdseye/i, /\bamys\b/i,
        ],
    },
    // ── Other ─────────────────────────────────────────────────────
    {
        category: 'aromatics',
        patterns: [
            /\bgarlic\b/i, /\bonion\b/i, /\bshallot\b/i,
            /\bginger\b/i, /\bleek\b/i, /\bscallion\b/i,
            /\bgreen onion/i, /\bchive\b/i,
        ],
    },
    {
        category: 'greens',
        patterns: [
            /\bspinach\b/i, /\bkale\b/i, /\blettuce\b/i,
            /\barugula\b/i, /\bchard\b/i, /\bcollard\b/i,
            /\bmustard green/i, /\bbok choy/i, /\bcabbage\b/i,
        ],
    },
    {
        category: 'powders',
        patterns: [
            /\bflour\b/i, /\bsugar\b/i, /\bpowder\b/i,
            /\bcocoa\b/i, /\bcinnamon\b/i, /\bpaprika\b/i,
            /\bcumin\b/i, /\bturmeric\b/i, /\bspice\b/i,
            /\bsalt\b/i, /\bpepper\b/i,
        ],
    },
    {
        category: 'nuts',
        patterns: [
            /\balmond\b/i, /\bwalnut\b/i, /\bpecan\b/i,
            /\bcashew\b/i, /\bpeanut\b/i, /\bpistachio\b/i,
            /\bhazelnut\b/i, /\bseed\b/i, /\bsesame\b/i,
            /\bsunflower\b/i, /\bpumpkin seed/i,
        ],
    },
    {
        category: 'dried_fruit',
        patterns: [
            /\braisin\b/i, /\bcranberr/i, /\bapricot\b/i,
            /\bdate\b/i, /\bfig\b/i, /\bprune\b/i,
            /\bdried fruit/i, /\bdried mango/i,
        ],
    },
    {
        category: 'herbs',
        patterns: [
            /\bbasil\b/i, /\bparsley\b/i, /\bcilantro\b/i,
            /\bmint\b/i, /\brosemary\b/i, /\bthyme\b/i,
            /\boregano\b/i, /\bdill\b/i, /\bsage\b/i,
            /\btarragon\b/i, /\bchervil/i, /\bchive\b/i,
        ],
    },
    {
        category: 'produce',
        patterns: [
            /\bapple\b/i, /\bpotato\b/i, /\bcarrot\b/i,
            /\btomato\b/i, /\bpepper\b/i, /\bcucumber\b/i,
            /\bzucchini\b/i, /\bsquash\b/i, /\bpumpkin\b/i,
            /\bcelery\b/i, /\bbroccoli\b/i, /\bcauliflower\b/i,
            /\beggplant\b/i, /\bmushroom\b/i, /\bbean\b/i,
            /\bpea\b/i, /\bcorn\b/i, /\basparagus\b/i,
            /\bfruit\b/i, /\bvegetable\b/i, /\bberr/i,
            /\bmelon\b/i, /\bmango\b/i, /\bpineapple\b/i,
            /\bbanana\b/i, /\borange\b/i, /\blemon\b/i,
            /\blime\b/i, /\bgrape\b/i, /\bpeach\b/i,
            /\bpear\b/i, /\bplum\b/i, /\bavocado\b/i,
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
            const effectiveGapType = servingDef.gapType ?? 'volume';
            const aiResult = await insertAiServing(foodId, effectiveGapType, aiOptions);

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






