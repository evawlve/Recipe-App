/**
 * FatSecret retrieval lane (Phase 1) — unit tests with a mocked client.
 *
 * Covers: kill-switch (flag off → []), missing-credentials no-op, per-100g
 * derivation (100g metric panel preference, largest-serving scaling,
 * zero-grams guard), fail-open on client throw + rate-limit, position-score
 * scale, persist upsert shapes (OffFood-convention nutrient keys, sodium
 * mg→g), and drain registration via drainPendingBackgroundTasks().
 */

import type {
    FatSecretFoodSummary,
    FatSecretServing as FatSecretApiServing,
} from '../client';

// Mutable flag object — read lazily via a getter so individual tests can
// flip the kill-switch without jest.resetModules() gymnastics.
const mockFlags = { retrievalEnabled: true };

jest.mock('../config', () => {
    const actual = jest.requireActual('../config');
    return {
        ...actual,
        get FATSECRET_RETRIEVAL_ENABLED() {
            return mockFlags.retrievalEnabled;
        },
        FATSECRET_LANE_TIMEOUT_MS: 800,
        FATSECRET_LANE_MAX_RESULTS: 8,
        // Force "no credentials" for the singleton path — tests inject clients.
        FATSECRET_CLIENT_ID: '',
        FATSECRET_CLIENT_SECRET: '',
    };
});

jest.mock('../../db', () => ({
    prisma: {
        fatSecretFood: { upsert: jest.fn() },
        fatSecretServing: { upsert: jest.fn() },
    },
}));

jest.mock('../../logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

// Loaded lazily in beforeAll so the jest.mock factories above (which close
// over mockFlags) run after module-scope consts are initialized.
let lane: typeof import('../fatsecret-lane');
let deferred: typeof import('../deferred-hydration');
let FatSecretRateLimitError: typeof import('../client').FatSecretRateLimitError;
let mockPrisma: any;
let mockLogger: any;

beforeAll(async () => {
    lane = await import('../fatsecret-lane');
    deferred = await import('../deferred-hydration');
    FatSecretRateLimitError = (await import('../client')).FatSecretRateLimitError;
    mockPrisma = (await import('../../db')).prisma;
    mockLogger = (await import('../../logger')).logger;
});

beforeEach(() => {
    jest.clearAllMocks();
    mockFlags.retrievalEnabled = true;
    lane.__setFatSecretLaneClientForTests(undefined);
    mockPrisma.fatSecretFood.upsert.mockResolvedValue({});
    mockPrisma.fatSecretServing.upsert.mockResolvedValue({});
});

// ============================================================
// Fixtures
// ============================================================

function serving(over: Partial<FatSecretApiServing> = {}): FatSecretApiServing {
    return {
        id: 's1',
        description: '1 serving',
        metricServingAmount: null,
        metricServingUnit: null,
        numberOfUnits: 1,
        measurementDescription: null,
        servingWeightGrams: null,
        calories: null,
        carbohydrate: null,
        protein: null,
        fat: null,
        saturatedFat: null,
        polyunsaturatedFat: null,
        monounsaturatedFat: null,
        transFat: null,
        cholesterol: null,
        sodium: null,
        potassium: null,
        fiber: null,
        sugar: null,
        ...over,
    };
}

/** Exact 100g metric panel: 250 kcal / 20 P / 30 C / 10 F, sodium 400mg. */
function metric100Serving(over: Partial<FatSecretApiServing> = {}): FatSecretApiServing {
    return serving({
        id: 's1',
        description: '100 g',
        measurementDescription: 'g',
        metricServingAmount: 100,
        metricServingUnit: 'g',
        servingWeightGrams: 100,
        calories: 250,
        protein: 20,
        carbohydrate: 30,
        fat: 10,
        fiber: 5,
        sugar: 8,
        sodium: 400,
        saturatedFat: 3,
        ...over,
    });
}

function summary(over: Partial<FatSecretFoodSummary> = {}): FatSecretFoodSummary {
    return {
        id: '12345',
        name: 'Protein Bar',
        brandName: 'Quest',
        foodType: 'Brand',
        description: null,
        country: null,
        servings: [metric100Serving()],
        ...over,
    };
}

function makeClient(result: FatSecretFoodSummary[] | Error) {
    return {
        searchFoodsV4:
            result instanceof Error
                ? jest.fn().mockRejectedValue(result)
                : jest.fn().mockResolvedValue(result),
    };
}

// ============================================================
// Kill-switch & no-op paths
// ============================================================

describe('searchFatSecretLane — gating', () => {
    it('returns [] immediately when FATSECRET_RETRIEVAL_ENABLED is off (client never called)', async () => {
        mockFlags.retrievalEnabled = false;
        const client = makeClient([summary()]);

        const result = await lane.searchFatSecretLane('protein bar', 8, client);

        expect(result).toEqual([]);
        expect(client.searchFoodsV4).not.toHaveBeenCalled();
    });

    it('returns [] when credentials are missing and no client is injected', async () => {
        const result = await lane.searchFatSecretLane('protein bar');
        expect(result).toEqual([]);
    });

    it('returns [] for a blank query without calling the client', async () => {
        const client = makeClient([summary()]);
        const result = await lane.searchFatSecretLane('   ', 8, client);
        expect(result).toEqual([]);
        expect(client.searchFoodsV4).not.toHaveBeenCalled();
    });

    it('passes lane timeout and caps maxResults at 10', async () => {
        const client = makeClient([]);
        await lane.searchFatSecretLane('protein bar', 20, client);
        expect(client.searchFoodsV4).toHaveBeenCalledWith('protein bar', {
            maxResults: 10,
            timeoutMs: 800,
        });

        await lane.searchFatSecretLane('protein bar', undefined, client);
        expect(client.searchFoodsV4).toHaveBeenLastCalledWith('protein bar', {
            maxResults: 8, // FATSECRET_LANE_MAX_RESULTS
            timeoutMs: 800,
        });
    });
});

// ============================================================
// Per-100g derivation
// ============================================================

describe('per-100g derivation', () => {
    it('uses an exact 100g metric serving directly', async () => {
        const client = makeClient([summary()]);
        const [candidate] = await lane.searchFatSecretLane('protein bar', 8, client);

        expect(candidate.id).toBe('fs_12345');
        expect(candidate.source).toBe('fatsecret');
        expect(candidate.name).toBe('Protein Bar');
        expect(candidate.brandName).toBe('Quest');
        expect(candidate.nutrition).toEqual({
            kcal: 250,
            protein: 20,
            carbs: 30,
            fat: 10,
            per100g: true,
        });
    });

    it('prefers the 100g metric panel over a larger gram serving', () => {
        const per100 = lane.derivePer100gFromServings([
            serving({
                id: 'big',
                description: '1 package',
                servingWeightGrams: 200,
                calories: 900, // deliberately different — must NOT win
                protein: 2,
                carbohydrate: 2,
                fat: 2,
            }),
            metric100Serving(),
        ]);

        expect(per100).toMatchObject({ calories: 250, protein: 20, carbs: 30, fat: 10 });
    });

    it('scales the largest gram-weighted serving to per-100g', () => {
        const per100 = lane.derivePer100gFromServings([
            serving({
                id: 'small',
                description: '1 mini bar',
                metricServingAmount: 30,
                metricServingUnit: 'g',
                calories: 120,
                protein: 6,
                carbohydrate: 12,
                fat: 4,
            }),
            serving({
                id: 'bar',
                description: '1 bar',
                metricServingAmount: 50,
                metricServingUnit: 'g',
                calories: 200,
                protein: 10,
                carbohydrate: 20,
                fat: 8,
                sodium: 200, // mg per 50g serving → 400mg/100g → 0.4 g
            }),
        ]);

        expect(per100).toEqual({
            calories: 400,
            protein: 20,
            carbs: 40,
            fat: 16,
            sodium: 0.4,
        });
    });

    it('zero-guard: no usable grams → candidate still emitted with nutrition undefined', async () => {
        const hit = summary({
            servings: [
                serving({
                    id: 'z',
                    description: '1 unit',
                    metricServingAmount: 0,
                    metricServingUnit: 'g',
                    servingWeightGrams: 0,
                    calories: 100,
                }),
            ],
        });
        const client = makeClient([hit]);

        const [candidate] = await lane.searchFatSecretLane('protein bar', 8, client);

        expect(candidate).toBeDefined();
        expect(candidate.id).toBe('fs_12345');
        expect(candidate.nutrition).toBeUndefined();
        expect(candidate.servings).toBeUndefined(); // no gram-bearing servings
    });

    it('exposes gram-bearing servings as {description, grams}', async () => {
        const hit = summary({
            servings: [
                serving({ id: 'a', description: '1 bar', metricServingAmount: 50, metricServingUnit: 'g', calories: 200 }),
                serving({ id: 'b', description: null, measurementDescription: 'cup', servingWeightGrams: 240, calories: 150 }),
                serving({ id: 'c', description: '1 mystery' }), // no grams → dropped
            ],
        });
        const client = makeClient([hit]);

        const [candidate] = await lane.searchFatSecretLane('protein bar', 8, client);

        expect(candidate.servings).toEqual([
            { description: '1 bar', grams: 50 },
            { description: 'cup', grams: 240 }, // measurementDescription fallback
        ]);
    });
});

// ============================================================
// Score scale
// ============================================================

describe('score scale', () => {
    it('decays the positional base by rank with a 0.5 floor', async () => {
        // Names share no token with the query → no name-quality multiplier,
        // the raw positional base is exposed.
        const hits = Array.from({ length: 10 }, (_, i) =>
            summary({ id: String(1000 + i), name: `Unrelated Item${i}x` })
        );
        const client = makeClient(hits);

        const candidates = await lane.searchFatSecretLane('quinoa', 10, client);

        const expected = [0.95, 0.93, 0.91, 0.89, 0.87, 0.85, 0.83, 0.81, 0.79, 0.77];
        expect(candidates).toHaveLength(10);
        candidates.forEach((c, i) => expect(c.score).toBeCloseTo(expected[i], 10));
    });

    it('multiplies by name quality so full-coverage hits saturate ORIGINAL_SCORE', async () => {
        const hits = [
            // Full coverage (both query tokens in name+brand) → ×1.5
            summary({ id: '1', name: 'Protein Bar', brandName: 'Quest' }),
            // Partial coverage (1 of 2 tokens) → ×1.2
            summary({ id: '2', name: 'Granola Bar' }),
            // No coverage → base only
            summary({ id: '3', name: 'Orange Juice' }),
        ];
        const client = makeClient(hits);

        const candidates = await lane.searchFatSecretLane('protein bar', 8, client);

        expect(candidates[0].score).toBeCloseTo(0.95 * 1.5, 10); // clamps to 1 in rerank
        expect(candidates[1].score).toBeCloseTo(0.93 * 1.2, 10);
        expect(candidates[2].score).toBeCloseTo(0.91, 10);
        // A full-coverage hit deep in the list still beats a no-coverage top hit
        expect(candidates[0].score).toBeGreaterThan(1);
    });
});

// ============================================================
// Fail-open
// ============================================================

describe('fail-open', () => {
    it('returns [] and warns once when the client throws', async () => {
        const client = makeClient(new Error('boom'));

        const result = await lane.searchFatSecretLane('protein bar', 8, client);

        expect(result).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });

    it('returns [] on FatSecretRateLimitError (429 does not propagate)', async () => {
        const client = makeClient(new FatSecretRateLimitError('rate limit exceeded', 429));

        await expect(lane.searchFatSecretLane('protein bar', 8, client)).resolves.toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });
});

// ============================================================
// Persistence
// ============================================================

describe('persistFatSecretHits', () => {
    it('upserts FatSecretFood with OffFood-convention per-100g keys (sodium mg→g)', async () => {
        await lane.persistFatSecretHits([summary()]);

        expect(mockPrisma.fatSecretFood.upsert).toHaveBeenCalledTimes(1);
        const call = mockPrisma.fatSecretFood.upsert.mock.calls[0][0];
        expect(call.where).toEqual({ fsId: '12345' });
        expect(call.create).toMatchObject({
            fsId: '12345',
            name: 'Protein Bar',
            brandName: 'Quest',
            foodType: 'Brand',
            defaultServingId: 's1',
            nutrientsPer100g: {
                calories: 250,
                protein: 20,
                carbs: 30,
                fat: 10,
                fiber: 5,
                sugars: 8,      // plural, matching OffFood ingest keys
                sodium: 0.4,    // grams per 100g, not mg
                saturatedFat: 3,
            },
        });
        expect(call.create.fetchedAt).toBeInstanceOf(Date);
        expect(call.update.fetchedAt).toBeInstanceOf(Date);
        expect(call.update.nutrientsPer100g).toEqual(call.create.nutrientsPer100g);
    });

    it('upserts each serving on the fsId+servingId compound key with raw per-serving nutrients', async () => {
        await lane.persistFatSecretHits([summary()]);

        expect(mockPrisma.fatSecretServing.upsert).toHaveBeenCalledTimes(1);
        const call = mockPrisma.fatSecretServing.upsert.mock.calls[0][0];
        expect(call.where).toEqual({
            fsId_servingId: { fsId: '12345', servingId: 's1' },
        });
        expect(call.create).toMatchObject({
            fsId: '12345',
            servingId: 's1',
            description: '100 g',
            measurementDescription: 'g',
            grams: 100,
            volumeMl: null,
            numberOfUnits: 1,
            nutrients: {
                calories: 250,
                protein: 20,
                carbohydrate: 30, // raw fatsecret field names, unconverted
                fat: 10,
                fiber: 5,
                sugar: 8,
                sodium: 400, // raw mg
                saturatedFat: 3,
            },
        });
    });

    it('skips servings without an id or description and survives per-hit upsert failures', async () => {
        mockPrisma.fatSecretFood.upsert
            .mockRejectedValueOnce(new Error('db down'))
            .mockResolvedValue({});

        const badHit = summary({ id: '111' });
        const goodHit = summary({
            id: '222',
            servings: [
                metric100Serving({ id: null }), // no serving_id → skipped
                metric100Serving({ id: 's9', description: null, measurementDescription: null }), // no description → skipped
            ],
        });

        await expect(lane.persistFatSecretHits([badHit, goodHit])).resolves.toBeUndefined();

        // badHit failed (logged), goodHit's food row still written
        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
        expect(mockPrisma.fatSecretFood.upsert).toHaveBeenCalledTimes(2);
        expect(mockPrisma.fatSecretServing.upsert).not.toHaveBeenCalled();
    });

    it('lane registers the persist with the background drain (drainPendingBackgroundTasks awaits it)', async () => {
        // Make the upsert async-slow enough that it cannot have completed inline
        let resolveUpsert!: (v: unknown) => void;
        mockPrisma.fatSecretFood.upsert.mockImplementation(
            () => new Promise(resolve => { resolveUpsert = resolve; })
        );

        const client = makeClient([summary({ servings: [] })]);
        const candidates = await lane.searchFatSecretLane('protein bar', 8, client);
        expect(candidates).toHaveLength(1);

        // Persist is in flight in the background; drain must await it
        const drain = deferred.drainPendingBackgroundTasks();
        resolveUpsert({});
        await drain;

        expect(mockPrisma.fatSecretFood.upsert).toHaveBeenCalledTimes(1);
    });
});
