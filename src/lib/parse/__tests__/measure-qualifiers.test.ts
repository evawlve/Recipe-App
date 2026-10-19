/**
 * C70 row (viii)-A: an approximator or filler adjective before a measure never changes the measure.
 * Targets assert (qty, unit, name) EQUAL to the plain twin (never the whole object: rawUnit/notes are spelling-sensitive).
 * Controls are deep-equal to their master (96988d19) output, hard-coded.
 */

import { parseIngredientLine } from '../ingredient-line';

const triple = (line: string) => {
  const r = parseIngredientLine(line);
  expect(r).not.toBeNull();
  return { qty: r!.qty, unit: r!.unit, name: r!.name };
};

describe('a qualifier that never changes the measure is dropped', () => {
  test.each<[string, string]>([
  [
    'just over a pound of shrimp',
    'a pound of shrimp'
  ],
  [
    'just under 100 g of shredded chicken',
    '100 g of shredded chicken'
  ],
  [
    'a bit over 2 cups of popcorn',
    '2 cups of popcorn'
  ],
  [
    'a little under a cup of rice',
    'a cup of rice'
  ],
  [
    'at least 2 cups of spinach',
    '2 cups of spinach'
  ],
  [
    'over a pound of grapes',
    'a pound of grapes'
  ],
  [
    'a good pound of pasta',
    'a pound of pasta'
  ],
  [
    'a full cup of milk',
    'a cup of milk'
  ],
  [
    'a generous cup of yogurt',
    'a cup of yogurt'
  ],
  [
    'about a good pound of pasta',
    'a pound of pasta'
  ],
  [
    'Just over a pound of shrimp',
    'a pound of shrimp'
  ]
])('%s parses like %s', (line, twin) => {
    expect(triple(line)).toEqual(triple(twin));
  });

  test('a plain twin really carries a unit', () => {
    expect(triple('a pound of shrimp')).toEqual({ qty: 1, unit: 'lb', name: 'shrimp' });
  });
});

describe('lines that must not change (master output, hard-coded)', () => {
  test.each<[string, object]>([
    ['over easy eggs', {qty:1,multiplier:1,unit:null,rawUnit:null,name:'over easy eggs',notes:null,unitHint:null}],
    ['under 100 calorie bar', {qty:1,multiplier:1,unit:null,rawUnit:null,name:'under 100 calorie bar',notes:null,unitHint:null}],
    ['at least 85 percent dark chocolate', {qty:1,multiplier:1,unit:null,rawUnit:null,name:'at least 85 percent dark chocolate',notes:null,unitHint:null}],
    ['a good bit of cheese', {qty:1,multiplier:1,unit:null,rawUnit:null,name:'a good bit of cheese',notes:null,unitHint:null}],
    ['a full english', {qty:1,multiplier:1,unit:null,rawUnit:null,name:'a full english',notes:null,unitHint:null}],
    ['a generous helping of pasta', {qty:1,multiplier:1,unit:null,rawUnit:null,name:'a generous helping of pasta',notes:null,unitHint:null}],
    ['about a dozen eggs', {qty:12,multiplier:1,unit:'egg',rawUnit:'eggs',name:'eggs',notes:null,unitHint:null}],
    ['like a pound cake', {qty:1,multiplier:1,unit:null,rawUnit:null,name:'like a pound cake',notes:null,unitHint:null}],
    ['a heaping tablespoon of peanut butter', {qty:1,multiplier:1,unit:null,rawUnit:null,name:'a tablespoon of peanut butter',notes:null,qualifiers:['heaping'],unitHint:null}],
    ['roughly a pound of strawberries', {qty:1,multiplier:1,unit:'lb',rawUnit:'pound',name:'strawberries',notes:null,unitHint:null}],
    ['just a cup of coffee', {qty:1,multiplier:1,unit:null,rawUnit:null,name:'just a cup of coffee',notes:null,unitHint:null}],
    ['just bare chicken nuggets', {qty:1,multiplier:1,unit:null,rawUnit:null,name:'just bare chicken nuggets',notes:null,unitHint:null}],
    ['just egg plant-based scramble', {qty:1,multiplier:1,unit:null,rawUnit:null,name:'just egg plant-based scramble',notes:null,unitHint:null}],
    ['overnight oats', {qty:1,multiplier:1,unit:null,rawUnit:null,name:'overnight oats',notes:null,unitHint:null}],
    ['underwood deviled ham', {qty:1,multiplier:1,unit:null,rawUnit:null,name:'underwood deviled ham',notes:null,unitHint:null}],
  ])('%s', (line, want) => {
    expect(parseIngredientLine(line)).toEqual(want);
  });
});
