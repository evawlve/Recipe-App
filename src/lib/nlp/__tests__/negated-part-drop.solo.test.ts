/**
 * stripSoloRemoval - S240 (MGR 17:30Z relay 3). Every case of fixtures/negated-solo.json (a byte copy of
 * snapshots/s240/rowSolo/fixture-solo.json): expectHead null = the line stays as typed.
 */

import fixture from './fixtures/negated-solo.json';
import { stripSoloRemoval } from '../negated-part-drop';

type Case = { src: string; line: string; expectHead: string | null };
const cases = fixture.cases as Case[];

describe('stripSoloRemoval - fixture', () => {
  test('shape: 84 cases, 46 with a head', () => {
    expect(cases).toHaveLength(84);
    expect(cases.filter(c => c.expectHead !== null)).toHaveLength(46);
  });

  test.each(cases.map(c => [`${c.src}: ${c.line}`, c] as [string, Case]))('%s', (_name, c) => {
    expect(stripSoloRemoval(c.line)?.head ?? null).toEqual(c.expectHead);
  });

  test('known false positive: chili without beans bills plain chili', () => {
    expect(stripSoloRemoval('chili without beans')?.head).toBe('chili');
  });
});
