/**
 * buildFatSecretResult — what answers a bare request when the record's DECLARED
 * default serving is the per-100g panel row.
 *
 * `defaultServingId` resolves for 23,837 of 23,837 FatSecret foods, so the
 * `?? usableServings[0]` fallback under it fires in exactly one situation: the
 * declared default is the shared "100 g" row that `isPer100gPanelServing`
 * demotes out of `usableServings`. That is 569 foods (measured 2026-08-02, box),
 * and for every one of them the billed grams were decided by include ORDER.
 *
 * `Chicken` (fs_1623) is the case that exposed it. Its declared default is the
 * "100 g" panel row; its other servings run from a 7g thin slice to a 135g cup.
 * The positional pick returned the 85g "1 serving" row before the include was
 * ordered and the 7g slice after — 201 kcal vs 17 kcal for the same query,
 * decided by nothing. Ordering the include made that REPRODUCIBLE, which is
 * strictly worse than flaky: a wrong number that never varies stops being
 * noticed.
 *
 * The fixture below is the real fs_1623 serving list, verbatim from the box.
 */

const mockFatSecretFoodFindUnique = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        fatSecretFood: {
            findUnique: (...args: unknown[]) => mockFatSecretFoodFindUnique(...args),
        },
    },
}));

import { buildFatSecretResult } from '../build-fatsecret-result';
import type { ParsedIngredient } from '../../parse/ingredient-line';

function makeCandidate(over: Record<string, unknown> = {}) {
    return {
        id: 'fs_1623', source: 'fatsecret' as const, name: 'Chicken',
        brandName: null, score: 1, foodType: 'Generic', rawData: {}, ...over,
    } as any;
}

function serving(servingId: string, description: string, grams: number) {
    return {
        servingId, description, measurementDescription: null,
        grams, volumeMl: null, numberOfUnits: 1, nutrients: null,
    };
}

/**
 * fs_1623 as stored, ordered by `servingId` ascending — i.e. exactly what the
 * `orderBy` on the include now returns. The 7g thin slice sorts FIRST, which is
 * what the positional pick billed.
 */
function makeRow(over: Record<string, unknown> = {}) {
    return {
        fsId: '1623', name: 'Chicken', brandName: null, foodType: 'Generic',
        nutrientsPer100g: { kcal: 237, protein: 27, carbs: 0, fat: 14 },
        defaultServingId: '50303',
        fetchedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        servings: [
            serving('3942', '1 thin slice (approx 2" x 1-1/2" x 1/8")', 7),
            serving('3943', '1 oz boneless, cooked', 28.35),
            serving('3945', '1 cup cooked, diced', 135),
            serving('3947', '1 medium piece (yield after cooking, bone removed)', 62),
            serving('4191', '1 medium slice (approx 2" x 1-1/2" x 1/4")', 14),
            serving('4192', '1 thick slice (approx 2" x 1-1/2" x 3/8")', 21),
            serving('4193', '1 oz boneless (yield after cooking)', 24),
            serving('4195', '1 serving (85 g)', 85),
            serving('4196', '1 small piece (yield after cooking, bone removed)', 32),
            serving('4197', '1 large piece (yield after cooking, bone removed)', 98),
            serving('4198', '1 oz, with bone cooked (yield after bone removed)', 19),
            { ...serving('50303', '100 g', 100), numberOfUnits: 100 },
        ],
        ...over,
    };
}

function parsedLine(over: Partial<ParsedIngredient>): ParsedIngredient {
    return { qty: 1, multiplier: 1, unit: null, name: '', ...over } as ParsedIngredient;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockFatSecretFoodFindUnique.mockResolvedValue(makeRow());
});

describe('bare "chicken" — the record answers the question itself', () => {
    it('bills the record\'s own "1 serving (85 g)" row, not the 7g thin slice', async () => {
        // MUTATION: drop the EXPLICIT_ONE_SERVING_RE step from the `??` chain ->
        // this falls to usableServings[0] and bills 7g / 17kcal.
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ name: 'chicken' }), 0.9, 'chicken'
        );
        expect(r).not.toBeNull();
        expect(r!.grams).toBe(85);
        expect(r!.kcal).toBeCloseTo(201, 0);
    });

    it('specifically does NOT bill any of the sub-20g piece rows', async () => {
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ name: 'chicken' }), 0.9, 'chicken'
        );
        // 7g thin slice, 14g medium slice, 19g bone-in oz — every one of these
        // was reachable positionally.
        expect([7, 14, 19]).not.toContain(r!.grams);
    });

    it('no lexicon default exists for this query, so nothing downstream rescues it', async () => {
        // The point of the assertion: `getBareQueryDefault('chicken')` returns
        // nothing (measured 2026-08-02 — likewise beef, steak, salmon, pork,
        // turkey, rice, pasta, bread, egg, ham, sausage). The bare-query guard
        // therefore cannot correct a wrong pick here, and neither can falling
        // through: this branch is the only thing standing between a staple
        // protein and an arbitrary number.
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ name: 'chicken' }), 0.9, 'chicken'
        );
        expect(r!.servingTier).toBe('fs_default_serving');
    });
});

describe('the preference is a FALLBACK, not an override', () => {
    it('a resolvable declared default still wins over the "1 serving" row', async () => {
        // MUTATION: reorder the `??` chain to put EXPLICIT_ONE_SERVING_RE first
        // -> this bills 85g instead of the record's declared 135g cup.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({ defaultServingId: '3945' }));
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ name: 'chicken' }), 0.9, 'chicken'
        );
        expect(r!.grams).toBe(135);
    });

    it('falls back to position when the record has no "1 serving" row at all', async () => {
        // Not an endorsement of the positional pick — it is what the other 291
        // of the 569 still get, and this test exists so that population is
        // visible rather than implied.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            servings: makeRow().servings.filter(s => s.servingId !== '4195'),
        }));
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ name: 'chicken' }), 0.9, 'chicken'
        );
        expect(r!.grams).toBe(7);
    });
});

describe('the bare band still applies to the row this picks', () => {
    it('an out-of-band "1 serving" row is rejected, not billed', async () => {
        // MUTATION: apply the preference AFTER `bareServingUsable` instead of
        // before -> a 900g catering serving bills 900g on a bare query.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            servings: makeRow().servings.map(s =>
                s.servingId === '4195' ? serving('4195', '1 serving (900 g)', 900) : s),
        }));
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ name: 'chicken' }), 0.9, 'chicken'
        );
        expect(r!.grams).not.toBe(900);
        expect(r!.servingTier).not.toBe('fs_default_serving');
    });

    it('"2 servings" is a multiple and must not match the count-1 anchor', async () => {
        // MUTATION: drop the leading `1\s+` from EXPLICIT_ONE_SERVING_RE -> this
        // bills 170g, i.e. two servings for a request that asked for one.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            servings: makeRow().servings.map(s =>
                s.servingId === '4195' ? serving('4195', '2 servings (170 g)', 170) : s),
        }));
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ name: 'chicken' }), 0.9, 'chicken'
        );
        expect(r!.grams).not.toBe(170);
    });
});

describe('a non-bare request is unaffected', () => {
    it('an explicit weight still bills that weight', async () => {
        const r = await buildFatSecretResult(
            makeCandidate(),
            parsedLine({ qty: 200, unit: 'g', name: 'chicken' }),
            0.9, '200g chicken'
        );
        expect(r!.grams).toBe(200);
    });
});

/**
 * The lexicon-free trailing-token fallback yields to a declared serving.
 *
 * Golden eval `n-mq-47` drift, 2026-08-02: `trader joes chicken breast` moved
 * 112g -> 236g. `fs_4881229` has NO 236g serving — its largest is 135g. The
 * number comes from `1/2 breast, bone and skin removed`, grams 118 with
 * numberOfUnits **0.5**, so per-unit is 118 / 0.5 = 236: one whole breast,
 * derived correctly and answering the wrong question. The record states its own
 * serving on a row reading `1 serving (90 g)`.
 *
 * The fix is a priority rule, not a size ceiling. A ceiling would be a threshold
 * picked to exclude one food, and would still choose the wrong row for records
 * whose pieces are legitimately large.
 */
function makeBreastRow(over: Record<string, unknown> = {}) {
    return {
        fsId: '4881229', name: 'Skinless Chicken Breast', brandName: null, foodType: 'Generic',
        nutrientsPer100g: { kcal: 110, protein: 23, carbs: 0, fat: 2 },
        defaultServingId: '4751539',
        fetchedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        servings: [
            serving('4751536', '1 oz boneless, cooked, skinless', 28),
            serving('4751538', '1 serving (90 g)', 90),
            { ...serving('4751539', '100 g', 100), numberOfUnits: 100 },
            { ...serving('4751525', '1/2 breast, bone and skin removed', 118), numberOfUnits: 0.5 },
            serving('4751533', '1 cup cooked, diced', 135),
        ],
        ...over,
    };
}

describe('n-mq-47 — a declared serving outranks a derived whole piece', () => {
    it('bare "chicken breast" bills the record\'s 90g serving, not the derived 236g breast', async () => {
        // MUTATION: drop the `declaredOneServing` guard -> 236g, outside [80,200].
        mockFatSecretFoodFindUnique.mockResolvedValue(makeBreastRow());
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_4881229', name: 'Skinless Chicken Breast' }),
            parsedLine({ name: 'chicken breast' }), 0.9, 'chicken breast'
        );
        expect(r!.grams).toBe(90);
        expect(r!.grams).toBeGreaterThanOrEqual(80);
        expect(r!.grams).toBeLessThanOrEqual(200);
    });

    it('the 0.5-unit arithmetic itself is untouched — it is the PRIORITY that changed', async () => {
        // Same record, same row, no "1 serving" to yield to: the fallback still
        // derives one whole breast. This pins that the fix did not delete the
        // fallback or break numberOfUnits handling.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeBreastRow({
            servings: makeBreastRow().servings.filter(s => s.servingId !== '4751538'),
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_4881229', name: 'Skinless Chicken Breast' }),
            parsedLine({ name: 'chicken breast' }), 0.9, 'chicken breast'
        );
        expect(r!.grams).toBe(236);
    });

    it('a NON-bare count still uses the fallback — the rule is bare-only', async () => {
        // "2 chicken breasts" is an explicit count of pieces; the declared
        // single serving must not answer it.
        // MUTATION: drop `bareSingular ?` from declaredOneServing -> 180g.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeBreastRow());
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_4881229', name: 'Skinless Chicken Breast' }),
            parsedLine({ qty: 2, name: 'chicken breasts' }), 0.9, '2 chicken breasts'
        );
        expect(r!.grams).toBe(472);
    });

    it('the curated lexicon path is NOT affected — "1 bar" still beats a serving row', async () => {
        // MUTATION: apply the yield to the lexicon path too -> 30g, and a
        // protein bar stops billing as a bar.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeBreastRow({
            name: 'Protein Bar', defaultServingId: 'svPanel',
            servings: [
                serving('svBar', '1 bar', 60),
                serving('svServing', '1 serving (30 g)', 30),
                { ...serving('svPanel', '100 g', 100), numberOfUnits: 100 },
            ],
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_9', name: 'Protein Bar' }),
            parsedLine({ name: 'protein bar' }), 0.9, 'protein bar'
        );
        expect(r!.grams).toBe(60);
        expect(r!.servingTier).toBe('fs_label_count');
    });
});
