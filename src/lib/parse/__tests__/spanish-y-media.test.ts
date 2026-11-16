/**
 * s459 ES-YMEDIA: `una taza y media de arroz` is 1.5 cups, exactly as its digit twin `1.5 taza de arroz`. The Spanish twin
 * of the English same-unit continuation (`a cup and a half of rice`). Owner: spanishFractionAfterY() in ingredient-line.ts,
 * read at the continuation site, by leadingMeasureWordIsName() (`taza y media de arroz`) and by rewriteSpanishNumeral()
 * (numeral first: `una y media tazas de arroz`).
 *
 * MEASURED (s459 pd-ymedia, live deploy 42, cold nosave probes, real line vs digit twin, same foodId on 7 of 7 pairs):
 * `una cucharada y media de azucar` 4.2 g / 16 kcal vs 19.1 g / 74; `una lata y media de atun` 57 g vs 210 g;
 * `dos cucharadas y media de aceite de oliva` 27 g vs 33.75 g; `una taza y cuarto de leche` 250 g vs 300 g.
 *
 * The food-name guard is the anchor: `de`/`del` and a word must follow the fraction, so `y media luna`, `y media crema`,
 * `y media taza de ...`, `y media noche`, `y media docena de ...` decline. KNOWN COST: the `[un] cuarto de <food>` dish names
 * right after a unit word (`una taza y cuarto de libra`, `una taza y un cuarto de pollo`, `una lata y un cuarto de libra con
 * queso`). MEASURED (s459 rf-ymedia, cold): the AI segmenter split or rewrote those lines before the parse in 4 of 4 draws.
 */
import { parseIngredientLine } from '../ingredient-line';
import { SPANISH_UNIT_TOKENS } from '../unit';

const KEYS = ['qty', 'multiplier', 'unit', 'rawUnit', 'name', 'unitHint', 'qualifiers'] as const;
function core(line: string) {
  const r: any = parseIngredientLine(line);
  expect(r).not.toBeNull();
  return Object.fromEntries(KEYS.map((k) => [k, r[k] ?? null]));
}

describe('`<n> <unit> y <fraction> de <food>` == the digit twin, every Spanish unit word', () => {
  const FRACTIONS: Array<[string, number]> = [['y media', 0.5], ['y medio', 0.5], ['y cuarto', 0.25], ['y un cuarto', 0.25], ['y tres cuartos', 0.75]];
  const LEADS: Array<[string, number]> = [['una', 1], ['1', 1], ['dos', 2], ['3', 3]];
  const cases: Array<[string, string, number]> = [];
  for (const u of Array.from(SPANISH_UNIT_TOKENS)) for (const [f, fv] of FRACTIONS) for (const [lead, lv] of LEADS) {
    cases.push([`${lead} ${u} ${f} de arroz`, `${lv + fv} ${u} de arroz`, lv + fv]);
  }
  test.each(cases)('%s == %s', (line, twin, q) => {
    expect(core(line)).toEqual(core(twin));
    expect(core(line).qty).toBe(q);
  });
});

describe('the measured members and the other two shapes', () => {
  test.each<[string, number, string, string]>([
    ['una taza y media de arroz', 1.5, 'cup', 'arroz'],
    ['1 taza y media de arroz', 1.5, 'cup', 'arroz'],
    ['dos tazas y media de arroz', 2.5, 'cup', 'arroz'],
    ['una cucharada y media de azucar', 1.5, 'tbsp', 'azucar'],
    ['dos cucharadas y media de aceite de oliva', 2.5, 'tbsp', 'aceite de oliva'],
    ['una taza y cuarto de leche', 1.25, 'cup', 'leche'],
    ['una lata y media de atun', 1.5, 'can', 'atun'],
    ['una taza y media del arroz', 1.5, 'cup', 'arroz'],
    ['Una Taza Y Media De Arroz', 1.5, 'cup', 'Arroz'],
    // no leading quantity (leadingMeasureWordIsName() must not take `taza` as the food's first word)
    ['taza y media de arroz', 1.5, 'cup', 'arroz'],
    // numeral first (rewriteSpanishNumeral())
    ['una y media tazas de arroz', 1.5, 'cup', 'arroz'],
    ['1 y media tazas de arroz', 1.5, 'cup', 'arroz'],
    ['dos y media tazas de arroz', 2.5, 'cup', 'arroz'],
  ])('%s -> %s %s of %s', (line, qty, unit, name) => {
    expect(core(line)).toMatchObject({ qty, multiplier: 1, unit, name });
  });
});

describe('food names and second items decline (the #701 parse is kept)', () => {
  test.each<[string, number, string | null, string]>([
    ['media luna', 1, null, 'media luna'],
    ['una media luna', 1, null, 'una media luna'],
    ['un sandwich medianoche', 1, null, 'un sandwich medianoche'],
    ['media crema', 1, null, 'media crema'],
    ['una cucharada de media crema', 1, 'tbsp', 'media crema'],
    ['una taza de cafe y media luna', 1, 'cup', 'cafe y media luna'],
    ['una taza y media luna', 1, 'cup', 'y media luna'],
    ['una taza y media crema', 1, 'cup', 'y media crema'],
    ['una taza y media taza de leche', 1, 'cup', 'y media taza de leche'],
    ['una taza de arroz y media taza de frijoles', 1, 'cup', 'arroz y media taza de frijoles'],
    ['dos tazas y media noche', 2, 'cup', 'y media noche'],
    ['una taza y media docena de huevos', 1, 'cup', 'y media docena de huevos'],
    ['una lata de coca y media', 1, 'can', 'coca y media'],
    ['1 taza de cafe y medio pan', 1, 'cup', 'cafe y medio pan'],
    ['una taza y media', 1, 'cup', 'y media'],
    ['una botella de 600 ml y media', 1, null, 'una botella de 600 ml y media'],
    ['un cuarto de libra con queso', 1, null, 'un cuarto de libra con queso'],
    ['dos tortillas y media', 2, null, 'tortillas y media'],
    ['half and half', 1, null, 'half and half'],
    ['a cup of half and half', 1, 'cup', 'half and half'],
    ['2 tbsp half and half', 2, 'tbsp', 'half and half'],
  ])('%s unchanged', (line, qty, unit, name) => {
    expect(core(line)).toMatchObject({ qty, multiplier: 1, unit, name });
  });
  test('an English unit before `y media` is not read (Spanish unit words only)', () => {
    expect(core('1 cup y media de arroz')).toMatchObject({ qty: 1, unit: 'cup', name: 'y media de arroz' });
  });
  test.each<[string, number, string, string]>([
    ['una taza y cuarto de libra', 1.25, 'cup', 'libra'],
    ['una taza y un cuarto de pollo', 1.25, 'cup', 'pollo'],
    ['una lata y un cuarto de libra con queso', 1.25, 'can', 'libra con queso'],
  ])('KNOWN COST, pinned: %s reads %s %s of %s', (line, qty, unit, name) => {
    expect(core(line)).toMatchObject({ qty, multiplier: 1, unit, name });
  });
});

describe('English keeps its own rule', () => {
  test.each<[string, number, string, string]>([
    ['a cup and a half of rice', 1.5, 'cup', 'rice'],
    ['1 and a half cups of rice', 1.5, 'cup', 'rice'],
    ['cup and a half of rice', 1.5, 'cup', 'rice'],
    ['a cup and a quarter of milk', 1.25, 'cup', 'milk'],
  ])('%s -> %s %s of %s', (line, qty, unit, name) => {
    expect(core(line)).toMatchObject({ qty, multiplier: 1, unit, name });
  });
});
