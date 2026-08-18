/**
 * LANE G (2026-08-17) — branches 3 and 4 of buildFdcResult read the record's own
 * FdcServing row before any estimator, the way the volume branch has since
 * n-serv-06.
 *
 * WHAT THE ESTIMATOR ACTUALLY WAS, none of it previously written down:
 *   - `getOrCreateFdcSizeServings()` touches NO database despite the name, and
 *     ignores its `fdcId` except for logging. It calls `estimateAmbiguousServing()`
 *     once and scales by hardcoded ratios (small .70 / large 1.40 / xl 1.60 /
 *     mini .55).
 *   - That estimator's non-LLM first step issues a LIVE HTTP search of the remote
 *     USDA API BY NAME, which can land on a different fdcId than the mapper
 *     picked. If it misses, a model answers.
 *   - Measured on the box: `5 strawberries` -> fdc_167762, which carries a
 *     genuine `medium (1-1/4" dia)` = 12 g row the parse response ALREADY LISTS,
 *     while billing 75/50/75 g across three probes ~90 s apart.
 *
 * THE ROW-SELECTION RULE IS THE DESIGN, and most of this file tests it rather
 * than the wiring. Every fixture below is a real row shape read off the live
 * table on 2026-08-17.
 */

import {
    hydrateAndSelectServing,
    findOwnFdcSizeServing,
} from '../map-ingredient-with-fallback';
import { getOrCreateFdcSizeServings } from '../../usda/fdc-ai-backfill';
import { estimateAmbiguousServing } from '../../ai/ambiguous-serving-estimator';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import { prisma } from '../../db';
import {
    servingAiCallForTier,
    isReplayNondeterministicTier,
    isSyntheticGramsTier,
    isBorrowedOrDefaultedTier,
} from '../serving-ai-tiers';
import type { ParsedIngredient } from '../../parse/ingredient-line';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcServing: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
            create: jest.fn(),
            createMany: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            delete: jest.fn(),
            deleteMany: jest.fn(),
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

jest.mock('../../ai/ambiguous-serving-estimator', () => {
    const actual = jest.requireActual('../../ai/ambiguous-serving-estimator');
    return { ...actual, estimateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'error' }) };
});

jest.mock('../ambiguous-unit-backfill', () => {
    const actual = jest.requireActual('../ambiguous-unit-backfill');
    return { ...actual, getOrCreateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'error' }) };
});

const findMany = prisma.fdcServing.findMany as jest.Mock;
const mockedSizes = getOrCreateFdcSizeServings as jest.Mock;
const mockedEstimate = estimateAmbiguousServing as jest.Mock;
const mockedAmbiguous = getOrCreateAmbiguousServing as jest.Mock;

type Row = { description: string; grams: number | null; isAiEstimated: boolean | null };
const rows = (...r: Row[]) => findMany.mockResolvedValue(r);

/** fdc_167762 "Strawberries, raw" — every row verbatim from the live table. */
const STRAWBERRY_ROWS: Row[] = [
    { description: 'cup, halves', grams: 152, isAiEstimated: false },
    { description: 'cup, pureed', grams: 232, isAiEstimated: false },
    { description: 'cup, sliced', grams: 166, isAiEstimated: false },
    { description: 'cup, whole', grams: 144, isAiEstimated: false },
    { description: 'extra large (1-5/8" dia)', grams: 27, isAiEstimated: false },
    { description: 'large (1-3/8" dia)', grams: 18, isAiEstimated: false },
    { description: 'medium (1-1/4" dia)', grams: 12, isAiEstimated: false },
    { description: 'NLEA serving', grams: 147, isAiEstimated: false },
    { description: 'pint as purchased, yields', grams: 357, isAiEstimated: false },
    { description: 'small (1" dia)', grams: 7, isAiEstimated: false },
];

/** fdc_173944 "Bananas, raw". Carries BOTH `small` and `extra small`. */
const BANANA_ROWS: Row[] = [
    { description: 'cup, mashed', grams: 225, isAiEstimated: false },
    { description: 'cup, sliced', grams: 150, isAiEstimated: false },
    { description: 'extra large (9" or longer)', grams: 152, isAiEstimated: false },
    { description: 'extra small (less than 6" long)', grams: 81, isAiEstimated: false },
    { description: 'large (8" to 8-7/8" long)', grams: 136, isAiEstimated: false },
    { description: 'medium (7" to 7-7/8" long)', grams: 118, isAiEstimated: false },
    { description: 'NLEA serving', grams: 126, isAiEstimated: false },
    { description: 'small (6" to 6-7/8" long)', grams: 101, isAiEstimated: false },
];

/** fdc_169640 "Honey" — a genuine `tbsp` 21 g AND an AI `1 tbsp` 21 g. */
const HONEY_ROWS: Row[] = [
    { description: '1 cup', grams: 340, isAiEstimated: true },
    { description: '1 tbsp', grams: 21, isAiEstimated: true },
    { description: '1 tsp', grams: 7, isAiEstimated: true },
    { description: 'cup', grams: 339, isAiEstimated: false },
    { description: 'packet (0.5 oz)', grams: 14, isAiEstimated: false },
    { description: 'tbsp', grams: 21, isAiEstimated: false },
];

function fdcCandidate(id: string, name: string) {
    return {
        id, source: 'fdc' as const, name, score: 1, foodType: 'foundation',
        nutrition: { kcal: 32, protein: 0.67, carbs: 7.68, fat: 0.3, per100g: true },
        rawData: {},
    } as never;
}

function parsedLine(p: Partial<ParsedIngredient>): ParsedIngredient {
    return { qty: 1, multiplier: 1, unit: undefined, name: 'strawberries', ...p } as ParsedIngredient;
}

beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([]);
    mockedSizes.mockResolvedValue(null);
    mockedEstimate.mockResolvedValue({ status: 'error' });
    mockedAmbiguous.mockResolvedValue({ status: 'error' });
});

// ============================================================================
describe('findOwnFdcSizeServing — the anchor rule', () => {
    /**
     * THE MEASUREMENT THIS RULE EXISTS FOR. A free `%medium%` substring matches
     * 104 rows on the live table, and 34 of them (32.7%) are UNIT-qualified, not
     * size-qualified. `head, medium (6" dia)` is 539 g of cabbage; letting it
     * answer "1 medium tomato" is a 45x error.
     *
     * MUTATION: relax the leading anchor to `\b${stem}\b`. Red on every case here.
     *
     * ONE ROW PER CASE, DELIBERATELY. The first cut of this test passed all four
     * rows at once and stayed GREEN under the relaxed anchor — with four matches
     * the ambiguity rule declined anyway, so the assertion was being satisfied by
     * the wrong mechanism. A single row is the only shape where the anchor is the
     * sole thing standing between the request and the answer.
     */
    it.each([
        ['head, medium (6" dia)', 539],
        ['leaf, medium', 7.5],
        ['stalk, medium', 180],
        ['slice, medium', 28],
        ['wedge (1/4 of medium tomato)', 20],
    ])('a lone unit-qualified row (%s) never answers a SIZE request', async (description, grams) => {
        rows({ description, grams, isAiEstimated: false });
        expect(await findOwnFdcSizeServing(1, 'medium')).toBeNull();
    });

    it('…and the size request still finds the real size row sitting beside them', async () => {
        rows(
            { description: 'slice, medium', grams: 28, isAiEstimated: false },
            { description: 'medium (2-1/2" dia)', grams: 123, isAiEstimated: false },
        );
        expect(await findOwnFdcSizeServing(1, 'medium')).toEqual({
            perUnitGrams: 123, genuine: true, description: 'medium (2-1/2" dia)',
        });
    });

    /**
     * The converse, and it is the same rule doing both jobs: `slice, medium` IS
     * the right answer to a `slice` request, because there the stem leads.
     */
    it('DOES use `slice, medium` for a SLICE request', async () => {
        rows(
            { description: 'slice, medium', grams: 28, isAiEstimated: false },
            { description: 'slice, thick', grams: 43, isAiEstimated: false },
            { description: 'slice, thin', grams: 14, isAiEstimated: false },
        );
        expect(await findOwnFdcSizeServing(167685, 'slice')).toEqual({
            perUnitGrams: 28, genuine: true, description: 'slice, medium',
        });
    });

    // MUTATION: allow the stem anywhere in the leading token. Red — `extra small`
    // would answer a `small` request at 81 g against the real 101 g row.
    it('`extra small` does not answer a `small` request', async () => {
        rows(...BANANA_ROWS);
        expect(await findOwnFdcSizeServing(173944, 'small')).toEqual({
            perUnitGrams: 101, genuine: true, description: 'small (6" to 6-7/8" long)',
        });
        expect(await findOwnFdcSizeServing(173944, 'xl')).toEqual({
            perUnitGrams: 152, genuine: true, description: 'extra large (9" or longer)',
        });
    });

    it('reaches the same row through every spelling of a size', async () => {
        rows(...BANANA_ROWS);
        for (const spelling of ['medium', 'med']) {
            expect((await findOwnFdcSizeServing(173944, spelling))?.perUnitGrams).toBe(118);
        }
        for (const spelling of ['large', 'lg']) {
            expect((await findOwnFdcSizeServing(173944, spelling))?.perUnitGrams).toBe(136);
        }
    });

    it('does not match a stem that is merely a prefix of another word', async () => {
        rows(
            { description: 'sliced almonds, cup', grams: 92, isAiEstimated: false },
            { description: 'largely irrelevant', grams: 50, isAiEstimated: false },
        );
        expect(await findOwnFdcSizeServing(1, 'slice')).toBeNull();
        expect(await findOwnFdcSizeServing(1, 'large')).toBeNull();
    });

    it('divides a leading count out ("2 medium" 24 g is 12 g per unit)', async () => {
        rows({ description: '2 medium', grams: 24, isAiEstimated: false });
        expect((await findOwnFdcSizeServing(1, 'medium'))?.perUnitGrams).toBe(12);
    });

    it('returns null for a token it does not know, without querying', async () => {
        expect(await findOwnFdcSizeServing(1, 'jar')).toBeNull();
        expect(await findOwnFdcSizeServing(1, undefined)).toBeNull();
        expect(findMany).not.toHaveBeenCalled();
    });
});

// ============================================================================
describe('findOwnFdcSizeServing — genuine beats AI', () => {
    /**
     * Honey carries a genuine `tbsp` 21 g and an AI `1 tbsp` 21 g. They agree
     * here, which is exactly why the preference must be asserted rather than
     * observed: with equal values, a row-order-dependent pick looks correct.
     *
     * MUTATION: drop the `genuine.length > 0 ? genuine : candidates` narrowing. Red.
     */
    it('an AI row never wins while a genuine row is present', async () => {
        rows(
            { description: 'medium', grams: 90, isAiEstimated: true },
            { description: 'medium (2" dia)', grams: 60, isAiEstimated: false },
        );
        expect(await findOwnFdcSizeServing(1, 'medium')).toEqual({
            perUnitGrams: 60, genuine: true, description: 'medium (2" dia)',
        });
    });

    it('an AI row is used when it is the only one, and is stamped as cached', async () => {
        rows({ description: 'medium', grams: 90, isAiEstimated: true });
        expect(await findOwnFdcSizeServing(1, 'medium')).toEqual({
            perUnitGrams: 90, genuine: false, description: 'medium',
        });
    });

    it('the genuine narrowing is applied BEFORE the ambiguity rule, not after', async () => {
        // Two AI rows would be ambiguous; one genuine row resolves it outright.
        rows(
            { description: 'slice, thick', grams: 43, isAiEstimated: true },
            { description: 'slice, thin', grams: 14, isAiEstimated: true },
            { description: 'slice', grams: 28, isAiEstimated: false },
        );
        expect((await findOwnFdcSizeServing(1, 'slice'))?.perUnitGrams).toBe(28);
    });
});

// ============================================================================
describe('findOwnFdcSizeServing — yield rows and the count ceiling', () => {
    /**
     * `piece, cooked, excluding refuse (yield from 1 lb raw meat with refuse)` is
     * what a pound of raw meat cooks down to. It is anchored on `piece` and it is
     * not a piece of anything. 187 of 476 anchored count rows are this shape.
     *
     * MUTATION: delete the FDC_YIELD_ROW_RE filter. Red — "3 pieces of beef
     * tenderloin" would bill 990 g.
     */
    it('refuses a USDA yield row even though it anchors correctly', async () => {
        rows({
            description: 'piece, cooked, excluding refuse (yield from 1 lb raw meat with refuse)',
            grams: 330, isAiEstimated: false,
        });
        expect(await findOwnFdcSizeServing(1, 'piece')).toBeNull();
    });

    it('the yield filter does not eat a legitimate row that merely mentions a size', async () => {
        rows({ description: 'piece (1/8 of 12" pizza)', grams: 96, isAiEstimated: false });
        expect((await findOwnFdcSizeServing(1, 'piece'))?.perUnitGrams).toBe(96);
    });

    /**
     * A raw brisket's USDA "1 piece" really is 1967 g. Honest data, implausible
     * request. The ceiling applies only where the caller passes it — i.e. where
     * the user named a COUNT and no size.
     *
     * MUTATION: drop `maxPerUnitGrams` from the high-count call sites. Red.
     */
    it('rejects a primal-cut `piece` when the caller passes a ceiling', async () => {
        rows({ description: 'piece', grams: 1967, isAiEstimated: false });
        expect(await findOwnFdcSizeServing(1, 'piece', { maxPerUnitGrams: 500 })).toBeNull();
        // …and accepts it when no ceiling is passed, so the rule lives at the call
        // site rather than being baked into the reader.
        expect((await findOwnFdcSizeServing(1, 'piece'))?.perUnitGrams).toBe(1967);
    });

    it('an 800 g `large` row is kept — the size rung has no ceiling', async () => {
        rows({ description: 'large', grams: 800, isAiEstimated: false });
        expect((await findOwnFdcSizeServing(1, 'large'))?.perUnitGrams).toBe(800);
    });
});

// ============================================================================
describe('findOwnFdcSizeServing — the ambiguity rule DECLINES rather than guesses', () => {
    /**
     * 28 of 147 records carrying an anchored `slice` row carry more than one
     * (up to four). Anchored SIZE matching, by contrast, has zero ties on the
     * whole live table — so this rule only ever fires on the count rung.
     */
    it('bologna fdc_168101: the bare `slice` row wins over thin/medium/thick', async () => {
        rows(
            { description: 'slice', grams: 28, isAiEstimated: false },
            { description: 'slice, medium', grams: 28, isAiEstimated: false },
            { description: 'slice, thick', grams: 43, isAiEstimated: false },
            { description: 'slice, thin', grams: 14, isAiEstimated: false },
        );
        expect((await findOwnFdcSizeServing(168101, 'slice'))?.description).toBe('slice');
    });

    it('onion fdc_170000: with no bare row, the `medium`-qualified one wins', async () => {
        rows(
            { description: 'slice, large (1/4" thick)', grams: 38, isAiEstimated: false },
            { description: 'slice, medium (1/8" thick)', grams: 14, isAiEstimated: false },
            { description: 'slice, thin', grams: 9, isAiEstimated: false },
        );
        expect(await findOwnFdcSizeServing(170000, 'slice')).toEqual({
            perUnitGrams: 14, genuine: true, description: 'slice, medium (1/8" thick)',
        });
    });

    /**
     * THE DECLINE, and the reason it is a feature. Sharp cheddar names three
     * slices by WEIGHT and does not say which is standard. A "shortest
     * description" tie-break — the obvious rule — would systematically pick
     * `slice, thin` across this whole population, biasing every multi-slice
     * record low. Declining costs nothing: the caller runs the estimator it runs
     * today.
     *
     * MUTATION: replace the `finalists.length === 1` guard with `finalists[0]`. Red.
     */
    it('cheddar fdc_170899: three by-weight slices, no bare and no medium → null', async () => {
        rows(
            { description: 'slice (1 oz)', grams: 28, isAiEstimated: false },
            { description: 'slice (2/3 oz)', grams: 19, isAiEstimated: false },
            { description: 'slice (3/4 oz)', grams: 21, isAiEstimated: false },
        );
        expect(await findOwnFdcSizeServing(170899, 'slice')).toBeNull();
    });

    it('is order-independent — the same rows shuffled give the same answer', async () => {
        const set: Row[] = [
            { description: 'slice, thin', grams: 9, isAiEstimated: false },
            { description: 'slice, medium (1/8" thick)', grams: 14, isAiEstimated: false },
            { description: 'slice, large (1/4" thick)', grams: 38, isAiEstimated: false },
        ];
        rows(...set);
        const a = await findOwnFdcSizeServing(1, 'slice');
        rows(...[...set].reverse());
        const b = await findOwnFdcSizeServing(1, 'slice');
        expect(a).toEqual(b);
    });

    // MUTATION: remove `orderBy` from the findMany call. This is the guard against
    // re-importing the nondeterminism the whole PR is removing; the volume sibling
    // had no orderBy and tie-broke on database order until 2026-08-17 (P5), when it
    // took this same one — its own tripwire is in fdc-volume-serving.test.ts.
    it('reads with an explicit deterministic orderBy', async () => {
        rows(...STRAWBERRY_ROWS);
        await findOwnFdcSizeServing(167762, 'medium');
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            orderBy: [{ description: 'asc' }, { id: 'asc' }],
        }));
    });

    it('never writes — the reader is SELECT-only (DNB-5 is persistence, not reading)', async () => {
        rows(...STRAWBERRY_ROWS);
        await findOwnFdcSizeServing(167762, 'medium');
        for (const w of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
            expect((prisma.fdcServing as unknown as Record<string, jest.Mock>)[w]).not.toHaveBeenCalled();
        }
    });
});

// ============================================================================
describe('buildFdcResult wiring — branch 4 HIGH COUNT (n-serv-31)', () => {
    /**
     * The case the whole lane is aimed at. Band [38, 88]; the golden notes say
     * "currently CORRECT: 60g ... ~12g/berry x 5", which is precisely the
     * record's own `medium (1-1/4" dia)` row times five.
     *
     * MUTATION: delete the rung-(0) block from the high-count arm. Red — it
     * falls to the AI estimator, which is mocked off here and lands on 500 g.
     */
    it('`5 strawberries` bills 5 x the record\'s own 12 g medium row = 60 g', async () => {
        rows(...STRAWBERRY_ROWS);

        const r = await hydrateAndSelectServing(
            fdcCandidate('fdc_167762', 'raw strawberries'),
            parsedLine({ qty: 5, name: 'strawberries' }),
            0.9, '5 strawberries',
        );

        expect(r?.grams).toBe(60);
        expect(r?.servingTier).toBe('fdc_own_size_serving');
        expect(mockedEstimate).not.toHaveBeenCalled();
        expect(mockedSizes).not.toHaveBeenCalled();
    });

    /**
     * The wire consequence, asserted rather than described. /api/nlp/parse hands
     * `servingDescription` to resolveFoodDetails() as `matchedServingDescription`,
     * which sets `isDefault` by exact case-insensitive label equality. The old
     * synthesized "5 medium (12g each)" could never match any option, so the card
     * fell through to options[0] — `cup, pureed` 232 g for this record.
     */
    it('emits the row\'s own description verbatim, so the wire can match it', async () => {
        rows(...STRAWBERRY_ROWS);

        const r = await hydrateAndSelectServing(
            fdcCandidate('fdc_167762', 'raw strawberries'),
            parsedLine({ qty: 5, name: 'strawberries' }),
            0.9, '5 strawberries',
        );

        expect(r?.servingDescription).toBe('medium (1-1/4" dia)');
        expect(r?.servingDescription).not.toMatch(/each/);
    });

    it('a count unit reaches a real `slice` row before any estimate', async () => {
        rows(
            { description: 'slice', grams: 28, isAiEstimated: false },
            { description: 'slice, thin', grams: 14, isAiEstimated: false },
        );

        const r = await hydrateAndSelectServing(
            fdcCandidate('fdc_168101', 'Bologna, beef, low fat'),
            parsedLine({ qty: 4, unit: 'slice', name: 'bologna' }),
            0.9, '4 slices of bologna',
        );

        expect(r?.grams).toBe(112);
        expect(r?.servingTier).toBe('fdc_own_size_serving');
    });

    it('falls through to today\'s ladder when the record has no usable row', async () => {
        rows(...HONEY_ROWS);   // volume + packet rows only; no size, no count
        mockedEstimate.mockResolvedValue({ status: 'success', estimatedGrams: 21 });

        const r = await hydrateAndSelectServing(
            fdcCandidate('fdc_169640', 'Honey'),
            parsedLine({ qty: 5, name: 'honey' }),
            0.9, '5 honey',
        );

        expect(r?.servingTier).toBe('fdc_piece_ai');
        expect(r?.grams).toBe(105);
    });
});

describe('buildFdcResult wiring — branch 3 and LOW COUNT', () => {
    it('branch 3: `2 medium bananas` bills 2 x the record\'s own 118 g row', async () => {
        rows(...BANANA_ROWS);

        const r = await hydrateAndSelectServing(
            fdcCandidate('fdc_173944', 'raw bananas'),
            parsedLine({ qty: 2, unit: 'medium', name: 'bananas' }),
            0.9, '2 medium bananas',
        );

        // 236 g — byte-identical to what the estimator returns live today, but
        // now from the record instead of a live USDA search plus a model.
        expect(r?.grams).toBe(236);
        expect(r?.servingTier).toBe('fdc_own_size_serving');
        expect(mockedSizes).not.toHaveBeenCalled();
    });

    it('branch 3 still runs the estimator when the record has no matching row', async () => {
        rows(...HONEY_ROWS);
        mockedSizes.mockResolvedValue({ medium: 100, large: 140 });

        const r = await hydrateAndSelectServing(
            fdcCandidate('fdc_169640', 'Honey'),
            parsedLine({ qty: 1, unit: 'large', name: 'honey' }),
            0.9, '1 large honey',
        );

        expect(r?.servingTier).toBe('fdc_size_qualifier');
        expect(mockedSizes).toHaveBeenCalled();
    });

    it('LOW COUNT: `1 banana` takes the record\'s own medium row', async () => {
        rows(...BANANA_ROWS);

        const r = await hydrateAndSelectServing(
            fdcCandidate('fdc_173944', 'raw bananas'),
            parsedLine({ qty: 2, name: 'bananas' }),
            0.9, '2 bananas',
        );

        expect(r?.grams).toBe(236);
        expect(r?.servingTier).toBe('fdc_own_size_serving');
    });

    /**
     * The estimator's `mini` handling multiplies its `small` value by 0.8, because
     * a scaled `medium` is all it ever has. A row the record declares is a
     * measurement; scaling it by 0.8 would re-import the guess this rung removes.
     *
     * MUTATION: apply the 0.8 to `ownLowCount.perUnitGrams`. Red.
     */
    it('LOW COUNT: a real `mini` row is used unscaled, no 0.8 fudge', async () => {
        rows(
            { description: 'mini', grams: 20, isAiEstimated: false },
            { description: 'small', grams: 40, isAiEstimated: false },
        );

        const r = await hydrateAndSelectServing(
            fdcCandidate('fdc_1', 'Bagels, plain'),
            parsedLine({ qty: 1, name: 'mini bagel' }),
            0.9, '1 mini bagel',
        );

        expect(r?.grams).toBe(20);
        expect(r?.servingTier).toBe('fdc_own_size_serving');
    });

    it('LOW COUNT: with no `mini` row it falls back to the record\'s `small`', async () => {
        rows({ description: 'small', grams: 40, isAiEstimated: false });

        const r = await hydrateAndSelectServing(
            fdcCandidate('fdc_1', 'Bagels, plain'),
            parsedLine({ qty: 1, name: 'mini bagel' }),
            0.9, '1 mini bagel',
        );

        expect(r?.grams).toBe(40);
    });
});

describe('buildFdcResult wiring — the sentinels that must NOT move', () => {
    it('a weight unit is untouched: `365 g` still bills 365 g', async () => {
        rows(...STRAWBERRY_ROWS);
        const r = await hydrateAndSelectServing(
            fdcCandidate('fdc_167762', 'raw strawberries'),
            parsedLine({ qty: 365, unit: 'g', name: 'strawberries' }),
            0.9, '365 g strawberries',
        );
        expect(r?.grams).toBe(365);
        expect(r?.servingTier).toBe('weight_unit');
        expect(findMany).not.toHaveBeenCalled();
    });

    it('an ounce line is untouched', async () => {
        rows(...STRAWBERRY_ROWS);
        const r = await hydrateAndSelectServing(
            fdcCandidate('fdc_167762', 'raw strawberries'),
            parsedLine({ qty: 16, unit: 'oz', name: 'strawberries' }),
            0.9, '16 oz strawberries',
        );
        expect(r?.grams).toBeCloseTo(453.6, 1);
        expect(r?.servingTier).toBe('weight_unit');
    });

    it('the VOLUME branch keeps its own rung (0) and its own tiers', async () => {
        rows({ description: 'cup', grams: 185, isAiEstimated: false });
        const r = await hydrateAndSelectServing(
            fdcCandidate('fdc_168917', 'cooked quinoa'),
            parsedLine({ qty: 1.5, unit: 'cup', name: 'cooked quinoa' }),
            0.9, '1.5 cups cooked quinoa',
        );
        expect(r?.grams).toBeCloseTo(277.5, 1);
        expect(r?.servingTier).toBe('fdc_label_volume');
    });

    it('branch 5 is untouched — an ambiguous unit still goes to its own estimator', async () => {
        rows({ description: 'packet (0.5 oz)', grams: 14, isAiEstimated: false });
        mockedAmbiguous.mockResolvedValue({ status: 'success', grams: 30 });

        const r = await hydrateAndSelectServing(
            fdcCandidate('fdc_169640', 'Honey'),
            parsedLine({ qty: 1, unit: 'packet', name: 'honey' }),
            0.9, '1 packet honey',
        );

        expect(r?.servingTier).toBe('count_unit_ai');
        // 30 g in, 10 g out: the pre-existing UNIT_MAX_GRAMS_PER_UNIT sanity guard
        // caps `packet` at 10 g/unit AFTER the branch table. Asserted at its capped
        // value on purpose — it shows that guard still runs downstream of the new
        // rung, which is the half a "tier is unchanged" check would miss.
        expect(r?.grams).toBe(10);
    });
});

// ============================================================================
describe('the two new tiers stay out of all four frozen predicate sets', () => {
    /**
     * Same trap as the fallback-tier PR: `isSyntheticGramsTier` gates
     * `portionEstimated` on the parse wire, and `isReplayNondeterministicTier`
     * drives winner-diff. A deterministic ROW READ belongs in neither —
     * `fdc_volume_cached`, the exact analogue on the volume branch, is already
     * pinned as a non-member of the replay set.
     *
     * The fourth set (`BORROWED_OR_DEFAULTED_SERVING_TIERS`, #330) is the one
     * worth thinking about rather than pattern-matching, because
     * `fdc_own_size_cached` reads an AI-WRITTEN row and the name says "cached".
     * It is still a non-member: that set means "another product's data, or a
     * generic table". These rows are THIS record's own, whoever wrote them —
     * `findOwnFdcSizeServing` filters on `fdcId` and nothing else. The borrow
     * tiers next door (`bare_sibling_serving`, `bare_name_sibling_serving`) are
     * members precisely because they read OTHER barcodes.
     *
     * MUTATION: add either name to any of the four. Red.
     */
    it.each(['fdc_own_size_serving', 'fdc_own_size_cached'])('%s', (tier) => {
        expect(isSyntheticGramsTier(tier)).toBe(false);
        expect(isReplayNondeterministicTier(tier)).toBe(false);
        expect(isBorrowedOrDefaultedTier(tier)).toBe(false);
        expect(servingAiCallForTier(tier)).toEqual({ called: false });
    });

    it('the borrow tiers next door ARE members, so the predicate is not simply always false', () => {
        // Without this the block above would pass against a stubbed-out predicate.
        expect(isBorrowedOrDefaultedTier('bare_sibling_serving')).toBe(true);
        expect(isBorrowedOrDefaultedTier('bare_name_sibling_serving')).toBe(true);
    });
});
