/**
 * s459 ES-UNITSET-KILO: `kilo(s)`, `libra(s)`, `onza(s)` are Spanish unit words (SPANISH_UNIT_TOKENS in unit.ts), so the set's
 * parse consumers (the article `un/una` = 1, `y medio`, the word fraction `tres cuartos de`, the dropped `de`) read them as they
 * read `taza`: `un kilo y medio de pollo` is 1.5 kg of `pollo`, exactly as its twin `1.5 kilogramos de pollo`.
 *
 * MEASURED (s459 pd-kilo, live deploy 44 `1FcoqURbnti8xu8neHcFv`, cold nosave probes, real line vs twin, same foodId):
 * `un kilo y medio de pollo` 113 g vs 1,500 g; `media libra de queso` 14 g (another record) vs 227 g; `tres cuartos de libra de
 * carne molida` 510 g vs 340 g; `dos libras de pollo` 227 g vs 907 g.
 *
 * Guards pinned below: `un cuarto de libra con queso` (McDonald's) keeps its name, because the word fraction needs `de <word>` after
 * the unit. `kilo` is also English, so isSpanishLine() does not count it as a marker (`a kilo of pasta` stays English). NOT in the
 * set: `vaso` (no `glass` unit). `litro(s)` joined in s461 ES-UNITSET-LITRO (spanish-litro-units.test.ts).
 * KNOWN COST, pinned: a chain after `cuarto de libra de` reads as the food (`[un] cuarto de libra de mcdonalds` = 0.25 lb of
 * `mcdonalds`; 0 MEL events in any arm). `16 onzas de agua` = 16 oz of bare `agua`, which bills water at 0 kcal since #710.
 */
import { parseIngredientLine } from '../ingredient-line';
import { SPANISH_UNIT_TOKENS } from '../unit';
import { isSpanishLine } from '../../mapping/spanish-detect';

const KEYS = ['qty', 'multiplier', 'unit', 'name', 'unitHint', 'qualifiers'] as const;
function core(line: string) {
  const r: any = parseIngredientLine(line);
  expect(r).not.toBeNull();
  return Object.fromEntries(KEYS.map((k) => [k, r[k] ?? null]));
}

describe('membership', () => {
  test('kilo, libra and onza (both numbers) are Spanish unit words', () => {
    for (const t of ['kilo', 'kilos', 'libra', 'libras', 'onza', 'onzas']) expect(SPANISH_UNIT_TOKENS.has(t)).toBe(true);
  });
  test('vaso is not', () => {
    for (const t of ['vaso', 'vasos']) expect(SPANISH_UNIT_TOKENS.has(t)).toBe(false);
  });
});

describe('the measured members equal their twins (qty, unit, name)', () => {
  test.each<[string, string, number, string, string]>([
    ['un kilo y medio de pollo', '1.5 kilogramos de pollo', 1.5, 'kg', 'pollo'],
    ['1 kilo y medio de pollo', '1.5 kilogramos de pollo', 1.5, 'kg', 'pollo'],
    ['un kilo de pollo', '1 kilogramo de pollo', 1, 'kg', 'pollo'],
    ['medio kilo de carne molida', '0.5 kilogramo de carne molida', 0.5, 'kg', 'carne molida'],
    ['un cuarto de kilo de jamón', '0.25 kilogramos de jamón', 0.25, 'kg', 'jamón'],
    ['2 kilos de papas', '2 kilogramos de papas', 2, 'kg', 'papas'],
    ['media libra de queso', '0.5 lb queso', 0.5, 'lb', 'queso'],
    ['una libra de carne', '1 lb carne', 1, 'lb', 'carne'],
    ['una libra y media de carne', '1.5 lb carne', 1.5, 'lb', 'carne'],
    ['tres cuartos de libra de carne molida', '0.75 lb carne molida', 0.75, 'lb', 'carne molida'],
    ['un cuarto de libra de jamón', '0.25 lb jamón', 0.25, 'lb', 'jamón'],
    ['dos libras de pollo', '2 lbs pollo', 2, 'lb', 'pollo'],
    ['una onza de queso', '1 oz queso', 1, 'oz', 'queso'],
    ['8 onzas de bistec', '8 oz bistec', 8, 'oz', 'bistec'],
    ['dos onzas de queso', '2 oz queso', 2, 'oz', 'queso'],
    ['8 onzas de leche', '8 oz leche', 8, 'oz', 'leche'],
  ])('%s == %s', (line, twin, q, unit, name) => {
    expect(core(line)).toEqual(core(twin));
    expect(core(line)).toMatchObject({ qty: q, multiplier: 1, unit, name });
  });
});

describe('KNOWN COST: a chain name after `cuarto de libra de` reads as the food', () => {
  test.each<[string, string]>([
    ['un cuarto de libra de mcdonalds', 'mcdonalds'],
    ['cuarto de libra de mcdonalds', 'mcdonalds'],
    ["un cuarto de libra de McDonald's", "McDonald's"],
  ])('%s', (line, name) => {
    expect(core(line)).toMatchObject({ qty: 0.25, unit: 'lb', name });
  });
});

describe('onza before bare agua reads 16 oz of `agua` (water since #710)', () => {
  test('16 onzas de agua', () => {
    expect(core('16 onzas de agua')).toMatchObject({ qty: 16, unit: 'oz', name: 'agua' });
  });
});

describe('isSpanishLine: kilo is not a marker, libra is', () => {
  test.each<[string, boolean]>([
    ['a kilo of pasta', false],
    ['1 kilo of mango', false],
    ['half a kilo of grapes', false],
    ['0.25 libra de jamón', true],
    ['un kilo de pollo', true],
  ])('%s -> %s', (line, es) => {
    expect(isSpanishLine(line)).toBe(es);
  });
});

// Byte-identical to master 2369d10b (parseIngredientLine() output pinned).
describe('CONTROLS: food names, vaso, English kilo lines are unchanged', () => {
  test.each<[string, unknown]>([
    ["un cuarto de libra con queso", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"un cuarto de libra con queso","notes":null,"unitHint":null}],
    ["cuarto de libra con queso", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"cuarto de libra con queso","notes":null,"unitHint":null}],
    ["cuarto de libra", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"cuarto de libra","notes":null,"unitHint":null}],
    ["un cuarto de libra", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"un cuarto de libra","notes":null,"unitHint":null}],
    ["una hamburguesa cuarto de libra", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"una hamburguesa cuarto de libra","notes":null,"unitHint":null}],
    ["un cuarto de pollo", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"un cuarto de pollo","notes":null,"unitHint":null}],
    ["media luna", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"media luna","notes":null,"unitHint":null}],
    ["un vaso de leche", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"un vaso de leche","notes":null,"unitHint":null}],
    ["un vaso y medio de leche", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"un vaso y medio de leche","notes":null,"unitHint":null}],
    ["una taza y media de arroz", {"qty":1.5,"multiplier":1,"unit":"cup","rawUnit":"taza","name":"arroz","notes":null,"unitHint":null}],
    ["1.5 kg chicken", {"qty":1.5,"multiplier":1,"unit":"kg","rawUnit":"kg","name":"chicken","notes":null,"unitHint":null}],
    ["0.5 lb cheese", {"qty":0.5,"multiplier":1,"unit":"lb","rawUnit":"lb","name":"cheese","notes":null,"unitHint":null}],
    ["a kilo of apples", {"qty":1,"multiplier":1,"unit":"kg","rawUnit":"kilo","name":"apples","notes":null,"unitHint":null}],
    ["half a kilo of grapes", {"qty":0.5,"multiplier":1,"unit":"kg","rawUnit":"kilo","name":"grapes","notes":null,"unitHint":null}],
    ["a kilo and a half of chicken", {"qty":1.5,"multiplier":1,"unit":"kg","rawUnit":"kilo","name":"chicken","notes":null,"unitHint":null}],
    ["libra de carne", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"libra de carne","notes":null,"unitHint":null}],
    ["onza de queso", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"onza de queso","notes":null,"unitHint":null}],
  ])('%s', (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
  });
});
