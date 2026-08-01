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
    it('returns an ordinary AiNutritionError and AUDITS ai_nutrition.budget_exhausted', async () => {
        // The caller ignores the reason string, so only the log distinguishes
        // "we declined to spend" from "the LLM failed" for whoever debugs the
        // next eval slide. That is why the log line is asserted.
        //
        // It is logger.AUDIT, not logger.info, and that is load-bearing. This event
        // was `logger.info` and therefore invisible in production: SWC's
        // removeConsole stripped every console.info call from the bundle, so
        // MEASURED 0 occurrences of the cap event in 976,124 lines of box log —
        // while 19 of the 24 downstream mapping.ai_nutrition_backfill_failed warns
        // carried reason:"batch_cap_reached". The cap was only ever visible through
        // a neighbour's payload. Audit bypasses the LOG_LEVEL threshold entirely.
        const { logger } = await import('../../logger');
        const auditSpy = jest.spyOn(logger, 'audit');
        const budget: AiNutritionBudget = { remaining: 0, spent: 7 };

        const out = await requestAiNutrition('cooked oats', { budget });

        expect(out).toEqual({ status: 'error', reason: 'nutrition_budget_exhausted' });
        expect(auditSpy).toHaveBeenCalledWith(
            'ai_nutrition.budget_exhausted',
            expect.objectContaining({ normalizedName: 'cooked oats', spent: 7 }),
        );
        auditSpy.mockRestore();
    });

    it('is still written at LOG_LEVEL=error, where an info line would be dropped', async () => {
        // Dies if the event is demoted back to logger.info: the write spy sees no
        // line carrying the msg, which is the production state this group fixes.
        const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const prevLevel = process.env.LOG_LEVEL;
        process.env.LOG_LEVEL = 'error';

        try {
            jest.resetModules();
            const { requestAiNutrition: freshRequest } = await import('../ai-nutrition-backfill');
            await freshRequest('cooked oats', { budget: { remaining: 0, spent: 7 } });

            const lines = [...stderrSpy.mock.calls, ...stdoutSpy.mock.calls].map(c => String(c[0]));
            const capLine = lines.find(l => l.includes('ai_nutrition.budget_exhausted'));
            expect(capLine).toBeDefined();
            expect(JSON.parse(capLine!).level).toBe('audit');
        } finally {
            if (prevLevel === undefined) delete process.env.LOG_LEVEL;
            else process.env.LOG_LEVEL = prevLevel;
            stderrSpy.mockRestore();
            stdoutSpy.mockRestore();
            jest.resetModules();
        }
    });
});

describe('a non-numeric budget fails CLOSED, never open', () => {
    // Both live producers of `max` are Number.parseInt over operator-supplied text:
    // AI_NUTRITION_MAX_PER_REQUEST / AI_NUTRITION_MAX_PER_BATCH in ./config, and
    // --nutrition-budget in scripts/warm-names.ts. MEASURED (node -e):
    //   Math.max(0, NaN) === NaN ; (NaN <= 0) === false ; parseInt('', 10) === NaN
    // so the pre-fix `Math.max(0, max)` + `remaining <= 0` pair turned
    // AI_NUTRITION_MAX_PER_REQUEST=unlimited into an UNBOUNDED LLM allowance —
    // the exact opposite of the .env.example line "Set to 0 to fail the live path
    // closed", and with no log line to show it happening.

    it.each([
        ['NaN (parseInt of a non-numeric env var)', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['-Infinity', Number.NEGATIVE_INFINITY],
    ])('createAiNutritionBudget(%s) yields remaining 0', (_label, max) => {
        expect(createAiNutritionBudget(max as number).remaining).toBe(0);
    });

    it('a NaN budget cannot buy a single LLM call', async () => {
        mockAiGeneratedFoodFindUnique.mockResolvedValue(null);
        mockCallStructuredLlm.mockClear();

        const budget = createAiNutritionBudget(Number.parseInt('unlimited', 10));
        const out = await requestAiNutrition('food', { budget });

        expect(out).toEqual({ status: 'error', reason: 'nutrition_budget_exhausted' });
        expect(mockCallStructuredLlm).not.toHaveBeenCalled();
    });

    it('the exhaustion guard itself fails closed on a hand-built NaN budget', async () => {
        // Defence in depth: AiNutritionBudget is a plain caller-owned struct, so a
        // caller can hand one over without going through the constructor. Dies if
        // the guard is written `remaining <= 0` instead of `!(remaining > 0)`.
        mockAiGeneratedFoodFindUnique.mockResolvedValue(null);
        mockCallStructuredLlm.mockClear();

        const out = await requestAiNutrition('food', {
            budget: { remaining: Number.NaN, spent: 0 },
        });

        expect(out).toEqual({ status: 'error', reason: 'nutrition_budget_exhausted' });
        expect(mockCallStructuredLlm).not.toHaveBeenCalled();
    });

    it('a fractional budget is floored, so it cannot decrement past the guard', () => {
        expect(createAiNutritionBudget(2.9).remaining).toBe(2);
        expect(createAiNutritionBudget(0.9).remaining).toBe(0);
    });

    it('still honours a legitimate allowance', () => {
        expect(createAiNutritionBudget(3).remaining).toBe(3);
        expect(createAiNutritionBudget(0).remaining).toBe(0);
        expect(createAiNutritionBudget(-5).remaining).toBe(0);
    });
});
