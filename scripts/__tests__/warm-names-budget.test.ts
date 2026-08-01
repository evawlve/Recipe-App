/**
 * Campaign gate G1 / F3 — THE MIGRATION GUARD.
 *
 * warm-names is the writer whose LLM nutrition spend the deleted module-scope
 * counter used to bound. With that counter gone, a caller that passes no budget
 * gets a fresh AI_NUTRITION_MAX_PER_REQUEST allowance PER QUERY — so an
 * unmigrated 1,000-query batch could fire thousands of LLM calls against the
 * old ~20 per process. `tsconfig.json` excludes `scripts/**`, so no typecheck
 * catches that; this test is the guard instead.
 *
 * It asserts object IDENTITY, not shape. `toEqual` would pass on three separate
 * fresh budgets — exactly the mutation that matters.
 */

const mockMapIngredientWithFallback = jest.fn();

jest.mock('../../src/lib/mapping/map-ingredient-with-fallback', () => ({
    mapIngredientWithFallback: (...args: unknown[]) => mockMapIngredientWithFallback(...args),
}));
jest.mock('../../src/lib/mapping/normalization-rules', () => ({
    refreshNormalizationRules: jest.fn().mockResolvedValue(undefined),
}));
// ai-nutrition-backfill pulls the Prisma client at import; jest has no DATABASE_URL.
jest.mock('../../src/lib/db', () => ({ prisma: {} }));

import { warmNames } from '../warm-names';

type MapperOptions = { aiNutritionBudget?: { remaining: number; spent: number } };

beforeEach(() => {
    jest.clearAllMocks();
    mockMapIngredientWithFallback.mockResolvedValue(null);
});

describe('warmNames hands every query the SAME budget object', () => {
    // Queries must survive isTooGeneric(): multi-word, not blocklisted.
    const QUERIES = ['ghost whey cinnamon roll', 'quest bar cookie dough', 'core power vanilla'];

    it('passes a defined budget, identical by reference, to every mapper call', async () => {
        await warmNames({ queries: QUERIES, concurrency: 1 });

        expect(mockMapIngredientWithFallback).toHaveBeenCalledTimes(QUERIES.length);
        const budgets = mockMapIngredientWithFallback.mock.calls
            .map((c) => (c[1] as MapperOptions).aiNutritionBudget);
        for (const b of budgets) {
            expect(b).toBeDefined();
            expect(b).toBe(budgets[0]); // IDENTITY — not toEqual
        }
    });

    it('honours an explicit per-run maximum', async () => {
        await warmNames({ queries: QUERIES, concurrency: 1, aiNutritionBudgetMax: 5 });
        const budget = (mockMapIngredientWithFallback.mock.calls[0][1] as MapperOptions).aiNutritionBudget;
        expect(budget).toEqual({ remaining: 5, spent: 0 });
    });

    it('reports what the run actually spent', async () => {
        // The mapper is mocked, so nothing spends — but the number has to come
        // from the shared object, not from a constant.
        mockMapIngredientWithFallback.mockImplementation(async (_q: string, opts: MapperOptions) => {
            opts.aiNutritionBudget!.remaining--;
            opts.aiNutritionBudget!.spent++;
            return null;
        });
        const { nutritionSpent } = await warmNames({ queries: QUERIES, concurrency: 1 });
        expect(nutritionSpent).toBe(QUERIES.length);
    });
});
