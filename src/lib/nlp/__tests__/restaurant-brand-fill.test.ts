import { RESTAURANT_CHAINS, isRestaurantChain, fillRestaurantBrand, measuredAs } from '../restaurant-brand-fill';

type It = { rawText: string; brand?: string };
const it = (rawText: string, brand = ''): It => ({ rawText, brand });

describe('restaurant-brand-fill', () => {
  test('the list is the 33 sim entries plus four, minus the four grocery-chain spellings, plus s459 row RC (26)', () => {
    expect(RESTAURANT_CHAINS).toHaveLength(59);
    expect(RESTAURANT_CHAINS).toEqual(expect.arrayContaining(["raising cane's", 'in-n-out', "portillo's", 'cava']));
    for (const grocery of ['cracker barrel', 'starbucks', 'dunkin', "dunkin'", 'panera']) {
      expect(RESTAURANT_CHAINS).not.toContain(grocery);
    }
  });

  test('fills later unbranded items with item 1 brand as typed', () => {
    const input = [it('a spicy chicken sandwich', 'chick-fil-a'), it('waffle fries'), it('a lemonade', '  ')];
    const r = fillRestaurantBrand(input);
    expect(r.fills).toBe(2);
    expect(r.items.map(i => i.brand)).toEqual(['chick-fil-a', 'chick-fil-a', 'chick-fil-a']);
  });

  test('a later item with its own brand keeps it', () => {
    const r = fillRestaurantBrand([it('a burger', "McDonald's"), it('a coke', 'coca-cola'), it('fries')]);
    expect(r.fills).toBe(1);
    expect(r.items.map(i => i.brand)).toEqual(["McDonald's", 'coca-cola', "McDonald's"]);
  });

  test('copies the spelling of item 1, not the list entry', () => {
    const r = fillRestaurantBrand([it('a burger', 'mcdonalds'), it('fries')]);
    expect(r.items[1].brand).toBe('mcdonalds');
  });

  test.each([
    ['banquet'], ['lean cuisine'], [''], ['cracker barrel'],
  ])('item 1 brand %j -> 0 fills', (brand) => {
    const input = [it('a pot pie', brand), it('an apple')];
    const r = fillRestaurantBrand(input);
    expect(r.fills).toBe(0);
    expect(r.items[1].brand).toBe('');
  });

  test('unbranded item 1 (brand undefined) -> 0 fills', () => {
    const r = fillRestaurantBrand([{ rawText: 'a pie' }, { rawText: 'an apple' }]);
    expect(r.fills).toBe(0);
  });

  test.each([
    ['raising canes'], ['Raising Cane’s'], ['In-N-Out Burger'], ['portillos'], ['CAVA'],
    ['mcdonalds'], ['Domino’s'], ['chick fil a'], ["Wendy's"],
  ])('%s is a chain', (b) => {
    expect(isRestaurantChain(b)).toBe(true);
  });

  // Chains that also sell grocery products are not listed (Diego, 2026-10-16): a fill would lend a
  // grocery item's brand to the next food.
  test.each([
    ['banquet'], ['lean cuisine'], ['cracker barrel'], ['starbucks'], ['Starbucks'], ['dunkin'], ["Dunkin'"],
    ['panera'], [''],
  ])('%j is not a chain', (b) => {
    expect(isRestaurantChain(b)).toBe(false);
  });

  // s459 row RC: top-US chains, every spelling the corpus' brandName columns hold (OffFood / FatSecretFood, 2026-11-15).
  test.each([
    ["Carl's Jr."], ['carls jr'], ["Culver's"], ['culvers'], ['Shake Shack'], ['Little Caesars'], ['little caesar'],
    ['Jimmy Johns'], ["Jimmy John’s"], ["Hardee's"], ['hardees'], ['Firehouse Subs'], ['Qdoba Mexican Grill'],
    ['El Pollo Loco'], ["Church's Chicken"], ['Sweetgreen'], ['Noodles & Company'], ['noodles and company'],
    ['LongHorn Steakhouse'], ["Jason's Deli"], ["McAlister's Deli"], ['Potbelly Sandwich Shop'], ['First Watch'],
    ['Golden Corral'], ['Crumbl'], ["Moe's Southwest Grill"], ["Marco's Pizza"],
  ])('s459 RC: %j is a chain', (b) => {
    expect(isRestaurantChain(b)).toBe(true);
  });

  // Not listed: a packaged retail product under the chain's name (OffFood, 2026-11-15), another company under the
  // chain's spelling, a grocery brand sharing the chain's first word, a bare initialism, and jersey mike's (fill guard).
  test.each([
    ['ihop'], ['Krispy Kreme'], ['Tim Hortons'], ['The Cheesecake Factory'], ["P.F. Chang's"], ['Red Lobster'],
    ['TGI Fridays'], ['White Castle'], ["Nathan's Famous"], ['Cinnabon'], ['Texas Roadhouse'], ['Buffalo Wild Wings'],
    ['On The Border'], ['Dutch Bros'], ['Jamba'], ['Smoothie King'], ["Auntie Anne's"], ['Checkers'], ['Waffle House'],
    ['Culver Duck'], ['Denny & Sons'], ['Monty Bojangles'], ['Violet Crumble'], ['crumble'], ['longhorn'], ["moe's"],
    ['dq'], ['bk'], ["Jersey Mike's"], ['jersey mikes subs'],
    ['Whataburger'], ["Steak 'N Shake"], ["Denny's"], ['Dennys'], ['Red Robin'], ['Del Taco'], ['Bojangles'],
    ["Zaxby's"], ['Dairy Queen'], ["Papa John's"], ["Papa John's Salads & Produce"],
  ])('s459 RC: %j is not a chain', (b) => {
    expect(isRestaurantChain(b)).toBe(false);
  });

  test('s459 RC: a newly listed chain fills its later unbranded items', () => {
    const r = fillRestaurantBrand([it('culvers butterburger', 'Culvers'), it('cheese curds'), it('a concrete mixer')]);
    expect(r.fills).toBe(2);
    expect(r.items.map(i => i.brand)).toEqual(['Culvers', 'Culvers', 'Culvers']);
  });

  test('grocery-collision shape: starbucks doubleshot + a banana -> the banana keeps no brand', () => {
    const r = fillRestaurantBrand([it('starbucks doubleshot', 'starbucks'), it('a banana')]);
    expect(r.fills).toBe(0);
    expect(r.items[1].brand ?? '').toBe('');
  });

  test('a one-item list is returned unchanged', () => {
    const input = [it('a burger', 'mcdonalds')];
    const r = fillRestaurantBrand(input);
    expect(r.fills).toBe(0);
    expect(r.items).toBe(input);
  });

  test('input is never mutated', () => {
    const input = [it('a burger', 'mcdonalds'), it('fries')];
    const snapshot = JSON.parse(JSON.stringify(input));
    const r = fillRestaurantBrand(input);
    expect(input).toEqual(snapshot);
    expect(r.items[1]).not.toBe(input[1]);
  });

  // s459 row FG: a line that measures any later food by weight or volume is a home log, not a restaurant order.
  // Members: the live cold draws of s459 pd-fg F01/F03/F05/F07/F08, pd-rc P19/P21 and rf-rc R07 (deploy 34-36).
  test.each([
    [['taco bell crunchy taco shells', 'taco bell'], ['4 oz ground beef'], ['shredded cheddar']],
    [['subway 6 inch turkey sub', 'subway'], ['1 tbsp olive oil'], ['1 cup rice'], ['2 tsp sugar']],
    [['wendys spicy chicken sandwich', 'wendys'], ['1 cup of grapes'], ['2 tbsp peanut butter']],
    [['chick-fil-a 8 count nuggets', 'chick-fil-a'], ['2 cups of milk'], ['a banana']],
    [['taco bell crunchwrap supreme', 'taco bell'], ['a banana'], ['8 oz of milk']],
    [['a subway footlong club', 'Subway'], ['12 oz coke', 'Coca-Cola'], ['1 tbsp olive oil'], ['half an avocado'],
      ['3 slices of pepperoni pizza'], ["siggis skyr", "Siggi's"]],
    [['a burger', 'mcdonalds'], ['100g chicken']],
    [['taco bell crunchwrap supreme', 'taco bell'], ['a banana'], ['16 oz water']],
    [['wendys baconator', 'wendys'], ['a banana'], ['2 tbsp coffee creamer']],
    [['a burger', 'mcdonalds'], ['2 cucharadas de crema de cacahuate']],
  ])('s459 FG: a later measured item -> 0 fills on the whole line (%j ...)', (...rows: string[][]) => {
    const input = rows.map(([r, b]) => it(r, b ?? ''));
    const r = fillRestaurantBrand(input);
    expect(r.fills).toBe(0);
    expect(r.items).toBe(input);
  });

  // Restaurant orders keep the fill: counts, sizes, servings, fractions, an `N oz` drink inside a size phrase, and a
  // measured item 1 (the guard reads later items only). Members: pd-fg F10-F13, F16, F20; s192's two organic fill rows.
  test.each([
    [['mcdonalds big mac and fries', 'mcdonalds'], ['a coke']],
    [['chick-fil-a spicy chicken sandwich', 'chick-fil-a'], ['waffle fries'], ['a large lemonade']],
    [['panda express orange chicken', 'panda express'], ['chow mein'], ['a serving of super greens']],
    [['half a serving of panda express chow mein', 'panda express'], ['a serving of orange chicken'],
      ['half a serving of beijing beef']],
    [['popeyes mashed potatoes', 'popeyes'], ['cajun gravy']],
    [['chipotle chips', 'Chipotle'], ['guac']],
    [['outback 8 oz sirloin', 'outback'], ['a baked potato'], ['steamed broccoli']],
    [['chick-fil-a 8 count nuggets', 'chick-fil-a'], ['a 20 oz lemonade'], ['3 slices of cheesecake']],
  ])('s459 FG: a restaurant order keeps its fill (%j ...)', (...rows: string[][]) => {
    const r = fillRestaurantBrand(rows.map(([t, b]) => it(t, b ?? '')));
    expect(r.fills).toBe(rows.length - 1);
    expect(r.items.every(x => x.brand === rows[0][1])).toBe(true);
  });

  // A drink's cup size is how a chain sells a drink, not a home measure: the line's sides keep the fill, and the
  // measured drink itself stays unbranded (filled, `16oz latte` billed "Chick-fil-A Icedream Cup"). Members: pd-fg F14,
  // rf-fg P01/P03/P06 (live, deploy 36).
  test.each([
    [['mcdonalds big mac', 'mcdonalds'], ['medium fries'], ['16 oz coke']],
    [['sonic cheeseburger', 'sonic'], ['tots'], ['32 oz diet coke']],
    [['taco bell crunchwrap supreme', 'taco bell'], ['cinnamon twists'], ['20 oz mountain dew']],
    [['chick-fil-a chicken biscuit', 'chick-fil-a'], ['hash browns'], ['16oz latte']],
    [['mcdonalds egg mcmuffin', 'mcdonalds'], ['a hash brown'], ['a cup of coffee']],
  ])('s459 FG: a sized drink neither blocks nor takes the fill (%j ...)', (...rows: string[][]) => {
    const r = fillRestaurantBrand(rows.map(([t, b]) => it(t, b ?? '')));
    expect(r.fills).toBe(1);
    expect(r.items.map(x => x.brand)).toEqual([rows[0][1], rows[0][1], '']);
  });

  test.each([
    ['4 oz ground beef', 'food'], ['1 tbsp olive oil', 'food'], ['1 cup rice', 'food'], ['2 tsp sugar', 'food'],
    ['100g chicken', 'food'], ['45 mL of soy sauce', 'food'], ['8 oz of milk', 'food'], ['2 cups of milk', 'food'],
    ['16 oz water', 'food'], ['12 oz orange juice', 'food'], ['2 tbsp coffee creamer', 'food'], ['1 tsp instant coffee', 'food'],
    ['16oz sweet tea', 'drink'], ['a cup of coffee', 'drink'], ['16 oz coke', 'drink'], ['32 oz diet coke', 'drink'],
    ['20 oz mountain dew', 'drink'], ['16oz latte', 'drink'], ['500 ml sprite', 'drink'],
    ['half an avocado', null], ['3 slices of pepperoni pizza', null], ['a serving of orange chicken', null],
    ['medium fries', null], ['8 count nuggets', null], ['a 20 oz lemonade', null], ['shredded cheddar', null],
    ['', null],
  ])('s459 FG: measuredAs(%j) is %s', (t, want) => {
    expect(measuredAs(t as string)).toBe(want);
  });
});
