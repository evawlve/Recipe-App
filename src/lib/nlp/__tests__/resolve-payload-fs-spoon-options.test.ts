/**
 * resolveFoodDetails threads the FS g↔ml pair — and ONLY the FS one — into
 * deriveServingOptions' spoon branch.
 *
 * FS `volumeMl` is genuine label data (metric_serving_unit = 'ml'); OFF's
 * ingest wrote grams ≡ ml on every ml-bearing row (median g/ml exactly 1.000
 * in all five size buckets — the census's laundering trap), so the OFF branch
 * deliberately passes no volumeMl and OFF output stays byte-identical. Owner:
 * sync-docs/reports/2026-08-30_spoon-options-from-ml-census.md (mobile repo).
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

const TBSP_ML = 14.78676478125;

describe('resolveFoodDetails — FS spoon threading', () => {
    beforeEach(() => {
        mockFsFindUnique.mockReset();
        mockOffFindUnique.mockReset();
        mockAiFindUnique.mockReset();
    });

    it('an fs_ record with a real pair gets tbsp/tsp on the wire, gated by pair coverage', async () => {
        // fs_78586982 Natural Bliss creamer verbatim: 1 serving = 15.45 g / 15 ml.
        mockFsFindUnique.mockResolvedValue({
            fsId: '78586982',
            name: 'Natural Bliss Zero Almond & Coconut Creamer',
            brandName: 'Coffee-Mate',
            nutrientsPer100g: { calories: 33, protein: 0, carbs: 6.7, fat: 0.7 },
            defaultServingId: 's1',
            fetchedAt: new Date(),
            servings: [
                { servingId: 's1', description: '1 serving', measurementDescription: null, grams: 15.45, volumeMl: 15, numberOfUnits: 1, nutrients: {} },
            ],
        });

        const details = await resolveFoodDetails('fs_78586982');

        const tbsp = details.servingOptions.find(o => o.label === '1 tbsp');
        expect(tbsp).toBeDefined();
        expect(tbsp!.grams).toBeCloseTo(TBSP_ML * (15.45 / 15), 6);
        expect(tbsp!.type).toBe('volume');
        expect(details.servingOptions.find(o => o.label === '1 tsp')).toBeDefined();
        // 15 ml covers no cup rung.
        expect(details.servingOptions.find(o => o.label === '1 cup')).toBeUndefined();
        // ROW 1 composes: the label serving stays the default beside the new rungs.
        expect(details.servingOptions.find(o => o.label === '1 serving')!.isDefault).toBe(true);
    });

    it('an fs_ record with no ml pair gets no spoons', async () => {
        mockFsFindUnique.mockResolvedValue({
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
        });

        const details = await resolveFoodDetails('fs_74394899');

        expect(details.servingOptions.find(o => o.label === '1 tbsp')).toBeUndefined();
        expect(details.servingOptions.find(o => o.label === '1 tsp')).toBeUndefined();
    });

    it('the OFF branch does NOT thread volumeMl — grams ≡ ml there is the ingest assumption, not data', async () => {
        // An OffServing row CAN carry volumeMl structurally; today 0 of 771,015
        // do, and any future one would be the assumed-1.0 shape. Pin the scope.
        mockOffFindUnique.mockResolvedValue({
            barcode: '0000000000024',
            name: 'French Vanilla Zero Sugar Creamer',
            brandName: 'Coffee mate',
            nutrientsPer100g: { calories: 40, protein: 0, carbs: 13.3, fat: 0 },
            servingSize: '1 portion (15ml)',
            servingGrams: 15,
            servings: [
                { description: '1 portion (15ml)', grams: 15, volumeMl: 15 },
            ],
        });

        const details = await resolveFoodDetails('off_0000000000024');

        expect(details.servingOptions.find(o => o.label === '1 tbsp')).toBeUndefined();
        expect(details.servingOptions.find(o => o.label === '1 tsp')).toBeUndefined();
    });
});
