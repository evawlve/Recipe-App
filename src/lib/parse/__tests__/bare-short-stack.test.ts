import { parseIngredientLine } from '../ingredient-line';

const CONTROLS: Record<string, unknown> = {
  "a stack": {
    "qty": 1,
    "multiplier": 1,
    "unit": null,
    "rawUnit": null,
    "name": "a stack",
    "notes": null,
    "unitHint": null
  },
  "a short stack of waffles": {
    "qty": 1,
    "multiplier": 1,
    "unit": null,
    "rawUnit": null,
    "name": "a stack of waffles",
    "notes": null,
    "qualifiers": [
      "short"
    ],
    "unitHint": null
  },
  "ihop short stack": {
    "qty": 1,
    "multiplier": 1,
    "unit": null,
    "rawUnit": null,
    "name": "ihop short stack",
    "notes": null,
    "unitHint": null
  },
  "a short stack at ihop": {
    "qty": 1,
    "multiplier": 1,
    "unit": null,
    "rawUnit": null,
    "name": "a short stack at ihop",
    "notes": null,
    "unitHint": null
  },
  "short stack": {
    "qty": 1,
    "multiplier": 1,
    "unit": null,
    "rawUnit": null,
    "name": "stack",
    "notes": null,
    "qualifiers": [
      "short"
    ],
    "unitHint": null
  }
};

test('G10 stack: a bare `a short stack` keeps its identity', () => {
  expect(parseIngredientLine('a short stack')!.name).not.toBe('a stack');
});

test('a bare sized stack is the diner idiom for pancakes (#549 defaults: short 3, full / tall 5)', () => {
  for (const [line, twin] of [
    ['a short stack', '3 pancakes'],
    ['a full stack', '5 pancakes'],
    ['a tall stack', '5 pancakes'],
    ['one short stack', '3 pancakes'],
    ['A short stack', '3 pancakes'],
    ['about a short stack', 'about 3 pancakes'],
  ]) {
    expect(parseIngredientLine(line)).toEqual(parseIngredientLine(twin));
  }
});

test('controls: shapes that are not a bare sized stack parse exactly as on master', () => {
  for (const [line, expected] of Object.entries(CONTROLS)) {
    expect([line, parseIngredientLine(line)]).toEqual([line, expected]);
  }
  expect(parseIngredientLine('a short stack of pancakes')).toEqual(parseIngredientLine('3 pancakes'));
});
