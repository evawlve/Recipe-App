/**
 * C70 D12 row: an approximator before a bare COUNT (`at least a dozen wings`, `upwards of 3 beers`) parses like its un-approximated twin
 * (it used to bill qty 1 with the whole line as the name). A "count" that is really a claim (nutrient, percent, price, time, size,
 * component number) keeps its approximator and stays whole. Controls are the master outputs, read before the edit and hard-coded.
 */

import { parseIngredientLine } from '../ingredient-line';

describe('approximator before a bare count', () => {
  // cloud-38 test G12, verbatim.
  test('G12 qualifier: an approximator before an article / count-noun quantity parses like its twin', () => {
    for (const [line, twin] of [['at least a dozen wings', 'a dozen wings'], ['upwards of 3 beers', '3 beers']]) {
      const a = parseIngredientLine(line)!, b = parseIngredientLine(twin)!;
      expect([a.qty * a.multiplier, a.name]).toEqual([b.qty * b.multiplier, b.name]);
    }
  });

  const targets: Array<[string, string]> = [
    ['at least a dozen wings', 'a dozen wings'],
    ['upwards of 3 beers', '3 beers'],
    ['at most 4 cookies', '4 cookies'],
    ['at least a couple of beers', 'a couple of beers'],
    ['just shy of 3 beers', '3 beers'],
    ['under 3 tacos', '3 tacos'],
    ['At least A Dozen Wings', 'A Dozen Wings'],
    ['close to 3 large eggs', '3 large eggs'],
  ];
  it.each(targets)('%s parses like %s', (line, twin) => {
    const a = parseIngredientLine(line);
    expect(a).not.toBeNull();
    expect(a).toEqual(parseIngredientLine(twin));
  });

  it('the first two targets read the twin quantity', () => {
    const a = parseIngredientLine('at least a dozen wings')!;
    expect([a.qty * a.multiplier, a.name]).toEqual([12, 'wings']);
    const b = parseIngredientLine('upwards of 3 beers')!;
    expect([b.qty * b.multiplier, b.name]).toEqual([3, 'beers']);
  });

  // Already true on master (the unit table covers these nouns); pinned so the strip never regresses them.
  const alreadyTrue: Array<[string, string]> = [
    ['just over 2 slices of pizza', '2 slices of pizza'],
    ['close to two cups of rice', 'two cups of rice'],
    ['over a dozen eggs', 'a dozen eggs'],
    ['over 2 eggs', '2 eggs'],
  ];
  it.each(alreadyTrue)('%s parses like %s (already true)', (line, twin) => {
    const a = parseIngredientLine(line);
    expect(a).not.toBeNull();
    expect(a).toEqual(parseIngredientLine(twin));
  });

  const whole = { qty: 1, multiplier: 1, unit: null, rawUnit: null, notes: null, unitHint: null };
  // [line, name master reads]
  const controls: Array<[string, string]> = [
    ['under 100 calorie bar', 'under 100 calorie bar'],
    ['Under 100 Calorie Bar', 'Under 100 Calorie Bar'],
    ['at least 85 percent dark chocolate', 'at least 85 percent dark chocolate'],
    ['at least 70% cacao chocolate', 'at least 70% cacao chocolate'],
    ['at least 70%-80% cacao chocolate', 'at least 70%-80% cacao chocolate'],
    ['over 40 protein bar', 'over 40 protein bar'],
    ['under 100 calorie, low fat bar', 'under 100 calorie low fat bar'],
    ['under 100cal bar', 'under 100 cal bar'],
    ['under 140 mg sodium soup', 'under 140 mg sodium soup'],
    ['under 10 minute meal', 'under 10 minute meal'],
    ['over 18 year old cheddar', 'over 18 year old cheddar'],
    ['under 6 inch sub', 'under 6 inch sub'],
    ['under 5 dollars', 'under 5 dollars'],
    ['at least 7 grain bread', 'at least 7 grain bread'],
    ['under 5 sugar yogurt', 'under 5 sugar yogurt'],
    ['under armour shake', 'under armour shake'],
    ['over easy eggs', 'over easy eggs'],
    ['at least 2', 'at least 2'],
    ['close to nothing', 'close to nothing'],
    ['over 9000', 'over 9000'],
  ];
  it.each(controls)('%s stays whole', (line, name) => {
    expect(parseIngredientLine(line)).toEqual({ ...whole, name });
  });
});
