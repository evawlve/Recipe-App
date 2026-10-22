/**
 * C70 row 7 (S341, 2026-10-20) — a brand or chili-variety word before `pepper` is not the spice.
 *
 * The spice regex in getBareQueryDefault() excluded only `bell` before `pepper`, so every other
 * `<word> pepper` line was capped to the 2.5 g teaspoon default. Two classes of word, one fix:
 *   - a BRAND that IS the drink: `dr pepper` / `diet dr pepper` (a 355 ml / 473 ml label billed 2.5 g);
 *   - a chili VARIETY, which is produce: anaheim, fresno, cubanelle, habanero, ... (a vegetable panel).
 * Population (MEL organic, 90 d, measured 2026-10-20): dr pepper 7 ev + diet dr pepper 4 ev,
 * anaheim 5, fresno 4, cubanelle 3, habanero 3, roasted red pepper 2 = 28 ev / 7 lines, all billed
 * 2.5 g under bare_category_default. `black pepper` (378 ev at 2.5 g) is RIGHT and stays.
 *
 * The lookbehind sees ONE word, so `red`, `chili`, `chile`, `ghost` (crushed red pepper, red pepper
 * flakes, chili pepper flakes) and cayenne/black/white/ground/lemon/hot/crushed/pink/sichuan stay
 * OUT of the list: those are spices and must keep 2.5 g.
 *
 * RESIDUAL, not fixed here: on a REPLACE tier the guard reads the RECORD name, and fs_6263 is named
 * bare `Pepper`, so an anaheim/fresno line billed on a REPLACE tier still re-caps to 2.5. The
 * measured tier is fs_default_serving (a CAP tier), so the 9 events move. Pinned below.
 */

import { getBareQueryDefault } from '../../ai/ambiguous-serving-estimator';
import { applyOffBareQueryGuard, isDoseAnchoredBareQuery } from '../bare-query-guard';
import type { ParsedIngredient } from '../../parse/ingredient-line';

const bare = (name: string): ParsedIngredient =>
    ({ qty: 1, unit: null, multiplier: 1, name } as unknown as ParsedIngredient);

function guard(queryName: string, grams: number, servingTier: string, foodName = 'irrelevant to the CAP path') {
    return applyOffBareQueryGuard({
        grams,
        servingTier,
        parsed: bare(queryName),
        rawLine: queryName,
        queryName,
        foodName,
    });
}

describe('pepper lexicon: brand and chili-variety words are not the spice default', () => {
    it.each([
        ['dr pepper'], ['diet dr pepper'], ['dr. pepper'], ['green pepper'], ['roasted red pepper'],
        ['sweet pepper'], ['jalapeno pepper'], ['jalapeño pepper'], ['poblano pepper'],
        ['serrano pepper'], ['anaheim pepper'], ['fresno pepper'], ['cubanelle pepper'],
        ['habanero pepper'], ['banana pepper'], ['scotch bonnet pepper'],
        ['bell pepper'], ['red bell pepper'],
    ])('%p has no spice default', (q) => {
        expect(getBareQueryDefault(q)).toBeNull();
    });

    it.each([
        ['black pepper'], ['cayenne pepper'], ['pepper flakes'], ['white pepper'], ['ground pepper'],
        ['pepper'], ['lemon pepper seasoning'], ['red pepper'], ['chili pepper'],
        ['crushed red pepper'], ['red pepper flakes'], ['ground red pepper'],
        ['chili pepper flakes'], ['ghost pepper'], ['hot pepper'],
    ])('%p keeps the 2.5 g spice default', (q) => {
        expect(getBareQueryDefault(q)?.grams).toBe(2.5);
    });

    it.each([
        ['peppercorn'], ['mini peppers'], ['shishito peppers'], ['stuffed peppers'],
    ])('%p is null both ways (\\bpepper\\b never matches peppers/peppercorn)', (q) => {
        expect(getBareQueryDefault(q)).toBeNull();
    });
});

describe('pepper lexicon: dose anchor', () => {
    it('dr pepper is no longer dose-anchored', () => {
        expect(isDoseAnchoredBareQuery('dr pepper')).toBe(false);
    });
    it('black pepper stays dose-anchored', () => {
        expect(isDoseAnchoredBareQuery('black pepper')).toBe(true);
    });
});

describe('pepper lexicon: end to end through applyOffBareQueryGuard', () => {
    it('dr pepper 355 g label_serving_default is not capped', () => {
        expect(guard('dr pepper', 355, 'label_serving_default')).toBeNull();
    });
    it('dr pepper 355 g bare_label_serving is not capped', () => {
        expect(guard('dr pepper', 355, 'bare_label_serving')).toBeNull();
    });
    it('diet dr pepper 473 g label_serving_default is not capped', () => {
        expect(guard('diet dr pepper', 473, 'label_serving_default')).toBeNull();
    });
    it('anaheim pepper 119 g label_serving_default is not capped', () => {
        expect(guard('anaheim pepper', 119, 'label_serving_default')).toBeNull();
    });
    it('bell pepper 236 g label_serving_default is not capped (regression)', () => {
        expect(guard('bell pepper', 236, 'label_serving_default')).toBeNull();
    });

    it('black pepper 100 g label_serving_default is still capped to 2.5 g', () => {
        expect(guard('black pepper', 100, 'label_serving_default')?.grams).toBe(2.5);
    });
    it('black pepper 100 g bare_label_serving is still capped (head-gated)', () => {
        expect(guard('black pepper', 100, 'bare_label_serving')?.grams).toBe(2.5);
    });
    it('cayenne pepper 50 g is still capped to 2.5 g', () => {
        expect(guard('cayenne pepper', 50, 'label_serving_default')?.grams).toBe(2.5);
    });
    it('pepper flakes 30 g is still capped to 2.5 g', () => {
        expect(guard('pepper flakes', 30, 'label_serving_default')?.grams).toBe(2.5);
    });

    it('RESIDUAL: anaheim pepper on a REPLACE tier re-caps via the record name "Pepper"', () => {
        expect(guard('anaheim pepper', 100, 'flat_100g_default', 'Pepper')?.grams).toBe(2.5);
    });
});
