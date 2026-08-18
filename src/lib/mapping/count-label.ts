/**
 * Count-labeled serving helpers (Cluster A pt2, Jul 2026)
 *
 * ~64k OFF records natively enumerate pieces in their label serving —
 * "14 chips (28g)", "10 pretzels (28g)", or the generic "15 pieces (28g)"
 * phrasing. When a user counts pieces ("13 tortilla chips"), that label's
 * per-piece weight (servingGrams / count) is authoritative for the SKU and
 * beats any curated seed average. These predicates power:
 *   - buildOffResult's label-count-derived serving resolution
 *   - simpleRerank's count-labeled SKU preference (COUNT_LABEL_BOOST)
 *   - the counted-piece cache escape in map-ingredient-with-fallback
 *   - retrieval: the Typesense `hasCountServing` flag (sync + backfill scripts)
 *     and the targeted secondary search in openfoodfacts/search.ts
 */

import type { ParsedIngredient } from '../parse/ingredient-line';
import { parseQuantityTokens } from '../parse/quantity';

/** Minimal unit singularizer for label/serving unit words ("scoops" → "scoop"). */
export function singularizeUnit(w: string): string {
    const s = w.toLowerCase();
    if (s.endsWith('ies')) return s.slice(0, -3) + 'y';
    if (s.endsWith('sses')) return s.slice(0, -2);
    if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
    return s;
}

/**
 * A leading label FRACTION: "1/2", or the mixed number "1 1/4".
 *
 * THE WHOLE PART IS PINNED TO 1, and that is the load-bearing part of this
 * pattern. A mixed number on a serving panel states ONE unit and a fraction;
 * measured over all 1,220 mixed-number `OffFood` labels on the box 2026-08-18,
 * 1,047 (86%) lead with `1`, and the larger whole parts are a WEIGHT glued in
 * front of the food noun rather than a count of units:
 *
 *     "4 1/4 fillet (113 g)"      -> 26.6 g/unit, i.e. 4.25 OUNCES of one fillet
 *     "8 1/2 ONZ (241 g)"         -> 28.35 g/unit, the same shape spelled out
 *     "320 1/2 package (320 g)"   -> 1.00 g/package, the GRAM figure glued on
 *     "30 1/3 Can (30 g)"         -> 0.99 g/can
 *
 * Reading those as counts divides the serving by its own weight. `1 package`
 * of `0761898375006` would bill 1 g instead of 320 g — and that record is a
 * REGRESSION rather than merely a new error, because `label_unit_match` sits
 * ahead of `label_serving_package_unit` in the branch chain, so a unit word
 * that did not exist before pre-empts a branch that was already correct.
 * `label_count_derived`'s [0.2, 500] per-piece band does not catch it either:
 * 1.00 g is inside the band. The count is what is implausible, so the count is
 * where the guard belongs.
 *
 * The numerator and denominator are `[1-9]\d*`, which refuses `0/2` and `1/0`
 * outright rather than leaving them to the qty guard below. No `\s*` is
 * allowed around the slash: "1 /3 cup (151 g)" (21 rows) must stay unreadable
 * to BOTH halves, and a pattern that accepted it would hand
 * `parseQuantityTokens` the tokens ["1","/","3"], which it cannot parse — it
 * would fall through to its plain-number path and return 1, so the unit would
 * say "cup" while the count still said one. Reintroducing that disagreement is
 * this module's own defect in miniature.
 *
 * The `(?![\d./])` lookahead refuses a CONTINUING numeric run — "1/2/3",
 * "3//4" — so a malformed shape falls back whole rather than half-parsed. It
 * is not what refuses hyphens: "1-1/4 cup" and "2-3 Tbsp" (405 rows) fail
 * earlier, because a hyphen is neither a slash nor whitespace, so neither arm
 * can start.
 */
const LABEL_FRACTION_RE = /^\s*(1\s+[1-9]\d*\/[1-9]\d*|[1-9]\d*\/[1-9]\d*)(?![\d./])/;

/** The ORIGINAL unit pattern, unchanged — the fallback both halves share. */
const LABEL_SERVING_UNIT_RE = /^\s*\d*\.?\d*\s*([a-z]+)/i;

/** The ORIGINAL leading-quantity pattern, unchanged — same fallback. */
const LABEL_PLAIN_QUANTITY_RE = /^\s*(\d+(?:\.\d+)?)/;

/**
 * The ONE place a label fraction is recognised, and the reason the unit half
 * and the count half cannot disagree about where the quantity ends: both call
 * this, so a fraction is read by BOTH of them or by NEITHER, and "neither" is
 * byte-for-byte the behaviour that shipped before this function existed.
 *
 * The arithmetic is `parseQuantityTokens`'s, reused rather than re-derived —
 * `declaredVolumeUnitGrams()` in build-fatsecret-result.ts already uses it for
 * exactly this. Only the SHAPE above is new, which is also what keeps that
 * parser's recipe-line rules (range averaging, word numbers, "a dozen") away
 * from a serving panel.
 */
function leadingLabelFraction(description: string): { qty: number; length: number } | null {
    const m = description.match(LABEL_FRACTION_RE);
    if (!m) return null;
    const parsed = parseQuantityTokens(m[1].trim().split(/\s+/));
    if (!parsed || !Number.isFinite(parsed.qty) || parsed.qty <= 0) return null;
    return { qty: parsed.qty, length: m[0].length };
}

/**
 * The unit word of a label serving description ("2 scoops" → "scoop",
 * "1 container" → "container", "1/2 cup (110 g)" → "cup").
 *
 * THE FRACTION IS NOT COSMETIC. This read only the leading token until
 * 2026-08-18: `\d*` consumed the `1` of "1/2", `/` is not `[a-z]`, and the
 * whole match failed — so 16,531 OFF records (15,152 of them a cup) and 2,422
 * FatSecret servings declared no unit at all, and every branch keyed on
 * `labelUnitWord` stayed off for them. Callers that DIVIDE by the label's
 * quantity must pair this with `labelLeadingQuantity()`: reading "1/2 cup
 * (110 g)" as one cup bills 110 g/cup for a 220 g cup.
 */
export function extractLabelServingUnit(description: string | null): string | null {
    if (!description) return null;
    const frac = leadingLabelFraction(description);
    const m = frac
        ? description.slice(frac.length).match(/^\s*([a-z]+)/i)
        : description.match(LABEL_SERVING_UNIT_RE);
    if (!m) return null;
    return singularizeUnit(m[1]);
}

/**
 * The leading quantity of a label serving, fractions included — "1/2 cup
 * (110 g)" → 0.5, "1 1/4 cup (40 g)" → 1.25, "18 chips (28 g)" → 18 — or null
 * when the label does not lead with a usable number.
 *
 * `labelLeadingCount()` below is NOT this function and could not be reused for
 * it: it is integer-only and returns null under 2, i.e. null for every shape
 * this one exists to read (build-fatsecret-result.ts:240-245 records why that
 * is deliberate, and it stays that way).
 */
export function labelLeadingQuantity(description: string | null | undefined): number | null {
    if (!description) return null;
    const frac = leadingLabelFraction(description);
    if (frac) return frac.qty;
    const m = description.match(LABEL_PLAIN_QUANTITY_RE);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
}

// Packaged-snack nouns whose OFF label serving natively enumerates pieces.
// Kept to packaged snacks where label counts are common and a single seed
// average is least reliable; whole-food produce (almond/grape/strawberry)
// stays on the curated seed table.
export const LABEL_COUNT_PIECE_NOUNS = new Set([
    'chip', 'crisp', 'cracker', 'pretzel', 'cookie',
    'wafer', 'biscuit', 'nugget', 'puff', 'tot', 'gummy',
]);

// Labels frequently enumerate with the generic counter word — "15 pieces (28 g)"
// on a pretzel bag — instead of the product noun. Those pieces ARE the matched
// product, so a generic counter counts the user's noun too (guarded by the
// callers: the item must name a LABEL_COUNT_PIECE_NOUN and the label must be
// genuinely multi-piece, count >= 2, so a "1 piece (57g)" whole-bar serving
// never masquerades as a per-piece weight).
export const GENERIC_PIECE_WORDS = new Set(['piece', 'pc']);

/**
 * LAST packaged-snack piece noun appearing in a food/item name, else null.
 *
 * Last, not first: in compound food names the flavor precedes the head noun
 * ("chocolate chip cookie" — the user counts cookies, "chip" is flavor), so
 * the first match counted the modifier. Measured 2026-08-09/12: first-match
 * fed a non-terminating cache escape ("kirkland protein bar chocolate chip"
 * counted *chip*, "built puff protein bar" counted *puff*). Identical
 * null-set to the old scan — only multi-noun names change value — so the
 * hydration lane's food-name-side callers (genericPieceNoun, the
 * package-count gate's `== null` check) keep their firing populations.
 * Known pre-existing limit, deliberately NOT changed here: singularizeUnit
 * maps "cookies" -> "cooky", which misses the set, so the PLURAL spelling
 * never contributes a cookie match either way (a separate, unmeasured fix).
 */
export function pieceNounInName(name: string): string | null {
    let last: string | null = null;
    for (const tok of (name || '').toLowerCase().split(/[^a-z&]+/)) {
        if (tok === '') continue;
        const sing = singularizeUnit(tok);
        if (LABEL_COUNT_PIECE_NOUNS.has(sing)) last = sing;
    }
    return last;
}

/** True if the label's piece word is literally one of the words the user is counting. */
export function labelPieceMatchesItem(labelWord: string | null, itemName: string): boolean {
    if (!labelWord || !itemName) return false;
    const target = singularizeUnit(labelWord);
    return itemName
        .toLowerCase()
        .split(/[^a-z&]+/)
        .some((tok) => tok !== '' && singularizeUnit(tok) === target);
}

/**
 * The piece noun the user is counting when the line is a unitless integer count
 * ("13 tortilla chips" → "chip"), else null. Mirrors buildOffResult's
 * unitless-count gate so retrieval/rerank preference and serving resolution
 * stay aligned.
 *
 * qty >= 2, not >= 1: the parser defaults a bare line ("goldfish crackers")
 * to qty=1, so qty=1 cannot distinguish "counting one piece" from "no count
 * at all", and the label side (labelLeadingCount) already demands count >= 2.
 * The 2026-07-26 triage measured the asymmetry feeding 494/664 provably
 * looping escape events; the 2026-08-09 serving-class-keys report re-measured
 * it at ~622/1,261 and named this exact change.
 */
export function countedPieceNoun(parsed: ParsedIngredient | null): string | null {
    if (!parsed || parsed.unit || !Number.isInteger(parsed.qty) || parsed.qty < 2) return null;
    return pieceNounInName(parsed.name || '');
}

/** Leading integer count of a label serving string, or null ("15 pieces (28 g)" → 15). */
export function labelLeadingCount(servingSize: string): number | null {
    const count = Number((servingSize.match(/^\s*(\d+(?:\.\d+)?)/) || [])[1]);
    return Number.isInteger(count) && count >= 2 ? count : null;
}

/**
 * True when an OFF label serving string usably enumerates the counted piece:
 * either the noun itself ("14 chips (28g)") or the generic multi-piece counter
 * ("15 pieces (28g)").
 */
export function servingLabelCountsPiece(
    servingSize: string | null | undefined,
    servingGrams: number | null | undefined,
    pieceNoun: string
): boolean {
    if (!servingSize || !servingGrams || servingGrams <= 0) return false;
    const count = labelLeadingCount(servingSize);
    if (count == null) return false;
    const labelWord = extractLabelServingUnit(servingSize);
    if (labelWord !== pieceNoun && !(labelWord && GENERIC_PIECE_WORDS.has(labelWord))) return false;
    const perPiece = servingGrams / count;
    return perPiece >= 0.2 && perPiece <= 500;
}

// ============================================================
// Discrete-item unit nouns (moved here from map-ingredient-with-fallback so
// the bare-serving guard can share the SAME lexicon — no parallel copies).
// ============================================================

/**
 * Discrete packaged-item nouns: when an item NAME names one of these and has
 * no genuine serving, the noun itself is an estimable unit ("quest protein
 * bar" → 1 bar) — sibling-borrow / AI resolve its weight rather than
 * defaulting to a flat 100g. Deliberately excludes ambiguous words like
 * "cup"/"pack"/"stick" that collide with volume/package/butter handling.
 * links/slices/tortillas added for the bare-serving defaults (Track 3, Jul
 * 2026) — same routing, they were already estimable units downstream.
 */
export const DISCRETE_ITEM_UNIT_RE = /\b(bars?|cookies?|brownies?|patties|patty|nuggets?|puffs?|wafers?|biscuits?|muffins?|links?|slices?|tortillas?)\b/i;

/** First discrete-item unit noun in a food name, singularized ("Quest Protein Bars" → "bar"). */
export function inferDiscreteUnit(name: string): string | null {
    const m = name.match(DISCRETE_ITEM_UNIT_RE);
    return m ? singularizeUnit(m[1]) : null;
}

/**
 * Bounded single-piece floors for discrete-item nouns (bare-serving defaults,
 * Jul 2026). Last-resort grams for a bare query whose NAME implies a discrete
 * piece but for which no label / seed / sibling / AI weight resolved — such a
 * food must NEVER bill the flat 100g default ("protein bar" is ~50g, not
 * 100g). Values are conservative mid-range piece weights, not label data.
 */
export const DISCRETE_PIECE_FLOOR_GRAMS: Record<string, number> = {
    bar: 50,
    cookie: 30,
    brownie: 40,
    patty: 45,
    nugget: 20,
    puff: 20,
    wafer: 15,
    biscuit: 30,
    muffin: 55,
    link: 45,
    slice: 30,
    tortilla: 45,
};

/** The bounded piece floor implied by a food name, else null. */
export function discretePieceFloor(name: string): { unit: string; grams: number } | null {
    const unit = inferDiscreteUnit(name || '');
    if (!unit) return null;
    const grams = DISCRETE_PIECE_FLOOR_GRAMS[unit];
    return grams ? { unit, grams } : null;
}

/**
 * Noun-agnostic form of servingLabelCountsPiece — does this label enumerate
 * ≥2 of ANY recognized piece word with a sane per-piece weight? Used to compute
 * the Typesense `hasCountServing` retrieval flag, where the queried noun isn't
 * known at index time.
 */
export function servingLabelHasPieceCount(
    servingSize: string | null | undefined,
    servingGrams: number | null | undefined
): boolean {
    if (!servingSize || !servingGrams || servingGrams <= 0) return false;
    const count = labelLeadingCount(servingSize);
    if (count == null) return false;
    const labelWord = extractLabelServingUnit(servingSize);
    if (!labelWord || (!LABEL_COUNT_PIECE_NOUNS.has(labelWord) && !GENERIC_PIECE_WORDS.has(labelWord))) return false;
    const perPiece = servingGrams / count;
    return perPiece >= 0.2 && perPiece <= 500;
}
