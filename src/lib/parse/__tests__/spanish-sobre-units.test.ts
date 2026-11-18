/**
 * s462 ES-SOBRE: `sobre(s)` (the packet) is a Spanish unit word (SPANISH_UNIT_TOKENS in unit.ts) and the COUNT unit `packet`, so the
 * set's parse consumers (the article `un/una` = 1, `dos..diez`, the dropped `de`) read it as they read `lata`: `un sobre de avena` is
 * 1 packet of `avena`, exactly as its twin `1 packet avena`, and the packet seats bill it (#711 dose, #717 food cap).
 *
 * MEASURED (s462 pd-sobre, live deploy 49 `h4EUm_rlJ0KcVxGnEkZTi`, cold nosave probes): `un sobre de avena` 156 g / 607 kcal,
 * `un sobre de catsup` 100 g / 112 kcal, `un sobre de splenda` 100 g, because `sobre` was no unit and the whole line was the name.
 * `sobre` is also the preposition `on`: mid-line it is never a unit slot, so the dish lines below stay byte-identical.
 * KNOWN COST: `2 sobres de café` reads `café`, which ES-BARE-STAPLE rewrites to `coffee`: brewed coffee, as `2 packets of coffee`.
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
  test('sobre (both numbers) is a Spanish unit word and the count unit packet', () => {
    for (const t of ['sobre', 'sobres']) {
      expect(SPANISH_UNIT_TOKENS.has(t)).toBe(true);
      expect(normalizeUnitToken(t)).toEqual({ kind: 'count', unit: 'packet' });
    }
  });
});

describe('the measured members equal their twins (qty, unit, name)', () => {
  test.each<[string, string, number, string]>([
    ['un sobre de azúcar', '1 packet azúcar', 1, 'azúcar'],
    ['sobre de azúcar', '1 packet azúcar', 1, 'azúcar'],
    ['dos sobres de azúcar', '2 packets azúcar', 2, 'azúcar'],
    ['2 sobres de café', '2 packets café', 2, 'café'],
    ['un sobre de avena', '1 packet avena', 1, 'avena'],
    ['un sobre de mayonesa', '1 packet mayonesa', 1, 'mayonesa'],
    ['un sobre de catsup', '1 packet catsup', 1, 'catsup'],
    ['1 sobre de chocolate en polvo', '1 packet chocolate en polvo', 1, 'chocolate en polvo'],
    ['2 sobres de chocolate', '2 packets chocolate', 2, 'chocolate'],
    ['un sobre de café instantáneo', '1 packet café instantáneo', 1, 'café instantáneo'],
    ['un sobre de gelatina', '1 packet gelatina', 1, 'gelatina'],
  ])('%s == %s', (line, twin, q, name) => {
    expect(core(line)).toEqual(core(twin));
    expect(core(line)).toMatchObject({ qty: q, multiplier: 1, unit: 'packet', name });
  });
});

describe('isSpanishLine: a sobre line is Spanish, English packet lines stay English', () => {
  test.each<[string, boolean]>([
    ['un sobre de azúcar', true],
    ['2 sobres de café', true],
    ['1 packet of sugar', false],
    ['2 packets of coffee', false],
  ])('%s -> %s', (line, es) => {
    expect(isSpanishLine(line)).toBe(es);
  });
});

// Byte-identical to master 470d7b68 (parseIngredientLine() output pinned): `sobre` the preposition, and English packet lines.
describe('CONTROLS: sobre mid-line (the preposition) and English packet lines are unchanged', () => {
  test.each<[string, unknown]>([
    ["huevos sobre pan tostado", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"huevos sobre pan tostado","notes":null,"unitHint":null}],
    ["pollo sobre arroz", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"pollo sobre arroz","notes":null,"unitHint":null}],
    ["salmón sobre ensalada", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"salmón sobre ensalada","notes":null,"unitHint":null}],
    ["hojuelitas sobre vainilla", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"hojuelitas sobre vainilla","notes":null,"unitHint":null}],
    ["1 packet of sugar", {"qty":1,"multiplier":1,"unit":"packet","rawUnit":"packet","name":"sugar","notes":null,"unitHint":null}],
    ["2 packets of coffee", {"qty":2,"multiplier":1,"unit":"packet","rawUnit":"packets","name":"coffee","notes":null,"unitHint":null}],
    ["1 packet of oatmeal", {"qty":1,"multiplier":1,"unit":"packet","rawUnit":"packet","name":"oatmeal","notes":null,"unitHint":null}],
  ])('%s', (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
  });
});
