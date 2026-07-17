/**
 * Regression tests for partitive-"of" unit consumption.
 *
 * An UNKNOWN token (not in the curated unit tables) is normally treated as part
 * of the food name. But "<qty> <token> of <food>" is a reliable measure-word
 * signal, so the unknown token is consumed as the unit and routed to AI serving
 * estimation. Without a following "of", the old name-token behavior is kept so
 * adjectives ("organic", "romaine") are NOT mistaken for units.
 */

import { parseIngredientLine } from '../ingredient-line';

describe('partitive "of" unknown-unit consumption', () => {
  test('"1 knob of butter" → unit "knob", name "butter"', () => {
    const p = parseIngredientLine('1 knob of butter');
    expect(p).not.toBeNull();
    expect(p!.unit).toBe('knob');
    expect(p!.name).toBe('butter');
  });

  test('"3 rashers of bacon" → unit "rashers", name "bacon", qty 3', () => {
    const p = parseIngredientLine('3 rashers of bacon');
    expect(p).not.toBeNull();
    expect(p!.qty).toBeCloseTo(3);
    expect(p!.unit).toBe('rashers');
    expect(p!.name).toBe('bacon');
  });

  test('"1 glug of olive oil" → unit "glug", name "olive oil"', () => {
    const p = parseIngredientLine('1 glug of olive oil');
    expect(p).not.toBeNull();
    expect(p!.unit).toBe('glug');
    expect(p!.name).toBe('olive oil');
  });

  test('"1 ramekin of hummus" → unit "ramekin", name "hummus"', () => {
    const p = parseIngredientLine('1 ramekin of hummus');
    expect(p).not.toBeNull();
    expect(p!.unit).toBe('ramekin');
    expect(p!.name).toBe('hummus');
  });

  // Negative cases: unknown token WITHOUT a following "of" stays in the name.
  test('"1 organic banana" → does not treat "organic" as a unit', () => {
    const p = parseIngredientLine('1 organic banana');
    expect(p).not.toBeNull();
    expect(p!.unit).not.toBe('organic');
    expect(p!.name).toContain('banana');
  });

  test('"5 romaine leaves" → does not treat "romaine" as a unit', () => {
    const p = parseIngredientLine('5 romaine leaves');
    expect(p).not.toBeNull();
    expect(p!.unit).not.toBe('romaine');
    expect(p!.name).toContain('romaine');
  });
});
