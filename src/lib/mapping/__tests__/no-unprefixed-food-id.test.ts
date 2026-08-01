/**
 * No code path may produce a FoodMapping row that points at nothing.
 *
 * `FoodMapping` has exactly three target columns — offBarcode, fdcId, fsId. It has
 * NO aiGeneratedFoodId column and no AiGeneratedFood relation (IngredientFoodMap
 * does; this table does not). Yet `saveValidatedMapping()` used to fall through to
 * `mappingSource = 'ai_generated'` whenever `mapping.foodId` carried none of the
 * three prefixes, which would write source 'ai_generated' with all three id columns
 * NULL — a mapping no reader can resolve.
 *
 * MEASURED on the box 2026-08-01:
 *   SELECT source, COUNT(*) FROM "FoodMapping" GROUP BY 1
 *     -> openfoodfacts 2855 / fatsecret 570 / fdc 84 (no ai_generated row, ever)
 *   COUNT(*) FILTER (WHERE "offBarcode" IS NULL AND "fdcId" IS NULL AND "fsId" IS NULL)
 *     -> 0 of 3509
 *
 * The one live mechanism that could ever mint an unprefixed foodId was
 * `getValidatedMappingByNormalizedName()`'s `foodId = cached.normalizedForm`
 * fabrication on a row with no target column. Both ends are closed here: the read
 * path refuses such a row, and the save path refuses such an id.
 */

const mockFoodMappingFindUnique = jest.fn();
const mockFoodMappingUpsert = jest.fn();
const mockFoodMappingUpdate = jest.fn();
const mockOffFoodFindUnique = jest.fn();
const mockFatSecretServingFindFirst = jest.fn();
const mockAiGeneratedFoodFindFirst = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        foodMapping: {
            findUnique: (...args: unknown[]) => mockFoodMappingFindUnique(...args),
            findMany: jest.fn().mockResolvedValue([]),
            upsert: (...args: unknown[]) => mockFoodMappingUpsert(...args),
            update: (...args: unknown[]) => mockFoodMappingUpdate(...args),
        },
        offFood: { findUnique: (...args: unknown[]) => mockOffFoodFindUnique(...args) },
        fatSecretServing: { findFirst: (...args: unknown[]) => mockFatSecretServingFindFirst(...args) },
        aiGeneratedFood: { findFirst: (...args: unknown[]) => mockAiGeneratedFoodFindFirst(...args) },
    },
}));

import {
    saveValidatedMapping,
    getValidatedMappingByNormalizedName,
    type AIValidationResult,
} from '../validated-mapping-helpers';
import type { FatsecretMappedIngredient } from '../map-ingredient-with-fallback';
import type { FunnelSink } from '../funnel';
import { logger } from '../../logger';

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

let auditSpy: jest.SpyInstance;

beforeEach(() => {
    jest.clearAllMocks();
    mockFoodMappingFindUnique.mockResolvedValue(null);
    mockFoodMappingUpsert.mockResolvedValue({});
    mockFoodMappingUpdate.mockResolvedValue({});
    mockOffFoodFindUnique.mockResolvedValue(null);
    mockFatSecretServingFindFirst.mockResolvedValue(null);
    mockAiGeneratedFoodFindFirst.mockResolvedValue(null);
    auditSpy = jest.spyOn(logger, 'audit').mockImplementation(() => { });
});

afterEach(() => {
    auditSpy.mockRestore();
});

function auditMessages(): string[] {
    return auditSpy.mock.calls.map(c => String(c[0]));
}

describe('saveValidatedMapping refuses an unprefixed foodId', () => {
    it('does not write a row when the foodId carries no recognised prefix', async () => {
        const telemetry: FunnelSink = {};

        await saveValidatedMapping(
            'peanut butter',
            makeMapping({ foodId: 'peanut butter', foodName: 'Peanut Butter' }),
            validation,
            { telemetry },
        );

        // The row this would have written is source 'ai_generated' with all three
        // target columns NULL — unresolvable by every reader.
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(mockFoodMappingUpdate).not.toHaveBeenCalled();
        // Refusing SILENTLY would be the same class of defect. It must be observable,
        // and on the audit channel so no LOG_LEVEL can hide it.
        expect(auditMessages()).toContain('save.unprefixed_food_id');
        expect(telemetry.funnelStage).toBe('save_rejected');
        expect(telemetry.dropReason).toContain('unprefixed_food_id');
    });

    it('refuses an fdc_ id whose suffix is not a number, instead of writing NaN', async () => {
        await saveValidatedMapping(
            'peanut butter',
            makeMapping({ foodId: 'fdc_notanumber', foodName: 'Peanut Butter' }),
            validation,
        );

        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(auditMessages()).toContain('save.unprefixed_food_id');
    });

    it.each(['off_1111111111111', 'fdc_12345', 'fs_69219858'])(
        'still writes normally for a properly prefixed id (%s)',
        async (foodId) => {
            await saveValidatedMapping(
                'test food',
                makeMapping({ foodId }),
                validation,
            );

            expect(mockFoodMappingUpsert).toHaveBeenCalledTimes(1);
            expect(auditMessages()).not.toContain('save.unprefixed_food_id');
        },
    );

    it('assigns the source from the id prefix, never "ai_generated"', async () => {
        await saveValidatedMapping('test food', makeMapping({ foodId: 'fs_69219858' }), validation);

        const call = mockFoodMappingUpsert.mock.calls[0][0];
        expect(call.create.source).toBe('fatsecret');
        expect(call.create.fsId).toBe('69219858');
    });
});

describe('the read path refuses a cache row that names no record', () => {
    it('returns null instead of fabricating foodId from normalizedForm', async () => {
        mockFoodMappingFindUnique.mockResolvedValue({
            normalizedForm: 'peanut butter',
            foodName: 'Peanut Butter',
            brandName: null,
            // The shape that would have triggered the fabrication: no target column.
            offBarcode: null,
            fdcId: null,
            fsId: null,
            source: 'openfoodfacts',
            aiConfidence: 0.9,
            validatedBy: 'ai',
            usedCount: 1,
        });

        const rejection = { reason: null as string | null };
        const result = await getValidatedMappingByNormalizedName(
            'peanut butter',
            'openfoodfacts',
            'peanut butter',
            rejection,
        );

        // A row that names no record is not a usable hit — returning null forces a
        // fresh resolution rather than inventing an identity that the save gate
        // would then have to consume.
        expect(result).toBeNull();
        expect(rejection.reason).toBe('no_target_column');
        expect(auditMessages()).toContain('cache.row_has_no_target_column');
        // And it must NOT have gone looking for an AiGeneratedFood to stand in.
        expect(mockAiGeneratedFoodFindFirst).not.toHaveBeenCalled();
    });
});

describe('the human-row write-guard refuses a target-less incumbent', () => {
    it('does not name-match against a human row with no id columns', async () => {
        mockFoodMappingFindUnique.mockResolvedValue({
            offBarcode: null,
            fdcId: null,
            fsId: null,
            foodName: 'Peanut Butter',
            validatedBy: 'human-triage',
            aiConfidence: 0.9,
        });

        const telemetry: FunnelSink = {};
        await saveValidatedMapping(
            'peanut butter',
            makeMapping({ foodId: 'off_1111111111111', foodName: 'Peanut Butter' }),
            validation,
            { telemetry },
        );

        // The old code name-matched here on the false premise that "ai_generated rows
        // carry no id columns", so an identical NAME would have bumped usedCount on a
        // row pointing at nothing.
        expect(mockFoodMappingUpdate).not.toHaveBeenCalled();
        expect(mockFoodMappingUpsert).not.toHaveBeenCalled();
        expect(auditMessages()).toContain('save.human_row_has_no_target_column');
        expect(telemetry.funnelStage).toBe('save_rejected');
        expect(telemetry.dropReason).toContain('human_row');
    });
});
