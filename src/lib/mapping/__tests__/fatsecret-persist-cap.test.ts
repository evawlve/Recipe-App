/**
 * Runners-up cap on FatSecret cache writes.
 *
 * The lane asks FatSecret for 8 candidates per query and used to persist all 8. Measured
 * 2026-07-28: 23,814 `FatSecretFood` rows, only 564 backing a `FoodMapping` — 97.6% of the
 * cache was speculative copies of a third party's database for foods no user ever chose.
 *
 * The cap alone is NOT safe, which is what these tests exist to lock. Rerank order is not
 * lane order, so the winner is routinely a hit the cap deferred; `FoodMapping.fsId` is a
 * FOREIGN KEY to `FatSecretFood.fsId`, so saving a mapping whose parent was never written
 * fails the FK and `saveValidatedMapping` swallows it — the mapping is silently never
 * cached. That exact failure cost warm batch 01 31.4% of its FatSecret saves. So the cap
 * must be paired with `ensureFatSecretParentPersisted`, and the test that matters most
 * here is "a DEFERRED hit that wins still gets persisted".
 */
process.env.FATSECRET_RETRIEVAL_ENABLED = '1';
process.env.FATSECRET_PERSIST_RUNNERS_UP = '2';

jest.mock('@/lib/db', () => ({
  prisma: {
    fatSecretFood: {
      upsert: jest.fn().mockResolvedValue({}),
      // Default "not ours yet" — the interesting case. A test that wants the row to already
      // exist says so explicitly.
      findUnique: jest.fn().mockResolvedValue(null),
    },
    fatSecretServing: { upsert: jest.fn().mockResolvedValue({}) },
  },
}));

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import * as lane from '../fatsecret-lane';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

const db = prisma as unknown as {
  fatSecretFood: { upsert: jest.Mock; findUnique: jest.Mock };
};

/** Eight hits, as the lane receives them from FatSecret. */
function hits(n = 8) {
  return Array.from({ length: n }, (_, i) => ({
    id: `fs${i + 1}`,
    name: `Food ${i + 1}`,
    brandName: null,
    foodType: 'Brand',
    servings: [
      { id: `s${i + 1}`, description: '1 serving', metricServingAmount: 100, metricServingUnit: 'g', calories: 100, protein: 5, carbohydrate: 10, fat: 2 },
    ],
  })) as any;
}

const fakeClient = (payload: any) => ({ searchFoodsV4: jest.fn().mockResolvedValue(payload) });

const persistedIds = () => db.fatSecretFood.upsert.mock.calls.map(c => c[0].where.fsId);

beforeEach(() => {
  jest.clearAllMocks();
  db.fatSecretFood.findUnique.mockResolvedValue(null);
  lane.__resetPendingFatSecretPersistForTests();
  lane.__resetDeferredFatSecretHitsForTests();
  lane.__setFatSecretLaneClientForTests(undefined);
});

afterAll(() => {
  lane.__setFatSecretLaneClientForTests(undefined);
});

describe('speculative persist is capped', () => {
  test('writes only the first 2 of 8 hits', async () => {
    const candidates = await lane.searchFatSecretLane('protein bar', undefined, fakeClient(hits()) as any);
    await lane.awaitPendingFatSecretPersist('fs1');

    // All 8 still reach RERANK. This is the lane's internal pool, NOT a wire payload —
    // `/api/nlp/parse` returns one winner per line and has no alternates field. Reading this
    // assertion as "the user can choose from 8" is the conflation that briefly justified the
    // cap for the wrong reason.
    expect(candidates).toHaveLength(8);
    expect(persistedIds()).toEqual(['fs1', 'fs2']);
    // The assertion that dies if the cap is removed:
    expect(persistedIds()).not.toContain('fs8');
  });

  test('all 8 still enter the rerank pool — the cap is about storage, not retrieval', async () => {
    const candidates = await lane.searchFatSecretLane('protein bar', undefined, fakeClient(hits()) as any);
    expect(candidates.map((c: any) => c.id)).toEqual(
      ['fs1', 'fs2', 'fs3', 'fs4', 'fs5', 'fs6', 'fs7', 'fs8'].map(i => `fs_${i}`),
    );
  });

  test('a query returning fewer hits than the cap persists all of them', async () => {
    await lane.searchFatSecretLane('rare food', undefined, fakeClient(hits(1)) as any);
    await lane.awaitPendingFatSecretPersist('fs1');
    expect(persistedIds()).toEqual(['fs1']);
  });
});

describe('the winner is persisted regardless of the cap', () => {
  test('THE ONE THAT MATTERS: a deferred hit that wins is persisted on demand', async () => {
    await lane.searchFatSecretLane('protein bar', undefined, fakeClient(hits()) as any);
    await lane.awaitPendingFatSecretPersist('fs1');
    expect(persistedIds()).not.toContain('fs6');

    // Rerank picks fs6 — a hit the cap deferred. Without the on-demand persist the
    // FoodMapping insert would fail its FK and the mapping would be lost silently.
    await lane.ensureFatSecretParentPersisted('fs6');

    expect(persistedIds()).toContain('fs6');
  });

  test('is idempotent — a second call does not re-write the row', async () => {
    await lane.searchFatSecretLane('protein bar', undefined, fakeClient(hits()) as any);
    await lane.ensureFatSecretParentPersisted('fs6');
    const after = db.fatSecretFood.upsert.mock.calls.length;
    await lane.ensureFatSecretParentPersisted('fs6');
    expect(db.fatSecretFood.upsert.mock.calls.length).toBe(after);
  });

  test('an already-persisted winner needs no extra write', async () => {
    await lane.searchFatSecretLane('protein bar', undefined, fakeClient(hits()) as any);
    await lane.awaitPendingFatSecretPersist('fs1');
    const after = db.fatSecretFood.upsert.mock.calls.length;
    await lane.ensureFatSecretParentPersisted('fs1');
    expect(db.fatSecretFood.upsert.mock.calls.length).toBe(after);
  });

  test('an unknown fsId is a no-op, not a throw', async () => {
    await expect(lane.ensureFatSecretParentPersisted('never-seen')).resolves.toBeUndefined();
  });

  test('a failing persist does not throw into the save path', async () => {
    await lane.searchFatSecretLane('protein bar', undefined, fakeClient(hits()) as any);
    db.fatSecretFood.upsert.mockRejectedValueOnce(new Error('db down'));
    await expect(lane.ensureFatSecretParentPersisted('fs7')).resolves.toBeUndefined();
  });
});

/**
 * The user-override path. The runners-up exist so a user can correct an automatic pick, and
 * that correction lands in a LATER request — by then the in-process deferred map has evicted
 * the entry (FIFO-capped, and empty after any restart). Every earlier case misses, so without
 * a refetch the override fails `FoodMapping`'s FK and loses the mapping with no error. This is
 * the same silent-loss shape that cost warm batch 01 31.4% of its saves, one request later.
 */
describe('an override for a candidate we never stored refetches it', () => {
  const withGetFood = (details: any) => ({
    searchFoodsV4: jest.fn().mockResolvedValue([]),
    getFood: jest.fn().mockResolvedValue(details),
  });

  const details = {
    id: 'fs-override',
    name: 'Overridden Food',
    brandName: 'Brand',
    foodType: 'Brand',
    servings: [
      { id: 'so1', description: '1 serving', metricServingAmount: 100, metricServingUnit: 'g', calories: 250, protein: 9, carbohydrate: 30, fat: 8 },
    ],
  };

  test('THE OVERRIDE CASE: not deferred, not in Postgres → fetched and persisted', async () => {
    const client = withGetFood(details);
    lane.__setFatSecretLaneClientForTests(client as any);

    await lane.ensureFatSecretParentPersisted('fs-override');

    expect(client.getFood).toHaveBeenCalledWith('fs-override');
    expect(persistedIds()).toContain('fs-override');
  });

  test('does NOT refetch a row Postgres already has', async () => {
    const client = withGetFood(details);
    lane.__setFatSecretLaneClientForTests(client as any);
    db.fatSecretFood.findUnique.mockResolvedValue({ fsId: 'fs-override' });

    await lane.ensureFatSecretParentPersisted('fs-override');

    // The assertion that dies if the PK check is dropped — every save would hit the API.
    expect(client.getFood).not.toHaveBeenCalled();
    expect(persistedIds()).not.toContain('fs-override');
  });

  test('prefers the in-memory deferred hit over a network call', async () => {
    const client = {
      searchFoodsV4: jest.fn().mockResolvedValue(hits()),
      getFood: jest.fn().mockResolvedValue(details),
    };
    lane.__setFatSecretLaneClientForTests(client as any);
    await lane.searchFatSecretLane('protein bar', undefined, client as any);

    await lane.ensureFatSecretParentPersisted('fs6'); // deferred by the cap

    expect(client.getFood).not.toHaveBeenCalled();
    expect(persistedIds()).toContain('fs6');
  });

  test.each([
    ['a client with no getFood', { searchFoodsV4: jest.fn() }],
    ['getFood resolving null', { searchFoodsV4: jest.fn(), getFood: jest.fn().mockResolvedValue(null) }],
    ['getFood rejecting', { searchFoodsV4: jest.fn(), getFood: jest.fn().mockRejectedValue(new Error('429')) }],
  ])('never throws into the save path: %s', async (_label, client) => {
    lane.__setFatSecretLaneClientForTests(client as any);
    await expect(lane.ensureFatSecretParentPersisted('fs-override')).resolves.toBeUndefined();
    expect(persistedIds()).not.toContain('fs-override');
  });

  /**
   * A refetch that comes back empty is behaviourally identical to one that is never
   * attempted — `persistFatSecretHits` swallows the bad entry either way. The ONLY thing
   * that distinguishes "FatSecret does not have this id" from "we never asked" is the log
   * line, and that is precisely what someone debugging a silently-dropped override reads.
   * Deleting the guard survived a mutation run until this test existed.
   */
  test('an empty refetch is reported, not swallowed', async () => {
    lane.__setFatSecretLaneClientForTests({
      searchFoodsV4: jest.fn(),
      getFood: jest.fn().mockResolvedValue(null),
    } as any);

    await lane.ensureFatSecretParentPersisted('fs-override');

    expect(logger.warn).toHaveBeenCalledWith(
      'fatsecret_lane.parent_refetch_empty',
      expect.objectContaining({ fsId: 'fs-override' }),
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      'fatsecret_lane.parent_refetched',
      expect.anything(),
    );
  });

  test('a findUnique failure degrades to a no-op rather than a throw', async () => {
    lane.__setFatSecretLaneClientForTests(withGetFood(details) as any);
    db.fatSecretFood.findUnique.mockRejectedValue(new Error('db down'));
    await expect(lane.ensureFatSecretParentPersisted('fs-override')).resolves.toBeUndefined();
  });
});

/**
 * The shipped default is 0 — nothing speculative at all. Loaded in an isolated module
 * registry because the cap is read from the environment once, at import.
 */
describe('at the default cap of 0', () => {
  test('persists nothing speculatively, but the winner still lands', async () => {
    const prev = process.env.FATSECRET_PERSIST_RUNNERS_UP;
    jest.resetModules();
    // UNSET, not '0'. Setting it to '0' would pin the env override and let the DEFAULT drift
    // back to 2 unnoticed — which is exactly what happened on the first mutation run.
    delete process.env.FATSECRET_PERSIST_RUNNERS_UP;
    try {
      const lane0 = require('../fatsecret-lane');
      const db0 = require('@/lib/db').prisma;
      db0.fatSecretFood.findUnique.mockResolvedValue(null);

      await lane0.searchFatSecretLane('protein bar', undefined, fakeClient(hits()) as any);
      await lane0.awaitPendingFatSecretPersist('fs1');

      // The assertion that dies if the default drifts back off 0.
      expect(db0.fatSecretFood.upsert.mock.calls).toHaveLength(0);

      await lane0.ensureFatSecretParentPersisted('fs4');
      expect(db0.fatSecretFood.upsert.mock.calls.map((c: any) => c[0].where.fsId)).toContain('fs4');
    } finally {
      if (prev === undefined) delete process.env.FATSECRET_PERSIST_RUNNERS_UP;
      else process.env.FATSECRET_PERSIST_RUNNERS_UP = prev;
      jest.resetModules();
    }
  });
});
