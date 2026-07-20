/**
 * Save-time identity/serving gates on saveValidatedMapping (PR D pt2).
 *
 * - Brand-mismatch gate: a decisively-named brand query ("ryse protein")
 *   must not cache a food that carries neither the brand in its brand field
 *   nor its name ("Protein Rice").
 * - Serving-downgrade guard: an OFF→OFF barcode overwrite must not replace
 *   a record with real serving data with one that has none.
 *
 * Uses the real brand detector (lexicon includes "ryse"/"red bull") so the
 * tests exercise production matching behavior, and mocks only the db.
 */

const mockFoodMappingFindUnique = jest.fn();
const mockFoodMappingUpsert = jest.fn();
const mockOffFoodFindUnique = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        foodMapping: {
            findUnique: (...args: unknown[]) => mockFoodMappingFindUnique(...args),
            upsert: (...args: unknown[]) => mockFoodMappingUpsert(...args),
        },
        offFood: {
            findUnique: (...args: unknown[]) => mockOffFoodFindUnique(...args),
        },
    },
}));

import { saveValidatedMapping } from '../validated-mapping-helpers';
import type { FatsecretMappedIngredient } from '../map-ingredient-with-fallback';
import type { AIValidationResult } from '../ai-validation';

const validation = { confidence: 0.95 } as AIValidationResult;

function makeMapping(overrides: Partial<FatsecretMappedIngredient>): FatsecretMappedIngredient {
    return {
        foodId: 'off_1111111111111',
        foodName: 'Test Food',
        brandName: undefined,
        grams: 100,
        kcal: 100,
        protein: 5,
        carbs: 10,
        fat: 3,
        ...overrides,
    } as FatsecretMappedIngredient;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockFoodMappingFindUnique.mockResolvedValue(null);
    mockFoodMappingUpsert.mockResolvedValue({});
    mockOffFoodFindUnique.mockResolvedValue(null);
});

describe('brand-mismatch save gate', () => {
    it('rejects "ryse protein" mapped to "Protein Rice" (no brand carried)', async () => {
        await saveValidatedMapping(
            'ryse protein',
            makeMapping({ foodName: 'Protein Rice' }),
            validation,
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
    });

    it('saves when the mapped food carries the brand in its brand field', async () => {
        await saveValidatedMapping(
            'ryse protein',
            makeMapping({ foodName: 'Loaded Protein Powder', brandName: 'RYSE' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });

    it('saves when the mapped food embeds the brand token in its name', async () => {
        await saveValidatedMapping(
            'ryse protein',
            makeMapping({ foodName: 'Ryse Loaded Protein' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });

    it('does not fire without decisive brand context', async () => {
        // "ghost" is a lexicon brand, but adjacent to a non-product word the
        // reading is coincidental English — the gate must stay out of the way.
        await saveValidatedMapping(
            'ghost berry smoothie',
            makeMapping({ foodName: 'Berry Smoothie' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });
});

describe('serving-downgrade save guard', () => {
    const OLD_BARCODE = '9002490100070';
    const NEW_BARCODE = '5099839628986';

    function setupExistingRow(oldServing: { servingGrams: number | null; packageQuantity: number | null },
        newServing: { servingGrams: number | null; packageQuantity: number | null }) {
        mockFoodMappingFindUnique.mockResolvedValue({ offBarcode: OLD_BARCODE });
        mockOffFoodFindUnique.mockImplementation((args: any) =>
            Promise.resolve(args?.where?.barcode === OLD_BARCODE ? oldServing : newServing));
    }

    it('refuses to replace a serving-labeled record with a label-less one', async () => {
        setupExistingRow(
            { servingGrams: 250, packageQuantity: null },
            { servingGrams: null, packageQuantity: null },
        );
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: `off_${NEW_BARCODE}`, foodName: 'Red Bull Energy Drink' }),
            validation,
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
    });

    it('allows the swap when the new record also has serving data', async () => {
        setupExistingRow(
            { servingGrams: 250, packageQuantity: null },
            { servingGrams: 355, packageQuantity: null },
        );
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: `off_${NEW_BARCODE}`, foodName: 'Red Bull Energy Drink' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });

    it('treats package quantity as serving shape on the new record', async () => {
        setupExistingRow(
            { servingGrams: 250, packageQuantity: null },
            { servingGrams: null, packageQuantity: 473 },
        );
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: `off_${NEW_BARCODE}`, foodName: 'Red Bull Energy Drink' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });

    it('allows the swap when the old record had no serving data either', async () => {
        setupExistingRow(
            { servingGrams: null, packageQuantity: null },
            { servingGrams: null, packageQuantity: null },
        );
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: `off_${NEW_BARCODE}`, foodName: 'Red Bull Energy Drink' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });

    it('does not query serving data for a first-time save', async () => {
        mockFoodMappingFindUnique.mockResolvedValue(null);
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: `off_${NEW_BARCODE}`, foodName: 'Red Bull Energy Drink' }),
            validation,
        );
        expect(mockOffFoodFindUnique).not.toHaveBeenCalled();
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });

    it('skips the guard when the barcode is unchanged', async () => {
        mockFoodMappingFindUnique.mockResolvedValue({ offBarcode: NEW_BARCODE });
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: `off_${NEW_BARCODE}`, foodName: 'Red Bull Energy Drink' }),
            validation,
        );
        expect(mockOffFoodFindUnique).not.toHaveBeenCalled();
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });
});
