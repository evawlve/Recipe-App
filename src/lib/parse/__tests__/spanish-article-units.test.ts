/**
 * s459 ES-ART: `un/una/uno` directly before a Spanish unit word (SPANISH_UNIT_TOKENS) is the quantity 1, so
 * `una cucharada de crema de cacahuate` parses exactly as `1 cucharada de crema de cacahuate`. Owner:
 * rewriteSpanishNumeral() in ingredient-line.ts (the SPANISH_NUMERAL_DIGITS map).
 *
 * MEASURED (s459 pd-medida, live deploy 42, cold nosave probes): the article-led line read the whole phrase as the food
 * name and billed the record's own label serving — `una cucharada de crema de cacahuate` 588 g / 3,457 kcal against its
 * digit twin's 16 g / 94 kcal; `una taza de cafe con leche` 50 g against 190 g; `una botella de agua de jamaica` the 100 g
 * floor against 453.6 g.
 *
 * NOT CHANGED: the article before a NOUN (`una manzana`: pd-p4 measured that stripping it moves the ES: key onto worse
 * answers), before a non-unit measure word (`vaso`, `pieza`, `plato`, `orden`), and `medida`, which is not a unit word
 * (s459 pd-medida: as `scoop` it billed a scoop of a ready-to-drink bottle, 11.6 kcal, on 5 of 5 twins; held). Also NOT
 * changed: the article before a unit that names its own measure (`una botella de 600 ml de coca cola`; s459 rf-esart,
 * cold pairs base vs digit twin: 600 g vs 500 g, 473 g vs 355 g, 372 g vs 900 g; articleNamesOwnMeasure()).
 */
import { parseIngredientLine } from '../ingredient-line';
import { SPANISH_UNIT_TOKENS } from '../unit';

const KEYS = ['qty', 'multiplier', 'unit', 'rawUnit', 'name', 'unitHint', 'qualifiers'] as const;
function core(line: string) {
  const r: any = parseIngredientLine(line);
  expect(r).not.toBeNull();
  return Object.fromEntries(KEYS.map((k) => [k, r[k] ?? null]));
}

describe('un/una/uno before a Spanish unit word == the digit-1 twin', () => {
  const cases: Array<[string, string]> = [];
  for (const a of ['un', 'una', 'uno', 'Una', 'UN']) for (const u of Array.from(SPANISH_UNIT_TOKENS)) for (const n of ['arroz', 'pollo fresh']) {
    cases.push([`${a} ${u} de ${n}`, `1 ${u} de ${n}`]);
  }
  test.each(cases)('%s == %s', (word, twin) => {
    expect(core(word)).toEqual(core(twin));
    expect(core(word).qty).toBe(1);
  });
});

describe('the measured members read their unit', () => {
  test.each<[string, string, string]>([
    ['una cucharada de crema de cacahuate', 'tbsp', 'crema de cacahuate'],
    ['una taza de cafe con leche', 'cup', 'cafe con leche'],
    ['una botella de agua de jamaica', 'bottle', 'agua de jamaica'],
    ['una taza de caldo de res', 'cup', 'caldo de res'],
    ['una cucharada de miel', 'tbsp', 'miel'],
    ['un puñado de almendras', 'handful', 'almendras'],
    ['una rebanada de pastel tres leches', 'slice', 'pastel tres leches'],
    ['una lata de atun', 'can', 'atun'],
  ])('%s -> 1 %s of %s', (line, unit, name) => {
    expect(core(line)).toMatchObject({ qty: 1, multiplier: 1, unit, name });
  });
});

describe('everything else is byte-identical to base (qty 1, the whole line is the name)', () => {
  test.each([
    'una manzana', 'un platano', 'un vaso de leche', 'un vaso de agua', 'una pieza de pan', 'un plato de sopa',
    'una orden de tacos', 'una medida de proteína ascent de vainilla', 'una medida de proteína', 'una coca cola de lata',
    'uno pizza', 'una', 'un',
    // s459 rf-esart controls: English words that contain or equal the article, an English unit after it, a hedge before it.
    'tuna salad', 'luna bar', 'Uno Chicago Grill deep dish pizza', 'un cup of coffee', 'una can of tuna', 'como una taza de arroz',
    // s459 rf-esart: the article before a unit that names its OWN measure keeps base (articleNamesOwnMeasure()).
    'una botella de 600 ml de coca cola', 'una lata de 473 ml de cerveza', 'una botella de 355 ml de jugo de naranja',
    'una botella del 600 ml de coca', 'una botella de 1 litro de agua', 'un puñado de 10 almendras',
  ])('%s unchanged', (line) => {
    expect(core(line)).toEqual({ qty: 1, multiplier: 1, unit: null, rawUnit: null, name: line, unitHint: null, qualifiers: null });
  });
  test.each<[string, string]>([
    ['una taza (240 ml) de leche', 'una taza 240 ml de leche'],
    ['una lata 355ml coca', 'una lata 355 ml coca'],
  ])('%s unchanged (own measure; the parser already normalises the name to %s)', (line, name) => {
    expect(core(line)).toEqual({ qty: 1, multiplier: 1, unit: null, rawUnit: null, name, unitHint: null, qualifiers: null });
  });
  test('the own-measure guard is article-only: the numeral-led form is #630\'s and still reads its unit', () => {
    expect(core('dos botellas de 600 ml de coca cola')).toMatchObject({ qty: 2, unit: 'bottle', name: '600 ml de coca cola' });
  });
  test('a percentage is not a measure: `una taza de 2% leche` reads 1 cup', () => {
    expect(core('una taza de 2% leche')).toMatchObject({ qty: 1, unit: 'cup', name: '2% leche' });
  });
  test('`una taza y media` reads 1.5 cups exactly as its digit twin does (s459 ES-YMEDIA, spanish-y-media.test.ts)', () => {
    expect(core('una taza y media de arroz')).toEqual(core('1 taza y media de arroz'));
    expect(core('una taza y media de arroz').qty).toBe(1.5);
  });
  test('English article-led lines keep their own rule', () => {
    expect(core('a cup of rice')).toEqual({ qty: 1, multiplier: 1, unit: 'cup', rawUnit: 'cup', name: 'rice', unitHint: null, qualifiers: null });
  });
});
