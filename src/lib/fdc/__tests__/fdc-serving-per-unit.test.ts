/**
 * getFdcServingWeight() returns the weight of ONE requested unit.
 *
 * An FDC portion weighs `amount` units. `Candies, HEATH BITES` (FDC 168801)
 * declares `15 pieces` = 39 g, and the whole portion came back as the weight of
 * one piece: `nine pieces of s'mores drizzilicious` billed 351 g / 2,004 kcal.
 * Owner: mobile sync-docs/reports/2026-09-28_lane-a-s61-half-a-cup-reads-its-unit.md, ROW 3.
 */

jest.mock('../../usda/fdc-api', () => ({
    fdcApi: {
        searchFoods: jest.fn(async ({ query }: { query: string }) => ({
            foods: [{ fdcId: query === 'bites' ? 168801 : 1, dataType: 'SR Legacy' }],
        })),
        getFoodDetails: jest.fn(async (fdcId: number) => (fdcId === 168801
            ? { foodPortions: [{ amount: 15, modifier: 'pieces', gramWeight: 39 }] }
            : {
                foodPortions: [
                    { amount: 1, modifier: 'cup', gramWeight: 240 },
                    { amount: 0.5, modifier: 'slice', gramWeight: 14 },
                    { modifier: 'tbsp', gramWeight: 15 },
                ],
            })),
    },
}));

import { getFdcServingWeight } from '../fdc-servings';

describe('getFdcServingWeight: per ONE unit', () => {
    it('a 15-piece portion of 39 g is 2.6 g a piece', async () => {
        const r = await getFdcServingWeight('bites', 'piece');
        expect(r?.grams).toBeCloseTo(2.6, 5);
        expect(r?.label).toBe('15 pieces');
    });

    it('an amount-1 portion is unchanged', async () => {
        expect((await getFdcServingWeight('milk', 'cup'))?.grams).toBe(240);
    });

    it('a fractional portion scales up to one unit (0.5 slice = 14 g -> 28 g)', async () => {
        expect((await getFdcServingWeight('milk', 'slice'))?.grams).toBe(28);
    });

    it('a portion with no amount is read as one unit', async () => {
        expect((await getFdcServingWeight('milk', 'tbsp'))?.grams).toBe(15);
    });
});
