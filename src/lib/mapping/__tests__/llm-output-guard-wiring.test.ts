/**
 * WIRING test for the introduced-food-token guard.
 *
 * `llm-output-guards.test.ts` proves the predicate. It does NOT prove the
 * mapper calls it — and on this codebase that is the failure that keeps
 * recurring: a correct rule with a caller that never uses it (#221, #223 and
 * #226 were all that shape, and #226's caller was dead code a gate believed was
 * live). So this file asserts the repaired string actually reaches
 * `gatherCandidates()`, which is the value retrieval searches on.
 *
 * Mock preamble mirrors `legacy-key-fallback.test.ts`, including the
 * `callStructuredLlm` stub — that is the single chokepoint every LLM caller in
 * the mapper goes through, and without it this suite makes billable OpenRouter
 * round trips on any dev machine with a populated .env (CI has no key, so CI
 * would stay green while the dev machine paid).
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
jest.mock('../../ai/structured-client', () => {
    const actual = jest.requireActual('../../ai/structured-client');
    return {
        ...actual,
        callStructuredLlm: jest.fn().mockResolvedValue({
            status: 'error',
            error: 'llm disabled in unit tests',
            provider: 'openrouter',
            model: 'none',
            durationMs: 0,
        }),
    };
});
jest.mock('../ai-nutrition-backfill', () => ({
    requestAiNutrition: jest.fn().mockResolvedValue({ status: 'error', reason: 'skip' }),
    extractBaseFoodContext: jest.fn().mockReturnValue(null),
    getAiServingGrams: jest.fn().mockResolvedValue(null),
    createAiNutritionBudget: (max: number) => ({ remaining: max, spent: 0 }),
}));

/** Every normalizedName handed to retrieval, in call order. */
function gatherNames(): string[] {
    return (gatherCandidates as jest.Mock).mock.calls.map((c) => c[2]);
}

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
    (getLearnedSynonyms as jest.Mock).mockResolvedValue([]);
    (extractTermsFromIngredient as jest.Mock).mockReturnValue([]);
    (getCachedFoodWithRelations as jest.Mock).mockResolvedValue(null);
    (ensureFoodCached as jest.Mock).mockResolvedValue(null);
    (hydrateSingleCandidate as jest.Mock).mockResolvedValue(true);
    (queueForDeferredHydration as jest.Mock).mockImplementation(() => undefined);
    (backfillOnDemand as jest.Mock).mockResolvedValue({ success: false, reason: 'skip' });
    (insertAiServing as jest.Mock).mockResolvedValue({ success: false, reason: 'skip' });
    (gatherCandidates as jest.Mock).mockResolvedValue([]);
});

describe('the introduced-food-token guard is wired into the mapper', () => {
    it('does not send an LLM-introduced "extract" to retrieval', async () => {
        // The measured live failure: `vanilla yogurt` searched as vanilla
        // extract and resolved to a 288 kcal/100g, 4.2 g ingredient.
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue({
            status: 'success',
            normalizedName: 'vanilla yogurt extract',
            canonicalBase: 'vanilla extract',
        });

        await mapIngredientWithFallback('vanilla yogurt');

        const names = gatherNames();
        expect(names.length).toBeGreaterThan(0);
        // The post-LLM gather is what retrieval actually runs on.
        expect(names[names.length - 1]).toBe('vanilla yogurt');
        expect(names.some((n) => /\bextract\b/i.test(n ?? ''))).toBe(false);
    });

    it('leaves the LLM output alone when the user really said extract', async () => {
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue({
            status: 'success',
            normalizedName: 'vanilla extract',
            canonicalBase: 'vanilla extract',
        });

        await mapIngredientWithFallback('1 tsp vanilla extract');

        const names = gatherNames();
        expect(names[names.length - 1]).toBe('vanilla extract');
    });

    it('still applies the qualifiers the normalizer is supposed to add', async () => {
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue({
            status: 'success',
            normalizedName: 'rolled oats',
            canonicalBase: 'rolled oats',
        });

        await mapIngredientWithFallback('oatmeal');

        const names = gatherNames();
        expect(names[names.length - 1]).toBe('rolled oats');
    });
});

describe('the decisive-brand preservation repair is wired into the mapper', () => {
    it('puts back a decisive brand the model dropped', async () => {
        // Measured shape: the ONE bar, whose brand the normalizer classifies as
        // the numeral and strips as a size phrase.
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue({
            status: 'success',
            normalizedName: 'birthday cake',
            canonicalBase: 'birthday cake',
        });

        await mapIngredientWithFallback('one bar birthday cake');

        const names = gatherNames();
        expect(names[names.length - 1]).toBe('one birthday cake');
    });

    it('does NOT prefix a non-decisive brand — the "bell capsicum" regression stays dead', async () => {
        // `bell` is a real lexicon brand (Bell & Evans) and a false positive
        // here. An unconditional prefix produced key `bell capsicum` and
        // orphaned the live human-triage `capsicum` row (golden n-mq-30).
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue({
            status: 'success',
            normalizedName: 'capsicum',
            canonicalBase: 'capsicum',
        });

        await mapIngredientWithFallback('bell pepper');

        const names = gatherNames();
        expect(names[names.length - 1]).toBe('capsicum');
        // NB: an earlier gather legitimately contains `bell` — that is the
        // user's own text (`bell pepper`) before the rewrite, not a prefix.
        // The regression to exclude is specifically the fused brand+rewrite.
        expect(names).not.toContain('bell capsicum');
    });

    it('leaves the name alone when the model kept the brand', async () => {
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue({
            status: 'success',
            normalizedName: 'one birthday cake bar',
            canonicalBase: 'one birthday cake bar',
        });

        await mapIngredientWithFallback('one bar birthday cake');

        const names = gatherNames();
        expect(names[names.length - 1]).toBe('one birthday cake bar');
    });
});
