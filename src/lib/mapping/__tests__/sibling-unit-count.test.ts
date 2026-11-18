/**
 * SIBLING-FIRST-NUMBER (s463): borrowSiblingServing() divides a sibling's OffServing.grams by the
 * number of units its description states. It used to take the description's FIRST number, so
 * "40 g (1 BAR)" was forty bars of 1 g and "about 14 chips (28 g)" was one chip of 28 g.
 * siblingUnitCount() reads the number written against the unit word instead.
 * Every description below is a real OffServing description (box, read-only, 2026-11-17), except
 * "2 bars (80 g)", "30 g (about 1 scoop)" and "4 oz bar", the shapes the row was filed with.
 */
import { getOrCreateAmbiguousServing, siblingUnitCount } from '../ambiguous-unit-backfill';
import { prisma } from '../../db';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        offServing: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue({}),
        },
        fdcServing: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
        aiGeneratedServing: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
        offFood: { findUnique: jest.fn().mockResolvedValue(null) },
    },
}));

jest.mock('../../ai/ambiguous-serving-estimator', () => {
    const actual = jest.requireActual('../../ai/ambiguous-serving-estimator');
    return {
        ...actual,
        estimateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'error', error: 'ai must not run' }),
    };
});

const mockedQueryRaw = prisma.$queryRaw as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    mockedQueryRaw.mockResolvedValue([]);
});

describe('siblingUnitCount() — pure', () => {
    it.each<[string, string, number]>([
        // the count leads (unchanged)
        ['1 bar (40 g)', 'bar', 1],
        ['2 bars (80 g)', 'bar', 2],
        ['1 scoop (30 g)', 'scoop', 1],
        ['0.5 bar (43 g)', 'bar', 0.5],
        ['1 rounded scoop (35.5 g)', 'scoop', 1],
        ['2 large eggs (105 g)', 'egg', 2],
        // the mass leads: the count is the one written against the unit word
        ['40 g (1 BAR)', 'bar', 1],
        ['30 g (about 1 scoop)', 'scoop', 1],
        ['28 g (13 CHIPS)', 'chip', 13],
        ['1 oz (28 g) about 2 pieces', 'piece', 2],
        ['150g (1/2 can)', 'can', 0.5],
        ['46 g (0.5 OF BAR)', 'bar', 0.5],
        ['40 g (13 -15 CHIPS)', 'chip', 14],
        // a mass and the unit word with no count: one unit
        ['31g Slice', 'slice', 1],
        ['250 ml glass (250 ml)', 'glass', 1],
        ['4 oz bar', 'bar', 1],
        // no leading number, a count against the unit word
        ['about 14 chips (28 g)', 'chip', 14],
        ['Serving size 10 pieces (29g)', 'piece', 10],
        ['per 2 bars, 40 g', 'bar', 2],
        // a number in front that counts something else
        ['1 PACKAGE (6 CRACKERS) (39 g)', 'cracker', 6],
        ['40 8 squares (40 g)', 'square', 8],
        // "per" joins a number to the unit word without counting it
        ['1 serving (4 per can) (110 g)', 'can', 1],
        // no count against the unit word and no measure first: the leading quantity, as before
        ['2 pan fried slices (15 g)', 'slice', 2],
        // a leading fraction; a mixed number keeps its whole part (OFF's "one slice, a sixth of the pizza")
        ['1/2 bar (45 g)', 'bar', 0.5],
        ['1 1/6 slice (140 g)', 'slice', 1],
        ['1 1/2 inch slice (56 g)', 'slice', 1],
        // no number at all
        ['Scoop (32 g)', 'scoop', 1],
        ['bar (45 g)', 'bar', 1],
    ])('%p as %p -> %p', (description, stem, count) => {
        expect(siblingUnitCount(description, stem)).toBeCloseTo(count, 6);
    });
});

async function borrow(rows: Array<[number, number, string]>, unit: string): Promise<number | undefined> {
    mockedQueryRaw.mockResolvedValueOnce(rows.map(([id, grams, description]) => ({ id, grams, description, kcal: 400, siblingSelfKcal: 400 })));
    const r = await getOrCreateAmbiguousServing('off_0000000000001', 'Some Product', unit, 'Some Brand');
    return r.status === 'success' ? r.grams : undefined;
}

describe('borrowSiblingServing() reads the count against the unit word', () => {
    it('a brand that writes the mass first borrows its bar weight, not 1 g', async () => {
        expect(await borrow([[1, 40, '40 g (1 BAR)'], [2, 45, '45g (1 bar)'], [3, 56, '56 g (1 BAR)']], 'bar')).toBe(45);
    });

    it('squares counted after the mass borrow a square, not the whole serving', async () => {
        expect(await borrow([[1, 40, '40 g (4 SQUARES)'], [2, 44, '44 g (4 SQUARES)'], [3, 42, '42 g (3 SQUARES)']], 'square')).toBe(11);
    });
});
