/**
 * insertAiServing() — the FatSecret-lane twin of `insertFdcAiServing()`'s
 * count-answer refusal (2026-08-17). Like its sibling, this function had no
 * test that EXECUTED it: every importer mocks it.
 *
 * The count block in this file is LOAD-BEARING and stays — the on-demand
 * callers (`/api/foods/[id]/serving?unit=clove`, `backfillServingOnDemand()`,
 * the legacy cache lane in serving/hydration-lane.ts) pass `gapType: 'volume'`
 * with a COUNT target, or no target, and rely on the count row it writes
 * (`1 medium` / volumeMl 1 rows on AiGeneratedServing are that path). What is
 * refused is narrower than the FDC sibling: the caller named a unit this file
 * converts to millilitres AND the model answered with a count anyway.
 *
 * Nothing here can reach a model or a database.
 */

import { insertAiServing, backfillWeightServing } from '../ai-backfill';
import { requestAiServing } from '../../ai/serving-estimator';
import { prisma } from '../../db';
import { runWithWritePolicy, currentWriteReceipt } from '../../write-policy';

jest.mock('../../ai/serving-estimator', () => {
    const actual = jest.requireActual('../../ai/serving-estimator');
    return { ...actual, requestAiServing: jest.fn() };
});

const tx = {
    fdcServing: { upsert: jest.fn().mockResolvedValue({}) },
    offServing: { upsert: jest.fn().mockResolvedValue({}) },
    aiGeneratedFood: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ai_egg_white' }),
        create: jest.fn().mockResolvedValue({}),
    },
    aiGeneratedServing: { upsert: jest.fn().mockResolvedValue({}) },
};

jest.mock('../../db', () => ({
    prisma: {
        $transaction: jest.fn(),
        fdcFood: { findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: { findUnique: jest.fn().mockResolvedValue(null) },
    },
}));

const mockedRequest = requestAiServing as jest.Mock;
const transaction = prisma.$transaction as jest.Mock;

const AI_EGG_WHITE = {
    id: 'ai_egg_white',
    name: 'egg white',
    source: 'ai_generated' as const,
    nutrition: { kcal: 52, protein: 10.9, carbs: 0.7, fat: 0.2, per100g: true },
    servings: [],
};

const FDC_EGG_WHITE = {
    id: 'fdc_747997',
    name: 'Egg, white, raw, fresh',
    source: 'fdc' as const,
    nutrition: { kcal: 52, protein: 10.9, carbs: 0.7, fat: 0.2, per100g: true },
    servings: [{ description: 'large', grams: 33 }],
};

type Suggestion = {
    servingLabel: string;
    grams: number;
    volumeUnit?: string;
    volumeAmount?: number;
    confidence?: number;
};

function answer(s: Suggestion) {
    mockedRequest.mockResolvedValue({
        status: 'success',
        prompt: 'mock',
        suggestion: { confidence: 0.9, ...s },
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => fn(tx));
    tx.aiGeneratedFood.findUnique.mockResolvedValue({ id: 'ai_egg_white' });
});

// ============================================================================
describe('insertAiServing — a count answer to a VOLUME-UNIT request is refused', () => {
    // MUTATION on the pre-fix tree: both return { success: true } and open the
    // transaction — persisting the whole label's grams under volumeMl = <count>.
    it('`1 cup` requested, `3 egg whites = 65 g` answered → refused, no transaction', async () => {
        answer({ servingLabel: '3 egg whites', grams: 65, volumeUnit: 'count', volumeAmount: 3 });

        const r = await insertAiServing('ai_egg_white', 'volume', {
            targetServingUnit: 'cup',
            candidateData: AI_EGG_WHITE,
        });

        expect(r).toEqual({ success: false, reason: 'count_answer_for_volume_gap' });
        expect(transaction).not.toHaveBeenCalled();
    });

    it('`1 cup` requested, unit-less `3 egg whites` answered → refused, no transaction', async () => {
        answer({ servingLabel: '3 egg whites', grams: 65, volumeAmount: 3 });

        const r = await insertAiServing('fdc_747997', 'volume', {
            targetServingUnit: 'cup',
            candidateData: FDC_EGG_WHITE,
        });

        expect(r).toEqual({ success: false, reason: 'count_answer_for_volume_gap' });
        expect(transaction).not.toHaveBeenCalled();
        expect(tx.fdcServing.upsert).not.toHaveBeenCalled();
    });

    it('a plural spelling of the volume unit is still a volume request (`cups`)', async () => {
        answer({ servingLabel: '1 egg white', grams: 33, volumeUnit: 'egg', volumeAmount: 1 });

        const r = await insertAiServing('ai_egg_white', 'volume', {
            targetServingUnit: 'cups',
            candidateData: AI_EGG_WHITE,
        });

        expect(r).toEqual({ success: false, reason: 'count_answer_for_volume_gap' });
        expect(transaction).not.toHaveBeenCalled();
    });
});

// ============================================================================
describe('insertAiServing — the load-bearing count paths are untouched (both trees)', () => {
    it('a COUNT target (`clove`) still accepts a count answer and writes the row', async () => {
        answer({ servingLabel: '1 clove', grams: 3, volumeUnit: 'clove', volumeAmount: 1 });

        const r = await insertAiServing('ai_egg_white', 'volume', {
            targetServingUnit: 'clove',
            candidateData: AI_EGG_WHITE,
        });

        expect(r).toEqual({ success: true });
        expect(transaction).toHaveBeenCalledTimes(1);
        expect(tx.aiGeneratedServing.upsert).toHaveBeenCalledTimes(1);
        expect(tx.aiGeneratedServing.upsert.mock.calls[0][0].create).toMatchObject({
            label: '1 clove', grams: 3, volumeMl: 1,
        });
    });

    it('NO target (the legacy cache lane) still accepts a count answer', async () => {
        answer({ servingLabel: '1 medium', grams: 120, volumeUnit: 'count', volumeAmount: 1 });

        const r = await insertAiServing('ai_egg_white', 'volume', { candidateData: AI_EGG_WHITE });

        expect(r).toEqual({ success: true });
        expect(tx.aiGeneratedServing.upsert).toHaveBeenCalledTimes(1);
    });

    it('a WEIGHT gap still accepts a count answer', async () => {
        answer({ servingLabel: '1 large egg white', grams: 33, volumeUnit: 'count', volumeAmount: 1 });

        const r = await insertAiServing('ai_egg_white', 'weight', { candidateData: AI_EGG_WHITE });

        expect(r).toEqual({ success: true });
        expect(tx.aiGeneratedServing.upsert).toHaveBeenCalledTimes(1);
    });

    it('a volume target answered IN volume still succeeds and is density-derived', async () => {
        answer({ servingLabel: '1 cup', grams: 240, volumeUnit: 'cup', volumeAmount: 1 });

        const r = await insertAiServing('fdc_747997', 'volume', {
            targetServingUnit: 'cup',
            candidateData: FDC_EGG_WHITE,
        });

        expect(r).toEqual({ success: true });
        expect(tx.fdcServing.upsert).toHaveBeenCalledTimes(1);
        expect(tx.fdcServing.upsert.mock.calls[0][0].create).toMatchObject({
            fdcId: 747997, description: '1 cup', grams: 240,
            volumeMl: 240, derivedViaDensity: true, densityGml: 1, isAiEstimated: true,
        });
    });

    it('a volume target answered with an unknown, non-count unit is still `missing_volume_unit`', async () => {
        answer({ servingLabel: '1 glass', grams: 240, volumeUnit: 'glass', volumeAmount: 1 });

        const r = await insertAiServing('ai_egg_white', 'volume', {
            targetServingUnit: 'cup',
            candidateData: AI_EGG_WHITE,
        });

        expect(r).toEqual({ success: false, reason: 'missing_volume_unit' });
        expect(transaction).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Request-scoped write suppression (nosave=1)
//
// This writer refuses BEFORE the model call, which is the opposite of
// insertFdcAiServing()'s placement, and the asymmetry is deliberate: this
// function's return carries NO grams, so every request-path caller re-reads the
// row from the DB. A suppressed upsert reported as `success: true` would send
// the caller back for a row that is not there and have it log
// `volume_backfill_success` over unchanged grams. `success: false` is the shape
// all five request-path callers already treat as "warn and fall through".
// ============================================================================

describe('insertAiServing / backfillWeightServing under a suppressed write policy', () => {
    it('insertAiServing refuses with a grep-able reason and opens no transaction', async () => {
        answer({ servingLabel: '1 cup', grams: 240, volumeUnit: 'cup', volumeAmount: 1 });

        const r = await runWithWritePolicy({ suppress: ['aiServing'] }, () =>
            insertAiServing('fdc_747997', 'volume', {
                targetServingUnit: 'cup',
                candidateData: FDC_EGG_WHITE,
            }),
        );

        expect(r).toEqual({ success: false, reason: 'write_suppressed' });
        expect(transaction).not.toHaveBeenCalled();
    });

    it('refuses BEFORE the estimator — no model call is spent on a value nothing can consume', async () => {
        answer({ servingLabel: '1 cup', grams: 240, volumeUnit: 'cup', volumeAmount: 1 });

        await runWithWritePolicy({ suppress: ['aiServing'] }, () =>
            insertAiServing('fdc_747997', 'volume', {
                targetServingUnit: 'cup',
                candidateData: FDC_EGG_WHITE,
            }),
        );

        expect(mockedRequest).not.toHaveBeenCalled();
    });

    it('backfillWeightServing refuses the same way, before it reads the food', async () => {
        const r = await runWithWritePolicy({ suppress: ['aiServing'] }, () =>
            backfillWeightServing('ai_egg_white'),
        );

        expect(r).toEqual({ success: false, reason: 'write_suppressed' });
        expect(prisma.aiGeneratedFood.findUnique).not.toHaveBeenCalled();
    });

    it('the receipt names the table each refusal would have written', async () => {
        const receipt = await runWithWritePolicy({ suppress: ['aiServing'], line: '1 cup egg whites' }, async () => {
            await insertAiServing('fdc_747997', 'volume', { candidateData: FDC_EGG_WHITE });
            await insertAiServing('off_0042400265177', 'volume', {});
            await insertAiServing('ai_egg_white', 'weight', { candidateData: AI_EGG_WHITE });
            await backfillWeightServing('ai_egg_white');
            return currentWriteReceipt();
        });

        expect(receipt!.refusedTotal).toBe(4);
        expect(receipt!.refused.map((r) => r.table)).toEqual([
            'FdcServing', 'OffServing', 'AiGeneratedServing', 'AiGeneratedServing',
        ]);
        expect(receipt!.refused.every((r) => r.line === '1 cup egg whites')).toBe(true);
    });

    it('outside any policy both writers behave exactly as before', async () => {
        answer({ servingLabel: '1 cup', grams: 240, volumeUnit: 'cup', volumeAmount: 1 });

        const r = await insertAiServing('fdc_747997', 'volume', {
            targetServingUnit: 'cup',
            candidateData: FDC_EGG_WHITE,
        });

        expect(r).toEqual({ success: true });
        expect(transaction).toHaveBeenCalledTimes(1);
    });
});
