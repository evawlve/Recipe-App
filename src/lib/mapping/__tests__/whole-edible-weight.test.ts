/**
 * A whole item is billed by its edible weight (s463 WHOLE-ITEM-EDIBLE-WEIGHT). The model's `whole` answer
 * bills grams x a per-100 g EDIBLE panel, but it answered the item as sold: `half a rotisserie chicken` on
 * fs_2314048 billed 600 g / 1,786 kcal (deploy 51, cold). The `whole` question is unchanged; a second, narrow
 * question (EDIBLE_YIELD_SCHEMA) names the inedible part and the eaten share, clamped per part, and the as-sold
 * answer is scaled by it. "none", an unusable answer or a failed call bill the as-sold weight exactly as before.
 * Pins: the pure rule; the questions per unit; the estimator bills the edible weight; the kill switch; the fs_
 * wiring through getOrCreateAmbiguousServing() (asked per request, never saved).
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
import {
    EDIBLE_YIELD_MAX_AS_SOLD_GRAMS,
    EDIBLE_YIELD_SCHEMA,
    edibleYield,
    estimateAmbiguousServing,
    RESPONSE_SCHEMA,
} from '../../ai/ambiguous-serving-estimator';
import { getOrCreateAmbiguousServing, WHOLE_SAVE_MAX_GRAMS } from '../ambiguous-unit-backfill';
import { FRACTION_WHOLE_MAX_GRAMS } from '../serving/fraction-whole-item';

const llm = callStructuredLlm as jest.Mock;
const db = prisma as unknown as { offServing: { upsert: jest.Mock }; aiGeneratedServing: { upsert: jest.Mock } };
// The two questions are asked concurrently, so answers are queued per schema, not per call order.
let weightQ: unknown[] = [];
let yieldQ: unknown[] = [];
const asSold = (g: number) => weightQ.push({
    status: 'success',
    content: { estimatedGrams: g, confidence: 0.9, reasoning: 'test', error: null },
});
const yieldAnswer = (part: string, fraction: number) => yieldQ.push({
    status: 'success',
    content: { inediblePart: part, edibleFraction: fraction, reasoning: 'test' },
});
const yieldFails = () => yieldQ.push({ status: 'error', error: 'boom' });
const callsOf = (schema: unknown) => llm.mock.calls.filter((c) => c[0].schema === schema);

const savedKey = process.env.OPENROUTER_API_KEY;
const savedSwitch = process.env.SERVING_WHOLE_EDIBLE;
beforeAll(() => { process.env.OPENROUTER_API_KEY = 'test-only'; });
afterAll(() => {
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedKey;
});
beforeEach(() => {
    llm.mockReset(); db.offServing.upsert.mockClear(); db.aiGeneratedServing.upsert.mockClear();
    weightQ = []; yieldQ = [];
    llm.mockImplementation(async (req: { schema: unknown }) => (req.schema === EDIBLE_YIELD_SCHEMA ? yieldQ : weightQ).shift());
});
afterEach(() => {
    if (savedSwitch === undefined) delete process.env.SERVING_WHOLE_EDIBLE; else process.env.SERVING_WHOLE_EDIBLE = savedSwitch;
});

describe('edibleYield (pure)', () => {
    it('"none", an unknown part, or a share of 1 or more is no yield', () => {
        expect(edibleYield('none', 0.5)).toBeNull();
        expect(edibleYield('gristle', 0.5)).toBeNull();
        expect(edibleYield('bone', 1)).toBeNull();
        expect(edibleYield('bone', 0)).toBeNull();
        expect(edibleYield('bone', undefined)).toBeNull();
    });
    it('a named part keeps an in-bounds share and clamps the rest to its bounds', () => {
        expect(edibleYield('bone', 0.6)).toEqual({ part: 'bone', fraction: 0.6 });
        expect(edibleYield('bone', 0.2)).toEqual({ part: 'bone', fraction: 0.45 });
        expect(edibleYield('shell', 0.9)).toEqual({ part: 'shell', fraction: 0.75 });
        expect(edibleYield('peel_or_rind', 0.25)).toEqual({ part: 'peel_or_rind', fraction: 0.45 });
    });
    it('a share above 0.8 after the clamp is no yield (the steak / chop / bone-in ham class; s463 rf-edible)', () => {
        // MUTATION: `fraction > EDIBLE_YIELD_MAX_SHARE ? null :` removed.
        expect(edibleYield('bone', 0.85)).toBeNull();
        expect(edibleYield('bone', 0.95)).toBeNull();
        expect(edibleYield('pit_or_core', 0.9)).toBeNull();
        expect(edibleYield('bone', 0.8)).toEqual({ part: 'bone', fraction: 0.8 });
        expect(edibleYield('shell', 0.9)).toEqual({ part: 'shell', fraction: 0.75 });
    });
});

describe('the questions per unit', () => {
    it('a `whole` asks the unchanged question, then the yield question', async () => {
        asSold(1200); yieldAnswer('bone', 0.6);
        await estimateAmbiguousServing({ foodName: 'Rotisserie Chicken', brandName: 'Wal-Mart', unit: 'whole' });
        expect(llm).toHaveBeenCalledTimes(2);
        expect(callsOf(RESPONSE_SCHEMA)).toHaveLength(1);
        expect(callsOf(RESPONSE_SCHEMA)[0][0].userPrompt).not.toContain('inediblePart');
        expect(callsOf(EDIBLE_YIELD_SCHEMA)).toHaveLength(1);
        expect(callsOf(EDIBLE_YIELD_SCHEMA)[0][0].userPrompt).toContain('Rotisserie Chicken');
    });
    it('every other unit asks one question, exactly as before', async () => {
        asSold(150);
        const r = await estimateAmbiguousServing({ foodName: 'Greek Yogurt', unit: 'container' });
        expect(llm).toHaveBeenCalledTimes(1);
        expect(llm.mock.calls[0][0].schema).toBe(RESPONSE_SCHEMA);
        expect(r.estimatedGrams).toBe(150);
    });
});

describe('estimateAmbiguousServing on `whole`', () => {
    it('bills the as-sold weight x the edible share', async () => {
        asSold(1200); yieldAnswer('bone', 0.6);
        const r = await estimateAmbiguousServing({ foodName: 'Rotisserie Chicken', unit: 'whole' });
        expect(r.status).toBe('success');
        expect(r.estimatedGrams).toBe(720);
    });
    it('bills the as-sold weight of a food with nothing inedible', async () => {
        asSold(900); yieldAnswer('none', 1);
        const r = await estimateAmbiguousServing({ foodName: "Mom's Meatloaf", unit: 'whole' });
        expect(r.estimatedGrams).toBe(900);
    });
    it('an as-sold weight over the 2,000 g cap keeps it, so the fraction cap and the save band still decline it', async () => {
        // MUTATION: `&& clampedGrams <= EDIBLE_YIELD_MAX_AS_SOLD_GRAMS` removed.
        expect(EDIBLE_YIELD_MAX_AS_SOLD_GRAMS).toBe(FRACTION_WHOLE_MAX_GRAMS);
        expect(EDIBLE_YIELD_MAX_AS_SOLD_GRAMS).toBe(WHOLE_SAVE_MAX_GRAMS);
        asSold(3000); yieldAnswer('bone', 0.6);
        const turkey = await estimateAmbiguousServing({ foodName: 'Whole Roasted Turkey', unit: 'whole' });
        expect(turkey.estimatedGrams).toBe(3000);
        asSold(2000); yieldAnswer('bone', 0.6);
        const atCap = await estimateAmbiguousServing({ foodName: 'Whole Roasted Turkey', unit: 'whole' });
        expect(atCap.estimatedGrams).toBe(1200);
    });
    it('a failed yield call keeps the as-sold weight', async () => {
        asSold(900); yieldFails();
        const r = await estimateAmbiguousServing({ foodName: 'Rotisserie Chicken', unit: 'whole' });
        expect(r.status).toBe('success');
        expect(r.estimatedGrams).toBe(900);
    });
    it('the kill switch asks one question and bills it', async () => {
        process.env.SERVING_WHOLE_EDIBLE = '0';
        asSold(1200);
        const r = await estimateAmbiguousServing({ foodName: 'Rotisserie Chicken', unit: 'whole' });
        expect(llm).toHaveBeenCalledTimes(1);
        expect(r.estimatedGrams).toBe(1200);
    });
});

describe('the wiring: getOrCreateAmbiguousServing()', () => {
    it('an fs_ record gets the edible weight and nothing is saved (asked per request)', async () => {
        asSold(1200); yieldAnswer('bone', 0.6);
        const r = await getOrCreateAmbiguousServing('fs_2314048', 'Rotisserie Chicken', 'whole', 'Wal-Mart');
        expect(r.status).toBe('success');
        expect(r.grams).toBe(720);
        expect(db.offServing.upsert).not.toHaveBeenCalled();
        expect(db.aiGeneratedServing.upsert).not.toHaveBeenCalled();
    });
});
