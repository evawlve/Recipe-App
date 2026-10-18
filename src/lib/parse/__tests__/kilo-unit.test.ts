/**
 * S202 (route 37): `kilo` is a unit. `a kilo of strawberries`, `half a kilo`, `2 kilos of rice`
 * and `2 x 1 kilo bags of rice` lose the kilogram without the alias. Expectations are seat-measured.
 */

import { parseIngredientLine } from '../ingredient-line';
import { normalizeUnitToken } from '../unit';

type Want = { qty?: number; multiplier?: number; unit?: string | null; name?: string };

function check(line: string, want: Want) {
  const r = parseIngredientLine(line);
  expect(r).not.toBeNull();
  for (const k of Object.keys(want) as (keyof Want)[]) {
    expect((r as any)[k]).toEqual(want[k]);
  }
}

describe('normalizeUnitToken: kilo spellings are kg', () => {
  test.each(['kilo', 'kilos', 'kgs', 'kilogramo', 'kilogramos'])('%s', (t) => {
    expect(normalizeUnitToken(t)).toEqual({ kind: 'mass', unit: 'kg' });
  });
});

describe('kilo lines keep the kilogram', () => {
  test.each<[string, Want]>([
    ['a kilo of strawberries', { qty: 1, unit: 'kg', name: 'strawberries' }],
    ['half a kilo of strawberries', { qty: 0.5, unit: 'kg', name: 'strawberries' }],
    ['2 kilos of rice', { qty: 2, unit: 'kg', name: 'rice' }],
    ['2 x 1 kilo bags of rice', { qty: 2, multiplier: 1, unit: 'kg', name: 'rice' }],
    ['1 kilo-ish of chicken', { qty: 1, unit: 'kg', name: 'chicken' }],
    ['1 kilo. of rice', { qty: 1, unit: 'kg', name: 'rice' }],
  ])('%s', check);
});

describe('unchanged controls', () => {
  test.each<[string, Want]>([
    ['kilo coffee', { unit: null, name: 'kilo coffee' }],
    ['1 kg of rice', { qty: 1, unit: 'kg', name: 'rice' }],
    ['kilocalories', { unit: null }],
  ])('%s', check);
});
