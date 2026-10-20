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

import { detectBrandInQuery } from './brand-detector';
import { normalizeUnitToken } from '../parse/unit';

export interface MacroPlausibilityInput {
    kcal?: number | null;
    calories?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
}

/**
 * True when every macro reads as zero (or is absent) — a record carrying no
 * nutrition at all.
 *
 * Deliberately NOT folded into assessMacroPlausibility: that function's bounds
 * layer is shared with rank time, where an all-zero candidate is already
 * handled by hasNullOrInvalidMacros, and where a hard drop would change
 * ranking. This is a save-time-only signal.
 *
 * Absent and zero are treated alike on purpose. A record that omits every
 * macro is no more informative than one that reports them as zero, and the
 * per-100g blocks reaching this code are built by division (kcal / grams), so
 * a missing input surfaces as an explicit 0 about as often as as a null.
 */
export function isAllZeroMacros(n?: MacroPlausibilityInput | null): boolean {
    if (!n) return false;
    const kcal = n.kcal ?? n.calories ?? 0;
    return (kcal ?? 0) === 0
        && (n.protein ?? 0) === 0
        && (n.carbs ?? 0) === 0
        && (n.fat ?? 0) === 0;
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

/** Alcohol carries 7 kcal/g that never shows up in P/C/F — exempt from the high-side Atwater check.
 *  Exported for detect-corrupt-nutrition.ts, whose kJ-as-kcal rule needs the same exemption.
 *
 *  Named cocktails and spirits were added after the Jul 2026 funnel read: a
 *  martini at a correct 226 kcal/100g computes ~2 kcal from P/C/F and was
 *  rejected as corrupt, because the drink's name says nothing this pattern
 *  recognised. "punch" and "sour" are deliberately NOT here — "fruit punch"
 *  and "sour cream" are non-alcoholic, and exempting them would blunt a check
 *  that does real work. */
export const ALCOHOL_PATTERN =
    /\b(beer|wine|vodka|whiske?y|rum|gin|tequila|liqueur|brandy|cognac|sake|cider|cocktail|margarita|sangria|champagne|prosecco|bourbon|scotch|mead|soju|alcoholic?|spirits?|ale|lager|stout|ipa|martini|mojito|daiquiri|negroni|manhattan|old[\s-]?fashioned|mai[\s-]?tai|pi(?:ñ|n)a[\s-]?colada|bloody mary|mimosa|spritz|vermouth|aperol|campari|kahlua|baileys?|schnapps|absinthe|amaretto|triple sec|hard (?:seltzer|cider|lemonade)|shandy|nightcap)\b/i;

/**
 * Baked goods and composite dishes — foods whose name CONTAINS an ingredient
 * word without being that ingredient.
 *
 * The Jul 2026 funnel read found 15 of 21 save-time plausibility rejections
 * were this one mistake: a produce or lean-cut token appears in the name of a
 * prepared dish, and the dish is then held to the ingredient's nutrition.
 * "banana bread" was judged against a fresh-banana calorie ceiling, "carrot
 * cake" likewise, and "shrimp scampi" against a raw-shrimp protein floor that
 * sauce and pasta legitimately dilute.
 *
 * This disqualifies the CATEGORY, not the food — the AI-estimate cross-check
 * still runs on these lines, which is what actually caught the genuine
 * corruption in that batch (beef stew at 20 kcal/100g, oxtail soup at 26).
 */
// NOTE: "roll" is deliberately absent. It reads as a baked good but also
// matches "Chicken Breast Deli Roll" and "California Roll", and the deli-roll
// case is precisely what the lean-cut protein floor exists to catch (golden
// n-mq-22). A word that disqualifies the very case a rule was built for is
// worse than a missing word.
const PREPARED_DISH_PATTERN =
    /\b(bread|cake|muffin|pie|cobbler|crumble|tart|pastry|pastries|cookie|brownie|bun|scone|biscuit|donut|doughnut|waffle|pancake|casserole|stir[\s-]?fr(?:y|ied)|scampi|soup|stew|chowder|bisque|curry|salad|sandwich|wrap|burrito|taco|pizza|lasagn(?:a|e)|risotto|pasta|noodles?|spaghetti|macaroni|quiche|gratin|florentine|alfredo|parmigiana|teriyaki|tempura|fritters?|croquette|pudding|custard|mousse|cheesecake|smoothie|milkshake|latte|loaf|dumplings?|pierogi|empanada|samosa|stuffing|hash|skillet)\b/i;

/**
 * A named main protein alongside a produce word means a composite dish, not
 * produce: "orange chicken" carries no dish noun at all, yet it is obviously
 * not an orange. Used ONLY to disqualify the fresh-produce category — feeding
 * it to the lean-cut protein floor would disable that floor entirely.
 */
const MAIN_PROTEIN_NOUN_PATTERN =
    /\b(chicken|beef|pork|turkey|lamb|duck|shrimp|prawns?|fish|salmon|tuna|tofu|sausage|bacon|ham|steak|meatballs?|brisket|schnitzel)\b/i;

/**
 * Bare plural `peppers` queried as produce. PLURAL ONLY, never `pepper` (black pepper, pepper jack,
 * pepperoni, peppercorn must not match). Not in FRESH_PRODUCE_PATTERN because a branded product name
 * ("mama lil's peppers", a jarred peppers-in-oil at 600 kcal/100 g) must not be judged by the produce
 * ceiling, so possessive and detected-brand queries are skipped on this path only. The save gate keys
 * singular/token-sorted (`pepper`), so for `peppers` lines this reason acts at rank time (floor-hit
 * partition) and Step 3d, not at the save gate. Organic population 0 (C68 probes).
 */
function barePeppersQuery(query: string): boolean {
    return /\bpeppers\b/i.test(query)
        && !/'s\b|\u2019s\b/i.test(query)
        && !detectBrandInQuery(query).isBranded;
}

/** Fresh produce queried by name, and not actually a dish that merely mentions it. */
function isFreshProduceContext(query: string, combinedNames: string): boolean {
    return (FRESH_PRODUCE_PATTERN.test(query) || barePeppersQuery(query))
        && !CONCENTRATED_FORM_PATTERN.test(combinedNames)
        && !PREPARED_DISH_PATTERN.test(combinedNames)
        && !MAIN_PROTEIN_NOUN_PATTERN.test(combinedNames)
        // QUERY only: `stuffed peppers` / `stuffed mushrooms` are dishes. Not in PREPARED_DISH_PATTERN, which
        // is matched against candidate names too and also gates the lean-cut protein floor.
        && !/\bstuffed\b/i.test(query);
}

/**
 * Genuinely zero-calorie drinks that carry a produce word for flavour.
 *
 * Exempt from the produce calorie FLOOR only: a grapefruit sparkling water at
 * 4.8 kcal/100g is correct, not corrupt. Juice is pointedly excluded — orange
 * juice really should clear the floor, and dropping it here would let a
 * genuinely broken juice record through.
 */
const ZERO_CAL_FLAVOURED_DRINK_PATTERN =
    /\b(sparkling|seltzer|club soda|soda water|tonic|mineral water|flavou?red water|tea|black coffee|zero|diet|sugar[\s-]?free|unsweetened)\b/i;

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
        isFreshProduceContext(query, combinedNames)
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
        !PROTEIN_EXEMPT_PATTERN.test(combinedNames) &&
        // A composite dish dilutes the cut with sauce, pasta or vegetables, so
        // the raw-cut floor doesn't apply: shrimp scampi at 11g and tuna
        // casserole at 6.2g are both correct.
        !PREPARED_DISH_PATTERN.test(combinedNames)
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
    // "banana bread" / "orange chicken" are not produce in either direction.
    const isFreshProduceQuery = isFreshProduceContext(query, combinedNames);
    if (isFreshProduceQuery) {
        // A flavoured zero-calorie drink legitimately sits under the floor.
        if (kcal != null && kcal < FRESH_PRODUCE_MIN_KCAL
            && !ZERO_CAL_FLAVOURED_DRINK_PATTERN.test(combinedNames)) {
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

// Prepared-drink panel (S202): an OFF / FatSecret record for a prepared drink (`matcha latte`, `london fog`) sometimes carries the
// DRY MIX's panel (397 / 467 kcal/100g). A prepared milk + espresso/tea drink tops out near ~100 kcal/100g, so a record far above
// PREPARED_DRINK_MAX_KCAL is the powder's panel, not the drink's.
// RANK-TIME ONLY, by design: a `category:` reason in assessMacroPlausibility() would also refuse the cache save and take Step 3d's
// x0.3 penalty (refute r2 F1/F2), so the reason lives in assessRankTimePlausibility() alone and only demotes through the floor-hit partition.
// HEAD rule: it fires only when the drink word is the query's HEAD noun (refute r2 F4: `mocha almonds`, creamers, `matcha latte powder`
// are not drinks), never as an anywhere-in-query pattern.
// headLine: simpleRerank()'s query can be an LLM canonical that dropped `latte` (`a matcha latte` -> `matcha`), so the raw line is also read.
const PREPARED_DRINK_MAX_KCAL = 150;
const PREPARED_DRINK_HEADS = new Set(['latte', 'cappuccino', 'cortado', 'macchiato', 'mocha', 'frappe', 'frappuccino']);
const PREPARED_DRINK_TWO_WORD_HEADS = new Set(['flat white', 'london fog']);
// The head is the last word before the first `with` / `and` / `plus` / `&` / comma: `latte with vanilla syrup` is a latte,
// `mocha almonds` and `pumpkin spice latte creamer` are not drinks, `matcha latte powder` asks for the powder.
const CLAUSE_BREAK = /\s(?:with|and|plus|&|\+)\s|\sw\/|,/;
// Trailing words that never name the drink: size, temperature, milk, decaf, units, a count (`latte grande`, `latte 16 oz`, `cappuccino x2`).
const TRAILING_NON_HEAD = new Set(['small', 'medium', 'large', 'tall', 'grande', 'venti', 'trenta', 'short', 'regular', 'kids', 'iced', 'hot', 'decaf', 'skim', 'nonfat', 'whole', 'dry', 'wet', 'oz', 'ounce', 'ounces', 'fl', 'ml', 'x']);
function singularHead(w: string, heads: Set<string>): string {
    if (w.endsWith('es') && heads.has(w.slice(0, -2))) return w.slice(0, -2);
    if (w.endsWith('s') && heads.has(w.slice(0, -1))) return w.slice(0, -1);
    return w;
}
/** The prepared-drink head word of a query (`latte`, `flat white`, …), or null. Shared with the bare-drink serving rule (bare-query-guard.ts). */
// Head-clause words: first clause before with/and/plus/&/+/w//comma, trailing non-head words popped. Shared by the prepared-drink and brewed-tea rules.
function headClauseWords(queryName: string): string[] {
    const clause = (queryName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(CLAUSE_BREAK)[0];
    const words = clause.split(/[^a-z]+/).filter(Boolean);
    while (words.length > 1 && TRAILING_NON_HEAD.has(words[words.length - 1])) words.pop();
    return words;
}
export function preparedDrinkHeadWord(queryName: string): string | null {
    const words = headClauseWords(queryName);
    if (words.length === 0 || words.includes('instant')) return null; // `instant latte` names the powder
    const last = words[words.length - 1];
    const one = singularHead(last, PREPARED_DRINK_HEADS);
    if (PREPARED_DRINK_HEADS.has(one)) return one;
    if (words.length < 2) return null;
    const lastTwo = `${words[words.length - 2]} ${last.endsWith('s') ? last.slice(0, -1) : last}`;
    if (PREPARED_DRINK_TWO_WORD_HEADS.has(lastTwo)) return lastTwo;
    const raw2 = `${words[words.length - 2]} ${last}`;
    return PREPARED_DRINK_TWO_WORD_HEADS.has(raw2) ? raw2 : null;
}
function preparedDrinkHead(queryName: string): boolean {
    return preparedDrinkHeadWord(queryName) != null;
}
export { PREPARED_DRINK_MAX_KCAL };
function preparedDrinkReason(queryName: string, macrosPer100g?: MacroPlausibilityInput | null, headLine?: string): string | null {
    const raw = macrosPer100g?.kcal ?? macrosPer100g?.calories ?? null;
    const kcal = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(kcal) || kcal <= PREPARED_DRINK_MAX_KCAL) return null;
    return preparedDrinkHead(queryName) || (headLine != null && preparedDrinkHead(headLine))
        ? `rank:prepared_drink_kcal_${round1(kcal)}_over_${PREPARED_DRINK_MAX_KCAL}`
        : null;
}

// Brewed-tea panel (S239 / C70): a plain brewed-tea query (`tea`, `a cup of tea`, `my tea`) can resolve to an OFF record named just
// "Tea" that carries a sweetened or dry panel (100 / 250 / 629 kcal/100g). Unsweetened brewed tea sits at 0-6 kcal/100g, Tea with Milk
// 9.7, Tea with Milk and Sugar 16.9, and FatSecret "Tea Presweetened with Sugar" 20 (kept: the rule is `> 20`). Anything above is a
// sweetened RTD, a syrup or a dry panel, which a plain tea line does not ask for.
// RANK-TIME ONLY, same shape as the prepared-drink rule: the reason lives in assessRankTimePlausibility() alone and demotes through the
// floor-hit partition; the save gate, Step 3d and assessMacroPlausibility() are untouched.
// The HEAD is read from queryName ONLY, never headLine (refute M1): headLine `tea w/ honey (1 tsp)` for the item `honey` would turn
// every real honey panel into a floor-hit. Exemption words are scanned over the WHOLE queryName and headLine (refute M2) so a sweet or
// milky line (`tea, sweetened`, `hot tea with 2 sugars`) keeps its sweet record; a branded query (`peace tea`, `gold peak tea`) is
// skipped by detectBrandInQuery, not a hand-written brand list (refute M3).
// ACCEPTED cold winner: `a cup of tea` -> off_0049000070507 "Tea" [Peace Tea] 5.95 kcal/100g, a bottled unsweetened tea standing in
// for brewed tea (identity is lateral, calories are right).
const BREWED_TEA_MAX_KCAL = 20;
const BREWED_TEA_EXEMPT_PATTERN = new RegExp(
    `\\b(?:${[
        'sweet', 'sweetened', 'sweetener', 'iced', 'ice', 'bubble', 'boba', 'thai', 'chai', 'milk', 'matcha', 'instant', 'lemon', 'peach',
        'raspberry', 'honey', 'sugar', 'sugars', 'syrup', 'masala', 'kashmiri', 'butter', 'cream', 'kombucha', 'hard', 'afternoon', 'high',
        'latte', 'fog', 'long', 'island',
    ].join('|')})\\b`
);
// Every word BEFORE the head `tea` must be a known brewed-tea modifier: an unknown word (a brand such as `peace`, `gold peak`, `twisted`,
// `honest`, or `kombucha`) means the line is not a plain brewed-tea ask. brand-lexicon.json misses some tea brands, so this is the
// mechanism; the detectBrandInQuery skip stays as belt and braces.
const BREWED_TEA_MODS = new Set([
    'a', 'an', 'the', 'my', 'some', 'one', 'cup', 'cups', 'mug', 'mugs', 'of', 'pot', 'hot', 'warm', 'plain', 'black', 'green', 'white',
    'oolong', 'herbal', 'chamomile', 'camomile', 'mint', 'peppermint', 'spearmint', 'earl', 'grey', 'gray', 'english', 'breakfast', 'irish',
    'scottish', 'jasmine', 'decaf', 'decaffeinated', 'rooibos', 'hibiscus', 'ginger', 'lemongrass', 'loose', 'leaf', 'brewed', 'builders',
    'regular', 'normal', 'strong', 'weak', 'fresh', 'tulsi', 'darjeeling', 'assam', 'ceylon', 'sencha', 'genmaicha', 'hojicha', 'pu', 'erh',
    'puerh', 'barley', 'yerba',
]);
function brewedTeaReason(queryName: string, macrosPer100g?: MacroPlausibilityInput | null, headLine?: string): string | null {
    const raw = macrosPer100g?.kcal ?? macrosPer100g?.calories ?? null;
    const kcal = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(kcal) || kcal <= BREWED_TEA_MAX_KCAL) return null;
    const words = headClauseWords(queryName);
    const last = words[words.length - 1];
    if (last !== 'tea' && last !== 'teas') return null;
    // A size/measure word (`large`, `small`, `medium`, `bottle` ...) that the unit table reads is allowed; it is not a brand or a flavour.
    if (!words.slice(0, -1).every((w) => BREWED_TEA_MODS.has(w) || normalizeUnitToken(w).kind !== 'unknown')) return null;
    const lowered = [queryName, headLine].map((t) => (t || '').toLowerCase());
    if (lowered.some((t) => BREWED_TEA_EXEMPT_PATTERN.test(t))) return null;
    if (detectBrandInQuery(queryName).isBranded) return null;
    if (headLine != null && detectBrandInQuery(headLine).isBranded) return null;
    return `rank:brewed_tea_kcal_${round1(kcal)}_over_${BREWED_TEA_MAX_KCAL}`;
}

// Diet / zero drink panel (D19): `powerade zero grape`, `a diet cherry coke`, `diet dr pepper` can resolve to a record that carries a
// REGULAR-sugar panel (22-42 kcal/100g: a mislabeled OFF "Diet" row, or a flavour-only record) while 0-kcal records sit in the pool.
// A diet / zero soft drink is under a few kcal/100g, so anything above DIET_DRINK_MAX_KCAL is a regular-sugar panel.
// RANK-TIME ONLY, same shape as the brewed-tea rule: the reason lives in assessRankTimePlausibility() alone and demotes through the
// floor-hit partition; the save gate, Step 3d and assessMacroPlausibility() are untouched. No brand skip: here the brand IS the drink.
// The DIET word is read from queryName, or from headLine's head clause only (`coke with a diet pepsi` never fires for `coke`).
// The DRINK word is read from queryName only. Exemption words over the WHOLE queryName and headLine keep non-drink foods silent.
const DIET_DRINK_MAX_KCAL = 12;
const DIET_DRINK_DIET_PATTERN = / (?:diet|zero|zero sugar|zero calorie|0 calorie|sugar free|sugarfree) /;
const DIET_DRINK_WORDS = [
    'coke', 'cola', 'pepsi', 'sprite', '7up', 'dr pepper', 'mountain dew', 'mtn dew', 'fanta', 'fresca', 'root beer', 'ginger ale', 'tonic',
    'soda', 'pop', 'lemonade', 'gatorade', 'powerade', 'bodyarmor', 'body armor', 'propel', 'red bull', 'redbull', 'monster', 'rockstar',
    'celsius', 'bang', 'reign', 'alani', 'energy drink', 'sports drink', 'snapple', 'arizona', 'vitaminwater', 'squirt', 'sunkist',
    'canada dry', 'schweppes',
];
const DIET_DRINK_EXEMPT_WORDS = [
    'latte', 'coffee', 'creamer', 'protein', 'shake', 'syrup', 'sauce', 'jello', 'gelatin', 'jelly', 'jam', 'yogurt', 'ice cream', 'pudding',
    'candy', 'gum', 'cookie', 'bar', 'mix', 'powder', 'tart', 'tarts', 'ketchup', 'dressing', 'float', 'cake', 'popsicle', 'ice pop',
];
function dietDrinkPadded(text: string): string {
    return ` ${(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
}
function hasWholeWord(padded: string, words: string[]): boolean {
    return words.some((w) => padded.includes(` ${w} `));
}
function dietDrinkReason(queryName: string, macrosPer100g?: MacroPlausibilityInput | null, headLine?: string): string | null {
    const raw = macrosPer100g?.kcal ?? macrosPer100g?.calories ?? null;
    const kcal = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(kcal) || kcal <= DIET_DRINK_MAX_KCAL) return null;
    const q = dietDrinkPadded(queryName);
    const h = headLine != null ? dietDrinkPadded(headLine) : '';
    if (hasWholeWord(q, DIET_DRINK_EXEMPT_WORDS) || (h && hasWholeWord(h, DIET_DRINK_EXEMPT_WORDS))) return null;
    if (!hasWholeWord(q, DIET_DRINK_WORDS)) return null;
    const headWords = headLine != null ? ` ${headClauseWords(headLine).join(' ')} ` : '';
    if (!DIET_DRINK_DIET_PATTERN.test(q) && !(headWords.trim() && DIET_DRINK_DIET_PATTERN.test(headWords))) return null;
    return `rank:diet_drink_kcal_${round1(kcal)}_over_${DIET_DRINK_MAX_KCAL}`;
}

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
    macrosPer100g?: MacroPlausibilityInput | null,
    /** S202: the raw line, read ONLY by the prepared-drink head rule (the rerank query can be an LLM canonical that dropped `latte`). */
    headLine?: string
): RankTimePlausibilityResult {
    const base = assessMacroPlausibility(queryName, candidateName, macrosPer100g);

    if (base.impossible) {
        return { impossible: true, floorHit: false, softPenalty: false, reasons: base.reasons };
    }

    const floorReasons = collectDeterministicFloorReasons(queryName, candidateName, macrosPer100g);
    const drinkReason = preparedDrinkReason(queryName, macrosPer100g, headLine);
    const teaReason = brewedTeaReason(queryName, macrosPer100g, headLine);
    const dietReason = dietDrinkReason(queryName, macrosPer100g, headLine);
    const reasons = [
        ...base.reasons,
        ...floorReasons,
        ...(drinkReason ? [drinkReason] : []),
        ...(teaReason ? [teaReason] : []),
        ...(dietReason ? [dietReason] : []),
    ];

    const floorHit =
        floorReasons.length > 0 ||
        drinkReason != null ||
        teaReason != null ||
        dietReason != null ||
        base.reasons.some((r) => FLOOR_GRADE_CATEGORY_PREFIXES.some((p) => r.startsWith(p)));
    const softPenalty = reasons.some((r) => r.startsWith('atwater:'));

    return { impossible: false, floorHit, softPenalty, reasons };
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}
