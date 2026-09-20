import { parseIngredientLine } from '../../parse/ingredient-line';
import { detectBrandInQuery } from '../brand-detector';
import { deriveMappingCacheKey } from '../cache-key';
import { stripPartitiveOfResidue } from '../partitive-residue';
import { brandAlreadyPresent, brandPresentForPrepend, brandWasConsumedAsQuantity, preserveDroppedBrand, brandReassertEvidence, repairDroppedBrand } from '../quantity-word-brand';

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
 * THE EXTRACTION, THEN #167. The extraction (2026-08-31) changed nothing but the
 * refusal. Punch #167 (2026-09-14) then replaced both containment checks' plain
 * `.toLowerCase().includes()` with `brandAlreadyPresent()`, a strict widening.
 * These tests replay the verbatim pre-extraction expression and pin exactly where
 * the shipped function now differs from it, and in which direction.
 */
describe('the extraction differs from the inline form only by the refusal and #167', () => {
    it('no longer prepends a brand the re-derivation already spells differently', () => {
        // Before #167 a plain includes() missed these spellings, so the repair
        // prepended the brand on top of itself and wrote a doubled key:
        // `a chick chick-fil-a fil sandwich spicy`, `coca coca-cola cola` and
        // `cheese grilled in in-n-out n out` (measured 2026-08-31).
        const cases: Array<[string, string, string]> = [
            ['chick fil a spicy sandwich', 'spicy sandwich', 'chick-fil-a'],
            ['coca cola', 'cola', 'Coca-Cola'],
            ['grilled cheese in n out', 'grilled cheese', 'in-n-out'],
        ];
        const outs = cases.map(([rawLine, normalizedForm, brand]) =>
            preflight(rawLine, normalizedForm, brand));
        expect(outs.map(o => o.baseName)).toEqual([
            'chick fil a spicy sandwich',
            'coca cola',
            'grilled cheese in n out',
        ]);
        expect(outs.map(o => o.key)).toEqual([
            'a chick fil sandwich spicy',
            'coca cola',
            'cheese grilled in n out',
        ]);
    });

    /**
     * Rows are (rawLine, normalizedForm, brand). They cover both containment
     * branches, both `rederived` branches, the fold-sensitive spellings above,
     * the refusal, ordinary repairs, and — since #167 — the census doubling rows
     * plus the rows that SEPARATE the candidate containment rules: a contiguous
     * fold misses the split `Optimum Nutrition` rows, and a word test without the
     * plural rule misses `and ben jerry`. The 2026-08-31 replay over the 436 real
     * `SegmentationCache` tuples (164 fires, 0 containment disagreements) was a
     * property of the plain check; the #167 population read is in the mobile
     * report `sync-docs/reports/2026-09-14_lane-a-s50-punch-167-with-its-gate.md`.
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
        // Punch #167 (2026-09-14).
        ['m and ms pretzel', 'pretzel', "M&M's"],
        ['a fun size bag of m&ms', 'm&ms', "m&m's"],
        ['noodles and company pad thai', 'pad thai', 'Noodles & Company'],
        ['optimum weigh nutrition protein', 'protein', 'Optimum Nutrition'],
        ['and a half of optimum weight nutrition protein', 'protein', 'Optimum Nutrition'],
        ['optimum whey nutrition protein', 'whey protein', 'Optimum Nutrition'],
        ['optimum nutrition weigh protein', 'weigh protein', 'optimum nutrition'],
        ['optimum gold nutrition protein', 'protein', 'Optimum Nutrition'],
        ['ben and jerrys cherry garcia', 'cherry garcia', "Ben & Jerry's"],
        ['and ben jerry', 'and ben jerry', "Ben & Jerry's"],
    ];

    it('differs only in the widening direction, and only where the brand was already spelled', () => {
        let fires = 0;
        let refused = 0;
        const noLongerFires: string[] = [];
        const prependDropped: string[] = [];
        for (const [rawLine, normalizedForm, segmenterBrand] of REPLAY) {
            const parsed = parseIngredientLine(rawLine);
            const baseName = stripPartitiveOfResidue(normalizedForm);
            const targetBrand = segmenterBrand || detectBrandInQuery(rawLine).matchedBrand;
            if (!targetBrand) continue;
            const rederived = parsed?.name?.trim() || rawLine;
            const label = `${rawLine} | ${targetBrand}`;

            const before = inlineRepairBeforeExtraction(baseName, targetBrand, rederived);
            const after = preserveDroppedBrand({ rawLine, baseName, targetBrand, rederived, parsed });

            if (before.applied) fires++;
            if (after.declined) { refused++; continue; }
            // A line the inline form left alone is still left alone: #167 only widens "present".
            if (!before.applied) {
                expect([label, after]).toEqual([label, { baseName, applied: false, declined: null }]);
                continue;
            }
            if (!after.applied) {
                // The segmenter's own form already carried the brand, and what the
                // inline form built instead was a prepend.
                noLongerFires.push(label);
                expect([label, after.baseName]).toEqual([label, baseName]);
                expect([label, before.baseName]).toEqual([label, `${targetBrand} ${rederived}`]);
            } else if (after.baseName !== before.baseName) {
                // The re-derivation already carried the brand: the prepend is dropped, nothing else.
                prependDropped.push(label);
                expect([label, before.baseName]).toEqual([label, `${targetBrand} ${after.baseName}`]);
            }
        }
        // The fixture must actually exercise the repair, or this test is vacuous.
        expect(fires).toBeGreaterThanOrEqual(10);
        expect(refused).toBe(3);
        expect(noLongerFires).toEqual([
            "a fun size bag of m&ms | m&m's",
            "and ben jerry | Ben & Jerry's",
        ]);
        expect(prependDropped).toEqual([
            'chick fil a spicy sandwich | chick-fil-a',
            'coca cola | Coca-Cola',
            'grilled cheese in n out | in-n-out',
            "m and ms pretzel | M&M's",
            'noodles and company pad thai | Noodles & Company',
            'optimum weigh nutrition protein | Optimum Nutrition',
            'and a half of optimum weight nutrition protein | Optimum Nutrition',
            'optimum whey nutrition protein | Optimum Nutrition',
            'optimum gold nutrition protein | Optimum Nutrition',
            "ben and jerrys cherry garcia | Ben & Jerry's",
        ]);
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

    it('a segmenter-only "brand" the lexicon does not know keeps today\'s behaviour (`company`)', () => {
        const line = 'company zucchini noodles';
        expect(detectBrandInQuery('company').isBranded).toBe(false);
        expect(brandReassertEvidence({ rawLine: line, targetBrand: 'company', segmenterBrand: 'company', parsed: parsedOf(line) }))
            .toBeNull();
    });

    it('matches the segmenter brand by folded token, not by string equality', () => {
        const line = 'a fun size bag of m&ms';
        expect(detectBrandInQuery('m&ms').isBranded).toBe(true);
        expect(brandReassertEvidence({ rawLine: line, targetBrand: 'm&ms', segmenterBrand: "M&M's", parsed: parsedOf(line) }))
            .toBe('segmenter_named');
    });
});

describe('repairDroppedBrand — the segmenter-path repair (refuter L2 shapes, 2026-09-05)', () => {
    it('prepends a genuinely dropped brand', () => {
        expect(repairDroppedBrand('skippy peanut butter', 'Ryse')).toBe('Ryse skippy peanut butter');
        expect(repairDroppedBrand('caramel rice cake', 'Quaker')).toBe('Quaker caramel rice cake');
    });
    it('reads a brand the model kept in a folded spelling as KEPT (`m&ms` vs `m m\'s`)', () => {
        expect(repairDroppedBrand("m m's", 'm&ms')).toBeNull();
        expect(repairDroppedBrand("m&m's", "M&M's")).toBeNull();
        expect(repairDroppedBrand('ryse protein', 'Ryse')).toBeNull();
    });
    it('does not double the last token of a multi-token brand the model kept (`Ryse Skippy`)', () => {
        expect(repairDroppedBrand('skippy peanut butter', 'Ryse Skippy')).toBe('Ryse Skippy peanut butter');
    });
    it('reads a plural brand the model singularised as KEPT (`Pop-Tarts` vs `pop tart`), hyphens folded', () => {
        expect(repairDroppedBrand('frosted strawberry pop tart', 'Pop-Tarts')).toBeNull();
        expect(repairDroppedBrand('chick fil a spicy chicken sandwich', 'Chick-fil-A')).toBeNull();
    });

    it('reads `M&M\'s` in `m and ms pretzel` as KEPT, which the alphanumeric fold alone missed (#167)', () => {
        expect(repairDroppedBrand('m and ms pretzel', "M&M's")).toBeNull();
    });

    it('returns null on an empty name and never prepends an empty brand fold', () => {
        expect(repairDroppedBrand(undefined, 'Ryse')).toBeNull();
        expect(repairDroppedBrand('peanut butter', '&')).toBe('& peanut butter');
    });
});

/**
 * PUNCH #167 (2026-09-14) — POSITIVE CASES. Each row asserts the baseName the
 * repair must hand retrieval, not merely that it changed: the doubling rows of
 * the committed 1,553-row `AiNormalizeCache` census (`M&M's`, `Noodles & Company`,
 * `Optimum Nutrition`, and the curly-apostrophe class), the S47 adjacency arms
 * C/D/E, and the `Ben & Jerry's` class that already worked.
 */
describe('punch #167 — a brand the line already carries is not prepended on top of it', () => {
    it.each([
        ['m and ms pretzel', 'pretzel', "M&M's", 'm and ms pretzel'],
        ['a fun size bag of m&ms', 'm&ms', "m&m's", 'm&ms'],
        ['noodles and company pad thai', 'pad thai', 'Noodles & Company', 'noodles and company pad thai'],
        ['optimum weigh nutrition protein', 'protein', 'Optimum Nutrition', 'optimum weigh nutrition protein'],
        ['and a half of optimum weight nutrition protein', 'protein', 'Optimum Nutrition', 'and a half of optimum weight nutrition protein'],
        ['angie’s boomchickapop sweet and salty', 'boomchickapop sweet and salty', "Angie's Boomchickapop", 'angie’s boomchickapop sweet and salty'],
        ['a serving of McDonald’s sized french fries', 'french fries', "McDonald's", 'McDonald’s sized french fries'],
    ])('%s | %s | %s -> %s', (rawLine, normalizedForm, brand, expected) => {
        expect(preflight(rawLine, normalizedForm, brand).baseName).toBe(expected);
    });

    it('the S47 adjacency arms: the inline form doubled C and E and not D; now none doubles', () => {
        const arms: Array<[string, string, string, string, string]> = [
            // [arm, rawLine, normalizedForm, brand, the inline form's baseName]
            ['C', 'optimum whey nutrition protein', 'whey protein', 'Optimum Nutrition', 'Optimum Nutrition optimum whey nutrition protein'],
            ['D', 'optimum nutrition weigh protein', 'weigh protein', 'optimum nutrition', 'optimum nutrition weigh protein'],
            ['E', 'optimum gold nutrition protein', 'protein', 'Optimum Nutrition', 'Optimum Nutrition optimum gold nutrition protein'],
        ];
        for (const [arm, rawLine, normalizedForm, brand, inlineBaseName] of arms) {
            const rederived = parseIngredientLine(rawLine)?.name?.trim() || rawLine;
            expect([arm, inlineRepairBeforeExtraction(normalizedForm, brand, rederived).baseName])
                .toEqual([arm, inlineBaseName]);
            expect([arm, preflight(rawLine, normalizedForm, brand).baseName]).toEqual([arm, rawLine]);
        }
    });

    it('keeps the class that already worked, in both spellings, and un-doubles the draw that did double', () => {
        expect(preflight('ben and jerrys cherry garcia', 'cherry garcia', "Ben & Jerry's").baseName)
            .toBe('ben and jerrys cherry garcia');
        expect(preflight('ben and jerrys cherry garcia', 'cherry garcia', "Ben and Jerry's").baseName)
            .toBe('ben and jerrys cherry garcia');
        expect(preflight('and ben jerry', 'and ben jerry', "Ben & Jerry's"))
            .toMatchObject({ baseName: 'and ben jerry', declined: null });
        // The guard call behind the composite arm's `Ben Jerry's Ben & Jerry's Ice Cream`
        // (Lane A S50 arm A log, 2026-09-14): the simplify recursion re-entered the mapper
        // with rawLine `Ben & Jerry's Ice Cream`, the segment's normalizedForm
        // `and ben jerry` as baseName, and the detector's `Ben Jerry's` as the brand.
        const logged = {
            rawLine: "Ben & Jerry's Ice Cream", baseName: 'and ben jerry', targetBrand: "Ben Jerry's",
            rederived: "Ben & Jerry's Ice Cream", parsed: null,
        };
        expect(inlineRepairBeforeExtraction(logged.baseName, logged.targetBrand, logged.rederived))
            .toEqual({ baseName: "Ben Jerry's Ben & Jerry's Ice Cream", applied: true });
        expect(preserveDroppedBrand(logged))
            .toEqual({ baseName: 'and ben jerry', applied: false, declined: null });
    });

    it('separates the candidate rules: a contiguous fold misses the split and plural rows; the shipped predicate does not', () => {
        // #407's fold (kept branch `903dd09`), which is still a contiguous includes().
        const fold = (s: string) => s.toLowerCase().replace(/['’`]/g, '').replace(/&/g, ' and ')
            .replace(/[-.\/]+/g, ' ').replace(/\s+/g, ' ').trim();
        const rows: Array<[string, string]> = [
            ['optimum weigh nutrition protein', 'Optimum Nutrition'],
            ['optimum whey nutrition protein', 'Optimum Nutrition'],
            ['optimum gold nutrition protein', 'Optimum Nutrition'],
            ['and ben jerry', "Ben & Jerry's"],
        ];
        for (const [text, brand] of rows) {
            expect([text, fold(text).includes(fold(brand))]).toEqual([text, false]);
            expect([text, brandAlreadyPresent(text, brand)]).toEqual([text, true]);
        }
    });
});

describe('brandAlreadyPresent — the containment clauses both guards share (#167; guard 1 asks them through brandPresentForPrepend)', () => {
    it("keeps both guards' old tests: contiguous, and the alphanumeric fold with its plural rule", () => {
        expect(brandAlreadyPresent('oikos triple zero vanilla', 'oikos')).toBe(true);
        expect(brandAlreadyPresent("m m's", 'm&ms')).toBe(true);
        expect(brandAlreadyPresent('frosted strawberry pop tart', 'Pop-Tarts')).toBe(true);
    });

    it('reads the brand word by word: `&` against `and`, curly apostrophes, order, plural', () => {
        expect(brandAlreadyPresent('m and ms pretzel', "M&M's")).toBe(true);
        expect(brandAlreadyPresent('angie’s boomchickapop', "Angie's Boomchickapop")).toBe(true);
        expect(brandAlreadyPresent('optimum weigh nutrition protein', 'Optimum Nutrition')).toBe(true);
        expect(brandAlreadyPresent('and ben jerry', "Ben & Jerry's")).toBe(true);
    });

    it('does not accept a brand of which only some words are present', () => {
        expect(brandAlreadyPresent('optimum protein', 'Optimum Nutrition')).toBe(false);
        expect(brandAlreadyPresent('great northern beans', 'Great Value')).toBe(false);
        expect(brandAlreadyPresent('skippy peanut butter', 'Ryse Skippy')).toBe(false);
    });

    it('treats a missing text as absent, and a symbol-only brand by its folded word', () => {
        expect(brandAlreadyPresent(undefined, 'Ryse')).toBe(false);
        expect(brandAlreadyPresent('', 'Ryse')).toBe(false);
        expect(brandAlreadyPresent('peanut butter', '&')).toBe(false);
    });
});

/**
 * PUNCH #167 FIX-FORWARD (Lane A S51, 2026-09-15). #438 deployed with one measured
 * regression: golden n-supp-22 posts items-form `2 rx bars` with brand `rxbar` and
 * normalizedForm `protein bar`, clause 2 read `rxbar` inside `rxbars`, guard 1
 * returned `rx bars` without the prepend, and retrieval went from RXBAR to "Fig Bars"
 * (`fs_38893`, cold 3/3). Guard 1 now asks `brandPresentForPrepend()`, which skips
 * clause 2 for a brand that folds to one word. The spelling comes from the golden
 * FIXTURE, never a segmenter draw (both pinned S50 draws carried `rx`).
 */
describe('punch #167 fix-forward — a one-word brand the line spells as two words is still prepended', () => {
    it('restores the n-supp-22 prepend through the shipped function: `rxbar rx bars`', () => {
        const parsed = parseIngredientLine('2 rx bars');
        expect(preserveDroppedBrand({
            rawLine: '2 rx bars', baseName: 'protein bar', targetBrand: 'rxbar', rederived: 'rx bars', parsed,
        })).toEqual({ baseName: 'rxbar rx bars', applied: true, declined: null });
    });

    it('guard 1 does not read a one-word brand inside a split spelling as present; guard 2 still does', () => {
        expect(brandPresentForPrepend('rx bars', 'rxbar')).toBe(false);
        expect(brandAlreadyPresent('rx bars', 'rxbar')).toBe(true);
    });

    it('keeps clause 2 for a brand that folds to more than one word — the input a clause-2 deletion re-doubles', () => {
        expect(brandAlreadyPresent('ben jerry', "Ben & Jerry's")).toBe(true);
        expect(brandPresentForPrepend('ben jerry', "Ben & Jerry's")).toBe(true);
        expect(preflight('ben jerry', 'ben jerry', "Ben & Jerry's").baseName).toBe('ben jerry');
    });

    it("keeps clause 3 on the `&`/`and` spelling, and guard 2 keeps `m&ms` in `m m's` (PR #421)", () => {
        expect(brandAlreadyPresent('m and ms pretzel', "M&M's")).toBe(true);
        expect(brandPresentForPrepend('m and ms pretzel', "M&M's")).toBe(true);
        expect(repairDroppedBrand("m m's", 'm&ms')).toBeNull();
    });

    it('still reads a one-word brand spelled contiguously (clause 1) or word for word (clause 3) as present', () => {
        expect(brandPresentForPrepend('oikos triple zero vanilla', 'oikos')).toBe(true);
        expect(brandPresentForPrepend('hersheys kisses', "Hershey's")).toBe(true);
    });

    it('asks the one-word rule on BOTH of guard 1\'s checks: a segmenter form that already reads `rx bars`', () => {
        const parsed = parseIngredientLine('2 rx bars');
        expect(preserveDroppedBrand({
            rawLine: '2 rx bars', baseName: 'rx bars', targetBrand: 'rxbar', rederived: 'rx bars', parsed,
        })).toEqual({ baseName: 'rxbar rx bars', applied: true, declined: null });
    });

    it('guard 2 keeps reading a one-word brand the model split as KEPT — a prepend there is the doubling', () => {
        expect(repairDroppedBrand('rx bars', 'rxbar')).toBeNull();
        expect(repairDroppedBrand('chocolate sea salt rx bar', 'RXBAR')).toBeNull();
    });

    it('keeps clause 2 for a two-word fold too, not only for three-word ones', () => {
        expect(brandPresentForPrepend('frosted strawberry poptart', 'Pop-Tarts')).toBe(true);
    });

    it('ACCEPTED TRADE-OFF: a segmenter-named one-word brand on a line spelled as two words is prepended', () => {
        // Refuter lens 3 on #439: MEL history holds no such draw; if one comes, the line
        // retrieves with the brand doubled, as `2 rx bars` did before #167 — which there
        // was the only brand token retrieval had. Change this pin only with a measurement.
        const parsed = parseIngredientLine('sun chips harvest cheddar');
        expect(preserveDroppedBrand({
            rawLine: 'sun chips harvest cheddar', baseName: 'sun chips harvest cheddar',
            targetBrand: 'SunChips', rederived: 'sun chips harvest cheddar', parsed,
        })).toEqual({ baseName: 'SunChips sun chips harvest cheddar', applied: true, declined: null });
    });
});

describe('punch #196 — an applied repair carries the segmenter-only tokens on its end', () => {
    /**
     * THE PAYLOAD HALF OF #167. An applied repair hands retrieval the PARSER's
     * re-derivation and discards the segmenter's `normalizedForm`, so a correction only
     * the segmenter made is thrown away with it.
     *
     * Every input below is a REAL one, copied verbatim from the committed 602-tuple
     * capture `scripts/eval/punch-167-composite-arm/s51_guard_capture.jsonl` (the shipped
     * mapper's own arguments over every distinct `SegmentationCache` segment tuple, Lane A
     * S51, 2026-09-15; 266 reach guard 1 and 218 apply). Re-derive the whole table with
     * `s52_union_replay.ts` beside the capture: on this tree it must read exactly 2 changed
     * and 264 identical, and on master 0 changed.
     */

    it('carries `bar` back onto the Quest line — one of the two members', () => {
        // capture #262. The segmenter wrote `cooky cream protein bar`; the re-derivation
        // dropped `bar`, the product form.
        const parsed = parseIngredientLine('bar cooky cream protein quest');
        expect(preserveDroppedBrand({
            rawLine: 'bar cooky cream protein quest', baseName: 'cooky cream protein bar',
            targetBrand: 'Quest', rederived: 'cooky cream protein quest', parsed,
        })).toEqual({ baseName: 'cooky cream protein quest bar', applied: true, declined: null });
    });

    it('carries `whey` back onto the Optimum line, and leaves the typo `weigh` where it is', () => {
        // capture #463. The union ADDS; it does not repair. `weigh` is what the user typed
        // and the parser kept, `whey` is what the segmenter corrected it to, and retrieval
        // now gets both.
        const parsed = parseIngredientLine('One scoop of optimum weigh nutrition protein');
        expect(preserveDroppedBrand({
            rawLine: 'One scoop of optimum weigh nutrition protein', baseName: 'whey protein',
            targetBrand: 'Optimum Nutrition', rederived: 'optimum weigh nutrition protein', parsed,
        })).toEqual({
            baseName: 'optimum weigh nutrition protein whey', applied: true, declined: null,
        });
    });

    it('APPENDS, never prepends: the leading tokens are exactly what master produced', () => {
        // `deriveMustHaveTokens()` reads its slots off the FRONT (`coreTokens.slice(0, 2)`),
        // so a prepend would change admission on every one of the 218 applied inputs.
        // A mutant that prepends the carried tokens reds both members above and this pin.
        const parsed = parseIngredientLine('bar cooky cream protein quest');
        const out = preserveDroppedBrand({
            rawLine: 'bar cooky cream protein quest', baseName: 'cooky cream protein bar',
            targetBrand: 'Quest', rederived: 'cooky cream protein quest', parsed,
        }).baseName;
        expect(out.startsWith('cooky cream protein quest')).toBe(true);
        expect(out.split(/\s+/)[0]).toBe('cooky');
    });

    it('leaves a GAINER byte-identical — the 47 inputs that refute "prefer the segmenter form"', () => {
        // capture: `optimum nutrition gold standard whey banana cream`. The segmenter form
        // is the SHORTER one here (`whey banana cream`), so preferring it would truncate
        // `gold standard` — the 667-serve key. The union adds nothing, because every
        // segmenter token is already in the payload.
        const parsed = parseIngredientLine('optimum nutrition gold standard whey banana cream');
        expect(preserveDroppedBrand({
            rawLine: 'optimum nutrition gold standard whey banana cream',
            baseName: 'whey banana cream', targetBrand: 'Optimum Nutrition',
            rederived: 'optimum nutrition gold standard whey banana cream', parsed,
        })).toEqual({
            baseName: 'optimum nutrition gold standard whey banana cream',
            applied: true, declined: null,
        });
    });

    it('leaves a second gainer byte-identical — the Silk line', () => {
        const parsed = parseIngredientLine('1 1/2 cups silk unsweetened almond milk');
        expect(preserveDroppedBrand({
            rawLine: '1 1/2 cups silk unsweetened almond milk', baseName: 'almond milk',
            targetBrand: 'silk', rederived: 'silk unsweetened almond milk', parsed,
        })).toEqual({ baseName: 'silk unsweetened almond milk', applied: true, declined: null });
    });

    it('leaves a PREPENDING applied input byte-identical — the brand is added, nothing else is', () => {
        const parsed = parseIngredientLine('100g brown instant maple oat');
        expect(preserveDroppedBrand({
            rawLine: '100g brown instant maple oat', baseName: 'brown instant maple oat',
            targetBrand: 'Quaker', rederived: 'brown instant maple oat', parsed,
        })).toEqual({ baseName: 'Quaker brown instant maple oat', applied: true, declined: null });
    });

    it('never touches a DECLINE — `brand_consumed_as_quantity` returns baseName untouched', () => {
        // capture: the `one` count-word misfire. A declined line must not gain a token; the
        // refusal's premise is that the block had no business firing at all.
        const parsed = parseIngredientLine('one and a half cups of unsweetened almond milk');
        expect(preserveDroppedBrand({
            rawLine: 'one and a half cups of unsweetened almond milk',
            baseName: 'unsweetened almond milk', targetBrand: 'one',
            rederived: 'unsweetened almond milk', parsed,
        })).toEqual({
            baseName: 'unsweetened almond milk', applied: false,
            declined: 'brand_consumed_as_quantity',
        });
    });

    it('never touches a brand-already-present decline either', () => {
        const parsed = parseIngredientLine('0.4 bell pepper');
        expect(preserveDroppedBrand({
            rawLine: '0.4 bell pepper', baseName: 'bell pepper', targetBrand: 'bell',
            rederived: 'bell pepper', parsed,
        })).toEqual({ baseName: 'bell pepper', applied: false, declined: null });
    });

    it('excludes the brand tokens, so #167 doubling cannot come back through the carry', () => {
        // The segmenter form carries ONE word of the two-word brand — not enough for any
        // containment clause, so the repair applies; the re-derivation carries both, so the
        // payload is the re-derivation. `nutrition` must not be carried on top of it.
        const parsed = parseIngredientLine('optimum nutrition gold standard whey protein');
        const out = preserveDroppedBrand({
            rawLine: 'optimum nutrition gold standard whey protein',
            baseName: 'nutrition gold standard whey', targetBrand: 'Optimum Nutrition',
            rederived: 'optimum nutrition protein', parsed,
        });
        expect(out).toEqual({
            baseName: 'optimum nutrition protein gold standard whey', applied: true, declined: null,
        });
        expect(out.baseName.toLowerCase().split(/\s+/).filter(t => t === 'nutrition')).toHaveLength(1);
    });

    it('REFUSES the carry on the prepend branch — n-supp-22 stays byte-identical', () => {
        // `2 rx bars` is the #167 fix-forward's own golden line. Carrying here appended
        // `protein` and moved it to off_0193908005342 (110 g / 459.8 kcal) on 4 of 4 pinned
        // composite-arm runs, cold and warm, against off_0193908001672 (104 g / 359.8 kcal)
        // with a zero same-tree floor. The carry rides the no-prepend branch only.
        const parsed = parseIngredientLine('2 rx bars');
        expect(preserveDroppedBrand({
            rawLine: '2 rx bars', baseName: 'protein bar', targetBrand: 'rxbar',
            rederived: 'rx bars', parsed,
        })).toEqual({ baseName: 'rxbar rx bars', applied: true, declined: null });
    });

    it('REFUSES the carry on the prepend branch even when the segmenter had real tokens', () => {
        const parsed = parseIngredientLine('100g brown instant maple oat');
        expect(preserveDroppedBrand({
            rawLine: '100g brown instant maple oat', baseName: 'brown instant maple oat steel cut',
            targetBrand: 'Quaker', rederived: 'brown instant maple oat', parsed,
        })).toEqual({ baseName: 'Quaker brown instant maple oat', applied: true, declined: null });
    });

    it('does not grow a repeated run — a token carried twice is carried once', () => {
        const parsed = parseIngredientLine('2 quest bars');
        expect(preserveDroppedBrand({
            rawLine: '2 quest bars', baseName: 'bar chocolate bar', targetBrand: 'Quest',
            rederived: 'quest chocolate', parsed,
        }).baseName).toBe('quest chocolate bar');
    });

    it('is plural-tolerant, so `bar` is not carried alongside `bars`', () => {
        const parsed = parseIngredientLine('2 quest bars');
        expect(preserveDroppedBrand({
            rawLine: '2 quest bars', baseName: 'protein bar', targetBrand: 'Quest',
            rederived: 'quest bars', parsed,
        }).baseName).toBe('quest bars protein');
    });
});
