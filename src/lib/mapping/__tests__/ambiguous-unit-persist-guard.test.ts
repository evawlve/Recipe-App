/**
 * B3 — the ambiguous-unit PERSIST guard.
 *
 * `upsertServing()` routes any id that is not `fdc_`/`off_` into
 * `AiGeneratedServing`, whose FK targets `AiGeneratedFood.id`. No `fs_` row
 * exists there, so every FatSecret ambiguous estimate raised
 * `AiGeneratedServing_foodId_fkey` and was swallowed by the caller's catch:
 * 311 warns box-wide over 61 foods / 167 food+unit pairs, measured 2026-08-05
 * (`ssh owner@192.168.1.133 'grep -h ambiguous_backfill.save_failed
 * /home/owner/Recipe-App/logs/*.log | grep -c "\"foodId\":\"fs_"'`).
 *
 * Two guards live here and they are NOT the same guard:
 *
 *   1. the `fs_` short-circuit — an id with no write target must not attempt a
 *      write at all, must still return its estimate, and must not claim `saved`;
 *   2. the surviving `try`/`catch` around the write — a genuine `fdc_`/`off_`
 *      failure must stay LOUD. 27 of the 338 historical `save_failed` lines are
 *      non-`fs_`, so this catch has a live population; deleting it to "clean up
 *      after the guard" would hide that class.
 *
 * Neither guard may be widened into a write target: writing `FatSecretServing`
 * (DNB-1) crosses the attribution boundary and flips 5 records SHAPELESS→SHAPED
 * at the save gate, and seeding an `AiGeneratedFood` shell (DNB-2) fabricates a
 * 0-kcal selectable search result. See
 * `sync-docs/reports/2026-08-05_serving-fix-build-order.md` §1.
 */

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcServing: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
        },
        offServing: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
        },
        aiGeneratedServing: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
        },
    },
}));

jest.mock('../../logger', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        audit: jest.fn(),
    },
}));

// The deterministic rungs must not answer first — this file is about the rung
// BELOW them, where an estimate exists and has to be persisted (or not).
jest.mock('../../servings/default-count-grams', () => ({
    getSubPieceDefault: jest.fn().mockReturnValue(null),
    getDefaultCountServing: jest.fn().mockReturnValue(null),
}));

jest.mock('../../ai/ambiguous-serving-estimator', () => {
    const actual = jest.requireActual('../../ai/ambiguous-serving-estimator');
    return {
        ...actual,
        estimateAmbiguousServing: jest.fn(),
    };
});

import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import { estimateAmbiguousServing } from '../../ai/ambiguous-serving-estimator';
import { prisma } from '../../db';
import { logger } from '../../logger';

const mockedEstimate = estimateAmbiguousServing as jest.Mock;
const mockedAiServingUpsert = prisma.aiGeneratedServing.upsert as jest.Mock;
const mockedOffServingUpsert = prisma.offServing.upsert as jest.Mock;
const mockedFdcServingUpsert = prisma.fdcServing.upsert as jest.Mock;
const mockedQueryRaw = prisma.$queryRaw as jest.Mock;
const mockedWarn = logger.warn as jest.Mock;
const mockedInfo = logger.info as jest.Mock;
const mockedDebug = logger.debug as jest.Mock;

/** fs_37040 "Almonds" + "handful" is the live regression pool's own case. */
const ESTIMATE = {
    status: 'success' as const,
    estimatedGrams: 30,
    confidence: 0.8,
    reasoning: 'a handful of almonds is about 30 g',
};

beforeEach(() => {
    jest.clearAllMocks();
    mockedQueryRaw.mockResolvedValue([]);
    mockedEstimate.mockResolvedValue(ESTIMATE);
    mockedAiServingUpsert.mockResolvedValue({});
    mockedOffServingUpsert.mockResolvedValue({});
    mockedFdcServingUpsert.mockResolvedValue({});
});

// ------------------------------------------------------------------
// Guard 1 — the fs_ short-circuit
// ------------------------------------------------------------------

describe('guard 1: an fs_ id has no write target and must not attempt a write', () => {
    it('never reaches AiGeneratedServing.upsert for an fs_ id', async () => {
        await getOrCreateAmbiguousServing('fs_37040', 'Almonds', 'handful');

        expect(mockedAiServingUpsert).not.toHaveBeenCalled();
        expect(mockedOffServingUpsert).not.toHaveBeenCalled();
        expect(mockedFdcServingUpsert).not.toHaveBeenCalled();
    });

    it('still returns the estimate — the guard is on persistence, never on the answer', async () => {
        const r = await getOrCreateAmbiguousServing('fs_37040', 'Almonds', 'handful');

        expect(r).toEqual({ status: 'success', grams: 30, confidence: 0.8 });
    });

    it('does not claim "saved", and does not warn "save_failed" either', async () => {
        await getOrCreateAmbiguousServing('fs_37040', 'Almonds', 'handful');

        const infoMsgs = mockedInfo.mock.calls.map((c) => c[0]);
        const warnMsgs = mockedWarn.mock.calls.map((c) => c[0]);
        expect(infoMsgs).not.toContain('ambiguous_backfill.saved');
        expect(warnMsgs).not.toContain('ambiguous_backfill.save_failed');
    });

    it('records the skip at debug so the population stays countable', async () => {
        await getOrCreateAmbiguousServing('fs_37040', 'Almonds', 'handful');

        expect(mockedDebug).toHaveBeenCalledWith(
            'ambiguous_backfill.persist_skipped_no_target',
            expect.objectContaining({ foodId: 'fs_37040', unit: 'handful', grams: 30 }),
        );
    });

    it('is narrow: a genuine AiGeneratedFood id still persists and still logs "saved"', async () => {
        // A cuid, not an `fs_` id — the trailing else must keep working.
        await getOrCreateAmbiguousServing('clx0000aigenfood01', 'House Chili', 'bowl');

        expect(mockedAiServingUpsert).toHaveBeenCalledTimes(1);
        expect(mockedInfo.mock.calls.map((c) => c[0])).toContain('ambiguous_backfill.saved');
    });
});

// ------------------------------------------------------------------
// Guard 2 — the try/catch warn on a REAL write failure
// ------------------------------------------------------------------

describe('guard 2: a genuine fdc_/off_ write failure stays loud', () => {
    it('warns ambiguous_backfill.save_failed when the off_ upsert rejects', async () => {
        mockedOffServingUpsert.mockRejectedValue(new Error('db exploded'));

        const r = await getOrCreateAmbiguousServing('off_0123456789012', 'Trail Mix', 'handful');

        expect(mockedWarn).toHaveBeenCalledWith(
            'ambiguous_backfill.save_failed',
            expect.objectContaining({ foodId: 'off_0123456789012', error: 'db exploded' }),
        );
        // and the request is still answered
        expect(r.status).toBe('success');
        expect(r.grams).toBe(30);
    });

    it('warns ambiguous_backfill.save_failed when the fdc_ upsert rejects', async () => {
        mockedFdcServingUpsert.mockRejectedValue(new Error('fk violation'));

        await getOrCreateAmbiguousServing('fdc_1662920', 'Bell Pepper', 'handful');

        expect(mockedWarn).toHaveBeenCalledWith(
            'ambiguous_backfill.save_failed',
            expect.objectContaining({ foodId: 'fdc_1662920', error: 'fk violation' }),
        );
    });

    it('does not log "saved" when the write threw', async () => {
        mockedOffServingUpsert.mockRejectedValue(new Error('db exploded'));

        await getOrCreateAmbiguousServing('off_0123456789012', 'Trail Mix', 'handful');

        expect(mockedInfo.mock.calls.map((c) => c[0])).not.toContain('ambiguous_backfill.saved');
    });
});
