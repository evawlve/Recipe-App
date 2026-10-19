/**
 * A spoken multiplier on a portion: rewriteDoublePortion() in ingredient-line.ts.
 *
 * "a double portion of mashed potatoes" parsed as qty 1, no unit, name "a double
 * portion of mashed potatoes" and billed ONE portion. Each target must now parse
 * EXACTLY (deep-equal, whole ParsedIngredient) as its numeric twin "2 servings of ...".
 * The controls pin master's output, read off master before the edit: every
 * product-sense "double"/"triple" and every near-miss shape stays untouched.
 */

import { parseIngredientLine } from '../ingredient-line';

const TARGETS: Array<[string, string]> = [
  ['a double portion of mashed potatoes', '2 servings of mashed potatoes'],
  ['a double serving of rice', '2 servings of rice'],
  ['a triple helping of mac and cheese', '3 servings of mac and cheese'],
  ['about a double portion of rice', 'about 2 servings of rice'],
  ['A double portion of mashed potatoes', '2 servings of mashed potatoes'],
  ['A double portion of rice', '2 servings of rice'],
  ['one double serving of rice', '2 servings of rice'],
];

describe('double/triple portion rewrite', () => {
  it.each(TARGETS)('%s parses exactly as %s', (line, twin) => {
    const t = parseIngredientLine(twin);
    expect(t).not.toBeNull();
    expect(t!.qty).toBeGreaterThan(1);
    expect(parseIngredientLine(line)).toEqual(t);
  });

  it('the hedged line also equals the un-hedged twin', () => {
    expect(parseIngredientLine('about a double portion of rice')).toEqual(
      parseIngredientLine('2 servings of rice'),
    );
  });
});

const CONTROLS: Array<[string, unknown]> = [
  ["a double cheeseburger", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a double cheeseburger", "notes": null, "unitHint": null}],
  ["a double espresso", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a double espresso", "notes": null, "unitHint": null}],
  ["a double vodka soda", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a double vodka soda", "notes": null, "unitHint": null}],
  ["a double bacon cheeseburger", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a double bacon cheeseburger", "notes": null, "unitHint": null}],
  ["double chocolate muffin", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "double chocolate muffin", "notes": null, "unitHint": null}],
  ["double portion", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "double portion", "notes": null, "unitHint": null}],
  ["a portion of fries", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a portion of fries", "notes": null, "unitHint": null}],
  ["a double", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a double", "notes": null, "unitHint": null}],
  ["two double cheeseburgers", {"qty": 2, "multiplier": 1, "unit": null, "rawUnit": null, "name": "double cheeseburgers", "notes": null, "unitHint": null}],
  ["a double shot of espresso", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a double shot of espresso", "notes": null, "unitHint": null}],
  ["a double order of fries", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a double order of fries", "notes": null, "unitHint": null}],
  ["a double portion of", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a double portion of", "notes": null, "unitHint": null}],
  ["a double shot latte", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a double shot latte", "notes": null, "unitHint": null}],
  ["in-n-out double double with half an order of fries", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "in-n-out double double with half an order of fries", "notes": null, "unitHint": null}],
];

describe('double/triple portion rewrite: controls keep master output', () => {
  it.each(CONTROLS)('%s', (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
  });
});
