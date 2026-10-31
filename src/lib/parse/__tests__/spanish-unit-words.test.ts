/**
 * C6970 D29: Spanish unit words + the `de`/`del` connector after a Spanish unit.
 *
 * MEASURED (2026-10-13, organic): `2 cucharadas de cream de cacahuate` read the unit word as part of the
 * food name and resolved to off_00073123 at 1,176 g / 6,915 kcal (label serving 588 g x 2).
 * Punch #170 layer 1. REACH: digit-led Spanish lines only (1 of 20 distinct organic Spanish-unit lines).
 * NOT here: numerals (`un/una/dos/media` -- backend #422, HELD) and `pieza` (out of scope).
 * Aliases live ONLY in normalizeUnitToken(); the connector is skipped ONLY when the previous token is in
 * SPANISH_UNIT_TOKENS, so English units (`1 can del monte corn`) and unknown words (`2 tacos de pollo`) are untouched.
 */
import { parseIngredientLine } from '../ingredient-line';
import { normalizeUnitToken, SPANISH_UNIT_TOKENS } from '../unit';

const KEYS = ['qty', 'multiplier', 'unit', 'name', 'unitHint', 'qualifiers'] as const;
function shape(line: string) {
  const r: any = parseIngredientLine(line);
  if (!r) return null;
  return { qty: r.qty, m: r.multiplier, unit: r.unit ?? null, raw: r.rawUnit ?? null, name: r.name, hint: r.unitHint ?? null, q: r.qualifiers ?? [] };
}
function core(line: string) {
  const r: any = parseIngredientLine(line);
  expect(r).not.toBeNull();
  return Object.fromEntries(KEYS.map((k) => [k, r[k] ?? null]));
}

describe('Spanish unit words parse to their English unit', () => {
  test.each<[string, number, string, string]>([
    ['2 cucharadas de crema de cacahuate', 2, 'tbsp', 'crema de cacahuate'],
    ['2 cucharadas de cream de cacahuate', 2, 'tbsp', 'cream de cacahuate'],
    ['1 cucharada de miel', 1, 'tbsp', 'miel'],
    ['1 cucharadita de azucar', 1, 'tsp', 'azucar'],
    ['2 cucharaditas de sal', 2, 'tsp', 'sal'],
    ['1 taza de arroz', 1, 'cup', 'arroz'],
    ['2 tazas de leche', 2, 'cup', 'leche'],
    ['3 rebanadas de pan', 3, 'slice', 'pan'],
    ['1 rebanada de queso', 1, 'slice', 'queso'],
    ['1 lata de atun', 1, 'can', 'atun'],
    ['2 latas de atun', 2, 'can', 'atun'],
    ['1 botella de agua', 1, 'bottle', 'agua'],
    ['2 botellas de agua', 2, 'bottle', 'agua'],
    ['1 puñado de almendras', 1, 'handful', 'almendras'],
    ['2 punados de nueces', 2, 'handful', 'nueces'],
    ['250 mililitros de jugo de naranja', 250, 'ml', 'jugo de naranja'],
    ['1 mililitro de vainilla', 1, 'ml', 'vainilla'],
  ])('%s', (line, qty, unit, name) => {
    const r: any = parseIngredientLine(line);
    expect(r).not.toBeNull();
    expect(r.qty).toBe(qty);
    expect(r.unit).toBe(unit);
    expect(r.name).toBe(name);
  });

  test('rawUnit stays Spanish', () => {
    expect((parseIngredientLine('2 cucharadas de miel') as any).rawUnit).toBe('cucharadas');
  });

  test('a unit word with no `de` is still a unit', () => {
    const r: any = parseIngredientLine('2 tazas arroz');
    expect(r.unit).toBe('cup');
    expect(r.name).toBe('arroz');
  });
});

describe('the connector', () => {
  test('`de` after the unit is consumed, `de` inside the name is kept', () => {
    expect((parseIngredientLine('3 cucharadas de aceite de oliva') as any).name).toBe('aceite de oliva');
    expect((parseIngredientLine('2 cucharadas de crema de cacahuate') as any).name).toBe('crema de cacahuate');
  });
  test('`del` after the unit is consumed likewise', () => {
    expect((parseIngredientLine('2 cucharadas del queso') as any).name).toBe('queso');
    expect((parseIngredientLine('1 taza del arroz de la casa') as any).name).toBe('arroz de la casa');
  });
  test('nothing follows the connector: left alone', () => {
    expect((parseIngredientLine('2 tazas de') as any).name).toBe('de');
  });
  test('gramos/gr de: the existing mass units now drop the connector', () => {
    const a: any = parseIngredientLine('100 gramos de pollo');
    expect([a.qty, a.unit, a.name]).toEqual([100, 'g', 'pollo']);
    const b: any = parseIngredientLine('200 gr de pollo');
    expect([b.qty, b.unit, b.name]).toEqual([200, 'g', 'pollo']);
  });
});

describe('mixed twin parity (same food phrase, English unit word): parsed equal, rawUnit excluded', () => {
  test.each<[string, string]>([
    ['2 cucharadas de crema de cacahuate', '2 tbsp of crema de cacahuate'],
    ['1 cucharadita de azucar', '1 tsp of azucar'],
    ['1 taza de arroz', '1 cup of arroz'],
    ['1 taza de avena', '1 cup of avena'],
    ['2 rebanadas de pan', '2 slices of pan'],
    ['1 lata de atun', '1 can of atun'],
    ['1 lata de coca cola', '1 can of coca cola'],
    ['1 botella de agua', '1 bottle of agua'],
    ['3 cucharadas de aceite de oliva', '3 tbsp of aceite de oliva'],
    ['1 taza de arroz con pollo', '1 cup of arroz con pollo'],
    ['4 cucharadas de salsa', '4 tbsp of salsa'],
    ['250 mililitros de jugo de naranja', '250 ml of jugo de naranja'],
    ['100 gramos de pollo', '100 g of pollo'],
  ])('%s == %s', (es, en) => {
    expect(core(es)).toEqual(core(en));
  });
});

describe('alias table', () => {
  test('exports the Spanish token set, and every member normalises to a real unit', () => {
    for (const t of SPANISH_UNIT_TOKENS) expect(normalizeUnitToken(t).kind).not.toBe('unknown');
  });
  test('`vaso` and the numerals/pieza are NOT in it', () => {
    for (const t of ['vaso', 'vasos', 'pieza', 'piezas', 'una', 'un', 'dos', 'media', 'medio', 'de', 'del']) {
      expect(SPANISH_UNIT_TOKENS.has(t)).toBe(false);
    }
  });
});

describe('CONTROLS: byte-identical to base (numerals, pieza, English units + de, brands, unknown words)', () => {
  test.each<[string, any]>([
    ["2 tbsp of peanut butter", {"qty": 2, "m": 1, "unit": "tbsp", "raw": "tbsp", "name": "peanut butter", "hint": null, "q": []}],
    ["a cup of rice", {"qty": 1, "m": 1, "unit": "cup", "raw": "cup", "name": "rice", "hint": null, "q": []}],
    ["chicken of the sea", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "chicken of the sea", "hint": null, "q": []}],
    ["cream of mushroom soup", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "cream of mushroom soup", "hint": null, "q": []}],
    ["dos huevos", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "dos huevos", "hint": null, "q": []}],
    ["2 piezas de pan", {"qty": 2, "m": 1, "unit": null, "raw": null, "name": "piezas de pan", "hint": null, "q": []}],
    ["1 can del monte corn", {"qty": 1, "m": 1, "unit": "can", "raw": "can", "name": "del monte corn", "hint": null, "q": []}],
    ["2 oz de cecco spaghetti", {"qty": 2, "m": 1, "unit": "oz", "raw": "oz", "name": "de cecco spaghetti", "hint": null, "q": []}],
    ["2 tacos de pollo", {"qty": 2, "m": 1, "unit": null, "raw": null, "name": "tacos de pollo", "hint": null, "q": []}],
    ["2 c de aceite", {"qty": 2, "m": 1, "unit": null, "raw": null, "name": "c de aceite", "hint": null, "q": []}],
    ["100 g de pollo", {"qty": 100, "m": 1, "unit": "g", "raw": "g", "name": "de pollo", "hint": null, "q": []}],
    ["una taza de arroz", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "una taza de arroz", "hint": null, "q": []}],
    ["taza chocolate", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "taza chocolate", "hint": null, "q": []}],
    ["una lata de atun", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "una lata de atun", "hint": null, "q": []}],
    ["un vaso de leche", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "un vaso de leche", "hint": null, "q": []}],
    ["una cucharada de aceite de oliva", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "una cucharada de aceite de oliva", "hint": null, "q": []}],
    ["una taza de avena", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "una taza de avena", "hint": null, "q": []}],
    ["una cucharada de miel", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "una cucharada de miel", "hint": null, "q": []}],
    ["tres rebanadas de pan integral", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "tres rebanadas de pan integral", "hint": null, "q": []}],
    ["dos rebanadas de pan bimbo", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "dos rebanadas de pan bimbo", "hint": null, "q": []}],
    ["una coca cola de lata", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "una coca cola de lata", "hint": null, "q": []}],
    ["una botella de agua de jamaica", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "una botella de agua de jamaica", "hint": null, "q": []}],
    ["1 vaso de leche", {"qty": 1, "m": 1, "unit": null, "raw": null, "name": "vaso de leche", "hint": null, "q": []}],
    ["1 glass of milk", {"qty": 1, "m": 1, "unit": "glass", "raw": "glass", "name": "milk", "hint": null, "q": []}],
  ])('%s', (line, want) => {
    expect(shape(line)).toEqual(want);
  });
});
