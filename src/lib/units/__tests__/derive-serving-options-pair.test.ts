/**
 * deriveServingOptions branch 3b — spoon rungs by pure ratio from the food's
 * own declared g↔ml pair (Lane A session 29, tester report ANBKs2).
 *
 * The invariants each block pins:
 *   - the ratio is grams/volumeMl of ONE row of THIS food; nothing is stored
 *     or claimed as a density, and no pair means no spoons (the `category` and
 *     `fallback` density tiers keep refusing them);
 *   - larger rungs are emitted only where the pair itself covers the rung's
 *     volume (a 1 cup chip off a 6 ml measured pour would be a 40×
 *     extrapolation rendered as a tappable choice);
 *   - an explicit `known`/`calculated` density still owns the volume rungs —
 *     branch 3b is the else, never a second opinion.
 */

import { deriveServingOptions } from '../servings';

const TBSP_ML = 14.78676478125;
const TSP_ML = 4.92892159375;

describe('deriveServingOptions — spoon rungs from a real g↔ml pair', () => {
    it('a 15 ml pair emits tbsp + tsp at the pair ratio, and no cups', () => {
        // Coffee-Mate Natural Bliss creamer, fs_78586982 verbatim: 15.45 g / 15 ml.
        const opts = deriveServingOptions({
            units: [{ label: '1 serving', grams: 15.45, volumeMl: 15 }],
        });

        const ratio = 15.45 / 15; // 1.03, this food's own label pair
        const tbsp = opts.find(o => o.label === '1 tbsp');
        const tsp = opts.find(o => o.label === '1 tsp');
        expect(tbsp).toBeDefined();
        expect(tbsp!.grams).toBeCloseTo(TBSP_ML * ratio, 6);
        expect(tsp!.grams).toBeCloseTo(TSP_ML * ratio, 6);
        expect(opts.find(o => o.label === '¼ cup')).toBeUndefined();
        expect(opts.find(o => o.label === '1 cup')).toBeUndefined();
    });

    it('a 100 ml pair covers ¼ cup but not 1 cup', () => {
        // The Slim-Fast / juice shape that dominates the census population.
        const opts = deriveServingOptions({
            units: [{ label: '100 ml', grams: 103, volumeMl: 100 }],
        });

        expect(opts.find(o => o.label === '¼ cup')!.grams).toBeCloseTo(60 * 1.03, 6);
        expect(opts.find(o => o.label === '1 cup')).toBeUndefined();
    });

    it('a 240 ml pair covers every rung', () => {
        const opts = deriveServingOptions({
            units: [{ label: '1 glass', grams: 252, volumeMl: 240 }],
        });

        expect(opts.find(o => o.label === '1 cup')!.grams).toBeCloseTo(252, 6);
        expect(opts.find(o => o.label === '¼ cup')!.grams).toBeCloseTo(63, 6);
    });

    it('no pair, no density: no spoons — the fallback tier still refuses', () => {
        const opts = deriveServingOptions({
            units: [{ label: '1 cake', grams: 11 }],
        });

        expect(opts.map(o => o.label)).toEqual(['1 cake', '100 g', '1 oz', '4 oz']);
    });

    it('volumeMl must be a positive measurement — 0 and null are not pairs', () => {
        const opts = deriveServingOptions({
            units: [
                { label: '1 bar', grams: 66, volumeMl: 0 },
                { label: '1 box', grams: 200, volumeMl: null },
            ],
        });

        expect(opts.find(o => o.label === '1 tbsp')).toBeUndefined();
    });

    it('an explicit known density owns the volume rungs; the pair is not a second opinion', () => {
        // densityGml 1.0 vs a pair ratio of 1.333 — the known density must win.
        const opts = deriveServingOptions({
            units: [{ label: '1 shot', grams: 20, volumeMl: 15 }],
            densityGml: 1.0,
        });

        expect(opts.find(o => o.label === '1 tbsp')!.grams).toBeCloseTo(TBSP_ML * 1.0, 6);
        // The known-density branch keeps its unconditional cups.
        expect(opts.find(o => o.label === '1 cup')!.grams).toBeCloseTo(240, 6);
    });

    it('the smallest-volume pair wins when several qualify', () => {
        // 15 ml at ratio 1.03 beats 240 ml at ratio 1.05 — least extrapolation,
        // deterministic under Prisma's unordered include.
        const opts = deriveServingOptions({
            units: [
                { label: '1 glass', grams: 252, volumeMl: 240 },
                { label: '1 serving', grams: 15.45, volumeMl: 15 },
            ],
        });

        expect(opts.find(o => o.label === '1 tbsp')!.grams).toBeCloseTo(TBSP_ML * (15.45 / 15), 6);
        // Cup coverage is judged by the SAME chosen pair: 15 ml covers no cup.
        expect(opts.find(o => o.label === '1 cup')).toBeUndefined();
    });

    it("a spoon row the food itself declares wins the label — dedupe keeps the food's own grams", () => {
        const opts = deriveServingOptions({
            units: [{ label: '1 tbsp', grams: 16, volumeMl: 15 }],
        });

        const tbsp = opts.filter(o => o.label === '1 tbsp');
        expect(tbsp).toHaveLength(1);
        expect(tbsp[0].grams).toBe(16);
        // The derived tsp still appears — the food declared no tsp of its own.
        expect(opts.find(o => o.label === '1 tsp')!.grams).toBeCloseTo(TSP_ML * (16 / 15), 6);
    });
});
