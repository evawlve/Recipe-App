/**
 * C70 S239 ("berry") — a COUNT of a small item on the FDC lane bills qty x the
 * curated piece seed, not an AI "medium" per piece (`3 blueberries` 450 g -> 4.5 g).
 *
 * Fixture rows are the box's own FdcServing rows, read 2026-10-19 (refute r3.out).
 * The size estimator is mocked to the failure shape: `medium` = 150 g (a serving),
 * per-piece = 1.4 g. Every decline pin asserts the line still reaches the ladder
 * it reached on master (the estimator IS called, the grams are today's).
 *
 * MUTATION (both call sites reverted, i.e. fdcSmallPieceSeed() returns null):
 * every "bills the seed" pin goes red; see the report for the measured count.
 */

import { hydrateAndSelectServing } from '../../map-ingredient-with-fallback';
import { parseIngredientLine, type ParsedIngredient } from '../../../parse/ingredient-line';
import { getOrCreateFdcSizeServings } from '../../../usda/fdc-ai-backfill';
import { estimateAmbiguousServing } from '../../../ai/ambiguous-serving-estimator';
import { prisma } from '../../../db';

jest.mock('../../../db', () => ({
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

jest.mock('../../../usda/fdc-ai-backfill', () => ({
    ...jest.requireActual('../../../usda/fdc-ai-backfill'),
    getOrCreateFdcSizeServings: jest.fn(),
    insertFdcAiServing: jest.fn().mockResolvedValue({ success: false, reason: 'mocked-off' }),
}));

jest.mock('../../../ai/ambiguous-serving-estimator', () => ({
    ...jest.requireActual('../../../ai/ambiguous-serving-estimator'),
    estimateAmbiguousServing: jest.fn(),
}));

jest.mock('../../ambiguous-unit-backfill', () => ({
    ...jest.requireActual('../../ambiguous-unit-backfill'),
    getOrCreateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'error', error: 'off' }),
}));

const findMany = prisma.fdcServing.findMany as jest.Mock;
const mockedSizes = getOrCreateFdcSizeServings as jest.Mock;
const mockedEstimate = estimateAmbiguousServing as jest.Mock;

const R = (description: string, grams: number) => ({ description, grams, isAiEstimated: false });
const ROWS: Record<number, ReturnType<typeof R>[]> = {
    171711: [R('berries', 68), R('cup', 148)],
    167762: [R('cup, halves', 152), R('cup, whole', 144), R('extra large (1-5/8" dia)', 27), R('large (1-3/8" dia)', 18), R('medium (1-1/4" dia)', 12), R('small (1" dia)', 7), R('NLEA serving', 147)],
    170457: [R('cherry', 17), R('cup cherry tomatoes', 149), R('large whole (3" dia)', 182), R('medium whole (2-3/5" dia)', 123), R('small whole (2-2/5" dia)', 91)],
    169655: [R('cup', 200), R('serving 1 cube', 2.3), R('serving packet', 2.8), R('tsp', 4.2)],
    169247: [R('cup shredded', 47), R('head', 626), R('leaf inner', 6), R('leaf outer', 28), R('NLEA serving', 85)],
    167755: [R('cup', 123), R('raspberries', 19)],
    168409: [R('cucumber (8-1/4")', 301), R('cup slices', 52)],
};

const candidate = (fdcId: number, name: string) => ({
    id: `fdc_${fdcId}`, source: 'fdc' as const, name, score: 1, foodType: 'sr_legacy',
    nutrition: { kcal: 57, protein: 0.7, carbs: 14.5, fat: 0.3, per100g: true },
    rawData: {},
} as never);

const BLUEBERRY = [171711, 'raw blueberries'] as const;

async function run(rawLine: string, [fdcId, name]: readonly [number, string], override?: Partial<ParsedIngredient>) {
    findMany.mockResolvedValue(ROWS[fdcId] ?? []);
    mockedSizes.mockClear();
    mockedEstimate.mockClear();
    const base = parseIngredientLine(rawLine)!;
    const parsed = (override ? { ...base, ...override } : base) as ParsedIngredient;
    const r = await hydrateAndSelectServing(candidate(fdcId, name), parsed, 0.9, rawLine);
    return { r, sizeCalls: mockedSizes.mock.calls.length, estCalls: mockedEstimate.mock.calls.length };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockedSizes.mockResolvedValue({ small: 100, medium: 150, large: 200 });
    mockedEstimate.mockResolvedValue({ status: 'success', estimatedGrams: 1.4, confidence: 0.6 });
});

describe('the seed: a small-piece count bills qty x seed', () => {
    it.each([
        ['3 blueberries', 4.5],
        ['three blueberries', 4.5],
        ['2 blueberries', 3.0],
        ['1 blueberry', 1.5],
    ])('LOW COUNT %s -> %d g, size estimator NOT called', async (line, grams) => {
        const { r, sizeCalls } = await run(line, BLUEBERRY);
        expect(r?.grams).toBeCloseTo(grams, 5);
        expect(r?.servingTier).toBe('seed_count_default');
        expect(sizeCalls).toBe(0);
    });

    it.each([
        ['4 blueberries', 6.0],
        ['5 blueberries', 7.5],
    ])('HIGH COUNT %s -> %d g, per-piece estimator NOT called', async (line, grams) => {
        const { r, estCalls } = await run(line, BLUEBERRY);
        expect(r?.grams).toBeCloseTo(grams, 5);
        expect(r?.servingTier).toBe('seed_count_default');
        expect(estCalls).toBe(0);
    });

    it('target bands: 3 blueberries [3,9] g; 5 blueberries [5,12] g', async () => {
        expect((await run('3 blueberries', BLUEBERRY)).r!.grams).toBeGreaterThanOrEqual(3);
        expect((await run('3 blueberries', BLUEBERRY)).r!.grams).toBeLessThanOrEqual(9);
        expect((await run('5 blueberries', BLUEBERRY)).r!.grams).toBeGreaterThanOrEqual(5);
        expect((await run('5 blueberries', BLUEBERRY)).r!.grams).toBeLessThanOrEqual(12);
    });

    it('`three sugar packets` -> 12 g, inside [8, 14] (was 30 g)', async () => {
        const { r } = await run('three sugar packets', [169655, 'granulated sugars']);
        expect(r?.grams).toBeCloseTo(12, 5);
        expect(r!.grams).toBeGreaterThanOrEqual(8);
        expect(r!.grams).toBeLessThanOrEqual(14);
        expect(r?.servingTier).toBe('seed_count_default');
    });

    it('ROW-2-proof: a hand-built qty-3 `a few blueberries` bills 4.5 g', async () => {
        const { r } = await run('a few blueberries', BLUEBERRY, { qty: 3, multiplier: 1, name: 'blueberries' });
        expect(r?.grams).toBeCloseTo(4.5, 5);
        expect(r?.servingTier).toBe('seed_count_default');
    });
});

describe('precedence: the record\'s own row still comes first', () => {
    it.each([
        ['3 strawberries', 36],
        ['5 strawberries', 60],
    ])('%s -> %d g fdc_own_size_serving', async (line, grams) => {
        const { r, sizeCalls, estCalls } = await run(line, [167762, 'raw strawberries']);
        expect(r?.grams).toBe(grams);
        expect(r?.servingTier).toBe('fdc_own_size_serving');
        expect(sizeCalls + estCalls).toBe(0);
    });

    it('RESIDUAL: `3 cherry tomatoes` on the generic tomato record keeps its own 123 g row (369 g)', async () => {
        const { r } = await run('3 cherry tomatoes', [170457, 'Tomatoes, red, ripe, raw, year round average']);
        expect(r?.grams).toBe(369);
        expect(r?.servingTier).toBe('fdc_own_size_serving');
    });
});

describe('every guard declines to today\'s ladder', () => {
    it('bare `blueberries` is a serving: 150 g fdc_size_estimate', async () => {
        const { r } = await run('blueberries', BLUEBERRY);
        expect(r?.grams).toBe(150);
        expect(r?.servingTier).toBe('fdc_size_estimate');
    });

    it('qty < 1: `half blueberries` stays 75 g', async () => {
        const { r } = await run('half blueberries', BLUEBERRY);
        expect(r?.grams).toBe(75);
        expect(r?.servingTier).toBe('fdc_size_estimate');
    });

    it.each(['1,5 cups blueberries', '1 punnet blueberries'])('lost unit `%s` stays 150 g', async (line) => {
        const { r } = await run(line, BLUEBERRY);
        expect(r?.grams).toBe(150);
        expect(r?.servingTier).toBe('fdc_size_estimate');
    });

    // #590 made `pkg` a known unit (package), so it is no longer a LOST unit.
    it('`1 pkg blueberries` is a package since #590: the ambiguous-unit ladder, not the count seed', async () => {
        const { r } = await run('1 pkg blueberries', BLUEBERRY);
        expect(r?.grams).toBe(100);
        expect(r?.servingTier).toBe('count_unit_unresolved');
        expect(r?.servingTier).not.toBe('seed_count_default');
    });

    it('a mass/volume token in the RAW line declines even when the parsed name is clean', async () => {
        const { r } = await run('3 blueberries 2 tbsp', BLUEBERRY, { name: 'blueberries' });
        expect(r?.servingTier).not.toBe('seed_count_default');
    });

    it('a digit in the parsed name declines (`x2 blueberries`)', async () => {
        const { r } = await run('x2 blueberries', BLUEBERRY);
        expect(r?.grams).toBe(150);
        expect(r?.servingTier).toBe('fdc_size_estimate');
    });

    it('an uncovered name token declines (`3 kirkland blueberries`: `kirkland` is on neither the record nor the seed key)', async () => {
        const { r } = await run('3 kirkland blueberries', BLUEBERRY);
        expect(r?.servingTier).toBe('fdc_size_estimate');
        expect(r?.grams).toBe(450);
    });

    it('the five excluded keys decline: `1 romaine lettuce` stays on the estimator', async () => {
        const { r, sizeCalls } = await run('1 romaine lettuce', [169247, 'Lettuce, cos or romaine, raw']);
        expect(r?.servingTier).toBe('fdc_size_estimate');
        expect(r?.grams).toBe(150);
        expect(sizeCalls).toBe(1);
    });

    it.each([
        ['3 thyme', 'thyme'],
        ['3 rosemary', 'rosemary'],
        ['3 chicken skin', 'chicken skin'],
        ['3 mustard', 'mustard'],
    ])('excluded key `%s` declines', async (line, name) => {
        const { r } = await run(line, [999001, name]);
        expect(r?.servingTier).not.toBe('seed_count_default');
    });

    it('a seed >= 20 g keeps the estimator (`1 cucumber`)', async () => {
        const { r, sizeCalls } = await run('1 cucumber', [168409, 'Cucumber, with peel, raw']);
        expect(r?.servingTier).toBe('fdc_size_estimate');
        expect(sizeCalls).toBe(1);
    });

    it('no seed: `3 raspberries` stays 450 g fdc_size_estimate (the documented residual)', async () => {
        const { r } = await run('3 raspberries', [167755, 'raw raspberries']);
        expect(r?.grams).toBe(450);
        expect(r?.servingTier).toBe('fdc_size_estimate');
    });

    it('a unit keeps its own branch (`4 slices ham`)', async () => {
        const { r } = await run('4 slices ham', [999001, 'Ham, sliced']);
        expect(r?.servingTier).not.toBe('seed_count_default');
    });
});
