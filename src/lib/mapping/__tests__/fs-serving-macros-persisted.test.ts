/**
 * flattenPersistedServings — the DB-shape adapter for recoverMacroOnlyServing.
 *
 * The recovery reads the FatSecret API shape, where a serving's nutrition sits
 * on the serving object. `FatSecretServing` nests the same values in a
 * `nutrients` Json column. The adapter exists so the DB-side caller
 * (`resolveFoodDetails`) reuses ONE derivation rather than writing a second —
 * a second one is how /api/nlp/parse and /api/foods/search came to bill the same
 * record differently, which is the defect this pair of functions closes.
 *
 * What is pinned here is the ADAPTER, not the arithmetic: the arithmetic is
 * recoverMacroOnlyServing's and is asserted end-to-end in
 * src/lib/nlp/__tests__/resolve-payload-fs.test.ts against the live search-lane
 * response for fs_68444899.
 */

import { flattenPersistedServings, recoverMacroOnlyServing, servingMacros } from '../fs-serving-macros';

describe('flattenPersistedServings', () => {
    it('lifts the nested nutrients so servingMacros can read them', () => {
        const flat = flattenPersistedServings([{
            servingId: 'a', description: '1 serving', measurementDescription: null,
            nutrients: { calories: 340, protein: 15, carbohydrate: 30, fat: 18 },
        }]);
        // The whole point: servingMacros returns null on the nested shape.
        expect(servingMacros({ nutrients: { calories: 340 } } as Record<string, unknown>)).toBeNull();
        expect(servingMacros(flat[0])).toEqual({ kcal: 340, protein: 15, carbs: 30, fat: 18 });
    });

    it('keeps the description, which the recovery needs for its label', () => {
        const flat = flattenPersistedServings([{
            servingId: 'a', description: '1 large bowl', measurementDescription: null, nutrients: { calories: 10 },
        }]);
        expect(flat[0].description).toBe('1 large bowl');
    });

    it('hoists the default serving to the front', () => {
        const flat = flattenPersistedServings([
            { servingId: 'small', description: '1 small', nutrients: { calories: 200 } },
            { servingId: 'large', description: '1 large', nutrients: { calories: 400 } },
        ], 'large');
        expect(flat.map(f => f.description)).toEqual(['1 large', '1 small']);
    });

    it('preserves input order when no default is named', () => {
        const flat = flattenPersistedServings([
            { servingId: 'a', description: 'first', nutrients: { calories: 1 } },
            { servingId: 'b', description: 'second', nutrients: { calories: 2 } },
            { servingId: 'c', description: 'third', nutrients: { calories: 3 } },
        ]);
        expect(flat.map(f => f.description)).toEqual(['first', 'second', 'third']);
    });

    it('preserves relative order of the non-default rows (stable sort)', () => {
        const flat = flattenPersistedServings([
            { servingId: 'a', description: 'first', nutrients: { calories: 1 } },
            { servingId: 'b', description: 'second', nutrients: { calories: 2 } },
            { servingId: 'd', description: 'fourth', nutrients: { calories: 4 } },
        ], 'd');
        expect(flat.map(f => f.description)).toEqual(['fourth', 'first', 'second']);
    });

    it('tolerates a null/absent nutrients column without throwing', () => {
        const flat = flattenPersistedServings([
            { servingId: 'a', description: '1 serving', nutrients: null },
            { servingId: 'b', description: '1 other' },
        ]);
        expect(flat).toHaveLength(2);
        expect(recoverMacroOnlyServing(flat)).toBeNull();
    });

    it('does not let a stray nutrients.description shadow the row description', () => {
        const flat = flattenPersistedServings([{
            servingId: 'a', description: '1 serving', measurementDescription: null,
            nutrients: { calories: 100, description: 'JUNK' },
        }]);
        expect(flat[0].description).toBe('1 serving');
        expect(recoverMacroOnlyServing(flat)?.label).toBe('1 serving');
    });

    it('round-trips a real empty-panel record end to end', () => {
        // fs_68444899 "Whopper Jr." [Burger King], copied off the box 2026-08-15.
        const recovered = recoverMacroOnlyServing(flattenPersistedServings([{
            servingId: '56035832', description: '1 serving', measurementDescription: null,
            nutrients: {
                calories: 340, protein: 15, carbohydrate: 30, fat: 18,
                fiber: 2, sugar: 7, sodium: 560,
            },
        }], '56035832'));

        expect(recovered).not.toBeNull();
        expect(recovered!.label).toBe('1 serving');
        expect(recovered!.grams).toBe(170);
        expect(recovered!.per100.kcal).toBe(200);
        expect(recovered!.per100.fiber).toBeCloseTo(1.18, 5);
        expect(recovered!.per100.sugars).toBeCloseTo(4.12, 5);
        // mg -> g, matching derivePer100gFromServings and the live search response.
        expect(recovered!.per100.sodium).toBeCloseTo(0.329, 5);
    });
});
