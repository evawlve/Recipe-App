/**
 * pour-onto-heuristic - C70 S239 C1 (cloud-36): the heuristic fallback (forceSegmentText) leaves a pour onto a second
 * food in ONE item; restoreLeadingPour() now cuts it. Every case drives the route's own heuristic sequence.
 */

import { restoreLeadingPour } from '../loose-measures';
import { parseIngredientLine } from '../ingredient-line';
import { forceSegmentText } from '@/lib/nlp/heuristic-segmenter';
import { canonicalizeSegLine } from '@/lib/nlp/seg-line-key';
import { capSegmentedItems, MAX_SEGMENTED_ITEMS } from '@/lib/nlp/parse-bounds';

const H = (L: string) => {
  const items = capSegmentedItems(forceSegmentText(L)).items;
  return { input: items, ...restoreLeadingPour(canonicalizeSegLine(L), items) };
};
const raws = (L: string) => H(L).items.map(i => i.rawText);
const llm = (rawText: string, normalizedForm: string) => ({ rawText, mealType: 'snacks', brand: '', normalizedForm });

describe('twins: the split deep-equals the heuristic split of the comma form', () => {
  test.each([
    ['a splash of syrup on pancakes', 'a splash of syrup, pancakes'],
    ['a drizzle of honey on toast', 'a drizzle of honey, toast'],
    ['a dollop of sour cream on chili', 'a dollop of sour cream, chili'],
    ['a splash of syrup on pancakes and a coffee', 'a splash of syrup, pancakes, a coffee'],
  ])('%s', (line, twin) => {
    expect(H(line).items).toEqual(H(twin).items);
    expect(H(line).restored).toBeGreaterThan(0);
  });

  test.each([['a splash of syrup on pancakes'], ['a drizzle of honey on toast'], ['a dollop of sour cream on chili']])(
    'emitted rawTexts parse as the standalone lines: %s',
    line => {
      const [a, b] = H(line).items.map(i => i.rawText);
      const [pour, food] = line.split(/ on /);
      expect(parseIngredientLine(a)).toEqual(parseIngredientLine(pour));
      expect(parseIngredientLine(b)).toEqual(parseIngredientLine(food));
    },
  );
});

describe('heuristic variants', () => {
  test('had ...', () => expect(raws('had a splash of syrup on pancakes')).toEqual(['a splash of syrup', 'pancakes']));
  test('for breakfast keeps mealType on both items', () => {
    const r = H('a splash of syrup on pancakes for breakfast');
    expect(r.items.map(i => i.rawText)).toEqual(['a splash of syrup', 'pancakes']);
    expect(r.items.map(i => (i as unknown as { mealType: string }).mealType)).toEqual(['breakfast', 'breakfast']);
  });
  test('pour inside a longer line', () =>
    expect(raws('toast, a drizzle of honey on yogurt')).toEqual(['toast', 'a drizzle of honey', 'yogurt']));
  test('atomic and-phrase tail kept whole', () =>
    expect(raws('a drizzle of honey on peaches and cream')).toEqual(['a drizzle of honey', 'peaches and cream']));
  test('in-vehicle', () => expect(raws('a splash of milk in coffee')).toEqual(['a splash of milk', 'coffee']));
});

describe('shapes', () => {
  test('capitals', () => expect(raws('A Splash of Syrup on Pancakes.')).toEqual(['a splash of syrup', 'Pancakes']));
  test('two prepositions: cut at the first, tail kept whole', () =>
    expect(raws('a drizzle of honey on toast in the morning')).toEqual(['a drizzle of honey', 'toast in the morning']));
  test('in n out fries', () =>
    expect(raws('a dash of hot sauce on in n out fries')).toEqual(['a dash of hot sauce', 'in n out fries']));
  test('multi-pour', () =>
    expect(raws('a splash of milk in coffee and a drizzle of honey on toast')).toHaveLength(4));
  test('comma form', () => expect(raws('two eggs, a splash of milk in coffee, toast')).toHaveLength(4));
});

describe('unchanged: same reference, restored 0', () => {
  test.each([
    ['a splash of syrup on my'],
    ['a splash of jack in the box sauce on fries'],
    ['coffee with a splash of milk in it'],
    ['syrup on pancakes'],
    ['a splash of milk'],
    ['peanut butter on toast'],
    ['a drizzle of olive oil'],
    ['chicken on a stick'],
    ['ants on a log'],
    ['pigs in a blanket'],
    ['a sip of wine on vacation'],
    ['a pinch of salt in the pot'],
    ['a dollop of whipped cream on top'],
    ['a splash of milk in my mug'],
  ])('%s', line => {
    const r = H(line);
    expect(r.items).toBe(r.input);
    expect(r.restored).toBe(0);
  });
});

describe('KNOWN MISSES (the second food still vanishes on the fallback; pinned so a fix flips them on purpose)', () => {
  test.each([
    ['a drizzle of honey on a bagel'],
    ['a smear of cream cheese on a bagel'],
    ['a splash of milk on total'],
  ])('unchanged: %s', line => {
    const r = H(line);
    expect(r.items).toBe(r.input);
    expect(r.restored).toBe(0);
  });
  test('chipotle in adobo is cut at the product name', () =>
    expect(raws('a spoonful of chipotle in adobo on tacos')).toEqual(['a spoonful of chipotle', 'adobo on tacos']));
});

describe('ACCEPTED PHANTOM (fallback only)', () => {
  test('a swig of beer in vegas -> a vegas item', () =>
    expect(raws('a swig of beer in vegas')).toEqual(['a swig of beer', 'vegas']));
});

describe('LLM items', () => {
  const line = 'a splash of syrup on pancakes';
  test('one-item echo WITH a normalizedForm is untouched (R2)', () => {
    const items = [llm(line, 'syrup on pancakes')];
    const r = restoreLeadingPour(canonicalizeSegLine(line), items);
    expect(r.items).toBe(items);
    expect(r.restored).toBe(0);
  });
  test('one-item echo with an EMPTY normalizedForm is split (contract made visible)', () => {
    const r = restoreLeadingPour(canonicalizeSegLine(line), [llm(line, '')]);
    expect(r.items.map(i => i.rawText)).toEqual(['a splash of syrup', 'pancakes']);
    expect(r.restored).toBe(1);
  });
  test('>=2 LLM split with normalizedForm on every item keeps its items', () => {
    const items = [llm('a splash of syrup', 'syrup'), llm('pancakes', 'pancakes'), llm('a coffee', 'coffee')];
    const r = restoreLeadingPour(canonicalizeSegLine(line + ' and a coffee'), items);
    expect(r.items.map(i => i.rawText)).toEqual(['a splash of syrup', 'pancakes', 'a coffee']);
  });
});

describe('producer contract and cap', () => {
  test('forceSegmentText emits an empty normalizedForm', () => {
    for (const L of ['a splash of syrup on pancakes', 'a drizzle of honey on toast', 'a dollop of sour cream on chili']) {
      expect(forceSegmentText(L).every(i => i.normalizedForm === '')).toBe(true);
    }
  });
  test('13 comma pour-onto clauses stay within MAX_SEGMENTED_ITEMS', () => {
    const L = Array.from({ length: 13 }, () => 'a splash of milk in coffee').join(', ');
    expect(H(L).items.length).toBeLessThanOrEqual(MAX_SEGMENTED_ITEMS);
  });
  test('the cap bites when expansion exceeds it', () => {
    const items = Array.from({ length: 20 }, () => llm('a splash of milk in coffee', ''));
    const r = restoreLeadingPour('a splash of milk in coffee', items);
    expect(r.items).toHaveLength(MAX_SEGMENTED_ITEMS);
  });
});
