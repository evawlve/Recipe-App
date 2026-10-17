/**
 * S202 row HH: a leading `half and half` is the food's NAME, not half a serving.
 *
 * Mechanism: isHalfAndHalfAt() / halfAndHalfCursor() in ../ingredient-line.ts
 * decide ONCE where the line's quantity cursor sits (0, or 1 behind a leading
 * hedge or a quantity token) and every site that would consume `half` as a
 * quantity, fraction or multiplier honours it. Before this, bare "half and
 * half" parsed as qty 0.5 / name "and half" (and "Half and Half" as qty 1 x
 * 0.5) and billed 0.5 x the 100 g flat floor.
 *
 * Three groups: MOVED lines (qty / multiplier / unit / name pinned), lines
 * that must stay BYTE-IDENTICAL to the base parse (whole object, recorded from
 * f5bfe7c4 before the edit), and a KNOWN GAP pinned at its actual parse.
 */
import { parseIngredientLine } from '../ingredient-line';

describe('half and half is the name, not a quantity (S202 row HH)', () => {
  // [line, qty, multiplier, name]; unit is always null.
  // The seven R lines were measured by the refuter's sim; the rest are seat-derived (S).
  it.each<[string, number, number, string]>([
    ["half and half", 1, 1, "half and half"], // R
    ["Half and Half", 1, 1, "Half and Half"], // R
    ["HALF AND HALF", 1, 1, "HALF AND HALF"], // R
    ["half & half", 1, 1, "half & half"], // R
    ["half n half", 1, 1, "half n half"], // R
    ["half 'n' half", 1, 1, "half 'n' half"], // R
    ["half and half creamer", 1, 1, "half and half creamer"], // R
    ["half and half iced tea", 1, 1, "half and half iced tea"], // S
    ["2 half and half", 2, 1, "half and half"], // S
    ["1 half and half", 1, 1, "half and half"], // S
    ["one half and half", 1, 1, "half and half"], // S
    ["1/2 half and half", 0.5, 1, "half and half"], // S
    ["about half and half", 1, 1, "half and half"], // S
    ["maybe half and half", 1, 1, "half and half"], // S
    ["half 'n half", 1, 1, "half 'n half"], // S
    ["half n' half", 1, 1, "half n' half"], // S
    ["half ’n’ half", 1, 1, "half ’n’ half"], // S
    ["2 half & half", 2, 1, "half & half"], // S
    ["about half n half", 1, 1, "half n half"], // S
    ["one half & half", 1, 1, "half & half"], // S
  ])('%j keeps the three words as the name', (line, qty, multiplier, name) => {
    const parsed = parseIngredientLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.qty).toBe(qty);
    expect(parsed!.multiplier).toBe(multiplier);
    expect(parsed!.unit).toBeNull();
    expect(parsed!.name).toBe(name);
  });

  // The whole parse object, as base f5bfe7c4 returned it.
  it.each<[string, Record<string, unknown>]>([
    ["half a bagel", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a bagel", "notes": null, "unitHint": null}],
    ["half an avocado", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "an avocado", "notes": null, "unitHint": null}],
    ["half a cup of milk", {"qty": 0.5, "multiplier": 1, "unit": "cup", "rawUnit": "cup", "name": "milk", "notes": null, "unitHint": null}],
    ["half and a half cups of milk", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "and a half cups of milk", "notes": null, "unitHint": null}],
    ["Half a cup of raw spinach", {"qty": 0.5, "multiplier": 1, "unit": "cup", "rawUnit": "cup", "name": "spinach", "notes": null, "qualifiers": ["raw"], "unitHint": null}],
    ["half of bell pepper", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "of bell pepper", "notes": null, "unitHint": null}],
    ["half cup oats", {"qty": 0.5, "multiplier": 1, "unit": "cup", "rawUnit": "cup", "name": "oats", "notes": null, "unitHint": null}],
    ["2 tbsp half and half", {"qty": 2, "multiplier": 1, "unit": "tbsp", "rawUnit": "tbsp", "name": "half and half", "notes": null, "unitHint": null}],
    ["1/2 cup half and half", {"qty": 0.5, "multiplier": 1, "unit": "cup", "rawUnit": "cup", "name": "half and half", "notes": null, "unitHint": null}],
    ["half a cup of half and half", {"qty": 0.5, "multiplier": 1, "unit": "cup", "rawUnit": "cup", "name": "half and half", "notes": null, "unitHint": null}],
    ["a tablespoon of half and half", {"qty": 1, "multiplier": 1, "unit": "tbsp", "rawUnit": "tablespoon", "name": "half and half", "notes": null, "unitHint": null}],
    ["a splash of half and half", {"qty": 0.5, "multiplier": 1, "unit": "floz", "rawUnit": "floz", "name": "half and half", "notes": null, "unitHint": null}],
    ["twisted tea half and half", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "twisted tea half and half", "notes": null, "unitHint": null}],
    ["organic valley half and half", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "organic valley half and half", "notes": null, "unitHint": null}],
    ["half-and-half", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "half-and-half", "notes": null, "unitHint": null}],
    ["one and a half cups milk", {"qty": 1.5, "multiplier": 1, "unit": "cup", "rawUnit": "cups", "name": "milk", "notes": null, "unitHint": null}],
    ["2 and a half tbsp of Nutella", {"qty": 2.5, "multiplier": 1, "unit": "tbsp", "rawUnit": "tbsp", "name": "Nutella", "notes": null, "unitHint": null}],
  ])('%j parses exactly as before', (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
  });

  // Known gap, design r2: a TRAILING quantity is not read, so the tail stays in the name.
  it.each<[string, number, string]>([
    ["half and half 2 tbsp", 1, "half and half 2 tbsp"],
    ["half and half (2 tbsp)", 1, "half and half 2 tbsp"],
  ])('%j is a known gap, design r2', (line, qty, name) => {
    const parsed = parseIngredientLine(line);
    expect(parsed!.qty).toBe(qty);
    expect(parsed!.unit).toBeNull();
    expect(parsed!.name).toBe(name);
  });
});
