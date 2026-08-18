/**
 * serving-tier-band.test.ts — `expectServingTier`, the golden-set band that reads
 * the dev-bypass debug echo (2026-08-17, the prose set).
 *
 * THE CONTRACT IN ONE LINE: scored only when the response item CARRIES the
 * `servingTier` key; skipped — never failed — when it does not. run-eval sends
 * `debug=1` in --nocache mode only, so a warm run's items have no such key and a
 * case naming a tier must not go red on a field the server never sent. With the
 * key present, a null tier IS a mismatch: the echo says the producer stamped
 * nothing, and no case that names a rung asks for that.
 *
 * Every test here is on the pure scorer (scripts/eval/assertions.ts) — no
 * network, no DB, same as fail-closed.test.ts.
 */

import { scoreNlpCase } from '../assertions';

// Only scoreNlpCase is imported, deliberately: it exists on the pre-band tree, so
// this file RUNS there and shows the band missing (the fail-expected tests go
// green-by-vacuity) while the controls stay green — a RED that is a verdict, not
// a compile error. The matcher (servingTierMatches) is exercised through it.

/** A mapped line as /api/nlp/parse returns it WITHOUT the debug echo. */
function warmItem(over: Record<string, unknown> = {}) {
    return {
        rawText: 'some cereal', foodName: 'Cereal', brandName: null, foodId: 'off_0042400265177',
        source: 'openfoodfacts', matchConfidence: 0.92, grams: 26,
        nutrition: { calories: 100.1, protein: 2, carbs: 22, fat: 1 },
        nutritionPer100g: { kcal100: 385, protein100: 7.7, carbs100: 84.6, fat100: 3.8 },
        servingOptions: [],
        ...over,
    };
}

/** The same line WITH the echo (dev bypass + debug=1). */
function coldItem(servingTier: string | null, over: Record<string, unknown> = {}) {
    return warmItem({ servingTier, cacheHit: null, ...over });
}

describe('scoreNlpCase: expectServingTier', () => {
    const cereal = { expectName: [['cereal']], grams: [25, 70] as [number, number], expectServingTier: 'bare_*' };

    // -------------------------------------------------------------------
    // CONTROLS — green on the pre-band tree and on this one.
    // -------------------------------------------------------------------
    it('control: a case WITHOUT expectServingTier is untouched by an echoed tier', () => {
        const c = { expectName: [['cereal']], grams: [25, 70] as [number, number] };
        expect(scoreNlpCase(c, [coldItem('count_unresolved_floor')])).toEqual([]);
        expect(scoreNlpCase(c, [warmItem()])).toEqual([]);
    });

    it('control: the other bands still fire alongside the tier band', () => {
        const failures = scoreNlpCase(cereal, [coldItem('bare_label_serving', { grams: 100 })]);
        expect(failures.some(f => f.startsWith('grams=100'))).toBe(true);
        expect(failures.some(f => f.startsWith('servingTier='))).toBe(false);
    });

    // -------------------------------------------------------------------
    // FAIL-OPEN — the warm run.
    // -------------------------------------------------------------------
    it('SKIPPED, not failed, when the item carries no servingTier key (warm run: no echo)', () => {
        expect(scoreNlpCase(cereal, [warmItem()])).toEqual([]);
    });

    it('a case that names a tier still passes warm on its OTHER bands alone', () => {
        const eggWhites = {
            expectName: [['egg', 'white']], grams: [200, 280] as [number, number],
            expectServingTier: ['volume_unit', 'fdc_label_volume'],
        };
        expect(scoreNlpCase(eggWhites, [warmItem({ foodName: 'Egg whites', grams: 243 })])).toEqual([]);
    });

    // -------------------------------------------------------------------
    // SCORED — the cold run.
    // -------------------------------------------------------------------
    it('PASSES on an echoed tier that matches (exact and glob)', () => {
        expect(scoreNlpCase(cereal, [coldItem('bare_label_serving')])).toEqual([]);
        const chicken = { expectName: [['chicken']], expectServingTier: ['weight_unit', 'fs_weight_direct'] };
        expect(scoreNlpCase(chicken, [coldItem('fs_weight_direct', { foodName: 'Chicken Breast' })])).toEqual([]);
    });

    it('a trailing * is a PREFIX glob — `bare_*` is any bare rung, not a substring and not a neighbour', () => {
        expect(scoreNlpCase(cereal, [coldItem('bare_name_sibling_serving_tight')])).toEqual([]);
        expect(scoreNlpCase(cereal, [coldItem('label_serving_default')]).length).toBe(1);
        expect(scoreNlpCase(cereal, [coldItem('fs_bare_x')]).length).toBe(1);
        // a single string and a one-element list are the same spec
        const asList = { ...cereal, expectServingTier: ['bare_*'] };
        expect(scoreNlpCase(asList, [coldItem('bare_plural_serving')])).toEqual([]);
    });

    it('FAILS on an echoed tier outside the alternatives, and the message names both sides', () => {
        const failures = scoreNlpCase(cereal, [coldItem('count_unresolved_floor')]);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('servingTier=count_unresolved_floor');
        expect(failures[0]).toContain('bare_*');
    });

    it('the egg-white shape: fdc_volume_ai is a FAIL where volume_unit / fdc_label_volume pass', () => {
        const eggWhites = {
            expectName: [['egg', 'white']],
            expectServingTier: ['volume_unit', 'fdc_label_volume'],
        };
        const item = (tier: string) => coldItem(tier, { foodName: 'Eggs, Grade A, Large, egg white' });
        expect(scoreNlpCase(eggWhites, [item('fdc_volume_ai')]).join(' ')).toContain('servingTier=fdc_volume_ai');
        expect(scoreNlpCase(eggWhites, [item('volume_unit')])).toEqual([]);
        expect(scoreNlpCase(eggWhites, [item('fdc_label_volume')])).toEqual([]);
    });

    it('with the key PRESENT, a null tier is a mismatch — the echo is on and the producer stamped nothing', () => {
        const failures = scoreNlpCase(cereal, [coldItem(null)]);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('servingTier=null');
    });

    it('reads items[0] only, like every other band', () => {
        // second item's tier is irrelevant; first item's is what is scored
        expect(scoreNlpCase(cereal, [coldItem('bare_plural_serving'), coldItem('count_unresolved_floor')])).toEqual([]);
        expect(scoreNlpCase(cereal, [coldItem('count_unresolved_floor'), coldItem('bare_plural_serving')]).length).toBe(1);
    });
});
