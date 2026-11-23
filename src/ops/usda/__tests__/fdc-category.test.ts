import { fdcCategoryOf, buildCategoryMap } from '../fdc-category';
import { buildFdcIndexDoc } from '../../../lib/ops/fdc-index-doc';

describe('fdcCategoryOf', () => {
    it('reads the dump object shape', () => {
        expect(fdcCategoryOf({ foodCategory: { description: 'Baked Products' } })).toBe('Baked Products');
    });
    it('reads the API string shape', () => {
        expect(fdcCategoryOf({ foodCategory: 'Fruits and Fruit Juices' })).toBe('Fruits and Fruit Juices');
    });
    it('returns null for absent, empty, or malformed', () => {
        expect(fdcCategoryOf({})).toBeNull();
        expect(fdcCategoryOf(null)).toBeNull();
        expect(fdcCategoryOf({ foodCategory: '  ' })).toBeNull();
        expect(fdcCategoryOf({ foodCategory: { description: 5 } })).toBeNull();
    });
});

describe('buildCategoryMap', () => {
    it('maps a three-row fixture sorted by fdcId, skipping rows without a category', () => {
        const map = buildCategoryMap([
            { fdcId: 20, foodCategory: { description: 'B' } },
            { fdcId: 10, foodCategory: { description: 'A' } },
            { fdcId: 30 },
        ]);
        expect(Object.keys(map)).toEqual(['10', '20']);
        expect(map).toEqual({ '10': 'A', '20': 'B' });
    });
});

describe('buildFdcIndexDoc', () => {
    const base = { fdcId: 1, description: 'Onion', brandName: null, dataType: 'SR Legacy',
        nutrientsPer100g: { calories: 40 }, servings: [{ description: 'cup', grams: 160 }] };
    it('carries foodCategory', () => {
        expect(buildFdcIndexDoc({ ...base, foodCategory: 'Vegetables and Vegetable Products' }).foodCategory)
            .toBe('Vegetables and Vegetable Products');
    });
    it('omits it when null and keeps the old fields', () => {
        const d = buildFdcIndexDoc({ ...base, foodCategory: null });
        expect('foodCategory' in d).toBe(false);
        expect(d.fdcId).toBe('1');
        expect(d.dataType).toBe('SR Legacy');
    });
});
