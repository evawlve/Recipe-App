/**
 * C6970 D30: a leading Spanish numeral is rewritten to its digit ONLY when the next token is a Spanish unit word
 * (SPANISH_UNIT_TOKENS). `dos tazas de leche` then parses exactly as `2 tazas de leche`.
 * NOT rewritten: un/una/uno, noun-led lines (`dos huevos`), `pieza`, `siete` (a single-token brand: detectBrandInQuery()
 * reads the pre-rewrite line, so `siete ...` would skip the qualifier/hint strips its digit twin applies).
 * Parity holds from mergedTokens onward; the pre-token passes still see the word.
 */
import { parseIngredientLine } from '../ingredient-line';
import { SPANISH_UNIT_TOKENS } from '../unit';

const KEYS = ['qty', 'multiplier', 'unit', 'rawUnit', 'name', 'unitHint', 'qualifiers'] as const;
function core(line: string) {
  const r: any = parseIngredientLine(line);
  expect(r).not.toBeNull();
  return Object.fromEntries(KEYS.map((k) => [k, r[k] ?? null]));
}

const NUMERALS: Array<[string, string]> = [
  ['dos', '2'], ['tres', '3'], ['cuatro', '4'], ['cinco', '5'], ['seis', '6'],
  ['ocho', '8'], ['nueve', '9'], ['diez', '10'], ['media', '1/2'], ['medio', '1/2'],
];
const UNITS = Array.from(SPANISH_UNIT_TOKENS);
const NAMES = ['arroz', 'pollo fresh'];

describe('numeral before a Spanish unit word == digit twin', () => {
  const cases: Array<[string, string, string]> = [];
  for (const [w, d] of NUMERALS) for (const u of UNITS) for (const n of NAMES) {
    cases.push([`${w} ${u} de ${n}`, `${d} ${u} de ${n}`, w]);
  }
  test.each(cases)('%s == %s', (word, twin, w) => {
    expect(core(word)).toEqual(core(twin));
    if (w === 'media' || w === 'medio') expect(core(word).qty).toBe(0.5);
  });

  test.each([
    ['dos tazas de leche', '2 tazas de leche'],
    ['Dos Tazas de Leche', '2 Tazas de Leche'],
    ['dos tazas', '2 tazas'],
    ['media taza de fresas', '1/2 taza de fresas'],
    ['dos rebanadas de pan bimbo', '2 rebanadas de pan bimbo'],
    ['tres rebanadas de pan integral', '3 rebanadas de pan integral'],
  ])('%s == %s', (word, twin) => {
    expect(core(word)).toEqual(core(twin));
  });

  test('qty is the digit, not the word-as-name', () => {
    expect(core('dos tazas de leche')).toMatchObject({ qty: 2, unit: 'cup', name: 'leche' });
    expect(core('media taza de fresas')).toMatchObject({ qty: 0.5, unit: 'cup', name: 'fresas' });
  });
});

describe('everything else is byte-identical to BASE (captured on origin/master 41af7084)', () => {
  const same = (n: string) => ({ qty: 1, multiplier: 1, unit: null, rawUnit: null, name: n, unitHint: null, qualifiers: null });
  test.each([
    'dos huevos', 'media manzana', 'medio aguacate', 'dos piezas de pan', 'dos tamales de pollo',
    'tres tacos al pastor', 'una taza de arroz', 'una cucharada de miel', 'un vaso de leche', 'tres leches',
    'tres leches cake', 'dos equis', 'media crema', 'siete tortilla chips', 'once upon a farm', 'dos', 'media',
    'siete cucharadas de azucar', 'siete tazas de pollo fresh',
  ])('%s unchanged', (line) => {
    expect(core(line)).toEqual(same(line));
  });
  test('half cup of rice', () => {
    expect(core('half cup of rice')).toEqual({ qty: 0.5, multiplier: 1, unit: 'cup', rawUnit: 'cup', name: 'rice', unitHint: null, qualifiers: null });
  });
  test('digit-led Spanish line', () => {
    expect(core('2 cucharadas de crema de cacahuate')).toEqual({ qty: 2, multiplier: 1, unit: 'tbsp', rawUnit: 'cucharadas', name: 'crema de cacahuate', unitHint: null, qualifiers: null });
  });
});
