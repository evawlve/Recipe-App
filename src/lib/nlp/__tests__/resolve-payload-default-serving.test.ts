/**
 * resolveFoodDetails — the unmatched default comes from the record's own label
 * pointer, not from row order.
 *
 * The defect (Lane B S28 handoff, 2026-08-30): a barcode lookup passes no
 * `matchedServingDescription`, so `isDefault` fell to `servingOptions[0]` —
 * whatever row Prisma returned first. The Orgain Diego scanned (fs_74394899)
 * led with its `100 g` panel row while `FatSecretFood.defaultServingId` named
 * `1 scoop` / 21 g and never reached the response. The fixtures below are that
 * record's shape verbatim (read off the box 2026-08-30).
 */

const mockFsFindUnique = jest.fn();
const mockOffFindUnique = jest.fn();
const mockAiFindUnique = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        fatSecretFood: {
            findUnique: (...args: unknown[]) => mockFsFindUnique(...args),
        },
        offFood: {
            findUnique: (...args: unknown[]) => mockOffFindUnique(...args),
        },
        aiGeneratedFood: {
            findUnique: (...args: unknown[]) => mockAiFindUnique(...args),
        },
    },
}));

import { resolveFoodDetails } from '../resolve-payload';

/** fs_74394899 "Collagen Peptides + Probiotics" [Orgain], shape verbatim:
 *  the 100 g panel row sorts FIRST, the declared default second. */
const ORGAIN = {
    fsId: '74394899',
    name: 'Collagen Peptides + Probiotics',
    brandName: 'Orgain',
    nutrientsPer100g: { calories: 357, protein: 85.7, carbs: 0, fat: 0 },
    defaultServingId: '60513016',
    fetchedAt: new Date(),
    servings: [
        { servingId: '0', description: '100 g', measurementDescription: 'g', grams: 100, volumeMl: null, numberOfUnits: 100, nutrients: {} },
        { servingId: '60513016', description: '1 scoop', measurementDescription: 'scoop', grams: 21, volumeMl: null, numberOfUnits: 1, nutrients: {} },
    ],
};

describe('resolveFoodDetails — unmatched default takes the FS defaultServingId row', () => {
    beforeEach(() => {
        mockFsFindUnique.mockReset();
        mockOffFindUnique.mockReset();
        mockAiFindUnique.mockReset();
    });

    it('the unmatched-barcode path: default is the label serving, not options[0]', async () => {
        mockFsFindUnique.mockResolvedValue(ORGAIN);

        // No matchedServingDescription — exactly the /api/foods/barcode call shape.
        const details = await resolveFoodDetails('fs_74394899');

        const scoop = details.servingOptions.find(o => o.label === '1 scoop');
        const panel = details.servingOptions.find(o => o.label === '100 g');
        expect(scoop).toBeDefined();
        expect(scoop!.isDefault).toBe(true);
        expect(scoop!.grams).toBe(21);
        expect(panel!.isDefault).toBe(false);
        // Exactly one default, ever.
        expect(details.servingOptions.filter(o => o.isDefault)).toHaveLength(1);
    });

    it('a MATCHED description still outranks the label pointer', async () => {
        mockFsFindUnique.mockResolvedValue(ORGAIN);

        const details = await resolveFoodDetails('fs_74394899', '100 g');

        expect(details.servingOptions.find(o => o.label === '100 g')!.isDefault).toBe(true);
        expect(details.servingOptions.find(o => o.label === '1 scoop')!.isDefault).toBe(false);
    });

    it('no defaultServingId: the options[0] fallback is unchanged', async () => {
        mockFsFindUnique.mockResolvedValue({ ...ORGAIN, defaultServingId: null });

        const details = await resolveFoodDetails('fs_74394899');

        expect(details.servingOptions[0].isDefault).toBe(true);
    });

    it('a stale defaultServingId that names no row falls back to options[0]', async () => {
        mockFsFindUnique.mockResolvedValue({ ...ORGAIN, defaultServingId: 'gone-404' });

        const details = await resolveFoodDetails('fs_74394899');

        expect(details.servingOptions[0].isDefault).toBe(true);
        expect(details.servingOptions.filter(o => o.isDefault)).toHaveLength(1);
    });

    it('a record with NO usable label serving still answers: the macro-only class keeps its fabricated default', async () => {
        // The Whopper Jr. shape: empty panel, one gram-less serving, and a
        // defaultServingId pointing AT that gram-less row. The grams filter
        // refuses it, so the fabricated metric set keeps options[0] = 100 g.
        mockFsFindUnique.mockResolvedValue({
            fsId: '68444899',
            name: 'Whopper Jr.',
            brandName: 'Burger King',
            nutrientsPer100g: {},
            defaultServingId: '56035832',
            fetchedAt: new Date(),
            servings: [{
                servingId: '56035832',
                description: '1 serving',
                measurementDescription: null,
                grams: null,
                volumeMl: null,
                numberOfUnits: 1,
                nutrients: { calories: 340, protein: 15, carbohydrate: 30, fat: 18 },
            }],
        });

        const details = await resolveFoodDetails('fs_68444899');

        expect(details.servingOptions.length).toBeGreaterThan(0);
        expect(details.servingOptions[0].isDefault).toBe(true);
        expect(details.servingOptions[0].label).toBe('100 g');
        expect(details.servingOptions.filter(o => o.isDefault)).toHaveLength(1);
    });
});

describe('resolveFoodDetails — the OFF label pointer (servingGrams) marks the default', () => {
    beforeEach(() => {
        mockFsFindUnique.mockReset();
        mockOffFindUnique.mockReset();
        mockAiFindUnique.mockReset();
    });

    const OFF_BASE = {
        barcode: '0000000000017',
        name: 'Sea Salt Pretzel Thins',
        brandName: 'Snack Factory',
        nutrientsPer100g: { calories: 393, protein: 10.7, carbs: 82.1, fat: 3.6 },
        servingSize: '11 pretzels (28g)',
        servingGrams: 28,
        servings: [
            { description: '100 g', grams: 100 },
            { description: '11 pretzels (28g)', grams: 28 },
        ],
    };

    it('unmatched: the row agreeing with servingGrams is the default', async () => {
        mockOffFindUnique.mockResolvedValue(OFF_BASE);

        const details = await resolveFoodDetails('off_0000000000017');

        const label = details.servingOptions.find(o => o.label === '11 pretzels (28g)');
        expect(label!.isDefault).toBe(true);
        expect(details.servingOptions.find(o => o.label === '100 g')!.isDefault).toBe(false);
    });

    it('the appended servingSize row can be the default when no stored row matches', async () => {
        mockOffFindUnique.mockResolvedValue({
            ...OFF_BASE,
            servingSize: '1 portion (15ml)',
            servingGrams: 15,
            servings: [{ description: '1 pretzel', grams: 5 }],
        });

        const details = await resolveFoodDetails('off_0000000000017');

        // The appended unit is grams-identical to servingGrams by construction.
        expect(details.servingOptions.find(o => o.label === '1 portion (15ml)')!.isDefault).toBe(true);
    });

    it('no servingGrams: the options[0] fallback is unchanged', async () => {
        mockOffFindUnique.mockResolvedValue({
            ...OFF_BASE,
            servingSize: null,
            servingGrams: null,
        });

        const details = await resolveFoodDetails('off_0000000000017');

        expect(details.servingOptions[0].isDefault).toBe(true);
        expect(details.servingOptions.filter(o => o.isDefault)).toHaveLength(1);
    });
});
