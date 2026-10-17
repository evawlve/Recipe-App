/**
 * loose-measures - S202 row 5 (8(g)): a swig / gulp / sip / splash of X is a fl oz measure.
 * Pour rows: R = refuter/seat-measured expectation, S = seat-derived. Controls are compared with
 * the BASE parse recorded before the change (whole parse object).
 */

import { parseIngredientLine } from '../ingredient-line';
import { splitLeadingPour, resolveLoosePourMeasures, LOOSE_POUR_FLOZ } from '../loose-measures';

describe('pour words parse as floz', () => {
  test.each([
    ["a swig of soda", 1.5, "soda"], // R
    ["a gulp of orange juice", 1, "orange juice"], // R
    ["a splash of milk", 0.5, "milk"], // R
    ["a splash of oat milk", 0.5, "oat milk"], // R
    ["a splash of cream", 0.5, "cream"], // R
    ["a sip of wine", 0.5, "wine"], // R
    ["2 swigs of soda", 3, "soda"], // R
    ["two gulps of water", 2, "water"], // R
    ["A Splash of Milk", 0.5, "Milk"], // R
    ["a splash of 2% milk", 0.5, "2% milk"], // S
    ["a sip of 7up", 0.5, "7up"], // S
    ["1/2 splash of milk", 0.25, "milk"], // S
    ["1 1/2 swigs of soda", 2.25, "soda"], // S
    ["a splash of half and half", 0.5, "half and half"], // R
  ])('%s', (line, qty, name) => {
    const p = parseIngredientLine(line);
    expect(p).not.toBeNull();
    expect(p!.qty).toBe(qty);
    expect(p!.unit).toBe('floz');
    expect(p!.name).toBe(name);
  });
});

describe('controls are byte-identical to the base parse', () => {
  // The last three are known gaps (design r2 F5/F7): they stay on the base path.
  const BASE: Record<string, unknown> = {
    "a v8 splash": {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a v8 splash", "notes": null, "unitHint": null},
    "v8 splash": {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "v8 splash", "notes": null, "unitHint": null},
    "big gulp": {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "big gulp", "notes": null, "unitHint": null},
    "a big gulp": {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a big gulp", "notes": null, "unitHint": null},
    "splash of milk": {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "splash of milk", "notes": null, "unitHint": null},
    "a swig sugar cookie": {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a swig sugar cookie", "notes": null, "unitHint": null},
    "a splash": {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a splash", "notes": null, "unitHint": null},
    "a glass of milk": {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a glass of milk", "notes": null, "unitHint": null},
    "an ounce of cheese": {"qty": 1, "multiplier": 1, "unit": "oz", "rawUnit": "ounce", "name": "cheese", "notes": null, "unitHint": null},
    "had a swig of soda": {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "had a swig of soda", "notes": null, "unitHint": null},
    "half a splash of milk": {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a splash of milk", "notes": null, "unitHint": null},
    "one and a half swigs of soda": {"qty": 1.5, "multiplier": 1, "unit": "swigs", "rawUnit": "swigs", "name": "soda", "notes": null, "unitHint": null},
  };
  test.each(Object.keys(BASE))('%s', line => {
    expect(parseIngredientLine(line)).toEqual(BASE[line]);
  });
});

describe('splitLeadingPour', () => {
  test.each(['a splash', 'an splash of milk', 'a couple swigs of soda'])('null for %s', t => {
    expect(splitLeadingPour(t)).toBeNull();
  });
  test('splits count, singular word and rest', () => {
    expect(splitLeadingPour('Two Splashes of milk')).toEqual({ count: 2, word: 'splash', rest: 'milk' });
  });
  test('resolveLoosePourMeasures keeps leading whitespace and leaves non-pours alone', () => {
    expect(resolveLoosePourMeasures('  a gulp of water')).toBe('  1 floz of water');
    expect(resolveLoosePourMeasures('a glass of milk')).toBe('a glass of milk');
    expect(LOOSE_POUR_FLOZ.swig).toBe(1.5);
  });
});
