/**
 * s461 QP-LEAD: a fraction word that OPENS a food name is not a quantity. `quarter pounder` parsed as qty 0.25 of
 * `pounder` (25 g / 64 kcal, MEL noCache=false 2026-07-24 and 08-12), `third street bagel` as 1/3 of `street bagel`,
 * `half moon cookie` as 0.5 of `moon cookie` ("Cookie Moon"), and after a quantity the word was a multiplier
 * (`2 quarter pounders` = 0.5 of `pounders`, `1/4 quarter pounder` = 1/16).
 *
 * Mechanism: FRACTION_NAMES / isFractionNameAt() / fractionNameCursor() in ../ingredient-line.ts -- the
 * `half and half` cursor (S202 row HH) widened to a closed table of 2-3 word NAMES, decided once and honoured at the
 * parseQuantityTokens() call and the multiplier branch of parseIngredientLine() (and the HH sites it already reached).
 *
 * Two groups: MOVED lines (qty / multiplier / unit / name pinned) and lines that must stay BYTE-IDENTICAL to the base
 * parse (whole object, recorded from origin/master ea661972 before the edit). Measurement: s461 pd-qplead, in the PR body.
 */
import { parseIngredientLine } from '../ingredient-line';

describe('a fraction word that opens a food name is not a quantity (s461 QP-LEAD)', () => {
  // [line, qty, multiplier, name]; unit is always null.
  it.each<[string, number, number, string]>([
    ["quarter pounder", 1, 1, "quarter pounder"],
    ["quarter pounder with cheese", 1, 1, "quarter pounder with cheese"],
    ["quarter pounder deluxe", 1, 1, "quarter pounder deluxe"],
    ["Quarter Pounder With Cheese", 1, 1, "Quarter Pounder With Cheese"],
    ["quarter pounders", 1, 1, "quarter pounders"],
    ["quarter pounder w cheese no bun", 1, 1, "quarter pounder w cheese no bun"],
    ["third pounder", 1, 1, "third pounder"],
    ["half pounder", 1, 1, "half pounder"],
    ["third street bagel", 1, 1, "third street bagel"],
    ["half moon cookie", 1, 1, "half moon cookie"],
    ["half moon cookies", 1, 1, "half moon cookies"],
    ["HALF MOON COOKIE", 1, 1, "HALF MOON COOKIE"],
    ["third street lemonade", 1, 1, "third street lemonade"],
    ["one quarter pounder", 1, 1, "quarter pounder"],
    ["half smoke", 1, 1, "half smoke"],
    ["2 quarter pounders", 2, 1, "quarter pounders"],
    ["two quarter pounders", 2, 1, "quarter pounders"],
    ["1 quarter pounder with cheese", 1, 1, "quarter pounder with cheese"],
    ["1/4 quarter pounder", 0.25, 1, "quarter pounder"],
    ["2 half moon cookies", 2, 1, "half moon cookies"],
    ["about half moon cookie", 1, 1, "half moon cookie"],
  ])('%j keeps the fraction word in the name', (line, qty, multiplier, name) => {
    const parsed = parseIngredientLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.qty).toBe(qty);
    expect(parsed!.multiplier).toBe(multiplier);
    expect(parsed!.unit).toBeNull();
    expect(parsed!.name).toBe(name);
  });

  // The whole parse object, as base ea661972 returned it: real fractions, `half and half`, the article and brand forms,
  // the second word alone (`half street taco`, `quarter sour cream`), Spanish `cuarto de libra`, the ADJECTIVE pairs the
  // table leaves out on purpose (`half baked potato` is half a potato, so `half baked` keeps its base parse too), and
  // `half moon` + a food other than the cookie (`moon pie`, `moon cake`, `moon cheese` are foods: half of one).
  it.each<[string, Record<string, unknown>]>([
    ["half a pizza", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a pizza", "notes": null, "unitHint": null}],
    ["half an avocado", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "an avocado", "notes": null, "unitHint": null}],
    ["half avocado", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "avocado", "notes": null, "unitHint": null}],
    ["quarter chicken", {"qty": 0.25, "multiplier": 1, "unit": null, "rawUnit": null, "name": "chicken", "notes": null, "unitHint": null}],
    ["half chicken", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "chicken", "notes": null, "unitHint": null}],
    ["media pizza", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "pizza", "notes": null, "unitHint": null}],
    ["half a banana", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a banana", "notes": null, "unitHint": null}],
    ["quarter cup of rice", {"qty": 0.25, "multiplier": 1, "unit": "cup", "rawUnit": "cup", "name": "rice", "notes": null, "unitHint": null}],
    ["half cup milk", {"qty": 0.5, "multiplier": 1, "unit": "cup", "rawUnit": "cup", "name": "milk", "notes": null, "unitHint": null}],
    ["three quarters of a cup of milk", {"qty": 0.75, "multiplier": 1, "unit": "cup", "rawUnit": "cup", "name": "milk", "notes": null, "unitHint": null}],
    ["half and half", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "half and half", "notes": null, "unitHint": null}],
    ["a quarter of a pie", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a quarter of a pie", "notes": null, "unitHint": null}],
    ["half rack of ribs", {"qty": 0.5, "multiplier": 1, "unit": "rack", "rawUnit": "rack", "name": "ribs", "notes": null, "unitHint": null}],
    ["half sub", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "sub", "notes": null, "unitHint": null}],
    ["half sandwich", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "sandwich", "notes": null, "unitHint": null}],
    ["half dozen wings", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "dozen wings", "notes": null, "unitHint": null}],
    ["half order of applebees boneless wings", {"qty": 0.5, "multiplier": 1, "unit": "order", "rawUnit": "order", "name": "applebees wings", "notes": null, "qualifiers": ["boneless"], "unitHint": null}],
    ["third slice of pizza", {"qty": 0.3333333333333333, "multiplier": 1, "unit": "slice", "rawUnit": "slice", "name": "pizza", "notes": null, "unitHint": null}],
    ["fourth slice of pizza", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "fourth of pizza", "notes": null, "unitHint": "slice"}],
    ["half a cup of half and half", {"qty": 0.5, "multiplier": 1, "unit": "cup", "rawUnit": "cup", "name": "half and half", "notes": null, "unitHint": null}],
    ["half gallon of milk", {"qty": 0.5, "multiplier": 1, "unit": "gallon", "rawUnit": "gallon", "name": "milk", "notes": null, "unitHint": null}],
    ["quarter pound burger", {"qty": 0.25, "multiplier": 1, "unit": "lb", "rawUnit": "pound", "name": "burger", "notes": null, "unitHint": null}],
    ["half loaf of bread", {"qty": 0.5, "multiplier": 1, "unit": "loaf", "rawUnit": "loaf", "name": "bread", "notes": null, "unitHint": null}],
    ["half bagel", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "bagel", "notes": null, "unitHint": null}],
    ["half a moon pie", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a moon pie", "notes": null, "unitHint": null}],
    ["quarter of a cup of oats", {"qty": 0.25, "multiplier": 1, "unit": "cup", "rawUnit": "cup", "name": "oats", "notes": null, "unitHint": null}],
    ["2 half and half", {"qty": 2, "multiplier": 1, "unit": null, "rawUnit": null, "name": "half and half", "notes": null, "unitHint": null}],
    ["half sweet tea", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "sweet tea", "notes": null, "unitHint": null}],
    ["half lemonade", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "lemonade", "notes": null, "unitHint": null}],
    ["half a baked potato", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a baked potato", "notes": null, "unitHint": null}],
    ["half street taco", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "street taco", "notes": null, "unitHint": null}],
    ["quarter sour cream", {"qty": 0.25, "multiplier": 1, "unit": null, "rawUnit": null, "name": "sour cream", "notes": null, "unitHint": null}],
    ["half a half moon cookie", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a half moon cookie", "notes": null, "unitHint": null}],
    ["cuarto de libra con queso", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "cuarto de libra con queso", "notes": null, "unitHint": null}],
    ["double quarter pounder", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "double quarter pounder", "notes": null, "unitHint": null}],
    ["a quarter pounder with cheese", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a quarter pounder with cheese", "notes": null, "unitHint": null}],
    ["mcdonalds quarter pounder", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "mcdonalds quarter pounder", "notes": null, "unitHint": null}],
    ["half a quarter pounder", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a quarter pounder", "notes": null, "unitHint": null}],
    ["a quarter of a quarter pounder", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a quarter of a quarter pounder", "notes": null, "unitHint": null}],
    ["mcdonalds double quarter pounder with cheese", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "mcdonalds double quarter pounder with cheese", "notes": null, "unitHint": null}],
    ["a half moon cookie", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a half moon cookie", "notes": null, "unitHint": null}],
    ["half-moon cookie", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "half-moon cookie", "notes": null, "unitHint": null}],
    ["quarter-pounder with cheese", {"qty": 1, "multiplier": 1, "unit": null, "rawUnit": null, "name": "quarter-pounder with cheese", "notes": null, "unitHint": null}],
    ["half pound cake", {"qty": 0.5, "multiplier": 1, "unit": "lb", "rawUnit": "pound", "name": "cake", "notes": null, "unitHint": null}],
    ["quarter bagel", {"qty": 0.25, "multiplier": 1, "unit": null, "rawUnit": null, "name": "bagel", "notes": null, "unitHint": null}],
    ["half chicken breast", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "chicken breast", "notes": null, "unitHint": null}],
    ["half a sandwich", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "a sandwich", "notes": null, "unitHint": null}],
    ["half baked", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "baked", "notes": null, "unitHint": null}],
    ["half baked ice cream", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "baked ice cream", "notes": null, "unitHint": null}],
    ["half baked potato", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "baked potato", "notes": null, "unitHint": null}],
    ["half sour pickle", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "sour pickle", "notes": null, "unitHint": null}],
    ["half sour cream", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "sour cream", "notes": null, "unitHint": null}],
    ["half fat milk", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "fat milk", "notes": null, "unitHint": null}],
    ["half naked", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "naked", "notes": null, "unitHint": null}],
    ["half dipped strawberries", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "dipped strawberries", "notes": null, "unitHint": null}],
    ["half coated chocolate digestive", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "coated chocolate digestive", "notes": null, "unitHint": null}],
    ["2 half sour pickles", {"qty": 2, "multiplier": 0.5, "unit": null, "rawUnit": null, "name": "sour pickles", "notes": null, "unitHint": null}],
    ["half moon", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "moon", "notes": null, "unitHint": null}],
    ["half moons", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "moons", "notes": null, "unitHint": null}],
    ["half moon pie", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "moon pie", "notes": null, "unitHint": null}],
    ["half moon pies", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "moon pies", "notes": null, "unitHint": null}],
    ["2 half moon pies", {"qty": 2, "multiplier": 0.5, "unit": null, "rawUnit": null, "name": "moon pies", "notes": null, "unitHint": null}],
    ["half moon cake", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "moon cake", "notes": null, "unitHint": null}],
    ["half moon cheese", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "moon cheese", "notes": null, "unitHint": null}],
    ["half moon shaped cookie", {"qty": 0.5, "multiplier": 1, "unit": null, "rawUnit": null, "name": "moon shaped cookie", "notes": null, "unitHint": null}],
  ])('%j keeps its base parse', (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
  });
});
