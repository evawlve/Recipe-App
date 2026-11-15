import { RESTAURANT_CHAINS, isRestaurantChain, fillRestaurantBrand } from '../restaurant-brand-fill';

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
});
