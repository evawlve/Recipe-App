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
const mockFatSecretServingFindFirst = jest.fn();

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
        fatSecretServing: {
            findFirst: (...args: unknown[]) => mockFatSecretServingFindFirst(...args),
        },
    },
}));

import { saveValidatedMapping, getValidatedMappingByNormalizedName } from '../validated-mapping-helpers';
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
    mockFatSecretServingFindFirst.mockResolvedValue(null);
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

    it('bypasses the guard when the incumbent record is corrupt-marked', async () => {
        // Zombie-row fix (mark-corrupt PR): live-verified on "beans" — the
        // marked record 8681820101348 had serving shape, the clean re-pick
        // didn't, and the guard kept re-protecting the corrupt row forever.
        setupExistingRow(
            { servingGrams: 250, packageQuantity: null, corruptReason: 'panel-inflated:direct' } as any,
            { servingGrams: null, packageQuantity: null },
        );
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: `off_${NEW_BARCODE}`, foodName: 'Red Bull Energy Drink' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });

    it('keeps the guard when corrupt exclusion is kill-switched off', async () => {
        process.env.CORRUPT_RECORD_EXCLUSION = '0';
        try {
            setupExistingRow(
                { servingGrams: 250, packageQuantity: null, corruptReason: 'panel-inflated:direct' } as any,
                { servingGrams: null, packageQuantity: null },
            );
            await saveValidatedMapping(
                'red bull',
                makeMapping({ foodId: `off_${NEW_BARCODE}`, foodName: 'Red Bull Energy Drink' }),
                validation,
            );
            expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        } finally {
            delete process.env.CORRUPT_RECORD_EXCLUSION;
        }
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

describe('fatsecret lane fs_ branch (Phase 1)', () => {
    it('derives fsId + mappingSource fatsecret and nulls the other id columns', async () => {
        await saveValidatedMapping(
            'protein bar',
            makeMapping({ foodId: 'fs_12345', foodName: 'Protein Bar' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
        const args = mockFoodMappingUpsert.mock.calls[0][0];
        expect(args.create.fsId).toBe('12345');
        expect(args.create.offBarcode).toBeNull();
        expect(args.create.fdcId).toBeNull();
        expect(args.create.source).toBe('fatsecret');
        expect(args.update.fsId).toBe('12345');
        expect(args.update.offBarcode).toBeNull();
        expect(args.update.fdcId).toBeNull();
        expect(args.update.source).toBe('fatsecret');
    });

    it('downgrade guard: an fs pick without gram servings must not evict a serving-labeled OFF row', async () => {
        mockFoodMappingFindUnique.mockResolvedValue({ offBarcode: '9002490100070' });
        mockOffFoodFindUnique.mockResolvedValue({ servingGrams: 250, packageQuantity: null, corruptReason: null });
        mockFatSecretServingFindFirst.mockResolvedValue(null); // fs record has no gram serving
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: 'fs_444', foodName: 'Red Bull Energy Drink' }),
            validation,
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
    });

    it('downgrade guard: an fs pick WITH a gram serving may replace the OFF row', async () => {
        mockFoodMappingFindUnique.mockResolvedValue({ offBarcode: '9002490100070' });
        mockOffFoodFindUnique.mockResolvedValue({ servingGrams: 250, packageQuantity: null, corruptReason: null });
        mockFatSecretServingFindFirst.mockResolvedValue({ id: 'sv1' });
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: 'fs_444', foodName: 'Red Bull Energy Drink' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
        expect(mockFoodMappingUpsert.mock.calls[0][0].create.fsId).toBe('444');
    });

    it('downgrade guard: an fs incumbent with serving shape is protected from a shapeless OFF pick', async () => {
        mockFoodMappingFindUnique.mockResolvedValue({ offBarcode: null, fsId: '999' });
        mockFatSecretServingFindFirst.mockResolvedValue({ id: 'sv1' }); // incumbent HAS shape
        mockOffFoodFindUnique.mockResolvedValue({ servingGrams: null, packageQuantity: null }); // new pick has none
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: 'off_5099839628986', foodName: 'Red Bull Energy Drink' }),
            validation,
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
    });

    it('human-row write-guard matches fs identity (same fs record bumps usage only)', async () => {
        mockFoodMappingFindUnique.mockResolvedValue({
            offBarcode: null,
            fdcId: null,
            fsId: '777',
            foodName: 'Protein Bar',
            validatedBy: 'human-triage',
        });
        await saveValidatedMapping(
            'protein bar',
            makeMapping({ foodId: 'fs_777', foodName: 'Protein Bar' }),
            validation,
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(mockFoodMappingUpdate).toHaveBeenCalledTimes(1);
        expect(mockFoodMappingUpdate.mock.calls[0][0].data.usedCount).toEqual({ increment: 1 });
    });

    it('read path reconstructs fs_<fsId> and source fatsecret from a lane row', async () => {
        mockFoodMappingFindUnique.mockResolvedValue({
            normalizedForm: 'protein bar',
            foodName: 'Protein Bar',
            brandName: null,
            source: 'fatsecret',
            offBarcode: null,
            fdcId: null,
            fsId: '12345',
            aiConfidence: 0.92,
            validatedBy: 'ai',
        });
        const result = await getValidatedMappingByNormalizedName('protein bar', 'fatsecret');
        expect(result).not.toBeNull();
        expect(result!.foodId).toBe('fs_12345');
        expect(result!.source).toBe('fatsecret');
        expect(result!.confidence).toBeCloseTo(0.92, 5);
    });
});

describe('cross-source displacement margin (fs hardening, Jul 2026)', () => {
    const OFF_BARCODE = '9002490100070';

    function offIncumbent(aiConfidence: number, corruptReason: string | null = null) {
        mockFoodMappingFindUnique.mockResolvedValue({ offBarcode: OFF_BARCODE, aiConfidence });
        mockOffFoodFindUnique.mockResolvedValue({ servingGrams: 250, packageQuantity: null, corruptReason });
        // fs challenger carries a gram serving so the downgrade guard passes.
        mockFatSecretServingFindFirst.mockResolvedValue({ id: 'sv1' });
    }

    it('fs challenger without a real confidence margin cannot displace a good OFF incumbent', async () => {
        offIncumbent(0.93); // challenger 0.95 < 0.93 + 0.05
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: 'fs_444', foodName: 'Red Bull Energy Drink' }),
            validation,
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
    });

    it('fs challenger with a real margin may displace', async () => {
        offIncumbent(0.85); // challenger 0.95 >= 0.85 + 0.05
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: 'fs_444', foodName: 'Red Bull Energy Drink' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
        expect(mockFoodMappingUpsert.mock.calls[0][0].update.fsId).toBe('444');
    });

    it('same-family off→off swaps are exempt from the margin', async () => {
        mockFoodMappingFindUnique.mockResolvedValue({ offBarcode: OFF_BARCODE, aiConfidence: 0.99 });
        mockOffFoodFindUnique.mockResolvedValue({ servingGrams: 250, packageQuantity: null, corruptReason: null });
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: 'off_5099839628986', foodName: 'Red Bull Energy Drink' }),
            validation, // 0.95 < 0.99 + margin, but same family → supersede-stale semantics stay
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });

    it('a corrupt incumbent forfeits the margin like it forfeits the downgrade guard', async () => {
        offIncumbent(0.99, 'panel-inflated:direct');
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: 'fs_444', foodName: 'Red Bull Energy Drink' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });

    it('protects fs incumbents from OFF churn symmetrically', async () => {
        mockFoodMappingFindUnique.mockResolvedValue({ offBarcode: null, fsId: '999', aiConfidence: 0.93 });
        mockFatSecretServingFindFirst.mockResolvedValue({ id: 'sv1' }); // incumbent has shape
        mockOffFoodFindUnique.mockResolvedValue({ servingGrams: 355, packageQuantity: null }); // challenger has shape too
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: 'off_5099839628986', foodName: 'Red Bull Energy Drink' }),
            validation, // 0.95 < 0.93 + 0.05 → keep the fs row
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
    });

    it('an incumbent with no stored confidence is displaceable (legacy rows)', async () => {
        mockFoodMappingFindUnique.mockResolvedValue({ offBarcode: OFF_BARCODE, aiConfidence: null });
        mockOffFoodFindUnique.mockResolvedValue({ servingGrams: 250, packageQuantity: null, corruptReason: null });
        mockFatSecretServingFindFirst.mockResolvedValue({ id: 'sv1' });
        await saveValidatedMapping(
            'red bull',
            makeMapping({ foodId: 'fs_444', foodName: 'Red Bull Energy Drink' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
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
