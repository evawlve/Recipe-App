/**
 * `extralarge` WAS ACCEPTED AND NEVER ANSWERED (2026-08-17).
 *
 * `isSizeQualifier()` gated on a ten-spelling Set; `getOrCreateFdcSizeServings()`
 * returned a hand-written literal keyed by nine of them plus `whole`. `extralarge`
 * was in the first and absent from the second, so `buildFdcResult()` branch 3
 * (serving/hydration-lane.ts) entered the size arm on a SUCCESSFUL estimate, read
 * `sizes['extralarge']` as `undefined`, and billed a flat 100 g — while `xl`, the
 * same size by the same ratio, billed 160.
 *
 * WHAT THIS FILE MOCKS, AND WHY IT MATTERS.
 * The two existing FDC size suites (fdc-fallback-tiers, fdc-own-size-serving) both
 * mock `getOrCreateFdcSizeServings` itself and hand the caller a literal map. That
 * is right for what they assert — which ARM fires — and structurally incapable of
 * seeing this defect, because the map under test is the one the test wrote. So this
 * file mocks one layer lower, at `estimateAmbiguousServing()` (the USDA-then-LLM
 * boundary), and lets the REAL producer build the REAL map. The subject is the
 * vocabulary the shipped code answers, not a vocabulary a fixture declares.
 *
 * PRE-FIX TRANSCRIPT (measured 2026-08-17, fix stashed): 5 failed, 2 passed.
 * The three BEHAVIOURAL reds are the load-bearing ones — `extralarge` bills 100 g
 * under `fdc_size_key_missing`, disagrees with `xl` at 160, and renders
 * `1 extralarge (undefinedg each)`. The producer invariant reds too, but partly for
 * an import reason (`SIZE_QUALIFIERS` is unexported pre-fix), so it is the weaker
 * receipt of the four; the strict-equality control reds on exactly one diff line,
 * `- "extralarge": 160`, which is itself the proof that the other ten entries did
 * not move.
 *
 * The two that pass on BOTH trees are deliberate: `large` still 140 g under
 * `fdc_size_qualifier` (without it a red could just mean the harness stopped
 * reaching branch 3 at all) and `jumbo` still absent.
 *
 * NOT IN SCOPE: the `undefinedg each` string that the sibling `fdc_size_key_missing`
 * arm still renders. That template is untouched here. What this fix changes is that
 * an `extralarge` request no longer REACHES that arm.
 */

import { hydrateAndSelectServing } from '../map-ingredient-with-fallback';
import {
    getOrCreateFdcSizeServings,
    isSizeQualifier,
    SIZE_QUALIFIERS,
} from '../../usda/fdc-ai-backfill';
import { estimateAmbiguousServing } from '../../ai/ambiguous-serving-estimator';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import type { ParsedIngredient } from '../../parse/ingredient-line';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcServing: {
            // EMPTY ON PURPOSE. #333's rung (0) `findOwnFdcSizeServing()` reads this
            // table and its SIZE_SERVING_STEMS already carries `extralarge`, so a
            // record owning an anchored `extra large` row masks the defect entirely.
            // The population that still has it is records with no such row: this one.
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

// The ONE boundary this file stubs. `getOrCreateFdcSizeServings()` stays REAL.
jest.mock('../../ai/ambiguous-serving-estimator', () => {
    const actual = jest.requireActual('../../ai/ambiguous-serving-estimator');
    return { ...actual, estimateAmbiguousServing: jest.fn() };
});

jest.mock('../ambiguous-unit-backfill', () => {
    const actual = jest.requireActual('../ambiguous-unit-backfill');
    return { ...actual, getOrCreateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'error' }) };
});

const mockedEstimate = estimateAmbiguousServing as jest.Mock;
const mockedAmbiguous = getOrCreateAmbiguousServing as jest.Mock;

/** 100 g medium, so every ratio reads as its own percentage: xl = 160. */
const MEDIUM_GRAMS = 100;

beforeEach(() => {
    jest.clearAllMocks();
    mockedEstimate.mockResolvedValue({
        status: 'success',
        estimatedGrams: MEDIUM_GRAMS,
        confidence: 0.9,
        reasoning: 'test fixture',
    });
    mockedAmbiguous.mockResolvedValue({ status: 'error' });
});

/**
 * A deliberately boring unbranded FDC candidate — same shape the fallback-tier
 * suite uses, for the same reason: a name matching no UNIT_HEURISTIC_DEFAULTS
 * pattern and no getBareQueryDefault() category, both of which run OUTSIDE the
 * branch table and would mask the arm under test.
 */
function candidate() {
    return {
        id: 'fdc_170067',
        source: 'fdc' as const,
        name: 'Yam, raw',
        score: 1,
        foodType: 'foundation',
        nutrition: { kcal: 118, protein: 1.5, carbs: 27.9, fat: 0.17, per100g: true },
        rawData: {},
    } as never;
}

function parsed(p: Partial<ParsedIngredient>): ParsedIngredient {
    return { qty: 1, multiplier: 1, unit: undefined, name: 'yam', ...p } as ParsedIngredient;
}

const bill = (unit: string) =>
    hydrateAndSelectServing(candidate(), parsed({ qty: 1, unit, name: 'yam' }), 0.9, `1 ${unit} yam`);

describe('an extralarge request is billed the extra-large weight', () => {
    /**
     * THE SYMPTOM. Not "the map has a key" — the number the user is billed.
     * Pre-fix: fdc_size_key_missing / 100 g. That is a 60 g under-bill on a
     * request the pipeline had already successfully estimated.
     */
    it('bills 160 g, not the flat 100 g floor', async () => {
        const r = await bill('extralarge');

        expect(r?.grams).toBe(160);
        expect(r?.grams).not.toBe(100);
        expect(r?.servingTier).toBe('fdc_size_qualifier');
        expect(r?.servingTier).not.toBe('fdc_size_key_missing');
    });

    /**
     * The same size under three spellings must cost the same. This is the
     * user-facing statement of the defect: `xl` worked, `extra-large` worked,
     * and the concatenated spelling silently did not.
     */
    it('agrees with its two synonyms xl and extra-large', async () => {
        const [xl, hyphen, concat] = await Promise.all([
            bill('xl'), bill('extra-large'), bill('extralarge'),
        ]);

        expect(xl?.grams).toBe(160);
        expect(hyphen?.grams).toBe(160);
        expect(concat?.grams).toBe(xl?.grams);
        expect(concat?.grams).toBe(hyphen?.grams);
        expect(concat?.servingTier).toBe(xl?.servingTier);
    });

    /**
     * The label is a CONSEQUENCE of the grams being defined, not an edit: the
     * template `${qty} ${unit} (${gramsPerUnit}g each)` is untouched. It is
     * pinned because `servingDescription` is on the wire — /api/nlp/parse hands
     * it to resolveFoodDetails() as `matchedServingDescription` — so this fix
     * does change a wire field for this population, and that should be asserted
     * where a reader will find it rather than discovered on a device.
     */
    it('no longer renders the literal string "undefinedg each" to the user', async () => {
        const r = await bill('extralarge');

        expect(r?.servingDescription).not.toContain('undefined');
        expect(r?.servingDescription).toBe('1 extralarge (160g each)');
    });

    /**
     * CONTROL, green on both trees. If the harness stopped reaching branch 3 —
     * a renamed tier, a new rung above it, a candidate the branch table routes
     * elsewhere — the tests above would go red for a reason that has nothing to
     * do with `extralarge`, and this pins that difference.
     */
    it('control: `large` still bills 140 g under the same tier', async () => {
        const r = await bill('large');

        expect(r?.grams).toBe(140);
        expect(r?.servingTier).toBe('fdc_size_qualifier');
    });
});

describe('the producer answers every spelling the gate accepts', () => {
    /**
     * THE INVARIANT THE DEFECT VIOLATED, asserted against the exported set rather
     * than a restated list — a restated list is exactly the second copy whose
     * drift caused this.
     */
    it('every SIZE_QUALIFIERS member is a key of the returned map', async () => {
        const sizes = await getOrCreateFdcSizeServings(170067, 'Yam, raw');

        expect(sizes).not.toBeNull();
        for (const spelling of SIZE_QUALIFIERS) {
            expect(isSizeQualifier(spelling)).toBe(true);
            expect(sizes).toHaveProperty(spelling);
            expect(typeof sizes![spelling]).toBe('number');
            expect(sizes![spelling]).toBeGreaterThan(0);
        }
    });

    /**
     * THE REFACTOR CONTROL. The literal became a derived table, so the question
     * "did any of the nine that already worked move?" has to be answered exactly
     * rather than by inspection. Pre-fix this reds with a ONE-LINE diff —
     * `- "extralarge": 160` — and that single line is the receipt: everything
     * else, `whole` included, is byte-identical either side.
     */
    it('control: the nine pre-existing ratios and `whole` are unmoved', async () => {
        const sizes = await getOrCreateFdcSizeServings(170067, 'Yam, raw');

        expect(sizes).toEqual({
            mini: 55,
            small: 70, sm: 70,
            medium: 100, med: 100,
            large: 140, lg: 140,
            'extra-large': 160, xl: 160, extralarge: 160,
            whole: 100,
        });
    });

    it('a size the producer does not answer is still absent — the key-missing arm stays reachable', async () => {
        const sizes = await getOrCreateFdcSizeServings(170067, 'Yam, raw');

        // `jumbo` is not a qualifier, so branch 3 never asks for it; the point is
        // that the map is a closed vocabulary, not that it answers anything asked.
        expect(isSizeQualifier('jumbo')).toBe(false);
        expect(sizes).not.toHaveProperty('jumbo');
    });
});
