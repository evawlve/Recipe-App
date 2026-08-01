/**
 * Campaign gate G1 / F3 — the AI-nutrition spend budget.
 *
 * What this replaces: a module-scope `let batchCallCount = 0` with no reachable
 * reset (both `resetNutritionBatchCounter` and `getNutritionBatchCount` had
 * ZERO call sites). In a long-lived Next.js server it latched for the life of
 * the process: once a warm run had burned the allowance, the live API refused
 * nutrition backfill forever — including free exact-match cache hits, because
 * the cap sat ABOVE the cache lookup. That is what slid golden case n-cook-06
 * from kcal100=361 to 0 and redded the warm runner on drift.
 */

const mockCallStructuredLlm = jest.fn();
const mockAiGeneratedFoodFindUnique = jest.fn();
const mockAiGeneratedFoodUpdate = jest.fn();

jest.mock('../../ai/structured-client', () => ({
    callStructuredLlm: (...args: unknown[]) => mockCallStructuredLlm(...args),
}));

jest.mock('../../db', () => ({
    prisma: {
        aiGeneratedFood: {
            findUnique: (...args: unknown[]) => mockAiGeneratedFoodFindUnique(...args),
            update: (...args: unknown[]) => mockAiGeneratedFoodUpdate(...args),
            upsert: jest.fn().mockResolvedValue({ id: 'ai-1' }),
        },
        aiGeneratedServing: { upsert: jest.fn().mockResolvedValue({}) },
    },
}));

import {
    requestAiNutrition,
    createAiNutritionBudget,
    type AiNutritionBudget,
} from '../ai-nutrition-backfill';

const CACHED_ROW = {
    id: 'ai-cooked-oats',
    displayName: 'Cooked Oats',
    caloriesPer100g: 361,
    proteinPer100g: 12,
    carbsPer100g: 62,
    fatPer100g: 6,
    fiberPer100g: 10,
    sugarPer100g: 1,
    sodiumMgPer100g: 5,
    saturatedFatPer100g: 1,
    cholesterolMgPer100g: 0,
    aiConfidence: 0.9,
    aiNotes: null,
    aiModel: 'openai/gpt-4o-mini',
};

beforeEach(() => {
    jest.clearAllMocks();
    mockAiGeneratedFoodFindUnique.mockResolvedValue(null);
    mockAiGeneratedFoodUpdate.mockResolvedValue({});
    mockCallStructuredLlm.mockResolvedValue({
        status: 'success',
        model: 'openai/gpt-4o-mini',
        content: {
            displayName: 'Cooked Oats',
            caloriesPer100g: 361, proteinPer100g: 12, carbsPer100g: 62, fatPer100g: 6,
            fiberPer100g: 10, sugarPer100g: 1, sodiumMgPer100g: 5,
            saturatedFatPer100g: 1, cholesterolMgPer100g: 0,
            confidence: 0.9, notes: '',
            gramsPerCup: null, gramsPerTbsp: null, gramsPerTsp: null, gramsPerPiece: null,
        },
    });
});

describe('cache lookup sits ABOVE the budget check', () => {
    it('an exhausted budget still serves an exact-match cache hit', async () => {
        // Dies if the budget check is moved back above getCachedAiNutrition():
        // the call then returns {status:'error', reason:'nutrition_budget_exhausted'}
        // and the first assertion fails.
        mockAiGeneratedFoodFindUnique.mockResolvedValue(CACHED_ROW);
        const budget: AiNutritionBudget = { remaining: 0, spent: 20 };

        const out = await requestAiNutrition('cooked oats', { budget });

        expect(out.status).toBe('success');
        expect(out.status === 'success' && out.cached).toBe(true);
        expect(out.status === 'success' && out.caloriesPer100g).toBe(361);
        expect(mockCallStructuredLlm).not.toHaveBeenCalled();
        // A free read must not be charged.
        expect(budget.spent).toBe(20);
    });
});

describe('the allowance is caller-owned — nothing latches at module scope', () => {
    it('two independent budgets each get their own allowance', async () => {
        // THIS IS THE TEST FOR THE ACTUAL INCIDENT. A module counter makes the
        // second budget inherit the first's spend and the LLM is never called
        // again for the life of the process.
        const a = createAiNutritionBudget(1);
        await requestAiNutrition('food one', { budget: a });
        expect(mockCallStructuredLlm).toHaveBeenCalledTimes(1);
        expect(a.remaining).toBe(0);

        const refused = await requestAiNutrition('food two', { budget: a });
        expect(refused).toEqual({ status: 'error', reason: 'nutrition_budget_exhausted' });
        expect(mockCallStructuredLlm).toHaveBeenCalledTimes(1);

        const b = createAiNutritionBudget(1);
        await requestAiNutrition('food three', { budget: b });
        expect(mockCallStructuredLlm).toHaveBeenCalledTimes(2);
        expect(b.spent).toBe(1);
    });

    it('a zero budget fails closed without touching the LLM', async () => {
        const zero = createAiNutritionBudget(0);
        const out = await requestAiNutrition('anything', { budget: zero });
        expect(out).toEqual({ status: 'error', reason: 'nutrition_budget_exhausted' });
        expect(mockCallStructuredLlm).not.toHaveBeenCalled();
    });
});

describe('the slot is charged around the real call, not around success', () => {
    it('a failing LLM call still consumes its slot', async () => {
        // Dies if the decrement moves below the `result.status === 'error'`
        // early return: a provider outage then becomes an unbounded retry storm
        // the budget cannot see.
        mockCallStructuredLlm.mockResolvedValue({ status: 'error', error: 'upstream 503' });
        const budget = createAiNutritionBudget(3);
        const out = await requestAiNutrition('food', { budget });
        expect(out.status).toBe('error');
        expect(budget.remaining).toBe(2);
        expect(budget.spent).toBe(1);
    });

    it('a THROWING LLM call still consumes its slot', async () => {
        mockCallStructuredLlm.mockRejectedValue(new Error('socket hang up'));
        const budget = createAiNutritionBudget(3);
        await expect(requestAiNutrition('food', { budget })).rejects.toThrow('socket hang up');
        expect(budget.remaining).toBe(2);
        expect(budget.spent).toBe(1);
    });
});

describe('exhaustion degrades the line, it does not throw', () => {
    it('returns an ordinary AiNutritionError and logs ai_nutrition.budget_exhausted', async () => {
        // The caller ignores the reason string, so only the log distinguishes
        // "we declined to spend" from "the LLM failed" for whoever debugs the
        // next eval slide. That is why the log line is asserted.
        const { logger } = await import('../../logger');
        const infoSpy = jest.spyOn(logger, 'info');
        const budget: AiNutritionBudget = { remaining: 0, spent: 7 };

        const out = await requestAiNutrition('cooked oats', { budget });

        expect(out).toEqual({ status: 'error', reason: 'nutrition_budget_exhausted' });
        expect(infoSpy).toHaveBeenCalledWith(
            'ai_nutrition.budget_exhausted',
            expect.objectContaining({ normalizedName: 'cooked oats', spent: 7 }),
        );
        infoSpy.mockRestore();
    });
});
