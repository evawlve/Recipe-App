/**
 * s462 SMALL-PRODUCE-PIECE — a counted small fruit or chile on a label-less (or
 * package-labelled) OFF record found no per-piece weight in COUNT_DEFAULTS
 * (servings/default-count-grams.ts) and billed the 100 g count floor, a package,
 * or the 164 g BELL pepper through the bare `pepper` alias: `2 dates` 100 g /
 * 308 kcal, `1 chipotle pepper` 164 g, `1 jalapeño` on off_20071103 100 g.
 * Eleven per-piece rows fix it (USDA-derived generic FatSecret / FDC piece rows;
 * chipotle in adobo from the OffFood label median). Records and panels are the
 * live OffFood rows (s462 pd-produce, read 2026-11-17).
 *
 * The HOLDS pin what the table deliberately does NOT do: a bare singular still
 * never bills a sub-20 g piece; a bare plural asks for a serving; fresh
 * apricot / fig / cherry / raspberry stay OUT (the parser moves `dried` into
 * qualifiers, and `raspberry` / `cherry` end flavoured RECORD names that the
 * ambiguous-unit rung reads); and the eleven rows are EXACT-ONLY, so a flavour
 * or compound name that merely ENDS in one of the words (`Jamon Serrano`,
 * `Activia Prune`, `Jalapeno Chips`, `Sparkling Clementine`) takes no piece
 * (s462 rf-produce replay: `2 slices jamon serrano` 50 -> 2 g, `1 activia
 * prune` 125 -> 8.4 g through the last-word fallback).
 */

import { buildOffResult } from '../map-ingredient-with-fallback';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { parseOffServingSize } from '../../openfoodfacts/serving-resolver';
import { parseIngredientLine } from '../../parse/ingredient-line';
import { getDefaultCountServing, getSubPieceDefault } from '../../servings/default-count-grams';

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

type Rec = {
    id: string; name: string; brand: string | null; label: string | null; grams: number | null; kcal: number;
    pkg?: number | null;
};
const RECS: Record<string, Rec> = Object.fromEntries(([
    { id: 'off_7503019541920', name: 'Dates', brand: null, label: null, grams: null, kcal: 308.36 },
    { id: 'off_0225236567466', name: 'Date Medjool', brand: null, label: '40.0g', grams: 40, kcal: 284 },
    { id: 'off_0071240800040', name: 'Chipotle Peppers', brand: null, label: null, grams: null, kcal: 66.67 },
    { id: 'off_20071103', name: 'Jalapeno', brand: null, label: null, grams: null, kcal: 365 },
    { id: 'off_0810057554810', name: 'Jalapenos', brand: null, label: null, grams: null, kcal: 16.67, pkg: 113.3980925 },
    { id: 'off_0728733004699', name: 'Jalapeno', brand: null, label: '3.5 ONZ (99 g)', grams: 99, kcal: 10 },
    { id: 'off_0627843876083', name: 'Habanero', brand: null, label: null, grams: null, kcal: 20 },
    { id: 'off_9415077044474', name: 'Prunes', brand: null, label: '50.0g', grams: 50, kcal: 255 },
    { id: 'off_0873668004730', name: 'Lychee', brand: 'Nature’s Touch', label: '1.25 cups (145 g)', grams: 145, kcal: 69 },
    { id: 'off_0810376011049', name: 'tangerine', brand: null, label: null, grams: null, kcal: 51.14 },
    { id: 'off_0041735059291', name: 'Clementine', brand: 'Market 32', label: '2 clementines (148 g)', grams: 148, kcal: 47.3 },
    { id: 'off_0869151200345', name: 'Dried apricots', brand: null, label: '5 PCS | ABOUT (40 g)', grams: 40, kcal: 225 },
    { id: 'off_5060058331988', name: 'Activia Prune', brand: 'danone', label: '125g', grams: 125, kcal: 99, pkg: 500 },
    { id: 'off_0841144902047', name: 'Jalapeno Chips', brand: 'Kettle Brand', label: '13.0 chips (28.0 g)', grams: 28, kcal: 536 },
] as Rec[]).map(r => [r.id, r]));

async function bill(line: string, id: string) {
    const r = RECS[id];
    const lab = parseOffServingSize(r.label, r.grams);
    (hydrateOffCandidate as jest.Mock).mockResolvedValue({
        foodId: r.id, foodName: r.name, brandName: r.brand,
        nutrientsPer100g: { calories: r.kcal, protein: 1, carbs: 10, fat: 0.5 },
        servingGrams: r.grams, servingDescription: r.grams ? lab.description : null,
        servingUnitCount: lab.unitCount,
        packageQuantity: r.pkg ?? null, packageQuantityUnit: r.pkg ? 'g' : null,
    });
    const cand = { id: r.id, source: 'openfoodfacts', name: r.name, brandName: r.brand, score: 1, foodType: 'generic', rawData: {} } as any;
    return buildOffResult(cand, parseIngredientLine(line), 0.9, line);
}

describe('getDefaultCountServing: small-produce per-piece rows', () => {
    it.each<[string, string, number]>([
        ['dates', 'date', 8.3],
        ['date', 'date', 8.3],
        ['pitted dates', 'date', 8.3],
        ['medjool dates', 'medjool date', 24],
        ['chipotle peppers', 'chipotle pepper', 15],
        ['jalapeno', 'jalapeno pepper', 14],
        ['a jalapeno pepper', 'jalapeno pepper', 14],
        ['organic medjool dates', 'medjool date', 24],
        ['roasted brussels sprouts', 'brussels sprout', 19],
        ['fresh lychees', 'lychee', 9.6],
        ['a jalapeno', 'jalapeno pepper', 14],
        ['jalapeños', 'jalapeno pepper', 14],
        ['jalapeño pepper', 'jalapeno pepper', 14],
        ['pickled jalapenos', 'jalapeno pepper', 14],
        ['serrano peppers', 'serrano pepper', 6.1],
        ['habaneros', 'habanero pepper', 4.5],
        ['prunes', 'prune', 8.4],
        ['lychees', 'lychee', 9.6],
        ['clementines', 'clementine', 74],
        ['tangerines', 'tangerine', 84],
        ['brussels sprouts', 'brussels sprout', 19],
        ['brussel sprouts', 'brussels sprout', 19],
    ])('%s -> %s %d g', (name, key, grams) => {
        expect(getDefaultCountServing(name, 'each')).toMatchObject({ key, grams });
    });

    it.each([['bell peppers'], ['green pepper'], ['peppers']])('%s still reads the bell pepper (164 g)', (name) => {
        expect(getDefaultCountServing(name, 'each')).toMatchObject({ key: 'bell pepper', grams: 164 });
    });

    it.each([['apricots'], ['figs'], ['cherries'], ['raspberries'], ['chipotle']])(
        '%s stays unseeded (dried qualifier / flavour-word hazard)', (name) => {
            expect(getDefaultCountServing(name, 'each')).toBeNull();
        });

    it('a flavour-named record on an ambiguous unit keeps its own scoop (`Ghost Clear Whey Blue Raspberry`)', () => {
        expect(getDefaultCountServing('Ghost Clear Whey Blue Raspberry', 'scoop')).toBeNull();
    });

    const SMALL_PRODUCE_KEYS = ['jalapeno pepper', 'serrano pepper', 'habanero pepper', 'chipotle pepper', 'date', 'medjool date',
        'prune', 'lychee', 'clementine', 'tangerine', 'brussels sprout'];
    it.each([
        ['Cape cod jalapeno'], ['Jalapeno Chips'], ['Cheese, Jalapeno'], ['Jamon Serrano'], ['Jamón serrano'], ['Activia Prune'],
        ['Sparkling Clementine'], ['Sbarro, IZZE Twizt, Clementine'], ['Mamoul With Date'], ['Smart Bars - Carrot Date'],
        ['Bacon habanero'], ['Bacon Wrapped Dates'], ['ST Jelly Cup Lychee'], ['Fruit bars, tangerine'],
        ['Hormel, black label, thick cut bacon, jalapeno, jalapeno'], ['Monterey Jack Cheese With Jalapeno Peppers'],
        ['bacon wrapped jalapeño peppers'], ['dried chipotle pepper'],
    ])('EXACT-ONLY: `%s` merely ends in a produce word and takes no produce piece', (name) => {
        for (const unit of ['each', 'piece', 'serving', 'scoop', 'slice']) {
            expect(SMALL_PRODUCE_KEYS).not.toContain(getDefaultCountServing(name, unit)?.key);
        }
    });

    it.each([['Jamon Serrano'], ['Jamón serrano'], ['Cheese, Jalapeno'], ['Hormel, black label, thick cut bacon, jalapeno, jalapeno']])(
        'EXACT-ONLY: a slice or strip of `%s` is not a sliver of a chile', (name) => {
            expect(getSubPieceDefault(name, 'slice')).toBeNull();
            expect(getSubPieceDefault(name, 'strip')).toBeNull();
        });

    it.each([['serving'], ['servings'], ['portion'], ['scoop'], ['slice'], ['packet'], ['cup']])(
        'EXACT-ONLY rows answer only a piece: `Roasted Brussels Sprouts` / `Dates` on unit %s take no produce piece', (unit) => {
            expect(SMALL_PRODUCE_KEYS).not.toContain(getDefaultCountServing('Roasted Brussels Sprouts', unit)?.key);
            expect(SMALL_PRODUCE_KEYS).not.toContain(getDefaultCountServing('Dates', unit)?.key);
        });

    it.each([['piece'], ['whole'], ['large']])('a piece unit (%s) on an exact produce name still takes the piece', (unit) => {
        expect(getDefaultCountServing('medjool dates', unit, unit === 'large' ? 'large' : undefined)).toMatchObject({ key: 'medjool date', grams: 24 });
    });

    it('a container unit still skips the name (`a bag of dates`)', () => {
        expect(getDefaultCountServing('dates', 'bag')).toBeNull();
    });
});

describe('buildOffResult: counted small produce (s462 SMALL-PRODUCE-PIECE)', () => {
    it.each<[string, string, number]>([
        ['2 dates', 'off_7503019541920', 16.6],
        ['3 dates', 'off_7503019541920', 24.9],
        ['3 medjool dates', 'off_0225236567466', 72],
        ['1 chipotle pepper', 'off_0071240800040', 15],
        ['1 jalapeño', 'off_20071103', 14],
        ['2 jalapeños', 'off_0810057554810', 28],
        ['1 jalapeño', 'off_0728733004699', 14],
        ['2 habaneros', 'off_0627843876083', 9],
        ['3 prunes', 'off_9415077044474', 25.2],
        ['3 lychees', 'off_0873668004730', 28.8],
        ['2 tangerines', 'off_0810376011049', 168],
        ['a tangerine', 'off_0810376011049', 84],
        ['2 clementines', 'off_0041735059291', 148],
    ])('MOVES %s on %s -> seed %d g', async (line, id, grams) => {
        const r = await bill(line, id);
        expect(r?.servingTier).toBe('seed_count_default');
        expect(r?.grams).toBeCloseTo(grams, 1);
    });

    it('MOVES `2 dates` from the 308 kcal floor to ~51 kcal', async () => {
        const r = await bill('2 dates', 'off_7503019541920');
        expect(r?.kcal).toBeCloseTo(51.2, 0);
    });

    it('HOLDS a bare `a jalapeño`: the record label wins and the 20 g bare floor still skips a 14 g piece', async () => {
        const r = await bill('a jalapeño', 'off_0728733004699');
        expect(r?.servingTier).toBe('bare_label_serving');
        expect(r?.grams).toBe(99);
    });

    it.each<[string, string]>([
        ['dates', 'off_7503019541920'],
        ['a date', 'off_7503019541920'],
        ['three dried apricots', 'off_0869151200345'],
        ['1 activia prune', 'off_5060058331988'],
        ['2 activia prune', 'off_5060058331988'],
        ['1 kettle brand jalapeno', 'off_0841144902047'],
    ])('HOLDS %s on %s: no per-piece seed', async (line, id) => {
        const r = await bill(line, id);
        expect(r?.servingTier).not.toBe('seed_count_default');
    });
});
