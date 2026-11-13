/**
 * "a stack of pancakes": rewriteStackOfPancakes() in ingredient-line.ts.
 *
 * The line parsed as qty 1, name "a stack of pancakes" and billed ONE pancake (30 g)
 * while "3 pancakes" bills 114 g. Each target must now parse EXACTLY (deep-equal,
 * whole ParsedIngredient) as its numeric twin. Defaults: stack = short stack = 3,
 * full stack = tall stack = 5 (a bare stack = 3 is a convention; IHOP's full stack is 5).
 * The controls pin master's output, read off master before the edit.
 */

import { parseIngredientLine } from '../ingredient-line';

const TARGETS: Array<[string, string]> = [
  ['a stack of pancakes', '3 pancakes'],
  ['a short stack of pancakes', '3 pancakes'],
  ['a full stack of pancakes', '5 pancakes'],
  ['a tall stack of pancakes', '5 pancakes'],
  ['a stack of buttermilk pancakes', '3 buttermilk pancakes'],
  ['about a stack of pancakes', 'about 3 pancakes'],
  ['A stack of pancakes', '3 pancakes'],
];

const CONTROLS: Array<[string, unknown]> = [
  ["a stack of waffles", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a stack of waffles", "notes": null, "unitHint": null}],
  ["a stack of flapjacks", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a stack of flapjacks", "notes": null, "unitHint": null}],
  ["a stack of hotcakes", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a stack of hotcakes", "notes": null, "unitHint": null}],
  ["a stack of pancakes with syrup", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a stack of pancakes with syrup", "notes": null, "unitHint": null}],
  ["a stack of papers", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a stack of papers", "notes": null, "unitHint": null}],
  ["stacked pancakes", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "stacked pancakes", "notes": null, "unitHint": null}],
  ["a stack burger", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a stack burger", "notes": null, "unitHint": null}],
  ["ihop short stack", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "ihop short stack", "notes": null, "unitHint": null}],
  ["a short stack at ihop", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a short stack at ihop", "notes": null, "unitHint": null}],
  ["a big stack of pancakes", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a big stack of pancakes", "notes": null, "unitHint": null}],
  ["a stack of", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a stack of", "notes": null, "unitHint": null}],
];

describe('stack of pancakes rewrite', () => {
  it.each(TARGETS)('%s parses exactly as %s', (line, twin) => {
    const t = parseIngredientLine(twin);
    expect(t).not.toBeNull();
    expect(t!.qty).toBeGreaterThan(1);
    expect(parseIngredientLine(line)).toEqual(t);
  });

  it.each(CONTROLS)('%s is untouched (master output)', (line, master) => {
    expect(parseIngredientLine(line)).toEqual(master);
  });
});
