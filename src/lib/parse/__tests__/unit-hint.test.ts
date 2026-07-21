import { extractUnitHint } from '../unit-hint';
import { parseIngredientLine } from '../ingredient-line';

/**
 * Tests for unit-hint extraction, focused on the egg-scoped 'white' hint
 * (PR D pt3, Lever C — C2): 'white' is only a food-part hint next to egg/eggs;
 * elsewhere it is a variety modifier that must stay in the name.
 * Golden watch: n-tot-02 (white rice), "1 slice white bread" (golden-set ~:2410).
 */

describe('extractUnitHint — egg-scoped "white" hint', () => {
  it('"egg whites" still hints white with core name egg', () => {
    expect(extractUnitHint(['egg', 'whites'])).toEqual({ unitHint: 'white', coreName: 'egg' });
    expect(extractUnitHint(['egg', 'white'])).toEqual({ unitHint: 'white', coreName: 'egg' });
    expect(extractUnitHint(['eggs', 'whites'])).toEqual({ unitHint: 'white', coreName: 'egg' });
  });

  it('egg context via contextTokens (unit parser consumed "egg" as count unit)', () => {
    // "3 egg whites": name tokens are just ['whites'], 'egg' arrives as unit context
    expect(extractUnitHint(['whites'], ['egg'])).toEqual({ unitHint: 'white', coreName: 'egg' });
  });

  it('bare "whites" with no egg context produces no hint', () => {
    expect(extractUnitHint(['whites'])).toEqual({ unitHint: null, coreName: 'whites' });
  });

  it('"white rice" produces no hint and keeps white in the name', () => {
    expect(extractUnitHint(['white', 'rice'])).toEqual({ unitHint: null, coreName: 'white rice' });
  });

  it('"white bread" / "white onion" / "white wine" keep their names', () => {
    expect(extractUnitHint(['white', 'bread'])).toEqual({ unitHint: null, coreName: 'white bread' });
    expect(extractUnitHint(['white', 'onion'])).toEqual({ unitHint: null, coreName: 'white onion' });
    expect(extractUnitHint(['white', 'wine'])).toEqual({ unitHint: null, coreName: 'white wine' });
  });

  it('"egg yolk" unchanged (yolk hint has no egg gate needed)', () => {
    expect(extractUnitHint(['egg', 'yolks'])).toEqual({ unitHint: 'yolk', coreName: 'egg' });
    expect(extractUnitHint(['egg', 'yolk'])).toEqual({ unitHint: 'yolk', coreName: 'egg' });
  });
});

describe('parseIngredientLine — white-variety foods after egg gating', () => {
  it('"3 egg whites" still parses to name egg, unitHint white', () => {
    const p = parseIngredientLine('3 egg whites')!;
    expect(p.qty).toBe(3);
    expect(p.name).toBe('egg');
    expect(p.unitHint).toBe('white');
  });

  it('"1 cup white rice" keeps white in the name, no unitHint', () => {
    const p = parseIngredientLine('1 cup white rice')!;
    expect(p.unit).toBe('cup');
    expect(p.name).toBe('white rice');
    expect(p.unitHint).toBeNull();
  });

  it('"1 slice white bread" keeps white bread (golden-set watch case)', () => {
    const p = parseIngredientLine('1 slice white bread')!;
    expect(p.name).toBe('white bread');
    expect(p.unitHint).toBeNull();
  });

  it('"1 white onion" keeps white onion', () => {
    const p = parseIngredientLine('1 white onion')!;
    expect(p.name).toBe('white onion');
    expect(p.unitHint).toBeNull();
  });

  it('"2 egg yolks" unchanged', () => {
    const p = parseIngredientLine('2 egg yolks')!;
    expect(p.name).toBe('egg');
    expect(p.unitHint).toBe('yolk');
  });
});
