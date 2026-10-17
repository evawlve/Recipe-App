import { RESTAURANT_CHAINS, isRestaurantChain, fillRestaurantBrand } from '../restaurant-brand-fill';

type It = { rawText: string; brand?: string };
const it = (rawText: string, brand = ''): It => ({ rawText, brand });

describe('restaurant-brand-fill', () => {
  test('the list is the 33 sim entries plus four, and not cracker barrel', () => {
    expect(RESTAURANT_CHAINS).toHaveLength(37);
    expect(RESTAURANT_CHAINS).toEqual(expect.arrayContaining(["raising cane's", 'in-n-out', "portillo's", 'cava']));
    expect(RESTAURANT_CHAINS).not.toContain('cracker barrel');
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
    ['mcdonalds'], ['Domino’s'], ['chick fil a'], ["Wendy's"], ['starbucks'],
  ])('%s is a chain', (b) => {
    expect(isRestaurantChain(b)).toBe(true);
  });

  test.each([['banquet'], ['lean cuisine'], ['cracker barrel'], ['']])('%j is not a chain', (b) => {
    expect(isRestaurantChain(b)).toBe(false);
  });

  // ACCEPTED behaviour (design r2 named risk): a grocery product named after a chain is tagged with
  // the chain brand on item 1, so later unbranded items inherit it. Pinned, not fixed.
  test('collision shape (accepted): starbucks doubleshot + a banana -> banana gets starbucks', () => {
    const r = fillRestaurantBrand([it('starbucks doubleshot', 'starbucks'), it('a banana')]);
    expect(r.fills).toBe(1);
    expect(r.items[1].brand).toBe('starbucks');
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
