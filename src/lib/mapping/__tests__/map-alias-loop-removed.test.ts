/**
 * Campaign gate G1 / F1 — Step 6 issues exactly ONE saveValidatedMapping per
 * resolution, at the confidence the >= 0.85 gate tested.
 *
 * A loop used to run one extra save per AI/learned synonym, passing the SAME
 * `canonicalBase: cacheKey` as the primary save. canonicalBase is the
 * highest-priority input to normalizedForm, so every "alias" resolved to the
 * byte-identical key and simply UPDATEd the row the primary had just written —
 * at `confidence * 0.9`, and bumping usedCount once per synonym. The stored
 * confidence was therefore never the number the gate compared, which halved the
 * cross-source displacement bar the campaign relies on (0.98 -> 0.882 turns an
 * unreachable 1.03 into a 0.932 any exact_match rerank winner clears).
 *
 * These tests die if the loop is re-added: `toHaveBeenCalledTimes(1)` goes to
 * 1 + (surviving synonyms).
 *
 * Harness mirrors map-hit-resave-skip.test.ts.
 */

import { mapIngredientWithFallback } from '../map-ingredient-with-fallback';
import { aiNormalizeIngredient } from '../ai-normalize';
import {
    getValidatedMapping,
    getValidatedMappingByNormalizedName,
    saveValidatedMapping,
    getAiNormalizeCache,
} from '../validated-mapping-helpers';
import { findCanonicalName, getKnownSynonyms, saveSynonyms } from '../ai-synonym-generator';
import { getLearnedSynonyms, extractTermsFromIngredient } from '../learned-synonyms';
import { getCachedFoodWithRelations } from '../cache-search';
import { ensureFoodCached } from '../cache';
import { hydrateSingleCandidate } from '../hydrate-cache';
import { queueForDeferredHydration } from '../deferred-hydration';
import { backfillOnDemand } from '../serving-backfill';
import { insertAiServing } from '../ai-backfill';
import { gatherCandidates } from '../gather-candidates';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
        ingredient: { findMany: jest.fn().mockResolvedValue([]) },
    },
}));

jest.mock('../ai-normalize');
jest.mock('../validated-mapping-helpers', () => {
    const actual = jest.requireActual('../validated-mapping-helpers');
    return {
        ...actual,
        getValidatedMapping: jest.fn(),
        getValidatedMappingByNormalizedName: jest.fn(),
        saveValidatedMapping: jest.fn(),
        getAiNormalizeCache: jest.fn(),
        saveAiNormalizeCache: jest.fn(),
        trackValidationFailure: jest.fn(),
    };
});
jest.mock('../ai-synonym-generator');
jest.mock('../learned-synonyms');
jest.mock('../cache-search', () => {
    const actual = jest.requireActual('../cache-search');
    return { ...actual, getCachedFoodWithRelations: jest.fn() };
});
jest.mock('../cache');
jest.mock('../hydrate-cache');
jest.mock('../deferred-hydration');
jest.mock('../serving-backfill');
jest.mock('../ai-backfill', () => ({
    insertAiServing: jest.fn(),
    backfillWeightServing: jest.fn().mockResolvedValue({ success: false, reason: 'skip' }),
}));
jest.mock('../gather-candidates', () => {
    const actual = jest.requireActual('../gather-candidates');
    return { ...actual, gatherCandidates: jest.fn() };
});

const spinachCached = {
    id: 'spin-1',
    displayName: 'Spinach',
    ingredientName: 'spinach',
    caloriesPer100g: 23,
    proteinPer100g: 2.9,
    carbsPer100g: 3.6,
    fatPer100g: 0.4,
    servings: [{ id: 'srv-spin', label: '1 cup', grams: 30, volumeMl: 240 }],
};

beforeEach(() => {
    jest.clearAllMocks();
    (aiNormalizeIngredient as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
    (getValidatedMapping as jest.Mock).mockResolvedValue(null);
    (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValue(null);
    (getAiNormalizeCache as jest.Mock).mockResolvedValue(null);
    (saveValidatedMapping as jest.Mock).mockResolvedValue(undefined);
    (findCanonicalName as jest.Mock).mockResolvedValue(null);
    (getKnownSynonyms as jest.Mock).mockReturnValue([]);
    (saveSynonyms as jest.Mock).mockResolvedValue(undefined);
    // Step 1b only calls getLearnedSynonyms for the terms this extractor emits.
    (extractTermsFromIngredient as jest.Mock).mockReturnValue(['spinach']);
    (getCachedFoodWithRelations as jest.Mock).mockResolvedValue(spinachCached);
    (ensureFoodCached as jest.Mock).mockResolvedValue(null);
    (hydrateSingleCandidate as jest.Mock).mockResolvedValue(true);
    (queueForDeferredHydration as jest.Mock).mockImplementation(() => undefined);
    (backfillOnDemand as jest.Mock).mockResolvedValue({ success: false, reason: 'skip' });
    (insertAiServing as jest.Mock).mockResolvedValue({ success: false, reason: 'skip' });
    (gatherCandidates as jest.Mock).mockResolvedValue([
        { id: 'spin-1', source: 'ai_generated', name: 'Spinach', brandName: null, score: 0.9, foodType: 'Generic', rawData: {} },
    ]);
    // Synonyms EXIST for this resolution — they are still fed to
    // gatherCandidates as `aiSynonyms` (the mechanism that works). They must
    // not produce cache rows.
    (getLearnedSynonyms as jest.Mock).mockResolvedValue(['spinach leaves', 'baby spinach', 'fresh spinach']);
});

describe('Step 6 alias loop removed (F1)', () => {
    it('saves exactly ONCE even when the resolution carries synonyms', async () => {
        const result = await mapIngredientWithFallback('1 cup spinach', {
            minConfidence: 0,
            skipFdc: true,
        });

        expect(result).not.toBeNull();
        expect(saveValidatedMapping).toHaveBeenCalledTimes(1);
    });

    it('stamps the confidence the >= 0.85 gate tested, unscaled', async () => {
        const result = await mapIngredientWithFallback('1 cup spinach', {
            minConfidence: 0,
            skipFdc: true,
        });

        const gatedConfidence = (result as { confidence: number }).confidence;
        expect(gatedConfidence).toBeGreaterThanOrEqual(0.85);
        const savedValidation = (saveValidatedMapping as jest.Mock).mock.calls[0][2];
        expect(savedValidation.confidence).toBe(gatedConfidence);
        // The deleted loop's factor. Any re-introduction shows up here first.
        expect(savedValidation.confidence).not.toBeCloseTo(gatedConfidence * 0.9, 6);
    });

    it('no save carries alias options, and none is keyed off a synonym', async () => {
        await mapIngredientWithFallback('1 cup spinach', { minConfidence: 0, skipFdc: true });

        for (const call of (saveValidatedMapping as jest.Mock).mock.calls) {
            const [rawIngredient, , , options] = call;
            expect(options).not.toHaveProperty('isAlias');
            expect(options).not.toHaveProperty('canonicalRawIngredient');
            expect(rawIngredient).not.toBe('spinach leaves');
            expect(rawIngredient).not.toBe('baby spinach');
            expect(rawIngredient).not.toBe('fresh spinach');
        }
    });

    it('still feeds the synonyms to gatherCandidates — removing the loop must not remove the feature', async () => {
        await mapIngredientWithFallback('1 cup spinach', { minConfidence: 0, skipFdc: true });

        // gatherCandidates(rawLine, parsed, normalizedName, GatherOptions)
        const withSynonyms = (gatherCandidates as jest.Mock).mock.calls.filter(
            (c) => Array.isArray(c[3]?.aiSynonyms) && c[3].aiSynonyms.length > 0,
        );
        expect(withSynonyms.length).toBeGreaterThan(0);
        expect(withSynonyms[0][3].aiSynonyms).toEqual(
            expect.arrayContaining(['spinach leaves', 'baby spinach', 'fresh spinach']),
        );
    });
});
