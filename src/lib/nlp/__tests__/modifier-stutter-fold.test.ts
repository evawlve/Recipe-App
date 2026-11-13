/**
 * s455 DS1 - a dictated "sugar sugar-free X" bills the sugar-free X. POS cases fold the pair; NEG cases change nothing.
 */
import { foldModifierStutter } from '../modifier-stutter-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/modifier-stutter.json';

describe('foldModifierStutter', () => {
  test.each(fixture.map(c => [c.src, c] as const))('%s', (_n, c) => {
    const r = foldModifierStutter(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
    expect(r.folds.length).toBe(c.changed ? 1 : 0);
    if (c.changed) expect(r.folds[0]).toEqual({ index: 3, rawText: c.input[3].rawText });
    if (!c.changed) expect(r.items).toBe(c.input);
  });

  test('never mutates its input', () => {
    for (const c of fixture) {
      const before = JSON.stringify(c.input);
      foldModifierStutter(canonicalizeSegLine(c.line), c.input);
      expect(JSON.stringify(c.input)).toBe(before);
    }
  });

  test('the merged item keeps every other field of the second item', () => {
    const c = fixture[0];
    const r = foldModifierStutter(canonicalizeSegLine(c.line), c.input);
    expect(r.items[3]).toEqual({ ...c.input[4], rawText: '1 tablespoon of sugar-free maple syrup' });
  });
});
