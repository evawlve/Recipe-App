/**
 * Stock-consumed fold (S240, MGR reserve R1+R3): a consumed fraction or count after a STOCK item bills what was eaten.
 * Table-driven over fixtures/stock-consumed.json (a copy of snapshots/s240/rowR1/fixture-stock.json: 252 cases, 70 stock).
 */

import { foldTrailingQuantityClauses, parseClause } from '../trailing-quantity-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/stock-consumed.json';

interface Case {
  src: string;
  line: string;
  input: { rawText: string; normalizedForm?: string; brand?: string }[];
  expectRawTexts: string[];
  expectKinds: string[];
}
const CASES = fixture as Case[];

describe('stock-consumed fixture', () => {
  test('fixture shape: 252 cases, 70 stock', () => {
    expect(CASES).toHaveLength(252);
    expect(CASES.filter(c => c.expectKinds.includes('stock'))).toHaveLength(70);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const before = JSON.stringify(c.input);
    const out = foldTrailingQuantityClauses(canonicalizeSegLine(c.line), c.input);
    expect(out.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
    expect(out.folds.map(f => f.kind)).toEqual(c.expectKinds);
    expect(JSON.stringify(c.input)).toBe(before);
  });
});

describe('parseClause() fractions opt-in', () => {
  test('a quarter without the opt-in -> null', () => {
    expect(parseClause(['a', 'quarter'])).toBeNull();
  });
  test('a quarter with fractions -> 0.25', () => {
    expect(parseClause(['a', 'quarter'], { fractions: true })).toEqual({
      value: 0.25,
      unit: null,
      food: [],
      fractionWord: 'quarter',
    });
  });
  test('a quarter pounder with fractions -> null', () => {
    expect(parseClause(['a', 'quarter', 'pounder'], { fractions: true })).toBeNull();
  });
  test('input tokens are never mutated', () => {
    const t = ['a', 'quarter'];
    parseClause(t, { fractions: true });
    expect(t).toEqual(['a', 'quarter']);
  });
});
