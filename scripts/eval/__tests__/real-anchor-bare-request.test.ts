/**
 * real-anchor-bare-request.test.ts — pins the two 2026-08-08 screen fixes.
 *
 * DEFECT 1 (the load-bearing pin). resolveRealServings passed a literal `null`
 * as the `parsed` argument of hydrateAndSelectServing. Both bare-request
 * predicates in src/lib/servings/bare-query-guard.ts return `false` on a null
 * parsed, so every bare-serving guard (category-default CAP/REPLACE, the
 * name-sibling rungs, the FatSecret bare-plural suppression) was OFF in the
 * screen while ON in production — the screen's own claim of billing "what the
 * REQUEST PATH would bill for a unitless 1x" was false. Measured 2026-08-08:
 * 12 of 14 serving-flagged triage rows showed `flat_100g_default` on their
 * cards while production billed `bare_category_default` /
 * `bare_name_sibling_serving_tight` / `fs_default_serving`.
 *
 * The pin imports the REAL predicates (not re-implementations) and asserts the
 * parsed object the screen now builds satisfies them for a bare seed phrase.
 * This is the test that dies if someone reverts `parsed` to null or forks the
 * construction away from the production parser.
 *
 * DEFECT 2. The LLM card paired the cascade's billed grams with the record's
 * STORED default-serving description (`0.6 g  (label: 1 cup)` on FatSecret
 * "Baby Spinach" — grams from the "1 baby leaf" row, description from another).
 * servingLabelFor owns the honest pairing rules; pinned here per origin.
 *
 * NO NETWORK, NO DATABASE, NO API KEY. bareUnitlessRequest lazy-requires the
 * real parser chain (pure functions + on-disk JSON rules); nothing here touches
 * the mapper, Prisma, or an LLM.
 */

import {
    bareUnitlessRequest,
    llmUserPrompt,
    servingLabelFor,
    type ScreenRow,
} from '../correctness-screen';
import {
    isBareUnitlessQty1,
    isBarePluralRequest,
} from '../../../src/lib/servings/bare-query-guard';

// ---------------------------------------------------------------------------
// Defect 1: the parsed object the screen passes takes the production bare path
// ---------------------------------------------------------------------------

describe('bareUnitlessRequest: the screen bills the production unitless-1x path', () => {
    it('DOCUMENTS THE DEFECT: a null parsed switches the bare guard off', () => {
        // This is why the literal null was a bug — the predicate production runs
        // can never pass, whatever the raw line says.
        expect(isBareUnitlessQty1(null, 'grape jelly')).toBe(false);
    });

    it('a bare seed phrase parses to an object the REAL bare predicate accepts', () => {
        const { parsed, rawLine } = bareUnitlessRequest('grape jelly', 'grape jelly');
        expect(parsed).not.toBeNull();
        // The real predicate, imported from production. Reverting parsed to null
        // (or hand-building an object that drifts from the parser — qty !== 1,
        // multiplier missing, a unit sneaking in) kills this line.
        expect(isBareUnitlessQty1(parsed, rawLine)).toBe(true);
        expect(parsed!.qty).toBe(1);
        expect(parsed!.multiplier).toBe(1);
        expect(parsed!.unit ?? null).toBeNull();
        expect(parsed!.name.toLowerCase()).toContain('jelly');
    });

    it('a bare PLURAL seed satisfies the real bare-plural predicate too', () => {
        const { parsed, rawLine } = bareUnitlessRequest('almonds', 'almond');
        expect(parsed).not.toBeNull();
        expect(isBareUnitlessQty1(parsed, rawLine)).toBe(true);
        expect(isBarePluralRequest(parsed, rawLine, parsed!.name)).toBe(true);
    });

    it('falls back to the token-sorted key when the seed is missing — still bare', () => {
        // attribute() fills seed with '' when a row cannot be attributed; the key
        // ("jelly grape") is token-sorted but digitless and unitless, which is all
        // the predicates read.
        for (const seed of ['', undefined] as const) {
            const { parsed, rawLine } = bareUnitlessRequest(seed, 'jelly grape');
            expect(rawLine).toBe('jelly grape');
            expect(isBareUnitlessQty1(parsed, rawLine)).toBe(true);
        }
    });

    it('empty seed AND key yield a null parsed, not a fabricated request', () => {
        const { parsed, rawLine } = bareUnitlessRequest('', '');
        expect(parsed).toBeNull();
        expect(rawLine).toBe('');
    });

    it('does NOT force bareness: a quantified seed stays on the counted path', () => {
        // The fix must reproduce production behaviour, not maximise guard firing:
        // a digit-carrying line is exactly what the digit gate exists to exclude.
        const { parsed, rawLine } = bareUnitlessRequest('15 pretzels', '15 pretzels');
        expect(parsed).not.toBeNull();
        expect(isBareUnitlessQty1(parsed, rawLine)).toBe(false);
        const cup = bareUnitlessRequest('2 cups milk', 'cup milk');
        expect(isBareUnitlessQty1(cup.parsed, cup.rawLine)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Defect 2: the card's serving label must correspond to the printed grams
// ---------------------------------------------------------------------------

/** A FatSecret row shaped like the Baby Spinach artifact. */
function fsRow(over: Partial<ScreenRow> = {}): ScreenRow {
    return {
        key: 'baby spinach',
        src: 'fatsecret',
        conf: 0.9,
        validatedby: 'ai',
        mapfoodname: 'Baby Spinach',
        mapbrand: '',
        recname: 'Baby Spinach',
        recbrand: '',
        per100g: { calories: 23, protein: 2.9, carbs: 3.6, fat: 0.4 },
        off_serving_grams: null,
        off_serving_size: '',
        pkg_qty: null,
        pkg_unit: '',
        corruptreason: '',
        dupof: '',
        fs_serving_desc: '1 cup',            // the stored DEFAULT serving row
        fs_serving_grams: 30,
        fs_serving_nutrients: null,
        recid: '12345',
        n_off_servings: 0,
        off_serv_min_g: null,
        off_serv_max_g: null,
        fdc_serving_size: null,
        fdc_serving_unit: '',
        fdc_serv_min_g: null,
        seed: 'baby spinach',
        ...over,
    };
}

describe('servingLabelFor: grams and label must come from the same serving', () => {
    it('real-anchor grams never wear the stored default-serving description', () => {
        // The Baby Spinach shape: hydration chose the "1 baby leaf" row (0.6 g),
        // the stored default description is "1 cup". The old card printed
        // `0.6 g (label: 1 cup)`.
        const r = fsRow({
            real: { grams: 0.6, tier: 'fs_default_serving', kcal: 0, desc: '1 leaf' },
        });
        const label = servingLabelFor(r, { grams: 0.6, from: 'hydrateAndSelectServing:fs_default_serving' });
        expect(label).toBe('1 leaf');
        expect(label).not.toBe('1 cup');
    });

    it('real-anchor grams with no hydration description drop the label entirely', () => {
        const r = fsRow({
            real: { grams: 0.6, tier: 'fs_default_serving', kcal: 0, desc: null },
        });
        expect(servingLabelFor(r, { grams: 0.6, from: 'hydrateAndSelectServing:fs_default_serving' })).toBeNull();
        // Same rule for the AI-estimated (unjudged) origin.
        expect(servingLabelFor(r, { grams: 30, from: 'ai-estimated:count_unit_ai' })).toBeNull();
    });

    it('reconstruction grams keep the stored label ONLY from their own row', () => {
        const r = fsRow({ off_serving_size: '2 tbsp (32 g)', real: undefined });
        // Consistent pairs — same DB row by ROW_SQL's join construction.
        expect(servingLabelFor(r, { grams: 32, from: 'OffFood.servingGrams' })).toBe('2 tbsp (32 g)');
        expect(servingLabelFor(r, { grams: 30, from: 'FatSecretServing.grams' })).toBe('1 cup');
        // Origins with no stored description in the row get none.
        expect(servingLabelFor(r, { grams: 25, from: 'OffServing.grams' })).toBeNull();
        expect(servingLabelFor(r, { grams: 25, from: 'FdcServing.grams' })).toBeNull();
        expect(servingLabelFor(r, { grams: 25, from: 'FdcFood.servingSize' })).toBeNull();
        // No grams, no label.
        expect(servingLabelFor(r, { grams: null, from: 'none (flat-100g default)' })).toBeNull();
    });

    it('END TO END: the card prints the hydration label, not the stored one', () => {
        const r = fsRow({
            real: { grams: 0.6, tier: 'fs_default_serving', kcal: 0, desc: '1 leaf' },
        });
        const card = llmUserPrompt(r);
        expect(card).toContain('default serving: 0.6 g  (label: 1 leaf, via hydrateAndSelectServing:fs_default_serving)');
        expect(card).not.toContain('label: 1 cup');
    });

    it('END TO END: a label-less real anchor prints origin only — no dishonest label', () => {
        const r = fsRow({
            real: { grams: 0.6, tier: 'fs_default_serving', kcal: 0, desc: null },
        });
        const card = llmUserPrompt(r);
        expect(card).toContain('default serving: 0.6 g  (via hydrateAndSelectServing:fs_default_serving)');
        expect(card).not.toContain('label:');
    });
});
