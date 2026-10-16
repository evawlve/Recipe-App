/**
 * C69 F8 — the AI-nutrition cache key folds case.
 *
 * `AiGeneratedFood.ingredientName` is @unique and case-sensitive; the same food
 * reached the cache under two casings and made case-only duplicate rows. These
 * tests pin the fold, the attribution guards in the read SQL, and the
 * create-only save with its P2002 reuse path.
 */

const mockCallStructuredLlm = jest.fn();
const mockQueryRaw = jest.fn();
const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUpsert = jest.fn();
const mockServingUpsert = jest.fn();

jest.mock('../../ai/structured-client', () => ({
    callStructuredLlm: (...args: unknown[]) => mockCallStructuredLlm(...args),
}));

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
        aiGeneratedFood: {
            findUnique: (...args: unknown[]) => mockFindUnique(...args),
            create: (...args: unknown[]) => mockCreate(...args),
            update: (...args: unknown[]) => mockUpdate(...args),
            upsert: (...args: unknown[]) => mockUpsert(...args),
        },
        aiGeneratedServing: { upsert: (...args: unknown[]) => mockServingUpsert(...args) },
    },
}));

import {
    aiNutritionKey,
    getCachedAiNutrition,
    requestAiNutrition,
    createAiNutritionBudget,
} from '../ai-nutrition-backfill';

const EXISTING_ROW = {
    id: 'ai-existing',
    displayName: 'Chipotle Carnitas Burrito',
    caloriesPer100g: 222,
    proteinPer100g: 11, carbsPer100g: 25, fatPer100g: 9,
    fiberPer100g: 3, sugarPer100g: 1, sodiumMgPer100g: 400,
    saturatedFatPer100g: 3, cholesterolMgPer100g: 20,
    aiConfidence: 0.7, aiNotes: null, aiModel: 'openai/gpt-4o-mini',
};

beforeEach(() => {
    jest.clearAllMocks();
    mockQueryRaw.mockResolvedValue([]);
    mockFindUnique.mockResolvedValue(null);
    mockUpdate.mockResolvedValue({});
    mockCreate.mockResolvedValue({ id: 'ai-new' });
    mockServingUpsert.mockResolvedValue({});
    mockCallStructuredLlm.mockResolvedValue({
        status: 'success',
        model: 'openai/gpt-4o-mini',
        content: {
            displayName: 'Chipotle Carnitas Burrito',
            caloriesPer100g: 361, proteinPer100g: 12, carbsPer100g: 62, fatPer100g: 6,
            fiberPer100g: 10, sugarPer100g: 1, sodiumMgPer100g: 5,
            saturatedFatPer100g: 1, cholesterolMgPer100g: 0,
            confidence: 0.9, notes: '',
            gramsPerCup: 100, gramsPerTbsp: null, gramsPerTsp: null, gramsPerPiece: null,
        },
    });
});

describe('aiNutritionKey', () => {
    it('trims, lower-cases and collapses whitespace', () => {
        // MUTATION THAT KILLS THIS: drop .toLowerCase(), .trim() or the \s+ collapse.
        expect(aiNutritionKey('  Chipotle  Carnitas Burrito ')).toBe('chipotle carnitas burrito');
    });
});

describe('the cache read', () => {
    it('queries with the folded key and excludes import rows and fs_ seed shells', async () => {
        // MUTATION THAT KILLS THIS: pass the raw name to $queryRaw, or delete either
        // exclusion (an import row would then be served as an AI estimate).
        await getCachedAiNutrition('Chipotle Carnitas  Burrito');

        expect(mockQueryRaw).toHaveBeenCalledTimes(1);
        const [strings, ...values] = mockQueryRaw.mock.calls[0] as [string[], ...unknown[]];
        expect(values).toEqual(['chipotle carnitas burrito']);
        const sql = strings.join('?');
        expect(sql).toContain('lower("ingredientName")');
        expect(sql).toContain('fatsecret-live-import');
        expect(sql).toContain('fs\\_%');
    });
});

describe('the save', () => {
    it('creates (never upserts) with the folded key', async () => {
        // MUTATION THAT KILLS THIS: write ingredientName: normalizedName, or go
        // back to prisma.aiGeneratedFood.upsert (whose UPDATE overwrites aiModel).
        const out = await requestAiNutrition('Chipotle Carnitas Burrito', {
            budget: createAiNutritionBudget(1),
        });

        expect(out.status).toBe('success');
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(mockCreate.mock.calls[0][0].data.ingredientName).toBe('chipotle carnitas burrito');
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('P2002 with a reusable row returns THAT row, cached:true, and writes no servings', async () => {
        // MUTATION THAT KILLS THIS: return the fresh LLM panel (361 kcal) instead of
        // the existing row's, or run the serving loop on the reused row.
        mockCreate.mockRejectedValue({ code: 'P2002' });
        // First $queryRaw is the cache-read (miss); the second is the P2002 re-find.
        mockQueryRaw
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ id: EXISTING_ROW.id }]);
        mockFindUnique.mockResolvedValue(EXISTING_ROW);

        const out = await requestAiNutrition('chipotle carnitas burrito', {
            budget: createAiNutritionBudget(1),
        });

        expect(out.status).toBe('success');
        expect(out.status === 'success' && out.caloriesPer100g).toBe(222);
        expect(out.status === 'success' && out.foodId).toBe('ai-existing');
        expect(out.status === 'success' && out.cached).toBe(true);
        expect(mockServingUpsert).not.toHaveBeenCalled();
    });

    it('P2002 with no reusable row degrades to an error and never updates or upserts', async () => {
        // MUTATION THAT KILLS THIS: fall back to an update/upsert of the holding row
        // (overwriting an attributed row), or swallow the P2002 as success.
        mockCreate.mockRejectedValue({ code: 'P2002' });
        mockQueryRaw.mockResolvedValue([]);

        const out = await requestAiNutrition('chipotle carnitas burrito', {
            budget: createAiNutritionBudget(1),
        });

        expect(out.status).toBe('error');
        expect(out.status === 'error' && out.reason).toContain('ai_nutrition_key_held_by_attributed_row');
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockUpsert).not.toHaveBeenCalled();
    });
});
