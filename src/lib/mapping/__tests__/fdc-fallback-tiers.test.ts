/**
 * FDC FALLBACK-ARM ATTRIBUTION (Lane C, 2026-08-17).
 *
 * `buildFdcResult()` initialises `servingTier = 'flat_100g_default'` and every
 * RESOLVING branch overwrote it. The FALLBACK arms did not, so five structurally
 * different events reached `MappingEventLog` under one string:
 *
 *   size-qualifier estimate failed        |
 *   size-qualifier answered, key missing  |
 *   high-count ladder exhausted           |  all `flat_100g_default`
 *   low-count size estimate failed        |
 *   ambiguous-unit estimate failed        |
 *   a unit no branch handles              |
 *
 * Each now stamps its own name. This file pins two things:
 *   1. that each arm is REACHABLE and stamps what it claims (behaviour), and
 *   2. that none of the new names is a member of any of the three frozen
 *      predicate sets in ../serving-ai-tiers (the trap).
 *
 * WHY (2) IS THE LOAD-BEARING HALF. `servingTier` never reaches the wire
 * directly, but `isSyntheticGramsTier()` gates the `portionEstimated` field on
 * `/api/nlp/parse` and `isReplayNondeterministicTier()` drives winner-diff's
 * classifier. Adding a name to either set from here would turn an
 * instruments-only change into a silent wire change or a silently-widened gate
 * blind spot. Whether some of these arms SHOULD badge is a separate question
 * this file deliberately does not answer — it only asserts that today's answer
 * is "no", so a later "yes" has to be written down.
 */

import {
    servingAiCallForTier,
    isReplayNondeterministicTier,
    isSyntheticGramsTier,
    isBorrowedOrDefaultedTier,
    SERVING_AI_TIERS,
    REPLAY_NONDETERMINISTIC_SERVING_TIERS,
    SYNTHETIC_GRAMS_SERVING_TIERS,
    BORROWED_OR_DEFAULTED_SERVING_TIERS,
} from '../serving-ai-tiers';
import { hydrateAndSelectServing } from '../map-ingredient-with-fallback';
import { getOrCreateFdcSizeServings } from '../../usda/fdc-ai-backfill';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import { estimateAmbiguousServing } from '../../ai/ambiguous-serving-estimator';
import type { ParsedIngredient } from '../../parse/ingredient-line';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcServing: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
        },
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    },
}));

jest.mock('../../usda/fdc-ai-backfill', () => {
    const actual = jest.requireActual('../../usda/fdc-ai-backfill');
    return {
        ...actual,
        getOrCreateFdcSizeServings: jest.fn().mockResolvedValue(null),
        insertFdcAiServing: jest.fn().mockResolvedValue({ success: false, reason: 'mocked-off' }),
    };
});

jest.mock('../ambiguous-unit-backfill', () => {
    const actual = jest.requireActual('../ambiguous-unit-backfill');
    return {
        ...actual,
        getOrCreateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'error', error: 'mocked-off' }),
    };
});

// `isAmbiguousUnit` / `isEstimableUnknownUnit` / `getBareQueryDefault` stay REAL —
// they are the branch selectors this file is asserting about, and stubbing them
// would let the tests pass against a branch table that no longer exists.
jest.mock('../../ai/ambiguous-serving-estimator', () => {
    const actual = jest.requireActual('../../ai/ambiguous-serving-estimator');
    return {
        ...actual,
        estimateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'error', error: 'mocked-off' }),
    };
});

const mockedSizes = getOrCreateFdcSizeServings as jest.Mock;
const mockedAmbiguous = getOrCreateAmbiguousServing as jest.Mock;
const mockedEstimate = estimateAmbiguousServing as jest.Mock;

/**
 * A deliberately boring FDC candidate: no brand (so the high-count arm's
 * branded-goods skip does not fire), and a name that matches no
 * UNIT_HEURISTIC_DEFAULTS pattern and no getBareQueryDefault() category — both
 * of those run OUTSIDE the branch table and would mask the arm under test.
 */
function candidate(name = 'Yam, raw') {
    return {
        id: 'fdc_170067',
        source: 'fdc' as const,
        name,
        score: 1,
        foodType: 'foundation',
        nutrition: { kcal: 118, protein: 1.5, carbs: 27.9, fat: 0.17, per100g: true },
        rawData: {},
    } as never;
}

function parsed(p: Partial<ParsedIngredient>): ParsedIngredient {
    return { qty: 1, multiplier: 1, unit: undefined, name: 'yam', ...p } as ParsedIngredient;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockedSizes.mockResolvedValue(null);
    mockedAmbiguous.mockResolvedValue({ status: 'error', error: 'mocked-off' });
    mockedEstimate.mockResolvedValue({ status: 'error', error: 'mocked-off' });
});

/** Every tier name this PR introduces. The predicate block below iterates it. */
const NEW_FALLBACK_TIERS = [
    'fdc_size_unresolved',
    'fdc_size_key_missing',
    'fdc_piece_unresolved',
    'fdc_size_estimate_unresolved',
    'count_unit_unresolved',
    'fdc_unknown_unit',
] as const;

describe('the fallback arms each stamp their own tier', () => {
    // MUTATION: delete `servingTier = 'fdc_size_unresolved'` from the size-qualifier
    // else. This goes red with `flat_100g_default`.
    it('branch 3: the size estimator failed → fdc_size_unresolved', async () => {
        mockedSizes.mockResolvedValue(null);

        const r = await hydrateAndSelectServing(
            candidate(), parsed({ qty: 2, unit: 'large', name: 'yams' }), 0.9, '2 large yams',
        );

        expect(r?.servingTier).toBe('fdc_size_unresolved');
        expect(r?.grams).toBe(200);
    });

    /**
     * The arm nobody knew existed. `isSizeQualifier()` accepts ten spellings;
     * `getOrCreateFdcSizeServings()` returns a map keyed by nine. `extralarge` is
     * in the first and absent from the second, so a SUCCESSFUL estimate still
     * billed `qty * (undefined ?? 100)` under the resolving tier's own name.
     *
     * MUTATION: collapse the two arms back into `grams = qty * (gramsPerUnit ?? 100)`
     * with a single `fdc_size_qualifier` stamp. Red.
     */
    it('branch 3: the estimator answered but not for this size → fdc_size_key_missing', async () => {
        mockedSizes.mockResolvedValue({ small: 70, medium: 100, large: 140, xl: 160 });

        const r = await hydrateAndSelectServing(
            candidate(), parsed({ qty: 1, unit: 'extralarge', name: 'yam' }), 0.9, '1 extralarge yam',
        );

        expect(r?.servingTier).toBe('fdc_size_key_missing');
        expect(r?.grams).toBe(100);
        // The pre-existing "undefinedg each" label is preserved on purpose: this PR
        // claims zero wire change and servingDescription is on the wire.
        expect(r?.servingDescription).toBe('1 extralarge (undefinedg each)');
    });

    it('branch 3: a size the estimator DOES answer still stamps fdc_size_qualifier', async () => {
        // The control. Splitting the failure arms must not move the resolving one.
        mockedSizes.mockResolvedValue({ small: 70, medium: 100, large: 140 });

        const r = await hydrateAndSelectServing(
            candidate(), parsed({ qty: 2, unit: 'large', name: 'yams' }), 0.9, '2 large yams',
        );

        expect(r?.servingTier).toBe('fdc_size_qualifier');
        expect(r?.grams).toBe(280);
    });

    // MUTATION: delete the stamp in the high-count `if (!resolved)` arm. Red.
    it('branch 4 HIGH COUNT: sub-piece, piece-AI and medium all failed → fdc_piece_unresolved', async () => {
        const r = await hydrateAndSelectServing(
            candidate(), parsed({ qty: 5, unit: undefined, name: 'yams' }), 0.9, '5 yams',
        );

        expect(r?.servingTier).toBe('fdc_piece_unresolved');
        expect(r?.grams).toBe(500);
    });

    it('branch 4 HIGH COUNT is also reached by an explicit count unit at qty 1', async () => {
        const r = await hydrateAndSelectServing(
            candidate('Ham, sliced'), parsed({ qty: 1, unit: 'slice', name: 'ham' }), 0.9, '1 slice ham',
        );

        expect(r?.servingTier).toBe('fdc_piece_unresolved');
    });

    // MUTATION: delete the stamp in the low-count else. Red.
    it('branch 4 LOW COUNT: the size estimate failed → fdc_size_estimate_unresolved', async () => {
        const r = await hydrateAndSelectServing(
            candidate(), parsed({ qty: 2, unit: undefined, name: 'yams' }), 0.9, '2 yams',
        );

        expect(r?.servingTier).toBe('fdc_size_estimate_unresolved');
        expect(r?.grams).toBe(200);
    });

    it('the two count arms are DISTINGUISHABLE, which is the whole point', async () => {
        const low = await hydrateAndSelectServing(
            candidate(), parsed({ qty: 2, name: 'yams' }), 0.9, '2 yams',
        );
        const high = await hydrateAndSelectServing(
            candidate(), parsed({ qty: 5, name: 'yams' }), 0.9, '5 yams',
        );

        // Same food, same failure mode, same 100 g/unit — different ladders.
        expect(low?.servingTier).not.toBe(high?.servingTier);
        expect(low?.servingTier).toBe('fdc_size_estimate_unresolved');
        expect(high?.servingTier).toBe('fdc_piece_unresolved');
    });

    // MUTATION: delete the stamp in the ambiguous-unit else. Red.
    it('branch 5: the ambiguous-unit estimator failed → count_unit_unresolved', async () => {
        mockedAmbiguous.mockResolvedValue({ status: 'error', error: 'mocked-off' });

        const r = await hydrateAndSelectServing(
            candidate('Yogurt, plain'), parsed({ qty: 1, unit: 'container', name: 'yogurt' }), 0.9, '1 container yogurt',
        );

        expect(r?.servingTier).toBe('count_unit_unresolved');
        expect(r?.grams).toBe(100);
    });

    it('branch 5 still stamps count_unit_ai / count_unit_cached when it resolves', async () => {
        mockedAmbiguous.mockResolvedValue({ status: 'success', grams: 170 });
        const ai = await hydrateAndSelectServing(
            candidate('Yogurt, plain'), parsed({ qty: 1, unit: 'container', name: 'yogurt' }), 0.9, '1 container yogurt',
        );
        expect(ai?.servingTier).toBe('count_unit_ai');

        mockedAmbiguous.mockResolvedValue({ status: 'cached', grams: 170 });
        const cached = await hydrateAndSelectServing(
            candidate('Yogurt, plain'), parsed({ qty: 1, unit: 'container', name: 'yogurt' }), 0.9, '1 container yogurt',
        );
        expect(cached?.servingTier).toBe('count_unit_cached');
    });

    /**
     * THE TERMINAL ARM, AND ITS COMMENT WAS WRONG ABOUT ITSELF.
     *
     * It read "Unknown units (slices, pieces, etc.)" and neither example can
     * arrive: `slice`/`piece` are in branch 4's list. What actually lands here is
     * the DETERMINISTIC_UNITS set minus the spellings branches 1 and 2 enumerate —
     * `isEstimableUnknownUnit()` returns false for a deterministic unit, so
     * `isAmbiguousUnit()` is false and branch 5 declines it too. 24 spellings,
     * every one a unit the system says has an exact conversion, all billed at a
     * flat 100 g: `l` `liter(s)` `litre(s)` `milliliter(s)` `millilitre(s)`
     * `pint(s)` `quart(s)` `gallon(s)` `mg` `milligram(s)` `kilograms`
     * `fluid ounces` `serving(s)` `portion(s)`.
     *
     * Naming the tier does not fix the billing. It makes the billing countable,
     * which is the only reason a fix can be sized.
     */
    it('terminal arm: a deterministic unit no branch converts → fdc_unknown_unit', async () => {
        const r = await hydrateAndSelectServing(
            candidate('Milk, whole'), parsed({ qty: 1, unit: 'liter', name: 'milk' }), 0.9, '1 liter milk',
        );

        expect(r?.servingTier).toBe('fdc_unknown_unit');
        expect(r?.grams).toBe(100);   // a litre of milk, billed as 100 g
    });

    it('terminal arm: `kilograms` and `milliliters` land here too — branch 1/2 list singulars', async () => {
        const kg = await hydrateAndSelectServing(
            candidate(), parsed({ qty: 2, unit: 'kilograms', name: 'yam' }), 0.9, '2 kilograms yam',
        );
        expect(kg?.servingTier).toBe('fdc_unknown_unit');

        // The control that keeps this honest: the spelling branch 1 DOES list.
        const kgSingular = await hydrateAndSelectServing(
            candidate(), parsed({ qty: 2, unit: 'kilogram', name: 'yam' }), 0.9, '2 kilogram yam',
        );
        expect(kgSingular?.servingTier).toBe('weight_unit');
        expect(kgSingular?.grams).toBe(2000);
    });
});

/**
 * THE TRAP. `servingTier` is read by three frozen predicates, two of which have
 * consequences outside this module: `portionEstimated` on the parse wire and the
 * winner-diff classifier. A new tier must be absent from all three, and that has
 * to be asserted rather than assumed — the whole point of an allowlist is that a
 * name it has never heard of returns the safe default, and the only way to know
 * the default IS safe for these six is to check.
 */
describe('the new tiers are absent from all three frozen predicate sets', () => {
    // MUTATION: add any NEW_FALLBACK_TIERS member to SYNTHETIC_GRAMS_SERVING_TIERS.
    // That would start emitting `portionEstimated: true` on the parse wire from a
    // change whose PR body says it touches no wire field.
    it.each(NEW_FALLBACK_TIERS)('%s does not emit portionEstimated', (tier) => {
        expect(isSyntheticGramsTier(tier)).toBe(false);
        expect(SYNTHETIC_GRAMS_SERVING_TIERS).not.toContain(tier);
    });

    // MUTATION: add any member to REPLAY_NONDETERMINISTIC_SERVING_TIERS. winner-diff
    // and correctness-screen would then bucket these rows `unjudged` and drop them
    // from the noise floor — the instrument going quiet, which this repo treats as
    // the expensive failure direction.
    it.each(NEW_FALLBACK_TIERS)('%s stays judgeable by the offline instruments', (tier) => {
        expect(isReplayNondeterministicTier(tier)).toBe(false);
        expect(REPLAY_NONDETERMINISTIC_SERVING_TIERS).not.toContain(tier);
    });

    // MUTATION: add any member to SERVING_AI_TIERS. Every one of these arms is
    // reached BECAUSE an estimator declined, so counting it as a maybe-called
    // model would double-count the sibling tier that already carries that call.
    it.each(NEW_FALLBACK_TIERS)('%s bills no model call', (tier) => {
        expect(servingAiCallForTier(tier)).toEqual({ called: false });
        expect(Object.keys(SERVING_AI_TIERS)).not.toContain(tier);
    });

    /**
     * The sets' own invariant, re-asserted from this side: `SERVING_AI_TIERS` is a
     * subset of `REPLAY_NONDETERMINISTIC_SERVING_TIERS`. If someone adds one of
     * these names to the billing list only, that invariant breaks here as well as
     * in serving-ai-tiers.test.ts — two independent tripwires on the same mistake.
     */
    it('the billing ⊆ nondeterminism invariant still holds after the additions', () => {
        for (const tier of Object.keys(SERVING_AI_TIERS)) {
            expect(isReplayNondeterministicTier(tier)).toBe(true);
        }
    });

    /**
     * THE FOURTH SET, added by #330 while this branch was open — and this is not
     * bookkeeping. #330's own header pins `flat_100g_default` as a deliberate
     * NON-member: it is an "honest floor", a hardcoded constant rather than
     * another product's data or a generic table. This PR makes that tier
     * unreachable from `buildFdcResult` and replaces it with six successors, so
     * the pin's FDC coverage would silently evaporate unless the successors carry
     * it. They are honest floors for exactly the same reason.
     *
     * MUTATION: add any member to BORROWED_OR_DEFAULTED_SERVING_TIERS. Red.
     */
    it.each(NEW_FALLBACK_TIERS)('%s inherits flat_100g_default\'s honest-floor pin', (tier) => {
        expect(isBorrowedOrDefaultedTier(tier)).toBe(false);
        expect(BORROWED_OR_DEFAULTED_SERVING_TIERS).not.toContain(tier);
    });

    it('and the pin they inherit is really there on the tier they replace', () => {
        // If #330 ever makes `flat_100g_default` a member, the reasoning above
        // stops holding and these six need re-deciding rather than re-asserting.
        expect(isBorrowedOrDefaultedTier('flat_100g_default')).toBe(false);
    });

    it('has six distinct names and none collides with an existing tier', () => {
        expect(new Set(NEW_FALLBACK_TIERS).size).toBe(NEW_FALLBACK_TIERS.length);
        const existing = new Set([
            ...Object.keys(SERVING_AI_TIERS),
            ...REPLAY_NONDETERMINISTIC_SERVING_TIERS,
            ...SYNTHETIC_GRAMS_SERVING_TIERS,
            ...BORROWED_OR_DEFAULTED_SERVING_TIERS,
            'flat_100g_default', 'weight_unit', 'volume_unit', 'fdc_label_volume',
            'fdc_volume_cached', 'fdc_sub_piece_default', 'bare_query_default',
        ]);
        for (const tier of NEW_FALLBACK_TIERS) expect(existing.has(tier)).toBe(false);
    });
});
