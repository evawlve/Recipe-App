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

type Budget = { remaining: number; spent: number };
type MapperOptions = { aiNutritionBudget?: Budget; aiHydrationBudget?: Budget };

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

/**
 * The SECOND allowance. warm-names is the writer that turns a query into a
 * sticky FoodMapping row, so it is the entry point where a shared pool does the
 * most damage: exhausting hydration deletes an already-won OFF candidate and
 * the run caches a different record instead.
 */
describe('warmNames constructs a SEPARATE hydration budget', () => {
    const QUERIES = ['ghost whey cinnamon roll', 'quest bar cookie dough', 'core power vanilla'];

    it('passes one shared hydration budget, and it is NOT the last-resort object', async () => {
        // MUTATION THAT KILLS THIS: pass `nutritionBudget` for both options in
        // warmNames (the pre-split behaviour) — `not.toBe` fails.
        await warmNames({ queries: QUERIES, concurrency: 1 });

        const opts = mockMapIngredientWithFallback.mock.calls.map((c) => c[1] as MapperOptions);
        for (const o of opts) {
            expect(o.aiHydrationBudget).toBeDefined();
            expect(o.aiHydrationBudget).toBe(opts[0].aiHydrationBudget);   // IDENTITY across queries
            expect(o.aiHydrationBudget).not.toBe(o.aiNutritionBudget);     // ...and a DIFFERENT pool
        }
    });

    it('honours an explicit per-run hydration maximum, independent of the other one', async () => {
        // MUTATION THAT KILLS THIS: wire aiHydrationBudgetMax to the
        // last-resort size (or drop the option) — remaining is then 5, not 40.
        await warmNames({
            queries: QUERIES, concurrency: 1,
            aiNutritionBudgetMax: 5, aiHydrationBudgetMax: 40,
        });
        const o = mockMapIngredientWithFallback.mock.calls[0][1] as MapperOptions;
        expect(o.aiNutritionBudget).toEqual({ remaining: 5, spent: 0 });
        expect(o.aiHydrationBudget).toEqual({ remaining: 40, spent: 0 });
    });

    it('reports hydration spend separately from last-resort spend', async () => {
        // MUTATION THAT KILLS THIS: report `nutritionBudget.spent` for both —
        // hydrationSpent would come back 0.
        mockMapIngredientWithFallback.mockImplementation(async (_q: string, opts: MapperOptions) => {
            opts.aiHydrationBudget!.remaining--;
            opts.aiHydrationBudget!.spent++;
            return null;
        });
        const { nutritionSpent, hydrationSpent } = await warmNames({ queries: QUERIES, concurrency: 1 });
        expect(hydrationSpent).toBe(QUERIES.length);
        expect(nutritionSpent).toBe(0);
    });
});
