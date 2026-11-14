/**
 * s457 P4: a leading Spanish count word before a NOUN parses exactly as its digit twin (`dos huevos` == `2 huevos`).
 * The digit twin is the contract: whatever `2 huevos` bills today, `dos huevos` bills. Measurement (two-tree ES:
 * replay + a 16,982-line parse census, 0 English movers): s457 pd-p4, carried in the PR body.
 */
import { parseIngredientLine } from '../ingredient-line';

const KEYS = ['qty', 'multiplier', 'unit', 'rawUnit', 'name', 'unitHint', 'qualifiers'] as const;
function core(line: string) {
  const r: any = parseIngredientLine(line);
  expect(r).not.toBeNull();
  return Object.fromEntries(KEYS.map((k) => [k, r[k] ?? null]));
}

describe('a Spanish count word before a noun == its digit twin', () => {
  test.each([
    ['dos huevos', '2 huevos', 2], ['Dos Huevos', '2 Huevos', 2], ['dos tortillas de harina', '2 tortillas de harina', 2],
    ['tres tortillas de maiz', '3 tortillas de maiz', 3], ['dos tamales de pollo', '2 tamales de pollo', 2],
    ['dos piezas de pan', '2 piezas de pan', 2], ['tres tacos al pastor', '3 tacos al pastor', 3],
    ['seis galletas marias', '6 galletas marias', 6], ['diez fresas', '10 fresas', 10],
    ['doce tortillas de maiz', '12 tortillas de maiz', 12], ['veinte almendras', '20 almendras', 20],
    ['veinticinco uvas', '25 uvas', 25], ['veintidós uvas', '22 uvas', 22], ['treinta y dos almendras', '32 almendras', 32],
    ['treinta y siete uvas', '37 uvas', 37], ['cien gramos de pollo', '100 gramos de pollo', 100],
    ['ciento cincuenta gramos de pollo', '150 gramos de pollo', 150], ['doscientos gramos de arroz', '200 gramos de arroz', 200],
    ['dos y media tazas de arroz', '2.5 tazas de arroz', 2.5], ['media manzana', '0.5 manzana', 0.5],
    ['medio aguacate', '0.5 aguacate', 0.5], ['una docena de huevos', '12 huevos', 12],
    ['media docena de huevos', '6 huevos', 6], ['un par de huevos', '2 huevos', 2],
    ['dos donas de krispy kreme', '2 donas de krispy kreme', 2], ['tres galletas oreo', '3 galletas oreo', 3],
    ['dos vasos de leche', '2 vasos de leche', 2], ['medio kilo de tortillas', '0.5 kilo de tortillas', 0.5],
  ])('%s == %s', (word, twin, qty) => {
    expect(core(word)).toEqual(core(twin));
    expect(core(word).qty).toBe(qty);
  });
});

describe('names, brands, articles and excluded words are byte-identical to base (qty 1, the whole line is the name)', () => {
  test.each([
    'tres leches', 'tres leches cake', 'cuatro leches', 'media crema', 'media luna', 'media noche', 'cinco jotas ham',
    'dos equis', 'dos equis lager', 'siete tortilla chips',
    'doce de leite', 'cinco de mayo chocolates', 'dos de cabillaud', "dos d'eglefin",
    'quince paste', 'once upon a farm', 'uno pizza',
    'una manzana', 'un platano', 'una medida de proteína ascent de vainilla', 'un vaso de agua', 'una taza de arroz',
    'dos', 'media', 'dos y medio', 'dos con queso', 'tres 8 oz steaks', 'dos y tres tacos',
    'dos pinos yogurt', 'tres agaves margarita mix', 'ocho candy bar', 'dos hombres mezcal',
    'dos onzas de queso', 'medio litro de leche', 'dos platos de arroz',
  ])('%s unchanged', (line) => {
    expect(core(line)).toEqual({ qty: 1, multiplier: 1, unit: null, rawUnit: null, name: line, unitHint: null, qualifiers: null });
  });
});
