/**
 * dish-part-drop - S240 rowAmt (MGR 18:44Z, Option A's letter). In a homemade dish a part WITH an amount
 * (`2 eggs`, `a quarter cup of cheese`) is part of the dish and is not billed; a determiner-led NEW food after
 * the parts still bills. Every case of the amount fixture (fixtures/dish-part-amount.json, a copy of
 * snapshots/s240/rowAmt/fixture-amount.json: 106 cases, 32 of them `changed: true`) runs through the shipped function.
 *
 * The same row re-pinned 4 cases of fixtures/dish-part-drop-r5.json (MGR 18:44Z); those lines are exercised by
 * dish-part-drop.test.ts via that fixture.
 */

import { dropDishParts } from '../dish-part-drop';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/dish-part-amount.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expectRawTexts: string[];
  changed?: boolean;
}
const CASES = fixture as Case[];

describe('dropDishParts - amount fixture', () => {
  test('the fixture is the cut it claims to be: 106 cases, 32 changed', () => {
    expect(CASES).toHaveLength(106);
    expect(CASES.filter(c => c.changed === true)).toHaveLength(32);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = dropDishParts(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
  });

  test('never mutates its input', () => {
    for (const c of CASES) {
      const snapshot = JSON.parse(JSON.stringify(c.input));
      dropDishParts(canonicalizeSegLine(c.line), c.input);
      expect(c.input).toEqual(snapshot);
    }
  });
});
