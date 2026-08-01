/**
 * Multi-component signal (isMultiIngredient / splitIngredients) survives the cache.
 *
 * The LLM has always returned these two fields, and aiNormalizeIngredient has always
 * read them back on a cache hit — through `(cached as any)`, against a projection that
 * did not carry them and a table that had no column for them. The read could only ever
 * yield undefined, so multi-component detection fired on a cache MISS and nowhere else.
 *
 * Three edits were needed, and the third is the one that is easy to skip:
 *   1. columns on AiNormalizeCache,
 *   2. the fields in saveAiNormalizeCache's signature + upsert,
 *   3. THE PROJECTION in getAiNormalizeCache — which hand-builds an object literal
 *      rather than spreading the Prisma row, so a new column is invisible until it is
 *      named there too.
 *
 * The cache-hit test below is the one that dies if edit 3 is reverted. The others would
 * still pass against a permanently-undefined read, which is exactly how this shipped.
 */

const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockUpsert = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        aiNormalizeCache: {
            findUnique: (...args: unknown[]) => mockFindUnique(...args),
            update: (...args: unknown[]) => mockUpdate(...args),
            upsert: (...args: unknown[]) => mockUpsert(...args),
        },
    },
}));

// aiNormalizeIngredient must return from the cache before this is ever reached; a call
// here means the cache-hit branch did not fire and the test is measuring the wrong path.
const mockCallStructuredLlm = jest.fn();
jest.mock('../../ai/structured-client', () => ({
    callStructuredLlm: (...args: unknown[]) => mockCallStructuredLlm(...args),
}));

import { getAiNormalizeCache, saveAiNormalizeCache } from '../validated-mapping-helpers';
import { aiNormalizeIngredient } from '../ai-normalize';

/** A stored row as Prisma returns it. `salt and pepper` is the prompt's own example. */
function storedRow(overrides: Record<string, unknown> = {}) {
    return {
        normalizedKey: 'pepper salt',
        rawLine: 'salt and pepper',
        normalizedName: 'salt',
        canonicalBase: 'salt',
        synonyms: [],
        prepPhrases: [],
        sizePhrases: [],
        cookingModifier: null,
        estimatedCaloriesPer100g: null,
        estimatedProteinPer100g: null,
        estimatedCarbsPer100g: null,
        estimatedFatPer100g: null,
        nutritionConfidence: null,
        isBranded: false,
        isMultiIngredient: true,
        splitIngredients: ['salt', 'pepper'],
        useCount: 3,
        ...overrides,
    };
}

beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset().mockResolvedValue(undefined);
    mockUpsert.mockReset().mockResolvedValue(undefined);
    mockCallStructuredLlm.mockReset();
});

describe('saveAiNormalizeCache writes the multi-component signal', () => {
    it('carries isMultiIngredient + splitIngredients into the create payload', async () => {
        await saveAiNormalizeCache('salt and pepper', {
            normalizedName: 'salt',
            synonyms: [],
            prepPhrases: [],
            sizePhrases: [],
            isMultiIngredient: true,
            splitIngredients: ['salt', 'pepper'],
        });

        expect(mockUpsert).toHaveBeenCalledTimes(1);
        const call = mockUpsert.mock.calls[0][0];
        expect(call.create.isMultiIngredient).toBe(true);
        expect(call.create.splitIngredients).toEqual(['salt', 'pepper']);
    });

    it('defaults isMultiIngredient to false and omits splitIngredients when a caller does not compute them', async () => {
        // aiSimplifyIngredient shares this table and passes neither field. `undefined` must
        // reach Prisma as "column omitted", not as false/null. (Corrected 2026-08-01: this
        // used to also name batchNormalizeIngredients, which had zero callers and was deleted.)
        await saveAiNormalizeCache('jif peanut butter', {
            normalizedName: 'peanut butter',
            synonyms: [],
            prepPhrases: [],
            sizePhrases: [],
        });

        const call = mockUpsert.mock.calls[0][0];
        expect(call.create.isMultiIngredient).toBe(false);
        expect(call.create.splitIngredients).toBeUndefined();
    });

    it('does not clobber a stored signal on the update branch', async () => {
        // Prisma reads `undefined` in an update as "leave the column alone". If these were
        // written as `?? false` / `?? null`, a later save by a caller that cannot compute
        // them would erase a detection made by one that could.
        await saveAiNormalizeCache('jif peanut butter', {
            normalizedName: 'peanut butter',
            synonyms: [],
            prepPhrases: [],
            sizePhrases: [],
        });

        const call = mockUpsert.mock.calls[0][0];
        expect(call.update).toHaveProperty('isMultiIngredient', undefined);
        expect(call.update).toHaveProperty('splitIngredients', undefined);
    });
});

describe('getAiNormalizeCache projects the multi-component signal', () => {
    it('returns splitIngredients from a stored row', async () => {
        mockFindUnique.mockResolvedValue(storedRow());

        const cached = await getAiNormalizeCache('salt and pepper');

        expect(cached?.isMultiIngredient).toBe(true);
        expect(cached?.splitIngredients).toEqual(['salt', 'pepper']);
    });

    it('reads a pre-migration row as not-multi rather than throwing', async () => {
        // Rows written before the columns existed cannot be backfilled without re-running
        // the LLM. `false` / `undefined` is the same answer the old dead read gave.
        mockFindUnique.mockResolvedValue(storedRow({ isMultiIngredient: false, splitIngredients: null }));

        const cached = await getAiNormalizeCache('salt and pepper');

        expect(cached?.isMultiIngredient).toBe(false);
        expect(cached?.splitIngredients).toBeUndefined();
    });
});

describe('aiNormalizeIngredient surfaces the signal on a CACHE HIT', () => {
    it('returns the persisted splitIngredients without calling the LLM', async () => {
        mockFindUnique.mockResolvedValue(storedRow());

        const result = await aiNormalizeIngredient('salt and pepper');

        expect(mockCallStructuredLlm).not.toHaveBeenCalled();  // proves this is the hit path
        expect(result.status).toBe('success');
        if (result.status !== 'success') return;
        expect(result.isMultiIngredient).toBe(true);
        expect(result.splitIngredients).toEqual(['salt', 'pepper']);
    });
});

describe('aiNormalizeIngredient hands the signal to the cache on a MISS', () => {
    it('forwards the LLM split_ingredients into the save', async () => {
        mockFindUnique.mockResolvedValue(null);  // cold key
        mockCallStructuredLlm.mockResolvedValue({
            status: 'success',
            content: {
                normalized_name: 'salt',
                canonical_base: 'salt',
                prep_phrases: [],
                size_phrases: [],
                synonyms: [],
                is_multi_ingredient: true,
                split_ingredients: ['salt', 'pepper'],
            },
        });

        const result = await aiNormalizeIngredient('salt and pepper');

        expect(result.status).toBe('success');
        expect(mockUpsert).toHaveBeenCalledTimes(1);
        // Without this, the detection reaches the console.warn and nothing else — which is
        // precisely the state this change exists to end.
        const call = mockUpsert.mock.calls[0][0];
        expect(call.create.isMultiIngredient).toBe(true);
        expect(call.create.splitIngredients).toEqual(['salt', 'pepper']);
    });
});
