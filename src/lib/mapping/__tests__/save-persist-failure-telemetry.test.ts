/**
 * A failed save must not be reported as a conversion.
 *
 * The funnel marks a line 'saved' optimistically, before `saveValidatedMapping`
 * writes. The catch block used to log `validated_mapping.save_error` and return
 * quietly, so a write that threw still read as `funnelStage: 'saved'`.
 *
 * That is not hypothetical. Warm batch 01 of the seed-corpus campaign reported
 * **92 saves and wrote 81 rows**; the 11-row gap was exactly 11 foreign-key
 * failures, and 31.4% of that batch's FatSecret saves (11 of 35) wrote nothing
 * while telemetry called them conversions. The campaign then graded itself —
 * conversion, coverage lift, its own stop rules — on that number.
 *
 * The FK case is split out because the two failure modes need different fixes:
 * P2003 is the FatSecret lane's background `persistFatSecretHits` not having
 * written the `FatSecretFood` parent yet, which is a race; anything else is not.
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
        offFood: { findUnique: (...args: unknown[]) => mockOffFoodFindUnique(...args) },
        fatSecretServing: { findFirst: (...args: unknown[]) => mockFatSecretServingFindFirst(...args) },
    },
}));

import { saveValidatedMapping } from '../validated-mapping-helpers';
import type { FatsecretMappedIngredient } from '../map-ingredient-with-fallback';
import type { AIValidationResult } from '../validated-mapping-helpers';
import type { FunnelSink } from '../funnel';

const validation = { confidence: 0.95 } as AIValidationResult;

function makeMapping(overrides: Partial<FatsecretMappedIngredient> = {}): FatsecretMappedIngredient {
    return {
        source: 'fatsecret',
        foodId: 'fs_122756',
        foodName: 'Trail Mix',
        brandName: 'Nuts Co',
        grams: 30,
        kcal: 150,
        protein: 5,
        carbs: 12,
        fat: 9,
        confidence: 0.95,
        quality: 'high',
        rawLine: 'trail mix',
        ...overrides,
    } as FatsecretMappedIngredient;
}

/** Prisma surfaces a foreign-key violation as code P2003. */
function foreignKeyError(): Error {
    const e = new Error('Foreign key constraint failed on the field: `fsId`') as Error & { code: string };
    e.code = 'P2003';
    return e;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockFoodMappingFindUnique.mockResolvedValue(null);
    mockOffFoodFindUnique.mockResolvedValue(null);
    mockFatSecretServingFindFirst.mockResolvedValue(null);
    mockFoodMappingUpdate.mockResolvedValue({});
});

describe('a save that throws is not a conversion', () => {
    it('downgrades the funnel to save_rejected when the write hits an FK violation', async () => {
        mockFoodMappingUpsert.mockRejectedValue(foreignKeyError());
        const telemetry: FunnelSink = { funnelStage: 'saved' };

        await saveValidatedMapping('trail mix', makeMapping(), validation, { telemetry });

        expect(telemetry.funnelStage).toBe('save_rejected');
        expect(telemetry.dropReason).toBe('save_rejected:persist_failed_fk');
    });

    it('downgrades the funnel on any other write failure, with a distinct class', async () => {
        mockFoodMappingUpsert.mockRejectedValue(new Error('connection terminated'));
        const telemetry: FunnelSink = { funnelStage: 'saved' };

        await saveValidatedMapping('trail mix', makeMapping(), validation, { telemetry });

        expect(telemetry.funnelStage).toBe('save_rejected');
        expect(telemetry.dropReason).toBe('save_rejected:persist_failed');
    });

    it('still swallows the error — a failed cache write must never break the request', async () => {
        mockFoodMappingUpsert.mockRejectedValue(foreignKeyError());
        await expect(
            saveValidatedMapping('trail mix', makeMapping(), validation, { telemetry: { funnelStage: 'saved' } }),
        ).resolves.toBeUndefined();
    });

    it('leaves the funnel alone when the write succeeds', async () => {
        mockFoodMappingUpsert.mockResolvedValue({});
        const telemetry: FunnelSink = { funnelStage: 'saved' };

        await saveValidatedMapping('trail mix', makeMapping(), validation, { telemetry });

        expect(telemetry.funnelStage).toBe('saved');
        expect(telemetry.dropReason).toBeUndefined();
    });

    it('does not throw when no telemetry sink is supplied', async () => {
        mockFoodMappingUpsert.mockRejectedValue(foreignKeyError());
        await expect(saveValidatedMapping('trail mix', makeMapping(), validation)).resolves.toBeUndefined();
    });
});
