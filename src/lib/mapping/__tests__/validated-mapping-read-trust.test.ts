/**
 * Read-time trust for human-triage cache rows (PR D pt3, B6, HUMAN_ROW_TRUST).
 *
 * FoodMapping rows stamped validatedBy='human-triage' are deliberate triage
 * repoints — the read path's NAME-heuristic rejections (core-token coverage,
 * NUTRITIONAL_MODIFIERS, cooking-state/critical-modifier) must not evict
 * them. The canonical kill case: a 'mayonnaise' → 'Light Mayonnaise' repoint
 * died on the 'light' nutritional modifier. Trust is provenance-gated ('ai'
 * rows keep the old behavior) and kill-switched via HUMAN_ROW_TRUST='0'.
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
    isTrustedHumanRow,
    isHumanTrustSkippableEscape,
} from '../validated-mapping-helpers';
import { logger } from '../../logger';

const HUMAN_BARCODE = '0011110000001';

function humanRow(overrides: Record<string, unknown> = {}) {
    return {
        normalizedForm: 'mayonnaise',
        foodName: 'Light Mayonnaise',
        brandName: null,
        source: 'openfoodfacts',
        offBarcode: HUMAN_BARCODE,
        fdcId: null,
        aiConfidence: 0.95,
        validatedBy: 'human-triage',
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
    delete process.env.HUMAN_ROW_TRUST; // default = trust on
});

afterAll(() => {
    if (ORIGINAL_TRUST === undefined) delete process.env.HUMAN_ROW_TRUST;
    else process.env.HUMAN_ROW_TRUST = ORIGINAL_TRUST;
});

describe('read-time trust on getValidatedMappingByNormalizedName', () => {
    it("serves a human-triage row that trips NUTRITIONAL_MODIFIERS ('Light Mayonnaise' class)", async () => {
        mockFoodMappingFindUnique.mockResolvedValue(humanRow());
        const debugSpy = jest.spyOn(logger, 'debug');

        const result = await getValidatedMappingByNormalizedName('mayonnaise', 'openfoodfacts');

        expect(result).not.toBeNull();
        expect(result!.foodName).toBe('Light Mayonnaise');
        expect(result!.foodId).toBe(`off_${HUMAN_BARCODE}`);
        expect(result!.validatedBy).toBe('human-triage');
        // Usage stats still bump on a trusted serve.
        expect(mockFoodMappingUpdate).toHaveBeenCalledTimes(1);
        // Telemetry hook: trust saves are countable.
        expect(debugSpy).toHaveBeenCalledWith('cache.human_row_trusted', expect.objectContaining({
            key: 'mayonnaise',
            foodId: `off_${HUMAN_BARCODE}`,
        }));
        debugSpy.mockRestore();
    });

    it("HUMAN_ROW_TRUST='0' kill-switch restores the old rejection", async () => {
        process.env.HUMAN_ROW_TRUST = '0';
        mockFoodMappingFindUnique.mockResolvedValue(humanRow());

        const result = await getValidatedMappingByNormalizedName('mayonnaise', 'openfoodfacts');

        expect(result).toBeNull();
    });

    it("an 'ai' row tripping the same heuristic is still rejected", async () => {
        mockFoodMappingFindUnique.mockResolvedValue(humanRow({ validatedBy: 'ai' }));

        const result = await getValidatedMappingByNormalizedName('mayonnaise', 'openfoodfacts');

        expect(result).toBeNull();
    });

    it('trust also covers the core-token rejection (cross-name identity repoint)', async () => {
        // Query token 'tuna' absent from the repointed food name — the
        // core-token check kills this for ai rows, trust serves it.
        const row = humanRow({ normalizedForm: 'tuna', foodName: 'Wild Planet Skipjack Fillets' });
        mockFoodMappingFindUnique.mockResolvedValue(row);

        const served = await getValidatedMappingByNormalizedName('tuna', 'openfoodfacts');
        expect(served).not.toBeNull();
        expect(served!.foodName).toBe('Wild Planet Skipjack Fillets');

        // Same shape without human provenance → old behavior (rejected).
        mockFoodMappingFindUnique.mockResolvedValue({ ...row, validatedBy: 'ai' });
        expect(await getValidatedMappingByNormalizedName('tuna', 'openfoodfacts')).toBeNull();
    });

    it('a human-triage row that trips NO heuristic serves without the trust log', async () => {
        mockFoodMappingFindUnique.mockResolvedValue(humanRow({ foodName: 'Mayonnaise' }));
        const debugSpy = jest.spyOn(logger, 'debug');

        const result = await getValidatedMappingByNormalizedName('mayonnaise', 'openfoodfacts');

        expect(result).not.toBeNull();
        expect(debugSpy).not.toHaveBeenCalledWith('cache.human_row_trusted', expect.anything());
        debugSpy.mockRestore();
    });
});

describe('isTrustedHumanRow predicate', () => {
    it('true for human-triage rows when the flag is unset (default on) or "1"', () => {
        expect(isTrustedHumanRow('human-triage')).toBe(true);
        process.env.HUMAN_ROW_TRUST = '1';
        expect(isTrustedHumanRow('human-triage')).toBe(true);
    });

    it('false when the kill-switch is set', () => {
        process.env.HUMAN_ROW_TRUST = '0';
        expect(isTrustedHumanRow('human-triage')).toBe(false);
    });

    it('false for ai / missing provenance regardless of the flag', () => {
        expect(isTrustedHumanRow('ai')).toBe(false);
        expect(isTrustedHumanRow(undefined)).toBe(false);
        expect(isTrustedHumanRow(null)).toBe(false);
    });
});

describe('isHumanTrustSkippableEscape (mapper-level skip set)', () => {
    it('covers exactly the five NAME-heuristic escapes', () => {
        for (const reason of [
            'category_mismatch',
            'multi_ingredient',
            'modifier_mismatch',
            'replacement_mismatch',
            'brand_guard',
            // Human repoints routinely cross naming conventions (key 'prawns'
            // → FDC "Crustaceans, shrimp, ...") — the mapper-side core-token
            // twin must not undo the helper-side skip.
            'core_token_mismatch',
        ]) {
            expect(isHumanTrustSkippableEscape(reason)).toBe(true);
        }
    });

    it('never covers nutrition-invalid or serving-shape (counted-piece/cooked-grain) escapes', () => {
        // A human repoint fixes identity, not per-piece/cooked serving shape —
        // these escapes must keep firing on human rows.
        for (const reason of [
            'nutrition_invalid',
            'count_label',
            'grain_cooked',
        ]) {
            expect(isHumanTrustSkippableEscape(reason)).toBe(false);
        }
    });
});
