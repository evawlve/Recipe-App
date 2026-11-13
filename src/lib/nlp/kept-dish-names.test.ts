import { KEPT_DISH_NAMES, maskKeptDishNames } from './kept-dish-names';

describe('maskKeptDishNames', () => {
  it.each([
    ['arroz con pollo', 'arroz_con_pollo'],
    ['un café con leche', 'un café_con_leche'],
    ['CAFÉ CON LECHE', 'CAFÉ_CON_LECHE'],
    ['arroz  con   pollo', 'arroz_con_pollo'],
  ])('masks %s', (input, expected) => {
    expect(maskKeptDishNames(input)).toBe(expected);
  });

  it.each([
    'arroz con pollos', 'xarroz con pollo', 'pan con mantequilla', 'huevos con jamón', 'conch fritters', 'arroz con\npollo',
  ])('leaves %j unchanged', (input) => {
    expect(maskKeptDishNames(input)).toBe(input);
  });

  it('every kept entry is lowercase ascii words and contains a con|y joiner', () => {
    for (const name of KEPT_DISH_NAMES) {
      expect(name).toMatch(/^[a-z ]+$/);
      expect(name).toMatch(/\b(con|y)\b/);
    }
  });
});
