/**
 * canonicalBase / cookingModifier persistence (observability columns).
 *
 * canonicalBase is a grouping/dedup column and NEVER the lookup key. Key rules under test:
 *  - brand is preserved so two different branded products (Tropicana vs Simply orange
 *    juice) get DISTINCT canonicalBase values and stay separate cache identities;
 *  - saveValidatedMapping writes canonicalBase + cookingModifier without changing the
 *    normalizedForm @id (the base "eggs" and the key "egg" coexist).
 */

const mockFoodMappingFindUnique = jest.fn();
const mockFoodMappingUpsert = jest.fn();
const mockFoodMappingUpdate = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        foodMapping: {
            findUnique: (...args: unknown[]) => mockFoodMappingFindUnique(...args),
            upsert: (...args: unknown[]) => mockFoodMappingUpsert(...args),
            update: (...args: unknown[]) => mockFoodMappingUpdate(...args),
        },
    },
}));

import { brandSafeCanonicalBase, saveValidatedMapping } from '../validated-mapping-helpers';
import type { FatsecretMappedIngredient } from '../map-ingredient-with-fallback';

describe('brandSafeCanonicalBase', () => {
    it('keeps distinct brands distinct (Tropicana vs Simply orange juice)', () => {
        const a = brandSafeCanonicalBase('orange juice', 'Tropicana');
        const b = brandSafeCanonicalBase('orange juice', 'Simply');
        expect(a).toBe('tropicana orange juice');
        expect(b).toBe('simply orange juice');
        expect(a).not.toBe(b);
    });

    it('does not double-prepend a brand already present in the base', () => {
        expect(brandSafeCanonicalBase('tropicana orange juice', 'Tropicana')).toBe('tropicana orange juice');
        expect(brandSafeCanonicalBase('Tropicana Orange Juice', 'tropicana')).toBe('tropicana orange juice');
    });

    it('leaves a generic base unchanged when there is no brand', () => {
        expect(brandSafeCanonicalBase('strawberries', null)).toBe('strawberries');
        expect(brandSafeCanonicalBase('eggs', undefined)).toBe('eggs');
    });

    it('returns null when there is no base to persist', () => {
        expect(brandSafeCanonicalBase(null, 'Tropicana')).toBeNull();
        expect(brandSafeCanonicalBase('', 'Tropicana')).toBeNull();
        expect(brandSafeCanonicalBase(undefined, undefined)).toBeNull();
    });
});

describe('saveValidatedMapping persists base/modifier without changing the key', () => {
    beforeEach(() => {
        mockFoodMappingFindUnique.mockReset();
        mockFoodMappingUpsert.mockReset();
        mockFoodMappingUpdate.mockReset();
        mockFoodMappingFindUnique.mockResolvedValue(null); // new row
        mockFoodMappingUpsert.mockResolvedValue(undefined);
    });

    it('writes canonicalBase="eggs" + cookingModifier="scrambled" while key stays "egg"', async () => {
        const mapping = {
            source: 'fdc', foodId: 'fdc_1', foodName: 'Scrambled Eggs', brandName: null,
            grams: 100, kcal: 150, protein: 10, carbs: 1, fat: 11, confidence: 0.95,
            quality: 'high', rawLine: '2 scrambled eggs',
        } as unknown as FatsecretMappedIngredient;

        await saveValidatedMapping('2 scrambled eggs', mapping,
            { approved: true, confidence: 0.95, reason: 'test' },
            { canonicalBase: 'eggs', persistCanonicalBase: 'eggs', persistCookingModifier: 'scrambled' });

        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
        const call = mockFoodMappingUpsert.mock.calls[0][0];
        // key is the canonicalized (singularized) "egg" — NOT the base "eggs"
        expect(call.where.normalizedForm).toBe('egg');
        expect(call.create.normalizedForm).toBe('egg');
        // observability columns carry the un-singularized base + cooking method
        expect(call.create.canonicalBase).toBe('eggs');
        expect(call.create.cookingModifier).toBe('scrambled');
    });
});
