import { brandsAgree, pickBarcodeAnswer } from './brand-agree';

describe('brandsAgree', () => {
  test.each([
    ['BEL AIR', 'Wal-Mart Bakery', false],
    ['Kroger', 'Kroger', true],
    ['H-E-B', 'HEB', true],
    ['Goya Foods  Inc.', 'Goya', true],
    ['Pringles', 'Pringles Snacks', true],
    ['Great Value', 'Wal-Mart Great Value', true],
    ['The Co', 'Foods', false],
  ])('(%s, %s) -> %s', (a, b, want) => {
    expect(brandsAgree(a, b)).toBe(want);
  });
  test('blank or empty-compacting sides are null', () => {
    expect(brandsAgree(null, 'x')).toBeNull();
    expect(brandsAgree('x', null)).toBeNull();
    expect(brandsAgree('', 'x')).toBeNull();
    expect(brandsAgree('日清', 'Nissin')).toBeNull();
  });
});

describe('pickBarcodeAnswer', () => {
  const fs = { name: 'a', brandName: 'Wal-Mart Bakery' };
  test("'off' when both exist and brands disagree", () => {
    expect(pickBarcodeAnswer(fs, { name: 'b', brandName: 'BEL AIR' })).toBe('off');
  });
  test("'fs' when brands agree", () => {
    expect(pickBarcodeAnswer(fs, { name: 'b', brandName: 'Wal-Mart' })).toBe('fs');
  });
  test("'fs' when either brand is blank", () => {
    expect(pickBarcodeAnswer(fs, { name: 'b', brandName: null })).toBe('fs');
    expect(pickBarcodeAnswer({ name: 'a', brandName: null }, { name: 'b', brandName: 'BEL AIR' })).toBe('fs');
  });
  test("a corrupt OFF row never leads over FatSecret", () => {
    expect(pickBarcodeAnswer(fs, { name: 'b', brandName: 'BEL AIR', corrupt: true })).toBe('fs');
  });
  test('misses', () => {
    expect(pickBarcodeAnswer(null, { name: 'b', brandName: 'BEL AIR', corrupt: true })).toBe('off');
    expect(pickBarcodeAnswer(fs, null)).toBe('fs');
    expect(pickBarcodeAnswer(null, null)).toBeNull();
  });
});
