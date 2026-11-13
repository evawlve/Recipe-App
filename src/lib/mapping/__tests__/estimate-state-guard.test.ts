/**
 * dryEstimateOnCookedGrainLine() — the predicate that keeps an explicit-cooked
 * grain line from adopting a cached DRY nutrition estimate (C6970 s400,
 * 2026-10-30). The context column is computed by the REAL
 * detectGrainCookingContext() so every row is a shape the mapper can hand it;
 * the `ctx` column pins which branch that function took, so a later change to
 * it shows up here as a context mismatch, not as a silent predicate flip.
 *
 * Population (s396 gate snapshot, 13 normalize_cache entries): exactly the three
 * explicit-cooked OATS lines fire; the cooked-rice lines keep their correct
 * 130 kcal row; soft, dry and non-grain lines never fire.
 */
import { dryEstimateOnCookedGrainLine, DRY_GRAIN_PANEL_MIN_KCAL_PER_100G } from '../estimate-state-guard';
import { detectGrainCookingContext } from '../filter-candidates';

const est = (kcal: number) => ({ caloriesPer100g: kcal, proteinPer100g: 10, carbsPer100g: 50, fatPer100g: 5, confidence: 0.95 });

type Ctx = 'explicit' | 'soft' | 'dry' | 'none';
const ctxKind = (c: { preferCooked: boolean; preferDry: boolean; softCooked?: boolean }): Ctx =>
    c.softCooked ? 'soft' : c.preferCooked ? 'explicit' : c.preferDry ? 'dry' : 'none';

describe('dryEstimateOnCookedGrainLine()', () => {
    it.each<[string, string, Ctx, number, boolean]>([
        // rawLine, normalizedName (as the mapper/gate snapshot carries it), ctx, kcal, fires
        ['1 cup cooked oats', 'cooked rolled oats', 'explicit', 389, true],
        ['half a cup of cooked rolled oats', 'cooked rolled oats', 'explicit', 389, true],
        ['a cup of cooked oatmeal', 'cooked rolled oats', 'explicit', 389, true],
        ['a cup of cooked oatmeal', 'cooked oatmeal', 'explicit', 389, true],
        // the correct cooked-rice row (key `rice`, 130 kcal) is KEPT
        ['1 cup cooked rice', 'cooked rice', 'explicit', 130, false],
        ['a bowl of cooked rice', 'cooked rice', 'explicit', 130, false],
        // soft twins: the bare-volume oats class stays out of scope
        ['1 cup oats', 'rolled oats', 'soft', 389, false],
        ['a cup of oats', 'rolled oats', 'soft', 389, false],
        // dry words: `uncooked` sets preferCooked by substring; the dry-word clause stops it
        ['100 g uncooked rice', 'uncooked rice', 'explicit', 389, false],
        ['a cup of uncooked rice', 'uncooked rice', 'explicit', 389, false],
        ['a cup of dry quinoa', 'dry quinoa', 'dry', 368, false],
        ['oatmeal', 'rolled oats', 'dry', 389, false],
        // head noun is not a grain
        ['kfc extra crispy chicken', 'kfc extra crispy chicken', 'dry', 300, false],
        ['sheet pan chicken thighs', 'pan chicken thighs', 'dry', 250, false],
        // explicit-cooked grain, but weighed: outside the volume-unit rule
        ['4 oz of cooked pasta', 'cooked pasta', 'explicit', 371, false],
    ])('%s (norm %s, %s, %d kcal) -> %s', (rawLine, normalizedName, ctx, kcal, fires) => {
        const context = detectGrainCookingContext(rawLine, normalizedName);
        expect(ctxKind(context)).toBe(ctx);
        expect(dryEstimateOnCookedGrainLine(context, rawLine, normalizedName, est(kcal))).toBe(fires);
    });

    it('the kcal band is the boundary: 280 fires, 279 does not (n-cook kcal100 bands top out at 170)', () => {
        const ctx = detectGrainCookingContext('1 cup cooked oats', 'cooked rolled oats');
        expect(DRY_GRAIN_PANEL_MIN_KCAL_PER_100G).toBe(280);
        expect(dryEstimateOnCookedGrainLine(ctx, '1 cup cooked oats', 'cooked rolled oats', est(280))).toBe(true);
        expect(dryEstimateOnCookedGrainLine(ctx, '1 cup cooked oats', 'cooked rolled oats', est(279))).toBe(false);
    });

    it('no estimate -> false', () => {
        const ctx = detectGrainCookingContext('1 cup cooked oats', 'cooked rolled oats');
        expect(dryEstimateOnCookedGrainLine(ctx, '1 cup cooked oats', 'cooked rolled oats', null)).toBe(false);
        expect(dryEstimateOnCookedGrainLine(ctx, '1 cup cooked oats', 'cooked rolled oats', undefined)).toBe(false);
    });

    it('the context argument is read: a soft or ambiguous context never fires', () => {
        const line = '1 cup cooked oats';
        const norm = 'cooked rolled oats';
        expect(dryEstimateOnCookedGrainLine({ preferCooked: true, preferDry: false, softCooked: true }, line, norm, est(389))).toBe(false);
        expect(dryEstimateOnCookedGrainLine({ preferCooked: true, preferDry: true }, line, norm, est(389))).toBe(false);
        expect(dryEstimateOnCookedGrainLine({ preferCooked: false, preferDry: true }, line, norm, est(389))).toBe(false);
        expect(dryEstimateOnCookedGrainLine({ preferCooked: true, preferDry: false }, line, norm, est(389))).toBe(true);
    });

    it('an explicit-cooked context whose head noun is not a grain never fires (`steamed oat milk`, head `milk`)', () => {
        const ctx = { preferCooked: true, preferDry: false };
        expect(dryEstimateOnCookedGrainLine(ctx, 'steamed oat milk', 'steamed oat milk', est(389))).toBe(false);
        expect(dryEstimateOnCookedGrainLine(ctx, 'a cup of steamed oat milk', 'steamed oats milk', est(389))).toBe(false);
    });

    it('`dried` on the raw line stops it even where the grain rule would not', () => {
        const ctx = { preferCooked: true, preferDry: false };
        expect(dryEstimateOnCookedGrainLine(ctx, '1 cup cooked dried oats', 'cooked rolled oats', est(389))).toBe(false);
    });
});
