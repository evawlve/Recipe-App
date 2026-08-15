/**
 * resolveFoodDetails — fs_ branch (fatsecret retrieval lane).
 *
 * Regression lock for the flag-on eval failure where fs_ ids fell into the
 * AiGeneratedFood else-branch and returned all-zero nutritionPer100g
 * (n-mq-08 protein100=0.0). Also pins the store's key convention:
 * 'sugars' (plural) and 'sodium' in grams per 100g.
 */

const mockFsFindUnique = jest.fn();
const mockAiFindUnique = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        fatSecretFood: {
            findUnique: (...args: unknown[]) => mockFsFindUnique(...args),
        },
        aiGeneratedFood: {
            findUnique: (...args: unknown[]) => mockAiFindUnique(...args),
        },
    },
}));

import { resolveFoodDetails } from '../resolve-payload';

describe('resolveFoodDetails fs_ branch', () => {
    beforeEach(() => {
        mockFsFindUnique.mockReset();
        mockAiFindUnique.mockReset();
    });

    it('hydrates per-100g nutrition + serving options from FatSecretFood', async () => {
        mockFsFindUnique.mockResolvedValue({
            fsId: '25432618',
            name: 'Chocolate Chip Protein Bar',
            brandName: 'Quest',
            nutrientsPer100g: {
                calories: 227, protein: 42.42, carbs: 19.7, fat: 3.79,
                fiber: 1.5, sugars: 1.52, sodium: 0.288,
            },
            defaultServingId: 'sv-bar',
            fetchedAt: new Date(),
            servings: [
                { servingId: 'sv-bar', description: '1 bar', measurementDescription: 'bar', grams: 66, volumeMl: null, numberOfUnits: 1, nutrients: {} },
                { servingId: 'sv-100', description: '100 g', measurementDescription: 'g', grams: 100, volumeMl: null, numberOfUnits: 100, nutrients: {} },
                { servingId: 'sv-null', description: '1 serving', measurementDescription: null, grams: null, volumeMl: null, numberOfUnits: 1, nutrients: {} },
            ],
        });

        const details = await resolveFoodDetails('fs_25432618', '1 bar');

        expect(mockFsFindUnique).toHaveBeenCalledWith(expect.objectContaining({
            where: { fsId: '25432618' },
        }));
        expect(mockAiFindUnique).not.toHaveBeenCalled();
        expect(details.source).toBe('fatsecret');
        expect(details.name).toBe('Chocolate Chip Protein Bar');
        expect(details.nutritionPer100g.kcal100).toBe(227);
        expect(details.nutritionPer100g.protein100).toBeCloseTo(42.42);
        expect(details.nutritionPer100g.sugar100).toBeCloseTo(1.52); // 'sugars' key
        expect(details.nutritionPer100g.sodium100).toBeCloseTo(0.288); // grams, not mg
        const barOption = details.servingOptions.find(o => o.label === '1 bar');
        expect(barOption).toBeDefined();
        expect(barOption!.grams).toBe(66);
        expect(barOption!.isDefault).toBe(true); // matchedServingDescription honored
        // gram-less servings must not produce 0g options
        expect(details.servingOptions.every(o => o.grams > 0)).toBe(true);
    });

    it('returns zeros without touching AiGeneratedFood when the fs row is missing', async () => {
        mockFsFindUnique.mockResolvedValue(null);
        const details = await resolveFoodDetails('fs_999');
        expect(details.nutritionPer100g.kcal100).toBe(0);
        expect(mockAiFindUnique).not.toHaveBeenCalled();
    });
});

/**
 * The macro-only recovery — fiber/sugar/sodium on FatSecret's "1 serving"
 * restaurant records.
 *
 * The row below is fs_68444899 "Whopper Jr." [Burger King] copied VERBATIM off
 * the box 2026-08-15, empty panel and all: it is the record the search lane's
 * own fix (#324) was measured on, so the expected numbers here are not invented,
 * they are what `/api/foods/search?s=burger king whopper jr&local=true` returned
 * live on build 4QuU-eUqiIryl7_X8nBli. Asserting the two lanes to the same
 * literals is the point of the fix — the defect was that they disagreed.
 */
const WHOPPER_JR = {
    fsId: '68444899',
    name: 'Whopper Jr.',
    brandName: 'Burger King',
    // Not a stand-in for "we didn't fill this in". 3,472 of 24,124 FatSecretFood
    // rows are exactly this shape (measured on the box 2026-08-15); re-derive:
    // SELECT count(*) FROM "FatSecretFood" WHERE "nutrientsPer100g"::text = '{}';
    nutrientsPer100g: {},
    defaultServingId: '56035832',
    fetchedAt: new Date(),
    servings: [{
        servingId: '56035832',
        description: '1 serving',
        measurementDescription: null,
        // NULL grams is the whole reason derivePer100gFromServings() refuses
        // this record and the panel was never computed.
        grams: null,
        volumeMl: null,
        numberOfUnits: 1,
        // DB spelling: `carbohydrate` not `carbs`, `sugar` not `sugars`, and
        // sodium in MILLIGRAMS.
        nutrients: {
            calories: 340, protein: 15, carbohydrate: 30, fat: 18,
            fiber: 2, sugar: 7, sodium: 560,
            transFat: 0, cholesterol: 35, saturatedFat: 5,
        },
    }],
};

describe('resolveFoodDetails fs_ macro-only serving recovery', () => {
    beforeEach(() => {
        mockFsFindUnique.mockReset();
        mockAiFindUnique.mockReset();
    });

    it('bills fiber/sugar/sodium off the serving when the per-100g panel is empty', async () => {
        mockFsFindUnique.mockResolvedValue(WHOPPER_JR);

        const details = await resolveFoodDetails('fs_68444899');

        // THE DEFECT: all three of these were 0 before the fix, because the
        // panel is `{}` and nothing downstream could repair a micro.
        expect(details.nutritionPer100g.fiber100).toBeCloseTo(1.18, 5);
        expect(details.nutritionPer100g.sugar100).toBeCloseTo(4.12, 5);
        expect(details.nutritionPer100g.sodium100).toBeCloseTo(0.329, 5);
    });

    it('matches the search lane field-for-field on the same record', async () => {
        mockFsFindUnique.mockResolvedValue(WHOPPER_JR);

        const details = await resolveFoodDetails('fs_68444899');

        // Observed live on /api/foods/search 2026-08-15. Any drift here means the
        // two lanes have forked again, which is the failure this fix exists to
        // prevent — not a stale fixture to re-baseline.
        expect(details.nutritionPer100g).toEqual({
            kcal100: 200,
            protein100: 8.82,
            carbs100: 17.65,
            fat100: 10.59,
            fiber100: 1.18,
            sugar100: 4.12,
            sodium100: 0.329,
        });
    });

    it('flags the recovered figures as portion-estimated', async () => {
        mockFsFindUnique.mockResolvedValue(WHOPPER_JR);
        const details = await resolveFoodDetails('fs_68444899');
        // The pair rule from recoverMacroOnlyServing's header: these per-100g
        // figures are arithmetic against an invented weight, admissible only
        // alongside a flag that says so. /api/foods/barcode is the caller that
        // needs it — /api/nlp/parse derives the same flag from the serving tier.
        expect(details.portionEstimated).toBe(true);
    });

    it('OMITS the flag rather than sending false when the panel is real', async () => {
        mockFsFindUnique.mockResolvedValue({
            fsId: '1', name: 'Honest Food', brandName: null, defaultServingId: null, fetchedAt: new Date(),
            nutrientsPer100g: { calories: 100, protein: 1, carbs: 2, fat: 3, sodium: 0.1 },
            servings: [{ servingId: 's', description: '1 oz', measurementDescription: null, grams: 28, volumeMl: null, numberOfUnits: 1, nutrients: {} }],
        });
        const details = await resolveFoodDetails('fs_1');
        // Omitted, not false — an existing caller's response stays byte-identical.
        expect('portionEstimated' in details).toBe(false);
    });

    it('converts serving sodium from mg to g, like both search-lane derivations', async () => {
        mockFsFindUnique.mockResolvedValue(WHOPPER_JR);
        const details = await resolveFoodDetails('fs_68444899');
        // 560 mg on a 170 g serving is 329 mg/100 g. The wire is grams.
        expect(details.nutritionPer100g.sodium100).toBeLessThan(1);
        expect(details.nutritionPer100g.sodium100 * 1000).toBeCloseTo(329, 5);
    });

    it('injects no serving option — the recovery touches nutrition only', async () => {
        mockFsFindUnique.mockResolvedValue(WHOPPER_JR);
        const details = await resolveFoodDetails('fs_68444899');

        // Deliberate, and the difference from the search lane, which DOES replace
        // its fabricated `100 g` with the record's own serving. Here the mapper's
        // `grams` already carries the portion and every mobile call site re-injects
        // metric options unconditionally, so changing this list is a client-visible
        // portion change rather than part of this defect. The list stays exactly
        // what deriveServingOptions() builds from an empty unit set.
        expect(details.servingOptions.some(o => o.label === '1 serving')).toBe(false);
        expect(details.servingOptions.some(o => o.grams === 170)).toBe(false);
        expect(details.servingOptions[0]).toEqual({ label: '100 g', grams: 100, type: 'weight', isDefault: true });
    });

    it('does NOT fire when the record has a weighed serving', async () => {
        // 291 rows are all-macro-zero WITH a usable weight (bottled water, Coke
        // Zero). 0/0/0/0 is a CORRECT panel for those and must survive untouched
        // — the refutation recorded in the search-lane report §3.
        mockFsFindUnique.mockResolvedValue({
            fsId: '4041569',
            name: 'Coke Zero (Can)',
            brandName: 'Coca-Cola',
            nutrientsPer100g: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugars: 0, sodium: 0.011 },
            defaultServingId: 'sv-can',
            fetchedAt: new Date(),
            servings: [{
                servingId: 'sv-can', description: '1 can', measurementDescription: 'can',
                grams: 355, volumeMl: 355, numberOfUnits: 1,
                nutrients: { calories: 0, protein: 0, carbohydrate: 0, fat: 0, sodium: 40 },
            }],
        });

        const details = await resolveFoodDetails('fs_4041569');

        // The panel's own sodium survives; the serving's 40 mg does not overwrite it.
        expect(details.nutritionPer100g.sodium100).toBeCloseTo(0.011, 5);
        expect(details.nutritionPer100g.kcal100).toBe(0);
        // The real 355 g can survived; nothing was recovered over it.
        expect(details.servingOptions.some(o => o.label === '1 can' && o.grams === 355)).toBe(true);
    });

    it('does NOT fire when the panel is populated, even with a gram-less serving', async () => {
        mockFsFindUnique.mockResolvedValue({
            fsId: '3272',
            name: 'Soy Sauce',
            brandName: null,
            nutrientsPer100g: { calories: 53, protein: 6.28, carbs: 7.61, fat: 0.04, fiber: 0.8, sugars: 1.7, sodium: 5.637 },
            defaultServingId: 'sv-x',
            fetchedAt: new Date(),
            servings: [{
                servingId: 'sv-x', description: '1 serving', measurementDescription: null,
                grams: null, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 8, protein: 1, carbohydrate: 1.22, fat: 0.01, sodium: 902 },
            }],
        });

        const details = await resolveFoodDetails('fs_3272');

        // The real panel wins. Had the recovery fired, sodium100 would be the
        // serving's 902 mg re-scaled, and the density would be wrong.
        expect(details.nutritionPer100g.sodium100).toBeCloseTo(5.637, 5);
        expect(details.nutritionPer100g.kcal100).toBe(53);
    });

    it('prefers the record default serving when several carry macros', async () => {
        // Parity with build-fatsecret-result.ts's macro-only branch, which prefers
        // defaultServingId. Prisma returns rows in no guaranteed order, so without
        // the hoist this record would recover off "1 small" instead. Affects 8 of
        // the 3,472 empty-panel rows (measured 2026-08-15).
        mockFsFindUnique.mockResolvedValue({
            fsId: '99',
            name: 'Two Size Bowl',
            brandName: 'Chain',
            nutrientsPer100g: {},
            defaultServingId: 'sv-large',
            fetchedAt: new Date(),
            servings: [
                {
                    servingId: 'sv-small', description: '1 small', measurementDescription: null,
                    grams: null, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 200, protein: 10, carbohydrate: 20, fat: 5, sodium: 100 },
                },
                {
                    servingId: 'sv-large', description: '1 large', measurementDescription: null,
                    grams: null, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 400, protein: 20, carbohydrate: 40, fat: 10, sodium: 800 },
                },
            ],
        });

        const details = await resolveFoodDetails('fs_99');

        // large: 400 kcal -> 200 g estimated -> 800 mg / 2 = 400 mg/100g = 0.4 g.
        // small would have given 100 mg on 100 g = 0.1 g.
        expect(details.nutritionPer100g.sodium100).toBeCloseTo(0.4, 5);
    });

    it('is inert when no serving carries macros at all', async () => {
        mockFsFindUnique.mockResolvedValue({
            fsId: '77',
            name: 'Empty Everything',
            brandName: null,
            nutrientsPer100g: {},
            defaultServingId: null,
            fetchedAt: new Date(),
            servings: [{
                servingId: 'sv', description: '1 serving', measurementDescription: null,
                grams: null, volumeMl: null, numberOfUnits: 1, nutrients: null,
            }],
        });

        const details = await resolveFoodDetails('fs_77');

        expect(details.nutritionPer100g.kcal100).toBe(0);
        expect(details.nutritionPer100g.sodium100).toBe(0);
        expect(details.name).toBe('Empty Everything');
    });
});
