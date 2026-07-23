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
