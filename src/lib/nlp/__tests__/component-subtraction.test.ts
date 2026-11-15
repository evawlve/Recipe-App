/**
 * applyComponentSubtraction() / COMPONENT_TABLE (s447a): the solo path subtracts one fixed
 * portion of a CARRIED generic component. Pure-function pins, one per skip reason.
 */

type Mod = typeof import('../component-subtraction');
type Tbl = typeof import('../component-table');
let applyComponentSubtraction: Mod['applyComponentSubtraction'];
let COMPONENT_TABLE: Tbl['COMPONENT_TABLE'];
let ALIASES: Tbl['ALIASES'];

beforeAll(async () => {
  // resolve-payload.ts loads prisma at import.
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
  ({ applyComponentSubtraction } = await import('../component-subtraction'));
  ({ COMPONENT_TABLE, ALIASES } = await import('../component-table'));
});

const bill = (over: Record<string, number | null> = {}) => ({
  calories: 400, protein: 30, carbs: 12, fat: 28, fiber: 3 as number | null,
  sugar: 3 as number | null, sodium: 0.9 as number | null, ...over,
});

const base = (over: Record<string, unknown> = {}) => ({
  nutrition: bill(),
  grams: 300,
  foodName: 'Cobb Salad',
  standardSource: 'fatsecret',
  head: 'a cobb salad',
  clause: 'without the egg',
  parsed: { qty: 1, multiplier: 1, unit: '' },
  ...over,
}) as Parameters<Mod['applyComponentSubtraction']>[0];

describe('COMPONENT_TABLE', () => {
  test('every row is well-formed', () => {
    for (const [key, row] of Object.entries(COMPONENT_TABLE)) {
      expect(row.fsId).toMatch(/^fs_\d+$/);
      expect(row.name).toBeTruthy();
      expect(row.portionLabel).toBeTruthy();
      expect(row.grams).toBeGreaterThan(0);
      expect(row.per100g.calories).toBeGreaterThan(0);
      for (const k of ['protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium'] as const) {
        expect(typeof row.per100g[k]).toBe('number');
      }
      expect(Array.isArray(row.carriers)).toBe(true);
      // syrup and brown sugar carry nothing on purpose (waffle / oatmeal records are the plain food)
      if (row.carriers.length === 0) expect(['syrup', 'brown sugar']).toContain(key);
    }
  });
  test('every alias resolves to a row', () => {
    for (const target of Object.values(ALIASES)) expect(COMPONENT_TABLE[target]).toBeDefined();
  });
});

describe('applyComponentSubtraction', () => {
  test('cobb salad without the egg: 400 -> 323.0, protein 23.7, per-100g re-derived', () => {
    const r = applyComponentSubtraction(base());
    if (!('adjustments' in r)) throw new Error(`skipped: ${(r as { skipped: string }).skipped}`);
    expect(r.nutrition.calories).toBe(323);
    expect(r.nutrition.protein).toBe(23.7);
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0].component).toBe('egg');
    expect(r.adjustments[0].foodId).toBe('fs_3094');
    expect(r.adjustments[0].grams).toBe(50);
    expect(r.adjustments[0].clause).toBe('without the egg');
    expect(r.adjustments[0].nutrition.calories).toBe(77);
    expect(r.adjustments[0].nutrition.protein).toBe(6.3);
    expect(r.nutritionPer100g.kcal100).toBeCloseTo((323 * 100) / 300, 2);
    expect(r.partSkips).toBeUndefined();
  });

  test('qty 2 (2 cobb salads) doubles the delta', () => {
    const r = applyComponentSubtraction(base({
      head: '2 cobb salads', grams: 600, nutrition: bill({ calories: 800 }),
      parsed: { qty: 2, multiplier: 1, unit: '' },
    }));
    if (!('adjustments' in r)) throw new Error('skipped');
    expect(r.adjustments[0].grams).toBe(100);
    expect(r.nutrition.calories).toBe(646);
  });

  test('a unit that is not count-like (8 oz burrito) is headQty 1', () => {
    const r = applyComponentSubtraction(base({
      head: '8 oz burrito', foodName: 'Burrito', grams: 227, clause: 'without sour cream',
      nutrition: bill({ calories: 500 }), parsed: { qty: 8, multiplier: 1, unit: 'oz' },
    }));
    if (!('adjustments' in r)) throw new Error('skipped');
    expect(r.adjustments[0].component).toBe('sour cream');
    expect(r.adjustments[0].grams).toBe(29);
  });

  test('qty over 10 skips qty_out_of_range', () => {
    expect(applyComponentSubtraction(base({ parsed: { qty: 12, multiplier: 1, unit: '' } })))
      .toEqual({ skipped: 'qty_out_of_range' });
  });

  // s459 MF-a: carbs / fat / protein can no longer go below the part (not_in_panel); fiber, sugar and sodium still clamp.
  test('fiber, sugar and sodium clamp at 0', () => {
    const r = applyComponentSubtraction(base({
      nutrition: bill({ fiber: 0, sugar: 0, sodium: 0 }),
    }));
    if (!('adjustments' in r)) throw new Error('skipped');
    expect(r.nutrition.fiber).toBe(0);
    expect(r.nutrition.sugar).toBe(0);
    expect(r.nutrition.sodium).toBe(0);
  });

  test('not_in_panel: a part whose carbs, fat or protein exceed the billed panel', () => {
    expect(applyComponentSubtraction(base({
      nutrition: bill({ protein: 1, carbs: 0, fat: 1 }),
    }))).toEqual({ skipped: 'not_in_panel' });
  });

  test('no_carrier: a waffle without syrup on a 180 kcal Waffles winner', () => {
    expect(applyComponentSubtraction(base({
      head: 'a waffle', foodName: 'Waffles', clause: 'without syrup', grams: 75,
      nutrition: bill({ calories: 180 }),
    }))).toEqual({ skipped: 'no_carrier' });
  });

  test('brown sugar on an oatmeal head is no_carrier, not not_in_table', () => {
    expect(applyComponentSubtraction(base({
      head: 'oatmeal', foodName: 'Rolled Oats', clause: 'without the brown sugar', grams: 40,
      nutrition: bill({ calories: 160 }),
    }))).toEqual({ skipped: 'no_carrier' });
  });

  test('a winner that names the component itself passes the gate with no carrier', () => {
    const r = applyComponentSubtraction(base({
      head: 'a waffle', foodName: 'Waffle with Syrup', clause: 'without syrup', grams: 150,
      nutrition: bill({ calories: 400, carbs: 60 }),
    }));
    expect('adjustments' in r && r.adjustments[0].component).toBe('syrup');
  });

  test('too_large_kcal: delta over 60 % of the billed calories', () => {
    expect(applyComponentSubtraction(base({ nutrition: bill({ calories: 100 }) })))
      .toEqual({ skipped: 'too_large_kcal' });
  });

  test('too_large_grams: a burrito without beans at 113 g is OK (43 g), at 60 g is too large', () => {
    const ok = applyComponentSubtraction(base({
      head: 'a burrito', foodName: 'Burrito', clause: 'without beans', grams: 113,
      nutrition: bill({ calories: 250 }),
    }));
    if (!('adjustments' in ok)) throw new Error('skipped');
    expect(ok.adjustments[0].component).toBe('bean');
    expect(ok.adjustments[0].grams).toBe(43);
    expect(ok.nutrition.calories).toBe(213);
    expect(applyComponentSubtraction(base({
      head: 'a burrito', foodName: 'Burrito', clause: 'without beans', grams: 60,
      nutrition: bill({ calories: 250 }),
    }))).toEqual({ skipped: 'too_large_grams' });
  });

  test('not_in_table: hollandaise and rice', () => {
    expect(applyComponentSubtraction(base({
      head: 'eggs benedict', foodName: 'Eggs Benedict', clause: 'minus the hollandaise',
    }))).toEqual({ skipped: 'not_in_table' });
    expect(applyComponentSubtraction(base({ clause: 'without rice' })))
      .toEqual({ skipped: 'not_in_table' });
  });

  test('"onions and pickles" is never guessed', () => {
    expect(applyComponentSubtraction(base({
      head: 'a burger', foodName: 'Burger', clause: 'without onions and pickles',
    }))).toEqual({ skipped: 'not_in_table' });
  });

  test('unmapped: ai_estimated source, or no billed calories', () => {
    expect(applyComponentSubtraction(base({
      head: 'a hot dog', foodName: 'Hot Dog', clause: 'without the bun', standardSource: 'ai_estimated',
    }))).toEqual({ skipped: 'unmapped' });
    expect(applyComponentSubtraction(base({ nutrition: bill({ calories: 0 }) })))
      .toEqual({ skipped: 'unmapped' });
  });

  test('two-word keys: sour cream on a burrito subtracts', () => {
    const r = applyComponentSubtraction(base({
      head: 'a burrito', foodName: 'Burrito', clause: 'without the sour cream', grams: 250,
    }));
    expect('adjustments' in r && r.adjustments[0].component).toBe('sour cream');
  });

  test('without onions or pickles on a Hot Dog with Bun: onion subtracted, pickle no_carrier in partSkips', () => {
    const r = applyComponentSubtraction(base({
      head: 'a hot dog', foodName: 'Hot Dog with Bun', clause: 'without onions or pickles',
      grams: 100, nutrition: bill({ calories: 290 }),
    }));
    if (!('adjustments' in r)) throw new Error('skipped');
    expect(r.adjustments.map(a => a.component)).toEqual(['onion']);
    expect(r.partSkips).toEqual([{ component: 'pickle', reason: 'no_carrier' }]);
  });

  test('two carried parts: one entry each, applied in order', () => {
    const r = applyComponentSubtraction(base({
      head: 'a cheeseburger', foodName: 'Cheeseburger', clause: 'without onions or pickles',
      grams: 150, nutrition: bill({ calories: 300 }),
    }));
    if (!('adjustments' in r)) throw new Error('skipped');
    expect(r.adjustments.map(a => a.component)).toEqual(['onion', 'pickle']);
    expect(r.partSkips).toBeUndefined();
  });

  test('a carrier word matches inside no other word: burger never matches cheeseburger', () => {
    // pickle carriers include burger AND cheeseburger; syrup carries nothing. cheese has no `burger` carrier.
    expect(applyComponentSubtraction(base({
      head: 'a hamburger', foodName: 'Hamburger', clause: 'without the cheese',
    }))).toEqual({ skipped: 'no_carrier' });
    // s458 RM-a: the carrier reads the winner only (A16)
    expect(applyComponentSubtraction(base({
      head: '2 cheeseburgers', foodName: 'Burger', clause: 'without cheese', grams: 400,
      nutrition: bill({ calories: 900 }), parsed: { qty: 2, multiplier: 1, unit: '' },
    }))).toEqual({ skipped: 'no_carrier' });
    const r = applyComponentSubtraction(base({
      head: '2 cheeseburgers', foodName: 'Cheeseburger', clause: 'without cheese', grams: 400,
      nutrition: bill({ calories: 900 }), parsed: { qty: 2, multiplier: 1, unit: '' },
    }));
    expect('adjustments' in r && r.adjustments[0].component).toBe('cheese');
    expect('adjustments' in r && r.adjustments[0].grams).toBe(42);
  });

  test('micros: null stays null, non-null subtracts and re-derives per 100 g (sodium in grams)', () => {
    const r = applyComponentSubtraction(base({
      nutrition: bill({ fiber: null, sugar: 2, sodium: 0.9 }),
    }));
    if (!('adjustments' in r)) throw new Error('skipped');
    expect(r.nutrition.fiber).toBeNull();
    expect(r.nutritionPer100g.fiber100).toBeNull();
    expect(r.nutrition.sugar).toBe(1.4); // 2 - 0.56 -> 1.44 -> 1.4
    expect(r.nutrition.sodium).toBe(0.8); // 0.9 - 0.139 -> 0.761 -> 0.8
    expect(r.nutritionPer100g.sugar100).toBeCloseTo((1.4 * 100) / 300, 2);
    expect(r.nutritionPer100g.sodium100).toBeCloseTo((0.8 * 100) / 300, 2);
  });

  // The 11 organic lines that reach stripSoloRemoval() (60 d), each with a plausible winner:
  // what the table does with it is pinned here, per line.
  test.each([
    ['a cobb salad', 'Cobb Salad', 'without the egg', 300, 400, 'egg'],
    ['a burrito', 'Burrito', 'without beans', 113, 250, 'bean'],
    ['a cheeseburger', 'Cheeseburger', 'without cheese', 150, 300, 'cheese'],
    ['a hamburger', 'Hamburger', 'without the cheese', 150, 300, 'no_carrier'],
    ['a turkey club', 'Turkey Club Sandwich', 'minus the bacon', 250, 500, 'bacon'],
    ['a turkey sub', 'Turkey Sub', 'without mayo', 250, 400, 'mayo'],
    ['a grilled chicken sandwich', 'Grilled Chicken Sandwich', 'without mayo', 200, 400, 'mayo'],
    ['a waffle', 'Waffles', 'without syrup', 75, 180, 'no_carrier'],
    ['eggs benedict', 'Eggs Benedict', 'minus the hollandaise', 200, 450, 'not_in_table'],
    ['oatmeal', 'Rolled Oats', 'without the brown sugar', 40, 160, 'no_carrier'],
    ['a hot dog', 'Hot Dog with Bun', 'without the bun', 100, 290, 'bun'],
  ])('organic line %s (%s %s) -> %s', (head, foodName, clause, grams, calories, expected) => {
    // s459 MF-a: carbs 24 g, so the 21 g-carb bun fits the panel (a real hot dog in a bun carries ~24 g).
    const r = applyComponentSubtraction(base({
      head, foodName, clause, grams, nutrition: bill({ calories, carbs: 24 }),
    }));
    if ('adjustments' in r) expect(r.adjustments[0].component).toBe(expected);
    else expect(r.skipped).toBe(expected);
  });
});

describe('s459 MF-a: bun on a chain winner, built-out names, panel fit', () => {
  const base = { calories: 670, protein: 31, carbs: 54, fat: 39, fiber: 2, sugar: 11, sodium: 1 };
  const run = (foodName: string, brandName: string | null, nutrition = base, grams = 270) =>
    applyComponentSubtraction({ nutrition, grams, foodName, brandName, standardSource: 'fatsecret', head: foodName, clause: 'no bun' });
  test('a chain winner carries its bun (Whopper)', () => {
    const r = run('Whopper', 'Burger King');
    expect('adjustments' in r && r.nutrition.calories).toBeCloseTo(550, 1);
  });
  test('a non-chain winner that names no carrier still skips', () => {
    expect(run('Whopper', null)).toEqual({ skipped: 'no_carrier' });
  });
  test('a chain winner of a bunless form skips', () => {
    expect(run('Grilled Chicken Cool Wrap', "Chick-fil-A")).toEqual({ skipped: 'no_carrier' });
    expect(run('8 Count Nuggets', "Chick-fil-A")).toEqual({ skipped: 'no_carrier' });
    expect(run('Pan Pizza - Pepperoni', 'Pizza Hut')).toEqual({ skipped: 'no_carrier' });
    expect(run('Crunchwrap Supreme', 'Taco Bell')).toEqual({ skipped: 'no_carrier' });
    expect(run('Egg McMuffin', "McDonald's")).toEqual({ skipped: 'no_carrier' });
    expect(run("Croissan'wich - Egg & Cheese", 'Burger King')).toEqual({ skipped: 'no_carrier' });
    expect(run('Corn Dog', 'Sonic', { ...base, calories: 210 }, 75)).toEqual({ skipped: 'no_carrier' });
  });
  test('a bread form keeps a non-chain carrier name (sausage), as before s459', () => {
    expect('adjustments' in run("Croissan'wich - Sausage, Egg & Cheese", 'Burger King')).toBe(true);
  });
  test('RM-d `sin pan` on a chain burger subtracts the bun', () => {
    const r = applyComponentSubtraction({ nutrition: base, grams: 270, foodName: 'Whopper', brandName: 'Burger King',
      standardSource: 'fatsecret', head: 'un whopper sin pan', clause: 'sin pan' });
    expect('adjustments' in r && r.adjustments.map(a => a.component)).toEqual(['bun']);
  });
  test('a bunless form never loses a bun even when it names a carrier (not a chain)', () => {
    expect(run('Cheeseburger protein pockets', null, { calories: 226, protein: 16.1, carbs: 22.8, fat: 4.6, fiber: 0, sugar: 4.4, sodium: 0.3 }, 100))
      .toEqual({ skipped: 'no_carrier' });
  });
  test('a winner whose name says the bun was replaced is already_removed', () => {
    expect(run('Cheeseburger with Onion Protein Style (Bun replaced with Lettuce)', 'In-N-Out')).toEqual({ skipped: 'already_removed' });
    expect(run('Shackburger - Single Lettuce Wrap', 'Shake Shack')).toEqual({ skipped: 'already_removed' });
    expect(run('Turkey Tom (Unwich Lettuce Wrap)', "Jimmy John's")).toEqual({ skipped: 'already_removed' });
  });
  test('a panel without the part\'s carbs cannot hold it (patty record)', () => {
    expect(run('Turkey Burger', null, { calories: 217, protein: 25.3, carbs: 0, fat: 12.2, fiber: 0, sugar: 0, sodium: 0.1 }, 93.25))
      .toEqual({ skipped: 'not_in_panel' });
  });
});
