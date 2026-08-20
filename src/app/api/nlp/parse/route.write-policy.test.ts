/**
 * /api/nlp/parse — `nosave=1` must refuse the AI-serving writes, not just the FoodMapping one.
 *
 * WHAT THIS PINS. `nosave=1` used to mean only "do not write FoodMapping": a cold measurement
 * run still self-warmed `FdcServing`/`OffServing`/`AiGeneratedServing` through
 * `insertFdcAiServing()`, `insertAiServing()`, `backfillWeightServing()` and the ambiguous-unit
 * backfill, so the first run on an `fdc_volume_ai` line wrote the row the NEXT run then read
 * back as `fdc_volume_cached`. The measurement was warming what it measured.
 *
 * WHY IT IS A TRIPWIRE, NOT A UNIT TEST. It imports nothing that does not exist on the pre-fix
 * tree — no `write-policy` import, no new option, no new field name from the route — so it
 * COMPILES AND RUNS on master and fails there by SYMPTOM: the upsert happens (1) and the
 * receipt header is absent (2). The three controls are green on both trees, which is what makes
 * the two REDs mean something. Transcript is in the PR body.
 *
 * THE ANTI-`dryRun` PIN (test 3). `insertFdcAiServing()` already had a `dryRun` option and it
 * is NOT what this uses: `dryRun` returns `{ success: true }` with NO grams, and the volume
 * caller in `serving/hydration-lane.ts` reads a missing `grams` as failure and silently reroutes
 * to the hardcoded `volume_unit` density — a suppressed run would then measure a different
 * pipeline from the real one. The suppression return is IDENTICAL to the persisted path
 * (`success` + `grams` + `servingLabel`); only the row is not written. If someone ever
 * "simplifies" the guard into a `dryRun` call, test 3 goes red.
 *
 * Harness: route.debug-echo.test.ts's mocks (supabase, prisma, structured client,
 * map-ingredient-with-fallback, resolve-payload), plus the FDC estimator — and the mapper stub
 * calls the REAL `insertFdcAiServing()` so a genuine writer runs inside the request.
 */

import { NextRequest } from 'next/server';
import { POST } from './route';

const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } })),
}));

jest.mock('@/lib/db', () => ({
  prisma: {
    nlpRequestLog: { count: jest.fn(), create: jest.fn() },
    mappingEventLog: { createMany: jest.fn() },
    segmentationCache: {
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    // The real writer under test reads this food and upserts this serving table.
    fdcFood: { findUnique: jest.fn() },
    fdcServing: { upsert: jest.fn() },
  },
}));

jest.mock('@/lib/ai/structured-client', () => ({
  callStructuredLlm: jest.fn(),
}));

// The model answer the real writer acts on. Mocked at the module boundary, so
// insertFdcAiServing() itself runs for real — density band, guards and all.
jest.mock('@/lib/ai/serving-estimator', () => {
  const actual = jest.requireActual('@/lib/ai/serving-estimator');
  return { ...actual, requestAiServing: jest.fn() };
});

jest.mock('@/lib/mapping/map-ingredient-with-fallback', () => ({
  mapIngredientWithFallback: jest.fn(),
}));

jest.mock('@/lib/nlp/resolve-payload', () => ({
  resolveFoodDetails: jest.fn(),
  isDegenerateNutrition: jest.fn(() => false),
  per100gFromBilledMacros: jest.fn(() => null),
  isPer100gInconsistentWithBilled: jest.fn(() => false),
}));

/** fdc_747997 "Egg, white, raw, fresh" — the record behind the flapping 33/65 g rows. */
const EGG_WHITE_FOOD = {
  fdcId: 747997,
  description: 'Egg, white, raw, fresh',
  brandName: null,
  dataType: 'foundation',
  servings: [{ description: 'large', grams: 33 }],
};

/** A clean volume answer: 1 cup = 240 g, density 1.0 — inside the band, nothing to refuse. */
const CUP_ANSWER = {
  status: 'success' as const,
  prompt: 'mock',
  suggestion: {
    servingLabel: '1 cup',
    grams: 240,
    volumeUnit: 'cup',
    volumeAmount: 1,
    confidence: 0.9,
    rationale: 'a cup of egg whites is about 240 g',
  },
};

const DETAILS = {
  name: 'Egg, white, raw, fresh',
  brandName: null,
  source: 'fdc',
  nutritionPer100g: { kcal100: 52, protein100: 10.9, carbs100: 0.7, fat100: 0.2, fiber100: 0, sugar100: 0, sodium100: 0 },
  servingOptions: [{ label: '1 cup (240 g)', grams: 240, isDefault: true }],
};

const DEV_KEY = 'adminAPI_dev_key_bypass';

function devRequest(body: object, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nlp/parse${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': DEV_KEY },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse nosave=1 refuses AI-serving writes', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { prisma } = require('@/lib/db');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { resolveFoodDetails } = require('@/lib/nlp/resolve-payload');
  const { requestAiServing } = require('@/lib/ai/serving-estimator');
  /* eslint-enable @typescript-eslint/no-var-requires */

  /** What the real writer handed back to its caller on the last request. */
  let writerReturn: { success: boolean; reason?: string; grams?: number; servingLabel?: string } | null = null;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    // Fail-closed route (2026-08-20): the bypass key must come from the env — there is no
    // fallback literal to fall back onto — so pin the exact key the requests below send.
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    delete process.env.MAPPING_EVENT_LOG_ENABLED;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    writerReturn = null;

    prisma.mappingEventLog.createMany.mockResolvedValue({ count: 0 });
    prisma.nlpRequestLog.count.mockResolvedValue(0);
    prisma.nlpRequestLog.create.mockResolvedValue({});
    prisma.fdcFood.findUnique.mockResolvedValue(EGG_WHITE_FOOD);
    prisma.fdcServing.upsert.mockResolvedValue({});
    requestAiServing.mockResolvedValue(CUP_ANSWER);
    resolveFoodDetails.mockResolvedValue(DETAILS);

    // The mapper stub is where a real request's volume rung lives: it calls the REAL
    // insertFdcAiServing() and bills the grams that writer returns, exactly as
    // buildFdcResult()'s volume branch does.
    mapIngredientWithFallback.mockImplementation(async (_line: string, opts: { telemetry?: { cacheHit?: string | null } }) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { insertFdcAiServing } = require('@/lib/usda/fdc-ai-backfill');
      const ai = await insertFdcAiServing(747997, 'volume', { targetUnit: 'cup' });
      writerReturn = ai;
      if (opts?.telemetry) opts.telemetry.cacheHit = null;
      return {
        foodId: 'fdc_747997',
        foodName: 'Egg, white, raw, fresh',
        brandName: null,
        source: 'fdc',
        confidence: 0.9,
        grams: ai.grams ?? 0,
        kcal: 124.8,
        protein: 26.2,
        carbs: 1.7,
        fat: 0.5,
        servingDescription: '1 cup',
        servingTier: 'fdc_volume_ai',
      };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // 1. THE POINT — RED on the pre-fix tree.
  // ------------------------------------------------------------------
  test('nosave=1: the FdcServing upsert never happens', async () => {
    const res = await POST(devRequest({ items: ['1 cup egg whites'] }, '?nosave=1'));

    expect(res.status).toBe(200);
    expect(prisma.fdcServing.upsert).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // 2. CONTROL — green on both trees. The writer is reachable and does write.
  // ------------------------------------------------------------------
  test('without the flag the same line writes the row exactly once', async () => {
    const res = await POST(devRequest({ items: ['1 cup egg whites'] }));

    expect(res.status).toBe(200);
    expect(prisma.fdcServing.upsert).toHaveBeenCalledTimes(1);
  });

  // ------------------------------------------------------------------
  // 3. THE ANTI-dryRun PIN — green on both trees, and the reason the guard
  //    cannot be re-implemented as `dryRun: true`.
  // ------------------------------------------------------------------
  test('nosave=1: the caller still receives the grams the writer computed', async () => {
    const res = await POST(devRequest({ items: ['1 cup egg whites'] }, '?nosave=1'));
    const [item] = await res.json();

    // The writer's return is the persisted path's return, byte for byte.
    expect(writerReturn).toEqual({ success: true, grams: 240, servingLabel: '1 cup' });
    // …and the value survived all the way onto the wire.
    expect(item.grams).toBe(240);
  });

  // ------------------------------------------------------------------
  // 4. THE RECEIPT — RED on the pre-fix tree (no header at all).
  //    `consulted` is the fail-open detector: 0 here would mean the writers and
  //    the route are looking at different stores, not that nothing was refused.
  // ------------------------------------------------------------------
  test('nosave=1: the response carries an X-Write-Receipt naming the refusal', async () => {
    const res = await POST(devRequest({ items: ['1 cup egg whites'] }, '?nosave=1'));

    const header = res.headers.get('X-Write-Receipt');
    expect(header).toBeTruthy();

    const receipt = JSON.parse(header as string);
    expect(receipt.consulted).toBeGreaterThanOrEqual(1);
    expect(receipt.refusedTotal).toBe(1);
    expect(receipt.refused).toHaveLength(1);
    expect(receipt.refused[0]).toMatchObject({ kind: 'aiServing', table: 'FdcServing' });
    expect(receipt.refused[0].key).toContain('747997');
  });

  // ------------------------------------------------------------------
  // 5. CONTROL — green on both trees. No flag, no receipt on the wire.
  // ------------------------------------------------------------------
  test('without the flag the response carries no receipt header', async () => {
    const res = await POST(devRequest({ items: ['1 cup egg whites'] }));

    expect(res.headers.get('X-Write-Receipt')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Auth fails closed (2026-08-20). The two 401 legs live here because this file
// already owns the dev-key request helper; the third leg — env-set key =>
// authorized — is every 200 in the suite above. Neither test reaches the DB or
// the mapper: the route refuses before either is touched.
// ---------------------------------------------------------------------------
describe('/api/nlp/parse dev-key auth fails closed', () => {
  test('with DEV_API_KEY unset, the retired fallback literal is refused', async () => {
    const saved = process.env.DEV_API_KEY;
    try {
      delete process.env.DEV_API_KEY;
      const res = await POST(devRequest({ items: ['1 cup egg whites'] }));
      expect(res.status).toBe(401);
    } finally {
      process.env.DEV_API_KEY = saved as string;
    }
  });

  test('a wrong key without a bearer token is refused', async () => {
    const res = await POST(
      new NextRequest('http://localhost:3000/api/nlp/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'not-the-key' },
        body: JSON.stringify({ items: ['1 cup egg whites'] }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
