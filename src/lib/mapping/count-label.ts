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

/** Minimal unit singularizer for label/serving unit words ("scoops" → "scoop"). */
export function singularizeUnit(w: string): string {
    const s = w.toLowerCase();
    if (s.endsWith('ies')) return s.slice(0, -3) + 'y';
    if (s.endsWith('sses')) return s.slice(0, -2);
    if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
    return s;
}

/** The unit word of a label serving description ("2 scoops" → "scoop", "1 container" → "container"). */
export function extractLabelServingUnit(description: string | null): string | null {
    if (!description) return null;
    const m = description.match(/^\s*\d*\.?\d*\s*([a-z]+)/i);
    if (!m) return null;
    return singularizeUnit(m[1]);
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

/** First packaged-snack piece noun appearing in a food/item name, else null. */
export function pieceNounInName(name: string): string | null {
    for (const tok of (name || '').toLowerCase().split(/[^a-z&]+/)) {
        if (tok === '') continue;
        const sing = singularizeUnit(tok);
        if (LABEL_COUNT_PIECE_NOUNS.has(sing)) return sing;
    }
    return null;
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
 */
export function countedPieceNoun(parsed: ParsedIngredient | null): string | null {
    if (!parsed || parsed.unit || !Number.isInteger(parsed.qty) || parsed.qty < 1) return null;
    return pieceNounInName(parsed.name || '');
}

/** Leading integer count of a label serving string, or null ("15 pieces (28 g)" → 15). */
function labelLeadingCount(servingSize: string): number | null {
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
