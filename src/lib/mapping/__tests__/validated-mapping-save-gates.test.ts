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

import { saveValidatedMapping, getValidatedMappingByNormalizedName, targetKeyOf } from '../validated-mapping-helpers';
import type { FatsecretMappedIngredient } from '../map-ingredient-with-fallback';
import type { AIValidationResult } from '../ai-validation';
import type { FunnelSink } from '../funnel';

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

// Funnel fix 4. A pick admitted BELOW the 0.85 confidence gate may create a
// cache row but must never overwrite one. This is the entire blast-radius bound
// on conditional admission — and the guarantee PR #143 lacked when it repointed
// the eight most-used generic keys in the cache and broke five golden cases.
describe('insert-only guard for sub-threshold admissions', () => {
    it('seeds a key that has no row', async () => {
        mockFoodMappingFindUnique.mockResolvedValue(null);
        await saveValidatedMapping(
            'ground turkey',
            makeMapping({ foodName: '85% lean ground turkey' }),
            { confidence: 0.83 } as AIValidationResult,
            { insertOnly: true, nutrientsPer100g: { kcal: 213, protein: 17, carbs: 0, fat: 15 } },
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });

    it('refuses to overwrite an existing row, whatever its confidence', async () => {
        mockFoodMappingFindUnique.mockResolvedValue({
            offBarcode: '1111111111111', fdcId: null, fsId: null,
            foodName: 'Ground Turkey', aiConfidence: 0.98, validatedBy: 'ai',
        });
        const telemetry: FunnelSink = { funnelStage: 'saved' };
        await saveValidatedMapping(
            'ground turkey',
            makeMapping({ foodName: '85% lean ground turkey' }),
            { confidence: 0.83 } as AIValidationResult,
            { insertOnly: true, telemetry, nutrientsPer100g: { kcal: 213, protein: 17, carbs: 0, fat: 15 } },
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(telemetry.dropReason).toBe('save_rejected:sub_threshold_no_displace');
    });

    it('refuses even when the incumbent is LESS confident — 0.83 does not get to evict', async () => {
        // The guard is unconditional on purpose. Comparing confidences is what
        // the cross-source margin does, and it is exactly the kind of judgement
        // that went wrong in PR #143; a sub-threshold pick simply never displaces.
        mockFoodMappingFindUnique.mockResolvedValue({
            offBarcode: '1111111111111', fdcId: null, fsId: null,
            foodName: 'Ground Turkey', aiConfidence: 0.60, validatedBy: 'ai',
        });
        await saveValidatedMapping(
            'ground turkey',
            makeMapping({ foodName: '85% lean ground turkey' }),
            { confidence: 0.83 } as AIValidationResult,
            { insertOnly: true, nutrientsPer100g: { kcal: 213, protein: 17, carbs: 0, fat: 15 } },
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
    });

    it('leaves ordinary above-threshold saves free to supersede', async () => {
        mockFoodMappingFindUnique.mockResolvedValue({
            offBarcode: '1111111111111', fdcId: null, fsId: null,
            foodName: 'Ground Turkey', aiConfidence: 0.90, validatedBy: 'ai',
        });
        await saveValidatedMapping(
            'ground turkey',
            makeMapping({ foodId: 'off_1111111111111', foodName: '85% lean ground turkey' }),
            validation,
            { nutrientsPer100g: { kcal: 213, protein: 17, carbs: 0, fat: 15 } },
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });
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

    it('FIX 1: rejects "alani nu pre workout" mapped to a generic "Pre-Workout" (supplement brand now in lexicon)', async () => {
        // "alani nu" is a multi-word supplement brand; the longest-first n-gram
        // scan matches the whole phrase so the context is decisive, and the
        // generic "Pre-Workout" pick carries the brand in neither field.
        await saveValidatedMapping(
            'alani nu pre workout arctic white',
            makeMapping({ foodName: 'Pre-Workout' }),
            validation,
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
    });

    it('FIX 1: saves when the alani nu pick carries the brand', async () => {
        await saveValidatedMapping(
            'alani nu pre workout arctic white',
            makeMapping({ foodName: 'Pre-Workout Arctic White', brandName: 'Alani Nu' }),
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

    // Was 'guards the alias-save path too'. There is no alias-save path any
    // more (the Step 6 loop was deleted, campaign gate G1/F1); what this
    // actually locks is that the guard keys off the RESOLVED normalizedForm,
    // not the rawIngredient — a caller supplying its own key still hits it.
    it('guards a save that supplies its own normalizedForm', async () => {
        mockFoodMappingFindUnique.mockResolvedValue(humanRow());
        await saveValidatedMapping(
            'avocados',
            makeMapping({ foodId: `off_${OTHER_BARCODE}`, foodName: 'Avocado Oil Spread' }),
            validation,
            { normalizedForm: 'avocado' },
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

// Degenerate-nutrition gate (funnel first read, Jul 2026). FoodMapping stores
// identity only, so caching a pick that hydrates to nothing pins the key to a
// 0 kcal record for every later request.
describe('zero-macro save gate', () => {
    it('rejects a pick whose per-100g macros are all zero', async () => {
        await saveValidatedMapping(
            'glazed munchkins',
            makeMapping({ foodId: 'fs_68758329', foodName: 'Glazed Munchkins' }),
            validation,
            { nutrientsPer100g: { kcal: 0, protein: 0, carbs: 0, fat: 0 } },
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(mockFoodMappingFindUnique).not.toHaveBeenCalled(); // pre-DB, like the other macro gates
    });

    it('tags the rejection as save_rejected:zero_macros', async () => {
        const telemetry: FunnelSink = { funnelStage: 'saved' };
        await saveValidatedMapping(
            'moussaka',
            makeMapping({ foodId: 'fs_1', foodName: 'Moussaka' }),
            validation,
            { nutrientsPer100g: { kcal: 0, protein: 0, carbs: 0, fat: 0 }, telemetry },
        );
        expect(telemetry.funnelStage).toBe('save_rejected');
        expect(telemetry.dropReason).toBe('save_rejected:zero_macros');
    });

    it('treats absent macros the same as zero ones', async () => {
        await saveValidatedMapping(
            'gyro',
            makeMapping({ foodId: 'fs_2697224', foodName: 'Gyro' }),
            validation,
            { nutrientsPer100g: {} },
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
    });

    it('lets a single non-zero macro through — only ALL-zero is degenerate', async () => {
        // Zero-calorie foods that still carry a macro reading are real data.
        // (Deliberately not a produce name: the plausibility gate's own
        // produce floor would reject 0 kcal there for a different reason.)
        await saveValidatedMapping(
            'test food',
            makeMapping({ foodId: 'off_1111111111111', foodName: 'Test Food' }),
            validation,
            { nutrientsPer100g: { kcal: 0, protein: 0, carbs: 3, fat: 0 } },
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });

    it('does not fire when the caller supplies no macros at all (grams<=0 path stays ungated)', async () => {
        await saveValidatedMapping(
            'diet coke',
            makeMapping({ foodId: 'off_1111111111111', foodName: 'Diet Coke', grams: 0 }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });
});

describe('FIX 3: bare-category takeover save gate', () => {
    it('rejects "special k red berries" collapsing into a bare "Cereal"', async () => {
        await saveValidatedMapping(
            'special k red berries',
            makeMapping({ foodName: 'Cereal' }),
            validation,
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
    });

    it('rejects "wendys jr bacon cheeseburger" collapsing into a bare "Bacon Cheeseburger"', async () => {
        // "wendys" is detected but NOT decisive (no adjacent product-form word),
        // so the older brand-mismatch gate misses this — the bare-category gate
        // catches it because a brand is named and the pick is all category words.
        await saveValidatedMapping(
            'wendys jr bacon cheeseburger',
            makeMapping({ foodName: 'Bacon Cheeseburger' }),
            validation,
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
    });

    it('KEEPS "mcdonalds big mac" -> "Big Mac" (distinctive product token survives)', async () => {
        await saveValidatedMapping(
            'mcdonalds big mac',
            makeMapping({ foodName: 'Big Mac' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });

    it('KEEPS a bare-category pick when the pick carries the brand', async () => {
        await saveValidatedMapping(
            'special k red berries',
            makeMapping({ foodName: 'Red Berries Cereal', brandName: 'Special K' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });

    it('does not fire for a generic query resolving to its own generic category', async () => {
        // No brand named, and the food name keeps distinctive ingredient tokens
        // ("chicken", "noodle") that are not bare-category words -> saved.
        await saveValidatedMapping(
            'chicken noodle soup',
            makeMapping({ foodName: 'Chicken Noodle Soup' }),
            validation,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
    });
});

describe('funnel tagging on the save gates (sprint F1)', () => {
    it('tags a brand-mismatch rejection with its class, downgrading "saved"', async () => {
        // The caller marks the line 'saved' optimistically before the write.
        const telemetry: FunnelSink = { funnelStage: 'saved' };
        await saveValidatedMapping(
            'ryse protein',
            makeMapping({ foodName: 'Protein Rice' }),
            validation,
            { telemetry },
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(telemetry.funnelStage).toBe('save_rejected');
        expect(telemetry.dropReason).toBe('save_rejected:brand_mismatch');
    });

    it('tags a bare-category-takeover rejection with its own distinct class', async () => {
        const telemetry: FunnelSink = { funnelStage: 'saved' };
        await saveValidatedMapping(
            'special k red berries',
            makeMapping({ foodName: 'Cereal' }),
            validation,
            { telemetry },
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(telemetry.dropReason).toBe('save_rejected:bare_category_takeover');
    });

    it('leaves the line "saved" when no gate blocks the write', async () => {
        const telemetry: FunnelSink = { funnelStage: 'saved' };
        await saveValidatedMapping(
            'ryse protein',
            makeMapping({ foodName: 'Loaded Protein Powder', brandName: 'RYSE' }),
            validation,
            { telemetry },
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
        expect(telemetry.funnelStage).toBe('saved');
        expect(telemetry.dropReason).toBeUndefined();
    });

    it('stays silent when no sink is passed — an alias save must not relabel its parent line', async () => {
        await expect(saveValidatedMapping(
            'ryse protein',
            makeMapping({ foodName: 'Protein Rice' }),
            validation,
        )).resolves.toBeUndefined();
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
    });
});

// ============================================================
// Campaign gate G1 / F2 — FDC in the displacement guards.
//
// Both target-key expressions used to stop at `fs:`, so ANY overwrite with FDC
// on either side returned null for one key and skipped the whole guarded block
// (downgrade guard, corrupt bypass and cross-source margin together). MEASURED
// on the live DB 2026-08-01: 2,855 OFF + 570 fs FoodMapping rows were
// displaceable this way, and 84 live FDC rows prove the path is reachable.
// ============================================================
describe('FDC displacement guards (targetKeyOf)', () => {
    const FDC_ID = 171705;
    const OFF_BARCODE = '1111111111111';
    const OTHER_OFF = '2222222222222';

    it('an FDC challenger cannot displace a more-confident OFF incumbent', async () => {
        // Dies if fdcId is dropped from targetKeyOf (i.e. today's code):
        // newTargetKey is null, the block is skipped, and the upsert fires.
        mockFoodMappingFindUnique.mockResolvedValue({
            offBarcode: OFF_BARCODE, fdcId: null, fsId: null,
            foodName: 'Avocado Raw', aiConfidence: 0.98, validatedBy: 'ai',
        });
        mockOffFoodFindUnique.mockResolvedValue({ servingGrams: 30, packageQuantity: null, corruptReason: null });
        const telemetry: FunnelSink = { funnelStage: 'saved' };
        await saveValidatedMapping(
            'avocado',
            makeMapping({ foodId: `fdc_${FDC_ID}`, foodName: 'Avocados, raw' }),
            { confidence: 0.86 } as AIValidationResult,
            { telemetry },
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(telemetry.dropReason).toBe('save_rejected:cross_source_margin');
    });

    it('an OFF challenger cannot displace a more-confident FDC incumbent', async () => {
        // Dies on a half-fix that adds fdc: to the NEW key only — the two
        // expressions were written separately before targetKeyOf collapsed them.
        mockFoodMappingFindUnique.mockResolvedValue({
            offBarcode: null, fdcId: FDC_ID, fsId: null,
            foodName: 'Avocados, raw', aiConfidence: 0.98, validatedBy: 'ai',
        });
        const telemetry: FunnelSink = { funnelStage: 'saved' };
        await saveValidatedMapping(
            'avocado',
            makeMapping({ foodId: `off_${OTHER_OFF}`, foodName: 'Avocado' }),
            { confidence: 0.90 } as AIValidationResult,
            { telemetry },
        );
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(telemetry.dropReason).toBe('save_rejected:cross_source_margin');
    });

    it('an FDC overwrite is never serving-downgrade-checked', async () => {
        // hasServingShape() cannot read FDC, so folding fdc: into the downgrade
        // half would make every FDC challenger look shapeless and kill every
        // legitimate FDC upgrade of a shaped incumbent. Pinned, not commented.
        mockFoodMappingFindUnique.mockResolvedValue({
            offBarcode: OFF_BARCODE, fdcId: null, fsId: null,
            foodName: 'Avocado', aiConfidence: 0.80, validatedBy: 'ai',
        });
        mockOffFoodFindUnique.mockResolvedValue({ servingGrams: 250, packageQuantity: null, corruptReason: null });
        await saveValidatedMapping(
            'avocado',
            makeMapping({ foodId: `fdc_${FDC_ID}`, foodName: 'Avocados, raw' }),
            { confidence: 0.98 } as AIValidationResult, // clears 0.80 + 0.05
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
        expect(mockFoodMappingUpsert.mock.calls[0][0].update.fdcId).toBe(FDC_ID);
    });

    it('a corrupt-marked OFF incumbent does not block an FDC challenger on margin', async () => {
        // Dies if the incumbentCorrupt hoist is reverted: it would then be
        // computed inside the now-FDC-skipping downgrade half, read false, and
        // the margin guard would reject at 0.86 < 1.03 — leaving a corrupt row
        // that every read escapes and every re-resolution fails to replace.
        mockFoodMappingFindUnique.mockResolvedValue({
            offBarcode: OFF_BARCODE, fdcId: null, fsId: null,
            foodName: 'Avocado', aiConfidence: 0.98, validatedBy: 'ai',
        });
        mockOffFoodFindUnique.mockResolvedValue({
            servingGrams: 30, packageQuantity: null, corruptReason: 'per_serving_panel',
        });
        const { logger } = await import('../../logger');
        const infoSpy = jest.spyOn(logger, 'info');
        await saveValidatedMapping(
            'avocado',
            makeMapping({ foodId: `fdc_${FDC_ID}`, foodName: 'Avocados, raw' }),
            { confidence: 0.86 } as AIValidationResult,
        );
        expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
        expect(infoSpy).toHaveBeenCalledWith(
            'validated_mapping.downgrade_guard_bypassed_corrupt_incumbent',
            expect.objectContaining({ evictedTarget: `off:${OFF_BARCODE}`, keptTarget: `fdc:${FDC_ID}` }),
        );
        infoSpy.mockRestore();
    });

    it('targetKeyOf orders off > fs > fdc and tolerates omitted columns', async () => {
        expect(targetKeyOf({ offBarcode: 'b', fsId: 'f', fdcId: 1 })).toBe('off:b');
        expect(targetKeyOf({ fsId: 'f', fdcId: 1 })).toBe('fs:f');
        expect(targetKeyOf({ fdcId: 1 })).toBe('fdc:1');
        expect(targetKeyOf({ offBarcode: null, fsId: null, fdcId: null })).toBeNull();
        expect(targetKeyOf(null)).toBeNull();
    });
});

// ============================================================
// Campaign gate G1 / F1 (helper-level twin of the mapper test).
// The observed corruption reached the DB through the UPDATE branch only, so a
// test that checked `create` alone would have passed on the broken build.
// ============================================================
describe('stored confidence is the validated confidence, unscaled', () => {
    it('writes clampedConfidence to BOTH the create and update branches', async () => {
        mockFoodMappingFindUnique.mockResolvedValue(null);
        await saveValidatedMapping(
            'avocado',
            makeMapping({ foodName: 'Avocado' }),
            { confidence: 0.98 } as AIValidationResult,
        );
        expect(mockFoodMappingUpsert.mock.calls[0][0].create.aiConfidence).toBe(0.98);
        expect(mockFoodMappingUpsert.mock.calls[0][0].update.aiConfidence).toBe(0.98);
    });

    it('does not scale it down against an existing ai row either', async () => {
        mockFoodMappingFindUnique.mockResolvedValue({
            offBarcode: '1111111111111', fdcId: null, fsId: null,
            foodName: 'Avocado', aiConfidence: 0.70, validatedBy: 'ai',
        });
        await saveValidatedMapping(
            'avocado',
            makeMapping({ foodId: 'off_1111111111111', foodName: 'Avocado Raw' }),
            { confidence: 0.98 } as AIValidationResult,
        );
        expect(mockFoodMappingUpsert.mock.calls[0][0].update.aiConfidence).toBe(0.98);
    });
});
