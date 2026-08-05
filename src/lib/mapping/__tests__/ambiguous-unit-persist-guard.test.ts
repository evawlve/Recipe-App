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
 * THE DB MOCK ENFORCES THE FOREIGN KEY. An earlier version of this file mocked
 * `aiGeneratedServing.upsert` to RESOLVE, which meant the suite only ever
 * encoded "the guard must not call upsert for `fs_`" — a spy assertion that
 * shares its mental model with the guard. It could not distinguish "the guard
 * works" from "there was never anything to guard against". So `aiGeneratedFood`
 * is simulated as a table of ids, `aiGeneratedServing.upsert` throws Prisma's
 * P2003 when the parent is absent, and `AI_GENERATED_FOOD_IDS` deliberately
 * contains no `fs_` entry — reproducing the measurement above. The same fixture
 * is used to show a NON-`fs_` orphan still reaching the FK and still warning, so
 * the mock is proven capable of rejecting before it is trusted to stay silent.
 * (Shape borrowed from `fatsecret-fk-persist-race.test.ts`, which enforces
 * `FoodMapping_fsId_fkey` the same way.)
 *
 * Three guards live here and they are NOT the same guard:
 *
 *   1. the `fs_` short-circuit in `upsertServing()` — an id with no write target
 *      must not attempt a write, must still return its estimate, must not claim
 *      `saved`, and must say so at **`warn`**: the box has no `LOG_LEVEL` in its
 *      `.env` and `resolveThreshold()` defaults production to `warn`, so a
 *      `debug` line is invisible on the only host that has this population;
 *   2. the surviving `try`/`catch` around the write — a genuine `fdc_`/`off_`
 *      failure must stay LOUD. 27 of the 338 historical `save_failed` lines are
 *      non-`fs_`, and `FdcServing.fdcId`/`OffServing.barcode` are foreign keys
 *      too, so deleting this catch to "clean up after the guard" would hide a
 *      class that can still fire;
 *   3. the matching short-circuit in `findExistingServing()` — the READ side.
 *      The same FK that rejects the write makes an `fs_` row impossible to read
 *      (0 of 608 `AiGeneratedServing` rows, measured 2026-08-05), so the query
 *      was a guaranteed miss. Symmetry is the guard: an asymmetric version
 *      invites "the read works, so the write must be fine".
 *
 * Neither guard may be widened into a write target: writing `FatSecretServing`
 * (DNB-1) crosses the attribution boundary and flips 5 records SHAPELESS→SHAPED
 * at the save gate, and seeding an `AiGeneratedFood` shell (DNB-2) fabricates a
 * 0-kcal selectable search result. See
 * `sync-docs/reports/2026-08-05_serving-fix-build-order.md` §1.
 */

/**
 * Simulated `AiGeneratedFood` id set — the FK's parent table.
 *
 * NO `fs_` ENTRY, ON PURPOSE. `SELECT count(*) FROM "AiGeneratedFood" WHERE id
 * LIKE 'fs_%'` returns 0 on the box (measured 2026-08-05). Adding one here to
 * "make a test pass" would silently model DNB-2, which is refuted.
 */
const AI_GENERATED_FOOD_IDS = new Set<string>(['clx0000aigenfood01']);

/** Prisma's foreign-key rejection, as `AiGeneratedServing.foodId` actually raises it. */
function foreignKeyError(): Error {
    const err = new Error(
        'Foreign key constraint failed on the field: `AiGeneratedServing_foodId_fkey (index)`'
    );
    (err as Error & { code?: string }).code = 'P2003';
    return err;
}

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
            // Enforces the foreign key the real schema declares.
            upsert: jest.fn(async (args: { where: { foodId_label: { foodId: string } } }) => {
                const foodId = args.where.foodId_label.foodId;
                if (!AI_GENERATED_FOOD_IDS.has(foodId)) throw foreignKeyError();
                return {};
            }),
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
const mockedAiServingFind = prisma.aiGeneratedServing.findUnique as jest.Mock;
const mockedOffServingUpsert = prisma.offServing.upsert as jest.Mock;
const mockedOffServingFind = prisma.offServing.findUnique as jest.Mock;
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

const msgs = (m: jest.Mock) => m.mock.calls.map((c) => c[0]);

beforeEach(() => {
    jest.clearAllMocks();
    mockedQueryRaw.mockResolvedValue([]);
    mockedEstimate.mockResolvedValue(ESTIMATE);
    mockedAiServingFind.mockResolvedValue(null);
    mockedOffServingFind.mockResolvedValue(null);
    mockedOffServingUpsert.mockResolvedValue({});
    mockedFdcServingUpsert.mockResolvedValue({});
});

// ------------------------------------------------------------------
// Fixture fidelity — prove the FK can reject BEFORE trusting silence
// ------------------------------------------------------------------

describe('fixture: the mock enforces AiGeneratedServing_foodId_fkey', () => {
    it('rejects an fs_ id with P2003 — this is what the guard prevents reaching', async () => {
        await expect(
            prisma.aiGeneratedServing.upsert({
                where: { foodId_label: { foodId: 'fs_37040', label: 'handful' } },
                create: {},
                update: {},
            } as never)
        ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('accepts an id that IS in AiGeneratedFood', async () => {
        await expect(
            prisma.aiGeneratedServing.upsert({
                where: { foodId_label: { foodId: 'clx0000aigenfood01', label: 'bowl' } },
                create: {},
                update: {},
            } as never)
        ).resolves.toBeDefined();
    });
});

// ------------------------------------------------------------------
// Guard 1 — the fs_ short-circuit in upsertServing()
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

        expect(msgs(mockedInfo)).not.toContain('ambiguous_backfill.saved');
        expect(msgs(mockedWarn)).not.toContain('ambiguous_backfill.save_failed');
    });

    it('records the skip at WARN, not debug — the box runs at warn', async () => {
        await getOrCreateAmbiguousServing('fs_37040', 'Almonds', 'handful');

        expect(mockedWarn).toHaveBeenCalledWith(
            'ambiguous_backfill.persist_skipped_no_target',
            expect.objectContaining({ foodId: 'fs_37040', unit: 'handful', grams: 30 }),
        );
        // A debug line would be invisible on the only host with this population.
        expect(msgs(mockedDebug)).not.toContain('ambiguous_backfill.persist_skipped_no_target');
    });

    it('is narrow: a genuine AiGeneratedFood id still persists and still logs "saved"', async () => {
        await getOrCreateAmbiguousServing('clx0000aigenfood01', 'House Chili', 'bowl');

        expect(mockedAiServingUpsert).toHaveBeenCalledTimes(1);
        expect(msgs(mockedInfo)).toContain('ambiguous_backfill.saved');
    });
});

// ------------------------------------------------------------------
// Guard 2 — the try/catch warn on a REAL write failure
// ------------------------------------------------------------------

describe('guard 2: a genuine write failure stays loud', () => {
    it('warns save_failed when the FK rejects a NON-fs_ orphan — the class the catch exists for', async () => {
        // A cuid with no AiGeneratedFood parent: the guard does not cover it, so
        // it reaches the same FK that would have rejected fs_37040 above.
        await getOrCreateAmbiguousServing('clx9999orphanfood9', 'Ghost Stew', 'bowl');

        expect(mockedAiServingUpsert).toHaveBeenCalledTimes(1);
        expect(mockedWarn).toHaveBeenCalledWith(
            'ambiguous_backfill.save_failed',
            expect.objectContaining({
                foodId: 'clx9999orphanfood9',
                error: expect.stringContaining('AiGeneratedServing_foodId_fkey'),
            }),
        );
        expect(msgs(mockedInfo)).not.toContain('ambiguous_backfill.saved');
    });

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

        expect(msgs(mockedInfo)).not.toContain('ambiguous_backfill.saved');
    });
});

// ------------------------------------------------------------------
// Guard 3 — the READ side is short-circuited symmetrically
// ------------------------------------------------------------------

describe('guard 3: findExistingServing() does not query for an fs_ id', () => {
    it('never calls AiGeneratedServing.findUnique for an fs_ id', async () => {
        await getOrCreateAmbiguousServing('fs_37040', 'Almonds', 'handful');

        expect(mockedAiServingFind).not.toHaveBeenCalled();
    });

    it('still queries for an id that HAS a write target', async () => {
        await getOrCreateAmbiguousServing('clx0000aigenfood01', 'House Chili', 'bowl');

        expect(mockedAiServingFind).toHaveBeenCalled();
    });

    it('a cached fs_ row is unreachable by construction, so the estimator still runs', async () => {
        // Even if something contrived to put a row there, the read is skipped —
        // and the FK means no such row can exist (0 of 608, measured 2026-08-05).
        mockedAiServingFind.mockResolvedValue({ grams: 999 });

        const r = await getOrCreateAmbiguousServing('fs_37040', 'Almonds', 'handful');

        expect(r.status).toBe('success');
        expect(r.grams).toBe(30);
    });
});

// ------------------------------------------------------------------
// Guard 4 — the sibling-borrow call site reports its own persistence
// ------------------------------------------------------------------

describe('guard 4: sibling-borrow carries persisted, it does not assume it', () => {
    it('logs sibling_borrow with persisted:true when the OFF row was written', async () => {
        mockedQueryRaw.mockResolvedValue([
            { grams: 40, description: '1 bar (40g)' },
            { grams: 42, description: '1 bar (42g)' },
            { grams: 41, description: '1 bar (41g)' },
        ]);

        const r = await getOrCreateAmbiguousServing(
            'off_0123456789012', 'Protein Bar', 'bar', 'Acme',
        );

        expect(r.status).toBe('success');
        expect(mockedOffServingUpsert).toHaveBeenCalledTimes(1);
        expect(mockedInfo).toHaveBeenCalledWith(
            'ambiguous_backfill.sibling_borrow',
            expect.objectContaining({ persisted: true }),
        );
        // The estimator must NOT have run — the borrow answered.
        expect(mockedEstimate).not.toHaveBeenCalled();
    });

    it('the OFF-only guard holds, so an fs_ id never reaches the sibling-borrow log at all', async () => {
        // NAME MATTERS HERE. An earlier name said this pinned `persisted:false` on a borrow event;
        // it does the opposite — it asserts the borrow never happens for an fs_ id, because
        // borrowSiblingServing() is OFF-only today. NOTHING asserts `persisted:false` on a
        // sibling_borrow event, and nothing can until that function is widened. A reader scanning
        // test NAMES would have believed coverage exists that does not, which is this repo's
        // signature drift shape one layer down.
        //
        // The assertion exists so that widening borrowSiblingServing() without widening
        // upsertServing()'s targets cannot go unnoticed: it flips from `toBeUndefined()` to a
        // logged event the moment the guard moves, and whoever widens it must then decide what
        // `persisted` should read.
        mockedQueryRaw.mockResolvedValue([
            { grams: 40, description: '1 bar (40g)' },
            { grams: 42, description: '1 bar (42g)' },
        ]);

        await getOrCreateAmbiguousServing('fs_37040', 'Protein Bar', 'bar', 'Acme');

        const borrow = mockedInfo.mock.calls.find(
            (c) => c[0] === 'ambiguous_backfill.sibling_borrow',
        );
        expect(borrow).toBeUndefined(); // OFF-only guard held
        expect(mockedAiServingUpsert).not.toHaveBeenCalled();
    });
});
