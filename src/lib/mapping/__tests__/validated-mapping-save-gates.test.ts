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
const mockFoodMappingUpdate = jest.fn();
const mockOffFoodFindUnique = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        foodMapping: {
            findUnique: (...args: unknown[]) => mockFoodMappingFindUnique(...args),
            upsert: (...args: unknown[]) => mockFoodMappingUpsert(...args),
            update: (...args: unknown[]) => mockFoodMappingUpdate(...args),
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
    mockFoodMappingUpdate.mockResolvedValue({});
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

describe('human-row write-guard (PR D pt3)', () => {
    const HUMAN_BARCODE = '0850037363018';
    const OTHER_BARCODE = '1234567890123';

    function humanRow(overrides: Record<string, unknown> = {}) {
        return {
            offBarcode: HUMAN_BARCODE,
            fdcId: null,
            foodName: 'Avocado Raw',
            validatedBy: 'human-triage',
            ...overrides,
        };
    }

    it('skips the write entirely when a fresh pick targets a DIFFERENT record', async () => {
        mockFoodMappingFindUnique.mockResolvedValue(humanRow());
        const { logger } = await import('../../logger');
        const warnSpy = jest.spyOn(logger, 'warn');
        await saveValidatedMapping(
            'avocado',
            makeMapping({ foodId: `off_${OTHER_BARCODE}`, foodName: 'Avocado Oil Spread' }),
            validation,
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(mockFoodMappingUpdate).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith('save.skipped_human_row', expect.objectContaining({
            normalizedForm: 'avocado',
            existingFoodId: `off_${HUMAN_BARCODE}`,
            attemptedFoodId: `off_${OTHER_BARCODE}`,
        }));
        warnSpy.mockRestore();
    });

    it('same record → bumps usage only, PRESERVES validatedBy=human-triage', async () => {
        mockFoodMappingFindUnique.mockResolvedValue(humanRow());
        await saveValidatedMapping(
            'avocado',
            makeMapping({ foodId: `off_${HUMAN_BARCODE}`, foodName: 'Avocado Raw' }),
            validation,
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(mockFoodMappingUpdate).toHaveBeenCalledTimes(1);
        const updateData = mockFoodMappingUpdate.mock.calls[0][0].data;
        expect(updateData.usedCount).toEqual({ increment: 1 });
        expect(updateData).not.toHaveProperty('validatedBy');
        expect(updateData).not.toHaveProperty('offBarcode');
        expect(updateData).not.toHaveProperty('foodName');
    });

    it('matches FDC identity the same way', async () => {
        mockFoodMappingFindUnique.mockResolvedValue(humanRow({ offBarcode: null, fdcId: 171705 }));
        await saveValidatedMapping(
            'avocado',
            makeMapping({ foodId: 'fdc_171705', foodName: 'Avocado Raw' }),
            validation,
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(mockFoodMappingUpdate).toHaveBeenCalledTimes(1);
    });

    it('guards the alias-save path too (flows through saveValidatedMapping)', async () => {
        mockFoodMappingFindUnique.mockResolvedValue(humanRow());
        await saveValidatedMapping(
            'avocados',
            makeMapping({ foodId: `off_${OTHER_BARCODE}`, foodName: 'Avocado Oil Spread' }),
            validation,
            { isAlias: true, canonicalRawIngredient: 'avocado', normalizedForm: 'avocado' },
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(mockFoodMappingUpdate).not.toHaveBeenCalled();
    });

    it("'ai' rows keep the full supersede-stale semantics (upsert stamps validatedBy:'ai')", async () => {
        mockFoodMappingFindUnique.mockResolvedValue(humanRow({ validatedBy: 'ai' }));
        // Both records carry serving shape so the downgrade guard stays out of the way.
        mockOffFoodFindUnique.mockResolvedValue({ servingGrams: 30, packageQuantity: null });
        await saveValidatedMapping(
            'avocado',
            makeMapping({ foodId: `off_${OTHER_BARCODE}`, foodName: 'Avocado Fresh' }),
            validation,
        );
        expect(mockFoodMappingUpdate).not.toHaveBeenCalled();
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
        const upsertArgs = mockFoodMappingUpsert.mock.calls[0][0];
        expect(upsertArgs.update.validatedBy).toBe('ai');
        expect(upsertArgs.update.offBarcode).toBe(OTHER_BARCODE);
    });
});

describe('save-time macro-plausibility gate interplay', () => {
    it('gate is skipped when no per-100g macros are provided (grams<=0 caller path)', async () => {
        // Callers derive nutrientsPer100g by dividing by grams and pass null
        // when grams <= 0 — the save must then proceed ungated.
        await saveValidatedMapping(
            'granulated sugar',
            makeMapping({ foodId: 'off_1111111111111', foodName: 'Granulated Sugar', grams: 0 }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });

    it('still rejects implausible macros when provided, before any row lookup', async () => {
        await saveValidatedMapping(
            'granulated sugar',
            makeMapping({ foodId: 'off_1111111111111', foodName: 'Granulated Sugar' }),
            validation,
            { nutrientsPer100g: { kcal: 16, protein: 0, carbs: 4, fat: 0 } },
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(mockFoodMappingFindUnique).not.toHaveBeenCalled();
    });
});
