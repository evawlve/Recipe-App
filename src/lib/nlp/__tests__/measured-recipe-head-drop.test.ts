/**
 * s453 C3P - a measured recipe bills its ingredients, not the dish. POS cases drop item 0; NEG cases and
 * every case of the six dish-part fixtures (the GUARD, 544 cases) drop nothing.
 */
import { dropMeasuredRecipeHead } from '../measured-recipe-head-drop';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/measured-recipe-head.json';
import amount from './fixtures/dish-part-amount.json';
import r5 from './fixtures/dish-part-drop-r5.json';
import gap from './fixtures/dish-part-gap-word.json';
import madeWith from './fixtures/dish-part-made-with.json';
import meal from './fixtures/dish-part-meal-frame.json';
import prov from './fixtures/dish-part-provenance.json';

describe('dropMeasuredRecipeHead', () => {
  test.each(fixture.map(c => [c.src, c] as const))('%s', (_n, c) => {
    const r = dropMeasuredRecipeHead(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
    expect(r.drops.length).toBe(c.changed ? 1 : 0);
    if (c.changed) expect(r.drops[0]).toEqual({ index: 0, rawText: c.input[0].rawText });
  });

  test('never mutates its input', () => {
    for (const c of fixture) {
      const before = JSON.stringify(c.input);
      dropMeasuredRecipeHead(canonicalizeSegLine(c.line), c.input);
      expect(JSON.stringify(c.input)).toBe(before);
    }
  });

  test('GUARD: no case of the six dish-part fixtures drops (544 cases)', () => {
    const all = [...amount, ...r5, ...gap, ...madeWith, ...meal, ...prov] as Array<{
      line: string;
      input: Array<{ rawText: string; normalizedForm?: string; brand?: string }>;
    }>;
    expect(all).toHaveLength(544);
    for (const c of all) {
      expect(dropMeasuredRecipeHead(canonicalizeSegLine(c.line), c.input).drops).toHaveLength(0);
    }
  });
});
