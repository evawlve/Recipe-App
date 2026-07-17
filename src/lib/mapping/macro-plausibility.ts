/**
 * Macro Plausibility Gate
 *
 * Pure, unit-testable checks for whether a candidate's per-100g macros are
 * physiologically plausible for the queried food. This complements
 * `hasNullOrInvalidMacros` (filter-candidates.ts), which catches MISSING /
 * internally-inconsistent-null data — this module catches PRESENT but
 * implausible values, e.g.:
 *   - "black beans" mapped to an OFF row with protein = 0  (golden n-prot-04)
 *   - "spinach" mapped to an OFF row with 224 kcal/100g    (golden n-prod-02)
 *
 * Design principles:
 *   - Prefer GENERAL checks (bounds, Atwater consistency) over per-food rules.
 *   - Category priors are keyword-based and deliberately conservative.
 *   - Soft failures PENALIZE ranking (score multiplier), they don't drop —
 *     only physically impossible bounds violations warrant a hard drop.
 *   - When in doubt, don't flag.
 */

export interface MacroPlausibilityInput {
    kcal?: number | null;
    calories?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
}

export interface MacroPlausibilityResult {
    /** True when no checks fired. */
    plausible: boolean;
    /**
     * True only for physically impossible values (negative macros, macro > 100g/100g,
     * macro sum > 105g/100g, kcal > 900/100g). These candidates should be dropped.
     */
    impossible: boolean;
    /**
     * Score multiplier to apply in ranking. 1 when plausible, 0.3 for soft
     * (implausible-but-conceivable) failures, 0 for impossible values.
     */
    penalty: number;
    /** Machine-readable reasons for every check that fired. */
    reasons: string[];
}

/** Soft-failure score multiplier: demotes the candidate without eliminating it. */
export const IMPLAUSIBLE_MACRO_PENALTY = 0.3;

// Max energy density of any real food is ~900 kcal/100g (pure fat/oil at 884).
const MAX_KCAL_PER_100G = 900;
// Macros can't sum past 100g/100g; allow slop for rounding on labels.
const MAX_MACRO_SUM = 105;
// Fresh produce cap — raw fruit/veg tops out well under this (dates/avocado
// excluded from the keyword list below).
const FRESH_PRODUCE_MAX_KCAL = 150;

// ============================================================
// Keyword sets (word-boundary matched, conservative)
// ============================================================

/**
 * Low-calorie fresh produce: leafy greens, common vegetables, fresh fruit.
 * Deliberately EXCLUDES calorie-dense produce (avocado, olive, coconut,
 * plantain, dates) to avoid false positives.
 */
const FRESH_PRODUCE_PATTERN = new RegExp(
    '\\b(' +
    [
        // Leafy greens
        'spinach', 'lettuce', 'kale', 'arugula', 'chard', 'watercress', 'cabbage', 'bok choy', 'collard', 'romaine',
        // Vegetables
        'broccoli', 'cauliflower', 'celery', 'cucumber', 'zucchini', 'courgette', 'tomato(?:es)?',
        'bell pepper', 'carrot', 'onion', 'mushroom', 'asparagus', 'green bean', 'radish',
        'beet', 'turnip', 'eggplant', 'aubergine', 'pumpkin', 'squash', 'leek', 'okra', 'snap pea',
        // Fresh fruit
        'apple', 'orange', 'strawberr(?:y|ies)', 'blueberr(?:y|ies)', 'raspberr(?:y|ies)', 'blackberr(?:y|ies)',
        'watermelon', 'cantaloupe', 'honeydew', 'melon', 'grape', 'peach', 'pear', 'plum',
        'nectarine', 'apricot', 'pineapple', 'mango', 'kiwi', 'banana', 'lemon', 'lime',
        'grapefruit', 'cherr(?:y|ies)', 'papaya', 'tangerine', 'clementine',
    ].join('|') +
    ')s?\\b',
    'i'
);

/**
 * Processing/concentration modifiers that legitimately push produce past the
 * fresh-produce calorie cap (dried spinach powder, banana chips, ...).
 * Checked against BOTH query and candidate names.
 */
const CONCENTRATED_FORM_PATTERN =
    /\b(dried|dehydrated|freeze[\s-]?dried|sun[\s-]?dried|sundried|powdered?|chips?|crisps?|concentrate[ds]?|syrup|jam|jelly|preserves?|candied|fried|oil|butter|flour|flakes?|raisins?|snacks?|bar|bars|leather|extract|granola|smoothie mix)\b/i;

/**
 * Foods that MUST have nonzero protein per 100g: legumes, meat, fish, poultry,
 * eggs, soy. Matched against the QUERY (user intent), not the candidate.
 * Excludes ambiguous "bean" uses (vanilla/coffee/cocoa bean, green beans —
 * green beans can round to 0g on sloppy labels).
 */
const MUST_HAVE_PROTEIN_PATTERN = new RegExp(
    '\\b(' +
    [
        // Legumes (nonzero protein even cooked/canned)
        'black beans?', 'kidney beans?', 'pinto beans?', 'navy beans?', 'white beans?',
        'refried beans?', 'baked beans?', 'lima beans?', 'fava beans?', 'cannellini',
        'lentils?', 'chickpeas?', 'garbanzos?', 'edamame', 'split peas?',
        // Soy proteins
        'tofu', 'tempeh', 'seitan',
        // Meat / poultry
        'chicken breast', 'chicken thigh', 'ground beef', 'ground turkey', 'ground pork',
        'steak', 'pork chop', 'pork loin', 'lamb', 'veal', 'venison', 'brisket', 'ribeye', 'sirloin',
        'turkey breast', 'ham', 'meatballs?',
        // Fish / seafood
        'salmon', 'tuna', 'cod', 'tilapia', 'halibut', 'trout', 'sardines?', 'anchov(?:y|ies)',
        'shrimp', 'prawns?', 'scallops?', 'crab', 'lobster', 'mackerel',
        // Eggs
        'eggs?', 'egg whites?',
    ].join('|') +
    ')\\b',
    'i'
);

/**
 * Query/candidate contexts where a protein-keyword match should NOT force
 * nonzero protein (broths, seasonings, flavorings, fats).
 */
const PROTEIN_EXEMPT_PATTERN =
    /\b(broth|stock|bouillon|seasonings?|flavou?r(?:ed|ing)?|extract|oil|fat|sauce|vinaigrette|dressing|marinade|rub|spice)\b/i;

/** Alcohol carries 7 kcal/g that never shows up in P/C/F — exempt from the high-side Atwater check. */
const ALCOHOL_PATTERN =
    /\b(beer|wine|vodka|whiske?y|rum|gin|tequila|liqueur|brandy|cognac|sake|cider|cocktail|margarita|sangria|champagne|prosecco|bourbon|scotch|mead|soju|alcoholic?|spirits?|ale|lager|stout|ipa)\b/i;

// ============================================================
// Main assessment
// ============================================================

/**
 * Assess whether per-100g macros are plausible for the queried food.
 *
 * @param queryName - normalized ingredient the user asked for (drives category priors)
 * @param candidateName - candidate food name (drives concentrated-form / alcohol exemptions)
 * @param macrosPer100g - candidate nutrition per 100g (kcal or calories field accepted)
 */
export function assessMacroPlausibility(
    queryName: string,
    candidateName: string,
    macrosPer100g?: MacroPlausibilityInput | null
): MacroPlausibilityResult {
    const reasons: string[] = [];

    // No data → nothing to assess (missing data is hasNullOrInvalidMacros' job).
    if (!macrosPer100g) {
        return { plausible: true, impossible: false, penalty: 1, reasons };
    }

    const kcal = macrosPer100g.kcal ?? macrosPer100g.calories ?? null;
    const protein = macrosPer100g.protein ?? null;
    const carbs = macrosPer100g.carbs ?? null;
    const fat = macrosPer100g.fat ?? null;

    const query = (queryName || '').toLowerCase();
    const candidate = (candidateName || '').toLowerCase();
    const combinedNames = `${query} ${candidate}`;

    // --------------------------------------------------------
    // 1. Bounds sanity — physically impossible values → hard drop
    // --------------------------------------------------------
    let impossible = false;

    for (const [label, value] of [['protein', protein], ['carbs', carbs], ['fat', fat]] as const) {
        if (value != null && value < 0) {
            reasons.push(`bounds:${label}_negative(${value})`);
            impossible = true;
        }
        if (value != null && value > 100) {
            reasons.push(`bounds:${label}_over_100g(${value})`);
            impossible = true;
        }
    }
    if (kcal != null && kcal < 0) {
        reasons.push(`bounds:kcal_negative(${kcal})`);
        impossible = true;
    }
    if (kcal != null && kcal > MAX_KCAL_PER_100G) {
        reasons.push(`bounds:kcal_over_${MAX_KCAL_PER_100G}(${kcal})`);
        impossible = true;
    }
    const macroSum = (protein ?? 0) + (carbs ?? 0) + (fat ?? 0);
    if (macroSum > MAX_MACRO_SUM) {
        reasons.push(`bounds:macro_sum_over_${MAX_MACRO_SUM}g(${round1(macroSum)})`);
        impossible = true;
    }

    if (impossible) {
        return { plausible: false, impossible: true, penalty: 0, reasons };
    }

    // --------------------------------------------------------
    // 2. Atwater consistency — stated kcal vs 4P + 4C + 9F
    //    Only when kcal and ALL macros are present; asymmetric
    //    tolerance for fiber (low side) and alcohol (high side).
    // --------------------------------------------------------
    if (kcal != null && protein != null && carbs != null && fat != null) {
        const computed = protein * 4 + carbs * 4 + fat * 9;

        // High side: stated kcal far above what macros can supply.
        // Alcohol (7 kcal/g, not in macros) is the one legitimate cause.
        const highDiff = kcal - computed;
        if (
            highDiff > 50 &&
            kcal > computed * 1.5 &&
            !ALCOHOL_PATTERN.test(combinedNames)
        ) {
            reasons.push(`atwater:kcal_${kcal}_exceeds_computed_${round1(computed)}`);
        }

        // Low side: stated kcal far below macros. Fiber (~2 kcal/g) and sugar
        // alcohols (~0–2.4 kcal/g) hide inside carbs, so compare against a
        // floor that counts carbs at 0 kcal/g — only protein+fat energy is
        // guaranteed. Anything below half of THAT is corrupted data.
        const computedFloor = protein * 4 + fat * 9;
        const lowDiff = computedFloor - kcal;
        if (lowDiff > 50 && kcal < computedFloor * 0.5) {
            reasons.push(`atwater:kcal_${kcal}_below_floor_${round1(computedFloor)}`);
        }
    }

    // --------------------------------------------------------
    // 3. Category priors (query-driven, conservative)
    // --------------------------------------------------------

    // 3a. Fresh produce queried by name can't exceed ~150 kcal/100g unless the
    //     query or candidate indicates a concentrated form (dried, powder, ...).
    if (
        kcal != null &&
        kcal > FRESH_PRODUCE_MAX_KCAL &&
        FRESH_PRODUCE_PATTERN.test(query) &&
        !CONCENTRATED_FORM_PATTERN.test(combinedNames)
    ) {
        reasons.push(`category:fresh_produce_kcal_${kcal}_over_${FRESH_PRODUCE_MAX_KCAL}`);
    }

    // 3b. Legumes / meat / fish / poultry / eggs queried by name must have
    //     nonzero protein (null protein passes — that's a missing-data case).
    if (
        protein != null &&
        protein <= 0 &&
        MUST_HAVE_PROTEIN_PATTERN.test(query) &&
        !PROTEIN_EXEMPT_PATTERN.test(combinedNames)
    ) {
        reasons.push(`category:protein_food_with_zero_protein`);
    }

    if (reasons.length > 0) {
        return { plausible: false, impossible: false, penalty: IMPLAUSIBLE_MACRO_PENALTY, reasons };
    }
    return { plausible: true, impossible: false, penalty: 1, reasons };
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}
