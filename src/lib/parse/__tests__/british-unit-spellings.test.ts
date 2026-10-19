/**
 * C70 S239: British unit spellings are units. `1 kilogramme of carrots` must parse like
 * `1 kilogram of carrots`. Known misses (not added, no alias): `dl`, `cl`, `ltr`.
 */

import { parseIngredientLine } from '../ingredient-line';
import { convertUnit, normalizeUnitToken } from '../unit';

function core(line: string) {
  const r = parseIngredientLine(line);
  expect(r).not.toBeNull();
  // qty, unit and name only: rawUnit differs by design.
  return { qty: r!.qty, unit: r!.unit, name: r!.name };
}

describe('normalizeUnitToken: British spellings', () => {
  test.each<[string, 'mass' | 'volume', string]>([
    ['gramme', 'mass', 'g'],
    ['grammes', 'mass', 'g'],
    ['kilogramme', 'mass', 'kg'],
    ['kilogrammes', 'mass', 'kg'],
    ['litre', 'volume', 'l'],
    ['litres', 'volume', 'l'],
    ['millilitre', 'volume', 'ml'],
    ['millilitres', 'volume', 'ml'],
  ])('%s', (t, kind, unit) => {
    expect(normalizeUnitToken(t)).toEqual({ kind, unit });
  });
});

describe('British lines equal their American twins', () => {
  test.each<[string, string]>([
    ['1 kilogramme of carrots', '1 kilogram of carrots'],
    ['500 grammes of flour', '500 grams of flour'],
    ['a litre of milk', 'a liter of milk'],
    ['250 millilitres of orange juice', '250 milliliters of orange juice'],
    ['2 litres of water', '2 liters of water'],
    ['about a litre of milk', 'a liter of milk'],
  ])('%s', (uk, us) => {
    expect(core(uk)).toEqual(core(us));
  });

  test('the unit really is the metric one', () => {
    expect(core('1 kilogramme of carrots')).toMatchObject({ qty: 1, unit: 'kg', name: 'carrots' });
    expect(core('250 millilitres of orange juice')).toMatchObject({ qty: 250, unit: 'ml' });
  });

  test('convertUnit knows litre', () => {
    expect(convertUnit(1, 'litre', 'ml')).toBe(1000);
  });
});

describe('unchanged controls', () => {
  test('programme is not a unit', () => {
    expect(normalizeUnitToken('programme').kind).not.toBe('mass');
    expect(normalizeUnitToken('programme').kind).not.toBe('volume');
  });
  test.each<[string, number, string]>([
    ['1 gram of salt', 1, 'g'],
    ['a liter of milk', 1, 'l'],
  ])('%s', (line, qty, unit) => {
    expect(core(line)).toMatchObject({ qty, unit });
  });
});
