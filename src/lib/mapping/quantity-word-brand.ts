import { hasDecisiveBrandContext } from './simple-rerank';
import type { ParsedIngredient } from '../parse/ingredient-line';

/**
 * THE BRAND-PRESERVATION REPAIR, AND THE ONE PLACE IT MISFIRES.
 *
 * `preflightIngredientLine()` re-derives baseName whenever the segmenter's
 * normalizedForm lost a brand the raw line names. baseName is the primary search
 * term AND the `deriveMappingCacheKey()` input, so a brand-blind baseName
 * retrieves brand-blind candidates and writes a brand-blind key.
 *
 * The misfire: `one` is a lexicon brand (the ONE protein-bar company), so an
 * ordinary COUNT WORD in a quantity phrase is read as a dropped brand and
 * prepended. Measured live (read-only, 2026-08-31; re-derive:
 * `SELECT "normalizedForm", "foodName", "brandName", "usedCount" FROM "FoodMapping"
 *  WHERE "normalizedForm" ~ '(^| )one( |$)' ORDER BY "usedCount" DESC;`)
 * six keys carry a `one` token — three genuine ONE-bar keys (`birthday cake one`
 * 242 serves, `almond bliss one`, `and bar chocolate fiber oat one rolled`) and
 * three written by this misfire (`milk one` 203 -> a2 Milk, `cheese one swiss`
 * -> FDC 171251, `banana one` -> an OFF row whose brandName is literally "One").
 *
 * WHY THE OBVIOUS GATE IS REFUTED. Gating the whole repair on
 * `hasDecisiveBrandContext()` was measured on the 436 distinct
 * `SegmentationCache` (rawText, normalizedForm, brand) tuples the repair is
 * actually handed: on THIS tree it destroys 76 of the repair's 164 fires,
 * including `2 scoops ghost vegan protein` — the very line the repair's own
 * comment above names as its motivating case — plus `mcdonalds sausage mcmuffin
 * with egg`, `kraft deluxe macaroni and cheese` and `velveeta shells and
 * cheese`. It is also self-defeating on the pin: `one birthday cake protein
 * bar` is NOT decisive, so the pinned 242-serve key moves anyway. (Measured
 * 2026-08-31 against master d4f2141; re-derive with the sweep named under
 * `brandWasConsumedAsQuantity()`.)
 *
 * WHAT SEPARATES THE CLASSES IS THE PARSER'S OWN ROLE ASSIGNMENT, not a word
 * list. `parseIngredientLine()` already decided whether the brand token was a
 * quantity, a unit, or part of the food name; this asks it. That matters beyond
 * taste: `ingredient-line.ts`'s own header on `QUANTITY_WORD_NUMBERS` records
 * that a duplicated number-word list is "the bug, not the design".
 */

/**
 * Token fold used ONLY by the refusal predicate below, to compare a lexicon
 * brand spelling against the raw line and the parser's own field assignments.
 *
 * It is deliberately module-private and is NOT applied to the containment check
 * in `preserveDroppedBrand()`, which stays on this tree's plain
 * `.toLowerCase().includes()` — folding that check is a separate, larger
 * behaviour change (it stops the repair prepending a brand the text already
 * spells differently) that belongs to the brand-detection work, not here.
 * `brand-detector.ts` on this tree exports no canonicalizer to reuse; if one
 * ever lands, collapse this into it rather than keeping two folds.
 */
function foldBrandTokens(value: string): string[] {
    return value
        .toLowerCase()
        .replace(/['\u2019`]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[-.\/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
}

/**
 * True when `targetBrand` was consumed by the QUANTITY parse of `rawLine` — i.e.
 * the detector matched a token the parser had already spent as a count, so the
 * "dropped brand" is an artefact of position, not a brand the segmenter lost.
 *
 * Every clause is load-bearing and each rescues a measured case (all four
 * verified 2026-08-31 by calling the shipped `parseIngredientLine()` on master
 * d4f2141):
 *
 *  1. THE WHOLE BRAND IS IN THE RAW LINE AND NONE OF IT SURVIVED INTO
 *     `parsed.name`, and its first token LEADS the line. `1 one bar almond
 *     bliss` leads with `1`, so the parser eats the digit and leaves `one bar
 *     almond bliss` in the name — clause 1 is false and the ONE brand is kept.
 *     `fiber one` is never fully consumed either.
 *  2. NO BRAND TOKEN IS THE UNIT THE PARSER NAMED. `parseIngredientLine('squirt
 *     soda')` returns `{unit: 'squirt', rawUnit: 'squirt', name: 'soda'}` and
 *     Squirt is a real soda brand; without this clause the repair is refused and
 *     the brand is lost. The parser assigned that token the UNIT role, which is
 *     a different claim from the quantity role.
 *  3. A REAL MEASURE WORD FOLLOWS. `one birthday cake protein bar` and `one
 *     birthday cake bar` both parse with `unit: null`; without this clause the
 *     genuine ONE brand is stripped off both.
 *  4. THE BRAND IS NOT DECISIVE. `one bar birthday cake` parses `unit: 'bar'`,
 *     so clauses 1-3 all hold, but `bar` is a BRAND_PRODUCT_CONTEXT token and
 *     the brand IS decisive — this is the line behind the 242-serve pin.
 *
 * BLAST RADIUS, measured on this tree (master d4f2141, 2026-08-31) over four
 * populations, "brands lost" read line by line:
 *   - 436 real `SegmentationCache` repair inputs — the tuples the caller is
 *     actually handed: 3 of 164 fires refused, 3 cache keys moved, and all
 *     three are the known-false `one` keys (`banana one` -> `banana`,
 *     `cheese one swiss` -> `cheese swiss`, `chips cooked kettle one potato` ->
 *     `chips cooked kettle potato`).
 *   - 7,828 distinct `MappingEventLog` rawLines, forced to fire: 8 refusals of
 *     2,707 detector-branded lines (0.30%), all 8 true positives (every one
 *     leads with the numeral `one`), 0 brands lost.
 *   - 4,102-seed `coverage-corpus-2026-08-08.tsv`: 1,770 detector-branded
 *     seeds, 0 refusals.
 *   - The brand lexicon reconstructed EXACTLY (2,662 entries, reconciled
 *     against the shipped `BRAND_LIST_SIZE`), each entry probed at the head of
 *     15 carrier lines: only `one`, `7-eleven` and `7-select` can EVER satisfy
 *     this in leading position. No multi-word chain brand can, because such a
 *     brand is never fully consumed by the quantity parse.
 * Re-derive by walking each population through the shipped `parseIngredientLine()`
 * + `detectBrandInQuery()` + this function. The four sources are, in order:
 * `SELECT DISTINCT s->>'rawText', s->>'normalizedForm', s->>'brand' FROM
 * "SegmentationCache", jsonb_array_elements("segmentsJson") s`;
 * `SELECT DISTINCT "rawLine" FROM "MappingEventLog"`; column 3 of
 * `scripts/eval/coverage-corpus-2026-08-08.tsv`; and `KNOWN_BRANDS` +
 * `brand-lexicon.json`, whose union must equal the shipped `BRAND_LIST_SIZE`
 * (a regex cannot recover `KNOWN_BRANDS` — the list mixes `'a\'s'` and `"a's"`
 * on one line and a linear scan silently swallows entries).
 */
export function brandWasConsumedAsQuantity(
    rawLine: string,
    targetBrand: string,
    parsed: ParsedIngredient | null | undefined,
): boolean {
    const brandTokens = foldBrandTokens(targetBrand);
    if (brandTokens.length === 0) return false;

    const rawTokens = foldBrandTokens(rawLine);
    const nameTokens = new Set(foldBrandTokens(parsed?.name ?? ''));
    const unitTokens = new Set([
        ...foldBrandTokens(parsed?.unit ?? ''),
        ...foldBrandTokens(parsed?.rawUnit ?? ''),
    ]);

    // (1) every brand token is in the raw line, none survived into parsed.name,
    //     and the brand leads the line (the only position a quantity occupies).
    const fullyConsumed = brandTokens.every(t => rawTokens.includes(t) && !nameTokens.has(t));
    if (!fullyConsumed || rawTokens[0] !== brandTokens[0]) return false;

    // (2) consumed as the QUANTITY, not as the unit.
    if (brandTokens.some(t => unitTokens.has(t))) return false;

    // (3) a real measure word follows the count.
    if (!parsed?.unit) return false;

    // (4) and the line gives the brand no decisive product context.
    return !hasDecisiveBrandContext(rawLine, targetBrand);
}

export type BrandPreservationOutcome = {
    /** The baseName to use — unchanged unless `applied` is true. */
    baseName: string;
    /** The repair rewrote baseName. */
    applied: boolean;
    /** Set when the repair was refused; names the reason for the caller's log line. */
    declined: 'brand_consumed_as_quantity' | null;
};

/**
 * The repair itself, extracted so it can be pinned by a test rather than only
 * by a hand-written replica (project memory: a helper number must come from the
 * shipped function).
 *
 * BEHAVIOUR IS UNCHANGED FROM THE INLINE FORM IT REPLACES EXCEPT FOR THE
 * `brandWasConsumedAsQuantity()` REFUSAL. Both containment checks are the same
 * `.toLowerCase().includes()` the inline block used — deliberately, so that
 * every line the refusal does not fire on keeps its exact baseName. That
 * equivalence is pinned by `quantity-word-brand.test.ts` ("the extraction is
 * behaviour-preserving apart from the refusal"), which replays the verbatim
 * pre-extraction expression against this function over a hermetic fixture — and
 * was run over the 436 real `SegmentationCache` repair inputs on 2026-08-31:
 * 164 fires, 0 containment disagreements, 0 baseName disagreements on the 161
 * rows the refusal spared.
 */
/**
 * WHAT A DECLINE RETURNS, AND THE ONE WAY IT DIFFERS FROM master.
 *
 * master's block always re-derives (`baseName = parsed.name`) and only then
 * decides whether to prepend the brand, so the brand is the TRIGGER and the
 * re-derivation is the payload. A decline here returns `baseName` UNTOUCHED —
 * the segmenter's own `normalizedForm` — rather than the re-derivation minus
 * the prepend. That is deliberate: the refusal's premise is that the "brand"
 * was never a brand, so the block had no business firing, and `rederived` comes
 * from `preProcessLine` (the whole line, possibly canonicalizer-rewritten)
 * while `baseName` is the segment's own name.
 *
 * The cost of that choice is that a declined line could in principle lose a
 * GENUINE second brand that survived into `parsed.name` but not into the
 * segmenter's output. MEASURED 2026-08-31 over all 436 distinct
 * `SegmentationCache` (rawText, normalizedForm, brand) tuples — the only
 * non-synthetic arm, i.e. the exact inputs this function is handed in
 * production: 161 fires, 3 refusals, and on **0 of the 3** does the untouched
 * `baseName` lose any token the re-derivation would have kept. The third
 * refusal is the one that matters — `One serving of kettle cooked potato
 * chips` keeps `kettle`, a real brand, because the segmenter kept it too.
 * Re-derive by comparing tokenized `baseName` against tokenized `rederived` on
 * every row where this function returns `declined`.
 *
 * So the divergence is real in principle and unrealized in the corpus. If a
 * future population shows a loss, the fix is to return `rederived` here, NOT to
 * weaken the predicate.
 */
export function preserveDroppedBrand(args: {
    rawLine: string;
    baseName: string;
    targetBrand: string;
    /** `parsed?.name?.trim() || preProcessLine` — the mapper is proven robust on it. */
    rederived: string;
    parsed: ParsedIngredient | null | undefined;
}): BrandPreservationOutcome {
    const { rawLine, baseName, targetBrand, rederived, parsed } = args;
    const lowerBrand = targetBrand.toLowerCase();

    if (baseName.toLowerCase().includes(lowerBrand)) {
        return { baseName, applied: false, declined: null };
    }
    if (brandWasConsumedAsQuantity(rawLine, targetBrand, parsed)) {
        return { baseName, applied: false, declined: 'brand_consumed_as_quantity' };
    }
    return {
        baseName: rederived.toLowerCase().includes(lowerBrand)
            ? rederived
            : `${targetBrand} ${rederived}`.trim(),
        applied: true,
        declined: null,
    };
}
