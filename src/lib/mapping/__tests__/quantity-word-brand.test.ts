import { parseIngredientLine } from '../../parse/ingredient-line';
import { detectBrandInQuery } from '../brand-detector';
import { deriveMappingCacheKey } from '../cache-key';
import { stripPartitiveOfResidue } from '../partitive-residue';
import { brandWasConsumedAsQuantity, preserveDroppedBrand, brandReassertEvidence } from '../quantity-word-brand';

/**
 * `one` is a lexicon brand (the ONE protein-bar company), so the
 * brand-preservation repair in `preflightIngredientLine()` used to read an
 * ordinary COUNT WORD as a dropped brand and prepend it to baseName — which is
 * both the retrieval query and the `deriveMappingCacheKey()` input.
 *
 * The pins below are LIVE rows, not invented ones (read-only, 2026-08-31;
 * re-derive:
 *   SELECT "normalizedForm", "foodName", "brandName", "offBarcode",
 *          "fdcId", "fsId", "usedCount"
 *   FROM "FoodMapping" WHERE "normalizedForm" ~ '(^| )one( |$)'
 *   ORDER BY "usedCount" DESC;
 * ):
 *
 *   GENUINE — must not move
 *     birthday cake one                       off_0788434108096 "One birthday cake
 *                                             protein bars"                242 serves
 *     almond bliss one                        fs_11357046 "One - Almond Bliss"
 *                                             [Oh Yeah!]                     1 serve
 *     and bar chocolate fiber oat one rolled  off_0016299147449 "Fiber one, chewy
 *                                             bars, oats & chocolate"        1 serve
 *
 *   FALSE — written by the misfire, must be fixed
 *     milk one           off_9335390000028 "Milk" [a2 Milk Company]      203 serves
 *     cheese one swiss   fdc_171251 "swiss cheese"                         1 serve
 *     banana one         off_7404003900047 "Banana" [brandName "One"]      1 serve
 *
 * Each false key already has the correct destination row live — `milk` (642),
 * `cheese swiss` (8, same fdc_171251) and `banana` (1,706, fdc_173944 raw
 * bananas) — so the fix merges traffic onto an existing correct row rather than
 * creating one.
 */

/**
 * The preflight order, using only shipped functions: parse -> baseName ->
 * `preserveDroppedBrand()` -> `deriveMappingCacheKey()`. `findCanonicalName()`
 * (a `LearnedSynonym` read) is a DB call and is not replayed; none of these
 * lines is a known synonym.
 */
function preflight(rawLine: string, normalizedForm: string, segmenterBrand?: string) {
    const parsed = parseIngredientLine(rawLine);
    let baseName = stripPartitiveOfResidue(
        (normalizedForm.trim() || parsed?.name?.trim() || rawLine).trim(),
    );
    const detection = detectBrandInQuery(rawLine);
    const targetBrand = segmenterBrand?.trim() || detection.matchedBrand;
    let declined: string | null = null;
    if (targetBrand) {
        const repair = preserveDroppedBrand({
            rawLine,
            baseName,
            targetBrand,
            rederived: parsed?.name?.trim() || rawLine,
            parsed,
        });
        declined = repair.declined;
        if (repair.applied) baseName = repair.baseName;
    }
    return { baseName, declined, key: deriveMappingCacheKey(baseName, parsed, detection, rawLine) };
}

/**
 * The brand-preservation block EXACTLY as this tree shipped it before the
 * extraction — the thing `preserveDroppedBrand()` must still be, minus the
 * refusal. Kept verbatim so the two can be diffed rather than eyeballed.
 */
function inlineRepairBeforeExtraction(baseName: string, targetBrand: string, rederived: string) {
    if (targetBrand && !baseName.toLowerCase().includes(targetBrand.toLowerCase())) {
        return {
            baseName: rederived.toLowerCase().includes(targetBrand.toLowerCase())
                ? rederived
                : `${targetBrand} ${rederived}`.trim(),
            applied: true,
        };
    }
    return { baseName, applied: false };
}

describe('a count word the lexicon also sells as a brand', () => {
    it.each([
        ['one slice of Swiss cheese', 'Swiss cheese', 'cheese one swiss', 'cheese swiss'],
        ['one medium banana', 'banana', 'banana one', 'banana'],
        ['one and a half cups milk', 'milk', 'milk one', 'milk'],
        [
            'One serving of kettle cooked potato chips',
            'kettle cooked potato chips',
            'chips cooked kettle one potato',
            'chips cooked kettle potato',
        ],
    ])('%s no longer writes the polluted key', (rawLine, normalizedForm, polluted, fixed) => {
        const out = preflight(rawLine, normalizedForm);
        expect(out.declined).toBe('brand_consumed_as_quantity');
        expect(out.key).toBe(fixed);
        expect(out.key).not.toBe(polluted);
    });

    it('reads the ONE brand off the kettle-chip line, which is why the gate is positional', () => {
        // `one` beats the real lexicon brand `kettle` because the detector scans
        // left to right at each n-gram size. The gate must not depend on which
        // brand won that scan.
        expect(detectBrandInQuery('One serving of kettle cooked potato chips').matchedBrand)
            .toBe('One');
    });
});

describe('the genuine ONE-bar keys are untouched', () => {
    it('keeps the 242-serve `birthday cake one`', () => {
        // `bar` is a BRAND_PRODUCT_CONTEXT token, so the brand is DECISIVE and
        // clause 4 refuses to suppress. This is the pin the decisiveness gate
        // could not hold on its own.
        expect(brandWasConsumedAsQuantity(
            'one bar birthday cake', 'one', parseIngredientLine('one bar birthday cake'),
        )).toBe(false);
        expect(preflight('one bar birthday cake', 'birthday cake').key).toBe('birthday cake one');
        // ...and identically when the segmenter asserts the brand itself.
        expect(preflight('one bar birthday cake', 'birthday cake', 'One').key)
            .toBe('birthday cake one');
    });

    it('keeps the ONE brand when a leading digit takes the quantity seat', () => {
        // `1 one bar almond bliss` parses to name `one bar almond bliss`, so the
        // brand is never consumed and clause 1 is false. (The live key
        // `almond bliss one` is written by the SOLO path, where this repair —
        // gated on `options.normalizedForm` — never runs at all; on the
        // composite path the same line keys `almond bar bliss one`, unchanged
        // by this gate.)
        expect(parseIngredientLine('1 one bar almond bliss')?.name).toContain('one');
        const out = preflight('1 one bar almond bliss', 'almond bliss');
        expect(out.declined).toBeNull();
        expect(out.key).toBe('almond bar bliss one');
    });

    it('keeps a two-token brand that is never fully consumed (`fiber one`)', () => {
        const raw = 'a fiber one oats and chocolate chewy rolled oat bar';
        expect(detectBrandInQuery(raw).matchedBrand).toBe('fiber one');
        expect(brandWasConsumedAsQuantity(raw, 'fiber one', parseIngredientLine(raw))).toBe(false);
    });

    it.each([
        ['one birthday cake protein bar', 'birthday cake protein bar'],
        ['one birthday cake bar', 'birthday cake bar'],
        ['one protein bar', 'protein bar'],
    ])('keeps the brand on `%s` — no measure word follows the count', (rawLine, normalizedForm) => {
        // `parsed.unit` is null on all three, so clause 3 refuses. The briefed
        // decisiveness gate strips the brand off the first two.
        expect(parseIngredientLine(rawLine)?.unit).toBeNull();
        expect(preflight(rawLine, normalizedForm).declined).toBeNull();
        expect(preflight(rawLine, normalizedForm).baseName.toLowerCase()).toContain('one');
    });
});

describe('a brand token the parser assigned to the UNIT seat is not a quantity', () => {
    it('keeps Squirt on `squirt soda`', () => {
        const parsed = parseIngredientLine('squirt soda');
        expect(parsed?.unit).toBe('squirt');
        expect(parsed?.name).toBe('soda');
        expect(brandWasConsumedAsQuantity('squirt soda', 'squirt', parsed)).toBe(false);
    });

    it('keeps Splenda, which the parser REWRITES rather than strips', () => {
        // parseIngredientLine('splenda') -> name `sucralose sweetener`: the brand
        // is substituted by a synonym, not consumed as a count. unit is null, so
        // clause 3 refuses.
        expect(parseIngredientLine('splenda')?.name).toBe('sucralose sweetener');
        expect(brandWasConsumedAsQuantity('splenda', 'splenda', parseIngredientLine('splenda')))
            .toBe(false);
    });
});

/**
 * PORT NOTE (2026-08-31). On PR #407's branch this block asserted that the 17
 * chain spellings its brand-detection widening ADDS survive the refusal, and it
 * read the brand off `detectBrandInQuery()`. On this tree the detector knows
 * none of the 17 (measured: `detectBrandInQuery('chick fil a chicken sandwich')`
 * returns `{isBranded: false, matchedBrand: null}` for all 17), so that
 * assertion cannot run here and asserting the detector finds them would be
 * asserting #407.
 *
 * The block is kept, with the brand supplied the other way the caller gets one:
 * `options.brand`, the segmenter's own hint — a real production path, and the
 * one `SegmentationCache` rows carry. What it pins is the property that made the
 * refusal safe in the first place, which is detector-independent: a multi-word
 * brand is never fully consumed by the quantity parse, so no clause-1 pass is
 * reachable for it. Nothing about #407 is asserted or required.
 */
describe('a multi-word or chain brand is never fully consumed by the quantity parse', () => {
    const CHAINS = [
        'chick fil a', 'jack in the box', 'dennys', 'applebees', 'buffalo wild wings',
        'first watch', 'portillos', 'carrabbas', 'chilis', 'outback', 'texas roadhouse',
        'waffle house', 'cheesecake factory', 'in n out', 'jersey mikes', 'jimmy johns',
        'noodles and company',
    ];

    it.each(CHAINS)('%s keeps its brand in baseName', chain => {
        const raw = `${chain} chicken sandwich`;
        expect(brandWasConsumedAsQuantity(raw, chain, parseIngredientLine(raw))).toBe(false);
        const out = preflight(raw, 'chicken sandwich', chain);
        expect(out.declined).toBeNull();
        expect(out.baseName.toLowerCase()).toContain(chain.split(' ')[0]);
    });

    it('still repairs `coca cola`, the case the decisiveness gate would have lost', () => {
        const out = preflight('12 oz coke', 'coke', 'Coca-Cola');
        expect(out.declined).toBeNull();
        expect(out.baseName.toLowerCase()).toContain('coca');
    });
});

/**
 * PORT NOTE (2026-08-31). The extraction must change NOTHING except the refusal.
 * PR #407 also replaced this repair's two containment checks with a
 * canonical-fold comparison; that change belongs to #407 and is deliberately NOT
 * carried here, so these tests pin the plain `.toLowerCase().includes()` form
 * that this tree ships. If someone later folds the containment check, the first
 * test below goes red — which is the point.
 */
describe('the extraction is behaviour-preserving apart from the refusal', () => {
    it('still uses a PLAIN lowercase includes(), not a canonical fold', () => {
        // A line that already spells the brand differently from the lexicon
        // spelling fails a plain includes(), so the repair prepends the brand on
        // top of itself. That is this tree's behaviour, measured 2026-08-31, and
        // the port preserves it byte for byte. (Fixing it is #407's job.)
        const cases: Array<[string, string, string]> = [
            ['chick fil a spicy sandwich', 'spicy sandwich', 'chick-fil-a'],
            ['coca cola', 'cola', 'Coca-Cola'],
            ['grilled cheese in n out', 'grilled cheese', 'in-n-out'],
        ];
        const keys = cases.map(([rawLine, normalizedForm, brand]) =>
            preflight(rawLine, normalizedForm, brand).key);
        expect(keys).toEqual([
            'a chick chick-fil-a fil sandwich spicy',
            'coca coca-cola cola',
            'cheese grilled in in-n-out n out',
        ]);
    });

    /**
     * Rows are (rawLine, normalizedForm, brand). They cover both containment
     * branches, both `rederived` branches, the fold-sensitive spellings above,
     * the refusal, and ordinary repairs. The same replay was run over the 436
     * real `SegmentationCache` (rawText, normalizedForm, brand) tuples on
     * 2026-08-31 — 164 fires, 0 containment disagreements, 0 baseName
     * disagreements on the 161 non-refused rows — but that needs the box, so the
     * hermetic version is pinned here.
     */
    const REPLAY: Array<[string, string, string | undefined]> = [
        ['2 scoops ghost vegan protein cinnamon roll', 'vegan protein cinnamon roll', undefined],
        ['mcdonalds sausage mcmuffin with egg', 'sausage mcmuffin with egg', undefined],
        ['kraft deluxe macaroni and cheese', 'macaroni and cheese', undefined],
        ['velveeta shells and cheese', 'shells and cheese', undefined],
        ['a Chobani 20 g protein mixed berry yogurt', 'mixed berry yogurt', undefined],
        ['starbucks iced brown sugar oatmilk shaken espresso', 'iced shaken espresso', undefined],
        ['oikos triple zero vanilla', 'oikos triple zero vanilla', undefined],
        ['12 oz coke', 'coke', 'Coca-Cola'],
        ['chick fil a spicy sandwich', 'spicy sandwich', 'chick-fil-a'],
        ['coca cola', 'cola', 'Coca-Cola'],
        ['grilled cheese in n out', 'grilled cheese', 'in-n-out'],
        ['one slice of Swiss cheese', 'Swiss cheese', undefined],
        ['one medium banana', 'banana', undefined],
        ['one and a half cups milk', 'milk', undefined],
        ['one bar birthday cake', 'birthday cake', undefined],
        ['one protein bar', 'protein bar', undefined],
        ['squirt soda', 'soda', undefined],
        ['noodles and company pad thai', 'pad thai', 'Noodles and Company'],
    ];

    it('agrees with the pre-extraction expression on every line the refusal spares', () => {
        let fires = 0;
        let refused = 0;
        for (const [rawLine, normalizedForm, segmenterBrand] of REPLAY) {
            const parsed = parseIngredientLine(rawLine);
            const baseName = stripPartitiveOfResidue(normalizedForm);
            const targetBrand = segmenterBrand || detectBrandInQuery(rawLine).matchedBrand;
            if (!targetBrand) continue;
            const rederived = parsed?.name?.trim() || rawLine;

            const before = inlineRepairBeforeExtraction(baseName, targetBrand, rederived);
            const after = preserveDroppedBrand({ rawLine, baseName, targetBrand, rederived, parsed });

            // The containment decision itself must be identical. `before` says
            // "carries the brand" by not applying; `after` says it by neither
            // applying nor declining.
            expect([rawLine, !before.applied])
                .toEqual([rawLine, !after.applied && after.declined === null]);

            if (before.applied) fires++;
            if (after.declined) { refused++; continue; }
            expect([rawLine, after.baseName]).toEqual([rawLine, before.baseName]);
        }
        // The fixture must actually exercise the repair, or this test is vacuous.
        expect(fires).toBeGreaterThanOrEqual(10);
        expect(refused).toBe(3);
    });

    it('differs from the pre-extraction expression ONLY by dropping the prepend', () => {
        const rawLine = 'one medium banana';
        const parsed = parseIngredientLine(rawLine);
        const rederived = parsed?.name?.trim() || rawLine;
        const before = inlineRepairBeforeExtraction('banana', 'one', rederived);
        const after = preserveDroppedBrand({
            rawLine, baseName: 'banana', targetBrand: 'one', rederived, parsed,
        });
        expect(before).toEqual({ baseName: 'one banana', applied: true });
        expect(after).toEqual({
            baseName: 'banana', applied: false, declined: 'brand_consumed_as_quantity',
        });
    });
});

/**
 * The post-model re-assert's SECOND kind of evidence (2026-09-05). The
 * measured population these pin is in the predicate's docstring: eight
 * segmenter-named brands the normalizer dropped and the lexical gate could not
 * restore, five of them organic MEL lines.
 */
describe('brandReassertEvidence — a segmenter-named brand survives the normalizer', () => {
    const parsedOf = (line: string) => parseIngredientLine(line);

    it('the co-branded Ryse line: lexically NOT decisive, restored on the segmenter\'s word', () => {
        const line = '.75 scoop Ryse skippy peanut butter';
        expect(detectBrandInQuery(line).matchedBrand).toBe('Ryse');
        // The neighbours are `scoop` and `skippy` — neither is a product-form token.
        expect(brandReassertEvidence({ rawLine: line, targetBrand: 'Ryse', segmenterBrand: undefined, parsed: parsedOf(line) }))
            .toBeNull();
        expect(brandReassertEvidence({ rawLine: line, targetBrand: 'Ryse', segmenterBrand: 'Ryse', parsed: parsedOf(line) }))
            .toBe('segmenter_named');
    });

    it('the trailing `from Quaker` form — the same shape, three of the eight measured losses', () => {
        const line = 'one caramel rice cake from quaker';
        expect(brandReassertEvidence({ rawLine: line, targetBrand: 'Quaker', segmenterBrand: 'Quaker', parsed: parsedOf(line) }))
            .toBe('segmenter_named');
    });

    it('lexical decisiveness still opens the gate on its own, with or without a segmenter', () => {
        const line = '1 scoop ryse protein';
        expect(brandReassertEvidence({ rawLine: line, targetBrand: 'ryse', segmenterBrand: undefined, parsed: parsedOf(line) }))
            .toBe('decisive_context');
        expect(brandReassertEvidence({ rawLine: line, targetBrand: 'ryse', segmenterBrand: 'ryse', parsed: parsedOf(line) }))
            .toBe('decisive_context');
    });

    it('the refuted `bell pepper` shape stays closed: no segmenter brand, no decisiveness, no re-assert', () => {
        const line = 'bell pepper';
        expect(detectBrandInQuery(line).matchedBrand).toBe('bell');
        expect(brandReassertEvidence({ rawLine: line, targetBrand: 'bell', segmenterBrand: undefined, parsed: parsedOf(line) }))
            .toBeNull();
        // The segmenter naming a DIFFERENT brand lends the detector's hit nothing.
        expect(brandReassertEvidence({ rawLine: line, targetBrand: 'bell', segmenterBrand: 'Kind', parsed: parsedOf(line) }))
            .toBeNull();
    });

    it('the quantity-word refusal is shared with preserveDroppedBrand: `one` is never re-asserted', () => {
        const line = 'One serving of kettle cooked potato chips';
        expect(brandWasConsumedAsQuantity(line, 'One', parsedOf(line))).toBe(true);
        expect(brandReassertEvidence({ rawLine: line, targetBrand: 'One', segmenterBrand: 'One', parsed: parsedOf(line) }))
            .toBeNull();
    });

    it('matches the segmenter brand by folded token, not by string equality', () => {
        const line = "2 tbsp ben and jerry's vanilla";
        expect(brandReassertEvidence({ rawLine: line, targetBrand: "jerry's", segmenterBrand: 'Jerrys', parsed: parsedOf(line) }))
            .toBe('segmenter_named');
    });
});
