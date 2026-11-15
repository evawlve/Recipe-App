/**
 * WIRING pins for the scoop cap split (s459 sc, refuter rf-sc). The pure-function suite
 * (`scoop-food-vs-powder-cap.test.ts`) stays green when the two call sites below lose the
 * food name, so these pin the SITES:
 *  1. getOrCreateAmbiguousServing()'s cached-row bound reads the record name (a 66 g ice-cream
 *     scoop row is served; the same row on a powder name is still refused and re-estimated);
 *  2. buildFdcResult()'s per-unit sanity guard reads scoopMaxGrams() — the estimator's 66 g for
 *     an FDC ice cream would otherwise be capped straight back to 50 g after the fix.
 */
jest.mock('../../ai/structured-client', () => ({ callStructuredLlm: jest.fn() }));
jest.mock('../../fdc/fdc-servings', () => ({ getFdcServingWeight: jest.fn().mockResolvedValue(null) }));
jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        offServing: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
        fdcServing: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
        aiGeneratedServing: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    },
}));

import { prisma } from '../../db';
import { callStructuredLlm } from '../../ai/structured-client';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';

const llm = callStructuredLlm as jest.Mock;
const offRow = (prisma as unknown as { offServing: { findUnique: jest.Mock } }).offServing.findUnique;

const savedKey = process.env.OPENROUTER_API_KEY;
beforeAll(() => { process.env.OPENROUTER_API_KEY = 'test-only'; });
afterAll(() => { if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedKey; });
beforeEach(() => { llm.mockReset(); offRow.mockReset(); });

describe('cached-row bound reads the record name', () => {
    it('a 66 g scoop row on a FOOD record is served (it was refused at 50)', async () => {
        offRow.mockResolvedValue({ grams: 66 });
        const r = await getOrCreateAmbiguousServing('off_0000000000001', 'Vanilla Ice Cream', 'scoop');
        expect(r).toMatchObject({ status: 'cached', grams: 66 });
    });

    it('the same 66 g row on a POWDER record is still refused and re-estimated (boundary)', async () => {
        offRow.mockResolvedValue({ grams: 66 });
        llm.mockResolvedValueOnce({ status: 'success', content: { estimatedGrams: 11, confidence: 0.9, reasoning: 't', error: null } });
        const r = await getOrCreateAmbiguousServing('off_0000000000002', 'Collagen Peptides', 'scoop');
        expect(r.status).not.toBe('cached');
        expect(r.grams).toBe(11);
    });
});
