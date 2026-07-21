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

/**
 * Lean animal-muscle cuts queried by name: cooked protein reliably >25g/100g,
 * raw >20g. A "chicken breast" candidate at 14.6g protein is a deli/roll/luncheon
 * product, not the muscle cut, and should be demoted. Deliberately scoped to
 * poultry breast/thigh + specific red-meat cuts + named lean fish/seafood —
 * NOT generic "chicken"/"fish"/bare "filet".
 *
 * Fish/seafood extension (PR D pt3): a "tuna" candidate at 5.66g protein/100g
 * is a sauced/blended product panel, not the fish (triage 2026-07-20, barcode
 * 0859710005238). The floor is FLOOR-GRADE (sort-below / save-block), never a
 * drop — a battered or fried record merely ranks below plausible ones, so
 * near-floor raw records (haddock ~16g) are demoted, not lost.
 */
const LEAN_PROTEIN_CUT_PATTERN =
    /\b(chicken breast|chicken thigh|turkey breast|pork chop|pork loin|pork tenderloin|beef tenderloin|sirloin|ribeye|tuna|salmon|cod|tilapia|halibut|haddock|mahi[\s-]?mahi|shrimp|prawns?)\b/i;
/** g protein/100g floor: below raw breast (~22) and cooked (~31), above deli rolls (~14-16). */
const LEAN_CUT_PROTEIN_FLOOR = 18;

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

    // 3c. Lean muscle cuts queried by name must clear a protein FLOOR. Catches the
    //     "chicken breast" → deli/roll product (14.6g) case that 3b's >0 rule misses.
    //     Soft-penalize (never drop): if the low-protein record is the only candidate
    //     it still surfaces. Broth/soup/sauce stay exempt via PROTEIN_EXEMPT_PATTERN.
    if (
        protein != null &&
        protein > 0 &&
        protein < LEAN_CUT_PROTEIN_FLOOR &&
        LEAN_PROTEIN_CUT_PATTERN.test(query) &&
        !PROTEIN_EXEMPT_PATTERN.test(combinedNames)
    ) {
        reasons.push(`category:lean_cut_protein_below_floor(${round1(protein)})`);
    }

    if (reasons.length > 0) {
        return { plausible: false, impossible: false, penalty: IMPLAUSIBLE_MACRO_PENALTY, reasons };
    }
    return { plausible: true, impossible: false, penalty: 1, reasons };
}

// ============================================================
// Save-time gate
// ============================================================

/** AI-estimated per-100g expectation used to cross-check a pick before caching it. */
export interface ExpectedNutritionPer100g {
    caloriesPer100g?: number | null;
    proteinPer100g?: number | null;
    /** AI normalize estimate confidence; the cross-check only runs at >= 0.7. */
    confidence: number;
}

// Only trust the AI estimate at/above rerank's nutrition gate (NUTRITION_CONFIDENCE_GATE).
const SAVE_GATE_ESTIMATE_MIN_CONFIDENCE = 0.7;
// kcal outside [expected/4, expected*4] AND off by >30 kcal absolute → reject.
// The ratio catches order-of-magnitude corruption (sugar at 16 kcal vs ~387);
// the absolute floor keeps near-zero foods (diet soda 0 vs 2 kcal) from firing.
const SAVE_GATE_KCAL_RATIO = 4;
const SAVE_GATE_KCAL_MIN_ABS_DIFF = 30;
// Protein overshoot slack keeps low-protein noise from firing (est 0.7 → bound 7.8).
const SAVE_GATE_PROTEIN_OVERSHOOT_SLACK_G = 5;
// Protein undershoot only fires when the food is expected to be protein-dense.
const SAVE_GATE_PROTEIN_UNDER_MIN_EXPECTED_G = 10;

// ---- Deterministic floors (no estimate needed) ----
// Simple staple queries usually skip the LLM normalize step, so the estimate
// cross-check has no anchor for exactly the foods the 2026-07-20 sweep
// corrupted. These floors are query-driven and deliberately tight in scope.
// SINGLE SOURCE OF TRUTH: consumed by BOTH assessSaveTimePlausibility and
// assessRankTimePlausibility via collectDeterministicFloorReasons (PR #109
// precedent — never duplicate a floor inline).

// Whole-query concentrated sweeteners: pure sugar/honey/syrup is never under
// ~250 kcal/100g (sucrose 387, honey 304, maple syrup 260). Anchored to the
// FULL query (optional form adjectives + the sweetener) so "honey ham" or
// "sugar free jam" never match.
const WHOLE_QUERY_SWEETENER_PATTERN =
    /^(?:(?:granulated|powdered|confectioners'?|brown|white|cane|coconut|raw|turbinado|demerara|icing|caster|light|dark|pure|golden|maple|corn)\s+)*(?:sugar|honey|syrup|molasses|agave(?:\s+nectar)?)$/i;
const SWEETENER_MIN_KCAL = 250;

// Fresh produce queried by name is never under ~12 kcal/100g (celery 14,
// cucumber 15, lettuce 15 are the real floor) — a lower value is a diluted
// drink/broth record (grape → 5 kcal grape drink).
const FRESH_PRODUCE_MIN_KCAL = 12;
// ...and never protein-dense (peas top out ~5.4 g) — higher means a fortified
// or protein-blend product hijacked the row (blueberry → 8.7 g protein).
const FRESH_PRODUCE_MAX_PROTEIN = 6;

// Legumes queried by name (cooked/canned) sit at ~90-165 kcal/100g; under 50
// is a soup/broth/sprout record. Soups and sprouts are exempted explicitly.
const LEGUME_QUERY_PATTERN =
    /\b(black beans?|kidney beans?|pinto beans?|navy beans?|white beans?|refried beans?|lima beans?|fava beans?|cannellini|lentils?|chickpeas?|garbanzos?|edamame)\b/i;
const LEGUME_EXEMPT_PATTERN = /\b(soup|broth|stock|sprouts?|juice|water)\b/i;
const LEGUME_MIN_KCAL = 50;

/**
 * Deterministic query-driven floors — the shared implementation behind both
 * the save-time gate and the rank-time assessment. Returns `floor:*` reasons.
 *
 * NOTE: WHOLE_QUERY_SWEETENER_PATTERN is anchored to the FULL query and is
 * word-order-sensitive ("granulated sugar" matches, "sugar granulated" does
 * not) — callers must pass the normalized query name with original word order
 * preserved (normalizedName), never a canonicalized/token-sorted cache key.
 */
function collectDeterministicFloorReasons(
    queryName: string,
    foodName: string,
    nutrientsPer100g?: MacroPlausibilityInput | null
): string[] {
    const reasons: string[] = [];

    const kcal = nutrientsPer100g?.kcal ?? nutrientsPer100g?.calories ?? null;
    const protein = nutrientsPer100g?.protein ?? null;
    const query = (queryName || '').toLowerCase();
    const combinedNames = `${query} ${(foodName || '').toLowerCase()}`;

    if (WHOLE_QUERY_SWEETENER_PATTERN.test(query.trim())) {
        if (kcal != null && kcal < SWEETENER_MIN_KCAL) {
            reasons.push(`floor:sweetener_kcal_${round1(kcal)}_below_${SWEETENER_MIN_KCAL}`);
        }
    }
    const isFreshProduceQuery =
        FRESH_PRODUCE_PATTERN.test(query) && !CONCENTRATED_FORM_PATTERN.test(combinedNames);
    if (isFreshProduceQuery) {
        if (kcal != null && kcal < FRESH_PRODUCE_MIN_KCAL) {
            reasons.push(`floor:produce_kcal_${round1(kcal)}_below_${FRESH_PRODUCE_MIN_KCAL}`);
        }
        if (protein != null && protein > FRESH_PRODUCE_MAX_PROTEIN) {
            reasons.push(`floor:produce_protein_${round1(protein)}_over_${FRESH_PRODUCE_MAX_PROTEIN}`);
        }
    }
    if (
        LEGUME_QUERY_PATTERN.test(query) &&
        !LEGUME_EXEMPT_PATTERN.test(combinedNames) &&
        kcal != null &&
        kcal < LEGUME_MIN_KCAL
    ) {
        reasons.push(`floor:legume_kcal_${round1(kcal)}_below_${LEGUME_MIN_KCAL}`);
    }

    return reasons;
}

/**
 * Decide whether a resolved mapping is clean enough to WRITE to the
 * FoodMapping cache. Stricter than ranking on purpose: a rejected save only
 * costs a re-resolution on the next request, while a bad cached row poisons
 * every request until the next parity sweep. So ANY fired check — including
 * the soft (penalty-only) ranking checks — blocks the write, and when the AI
 * nutrition estimate is trustworthy the pick is also cross-checked against it
 * (the 2026-07-20 sweep wrote "granulated sugar" 16 kcal/100g, "grape" 5,
 * "lentil" 20.9, "blueberry" 8.7 g protein — all internally consistent enough
 * to pass the general bounds/Atwater checks).
 */
export function assessSaveTimePlausibility(
    queryName: string,
    foodName: string,
    nutrientsPer100g?: MacroPlausibilityInput | null,
    expected?: ExpectedNutritionPer100g | null
): { save: boolean; reasons: string[] } {
    const base = assessMacroPlausibility(queryName, foodName, nutrientsPer100g);
    const reasons = [...base.reasons];

    const kcal = nutrientsPer100g?.kcal ?? nutrientsPer100g?.calories ?? null;
    const protein = nutrientsPer100g?.protein ?? null;

    // Deterministic floors — these run with or without an AI estimate, because
    // the simple staple queries they protect rarely have one. Shared with
    // assessRankTimePlausibility (single source of truth).
    reasons.push(...collectDeterministicFloorReasons(queryName, foodName, nutrientsPer100g));

    if (expected != null && expected.confidence >= SAVE_GATE_ESTIMATE_MIN_CONFIDENCE) {
        const expKcal = expected.caloriesPer100g ?? null;
        if (kcal != null && expKcal != null && expKcal > 0) {
            const outsideBand =
                kcal <= 0 ||
                kcal / expKcal > SAVE_GATE_KCAL_RATIO ||
                kcal / expKcal < 1 / SAVE_GATE_KCAL_RATIO;
            if (outsideBand && Math.abs(kcal - expKcal) > SAVE_GATE_KCAL_MIN_ABS_DIFF) {
                reasons.push(`estimate:kcal_${round1(kcal)}_vs_expected_${round1(expKcal)}`);
            }
        }

        const expProtein = expected.proteinPer100g ?? null;
        if (protein != null && expProtein != null && expProtein >= 0) {
            if (protein > expProtein * SAVE_GATE_KCAL_RATIO + SAVE_GATE_PROTEIN_OVERSHOOT_SLACK_G) {
                reasons.push(`estimate:protein_${round1(protein)}_over_expected_${round1(expProtein)}`);
            }
            if (
                expProtein >= SAVE_GATE_PROTEIN_UNDER_MIN_EXPECTED_G &&
                protein < expProtein / SAVE_GATE_KCAL_RATIO
            ) {
                reasons.push(`estimate:protein_${round1(protein)}_under_expected_${round1(expProtein)}`);
            }
        }
    }

    return { save: reasons.length === 0, reasons };
}

// ============================================================
// Rank-time assessment (PR D pt3)
// ============================================================

export interface RankTimePlausibilityResult {
    /**
     * Physically impossible bounds violation (same semantics as
     * MacroPlausibilityResult.impossible) — the only verdict that warrants a
     * hard drop. When true, floorHit/softPenalty are not evaluated.
     */
    impossible: boolean;
    /**
     * Floor-grade failure: the candidate should be STABLE-PARTITIONED / sorted
     * strictly below non-floor candidates — never dropped (a floor-hit record
     * still surfaces when nothing better exists). Fired by:
     *   - deterministic floors (sweetener kcal<250, produce kcal<12 /
     *     protein>6, legume kcal<50)
     *   - produce kcal>150 (category:fresh_produce_kcal_*)
     *   - lean-cut protein<18 (category:lean_cut_protein_below_floor)
     *   - protein food with zero protein (category:protein_food_with_zero_protein)
     */
    floorHit: boolean;
    /**
     * Soft (Atwater-only) failure: keep the existing IMPLAUSIBLE_MACRO_PENALTY
     * score multiply — never floor-grade.
     */
    softPenalty: boolean;
    /** Machine-readable reasons for every check that fired. */
    reasons: string[];
}

/**
 * assessMacroPlausibility reasons that are floor-grade at rank time. Atwater
 * high/low deliberately stay soft (data-noise-prone; a soft ×0.3 is enough).
 */
const FLOOR_GRADE_CATEGORY_PREFIXES = [
    'category:fresh_produce_kcal_',
    'category:protein_food_with_zero_protein',
    'category:lean_cut_protein_below_floor',
];

/**
 * Rank-time plausibility: composes assessMacroPlausibility with the SAME
 * deterministic floors as the save-time gate (collectDeterministicFloorReasons
 * — single source of truth), classifying every fired reason as impossible /
 * floor-grade / soft so ranking can stable-partition instead of dropping.
 *
 * INPUT EXPECTATION: `queryName` must be the normalized query with original
 * word order preserved (normalizedName). WHOLE_QUERY_SWEETENER_PATTERN is
 * anchored to the full query and word-order-sensitive — "granulated sugar"
 * matches, a token-sorted cache key like "sugar granulated" silently does not.
 */
export function assessRankTimePlausibility(
    queryName: string,
    candidateName: string,
    macrosPer100g?: MacroPlausibilityInput | null
): RankTimePlausibilityResult {
    const base = assessMacroPlausibility(queryName, candidateName, macrosPer100g);

    if (base.impossible) {
        return { impossible: true, floorHit: false, softPenalty: false, reasons: base.reasons };
    }

    const floorReasons = collectDeterministicFloorReasons(queryName, candidateName, macrosPer100g);
    const reasons = [...base.reasons, ...floorReasons];

    const floorHit =
        floorReasons.length > 0 ||
        base.reasons.some((r) => FLOOR_GRADE_CATEGORY_PREFIXES.some((p) => r.startsWith(p)));
    const softPenalty = reasons.some((r) => r.startsWith('atwater:'));

    return { impossible: false, floorHit, softPenalty, reasons };
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}
