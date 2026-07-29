/**
 * FatSecret FK persist race (Jul 2026).
 *
 * FoodMapping.fsId is a FOREIGN KEY to FatSecretFood.fsId, but the lane writes
 * those parent rows fire-and-forget. On a food's first-ever sighting the child
 * write can beat its parent, the FK rejects it, and saveValidatedMapping
 * swallows the error — so the funnel reports `saved` for a row that was never
 * written. Warm batch 01 reported 92 saves and wrote 81 rows.
 *
 * The DB mock below ENFORCES the foreign key (foodMapping.upsert throws P2003
 * while the parent is absent) and the parent write is deliberately slow, so
 * these tests exercise the real ordering rather than asserting on a spy.
 *
 * The bound matters as much as the fix: 8 of the 67 measured FK failures were
 * `update` branches against hot validatedBy='ai' incumbents (`cooked rice`,
 * `cooked pasta`, the bare key `chicken`). The wait is therefore insert-bound —
 * see the second describe block.
 */

import type { FatSecretFoodSummary } from '../client';

const PARENT_WRITE_DELAY_MS = 25;

// Simulated database ------------------------------------------------------
/** fsId values whose FatSecretFood parent row has actually landed. */
const fsParentRows = new Set<string>();
/** normalizedForm → stored FoodMapping row. */
const foodMappingRows = new Map<string, Record<string, unknown>>();

function foreignKeyError(): Error {
    const err = new Error(
        'Foreign key constraint violated on the constraint: `FoodMapping_fsId_fkey`'
    );
    (err as Error & { code?: string }).code = 'P2003';
    return err;
}

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
        // Pinned, NOT inherited from `actual`. This suite reproduces the FK race between a
        // FoodMapping insert and the fire-and-forget parent persist — a race that only
        // exists while the lane persists speculatively. The shipped default is 0
        // (winner-only), under which there is no in-flight write to race and every test
        // here would pass without exercising anything.
        FATSECRET_PERSIST_RUNNERS_UP: 8,
        // Force "no credentials" so the singleton path never builds a real
        // client; every test injects its own.
        FATSECRET_CLIENT_ID: '',
        FATSECRET_CLIENT_SECRET: '',
    };
});

jest.mock('../../db', () => ({
    prisma: {
        // Parent write: slow on purpose — this IS the race window.
        fatSecretFood: {
            upsert: jest.fn(async (args: { where: { fsId: string } }) => {
                await new Promise(resolve => setTimeout(resolve, PARENT_WRITE_DELAY_MS));
                fsParentRows.add(args.where.fsId);
                return {};
            }),
        },
        fatSecretServing: {
            upsert: jest.fn(async () => ({})),
            findFirst: jest.fn(async () => null),
        },
        offFood: {
            findUnique: jest.fn(async () => null),
        },
        foodMapping: {
            findUnique: jest.fn(async (args: { where: { normalizedForm: string } }) =>
                foodMappingRows.get(args.where.normalizedForm) ?? null
            ),
            // Child write: enforces the foreign key the real schema declares.
            upsert: jest.fn(async (args: {
                where: { normalizedForm: string };
                create: Record<string, unknown>;
                update: Record<string, unknown>;
            }) => {
                const existing = foodMappingRows.get(args.where.normalizedForm);
                const data = existing ? { ...existing, ...args.update } : args.create;
                const fsId = data.fsId as string | null | undefined;
                if (fsId && !fsParentRows.has(fsId)) throw foreignKeyError();
                foodMappingRows.set(args.where.normalizedForm, data);
                return data;
            }),
            update: jest.fn(async () => ({})),
        },
    },
}));

jest.mock('../../logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { saveValidatedMapping } from '../validated-mapping-helpers';
import {
    searchFatSecretLane,
    __setFatSecretLaneClientForTests,
    __resetPendingFatSecretPersistForTests,
} from '../fatsecret-lane';
import { drainPendingBackgroundTasks } from '../deferred-hydration';
import { canonicalizeCacheKey } from '../normalization-rules';
import type { FatsecretMappedIngredient } from '../map-ingredient-with-fallback';
import type { AIValidationResult } from '../ai-validation';

const FS_ID = '4482913';

function hit(): FatSecretFoodSummary {
    return {
        id: FS_ID,
        name: 'Kohlrabi Fritters',
        brandName: null,
        foodType: 'Generic',
        servings: [
            {
                id: 's1',
                description: '100 g',
                measurementDescription: 'g',
                metricServingAmount: 100,
                metricServingUnit: 'g',
                numberOfUnits: 1,
                calories: 118,
                protein: 3.4,
                carbohydrate: 12,
                fat: 6.2,
            },
        ],
    } as FatSecretFoodSummary;
}

function makeMapping(over: Partial<FatsecretMappedIngredient>): FatsecretMappedIngredient {
    return {
        foodId: `fs_${FS_ID}`,
        foodName: 'Kohlrabi Fritters',
        brandName: undefined,
        grams: 100,
        kcal: 118,
        protein: 3.4,
        carbs: 12,
        fat: 6.2,
        ...over,
    } as FatsecretMappedIngredient;
}

const validation = { confidence: 0.95 } as AIValidationResult;

/** Client that answers instantly; only the PERSIST is slow. */
function makeClient(hits: FatSecretFoodSummary[]) {
    return { searchFoodsV4: jest.fn(async () => hits) };
}

beforeEach(() => {
    jest.clearAllMocks();
    fsParentRows.clear();
    foodMappingRows.clear();
    mockFlags.retrievalEnabled = true;
    __setFatSecretLaneClientForTests(undefined);
    __resetPendingFatSecretPersistForTests();
});

afterEach(async () => {
    // Let the slow background persist finish so it cannot leak into the next
    // test (or keep an open handle).
    await drainPendingBackgroundTasks();
});

describe('FoodMapping save vs. the fire-and-forget FatSecret persist', () => {
    it('writes the row on a first-ever sighting, while the parent persist is still in flight', async () => {
        const candidates = await searchFatSecretLane('kohlrabi fritters', 8, makeClient([hit()]));
        expect(candidates).toHaveLength(1);
        // The race window: the child write is about to happen and the parent
        // row does NOT exist yet.
        expect(fsParentRows.has(FS_ID)).toBe(false);

        await saveValidatedMapping('kohlrabi fritters', makeMapping({}), validation, {
            canonicalBase: 'kohlrabi fritters',
        });

        const key = canonicalizeCacheKey('kohlrabi fritters');
        expect(foodMappingRows.get(key)).toMatchObject({
            normalizedForm: key,
            fsId: FS_ID,
            source: 'fatsecret',
        });
    });

    it('still saves normally once the persist has drained (no behavior change off the race path)', async () => {
        await searchFatSecretLane('kohlrabi fritters', 8, makeClient([hit()]));
        await drainPendingBackgroundTasks();
        expect(fsParentRows.has(FS_ID)).toBe(true);

        await saveValidatedMapping('kohlrabi fritters', makeMapping({}), validation, {
            canonicalBase: 'kohlrabi fritters',
        });

        expect(foodMappingRows.get(canonicalizeCacheKey('kohlrabi fritters'))).toBeDefined();
    });
});

describe('the wait is insert-bound', () => {
    // An UNBOUNDED version of this fix — waiting for the parent on every
    // fatsecret save — would let these 8 measured update-branch failures land,
    // displacing hot 'ai' incumbents. `cooked rice` is exactly the row golden
    // case n-cook-01 locks.
    const COOKED_RICE_KEY = canonicalizeCacheKey('cooked rice');

    function seedIncumbent() {
        foodMappingRows.set(COOKED_RICE_KEY, {
            normalizedForm: COOKED_RICE_KEY,
            foodName: 'Brown Parboiled Cooked Uncle Bens Rice',
            offBarcode: '0054800020058',
            fdcId: null,
            fsId: null,
            source: 'openfoodfacts',
            validatedBy: 'ai',
            aiConfidence: 0.5, // low enough that the cross-source margin passes
        });
    }

    it('does NOT wait for the parent when a row already exists, so the incumbent survives', async () => {
        seedIncumbent();
        await searchFatSecretLane('cooked rice', 8, makeClient([
            { ...hit(), name: 'Cooked Rice' } as FatSecretFoodSummary,
        ]));
        expect(fsParentRows.has(FS_ID)).toBe(false);

        await saveValidatedMapping('cooked rice', makeMapping({ foodName: 'Cooked Rice' }), validation, {
            canonicalBase: 'cooked rice',
        });

        // Proof it did not wait: the slow parent write is still pending.
        expect(fsParentRows.has(FS_ID)).toBe(false);
        // Proof it did not displace: the incumbent row is byte-identical.
        expect(foodMappingRows.get(COOKED_RICE_KEY)).toMatchObject({
            foodName: 'Brown Parboiled Cooked Uncle Bens Rice',
            offBarcode: '0054800020058',
            fsId: null,
        });
    });

    it('leaves an existing row alone even after the parent lands (the FK was never the guard)', async () => {
        seedIncumbent();
        await searchFatSecretLane('cooked rice', 8, makeClient([
            { ...hit(), name: 'Cooked Rice' } as FatSecretFoodSummary,
        ]));
        await drainPendingBackgroundTasks();

        // With the parent present the FK no longer blocks anything, so this
        // asserts what actually protects the incumbent: the cross-source
        // displacement margin / downgrade guards, not the persist race.
        await saveValidatedMapping('cooked rice', makeMapping({ foodName: 'Cooked Rice' }), {
            confidence: 0.5,
        } as AIValidationResult, {
            canonicalBase: 'cooked rice',
        });

        expect(foodMappingRows.get(COOKED_RICE_KEY)).toMatchObject({
            foodName: 'Brown Parboiled Cooked Uncle Bens Rice',
        });
    });
});
