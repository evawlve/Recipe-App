/**
 * s462 ES-TEEN-UNIT: a Spanish count above `diez` directly before a Spanish unit word (SPANISH_UNIT_TOKENS) reads as its digit,
 * through readSpanishCount() in rewriteSpanishNumeral(): `doce onzas de cerveza` parses exactly as `12 onzas de cerveza`.
 * Before, `onza(s)`/`litro(s)` sat in SPANISH_COUNT_STOP_NEXT (listed there before they were unit words) and `once`/`quince` in
 * SPANISH_COUNT_EXCLUDED (English words), so the whole line stayed the name and billed one serving.
 *
 * MEASURED (s462 pd-esteen, live deploy 49 `h4EUm_rlJ0KcVxGnEkZTi`, cold nosave probes, line vs digit twin): `doce onzas de
 * cerveza` 355 g / 30 kcal vs 340 g / 146; `veinte onzas de refresco` 369 g vs 567 g; `dieciséis onzas de leche` 250 g vs 454 g;
 * `treinta y dos onzas de gatorade` 591 g vs 907 g; `dieciséis onzas de bistec` 28 g vs 454 g. Organic population 0.
 * NOT moved: `siete` (detectBrandInQuery() reads every `siete <unit> de ...` as the brand Siete), noun-led lines, English lines.
 */
import { parseIngredientLine } from '../ingredient-line';
import { SPANISH_UNIT_TOKENS } from '../unit';

const KEYS = ['qty', 'multiplier', 'unit', 'rawUnit', 'name', 'unitHint', 'qualifiers'] as const;
function core(line: string) {
  const r: any = parseIngredientLine(line);
  expect(r).not.toBeNull();
  return Object.fromEntries(KEYS.map((k) => [k, r[k] ?? null]));
}

const COUNTS: Array<[string, string]> = [
  ['once', '11'], ['doce', '12'], ['trece', '13'], ['quince', '15'], ['dieciséis', '16'], ['veinte', '20'], ['veinticuatro', '24'],
  ['treinta y dos', '32'], ['cuarenta', '40'], ['cien', '100'], ['doscientos', '200'], ['veinte y medio', '20.5'],
];
const UNITS = Array.from(SPANISH_UNIT_TOKENS);
const NAMES = ['cerveza', 'jugo de naranja'];

describe('a count above diez before a Spanish unit word == digit twin', () => {
  const cases: Array<[string, string]> = [];
  for (const [w, d] of COUNTS) for (const u of UNITS) for (const n of NAMES) cases.push([`${w} ${u} de ${n}`, `${d} ${u} de ${n}`]);
  test.each(cases)('%s == %s', (word, twin) => {
    expect(core(word)).toEqual(core(twin));
  });

  test.each<[string, number, string]>([
    ['doce onzas de cerveza', 12, 'oz'], ['veinte litros de agua', 20, 'l'], ['treinta y dos onzas de gatorade', 32, 'oz'],
    ['dieciséis onzas de bistec', 16, 'oz'], ['quince tazas de arroz', 15, 'cup'], ['once cucharadas de avena', 11, 'tbsp'],
    ['Doce Onzas de cerveza', 12, 'oz'],
  ])('%s reads %d %s', (line, qty, unit) => {
    expect(core(line)).toMatchObject({ qty, unit });
  });
});

describe('everything else is byte-identical to base (origin/master 470d7b68): qty 1, the whole line is the name', () => {
  test.each([
    'siete onzas de pollo', 'siete tazas de arroz', 'siete onzas de tequila siete leguas', 'siete leguas',
    'quince paste', 'once upon a farm', 'a quince', 'once', 'quince minutos', 'veinte platos de arroz', 'doce de leite',
    'treinta y dos', 'treinta y tres', 'veinte y medio', 'una 33',
  ])('%s unchanged', (line) => {
    expect(core(line)).toEqual({ qty: 1, multiplier: 1, unit: null, rawUnit: null, name: line, unitHint: null, qualifiers: null });
  });

  test('noun-led counts keep their s457 P4 reading', () => {
    expect(core('doce huevos')).toMatchObject({ qty: 12, unit: null, name: 'huevos' });
    expect(core('veinte tortillas')).toMatchObject({ qty: 20, unit: null, name: 'tortillas' });
  });
});
