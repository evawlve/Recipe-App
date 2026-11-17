/**
 * s461 ABBREV: recipe unit abbreviations in the two shapes the first call site never reached.
 *
 * 1. The table's holes: `tb`, `tblsp`, `ozs`, `fl oz.`, `pt` (lowercase only), `qt.` `qts`, `gal` (with or without the period).
 * 2. A line that opens with article / fraction words and no explicit quantity: `half a t butter`, `a quarter c walnuts`, and,
 *    after a bare article, only before `of` (`a T of honey`). expandLeadingAbbreviation() in unit-abbreviations.ts.
 *
 * MEASURED (s461 pd-abbrev, live deploy 46 `NkORX32uoG_AT0Zyxz_ba`, cold nosave probes, member vs spelled twin):
 * `1 gal milk` 240 g vs 3,785 g; `1 pt ice cream` 133 g vs 237 g; `a pt of ice cream` 133 g vs 237 g;
 * `half a c of rice` 50 g (floor) vs 79 g. Acceptance is TWIN EQUIVALENCE (the abbreviated line parses exactly like its
 * spelled-out twin), not the grams the twin serves.
 * NOT members (pinned below): `pk` (`12 pk coke` is a 12-pack), `pts` (points), `ea` (each), `sm`/`med`/`lg` (size words),
 * uppercase `PT`, `sl` (its twin `2 slices cheddar` bills 34 g cold where `2 sl cheddar` bills 56 g today), bare `qt`
 * (QT is QuikTrip: `1 QT hot dog` bills one 57 g hot dog today and its twin `1 quart hot dog` 473 g; s461 rf-abbrev). KNOWN COST: a hedge before the article (`about a T of honey`) still stays unexpanded.
 */
import { parseIngredientLine } from '../ingredient-line';
import { expandUnitAbbreviation, expandLeadingAbbreviation } from '../unit-abbreviations';

const KEYS = ['qty', 'multiplier', 'unit', 'name', 'unitHint', 'qualifiers'] as const;
function core(line: string) {
  const r: any = parseIngredientLine(line);
  expect(r).not.toBeNull();
  return Object.fromEntries(KEYS.map((k) => [k, r[k] ?? null]));
}

describe('the abbreviated line equals its spelled-out twin (qty, unit, name)', () => {
  test.each<[string, string, number, string, string]>([
    ['half a t butter', 'half a tsp butter', 0.5, 'tsp', 'butter'],
    ['half a T olive oil', 'half a tbsp olive oil', 0.5, 'tbsp', 'olive oil'],
    ['a half t honey', 'a half tsp honey', 0.5, 'tsp', 'honey'],
    ['half a c of rice', 'half a cup of rice', 0.5, 'cup', 'rice'],
    ['a quarter c walnuts', 'a quarter cup walnuts', 0.25, 'cup', 'walnuts'],
    ['a quarter t salt', 'a quarter tsp salt', 0.25, 'tsp', 'salt'],
    ['half a tb of butter', 'half a tbsp of butter', 0.5, 'tbsp', 'butter'],
    ['half a gal of milk', 'half a gallon of milk', 0.5, 'gallon', 'milk'],
    ['a T of honey', 'a tbsp of honey', 1, 'tbsp', 'honey'],
    ['a T. of honey', 'a tbsp of honey', 1, 'tbsp', 'honey'],
    ['a t. of salt', 'a tsp of salt', 1, 'tsp', 'salt'],
    ['a c of milk', 'a cup of milk', 1, 'cup', 'milk'],
    ['a pt of ice cream', 'a pint of ice cream', 1, 'pint', 'ice cream'],
    ['a cn of tuna', 'a can of tuna', 1, 'can', 'tuna'],
    ['a qt. of milk', 'a quart of milk', 1, 'quart', 'milk'],
    ['a pkg of ramen', 'a package of ramen', 1, 'package', 'ramen'],
    ['1 tblsp honey', '1 tbsp honey', 1, 'tbsp', 'honey'],
    ['1 tb peanut butter', '1 tbsp peanut butter', 1, 'tbsp', 'peanut butter'],
    ['1 Tb honey', '1 tbsp honey', 1, 'tbsp', 'honey'],
    ['1 qt. milk', '1 quart milk', 1, 'quart', 'milk'],
    ['2 qts milk', '2 quarts milk', 2, 'quart', 'milk'],
    ['1 gal milk', '1 gallon milk', 1, 'gallon', 'milk'],
    ['1 gal. milk', '1 gallon milk', 1, 'gallon', 'milk'],
    ['2 gals water', '2 gallons water', 2, 'gallon', 'water'],
    ['1 pt ice cream', '1 pint ice cream', 1, 'pint', 'ice cream'],
    ['2 ozs chicken', '2 oz chicken', 2, 'oz', 'chicken'],
    ['2 fl oz. milk', '2 fl oz milk', 2, 'floz', 'milk'],
  ])('%s == %s', (line, twin, q, unit, name) => {
    expect(core(line)).toEqual(core(twin));
    expect(core(line)).toMatchObject({ qty: q, multiplier: 1, unit, name });
  });
});

describe('membership and guards', () => {
  test('not members: pk, pts, ea, sm, med, lg, sl, uppercase PT, bare qt', () => {
    for (const t of ['pk', 'pts', 'ea', 'sm', 'med', 'lg', 'lrg', 'sl', 'sl.', 'PT', 'PT.', 'qt', 'QT']) expect(expandUnitAbbreviation(t, 'milk')).toBeNull();
  });
  test('the leading rule needs a lead word, a word after the token, and `of` after a bare article', () => {
    const run = (line: string) => { const t = line.split(' '); expandLeadingAbbreviation(t); return t.join(' '); };
    expect(run('t butter')).toBe('t butter');
    expect(run('c of milk')).toBe('c of milk');
    expect(run('half a c')).toBe('half a c');
    expect(run('half a c (8 oz) milk')).toBe('half a c (8 oz) milk');
    expect(run('a c note')).toBe('a c note');
    expect(run('a c of milk')).toBe('a cup of milk');
    expect(run('half a c note')).toBe('half a cup note');
  });
});

// Byte-identical to master 19983c18 (parseIngredientLine() output pinned).
describe('CONTROLS: non-food letters, brands, size words and excluded tokens are unchanged', () => {
  test.each<[string, unknown]>([
    ["a c note", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a c note","notes":null,"unitHint":null}],
    ["a T shirt", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a T shirt","notes":null,"unitHint":null}],
    ["a gal pal", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a gal pal","notes":null,"unitHint":null}],
    ["a c and h sugar", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a c and h sugar","notes":null,"unitHint":null}],
    ["a PT bar", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a PT bar","notes":null,"unitHint":null}],
    ["1 PT bar", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"PT bar","notes":null,"unitHint":null}],
    ["a pt cruiser", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a pt cruiser","notes":null,"unitHint":null}],
    ["a c rice", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a c rice","notes":null,"unitHint":null}],
    ["a t bone steak", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a t bone steak","notes":null,"unitHint":null}],
    ["half a t-bone steak", {"qty":0.5,"multiplier":1,"unit":null,"rawUnit":null,"name":"a t-bone steak","notes":null,"unitHint":null}],
    ["a c4 energy drink", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a c4 energy drink","notes":null,"unitHint":null}],
    ["12 pk coke", {"qty":12,"multiplier":1,"unit":null,"rawUnit":null,"name":"pk coke","notes":null,"unitHint":null}],
    ["a 12 pk of beer", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a 12 pk of beer","notes":null,"unitHint":null}],
    ["3 pts weight watchers bar", {"qty":3,"multiplier":1,"unit":null,"rawUnit":null,"name":"pts weight watchers bar","notes":null,"unitHint":null}],
    ["an ea sports drink", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"an ea sports drink","notes":null,"unitHint":null}],
    ["a c de aceite", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a c de aceite","notes":null,"unitHint":null}],
    ["half a t", {"qty":0.5,"multiplier":1,"unit":null,"rawUnit":null,"name":"a t","notes":null,"unitHint":null}],
    ["half a c (8 oz) milk", {"qty":0.5,"multiplier":1,"unit":null,"rawUnit":null,"name":"a c 8 oz milk","notes":null,"unitHint":null}],
    ["half a t 2% milk", {"qty":0.5,"multiplier":1,"unit":null,"rawUnit":null,"name":"a t 2% milk","notes":null,"unitHint":null}],
    ["a vitamin c", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a vitamin c","notes":null,"unitHint":null}],
    ["half a gala apple", {"qty":0.5,"multiplier":1,"unit":null,"rawUnit":null,"name":"a gala apple","notes":null,"unitHint":null}],
    ["1 med apple", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"med apple","notes":null,"unitHint":null}],
    ["2 ea eggs", {"qty":2,"multiplier":1,"unit":null,"rawUnit":null,"name":"ea eggs","notes":null,"unitHint":null}],
    ["about a T of honey", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"about a T of honey","notes":null,"unitHint":null}],
    ["1 qt hot dog", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"qt hot dog","notes":null,"unitHint":null}],
    ["1 QT hot dog", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"QT hot dog","notes":null,"unitHint":null}],
    ["2 qt taquitos", {"qty":2,"multiplier":1,"unit":null,"rawUnit":null,"name":"qt taquitos","notes":null,"unitHint":null}],
    ["half a qt hot dog", {"qty":0.5,"multiplier":1,"unit":null,"rawUnit":null,"name":"a qt hot dog","notes":null,"unitHint":null}],
  ])('%s', (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
  });
});
