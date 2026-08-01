/**
 * A wrong normalization stops being permanent.
 *
 * Before 2026-08-01 saveAiNormalizeCache's `update:` clause wrote useCount, lastUsedAt,
 * isMultiIngredient and splitIngredients. normalizedName, canonicalBase, synonyms,
 * prepPhrases, sizePhrases, cookingModifier, isBranded and all five nutrition columns were
 * create-only, and the repo had no TTL, no version column and no deleteMany against this
 * table. A row's derivation was final.
 *
 * The two halves have to ship together. aiNormalizeIngredient() returns early on a cache
 * hit and only re-saves after an LLM call, so a version gate WITHOUT the widened update
 * clause would mark rows stale and then be unable to heal a single one.
 */

const mockQueryRaw = jest.fn();
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockUpsert = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
        aiNormalizeCache: {
            findUnique: (...args: unknown[]) => mockFindUnique(...args),
            update: (...args: unknown[]) => mockUpdate(...args),
            upsert: (...args: unknown[]) => mockUpsert(...args),
        },
    },
}));

import {
    getAiNormalizeCache,
    saveAiNormalizeCache,
    computeNormalizedKey,
    RULES_VERSION,
} from '../validated-mapping-helpers';

function storedRow(overrides: Record<string, unknown> = {}) {
    return {
        normalizedKey: 'peanut butter',
        rawLine: 'jif peanut butter',
        normalizedName: 'peanut butter',
        canonicalBase: 'peanut butter',
        synonyms: ['pb'],
        prepPhrases: [],
        sizePhrases: [],
        cookingModifier: null,
        estimatedCaloriesPer100g: 588,
        estimatedProteinPer100g: 25,
        estimatedCarbsPer100g: 20,
        estimatedFatPer100g: 50,
        nutritionConfidence: 0.8,
        isBranded: true,
        isMultiIngredient: false,
        splitIngredients: null,
        rulesVersion: RULES_VERSION,
        useCount: 3,
        ...overrides,
    };
}

beforeEach(() => {
    mockQueryRaw.mockReset().mockResolvedValue([]);
    mockFindUnique.mockReset().mockResolvedValue(null);
    mockUpdate.mockReset().mockResolvedValue(undefined);
    mockUpsert.mockReset().mockResolvedValue(undefined);
});

describe('the read path is one round-trip', () => {
    it('touches and fetches in a single call on a hit', async () => {
        mockQueryRaw.mockResolvedValue([storedRow()]);

        const cached = await getAiNormalizeCache('jif peanut butter');

        expect(cached?.normalizedName).toBe('peanut butter');
        expect(mockQueryRaw).toHaveBeenCalledTimes(1);
        // The findUnique-then-update pair this replaces was two round-trips per hit.
        expect(mockFindUnique).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('performs no second statement on a miss', async () => {
        mockQueryRaw.mockResolvedValue([]);

        expect(await getAiNormalizeCache('nothing stored here')).toBeNull();
        expect(mockQueryRaw).toHaveBeenCalledTimes(1);
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('binds the key as a parameter, and scopes the UPDATE with a WHERE', async () => {
        mockQueryRaw.mockResolvedValue([]);
        await getAiNormalizeCache('jif peanut butter');

        const [strings, ...values] = mockQueryRaw.mock.calls[0];
        const sql = (strings as string[]).join('?');
        // Without the WHERE this statement increments every row in the table.
        expect(sql).toMatch(/WHERE\s+"normalizedKey"\s*=/);
        expect(sql).toMatch(/RETURNING\s+\*/);
        expect(values).toEqual([computeNormalizedKey('jif peanut butter')]);
    });
});

describe('a stale derivation reads as a miss', () => {
    it('returns null when the stored rulesVersion is behind', async () => {
        mockQueryRaw.mockResolvedValue([storedRow({ rulesVersion: RULES_VERSION - 1 })]);

        expect(await getAiNormalizeCache('jif peanut butter')).toBeNull();
    });

    it('still records the read, so re-derivation stays traffic-proportional', async () => {
        mockQueryRaw.mockResolvedValue([storedRow({ rulesVersion: RULES_VERSION - 1 })]);

        await getAiNormalizeCache('jif peanut butter');

        // The increment is part of the same statement as the read: a stale row that is
        // never read again costs nothing, and one that is hot is refilled on its next miss.
        expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    });

    it('serves a row at the current version', async () => {
        mockQueryRaw.mockResolvedValue([storedRow({ rulesVersion: RULES_VERSION })]);

        expect(await getAiNormalizeCache('jif peanut butter')).not.toBeNull();
    });
});

describe('the refill rewrites the derived columns', () => {
    it('writes every derivation and the version on the update branch', async () => {
        await saveAiNormalizeCache('jif peanut butter', {
            normalizedName: 'peanut butter',
            canonicalBase: 'peanut butter',
            synonyms: ['pb'],
            prepPhrases: [],
            sizePhrases: [],
            isBranded: true,
            nutritionEstimate: {
                caloriesPer100g: 588, proteinPer100g: 25, carbsPer100g: 20,
                fatPer100g: 50, confidence: 0.8,
            },
        });

        const { update } = mockUpsert.mock.calls[0][0];
        // Without these the version gate would mark rows stale and never heal one.
        expect(update.normalizedName).toBe('peanut butter');
        expect(update.canonicalBase).toBe('peanut butter');
        expect(update.isBranded).toBe(true);
        expect(update.estimatedCaloriesPer100g).toBe(588);
        expect(update.estimatedProteinPer100g).toBe(25);
        expect(update.estimatedCarbsPer100g).toBe(20);
        expect(update.estimatedFatPer100g).toBe(50);
        expect(update.nutritionConfidence).toBe(0.8);
        expect(update.rulesVersion).toBe(RULES_VERSION);
    });

    it('stamps the version on the create branch too', async () => {
        await saveAiNormalizeCache('jif peanut butter', { normalizedName: 'peanut butter' });

        expect(mockUpsert.mock.calls[0][0].create.rulesVersion).toBe(RULES_VERSION);
    });
});

describe('a partial writer cannot blank a richer row', () => {
    it('leaves omitted arrays, brand flag and nutrition undefined on the update branch', async () => {
        // This is aiSimplifyIngredient's exact call shape. Prisma reads undefined as "leave
        // the column alone"; [] / false would erase a row aiNormalizeIngredient filled in.
        await saveAiNormalizeCache('jif peanut butter', { normalizedName: 'Peanut Butter' },
            { namespace: 'SIMPLIFY:' });

        const { update, create } = mockUpsert.mock.calls[0][0];
        expect(update).toHaveProperty('synonyms', undefined);
        expect(update).toHaveProperty('prepPhrases', undefined);
        expect(update).toHaveProperty('sizePhrases', undefined);
        expect(update).toHaveProperty('isBranded', undefined);
        expect(update).toHaveProperty('estimatedCaloriesPer100g', undefined);
        expect(update).toHaveProperty('cookingModifier', undefined);
        // create: still gets concrete defaults — a brand-new row has nothing to preserve.
        expect(create.synonyms).toEqual([]);
        expect(create.isBranded).toBe(false);
    });

    it('routes the save through the namespaced key', async () => {
        await saveAiNormalizeCache('1 cup rice', { normalizedName: 'Rice' },
            { namespace: 'SIMPLIFY:' });

        expect(mockUpsert.mock.calls[0][0].where.normalizedKey).toBe('SIMPLIFY:rice');
        expect(mockUpsert.mock.calls[0][0].create.rawLine).toBe('1 cup rice');
    });
});

describe('the raw touch degrades instead of failing closed', () => {
    it('falls back to findUnique rather than turning every lookup into a miss', async () => {
        // If $queryRaw ever refuses UPDATE ... RETURNING, returning null here would send the
        // entire cache back to the LLM. Degrade to the old two-round-trip shape instead.
        //
        // A fresh module instance, because the demotion is a one-way module-scope latch —
        // flipping it on the shared import would silently change every test after this one.
        let fresh!: typeof import('../validated-mapping-helpers');
        jest.isolateModules(() => { fresh = require('../validated-mapping-helpers'); });

        mockQueryRaw.mockRejectedValue(new Error('raw query failed'));
        mockFindUnique.mockResolvedValue(storedRow());

        const cached = await fresh.getAiNormalizeCache('jif peanut butter');

        expect(cached?.normalizedName).toBe('peanut butter');
        expect(mockFindUnique).toHaveBeenCalledTimes(1);
        expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
});
