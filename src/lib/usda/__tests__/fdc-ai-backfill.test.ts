/**
 * insertFdcAiServing() — the first test this file has ever had (2026-08-17).
 *
 * Every importer of `../fdc-ai-backfill` mocks `insertFdcAiServing`, so until
 * now nothing in the tree EXECUTED the volume arm below. The defect it guards:
 * a COUNT answer to a VOLUME question was accepted as a "count serving", the
 * density band was skipped for it, and the grams of the whole label were
 * persisted and returned undivided. FdcServing 8377 (`3 egg whites = 65 g`)
 * billed 65 g for ONE CUP of egg whites; 8376 (`1 egg white = 33 g`) billed
 * 33 g — the same line flapping 33/65 across cold draws while the density
 * fallback would have said 240 g. Owner of the finding:
 * mobile sync-docs/reports/2026-08-17_the-prose-log-is-clean-at-the-split-and-lost-at-the-portion.md
 *
 * The estimator and prisma are mocked at the module boundary; the function
 * under test runs for real. Nothing here can reach a model or a database.
 */

import { insertFdcAiServing } from '../fdc-ai-backfill';
import { requestAiServing } from '../../ai/serving-estimator';
import { prisma } from '../../db';
import { runWithWritePolicy } from '../../write-policy';

jest.mock('../../ai/serving-estimator', () => {
    const actual = jest.requireActual('../../ai/serving-estimator');
    return { ...actual, requestAiServing: jest.fn() };
});

jest.mock('../../db', () => ({
    prisma: {
        fdcFood: { findUnique: jest.fn() },
        fdcServing: {
            upsert: jest.fn().mockResolvedValue({}),
            create: jest.fn(),
            createMany: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            delete: jest.fn(),
            deleteMany: jest.fn(),
        },
    },
}));

const mockedRequest = requestAiServing as jest.Mock;
const findFood = prisma.fdcFood.findUnique as jest.Mock;
const upsert = prisma.fdcServing.upsert as jest.Mock;

/** fdc_747997 "Egg, white, raw, fresh" — the record behind rows 8376/8377. */
const EGG_WHITE_FOOD = {
    fdcId: 747997,
    description: 'Egg, white, raw, fresh',
    brandName: null,
    dataType: 'foundation',
    servings: [{ description: 'large', grams: 33 }],
};

type Suggestion = {
    servingLabel: string;
    grams: number;
    volumeUnit?: string;
    volumeAmount?: number;
    confidence?: number;
    rationale?: string;
};

function answer(s: Suggestion) {
    mockedRequest.mockResolvedValue({
        status: 'success',
        prompt: 'mock',
        suggestion: { confidence: 0.9, ...s },
    });
}

function noWriteHappened() {
    for (const w of ['upsert', 'create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany']) {
        expect((prisma.fdcServing as unknown as Record<string, jest.Mock>)[w]).not.toHaveBeenCalled();
    }
}

beforeEach(() => {
    jest.clearAllMocks();
    findFood.mockResolvedValue(EGG_WHITE_FOOD);
    upsert.mockResolvedValue({});
});

// ============================================================================
describe('insertFdcAiServing — a count answer to a volume question is refused', () => {
    // MUTATION on the pre-fix tree: these three return { success: true, grams }
    // and call upsert — that is FdcServing 8376/8377 being written.
    it('row 8376: `1 egg white = 33 g` for a cup request → refused, nothing written', async () => {
        answer({ servingLabel: '1 egg white', grams: 33, volumeUnit: 'count', volumeAmount: 1 });

        const r = await insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' });

        expect(r).toEqual({ success: false, reason: 'count_answer_for_volume_gap' });
        noWriteHappened();
    });

    it('row 8377: `3 egg whites = 65 g` with NO volumeUnit at all → refused, nothing written', async () => {
        // The wider arm the recon found: `(unit ? COUNT_UNITS.has(unit) : true)` —
        // a unit-less answer with a positive amount was ALSO accepted as a count.
        answer({ servingLabel: '3 egg whites', grams: 65, volumeAmount: 3 });

        const r = await insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' });

        expect(r).toEqual({ success: false, reason: 'count_answer_for_volume_gap' });
        noWriteHappened();
    });

    it('a count spelling with no amount (`egg`, the old second arm) → refused, nothing written', async () => {
        answer({ servingLabel: '1 large egg white', grams: 33, volumeUnit: 'egg' });

        const r = await insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' });

        expect(r).toEqual({ success: false, reason: 'count_answer_for_volume_gap' });
        noWriteHappened();
    });

    it('the refusal carries no grams, so the caller cannot bill it', async () => {
        answer({ servingLabel: '1 egg white', grams: 33, volumeUnit: 'count', volumeAmount: 1 });
        const r = await insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' });
        expect(r.grams).toBeUndefined();
        expect(r.servingLabel).toBeUndefined();
    });
});

// ============================================================================
describe('insertFdcAiServing — controls that hold on both trees', () => {
    it('a density-banded cup answer succeeds, persists, and returns ITS grams', async () => {
        answer({ servingLabel: '1 cup', grams: 240, volumeUnit: 'cup', volumeAmount: 1, rationale: 'liquid' });

        const r = await insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' });

        expect(r).toEqual({ success: true, grams: 240, servingLabel: '1 cup' });
        expect(upsert).toHaveBeenCalledTimes(1);
        const args = upsert.mock.calls[0][0];
        expect(args.where).toEqual({
            FdcServing_fdcId_description_key: { fdcId: 747997, description: '1 cup' },
        });
        expect(args.create).toMatchObject({
            fdcId: 747997,
            description: '1 cup',
            grams: 240,
            source: 'ai',
            isAiEstimated: true,
            derivedViaDensity: true,
            densityGml: 1,
        });
    });

    it('a WEIGHT gap still accepts a count answer and persists it undivided (untouched lane)', async () => {
        answer({ servingLabel: '1 large egg white', grams: 33, volumeUnit: 'count', volumeAmount: 1 });

        const r = await insertFdcAiServing(747997, 'weight');

        expect(r).toEqual({ success: true, grams: 33, servingLabel: '1 large egg white' });
        expect(upsert).toHaveBeenCalledTimes(1);
        expect(upsert.mock.calls[0][0].create).toMatchObject({
            derivedViaDensity: false,
            densityGml: null,
        });
    });

    it('a volume gap answered with an unknown, non-count unit is still `missing_volume_unit`', async () => {
        answer({ servingLabel: '1 glass', grams: 240, volumeUnit: 'glass', volumeAmount: 1 });

        const r = await insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' });

        expect(r).toEqual({ success: false, reason: 'missing_volume_unit' });
        noWriteHappened();
    });

    it('a cup answer outside the density band is still `density_outside_bounds`', async () => {
        // 2000 g / 240 ml = 8.3 g/ml, above FATSECRET_CACHE_AI_MAX_DENSITY (5).
        answer({ servingLabel: '1 cup', grams: 2000, volumeUnit: 'cup', volumeAmount: 1 });

        const r = await insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' });

        expect(r).toEqual({ success: false, reason: 'density_outside_bounds' });
        noWriteHappened();
    });

    it('a cup answer with non-positive grams is still `invalid_grams`', async () => {
        answer({ servingLabel: '1 cup', grams: 0, volumeUnit: 'cup', volumeAmount: 1 });

        const r = await insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' });

        expect(r).toEqual({ success: false, reason: 'invalid_grams' });
        noWriteHappened();
    });

    it('an estimator error is passed through as its own reason', async () => {
        mockedRequest.mockResolvedValue({ status: 'error', reason: 'low confidence (0.40 < 0.55)', prompt: 'mock' });

        const r = await insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' });

        expect(r).toEqual({ success: false, reason: 'low confidence (0.40 < 0.55)' });
        noWriteHappened();
    });

    it('a missing food short-circuits before the estimator', async () => {
        findFood.mockResolvedValue(null);

        const r = await insertFdcAiServing(1, 'volume', { targetUnit: 'cup' });

        expect(r).toEqual({ success: false, reason: 'food_missing' });
        expect(mockedRequest).not.toHaveBeenCalled();
    });

    it('asks the estimator for the requested unit as an on-demand volume gap', async () => {
        answer({ servingLabel: '1 cup', grams: 240, volumeUnit: 'cup', volumeAmount: 1 });

        await insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' });

        expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
            gapType: 'volume',
            targetServingUnit: 'cup',
            isOnDemandBackfill: true,
        }));
    });
});

// ============================================================================
// Request-scoped write suppression (nosave=1)
// ============================================================================

describe('under a write policy that suppresses aiServing', () => {
    /** A clean 1 cup = 240 g answer: density 1.0, inside the band, nothing else to refuse. */
    const cupAnswer = () => answer({
        servingLabel: '1 cup',
        grams: 240,
        volumeUnit: 'cup',
        volumeAmount: 1,
        rationale: 'a cup of egg whites is about 240 g',
    });

    it('writes no row', async () => {
        cupAnswer();

        await runWithWritePolicy({ suppress: ['aiServing'] }, () =>
            insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' }),
        );

        noWriteHappened();
    });

    it('returns EXACTLY what the persisted path returns — success, grams AND label', async () => {
        // THE ANTI-dryRun PIN. `dryRun` answers `{ success: true }` with no grams, and the
        // volume caller in serving/hydration-lane.ts reads a missing `grams` as failure and
        // reroutes to the hardcoded density — so a suppressed run would measure a different
        // pipeline. Suppression must be invisible to the caller except for the missing row.
        cupAnswer();

        const persisted = await insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' });
        jest.clearAllMocks();
        findFood.mockResolvedValue(EGG_WHITE_FOOD);
        cupAnswer();
        const suppressed = await runWithWritePolicy({ suppress: ['aiServing'] }, () =>
            insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' }),
        );

        expect(suppressed).toEqual(persisted);
        expect(suppressed).toEqual({ success: true, grams: 240, servingLabel: '1 cup' });
    });

    it('still calls the model — the value the caller bills must be a real estimate', async () => {
        // The refusal sits AFTER the answer on purpose here (unlike insertAiServing(), whose
        // return carries no grams for anyone to bill). Skipping the call would make the
        // suppressed path bill nothing at all.
        cupAnswer();

        await runWithWritePolicy({ suppress: ['aiServing'] }, () =>
            insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' }),
        );

        expect(mockedRequest).toHaveBeenCalledTimes(1);
    });

    it('a policy that suppresses a DIFFERENT kind does not touch this writer', async () => {
        cupAnswer();

        const r = await runWithWritePolicy({ suppress: ['segmentationCache'] }, () =>
            insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' }),
        );

        expect(r).toEqual({ success: true, grams: 240, servingLabel: '1 cup' });
        expect(upsert).toHaveBeenCalledTimes(1);
    });

    it('outside any policy the row is written exactly as before', async () => {
        cupAnswer();

        await insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' });

        expect(upsert).toHaveBeenCalledTimes(1);
    });
});
