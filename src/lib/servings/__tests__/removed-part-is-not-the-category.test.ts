/**
 * removed-part-is-not-the-category.test.ts (s458 PS) — a part the line REMOVES is never the category the bare-serving lexicon reads.
 *
 * DEFECT (s458 hc battery A29, measured on the live build 98T2T2gSRnq-9HiffElOW): `whoppr no mayo` served the right Whopper record
 * (fs_68444864, label 270 g) at 14 g / 35 kcal, servingTier bare_category_default — getBareQueryDefault() read `mayo` (1 tbsp) out of
 * the removal clause and applyOffBareQueryGuard()'s CAP fired. The removal grammar is parseRemovalClause() (removal-clause.ts), read
 * through categoryQueryName(); the token-count rule capMayOverrideLabelServing() keeps reading the RAW name (PUNCH #115).
 * RED on the pre-fix tree: the first five cases (and the categoryQueryName block, which does not exist there).
 */
import { applyOffBareQueryGuard, categoryQueryName } from '../bare-query-guard';
import type { ParsedIngredient } from '../../parse/ingredient-line';

const bare = (name: string): ParsedIngredient =>
    ({ qty: 1, unit: null, multiplier: 1, name } as unknown as ParsedIngredient);

function guard(line: string, grams: number, servingTier: string, foodName = 'Whopper') {
    return applyOffBareQueryGuard({ grams, servingTier, parsed: bare(line), rawLine: line, queryName: line, foodName, servingDescription: '1 serving' });
}

describe('the removed part is not the category', () => {
    it.each([
        ['whoppr no mayo', 270, 'label_serving_default'],          // A29: was 14 g bare_category_default
        ['whopper without mayo', 270, 'label_serving_default'],    // was 14
        ['salad no dressing', 270, 'label_serving_default'],       // was 14
        ['burger king whopper no cheese', 100, 'flat_100g_default'], // REPLACE path: was 28 (cheese)
    ])('%p keeps its grams (no lexicon override)', (line, grams, tier) => {
        expect(guard(line, grams, tier)).toBeNull();
    });

    it("the HEAD's own category still answers: `oatmeal without the brown sugar` flat 100 g -> 40 g oatmeal, not 4 g sugar", () => {
        expect(guard('oatmeal without the brown sugar', 100, 'flat_100g_default', 'Oatmeal')?.grams).toBe(40);
    });
});

describe('controls: lines with no removal clause bill exactly as before', () => {
    it.each([
        ['mayo', 400, 'label_serving_default', 14],
        ['olive oil', 250, 'label_serving_default', 14],
        ['bbq sauce no sugar', 100, 'flat_100g_default', 14],        // `no sugar` is an ABSENCE claim, not a removal (parseRemovalClause noop)
        ['cheeseburger no cheese', 100, 'flat_100g_default', 28],    // F6c: the head names the part, so no removal is parsed
    ])('%p -> %p g', (line, grams, tier, want) => {
        expect(guard(line, grams, tier as string, 'X')?.grams).toBe(want);
    });

    it('the token-count rule reads the RAW line: `caesar dressing no anchovies` keeps its 30 g declared label (4 raw tokens, head has 2)', () => {
        expect(guard('caesar dressing no anchovies', 30, 'label_serving_default', 'X')).toBeNull();
    });

    it('PUNCH #115 pin holds: `sugar free bbq sauce` keeps its 36 g declared label (4 raw tokens)', () => {
        expect(guard('sugar free bbq sauce', 36, 'label_serving_default', 'X')).toBeNull();
    });
});

describe('categoryQueryName()', () => {
    it.each([
        ['whoppr no mayo', 'whoppr no mayo', 'whoppr'],
        ['a turkey sub without mayo', 'a turkey sub without mayo', 'a turkey sub'],
        ['egg mcmuffin no egg', 'egg mcmuffin no egg', 'egg mcmuffin no egg'],   // F6c: the head names the part -> noop
        ['no sugar added applesauce', 'no sugar added applesauce', 'no sugar added applesauce'],
        ['whopper no mayo', 'whopper', 'whopper no mayo'],                // F6b: the raw line must carry the clause
    ])('(%p, raw %p) -> %p', (name, raw, want) => {
        expect(categoryQueryName(name, raw)).toBe(want);
    });
});
