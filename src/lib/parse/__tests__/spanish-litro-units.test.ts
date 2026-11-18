/**
 * s461 ES-UNITSET-LITRO: `litro(s)` is a Spanish unit word (SPANISH_UNIT_TOKENS in unit.ts) and the volume unit `l`, so the set's
 * parse consumers (the article `un/una` = 1, `y medio`, the word fraction `tres cuartos de`, the dropped `de`) read it as they read
 * `taza`: `2 litros de leche` is 2 l of `leche`, exactly as its twin `2 liters leche`.
 *
 * MEASURED (s461 pd-litro, live deploy 46 `NkORX32uoG_AT0Zyxz_ba`, cold nosave probes, real line vs twin): `2 litros de leche`
 * 500 g vs 2,000 g; `dos litros de refresco` 240 g vs 2,000 g; `un litro de jugo de naranja` 248 g vs 1,000 g; `litro y medio de
 * agua` 237 g vs 1,500 g (water, 0 kcal in both). It was held out of s459 ES-UNITSET-KILO until #710 made bare `agua` water.
 * Controls pinned below: a bottle size inside the name (`una botella de 1 litro de agua`, `coca cola 2 litros`) stays in the name.
 */
import { parseIngredientLine } from '../ingredient-line';
import { SPANISH_UNIT_TOKENS, normalizeUnitToken } from '../unit';
import { isSpanishLine } from '../../mapping/spanish-detect';

const KEYS = ['qty', 'multiplier', 'unit', 'name', 'unitHint', 'qualifiers'] as const;
function core(line: string) {
  const r: any = parseIngredientLine(line);
  expect(r).not.toBeNull();
  return Object.fromEntries(KEYS.map((k) => [k, r[k] ?? null]));
}

describe('membership', () => {
  test('litro (both numbers) is a Spanish unit word and the volume unit l', () => {
    for (const t of ['litro', 'litros']) {
      expect(SPANISH_UNIT_TOKENS.has(t)).toBe(true);
      expect(normalizeUnitToken(t)).toEqual({ kind: 'volume', unit: 'l' });
    }
  });
});

describe('the measured members equal their twins (qty, unit, name)', () => {
  test.each<[string, string, number, string, string]>([
    ['un litro de agua', '1 l agua', 1, 'l', 'agua'],
    ['2 litros de agua', '2 l agua', 2, 'l', 'agua'],
    ['3 litros de agua', '3 l agua', 3, 'l', 'agua'],
    ['2 litros de leche', '2 liters leche', 2, 'l', 'leche'],
    ['1 litro de leche', '1 l leche', 1, 'l', 'leche'],
    ['1/2 litro de leche', '0.5 l leche', 0.5, 'l', 'leche'],
    ['medio litro de leche', '0.5 liters leche', 0.5, 'l', 'leche'],
    ['medio litro de coca cola', '0.5 l coca cola', 0.5, 'l', 'coca cola'],
    ['litro y medio de agua', '1.5 l agua', 1.5, 'l', 'agua'],
    ['un litro y medio de agua', '1.5 l agua', 1.5, 'l', 'agua'],
    ['1 litro y medio de agua', '1.5 l agua', 1.5, 'l', 'agua'],
    ['dos litros de refresco', '2 liters refresco', 2, 'l', 'refresco'],
    ['un litro de jugo de naranja', '1 liter jugo de naranja', 1, 'l', 'jugo de naranja'],
    ['un litro de cerveza', '1 liter cerveza', 1, 'l', 'cerveza'],
    ['un cuarto de litro de leche', '0.25 liters leche', 0.25, 'l', 'leche'],
    ['tres cuartos de litro de agua', '0.75 l agua', 0.75, 'l', 'agua'],
    ['2 litros de agua de jamaica', '2 l agua de jamaica', 2, 'l', 'agua de jamaica'],
  ])('%s == %s', (line, twin, q, unit, name) => {
    expect(core(line)).toEqual(core(twin));
    expect(core(line)).toMatchObject({ qty: q, multiplier: 1, unit, name });
  });
});

describe('isSpanishLine: English litre lines stay English', () => {
  test.each<[string, boolean]>([
    ['1 liter of water', false],
    ['a 2 liter of root beer', false],
    ['half a liter of milk', false],
    ['2 litros de leche', true],
  ])('%s -> %s', (line, es) => {
    expect(isSpanishLine(line)).toBe(es);
  });
});

// Byte-identical to master ea661972 (parseIngredientLine() output pinned).
describe('CONTROLS: a size inside the name, English litre lines, water and agua drinks are unchanged', () => {
  test.each<[string, unknown]>([
    ["una botella de 1 litro de agua", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"una botella de 1 litro de agua","notes":null,"unitHint":null}],
    ["una botella de 2 litros de coca cola", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"una botella de 2 litros de coca cola","notes":null,"unitHint":null}],
    ["coca cola 2 litros", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"coca cola 2 litros","notes":null,"unitHint":null}],
    ["coca cola de 2 litros", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"coca cola de 2 litros","notes":null,"unitHint":null}],
    ["refresco de litro", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"refresco de litro","notes":null,"unitHint":null}],
    ["litro de leche", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"litro de leche","notes":null,"unitHint":null}],
    ["1 liter of water", {"qty":1,"multiplier":1,"unit":"l","rawUnit":"liter","name":"water","notes":null,"unitHint":null}],
    ["a 2 liter of root beer", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a 2 liter of root beer","notes":null,"unitHint":null}],
    ["half a 2 liter of mountain dew", {"qty":0.5,"multiplier":1,"unit":null,"rawUnit":null,"name":"a 2 liter of mountain dew","notes":null,"unitHint":null}],
    ["a liter of chocolate milk", {"qty":1,"multiplier":1,"unit":"l","rawUnit":"liter","name":"chocolate milk","notes":null,"unitHint":null}],
    ["16 onzas de agua", {"qty":16,"multiplier":1,"unit":"oz","rawUnit":"onzas","name":"agua","notes":null,"unitHint":null}],
    ["agua de jamaica", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"agua de jamaica","notes":null,"unitHint":null}],
    ["un vaso de agua", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"un vaso de agua","notes":null,"unitHint":null}],
    ["huevos sobre pan tostado", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"huevos sobre pan tostado","notes":null,"unitHint":null}],
    ["pollo sobre arroz", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"pollo sobre arroz","notes":null,"unitHint":null}],
  ])('%s', (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
  });
});
