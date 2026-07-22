/**
 * Count-noun sibling routing (Track 3, Jul 2026) — probes that the unit nouns
 * bar / patty / link / slice / tortilla, requested against a SKU LACKING that
 * serving, actually reach borrowSiblingServing inside
 * getOrCreateAmbiguousServing instead of dead-ending in AI/flat-100g:
 *
 *   - routing: bar/link are estimable-unknown units; patty/slice/tortilla sit
 *     in AMBIGUOUS_UNITS — all five route into getOrCreateAmbiguousServing;
 *   - poisoned cached rows below the new per-noun UNIT_MIN_GRAMS bounds are
 *     rejected (the barebells "bar"=1.5g class) so the sibling borrow runs;
 *   - food-name seed fallbacks outside the unit bounds are rejected (a "bar"
 *     request on "… Caramel Cashew" must not surface the 1.5g cashew seed);
 *   - the golden probe: a branded bar whose exact SKU lacks a "bar" serving
 *     resolves from sibling label servings (Quest/Chomps style).
 */

import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import {
    isAmbiguousUnit,
    isEstimableUnknownUnit,
    AMBIGUOUS_UNITS,
    getAmbiguousUnitBounds,
} from '../../ai/ambiguous-serving-estimator';
import { estimateAmbiguousServing } from '../../ai/ambiguous-serving-estimator';
import { prisma } from '../../db';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        offServing: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue({}),
        },
        fdcServing: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue({}),
        },
        aiGeneratedServing: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue({}),
        },
    },
}));

// AI estimation must never be reached in the sibling-borrow paths under test.
jest.mock('../../ai/ambiguous-serving-estimator', () => {
    const actual = jest.requireActual('../../ai/ambiguous-serving-estimator');
    return {
        ...actual,
        estimateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'error', error: 'ai must not run' }),
    };
});

const mockedQueryRaw = prisma.$queryRaw as jest.Mock;
const mockedOffServingFindUnique = prisma.offServing.findUnique as jest.Mock;
const mockedOffServingUpsert = prisma.offServing.upsert as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    mockedQueryRaw.mockResolvedValue([]);
    mockedOffServingFindUnique.mockResolvedValue(null);
});

describe('routing: all five nouns are estimable units', () => {
    it.each(['bar', 'link'])('"%s" routes via isEstimableUnknownUnit (not in AMBIGUOUS_UNITS)', (noun) => {
        expect(AMBIGUOUS_UNITS.has(noun)).toBe(false);
        expect(isEstimableUnknownUnit(noun)).toBe(true);
        expect(isAmbiguousUnit(noun)).toBe(true);
    });

    it.each(['patty', 'slice', 'tortilla'])('"%s" routes via the curated AMBIGUOUS_UNITS set', (noun) => {
        expect(AMBIGUOUS_UNITS.has(noun)).toBe(true);
        expect(isAmbiguousUnit(noun)).toBe(true);
    });

    it('per-noun bounds exist for bar/patty/link/tortilla (not slice — too food-varied)', () => {
        expect(getAmbiguousUnitBounds('bar')).toEqual({ min: 15, max: 150 });
        expect(getAmbiguousUnitBounds('patty')).toEqual({ min: 15, max: 250 });
        expect(getAmbiguousUnitBounds('link')).toEqual({ min: 10, max: 100 });
        expect(getAmbiguousUnitBounds('tortilla')).toEqual({ min: 15, max: 120 });
        expect(getAmbiguousUnitBounds('slice')).toEqual({ min: undefined, max: undefined });
    });
});

describe('golden probe: branded bar whose SKU lacks a "bar" serving', () => {
    it('borrows the sibling median from same-brand label servings (Quest style)', async () => {
        // No cached serving for this SKU; three sibling SKUs carry genuine
        // "bar" label servings.
        mockedQueryRaw.mockResolvedValue([
            { grams: 60, description: '1 bar (60 g)' },
            { grams: 54, description: 'bar' },
            { grams: 100, description: '2 bars (100 g)' },  // → 50 per bar
        ]);

        const r = await getOrCreateAmbiguousServing(
            'off_888', 'Chocolate Chip Cookie Dough Protein Bar', 'bar', 'Quest'
        );

        expect(r.status).toBe('success');
        expect(r.grams).toBe(54);   // median of [60, 54, 50]
        expect(estimateAmbiguousServing).not.toHaveBeenCalled();
        // Borrowed value is persisted as a non-AI 'sibling_borrow' serving.
        expect(mockedOffServingUpsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ source: 'sibling_borrow', isAiEstimated: false, grams: 54 }),
        }));
    });

    it('a poisoned cached "bar" row below the 15g floor is rejected and the sibling borrow runs (barebells 1.5g class)', async () => {
        mockedOffServingFindUnique.mockResolvedValue({ grams: 1.5 });
        mockedQueryRaw.mockResolvedValue([
            { grams: 55, description: '1 bar (55 g)' },
            { grams: 55, description: 'bar' },
        ]);

        const r = await getOrCreateAmbiguousServing(
            'off_777', 'Caramel Cashew Protein Bar', 'bar', 'Barebells'
        );

        expect(r.status).toBe('success');
        expect(r.grams).toBe(55);
        expect(estimateAmbiguousServing).not.toHaveBeenCalled();
    });

    it('a sane cached "bar" row is served from cache (no borrow, no AI)', async () => {
        mockedOffServingFindUnique.mockResolvedValue({ grams: 60 });

        const r = await getOrCreateAmbiguousServing(
            'off_777', 'Protein Bar', 'bar', 'Quest'
        );

        expect(r).toEqual({ status: 'cached', grams: 60 });
        expect(mockedQueryRaw).not.toHaveBeenCalled();
    });

    it('a food-name seed outside the unit bounds is rejected ("bar" on "… Caramel Cashew" ≠ 1.5g cashew)', async () => {
        // getDefaultCountServing falls back to the food-name last word:
        // 'cashew' seeds 1.5g — out of the bar [15,150] bounds, so the
        // routing must continue to the sibling borrow.
        mockedQueryRaw.mockResolvedValue([
            { grams: 55, description: '1 bar (55 g)' },
            { grams: 55, description: 'bar' },
        ]);

        const r = await getOrCreateAmbiguousServing(
            'off_777', 'Caramel Cashew', 'bar', 'Barebells'
        );

        expect(r.status).toBe('success');
        expect(r.grams).toBe(55);
        expect(estimateAmbiguousServing).not.toHaveBeenCalled();
    });
});

describe.each([
    ['patty', 'Beyond Burger Patty Pack', 'Beyond Meat', 113, 5],
    ['link', 'Original Breakfast Sausage', 'Johnsonville', 45, 2],
    ['slice', 'Sourdough Bread Loaf', 'Daves Killer Bread', 32, 4],
    // 'tortilla' resolves one tier EARLIER — the curated 45g seed answers
    // before the borrow (also a non-dead-end); grams below mirror the seed
    // so the assertion holds for whichever deterministic tier answered.
    ['tortilla', 'Flour Tortillas Family Pack', 'Mission', 45, 7],
])('sibling routing for "%s"', (noun, foodName, brand, gramsPerPiece, poisoned) => {
    it(`reaches borrowSiblingServing when the SKU lacks a "${noun}" serving`, async () => {
        mockedQueryRaw.mockResolvedValue([
            { grams: gramsPerPiece, description: `1 ${noun} (${gramsPerPiece} g)` },
            { grams: gramsPerPiece * 2, description: `2 ${noun}s (${gramsPerPiece * 2} g)` },
            { grams: gramsPerPiece, description: noun },
        ]);

        const r = await getOrCreateAmbiguousServing(`off_${noun}1`, foodName, noun, brand);

        expect(r.status).toBe('success');
        expect(r.grams).toBe(gramsPerPiece);
        expect(estimateAmbiguousServing).not.toHaveBeenCalled();
    });

    it(`rejects a poisoned sub-floor cached "${noun}" row where a floor exists`, async () => {
        mockedOffServingFindUnique.mockResolvedValue({ grams: poisoned });
        mockedQueryRaw.mockResolvedValue([
            { grams: gramsPerPiece, description: `1 ${noun} (${gramsPerPiece} g)` },
            { grams: gramsPerPiece, description: noun },
        ]);

        const r = await getOrCreateAmbiguousServing(`off_${noun}2`, foodName, noun, brand);

        const { min } = getAmbiguousUnitBounds(noun);
        if (min != null && poisoned < min) {
            // Poisoned row rejected → sibling borrow answers.
            expect(r.grams).toBe(gramsPerPiece);
            expect(r.status).toBe('success');
        } else {
            // 'slice' has no floor: cached row is (deliberately) trusted.
            expect(r).toEqual({ status: 'cached', grams: poisoned });
        }
    });
});

describe('dead-end guard: no brand → no borrow → AI (bounded), never flat-100g here', () => {
    it('null brand skips the sibling borrow and reaches the (mocked, failing) AI estimator', async () => {
        const r = await getOrCreateAmbiguousServing('off_999', 'Generic Protein Bar', 'bar', null);

        expect(mockedQueryRaw).not.toHaveBeenCalled();
        expect(estimateAmbiguousServing).toHaveBeenCalled();
        expect(r.status).toBe('error');   // caller falls to its own floor logic
    });
});
