/**
 * A packet of food is not a packet of sugar (s461 PKT-FOOD). `UNIT_MAX_GRAMS.packet` (10 g,
 * `envelope` 15 g) is a condiment / sweetener cap, but it clamped every food: the box app log's
 * `ambiguous_estimation.clamped` events hold instant oats 40 -> 10, ramen 85 -> 10, tuna 140 -> 10,
 * hot cocoa 28 -> 10, crisps 30 -> 10 (live cold `1 packet of tuna` billed 10 g / 10.8 kcal).
 *
 * Pins, in order: the unit-only call and every non-food name read exactly as before (10 / 15 g);
 * a pouch food gets POUCH_PACKET_MAX_GRAMS and a dry single-serve food DRY_PACKET_MAX_GRAMS; a
 * small-dose name wins over a food word (bouillon, seasoning, coffee); no other unit moves; the kill
 * switch restores the condiment cap; the estimator keeps a food answer under the cap and clamps above
 * it (Milo drew 240 g); the cached-row bound reads the record name (the WIRING — the pure pins stay
 * green without it; the FDC guard's wiring pin is packet-food-cap-fdc-guard.test.ts).
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
    estimateAmbiguousServing,
    getAmbiguousUnitBounds,
    packetMaxGrams,
    POUCH_PACKET_MAX_GRAMS,
    DRY_PACKET_MAX_GRAMS,
} from '../../ai/ambiguous-serving-estimator';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';

const llm = callStructuredLlm as jest.Mock;
const offRow = (prisma as unknown as { offServing: { findUnique: jest.Mock } }).offServing.findUnique;
const answer = (g: number) => llm.mockResolvedValueOnce({
    status: 'success',
    content: { estimatedGrams: g, confidence: 0.9, reasoning: 'test', error: null },
});

const savedKey = process.env.OPENROUTER_API_KEY;
const savedSwitch = process.env.SERVING_PACKET_FOOD_CAP;
beforeAll(() => { process.env.OPENROUTER_API_KEY = 'test-only'; });
afterAll(() => {
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedKey;
});
beforeEach(() => { llm.mockReset(); offRow.mockReset(); offRow.mockResolvedValue(null); });
afterEach(() => {
    if (savedSwitch === undefined) delete process.env.SERVING_PACKET_FOOD_CAP; else process.env.SERVING_PACKET_FOOD_CAP = savedSwitch;
});

describe('bounds', () => {
    it('the unit-only call reads exactly as before (packet 10, sachet 10, envelope 15)', () => {
        expect(getAmbiguousUnitBounds('packet')).toEqual({ min: undefined, max: 10 });
        expect(getAmbiguousUnitBounds('packets')).toEqual({ min: undefined, max: 10 });
        expect(getAmbiguousUnitBounds('sachet')).toEqual({ min: undefined, max: 10 });
        expect(getAmbiguousUnitBounds('envelope')).toEqual({ min: undefined, max: 15 });
    });

    it.each([
        'Sugar', 'Granulated sugar', 'Zero Calorie Sweetener With Sucralose', 'Ketchup', 'Mayo', 'Honey', 'Jelly',
        'Salt', 'Soy Sauce', 'Hot Pepper Sauce', 'Ranch', 'Corn Tortillas', 'Bacon', 'Rich tea biscuits', 'Sweet N’ Sour',
    ])('a non-food name keeps the condiment cap: %s', (name) => {
        expect(getAmbiguousUnitBounds('packet', name).max).toBe(10);
        expect(getAmbiguousUnitBounds('envelope', name).max).toBe(15);
    });

    it.each([
        'Chicken Bouillon', 'Ramen Seasoning', 'Coffee', 'Coffee Mix', 'Soup, beef broth or bouillon, powder, dry',
        'Chicken Gravy', 'Hot Cocoa Creamer',
    ])('a small-dose name wins over a food word: %s', (name) => {
        expect(packetMaxGrams('packet', name)).toBeNull();
        expect(getAmbiguousUnitBounds('packet', name).max).toBe(10);
    });

    it.each([
        'Tuna', 'Light tuna', 'Fish, tuna, white, canned in water, drained solids', 'Salmon', 'Chicken',
        'Tonkotsu Ramen', 'Instant Noodles', 'Soup, ramen noodle, chicken flavor, dry',
    ])('a pouch food gets the pouch cap: %s', (name) => {
        expect(POUCH_PACKET_MAX_GRAMS).toBe(85);
        expect(getAmbiguousUnitBounds('packet', name).max).toBe(POUCH_PACKET_MAX_GRAMS);
        expect(getAmbiguousUnitBounds('sachet', name).max).toBe(POUCH_PACKET_MAX_GRAMS);
    });

    it.each([
        'Rolled Oats', 'Instant oatmeal', 'Cereals, oats, instant, fortified, plain, dry', 'Grits', 'Corn Grits',
        'Cream of wheat', 'Hot Cocoa', 'Hot Chocolate Mix', 'Milo', 'Crisps', 'Almond Butter', 'Onion Soup Mix',
        'Fruit snacks', 'Trail mix', 'ENERGY GEL',
    ])('a dry single-serve food gets the dry cap: %s', (name) => {
        expect(DRY_PACKET_MAX_GRAMS).toBe(45);
        expect(getAmbiguousUnitBounds('packet', name).max).toBe(DRY_PACKET_MAX_GRAMS);
        expect(getAmbiguousUnitBounds('envelope', name).max).toBe(DRY_PACKET_MAX_GRAMS);
    });

    it('no other unit moves when a food name is passed', () => {
        expect(getAmbiguousUnitBounds('scoop', 'Rolled Oats')).toEqual(getAmbiguousUnitBounds('scoop', 'Coleslaw'));
        expect(getAmbiguousUnitBounds('bar', 'Tuna')).toEqual(getAmbiguousUnitBounds('bar'));
        expect(getAmbiguousUnitBounds('pouch', 'Tuna')).toEqual(getAmbiguousUnitBounds('pouch'));
        expect(packetMaxGrams('cup', 'Rolled Oats')).toBeNull();
    });

    it('kill switch SERVING_PACKET_FOOD_CAP="0" restores the condiment cap for a food name', () => {
        process.env.SERVING_PACKET_FOOD_CAP = '0';
        expect(packetMaxGrams('packet', 'Tuna')).toBeNull();
        expect(getAmbiguousUnitBounds('packet', 'Tuna').max).toBe(10);
        expect(getAmbiguousUnitBounds('envelope', 'Hot Chocolate Mix').max).toBe(15);
    });
});

describe('estimateAmbiguousServing clamp', () => {
    it('a food packet keeps the model answer under the food cap (instant oats 40 g was billed 10 g)', async () => {
        answer(40);
        const r = await estimateAmbiguousServing({ foodName: 'Rolled Oats', unit: 'packet' });
        expect(r).toMatchObject({ status: 'success', estimatedGrams: 40 });
    });

    it('a pouch food above the pouch cap clamps to it (tuna 140 g -> 85 g)', async () => {
        answer(140);
        const r = await estimateAmbiguousServing({ foodName: 'Tuna', unit: 'packet' });
        expect(r.estimatedGrams).toBe(85);
    });

    it('a dry food read as the retail tin clamps at the dry cap (Milo 240 g -> 45 g)', async () => {
        answer(240);
        const r = await estimateAmbiguousServing({ foodName: 'Milo', unit: 'packet' });
        expect(r.estimatedGrams).toBe(45);
    });

    it('a non-food packet still clamps at 10 g (the model answered 85 g for a packet of jelly)', async () => {
        answer(85);
        const r = await estimateAmbiguousServing({ foodName: 'Jelly', unit: 'packet' });
        expect(r.estimatedGrams).toBe(10);
    });

    it('with the kill switch off, a food packet clamps at 10 g again', async () => {
        process.env.SERVING_PACKET_FOOD_CAP = '0';
        answer(40);
        const r = await estimateAmbiguousServing({ foodName: 'Rolled Oats', unit: 'packet' });
        expect(r.estimatedGrams).toBe(10);
    });
});

describe('cached-row bound reads the record name (wiring)', () => {
    it('a 43 g packet row on a FOOD record is served (it was refused at 10)', async () => {
        offRow.mockResolvedValue({ grams: 43 });
        const r = await getOrCreateAmbiguousServing('off_0000000000011', 'Instant oatmeal', 'packet');
        expect(r).toMatchObject({ status: 'cached', grams: 43 });
    });

    it('a word-matched piece seed does not answer a food packet (nugget 18 g; the model answers instead)', async () => {
        answer(60);
        const r = await getOrCreateAmbiguousServing('fs_0000000000013', 'Kids Chicken Nuggets', 'packet');
        expect(r).toMatchObject({ status: 'success', grams: 60 });
    });

    it('the same 43 g row on a SUGAR record is still refused and re-estimated (boundary)', async () => {
        offRow.mockResolvedValue({ grams: 43 });
        answer(4);
        const r = await getOrCreateAmbiguousServing('off_0000000000012', 'Granulated sugar', 'packet');
        expect(r.status).not.toBe('cached');
        expect(r.grams).toBe(4);
    });
});
