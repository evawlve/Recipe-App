/**
 * HYDRATION gets its OWN LLM allowance, separate from the last-resort budget.
 *
 * The defect this pins: `buildOffResult()` was historically the one
 * `requestAiNutrition()` call site with no cap at all. Putting it on the shared
 * caller-owned budget capped it, but with the wrong pool — and because a
 * non-success outcome there makes `buildOffResult()` `return null`, exhaustion
 * DELETES an OFF candidate that already won retrieval. `/api/nlp/parse` maps
 * items with `Promise.all` over ONE budget, so which record survived (and got
 * written as a sticky `FoodMapping` row at >= 0.85) became a function of the
 * concurrent interleaving rather than of the query.
 *
 * Every `it()` below names, in its own body, the mutation it dies under.
 */

import { buildOffResult, hydrateAndSelectServing } from '../map-ingredient-with-fallback';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import {
    createAiNutritionBudget,
    type AiNutritionBudget,
    type AiNutritionOptions,
} from '../ai-nutrition-backfill';
import {
    AI_NUTRITION_MAX_PER_REQUEST,
    AI_NUTRITION_HYDRATION_MAX_PER_REQUEST,
    AI_NUTRITION_HYDRATION_MAX_PER_BATCH,
} from '../config';
import { prisma } from '../../db';
import { logger } from '../../logger';
import type { ParsedIngredient } from '../../parse/ingredient-line';

const mockRequestAiNutrition = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
            update: jest.fn().mockResolvedValue({}),
        },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    },
}));

jest.mock('../../openfoodfacts/hydrate', () => ({ hydrateOffCandidate: jest.fn() }));

// requestAiNutrition is intercepted; createAiNutritionBudget stays REAL, because
// the defaults are exactly what several of these tests measure.
jest.mock('../ai-nutrition-backfill', () => {
    const actual = jest.requireActual('../ai-nutrition-backfill');
    return {
        ...actual,
        requestAiNutrition: (...args: unknown[]) => mockRequestAiNutrition(...args),
    };
});

const AI_SUCCESS = {
    status: 'success' as const,
    foodId: 'ai-1',
    displayName: 'Mystery Bar',
    caloriesPer100g: 400,
    proteinPer100g: 20,
    carbsPer100g: 40,
    fatPer100g: 15,
    fiberPer100g: 5,
    sugarPer100g: 2,
    sodiumMgPer100g: 100,
    saturatedFatPer100g: 3,
    cholesterolMgPer100g: 0,
    confidence: 0.8,
    notes: '',
    model: 'mistralai/mistral-nemo',
    cached: false,
};

function offCandidate() {
    return {
        id: 'off_1',
        source: 'openfoodfacts' as const,
        name: 'Mystery Bar',
        score: 1,
        foodType: 'generic',
        rawData: {},
    } as never;
}

/** No usable per-100g panel → buildOffResult falls through to AI backfill. */
function panelless() {
    return {
        foodId: 'off_1',
        foodName: 'Mystery Bar',
        brandName: null,
        nutrientsPer100g: null,
        servingGrams: 60,
        servingDescription: '1 bar (60 g)',
        servingUnitCount: 1,
        packageQuantity: null,
        packageQuantityUnit: null,
    };
}

const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: null, name: 'mystery bar' };

/** The budget object buildOffResult actually charged. */
function budgetPassedToAi(): AiNutritionBudget {
    return (mockRequestAiNutrition.mock.calls[0][1] as AiNutritionOptions).budget;
}

beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
    (hydrateOffCandidate as jest.Mock).mockResolvedValue(panelless());
    mockRequestAiNutrition.mockResolvedValue(AI_SUCCESS);
});

describe('the hydration allowance is a SEPARATE pool from the last-resort budget', () => {
    it('spends the budget it was handed, and leaves a co-existing last-resort budget untouched', async () => {
        // MUTATION THAT KILLS THIS: revert buildOffResult's 5th parameter to the
        // last-resort budget (pass `aiNutritionBudget` from mapIngredientWithFallback
        // into buildOffResult again). `budgetPassedToAi()` is then the
        // last-resort object and the identity assertion fails.
        const lastResort = createAiNutritionBudget(3);
        const hydration = createAiNutritionBudget(20);

        const result = await buildOffResult(offCandidate(), parsed, 0.9, 'mystery bar', hydration);

        expect(result).not.toBeNull();
        expect(budgetPassedToAi()).toBe(hydration);   // IDENTITY, not shape
        expect(budgetPassedToAi()).not.toBe(lastResort);
        expect(lastResort).toEqual({ remaining: 3, spent: 0 });
    });

    it('an EXHAUSTED last-resort budget does not stop hydration', async () => {
        // MUTATION THAT KILLS THIS: same revert as above. With one shared pool,
        // a request whose other items burned the 3 last-resort calls would find
        // remaining=0 here, requestAiNutrition would return
        // nutrition_budget_exhausted, and buildOffResult would return null —
        // i.e. this candidate's survival would depend on the other items.
        const exhaustedLastResort: AiNutritionBudget = { remaining: 0, spent: 3 };
        const hydration = createAiNutritionBudget(20);

        const result = await buildOffResult(offCandidate(), parsed, 0.9, 'mystery bar', hydration);

        expect(result).not.toBeNull();
        expect(result!.kcal).toBeCloseTo(400 * 0.6, 5);
        expect(budgetPassedToAi().remaining).toBe(20);   // the hydration pool, untouched by the other
        expect(exhaustedLastResort.remaining).toBe(0);
    });

    it('hydrateAndSelectServing forwards its 5th argument to the OFF lane unchanged', async () => {
        // MUTATION THAT KILLS THIS: drop the budget argument from the
        // `buildOffResult(...)` call inside hydrateAndSelectServing (it then
        // mints its own default, which is a different object).
        const hydration = createAiNutritionBudget(7);

        await hydrateAndSelectServing(offCandidate(), parsed, 0.9, 'mystery bar', hydration);

        expect(mockRequestAiNutrition).toHaveBeenCalledTimes(1);
        expect(budgetPassedToAi()).toBe(hydration);
    });
});

describe('the default allowance is the HYDRATION constant, not the last-resort one', () => {
    it('a 4-arg buildOffResult gets AI_NUTRITION_HYDRATION_MAX_PER_REQUEST', async () => {
        // MUTATION THAT KILLS THIS: change buildOffResult's default back to
        // createAiNutritionBudget(AI_NUTRITION_MAX_PER_REQUEST) — remaining
        // becomes 3, not 20.
        await buildOffResult(offCandidate(), parsed, 0.9, 'mystery bar');

        expect(budgetPassedToAi().remaining).toBe(AI_NUTRITION_HYDRATION_MAX_PER_REQUEST);
    });

    it('the two constants are actually distinct, and hydration is the generous one', () => {
        // Guards the config itself: if someone "tidies" the hydration constants
        // to reuse the last-resort defaults, the separation above becomes a
        // rename with no behaviour behind it.
        expect(AI_NUTRITION_HYDRATION_MAX_PER_REQUEST).toBeGreaterThan(AI_NUTRITION_MAX_PER_REQUEST);
        expect(AI_NUTRITION_HYDRATION_MAX_PER_BATCH)
            .toBeGreaterThan(AI_NUTRITION_HYDRATION_MAX_PER_REQUEST);
    });
});

describe('cache lookup still sits ABOVE the cap on the hydration pool too', () => {
    it('a zero hydration allowance still bills an exact-match AI cache hit', async () => {
        // Runs the REAL requestAiNutrition so the ordering inside it is what is
        // under test, reached through the hydration path.
        // MUTATION THAT KILLS THIS: move the budget check above
        // getCachedAiNutrition() in requestAiNutrition — the call then returns
        // nutrition_budget_exhausted and buildOffResult returns null.
        const actual = jest.requireActual('../ai-nutrition-backfill');
        mockRequestAiNutrition.mockImplementation(actual.requestAiNutrition);
        (prisma.aiGeneratedFood.findUnique as jest.Mock).mockResolvedValue({
            id: 'ai-cached', displayName: 'Mystery Bar',
            caloriesPer100g: 400, proteinPer100g: 20, carbsPer100g: 40, fatPer100g: 15,
            fiberPer100g: 5, sugarPer100g: 2, sodiumMgPer100g: 100,
            saturatedFatPer100g: 3, cholesterolMgPer100g: 0,
            aiConfidence: 0.8, aiNotes: null, aiModel: 'openai/gpt-4o-mini',
        });

        const starved: AiNutritionBudget = { remaining: 0, spent: 20 };
        const result = await buildOffResult(offCandidate(), parsed, 0.9, 'mystery bar', starved);

        expect(result).not.toBeNull();
        expect(result!.kcal).toBeCloseTo(400 * 0.6, 5);
        expect(starved).toEqual({ remaining: 0, spent: 20 });   // a hit costs nothing
    });
});

describe('the residual — hydration exhaustion is a DELETION, and it is observable', () => {
    it('audits a distinct event when the deletion is caused by the budget, not by the record', async () => {
        // MUTATION THAT KILLS THIS: delete the
        // `off.build_result.hydration_budget_exhausted` audit branch. Without it
        // a budget-caused deletion is indistinguishable in the logs from
        // "this OFF record has no usable nutrition", so nobody can tell whether
        // the allowance needs raising.
        const auditSpy = jest.spyOn(logger, 'audit').mockImplementation(() => {});
        mockRequestAiNutrition.mockResolvedValue({
            status: 'error', reason: 'nutrition_budget_exhausted',
        });

        const result = await buildOffResult(
            offCandidate(), parsed, 0.9, 'mystery bar', { remaining: 0, spent: 20 },
        );

        expect(result).toBeNull();
        expect(auditSpy).toHaveBeenCalledWith(
            'off.build_result.hydration_budget_exhausted',
            expect.objectContaining({ foodId: 'off_1', spent: 20 }),
        );
        auditSpy.mockRestore();
    });

    it('does NOT audit that event for an AI failure the record itself caused', async () => {
        // Keeps the counter meaningful: if every AI failure audited this, the
        // signal "raise the allowance" would fire on validation failures and
        // provider outages too.
        const auditSpy = jest.spyOn(logger, 'audit').mockImplementation(() => {});
        mockRequestAiNutrition.mockResolvedValue({
            status: 'error', reason: 'validation_failed: atwater',
        });

        const result = await buildOffResult(
            offCandidate(), parsed, 0.9, 'mystery bar', createAiNutritionBudget(20),
        );

        expect(result).toBeNull();
        expect(auditSpy).not.toHaveBeenCalledWith(
            'off.build_result.hydration_budget_exhausted', expect.anything(),
        );
        auditSpy.mockRestore();
    });
});

describe('MIGRATION GUARD — every hydration call site inside the mapper uses the hydration pool', () => {
    /**
     * A structural guard, deliberately. The wiring under test is ten internal
     * `hydrateAndSelectServing(...)` calls and two self-recursive
     * `mapIngredientWithFallback(...)` calls inside ONE module; a local call
     * does not go through the module's export object, so it cannot be spied on,
     * and driving the real mapper end to end would need the whole retrieval
     * stack mocked. Reverting any single call site to `aiNutritionBudget` is
     * exactly the regression that reintroduces the shared pool, and it is
     * invisible to the typechecker because both parameters have the same type.
     */
    // Stage 1a moved the hydration lane into serving/hydration-lane.ts; scan
    // BOTH files so a call site added inside the lane (e.g. a new retry that
    // passes the wrong budget) stays visible to this guard.
    const SRC = (require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'map-ingredient-with-fallback.ts'), 'utf8',
    ) as string) + (require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'serving', 'hydration-lane.ts'), 'utf8',
    ) as string);

    /** Argument text of each `name(...)` invocation, balanced-paren scanned. */
    function callArgs(src: string, name: string): string[] {
        const out: string[] = [];
        const needle = `${name}(`;
        for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) {
            // Skip the declaration itself (`function name(` / `async function name(`).
            if (/function\s+$/.test(src.slice(Math.max(0, i - 20), i))) continue;
            let depth = 0;
            let j = i + needle.length - 1;
            for (; j < src.length; j++) {
                if (src[j] === '(') depth++;
                else if (src[j] === ')') { depth--; if (depth === 0) break; }
            }
            out.push(src.slice(i + needle.length, j));
        }
        return out;
    }

    it('no hydrateAndSelectServing call passes the last-resort budget', () => {
        const calls = callArgs(SRC, 'hydrateAndSelectServing');
        expect(calls.length).toBeGreaterThanOrEqual(10);   // 10 wired sites today
        const wrong = calls.filter(a => a.includes('aiNutritionBudget'));
        expect(wrong).toEqual([]);
        // ...and every site that passes a budget at all passes the hydration one.
        expect(calls.filter(a => a.includes('aiHydrationBudget')).length).toBe(calls.length);
    });

    /**
     * The enumeration of budget-constructing entry points, from the code:
     *   grep -rln 'createAiNutritionBudget' src scripts --include='*.ts' | grep -v __tests__
     * Every one of them must now construct BOTH allowances. `scripts/**` is
     * excluded from tsconfig.json and both mapper options are optional, so
     * neither the typechecker nor lint can notice an entry point that quietly
     * goes back to one pool — this list is the only thing that does.
     */
    const ENTRY_POINTS = [
        'src/app/api/nlp/parse/route.ts',
        'src/lib/nutrition/auto-map.ts',
        'scripts/warm-names.ts',
        'scripts/pilot-batch-import.ts',
        'scripts/golden-diff-eval.ts',
        'scripts/eval/winner-diff.ts',
        'scripts/eval/probe-bare-serving.ts',
    ];

    it.each(ENTRY_POINTS)('%s constructs a hydration budget and passes it on every mapper call', (rel) => {
        // MUTATION THAT KILLS THIS: drop `aiHydrationBudget: ...` from any one
        // of these call sites (e.g. the /api/nlp/parse route) — the counts stop
        // matching and that file is named in the failure.
        const fs = require('node:fs');
        const path = require('node:path');
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', rel), 'utf8',
        ) as string;

        const lastResort = (src.match(/aiNutritionBudget:/g) ?? []).length;
        const hydration = (src.match(/aiHydrationBudget:/g) ?? []).length;
        expect(lastResort).toBeGreaterThan(0);
        expect(hydration).toBe(lastResort);
        expect(src).toMatch(/AI_NUTRITION_HYDRATION_MAX_PER_(REQUEST|BATCH)/);
    });

    it('both self-recursive mapIngredientWithFallback calls forward BOTH budgets explicitly', () => {
        // `...options` is not enough: the destructure above may have minted a
        // budget the caller never supplied, so a spread-only recursion spends a
        // fresh allowance per level. That trap is already documented for the
        // last-resort budget; the hydration one inherits it.
        const recursive = callArgs(SRC, 'mapIngredientWithFallback')
            .filter(a => a.includes('_skipFallback: true'));
        expect(recursive.length).toBe(2);
        for (const args of recursive) {
            expect(args).toContain('aiNutritionBudget,');
            expect(args).toContain('aiHydrationBudget,');
        }
    });
});
