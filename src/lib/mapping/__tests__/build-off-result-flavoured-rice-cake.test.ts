/**
 * s457 RC — a counted FLAVOURED rice cake on a label-less OFF record billed the
 * plain 9 g `rice cake` seed (COUNT_DEFAULTS in servings/default-count-grams.ts,
 * reached through getDefaultCountServing()'s last-two-words fallback): Diego's
 * `two chocolate rice cakes` on off_05903002 billed 18 g / 72 kcal against the
 * Quaker label's 2 x 15 g / 120 kcal. Three EXACT aliases fix it; each is three
 * or more words, so neither the last-two-words nor the last-word fallback can
 * return one for another food. Records and panels are the live OffFood rows
 * (s457 pd-rc, read 2026-11-13).
 */

import { buildOffResult } from '../map-ingredient-with-fallback';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { parseOffServingSize } from '../../openfoodfacts/serving-resolver';
import { parseIngredientLine } from '../../parse/ingredient-line';
import { getDefaultCountServing } from '../../servings/default-count-grams';

jest.mock('../../db', () => {
    const table = () => ({
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
    });
    const base: Record<string, unknown> = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        $executeRaw: jest.fn().mockResolvedValue(0),
        $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    };
    return { prisma: new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : (t[k] = table())) }) };
});
jest.mock('../../openfoodfacts/hydrate', () => ({ hydrateOffCandidate: jest.fn() }));

type Rec = { id: string; name: string; brand: string | null; label: string | null; grams: number | null; kcal: number };
const CHOC: Rec = { id: 'off_05903002', name: 'Chocolate rice cakes', brand: null, label: null, grams: null, kcal: 400 };
const CHOC_COLD: Rec = { id: 'off_15398352', name: 'Chocolate Rice Cakes', brand: 'Quaker Oats', label: null, grams: null, kcal: 400 };
const CARAMEL: Rec = { id: 'off_5401014000249', name: 'Caramel rice cakes', brand: null, label: null, grams: null, kcal: 400 };
const CARAMEL_COLD: Rec = { id: 'off_4088600526003', name: 'caramel rice cakes', brand: null, label: null, grams: null, kcal: 395 };
const WCHEDDAR: Rec = { id: 'off_0722441255510', name: 'White cheddar rice cakes', brand: null, label: null, grams: null, kcal: 409.09 };
const QUAKER_12G: Rec = { id: 'off_0055577107874', name: 'Rice Cakes', brand: 'QUAKER', label: '12g', grams: 12, kcal: 500 };
const PLAIN: Rec = { id: 'off_5099839281693', name: 'Rice cakes', brand: null, label: null, grams: null, kcal: 384 };
const QUAKER_CARAMEL_LABEL: Rec = { id: 'off_0030000216910', name: 'Carmel Rice Cake', brand: 'Quaker', label: '1 cake (13 g)', grams: 13, kcal: 385 };
const QUAKER_CHOC_LABEL: Rec = { id: 'off_0030000169483', name: 'Chocolate Rice Cake', brand: 'Quaker', label: '1 cake (15 g)', grams: 15, kcal: 400 };
const KALLO_DARK: Rec = { id: 'off_5013665116677', name: 'Dark chocolate rice cakes', brand: null, label: null, grams: null, kcal: 487 };

const RECS: Record<string, Rec> = Object.fromEntries(
    [CHOC, CHOC_COLD, CARAMEL, CARAMEL_COLD, WCHEDDAR, QUAKER_12G, PLAIN, QUAKER_CARAMEL_LABEL, QUAKER_CHOC_LABEL, KALLO_DARK].map(r => [r.id, r]),
);

async function bill(line: string, id: string) {
    const r = RECS[id];
    const lab = parseOffServingSize(r.label, r.grams);
    (hydrateOffCandidate as jest.Mock).mockResolvedValue({
        foodId: r.id, foodName: r.name, brandName: r.brand,
        nutrientsPer100g: { calories: r.kcal, protein: 8, carbs: 80, fat: 2 },
        servingGrams: r.grams, servingDescription: r.grams ? lab.description : null,
        servingUnitCount: lab.unitCount, packageQuantity: null, packageQuantityUnit: null,
    });
    const cand = { id: r.id, source: 'openfoodfacts', name: r.name, brandName: r.brand, score: 1, foodType: 'generic', rawData: {} } as any;
    return buildOffResult(cand, parseIngredientLine(line), 0.9, line);
}

describe('getDefaultCountServing: flavoured rice cake aliases are exact-only', () => {
    it.each([
        ['chocolate rice cakes', 'chocolate rice cake', 15],
        ['chocolate rice cake', 'chocolate rice cake', 15],
        ['caramel rice cakes', 'caramel rice cake', 13],
        ['white cheddar rice cakes', 'white cheddar rice cake', 11],
        ['rice cakes', 'rice cake', 9],
        ['quaker chocolate rice cakes', 'rice cake', 9],
        ['dark chocolate rice cakes', 'rice cake', 9],
        ['cheddar rice cakes', 'rice cake', 9],
    ])('%s -> %s %d g', (name, key, grams) => {
        expect(getDefaultCountServing(name, 'each')).toMatchObject({ key, grams });
    });
    it.each([['chocolate cakes'], ['caramel'], ['white cheddar']])('%s -> null', (name) => {
        expect(getDefaultCountServing(name, 'each')).toBeNull();
    });
    it('a container unit still skips the exact name', () => {
        expect(getDefaultCountServing('chocolate rice cakes', 'bag')).toBeNull();
    });
});

describe('buildOffResult: counted flavoured rice cakes (s457 RC)', () => {
    it.each<[string, string, number, number]>([
        ['two chocolate rice cakes', 'off_05903002', 30, 120],
        ['3 chocolate rice cakes', 'off_05903002', 45, 180],
        ['Five chocolate rice cakes', 'off_05903002', 75, 300],
        ['two chocolate rice cakes', 'off_15398352', 30, 120],
        ['three caramel rice cakes', 'off_5401014000249', 39, 156],
        ['2 caramel rice cakes', 'off_5401014000249', 26, 104],
        ['three caramel rice cakes', 'off_4088600526003', 39, 154.05],
        ['2 white cheddar rice cakes', 'off_0722441255510', 22, 90],
        ['Six white cheddar rice cakes', 'off_0722441255510', 66, 270],
        ['2.5 chocolate rice cakes', 'off_05903002', 37.5, 150],
    ])('MOVES %s on %s -> seed %d g / %d kcal', async (line, id, grams, kcal) => {
        const r = await bill(line, id);
        expect(r?.servingTier).toBe('seed_count_default');
        expect(r?.grams).toBeCloseTo(grams, 1);
        expect(r?.kcal).toBeCloseTo(kcal, 0);
    });

    it.each<[string, string, string, number]>([
        ['two Quaker chocolate rice cakes', 'off_0055577107874', 'seed_count_default', 18],
        ['2 rice cakes', 'off_5099839281693', 'seed_count_default', 18],
        ['2 dark chocolate rice cakes', 'off_5013665116677', 'seed_count_default', 18],
        ['4 quaker caramel rice cakes', 'off_0030000216910', 'label_count_derived', 52],
        ['2 chocolate rice cakes', 'off_0030000169483', 'label_count_derived', 30],
    ])('HOLDS %s on %s -> %s %d g', async (line, id, tier, grams) => {
        const r = await bill(line, id);
        expect(r?.servingTier).toBe(tier);
        expect(r?.grams).toBeCloseTo(grams, 1);
    });

    it('HOLDS a bare `a chocolate rice cake`: the 20 g bare floor still skips a 15 g piece', async () => {
        const r = await bill('a chocolate rice cake', 'off_05903002');
        expect(r?.servingTier).not.toBe('seed_count_default');
    });
});
