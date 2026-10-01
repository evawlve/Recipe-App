import { hasDecisiveBrandContext, candidateMatchesTargetBrand } from './simple-rerank';
import { detectBrandInQuery } from './brand-detector';
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
 * Token fold shared by the refusal predicate below and by clause 3 of
 * `brandAlreadyPresent()`: lowercase, apostrophes (straight, curly, backtick)
 * removed, `&` spelled `and`, hyphens, dots and slashes split into words. It
 * stays module-private. `brand-detector.ts` on this tree exports no
 * canonicalizer to reuse; if one ever lands, collapse this into it rather than
 * keeping two folds.
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
 * A trailing `s` after at least three word characters, dropped: `jerrys` ->
 * `jerry`, `poptarts` -> `poptart`. The length bar is the one
 * `repairDroppedBrand()`'s plural rule has always used.
 */
function dropPluralS(token: string): string {
    return token.replace(/(?<=\w{3})s$/, '');
}

/**
 * "IS THE BRAND ALREADY PRESENT?" — ONE SET OF CLAUSES FOR BOTH GUARDS IN THIS FILE
 * (punch #167, 2026-09-14). Guard 2 asks this function; since the S51 fix-forward
 * guard 1 asks `brandPresentForPrepend()`, the same clauses with clause 2 kept only
 * for a brand that folds to more than one word.
 *
 * Guard 1 (`preserveDroppedBrand()`) used to ask with a contiguous
 * `.toLowerCase().includes()` and guard 2 (`repairDroppedBrand()`) with an
 * alphanumeric fold plus a plural rule, so the same text carried a brand for one
 * guard and lacked it for the other. Guard 1 then prepended the brand to a line
 * that already spelled it — `M&M's m and ms pretzel`, `Optimum Nutrition optimum
 * weigh nutrition protein` — and the normalize model deduped the doubled brand
 * away, taking a food token (`weigh`) or the brand itself (`pad thai`) with it.
 *
 * PRESENT WHEN ANY CLAUSE HOLDS. Clause 1 is guard 1's old test verbatim; clause 2
 * is guard 2's old test with its plural rule written as `dropPluralS()`, which is
 * equivalent on the alphanumeric fold's `[a-z0-9]` strings. So neither guard reads
 * a brand absent that it used to read present; only clause 3 is new.
 *   1. contiguous, case-insensitive — guard 1's old test;
 *   2. contiguous after an alphanumeric fold, plural-tolerant — guard 2's old
 *      test (`Pop-Tarts` in `pop tart`, `m&ms` in `m m's`);
 *   3. every folded brand WORD present, in any order, plural-tolerant — `&`
 *      against `and`, straight or curly apostrophes, and brand words a typo or a
 *      flavour split apart.
 *
 * WHY WORDS, AND WHY THE PLURAL RULE. Measured 2026-09-14 over the doubling rows
 * of the committed 1,553-row `AiNormalizeCache` census (selection:
 * `scripts/eval/punch-167-composite-arm/s49row3_predicate.ts --set`, 11 rows /
 * 83 serves; replay: `s50_guard1_census.ts` in the same directory): guard 1
 * doubled all 11 before this change and none after; guard 2 doubled one
 * (`M&M's` against `m and ms pretzel`, 24 serves) and none after. On the seven
 * rows `s49row3_tokenizer_probe.ts` scores, a contiguous `&`/apostrophe fold
 * (#407's kept branch `903dd09`) still doubles 3 (21 serves), and a word test
 * without the plural rule still doubles `Ben & Jerry's` against `and ben jerry`
 * (19). Two of the 11 census rows are the selection's own over-reads — `carls jr
 * big carl` and `chips ahoy chewy chocolate chip cookies`, where the whole phrase
 * is the brand and nothing was doubled [reasoning, from the rows].
 *
 * WHAT IT DOES NOT ACCEPT: a brand of which only some words are present —
 * `Optimum Nutrition` in `optimum protein`, `Great Value` in `great northern
 * beans`. A first-word test (`candidateMatchesTargetBrand()`) calls both present,
 * which on guard 1 would leave the retrieval query brand-blind. Guard 2 keeps
 * that first-word leniency in front of this predicate; see `repairDroppedBrand()`.
 *
 * A wider "present" never adds a brand. What it can cost is a line whose every
 * brand word happens to appear as an ordinary word (`real foods` in `best foods
 * real mayonnaise`); the reads over the real `SegmentationCache` inputs and over
 * the coverage corpus are in the mobile report
 * `sync-docs/reports/2026-09-14_lane-a-s50-punch-167-with-its-gate.md` §ROW 2.
 */
export function brandAlreadyPresent(text: string | undefined, brand: string): boolean {
    return brandPresentByClauses(text, brand, true);
}

/**
 * GUARD 1'S QUESTION: CLAUSE 2 ONLY FOR A BRAND THAT FOLDS TO MORE THAN ONE WORD
 * (punch #167 fix-forward, Lane A S51, 2026-09-15).
 *
 * `preserveDroppedBrand()` asks this, `repairDroppedBrand()` keeps asking
 * `brandAlreadyPresent()`. The one difference is clause 2 on a ONE-WORD brand.
 *
 * WHAT #167 BROKE. Clause 2's alphanumeric contiguity finds a one-word brand
 * inside a line that spells it as two words: `brandAlreadyPresent('rx bars',
 * 'rxbar')` is true. On guard 1 that drops a prepend retrieval needed. The golden
 * line `2 rx bars` (n-supp-22; items-form brand `rxbar`, normalizedForm `protein
 * bar`) recorded MEL `normalizedForm` `rxbar rx bars` -> RXBAR `off_0193908001672`
 * in the 2026-09-12 PDT cold runs and `rx bars` -> "Fig Bars" `fs_38893` after
 * #167's deploy (2026-09-14 PDT), and failed all three restarted cold golden runs
 * there. The line carries `rx` and `bars` but never the token `rxbar`, so the
 * prepend is the only brand token retrieval gets [reasoning]: a doubled-looking
 * brand can be load-bearing. The class is a ONE-WORD brand that only clause 2
 * reads as present; on it this predicate reads exactly as guard 1 did before #167
 * (clause 1 only). A one-word brand clause 3 reads (`hershey s kisses` for
 * `Hershey's`) stays present.
 *
 * WHY NOT DROP CLAUSE 2 FOR EVERY BRAND. Measured 2026-09-15 over the 266 guard-1
 * inputs the shipped mapper builds from the 602 distinct `SegmentationCache`
 * tuples (captured under the composite arm's write guard, replayed pure;
 * `scripts/eval/punch-167-composite-arm/s51_*`): no input is a member of this
 * class, and this predicate changes 0 of the 266 outcomes against
 * `brandAlreadyPresent()`. Dropping clause 2 for every brand changes 2 and
 * re-doubles 1 — `Ben & Jerry's` on `ben jerry`, which only clause 2 reads
 * (`benjerrys` -> `benjerry`). The committed 1,553-row census reads guard 1 0/0
 * and guard 2 0/0 either way.
 *
 * WHAT THE CLASS ALSO HOLDS, AND WHAT "0 MEMBERS" DOES NOT COVER (refuter lenses on
 * backend #439, 2026-09-15). The 0 is over CACHED segmenter draws. A draw that names a
 * one-word brand the line spells as two words would now prepend where the record is
 * keyed on the two words (`sunchips` on `sun chips harvest cheddar`, `realgood` on
 * `real good chicken tenders`), moving the line to an empty key; MEL history holds no
 * such draw, and the only recorded prepend of this shape is the golden `rxbar`. And
 * skipping clause 2 for a one-word brand also ends its substring reads of an absent
 * brand (`vans` in `vanilla`, `ken's` in `heineken`) — one of which had been hiding the
 * `one` count-word misfire: `one bacon egg and cheese sandwich` (brand `one`, no unit)
 * prepends again, as it did before #167. That shape reached guard 1 in 0 of the 266
 * captured inputs.
 *
 * WHY GUARD 2 KEEPS CLAUSE 2 FOR ONE-WORD BRANDS. Its input is the model's own
 * output, where a prepend is the doubling itself (PR #421's `m&ms` against
 * `m m's` must stay kept), and nothing measured asks it to change.
 */
export function brandPresentForPrepend(text: string | undefined, brand: string): boolean {
    return brandPresentByClauses(text, brand, false);
}

function brandPresentByClauses(
    text: string | undefined,
    brand: string,
    clause2ForOneWordBrands: boolean,
): boolean {
    // (1) contiguous and case-insensitive: guard 1's whole test before #167, kept verbatim.
    if ((text ?? '').toLowerCase().includes(brand.toLowerCase())) return true;
    if (!text) return false;
    // (2) contiguous after an alphanumeric fold, plural-tolerant: guard 2's test before #167.
    //     Guard 1 skips it for a one-word brand; see brandPresentForPrepend().
    const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const foldedBrand = alnum(brand);
    const foldedText = alnum(text);
    if ((clause2ForOneWordBrands || foldBrandTokens(brand).length > 1)
        && foldedBrand.length > 0
        && (foldedText.includes(foldedBrand) || foldedText.includes(dropPluralS(foldedBrand)))) {
        return true;
    }
    // (3) every folded brand word present, in any order, plural-tolerant.
    const brandWords = foldBrandTokens(brand).map(dropPluralS);
    if (brandWords.length === 0) return false;
    const textWords = new Set(foldBrandTokens(text).map(dropPluralS));
    return brandWords.every(word => textWords.has(word));
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
 * THE PAYLOAD HALF OF #167 (punch #196, Lane A S52): the tokens the segmenter had
 * and the re-derivation does not, carried onto the end of the payload.
 *
 * An APPLIED repair hands retrieval `parsed.name` (or `preProcessLine`), not the
 * segmenter's `normalizedForm`, so a correction only the segmenter made is thrown
 * away with it. Measured over the 602 distinct `SegmentationCache` tuples of the
 * committed capture (`s51_guard_capture.jsonl`, 266 guard-1 inputs, 218 applied):
 * exactly **2 of 218** applied inputs lose a segmenter token —
 * `bar cooky cream protein quest` loses `bar`, and
 * `One scoop of optimum weigh nutrition protein` loses `whey` and keeps the typo
 * `weigh`. Re-derive with `s52_union_replay.ts` beside the capture.
 *
 * WHY A UNION AND NOT THE SEGMENTER'S FORM. "Prefer `normalizedForm`" is refuted by
 * count on the same capture: 48 of the 218 applied inputs GAIN a token the segmenter
 * form lacks, among them `optimum nutrition gold standard whey extreme milk chocolate`
 * (the segmenter form lacks `gold standard`, a 667-serve key),
 * `perdue simply smart organic grilled chicken breast` and `silk unsweetened almond
 * milk`. Preferring the segmenter's form truncates every one of them. The union
 * changes exactly the 2 and leaves 216 byte-identical.
 *
 * WHY APPEND, NEVER PREPEND, AND WHAT APPENDING STILL COSTS. `deriveMustHaveTokens()`
 * reads its slots off the FRONT (`coreTokens.slice(0, 2)`), so appending cannot
 * displace a token that is already required. It is NOT free, though:
 * `keepAFoodToken()` spends the food slot on the LAST non-brand core token of every
 * brand-detected line, so a carried token lands in the head-noun slot. On the two
 * members that is the point — `protein` gives way to `bar` and to `whey` — but it is
 * the reason this ships behind the pinned composite arm rather than on the count
 * alone: the head noun is a hard `every()` at admission, and a head noun no record
 * spells empties the pool. Prepending would have moved BOTH slots.
 *
 * WHY ONLY THE NO-PREPEND BRANCH, AND HOW THAT BOUND WAS FOUND. `preserveDroppedBrand()`
 * applies in two shapes. When the brand SURVIVED into the re-derivation the payload IS
 * the re-derivation, and the only thing the segmenter had that it lacks is food tokens —
 * the pure #196 case, and both real members are here. When the brand had to be
 * PREPENDED the payload is a synthesized string, and the segmenter form is the very
 * thing whose brand-blindness triggered the prepend; carrying its generic product words
 * on top stacks two repairs on one line. The carry is therefore refused on that branch.
 *
 * THAT BOUND WAS CHOSEN AFTER A GATE READING, AND THE CAPTURE CANNOT TEST IT. Carrying on
 * BOTH branches moved golden case `n-supp-22` off its record on 4 of 4 pinned-arm runs,
 * cold and warm, with a ZERO same-tree noise floor on both trees: `2 rx bars` (items-form
 * brand `rxbar`, segmenter form `protein bar`) became `rxbar rx bars protein` and resolved
 * RXBAR `off_0193908005342` 110 g / 459.8 kcal instead of `off_0193908001672` 104 g /
 * 359.8 kcal — undoing the #167 fix-forward S51 had just shipped. The `s51_guard_capture`
 * arm offers NO evidence either way, because both of its members sit on the no-prepend
 * branch and read identically under both shapes (266 inputs, 2 changed, under either).
 * So the bound's whole evidential base is that one golden line plus the reason above.
 * Widen it only with a measurement, and re-run `s51_pin_rxbar.json` on the arm if you do.
 *
 * Brand tokens are excluded because the payload already carries the brand, by
 * prepend or by containment, and a repeat would only re-double what #167 removed.
 * The fold is `foldBrandTokens()` plus `dropPluralS()` — the same pair clause 3 of
 * the containment predicate uses — so `M&M's`/`m and ms` compare as one spelling and
 * `bar` is not carried alongside `bars`. Comparison is folded; what is APPENDED is the
 * segmenter's own spelling. Duplicates within the carried set are dropped, so the
 * result cannot grow a repeated run.
 */
function segmenterOnlyTokens(segmenterForm: string, payload: string, targetBrand: string): string[] {
    const inPayload = new Set(foldBrandTokens(payload).map(dropPluralS));
    const brandTokens = new Set(foldBrandTokens(targetBrand).map(dropPluralS));
    const carried: string[] = [];
    const seen = new Set<string>();
    for (const token of foldBrandTokens(segmenterForm)) {
        const key = dropPluralS(token);
        if (inPayload.has(key) || brandTokens.has(key) || seen.has(key)) continue;
        seen.add(key);
        carried.push(token);
    }
    return carried;
}

/**
 * The repair itself, extracted so it can be pinned by a test rather than only
 * by a hand-written replica (project memory: a helper number must come from the
 * shipped function).
 *
 * BEHAVIOUR DIFFERS FROM THE INLINE FORM IT REPLACED IN TWO WAYS, and
 * `quantity-word-brand.test.ts` pins both against the verbatim pre-extraction
 * expression over a hermetic fixture:
 *   - the `brandWasConsumedAsQuantity()` refusal (2026-08-31; over the 436 real
 *     `SegmentationCache` repair inputs then: 164 fires, 0 containment
 *     disagreements, 0 baseName disagreements on the 161 rows it spared);
 *   - both containment checks ask `brandPresentForPrepend()` instead of a plain
 *     `.toLowerCase().includes()` (punch #167, 2026-09-14; clause 2 narrowed to
 *     multi-word brands 2026-09-15). That is a strict widening of the old contiguous
 *     test and never adds a brand. A first-check flip returns the segmenter's
 *     own form instead of the re-derivation (every one of the 6 such flips over
 *     the 266 real inputs replaced a prepend); a second-check flip returns the
 *     re-derivation without the prepend.
 *
 * And since punch #196 (Lane A S52) an APPLIED result carries the segmenter-only
 * tokens on its end — `segmenterOnlyTokens()` above owns the shape, the count and
 * why it appends rather than prepends. The two refusal paths are untouched.
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

    if (brandPresentForPrepend(baseName, targetBrand)) {
        return { baseName, applied: false, declined: null };
    }
    if (brandWasConsumedAsQuantity(rawLine, targetBrand, parsed)) {
        return { baseName, applied: false, declined: 'brand_consumed_as_quantity' };
    }
    // The carry rides the NO-PREPEND branch only; `segmenterOnlyTokens()` says why.
    const brandSurvivedRederivation = brandPresentForPrepend(rederived, targetBrand);
    if (!brandSurvivedRederivation) {
        return { baseName: `${targetBrand} ${rederived}`.trim(), applied: true, declined: null };
    }
    const carried = segmenterOnlyTokens(baseName, rederived, targetBrand);
    return {
        baseName: carried.length > 0 ? `${rederived} ${carried.join(' ')}` : rederived,
        applied: true,
        declined: null,
    };
}

/**
 * WHY THE POST-MODEL BRAND RE-ASSERT NEEDS A SECOND KIND OF EVIDENCE.
 *
 * `mapIngredientWithFallback()` guards a dropped brand TWICE, and until
 * 2026-09-05 the two guards answered the same question by different rules:
 *
 *   1. BEFORE the normalizer — `preserveDroppedBrand()` above restores a brand
 *      the segmenter named (`options.brand`) or the detector found into the
 *      retrieval query, refusing only the quantity-word class.
 *   2. AFTER the normalizer — the re-assert over the model's own output restored
 *      a dropped brand only under `hasDecisiveBrandContext()`, the LEXICAL test
 *      (a multi-word brand, or an adjacent product-form token such as
 *      `protein` / `bar` / `powder`) whose job is to keep a lexicon false
 *      positive (`bell` in `bell pepper`) out of the cache key.
 *
 * So a brand the segmenter had explicitly named, and guard 1 had explicitly
 * kept, was thrown away by guard 2 whenever its neighbours were not product
 * words — and on a CO-BRANDED line the neighbour is the OTHER brand:
 *
 *   `.75 scoop Ryse skippy peanut butter`   segmenter: brand=Ryse, form=`skippy peanut butter`
 *     guard 1 → baseName `Ryse skippy peanut butter`
 *     model   → normalized_name `skippy peanut butter`, is_branded=true
 *     guard 2 → prev `scoop`, next `skippy`: not decisive → NOT restored
 *     key `butter peanut skippy` → off_6922877745423 "Skippy Peanut Butter" (the spread, not the powder)
 *
 * MEASURED 2026-09-05 (Lane A session 40) over every distinct SegmentationCache
 * segment joined to its AiNormalizeCache row by `computeNormalizedKey(baseName)`:
 * 205 segments carry a segmenter brand, 115 join a normalizer row, the model
 * dropped the brand on 11 of those — `is_branded: true` on every one — and
 * guard 2 restored 3 (decisive) and lost 8 (non-decisive): the co-brand above,
 * the trailing `… from Quaker` / `… from Orgain` form (3), `perdue simply smart …`
 * (a maker before a sub-brand) and `m&ms` (2). Five of the eight are organic
 * 30-day MEL lines and four of those billed a wrong or brandless record
 * (`Two chocolate caramel rice cakes from Quaker` → a Tesco row). Re-derive:
 * dump `SELECT DISTINCT s->>'rawText', s->>'normalizedForm', s->>'brand' FROM
 * "SegmentationCache", jsonb_array_elements("segmentsJson") s` and
 * `SELECT "normalizedKey", "normalizedName" FROM "AiNormalizeCache"`, then
 * replay `preserveDroppedBrand()` → `computeNormalizedKey()` →
 * `candidateMatchesTargetBrand()` per segment.
 *
 * THE RULE: a brand the SEGMENTER named is evidence of the same strength as
 * lexical decisiveness for the re-assert — a second model read the whole line
 * and called it a brand, and the mapper already keeps it before the normalizer
 * — under the SAME refusal guard 1 applies. The segmenter emitted no quantity
 * word as a brand in that census (0 of 205), so the refusal is principled, not
 * load-bearing.
 *
 * WHAT IT DOES NOT DO: it does not touch `hasDecisiveBrandContext()` itself,
 * which also decides the cache key's brand PREFIX and whether the model may
 * downgrade `is_branded` — those keep their lexical rule. The SOLO path (no
 * segmenter: `winner-diff`, the search route, a bare mapper call) is unchanged
 * by construction, which is also why `winner-diff` cannot see this change: it
 * never supplies `options.brand`.
 */
export type BrandReassertEvidence = 'decisive_context' | 'segmenter_named' | null;

export function brandReassertEvidence(args: {
    rawLine: string;
    targetBrand: string;
    /** `options.brand` — the segmenter's brand for this segment on the composite path. */
    segmenterBrand: string | null | undefined;
    parsed: ParsedIngredient | null | undefined;
}): BrandReassertEvidence {
    const { rawLine, targetBrand, segmenterBrand, parsed } = args;
    if (!targetBrand.trim()) return null;
    if (hasDecisiveBrandContext(rawLine, targetBrand)) return 'decisive_context';
    const seg = segmenterBrand?.trim();
    if (!seg) return null;
    // On the composite path the segmenter's brand IS the target (the mapper
    // prefers `options.brand` over the detector), but check by token rather
    // than assume the call site: a detector hit that is not what the segmenter
    // named must not borrow the segmenter's authority.
    if (!candidateMatchesTargetBrand(undefined, seg, targetBrand)) return null;
    // TWO independent signals, not one: the segmenter's brand must ALSO be a
    // brand the lexicon knows. Refuter L1 on PR #421 found the segmenter
    // naming an over-split chain fragment as a brand (`company` for `company
    // zucchini noodles`, from "Noodles and Company", 32 uses) — trusting that
    // alone would have prefixed a non-brand onto the retrieval query. All five
    // brands in the measured firing population (Ryse, Quaker, Orgain, Perdue,
    // m&ms) are lexicon brands; a segmenter-only brand keeps today's behaviour.
    if (!detectBrandInQuery(seg).isBranded) return null;
    if (brandWasConsumedAsQuantity(rawLine, targetBrand, parsed)) return null;
    return 'segmenter_named';
}

/**
 * THE REPAIR ITSELF, for the `segmenter_named` evidence (2026-09-05, refuter
 * L2 on PR #421). The decisive path keeps its historical closure in the mapper
 * byte-for-byte; this helper is what the segmenter path uses instead, because
 * the first two-arm probe of the fix showed two shapes that closure gets wrong
 * and that the segmenter path meets far more often:
 *
 *   1. A brand the model KEPT in a folded spelling read as dropped.
 *      `candidateMatchesTargetBrand()` folds apostrophes but not `&`, so the
 *      segmenter brand `m&ms` against the model's `m m's` was "dropped" and the
 *      re-assert produced the retrieval query `m&ms m m's` (branch-arm MEL,
 *      2026-09-05 20:42Z). Here a brand `brandAlreadyPresent()` reads as present
 *      counts as KEPT — its clause 2 is this helper's former alphanumeric fold
 *      and plural rule, and its clause 3 also reads `M&M's` in `m and ms
 *      pretzel`, which the fold missed. A false "kept" only suppresses a repair,
 *      so this errs the safe way.
 *   2. A multi-token brand of which the model kept the LAST token. The
 *      segmenter re-drew `Ryse Skippy` as the brand of `.75 scoop ryse skippy
 *      peanut butter`, the model returned `skippy peanut butter`, and the whole
 *      brand was prepended: `ryse skippy skippy peanut butter`. Here the prepend
 *      is followed by an adjacent-duplicate collapse (case-insensitive), the
 *      same rule `deriveMappingCacheKey()` already applies to the key.
 *
 * Returns null when the brand is judged present (no repair), else the repaired
 * name. `candidateMatchesTargetBrand()`'s first-word test stays in front of the
 * shared predicate on purpose: this input is the model's own output, and a brand
 * of which the model kept only the first word (`optimum protein`) would
 * otherwise be prepended on top of it — the doubling #167 removes from guard 1.
 */
export function repairDroppedBrand(name: string | undefined, targetBrand: string): string | null {
    if (!name) return null;
    if (candidateMatchesTargetBrand(undefined, name, targetBrand)) return null;
    if (brandAlreadyPresent(name, targetBrand)) return null;
    const tokens = `${targetBrand} ${name}`.trim().split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (const t of tokens) {
        if (out.length > 0 && out[out.length - 1].toLowerCase() === t.toLowerCase()) continue;
        out.push(t);
    }
    return out.join(' ');
}
