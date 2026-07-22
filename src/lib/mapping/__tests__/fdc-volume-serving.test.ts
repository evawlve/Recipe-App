/**
 * Cooked-grain volume-serving preference (Track 3, Jul 2026) — n-serv-06.
 *
 * Root cause of the quinoa flap: buildFdcResult's volume branch NEVER
 * consulted existing FdcServing rows — every "1.5 cups cooked quinoa" went
 * straight to AI estimation (nondeterministic) and, on failure, to the
 * generic 240ml×density fallback (360g for 1.5 cups), even though fdc 168917
 * carries a genuine usda_fdc "cup"=185g row.
 *
 * Fix under test:
 *   (0) findOwnFdcVolumeServing resolves the record's own matching volume
 *       serving first — genuine rows beat cached AI rows, both beat a fresh
 *       AI call ('fdc_label_volume' / 'fdc_volume_cached');
 *   - candidateHasVolumeServing feeds the rerank serving-shape flag so the
 *     cooked-grain re-retrieval prefers candidates owning a cup serving.
 */

import {
    hydrateAndSelectServing,
    findOwnFdcVolumeServing,
    candidateHasVolumeServing,
} from '../map-ingredient-with-fallback';
import { insertFdcAiServing } from '../../usda/fdc-ai-backfill';
import { prisma } from '../../db';
import type { ParsedIngredient } from '../../parse/ingredient-line';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcServing: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
        },
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    },
}));

jest.mock('../../usda/fdc-ai-backfill', () => {
    const actual = jest.requireActual('../../usda/fdc-ai-backfill');
    return {
        ...actual,
        insertFdcAiServing: jest.fn().mockResolvedValue({ success: false, reason: 'mocked-off' }),
    };
});

const mockedFindMany = prisma.fdcServing.findMany as jest.Mock;

function quinoaCandidate() {
    return {
        id: 'fdc_168917',
        source: 'fdc' as const,
        name: 'Quinoa, cooked',
        score: 1,
        foodType: 'foundation',
        nutrition: { kcal: 120, protein: 4.4, carbs: 21.3, fat: 1.92, per100g: true },
        rawData: {},
    } as any;
}

function cupsParsed(qty = 1.5): ParsedIngredient {
    return { qty, multiplier: 1, unit: 'cup', name: 'cooked quinoa' };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockedFindMany.mockResolvedValue([]);
    (insertFdcAiServing as jest.Mock).mockResolvedValue({ success: false, reason: 'mocked-off' });
});

describe('findOwnFdcVolumeServing', () => {
    it('prefers the genuine usda_fdc cup row over a cached AI row', async () => {
        mockedFindMany.mockResolvedValue([
            { description: '1 cup', grams: 240, isAiEstimated: true },
            { description: 'cup', grams: 185, isAiEstimated: false },
        ]);

        const r = await findOwnFdcVolumeServing(168917, 'cup');
        expect(r).toEqual({ perUnitGrams: 185, genuine: true });
    });

    it('falls back to a cached AI row when no genuine row matches', async () => {
        mockedFindMany.mockResolvedValue([
            { description: '1 cup', grams: 210, isAiEstimated: true },
        ]);

        const r = await findOwnFdcVolumeServing(168917, 'cup');
        expect(r).toEqual({ perUnitGrams: 210, genuine: false });
    });

    it('divides multi-unit descriptions ("0.25 cup" 61.25g → 245 g/cup)', async () => {
        mockedFindMany.mockResolvedValue([
            { description: '0.25 cup', grams: 61.25, isAiEstimated: false },
        ]);

        const r = await findOwnFdcVolumeServing(1, 'cup');
        expect(r).toEqual({ perUnitGrams: 245, genuine: true });
    });

    it('rejects corrupt rows outside the density band (a 976g "cup" is a package weight)', async () => {
        mockedFindMany.mockResolvedValue([
            { description: 'cup', grams: 976, isAiEstimated: false },
        ]);

        expect(await findOwnFdcVolumeServing(1, 'cup')).toBeNull();
    });

    it('matches tablespoon spellings for a tbsp request, but never a non-volume row', async () => {
        mockedFindMany.mockResolvedValue([
            { description: '1 tablespoon', grams: 21, isAiEstimated: false },
            { description: '1 cupcake', grams: 66, isAiEstimated: false },
        ]);

        expect(await findOwnFdcVolumeServing(1, 'tbsp')).toEqual({ perUnitGrams: 21, genuine: true });
        expect(await findOwnFdcVolumeServing(1, 'cup')).toBeNull();  // "cupcake" must not match "cup"
    });

    it('returns null for unsupported units', async () => {
        expect(await findOwnFdcVolumeServing(1, 'bar')).toBeNull();
        expect(mockedFindMany).not.toHaveBeenCalled();
    });
});

describe('buildFdcResult volume branch (via hydrateAndSelectServing)', () => {
    it('n-serv-06: "1.5 cups cooked quinoa" bills 1.5 × the genuine 185g cup row — no AI call', async () => {
        mockedFindMany.mockResolvedValue([
            { description: 'cup', grams: 185, isAiEstimated: false },
            { description: '1 cup', grams: 185, isAiEstimated: true },
        ]);

        const result = await hydrateAndSelectServing(
            quinoaCandidate(), cupsParsed(1.5), 0.9, '1 1/2 cups cooked quinoa'
        );

        expect(result?.grams).toBeCloseTo(277.5, 1);           // inside the [230,320] golden band
        expect(result?.servingTier).toBe('fdc_label_volume');
        expect(result?.kcal).toBeCloseTo(120 * 2.775, 1);
        expect(insertFdcAiServing).not.toHaveBeenCalled();     // determinism: no fresh estimate
    });

    it('reuses a cached AI cup row deterministically when no genuine row exists', async () => {
        mockedFindMany.mockResolvedValue([
            { description: '1 cup', grams: 190, isAiEstimated: true },
        ]);

        const result = await hydrateAndSelectServing(
            quinoaCandidate(), cupsParsed(1.5), 0.9, '1 1/2 cups cooked quinoa'
        );

        expect(result?.grams).toBeCloseTo(285, 1);
        expect(result?.servingTier).toBe('fdc_volume_cached');
        expect(insertFdcAiServing).not.toHaveBeenCalled();
    });

    it('no matching serving → AI estimation still runs (existing behavior)', async () => {
        (insertFdcAiServing as jest.Mock).mockResolvedValue({ success: true, grams: 185, servingLabel: '1 cup' });

        const result = await hydrateAndSelectServing(
            quinoaCandidate(), cupsParsed(1.5), 0.9, '1 1/2 cups cooked quinoa'
        );

        expect(result?.servingTier).toBe('fdc_volume_ai');
        expect(result?.grams).toBeCloseTo(277.5, 1);
    });

    it('AI failure falls to the generic density fallback (the old 360g path, now last resort)', async () => {
        const result = await hydrateAndSelectServing(
            quinoaCandidate(), cupsParsed(1.5), 0.9, '1 1/2 cups cooked quinoa'
        );

        expect(result?.servingTier).toBe('volume_unit');
        expect(result?.grams).toBeCloseTo(1.5 * 240 * 0.5, 1);  // solid density fallback
    });
});

describe('candidateHasVolumeServing — rerank serving-shape flag for grain volume requests', () => {
    it('true for an FDC candidate owning a cup serving', () => {
        const c = { ...quinoaCandidate(), servings: [{ description: 'cup', grams: 185 }] };
        expect(candidateHasVolumeServing(c, 'cup')).toBe(true);
    });

    it('false for an FDC candidate with only non-matching servings', () => {
        const c = { ...quinoaCandidate(), servings: [{ description: '1 tbsp', grams: 12 }] };
        expect(candidateHasVolumeServing(c, 'cup')).toBe(false);
    });

    it('false when servings have no grams', () => {
        const c = { ...quinoaCandidate(), servings: [{ description: 'cup', grams: null }] };
        expect(candidateHasVolumeServing(c, 'cup')).toBe(false);
    });

    it('OFF candidates match through their raw label servingSize', () => {
        const off = {
            id: 'off_1', source: 'openfoodfacts', name: 'Cooked Quinoa Pouch', score: 1,
            rawData: { servingSize: '1 cup (185 g)', servingGrams: 185 },
        } as any;
        expect(candidateHasVolumeServing(off, 'cup')).toBe(true);

        const offNo = { ...off, rawData: { servingSize: '1 pouch (250 g)', servingGrams: 250 } };
        expect(candidateHasVolumeServing(offNo, 'cup')).toBe(false);
    });
});
