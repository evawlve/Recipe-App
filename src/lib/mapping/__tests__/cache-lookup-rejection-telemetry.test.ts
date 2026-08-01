/**
 * Cache-lookup rejection telemetry.
 *
 * getValidatedMappingByNormalizedName has two very different ways to return
 * null — no row existed, or a row existed and the identity checks rejected it —
 * and callers could not tell them apart. Every helper-level rejection was
 * therefore written to MappingEventLog as `cacheHit=NULL, cacheEscape=NULL`,
 * byte-identical to a cold key, which hid a real failure class: rows the
 * pipeline writes under a key it can then never serve, so they re-resolve on
 * every request forever.
 *
 * The discriminating assertion in this file is the NEGATIVE one — "no row" and
 * "served a row" must both leave `reason` null. A test that only checked the
 * rejection paths would pass against an implementation that set the reason
 * unconditionally, which would be worse than no telemetry at all.
 *
 * Mocks only the db (save-gates pattern); the real filter heuristics run.
 */

const mockFoodMappingFindUnique = jest.fn();
const mockFoodMappingFindMany = jest.fn();
const mockFoodMappingUpdate = jest.fn();
const mockAiGeneratedFindFirst = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        foodMapping: {
            findUnique: (...args: unknown[]) => mockFoodMappingFindUnique(...args),
            findMany: (...args: unknown[]) => mockFoodMappingFindMany(...args),
            update: (...args: unknown[]) => mockFoodMappingUpdate(...args),
        },
        aiGeneratedFood: {
            findFirst: (...args: unknown[]) => mockAiGeneratedFindFirst(...args),
        },
    },
}));

import {
    getValidatedMappingByNormalizedName,
    type CacheLookupRejection,
} from '../validated-mapping-helpers';

const BARCODE = '0011110000001';

function row(overrides: Record<string, unknown> = {}) {
    return {
        normalizedForm: 'mayonnaise',
        foodName: 'Light Mayonnaise',
        brandName: null,
        source: 'openfoodfacts',
        offBarcode: BARCODE,
        fdcId: null,
        fsId: null,
        aiConfidence: 0.95,
        validatedBy: 'ai',
        ...overrides,
    };
}

const ORIGINAL_TRUST = process.env.HUMAN_ROW_TRUST;

beforeEach(() => {
    jest.clearAllMocks();
    mockFoodMappingFindUnique.mockResolvedValue(null);
    mockFoodMappingFindMany.mockResolvedValue([]);
    mockFoodMappingUpdate.mockResolvedValue({});
    mockAiGeneratedFindFirst.mockResolvedValue(null);
    delete process.env.HUMAN_ROW_TRUST;
});

afterAll(() => {
    if (ORIGINAL_TRUST === undefined) delete process.env.HUMAN_ROW_TRUST;
    else process.env.HUMAN_ROW_TRUST = ORIGINAL_TRUST;
});

describe('CacheLookupRejection out-param', () => {
    it('records nutritional_modifier when a row is found and rejected on a modifier', async () => {
        // 'Light Mayonnaise' cached under key 'mayonnaise': the query never says
        // "light", so the row is a different product and is correctly rejected.
        mockFoodMappingFindUnique.mockResolvedValue(row());
        const rejection: CacheLookupRejection = { reason: null };

        const result = await getValidatedMappingByNormalizedName(
            'mayonnaise', 'openfoodfacts', undefined, rejection,
        );

        expect(result).toBeNull();
        expect(rejection.reason).toBe('nutritional_modifier:light');
        expect(rejection.foodName).toBe('Light Mayonnaise');
        expect(rejection.normalizedForm).toBe('mayonnaise');
    });

    it('records core_token_mismatch when the cached row is a different food', async () => {
        mockFoodMappingFindUnique.mockResolvedValue(row({
            normalizedForm: 'mayonnaise',
            foodName: 'Chocolate Fudge Brownie',
        }));
        const rejection: CacheLookupRejection = { reason: null };

        const result = await getValidatedMappingByNormalizedName(
            'mayonnaise', 'openfoodfacts', undefined, rejection,
        );

        expect(result).toBeNull();
        expect(rejection.reason).toBe('core_token_mismatch');
    });

    it('records the rejected ROW IDENTITY, not just its key', async () => {
        // The save-time forfeit (escaped incumbents lose their cross-source
        // margin) matches on the record, because the lookup key and the save key
        // are not always the same row — legacy-key and token-set fallbacks hit
        // rows stored under other keys. Without targetKey the forfeit would have
        // to trust that they coincide.
        mockFoodMappingFindUnique.mockResolvedValue(row({ foodName: 'Chocolate Fudge Brownie' }));
        const rejection: CacheLookupRejection = { reason: null };

        await getValidatedMappingByNormalizedName('mayonnaise', 'openfoodfacts', undefined, rejection);

        expect(rejection.targetKey).toBe(`off:${BARCODE}`);
    });

    it('leaves targetKey null for a row that names no record', async () => {
        mockFoodMappingFindUnique.mockResolvedValue(row({
            foodName: 'Mayonnaise', offBarcode: null, fdcId: null, fsId: null,
        }));
        const rejection: CacheLookupRejection = { reason: null };

        const result = await getValidatedMappingByNormalizedName(
            'mayonnaise', 'openfoodfacts', undefined, rejection,
        );

        expect(result).toBeNull();
        expect(rejection.reason).toBe('no_target_column');
        // Nothing to forfeit: such a row can never be a cross-source incumbent.
        expect(rejection.targetKey).toBeNull();
    });

    // ---- The negative assertions. These are what make the telemetry meaningful. ----

    it('leaves reason NULL when no row exists (the cold-key case)', async () => {
        mockFoodMappingFindUnique.mockResolvedValue(null);
        mockFoodMappingFindMany.mockResolvedValue([]);
        const rejection: CacheLookupRejection = { reason: null };

        const result = await getValidatedMappingByNormalizedName(
            'nothing cached here', 'openfoodfacts', undefined, rejection,
        );

        expect(result).toBeNull();
        // A cold key and a rejected row must stay distinguishable — this is the
        // entire point of the out-param.
        expect(rejection.reason).toBeNull();
    });

    it('leaves reason NULL when the row is served', async () => {
        mockFoodMappingFindUnique.mockResolvedValue(row({ foodName: 'Mayonnaise' }));
        const rejection: CacheLookupRejection = { reason: null };

        const result = await getValidatedMappingByNormalizedName(
            'mayonnaise', 'openfoodfacts', undefined, rejection,
        );

        expect(result).not.toBeNull();
        expect(rejection.reason).toBeNull();
    });

    it('leaves reason NULL when read-time trust serves a human-triage row', async () => {
        // Trusted rows skip the NAME-heuristic rejections and ARE served, so
        // nothing was bypassed. Counting these would inflate the population —
        // the exact error that made an earlier hand count read 74 instead of 58.
        mockFoodMappingFindUnique.mockResolvedValue(row({ validatedBy: 'human-triage' }));
        const rejection: CacheLookupRejection = { reason: null };

        const result = await getValidatedMappingByNormalizedName(
            'mayonnaise', 'openfoodfacts', undefined, rejection,
        );

        expect(result).not.toBeNull();
        expect(result!.foodName).toBe('Light Mayonnaise');
        expect(rejection.reason).toBeNull();
    });

    it('is optional — omitting it changes nothing', async () => {
        mockFoodMappingFindUnique.mockResolvedValue(row());

        await expect(
            getValidatedMappingByNormalizedName('mayonnaise', 'openfoodfacts'),
        ).resolves.toBeNull();
    });
});
