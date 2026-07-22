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
 */

import type { ParsedIngredient } from '../parse/ingredient-line';
import { getBareQueryDefault } from '../ai/ambiguous-serving-estimator';
import { discretePieceFloor } from '../mapping/count-label';

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

/** Last alphabetic token of a query name ("pumpkin spice latte" → "latte"). */
function queryHeadToken(queryName: string): string {
    const toks = (queryName || '').toLowerCase().split(/[^a-z]+/).filter(t => t.length > 0);
    return toks[toks.length - 1] ?? '';
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

    const { grams, servingTier, parsed, rawLine, queryName, foodName } = input;

    // Eligibility: bare unitless qty-1 request only. The digit gate keeps every
    // explicit count out ("15 pretzels" must retain its count_unresolved_floor
    // backstop, "3 almonds" its per-piece resolution).
    if (!isBareUnitlessQty1(parsed, rawLine)) return null;
    if (!servingTier) return null;

    const queryDefault = getBareQueryDefault(queryName);

    if (CAP_TIERS.has(servingTier)) {
        // CAP consults ONLY the query-side lexicon. A foodName fallback here
        // would make any OFF name containing a lexicon token ("Chocolate Chip
        // …", "… Crisps") cap a genuine label serving the user never named.
        if (queryDefault && grams > queryDefault.grams * 2) {
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
        if (queryDefault
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
