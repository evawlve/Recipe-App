/**
 * self-correction trailing-and - S240 cloud-36 C3. An `and` in the gap right before the last item keeps the earlier
 * reading in the trailing block (`a beef taco, and 2 chicken tacos, sorry`). Every case of the fixture
 * (fixtures/self-correction-trailing-and.json, a copy of snapshots/s240/rowC3/fixture.json: 41 cases, 8 changed)
 * runs through the shipped function.
 */

import { resolveSelfCorrections } from '../self-correction';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/self-correction-trailing-and.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expectRawTexts: string[];
  expectKinds: string[];
  changed: boolean;
}
const CASES = fixture as Case[];

describe('resolveSelfCorrections - trailing-and fixture', () => {
  test('the fixture is the cut it claims to be: 41 cases, 8 changed', () => {
    expect(CASES).toHaveLength(41);
    expect(CASES.filter(c => c.changed)).toHaveLength(8);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const out = resolveSelfCorrections(canonicalizeSegLine(c.line), c.input);
    expect(out.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
    expect(out.corrections.map(x => x.kind)).toEqual(c.expectKinds);
  });

  test('never mutates its input', () => {
    for (const c of CASES) {
      const snapshot = JSON.parse(JSON.stringify(c.input));
      resolveSelfCorrections(canonicalizeSegLine(c.line), c.input);
      expect(c.input).toEqual(snapshot);
    }
  });
});
