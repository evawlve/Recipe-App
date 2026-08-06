/**
 * Bare-query serving guard for the OFF result builder (PR D pt3, Lever A;
 * extended for bare-serving defaults, Track 3, Jul 2026).
 *
 * A "bare" query is a unitless qty-1 request with no digits in the raw line
 * ("olive oil", "doritos", "bacon") — the user asked for *a serving*, not a
 * package. Deterministic resolution order for such requests (triage batch
 * 2026-07-21, 82 confirmed serving rows):
 *   (1) the record's OWN in-band label serving (usableBareLabelServing,
 *       billed by buildOffResult as tier 'bare_label_serving');
 *   (2) a count-noun piece weight when the NAME implies a discrete piece
 *       (buildOffResult's seed / discrete-unit-backfill branches);
 *   (3) the same-brand sibling median label serving ('bare_sibling_serving');
 *   (4) a bounded floor — NEVER flat-100g for a discrete-piece name
 *       ('bare_discrete_floor', wired below in the REPLACE path).
 * This module owns the eligibility predicate, the label-usability band, and
 * the post-cascade override (CAP / REPLACE / floor). Pure functions, no I/O.
 *
 * 'bare_name_sibling_serving' (N1, Aug 2026), its downward twin
 * 'bare_name_sibling_serving_tight' and the bare-plural arm
 * 'bare_name_sibling_serving_plural' are DELIBERATELY absent from every tier set
 * below, and that is not an omission to fix. That rung runs AFTER this guard —
 * it is gated on the guard having already declined (tier still
 * 'count_unresolved_floor') — so any membership here would be dead code. Adding
 * any of them would also re-create the pre-emption bug the rung was placed low
 * to avoid: see the (E) rung comment in buildOffResult
 * (mapping/serving/hydration-lane.ts).
 *
 * The three are ONE rung stamping THREE tiers. The first two split by the
 * DIRECTION the median moved the bill — up off the floor, or down into a
 * measured-tight name group. The third splits on the REQUEST SHAPE instead: a
 * bare plural takes the tight test in both directions, so it needs no direction
 * suffix (the rung only runs where grams is the flat 100 literal, so its own
 * grams read the direction). They are not a hit/miss family and none implies
 * anything about caching; the `_cached`-sibling naming convention that misled a
 * previous instrument does not apply here.
 *
 * Note the plural arm is a DELIBERATE narrowing of isBarePluralRequest's reach,
 * not a bypass. That predicate suppresses PER-PIECE resolution (see its own
 * docstring); the name-median rung is serving-scale, which is precisely what it
 * says such requests should fall through to.
 */

import type { ParsedIngredient } from '../parse/ingredient-line';
import { getBareQueryDefault } from '../ai/ambiguous-serving-estimator';
import { discretePieceFloor, singularizeUnit } from '../mapping/count-label';

/**
 * Tiers whose grams come from real package/label machinery and can only be
 * CAPPED, never inflated: the override fires only when the billed grams exceed
 * 2x the category default, so genuine single-serving labels (ketchup 15g,
 * peanut butter 32g) pass through untouched.
 */
const CAP_TIERS = new Set([
    'package_count_own',
    'package_count_sibling',
    'package_quantity_own',
    'package_quantity_sibling',
    'label_serving_default',
    // Seed-table per-piece grams can hijack a bare query whose name merely
    // CONTAINS a countable noun ("black pepper" → the 164g bell-pepper seed).
    // Real count servings sit under 2x the category default and pass through.
    'seed_count_default',
]);

/**
 * Tier billed from the record's own in-band label serving — real
 * single-serving-scale data (bare-serving defaults, Jul 2026). The category
 * CAP may only override it when the lexicon category is the query's HEAD
 * noun ("olive oil" → oil, whole-bottle labels still capped). A merely
 * CONTAINED token must not cap it: "pepper jack" (spice hijack → 2.5g) and
 * "pumpkin spice latte" (→ 2.5g) previously lost their genuine label
 * servings to token-containment caps (triage 2026-07-21).
 *
 * 'bare_sibling_serving' is deliberately UNTOUCHED (not merely head-gated):
 * the median of >=3 sibling label servings, band-limited to 3–400g and
 * excluding the flat-100 placeholder, is stronger evidence than a category
 * default — capping it re-breaks trailing-lexicon-noun dishes ("hot pocket
 * ham and cheese" → 28g cheese cap over the 127g pocket median).
 */
const HEAD_GATED_CAP_TIERS = new Set([
    'bare_label_serving',
]);

/**
 * Fabricated tiers — the grams are a made-up floor, not label data — so a
 * category default is strictly better in BOTH directions (mayonnaise 100→14,
 * coca cola 100→355).
 */
const REPLACE_TIERS = new Set([
    'flat_100g_default',
    'count_unresolved_floor',
]);

/** Band for trusting a record's own label serving on a bare request. */
export const BARE_LABEL_MIN_GRAMS = 3;
export const BARE_LABEL_MAX_GRAMS = 400;

/**
 * Seed per-piece weights below this never answer a bare qty-1 request on
 * their own: "barebells caramel cashew" must not bill one 1.5g cashew, and
 * bare "almond" means a serving of almonds, not a 1.2g nut. Pieces at or
 * above it (banana 118g, egg 50g, bagel) ARE the serving and pass through.
 */
export const BARE_MIN_PIECE_SERVING_GRAMS = 20;

/**
 * Eligibility for every bare-serving lever: unitless qty-1, multiplier 1, no
 * digit anywhere in the raw line. The digit gate keeps every explicit count
 * ("1 gatorade", "3 almonds", "15 pretzels") on the counted-resolution path.
 */
export function isBareUnitlessQty1(parsed: ParsedIngredient | null, rawLine: string): boolean {
    if (!parsed || parsed.unit || parsed.qty !== 1 || parsed.multiplier !== 1) return false;
    if (/\d/.test(rawLine)) return false;
    return true;
}

/**
 * Foods whose bare NAME is already a portion word even though it is not
 * morphologically plural — "popcorn", "granola", "trail mix". Same intent as
 * the plural test: the user named a serving, not a piece.
 */
const BARE_PLURAL_STYLE_NAMES = /\b(goldfish|chex mix|trail mix|popcorn|granola)\b/i;

/**
 * True when the token is a plain -s plural. singularizeUnit alone is NOT a
 * plural test: 'hummus'→'hummu', 'couscous'→'couscou', 'molasses'→'molass'
 * all change without being plural. Require an -s ending that is not one of
 * the pseudo-plural shapes 'ss' (swiss), 'us' (hummus/couscous), 'is'
 * (debris), 'sses' (molasses — the plain 'ss' check misses it).
 */
function isMorphologicalPluralToken(token: string): boolean {
    const t = token.toLowerCase();
    if (t.length < 3 || !t.endsWith('s')) return false;
    if (t.endsWith('ss') || t.endsWith('us') || t.endsWith('is') || t.endsWith('sses')) return false;
    return singularizeUnit(t) !== t;
}

/**
 * A digitless qty-1 PLURAL request ("almonds", "goldfish"): the user asked for
 * A SERVING, not one piece. Every per-piece resolution branch must be
 * suppressed for these — one almond is 1.2 g against a 28 g serving, one grape
 * 5 g — and resolution must fall through to serving-scale tiers.
 *
 * THIS PREDICATE LIVES HERE, NOT IN A BUILDER. It was defined inside
 * `map-ingredient-with-fallback.ts` and called from exactly one place, the OFF
 * cascade; `buildFatSecretResult` could not even import it without an import
 * cycle, so the FatSecret count branch had no bare-plural suppression at all
 * and billed bare `almonds` at 1.2 g (measured 2026-08-01 by the winner-gate,
 * 28 g `bare_plural_serving` → 1.2 g `fs_label_count`). That is the same defect
 * shape as the volume-density hand-copies: a rule maintained in one of N
 * cascades. This module already owns the bare-request eligibility predicates
 * and is imported by every builder — one owner, every caller.
 */
export function isBarePluralRequest(
    parsed: ParsedIngredient | null,
    rawLine: string,
    itemNameForCount: string
): boolean {
    if (!parsed || parsed.unit || parsed.qty !== 1) return false;
    if (/\d/.test(rawLine)) return false;
    const tokens = (parsed.name || '').trim().split(/\s+/).filter(t => t.length > 0);
    const lastFoodToken = tokens[tokens.length - 1] ?? '';
    return isMorphologicalPluralToken(lastFoodToken) || BARE_PLURAL_STYLE_NAMES.test(itemNameForCount);
}

/**
 * The record's own label serving, when it is usable as THE answer to a bare
 * request: single-serving-scale (3–400g) and not a per-100g placeholder.
 *
 *   - EU per-100g panels are routinely registered as a "serving" ("100 g",
 *     "100.0g", "1 portion (100 g)") — exactly 100g with no household unit
 *     word is treated as a placeholder, NOT a label (snickers/mascarpone/
 *     gorgonzola class). A genuine "1 cup (100 g)" passes via its unit word.
 *   - Sub-3g servings with no unit word are garbage metadata ("1.0g" on a
 *     whole trout / hot pocket) — the band rejects them so the sibling
 *     median can answer instead.
 */
export function usableBareLabelServing(
    servingGrams: number | null | undefined,
    labelUnitWord: string | null,
): number | null {
    if (!servingGrams || servingGrams <= 0) return null;
    if (servingGrams < BARE_LABEL_MIN_GRAMS || servingGrams > BARE_LABEL_MAX_GRAMS) return null;
    if (servingGrams === 100 && (labelUnitWord == null || labelUnitWord === 'g' || labelUnitWord === 'portion')) {
        return null;
    }
    return servingGrams;
}

function queryTokens(queryName: string): string[] {
    return (queryName || '').toLowerCase().split(/[^a-z]+/).filter(t => t.length > 0);
}

/** Last alphabetic token of a query name ("pumpkin spice latte" → "latte"). */
function queryHeadToken(queryName: string): string {
    const toks = queryTokens(queryName);
    return toks[toks.length - 1] ?? '';
}

/**
 * How many words a query may have before its own matched record's DECLARED label
 * serving outranks a lexicon category default.
 *
 * A lexicon category describes a bare ingredient, and a bare ingredient is named
 * in one or two words: "salt", "black pepper", "olive oil", "brown sugar". Three
 * or more words means the user named a PRODUCT, and a product's manufacturer
 * serving beats a category guess about one token inside its name.
 *
 * Measured on the box 2026-07-27 — every one of these had real label data that
 * the CAP destroyed, because the cap threshold is `categoryDefault x 2` and for
 * the 2.5g spice category that is FIVE GRAMS, i.e. below every real packaged food:
 *
 *   mac and cheese              bare_label_serving   113.4g -> 28g   (cheese, 28g)
 *   rxbar chocolate sea salt    label_serving_default   52g -> 2.5g  (salt, 2.5g)
 *   quaker instant rolled oats apple cinnamon         43g -> 2.5g   (cinnamon)
 *   ryse loaded protein cinnamon                    34.2g -> 2.5g   (cinnamon)
 *   pumpkin spice granola       fs_default_serving      29g -> 2.5g  (spice)
 *   talenti sea salt caramel    fs_default_serving     128g -> 2.5g  (salt)
 *
 * In every case the lexicon token names the FLAVOUR, not the food. A 2x band on
 * a 2.5g anchor is not a band; it clamps everything.
 */
const CAP_MAX_QUERY_TOKENS = 2;

/**
 * Dose-anchored queries get one extra token ("ghost pre workout"), because the
 * dose default is the whole point for them and the phrase needs its final token
 * to trigger. Beyond that the same product logic applies: "rxbar chocolate sea
 * salt" is dose-anchored by the letter of `isDoseAnchoredBareQuery` — its head
 * token IS "salt" — and is obviously not a teaspoon of salt.
 */
const CAP_MAX_DOSE_ANCHORED_TOKENS = 3;

/**
 * Tiers whose grams are the manufacturer's DECLARED SERVING for this record.
 * Only these are protected by the query-token rule.
 *
 * The distinction is the whole point. A declared serving is data about one
 * serving; a PACKAGE-scale tier (package_count_*, package_quantity_*) is a count
 * of the whole container, and capping those is exactly what the guard is for. The
 * first draft of this fix protected every CAP tier by token count, and the
 * winner-gate caught the cost immediately: `orgain organic protein powder`
 * (4 tokens) went 35g -> 325.3g via package_count_sibling, billing 1,168 kcal for
 * one scoop of protein powder. The 35g cap there was correct and stays.
 */
const DECLARED_LABEL_TIERS = new Set([
    'label_serving_default',   // also the alias for fs_default_serving
    'bare_label_serving',
]);

/**
 * May a lexicon category default overwrite these grams?
 *
 * Governs the CAP paths only. The REPLACE paths are untouched: there the grams
 * are fabricated (a flat 100g placeholder or a count floor), so a category
 * default is strictly better and no label data is at risk.
 */
export function capMayOverrideLabelServing(queryName: string, servingTier?: string): boolean {
    // Package-scale grams are not a declared serving; cap them as before.
    if (servingTier !== undefined && !DECLARED_LABEL_TIERS.has(servingTier)) return true;
    const n = queryTokens(queryName).length;
    if (n <= CAP_MAX_QUERY_TOKENS) return true;
    return isDoseAnchoredBareQuery(queryName) && n <= CAP_MAX_DOSE_ANCHORED_TOKENS;
}

/**
 * Dose-measured lexicon categories: the bare-query default is a tsp/tbsp/scoop
 * DOSE, not a piece or package ("1 tsp" sugar/spices, "1 tbsp" condiments,
 * "2 tbsp" nut butters, "1 scoop" pre-workout / protein powders).
 */
const DOSE_MEASURE_RE = /\b(tsp|tbsp|scoop)\b/i;

/**
 * True when a bare query belongs to a scoop/spoon-dosed lexicon category AND
 * that category is anchored at the query's TAIL — i.e. the category noun IS
 * what the user asked for, not a contained modifier.
 *
 * For these foods the product's own label serving / sibling median is the
 * WRONG rank-1 answer to a bare request: a sugar record's 104g cup-measure
 * label or Ghost's 32.5g two-scoop sibling median must not outrank the
 * teaspoon/scoop dose default (eval regressions n-serv-37 / n-serv-43,
 * 2026-07-21). buildOffResult skips the own-label and sibling-median steps
 * when this holds, so resolution flows to the label/package tiers where the
 * category CAP restores the dose default — exactly the pre-Track-3 path.
 *
 * Anchoring (reuses getBareQueryDefault — no parallel lexicon):
 *   - the LAST token alone triggers the same category ("sugar", "oil",
 *     "ketchup", peanut BUTTER); or
 *   - the last TWO tokens trigger it while the second-to-last alone does NOT
 *     ("pre workout", "greens powder" — the phrase needs its final token).
 * Contained-token hijacks stay un-anchored: "pepper jack" (the spice match
 * survives without "jack"), "butter chicken", "pumpkin spice latte" — their
 * genuine label servings keep winning.
 */
export function isDoseAnchoredBareQuery(queryName: string): boolean {
    const full = getBareQueryDefault(queryName);
    if (!full || !DOSE_MEASURE_RE.test(full.description)) return false;
    const toks = (queryName || '').toLowerCase().split(/[^a-z]+/).filter(t => t.length > 0);
    if (toks.length === 0) return false;

    const last1 = getBareQueryDefault(toks[toks.length - 1]);
    if (last1 && last1.grams === full.grams) return true;

    if (toks.length >= 2) {
        const last2 = getBareQueryDefault(toks.slice(-2).join(' '));
        const penult = getBareQueryDefault(toks[toks.length - 2]);
        if (last2 && last2.grams === full.grams && !(penult && penult.grams === full.grams)) {
            return true;
        }
    }
    return false;
}

export interface BareQueryGuardInput {
    /** Grams billed by the tier cascade. */
    grams: number;
    /** Telemetry tier stamped by the cascade branch that billed the grams. */
    servingTier: string | undefined;
    parsed: ParsedIngredient | null;
    rawLine: string;
    /** Query-side name (parsed.name), used for both CAP and REPLACE lookups. */
    queryName: string;
    /** Matched product's name, used as a REPLACE-only lexicon fallback. */
    foodName: string;
    /**
     * The billed serving's own description ("1 tbsp", "1 medium", "1 cracker").
     * Read ONLY by the dose-count reconciliation below, which requires a
     * spoon/scoop word on both sides — so a caller that omits it loses that
     * rule and nothing else.
     */
    servingDescription?: string | null;
}

export interface BareQueryGuardOverride {
    grams: number;
    servingTier: string;
    servingDescription: string;
}

/**
 * Returns an override for a bare-query serving that the tier cascade resolved
 * to package-scale or fabricated grams, or null when the caller should keep
 * its original result. Kill-switch: OFF_BARE_SERVING_GUARD='0'.
 */
export function applyOffBareQueryGuard(input: BareQueryGuardInput): BareQueryGuardOverride | null {
    if (process.env.OFF_BARE_SERVING_GUARD === '0') return null;

    const { grams, servingTier, parsed, rawLine, queryName, foodName, servingDescription } = input;

    // Eligibility: bare unitless qty-1 request only. The digit gate keeps every
    // explicit count out ("15 pretzels" must retain its count_unresolved_floor
    // backstop, "3 almonds" its per-piece resolution).
    if (!isBareUnitlessQty1(parsed, rawLine)) return null;
    if (!servingTier) return null;

    const queryDefault = getBareQueryDefault(queryName);

    // A multi-word PRODUCT query keeps its record's DECLARED label serving: the
    // manufacturer's number outranks a category guess made from one token inside
    // the product's name. Package-scale tiers are unaffected — capping those is
    // what the guard is for. The REPLACE path below is untouched entirely, since
    // there the grams are fabricated and nothing real is being overwritten.
    const capAllowed = capMayOverrideLabelServing(queryName, servingTier);

    // DOSE-COUNT RECONCILIATION — deliberately NOT a floor direction.
    //
    // A floor was the obvious answer to bare `peanut butter` billing 16g against
    // the lexicon's 32g, and it is wrong twice over. It does not even fire:
    // 16 is EXACTLY 32/2 and the condition would be `grams < queryDefault/2`.
    // And measured over 18,456 FatSecret default servings, the 660 rows below
    // half the category default are mostly records being RIGHT — a floor would
    // take `flour tortilla` 13g -> 120g (matching the lexicon on "flour"),
    // `water spinach` 30g -> 240g, `milk bread` 36g -> 240g, `lemonade powder`
    // 18g -> 355g. All are <=2-token names, so `capMayOverrideLabelServing()`
    // cannot block them: the cap's damage lives in long product queries, the
    // floor's in short generic ones, and the existing gate points the wrong way.
    // The guard being CAP-only is a correct asymmetry, not an oversight — a
    // declared serving is data and the lexicon is a guess, and downward that
    // guess is wrong more often than right.
    //
    // What is actually wrong for peanut butter is narrower. Both sides agree the
    // food is billed in tablespoons and that a tablespoon is ~16g; they disagree
    // only on HOW MANY a bare request means. That is a claim about user intent,
    // where the lexicon is the right authority and the record has no view.
    //
    // So this rule never reads the lexicon's GRAMS. It reads its COUNT and
    // multiplies the record's OWN per-unit grams. Worst case is an integer
    // multiple of a number the record itself published.
    //
    // The guard that makes the hijack class IMPOSSIBLE rather than unlikely is
    // the LEXICON-side parse, not the record-side one — measured, by mutating
    // each away in turn. Those four queries' bare defaults are "1 cup" (flour
    // tortilla, water spinach, milk bread) and "1 can" (lemonade); none is a
    // spoon/scoop dose, so the rule exits before the record is consulted, and
    // dropping the same-unit-word check leaves all four still blocked. Only the
    // nut-butter category pairs a spoon word with a count above 1, which is what
    // confines this rule to 9 of 18,456 records.
    //
    // Measured 2026-08-02: 9 of 18,456 records reach it, all peanut butter —
    // only the nut-butter category has a lexicon count > 1, which confines the
    // rule by construction.
    if (DECLARED_LABEL_TIERS.has(servingTier)
        && capAllowed
        && queryDefault
        && isDoseAnchoredBareQuery(queryName)) {
        const lex = /^\s*(\d+)\s+(tsp|tbsp|scoop)s?\b/i.exec(queryDefault.description);
        const rec = /^\s*(\d+(?:\.\d+)?)\s*(tsp|tbsp|scoop)s?\b/i.exec(servingDescription ?? '');
        if (lex && rec && lex[2].toLowerCase() === rec[2].toLowerCase()) {
            const lexCount = Number(lex[1]);
            const recCount = Number(rec[1]);
            if (recCount > 0 && lexCount > recCount) {
                const scaled = grams * (lexCount / recCount);
                return {
                    grams: scaled,
                    servingTier: 'bare_dose_count_reconciled',
                    servingDescription: `${lexCount} ${rec[2].toLowerCase()} (~${scaled}g)`,
                };
            }
        }
    }

    if (CAP_TIERS.has(servingTier)) {
        // CAP consults ONLY the query-side lexicon. A foodName fallback here
        // would make any OFF name containing a lexicon token ("Chocolate Chip
        // …", "… Crisps") cap a genuine label serving the user never named.
        if (capAllowed && queryDefault && grams > queryDefault.grams * 2) {
            return buildOverride(queryDefault.grams);
        }
        return null;
    }

    if (HEAD_GATED_CAP_TIERS.has(servingTier)) {
        // Own-label / sibling-median grams are real single-serving-scale data.
        // The CAP may fire only when the lexicon category is anchored at the
        // query HEAD ("olive oil" → oil: a 250g whole-bottle "serving" still
        // caps to 14g). Contained-token hijacks (pepper jack, butter chicken)
        // keep the label.
        //
        // Head-anchoring alone is NOT sufficient, which is why the token rule is
        // and'ed in: "mac and cheese" has "cheese" as its literal head token, so
        // this branch capped a genuine 113.4g label serving to the 28g one-ounce
        // cheese default and billed 40 kcal for a ~400 kcal dish.
        if (capAllowed
            && queryDefault
            && getBareQueryDefault(queryHeadToken(queryName)) != null
            && grams > queryDefault.grams * 2) {
            return buildOverride(queryDefault.grams);
        }
        return null;
    }

    if (REPLACE_TIERS.has(servingTier)) {
        // Fabricated grams: the foodName fallback is safe here (nothing real is
        // being overridden) and lets branded queries hit via the product name
        // ("doritos" → "… Tortilla Chips").
        const def = queryDefault ?? getBareQueryDefault(foodName);
        if (def) {
            return buildOverride(def.grams);
        }
        // Bounded discrete floor (Track 3, Jul 2026): a name that implies a
        // discrete piece must NEVER bill the flat 100g default — one sensible
        // piece is strictly closer ("kirkland protein bar …" → ~50g bar).
        const floor = discretePieceFloor(queryName) ?? discretePieceFloor(foodName);
        if (floor) {
            return {
                grams: floor.grams,
                servingTier: 'bare_discrete_floor',
                servingDescription: `1 ${floor.unit} (~${floor.grams}g)`,
            };
        }
    }

    return null;
}

function buildOverride(grams: number): BareQueryGuardOverride {
    return {
        grams,
        servingTier: 'bare_category_default',
        servingDescription: `1 serving (~${grams}g)`,
    };
}
