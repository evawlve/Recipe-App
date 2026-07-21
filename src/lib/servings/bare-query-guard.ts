/**
 * Bare-query serving guard for the OFF result builder (PR D pt3, Lever A).
 *
 * A "bare" query is a unitless qty-1 request with no digits in the raw line
 * ("olive oil", "doritos", "bacon") — the user asked for *a serving*, not a
 * package. Two failure classes in buildOffResult's tier cascade betray that
 * intent:
 *   - package/label tiers billing the whole retail unit (olive oil → 250g
 *     bottle, ghost pre-workout → 473g tub);
 *   - fabricated tiers billing a flat floor (mayonnaise → 100g, bacon → 100g).
 * This module maps such results onto the shared bare-query category lexicon
 * (getBareQueryDefault). Pure function, no I/O; the caller wires it in after
 * the tier cascade and keeps its original result on a null return.
 */

import type { ParsedIngredient } from '../parse/ingredient-line';
import { getBareQueryDefault } from '../ai/ambiguous-serving-estimator';

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
 * Fabricated tiers — the grams are a made-up floor, not label data — so a
 * category default is strictly better in BOTH directions (mayonnaise 100→14,
 * coca cola 100→355).
 */
const REPLACE_TIERS = new Set([
    'flat_100g_default',
    'count_unresolved_floor',
]);

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
    if (!parsed || parsed.unit || parsed.qty !== 1 || parsed.multiplier !== 1) return null;
    if (/\d/.test(rawLine)) return null;
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

    if (REPLACE_TIERS.has(servingTier)) {
        // Fabricated grams: the foodName fallback is safe here (nothing real is
        // being overridden) and lets branded queries hit via the product name
        // ("doritos" → "… Tortilla Chips").
        const def = queryDefault ?? getBareQueryDefault(foodName);
        if (def) {
            return buildOverride(def.grams);
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
