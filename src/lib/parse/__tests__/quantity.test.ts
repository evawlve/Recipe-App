import { parseQuantityTokens } from '../quantity';

test('unicode half', () => {
  const r = parseQuantityTokens(['½']);
  expect(r?.qty).toBeCloseTo(0.5);
  expect(r?.consumed).toBe(1);
});

test('unicode quarter', () => {
  const r = parseQuantityTokens(['¼']);
  expect(r?.qty).toBeCloseTo(0.25);
  expect(r?.consumed).toBe(1);
});

test('unicode third', () => {
  const r = parseQuantityTokens(['⅓']);
  expect(r?.qty).toBeCloseTo(1/3, 5);
  expect(r?.consumed).toBe(1);
});

test('simple fraction 1/2', () => {
  const r = parseQuantityTokens(['1/2']);
  expect(r?.qty).toBeCloseTo(0.5);
  expect(r?.consumed).toBe(1);
});

test('word fraction "half"', () => {
  const r = parseQuantityTokens(['half']);
  expect(r?.qty).toBeCloseTo(0.5);
  expect(r?.consumed).toBe(1);
});

test('word fraction "quarter"', () => {
  const r = parseQuantityTokens(['quarter']);
  expect(r?.qty).toBeCloseTo(0.25);
  expect(r?.consumed).toBe(1);
});

test('word fraction "third"', () => {
  const r = parseQuantityTokens(['third']);
  expect(r?.qty).toBeCloseTo(1/3, 5);
  expect(r?.consumed).toBe(1);
});

test('one and a half', () => {
  const r = parseQuantityTokens(['one', 'and', 'a', 'half']);
  expect(r?.qty).toBeCloseTo(1.5);
  expect(r?.consumed).toBe(4);
});

test('mixed number "1 1/2"', () => {
  const r = parseQuantityTokens(['1', '1/2']);
  expect(r?.qty).toBeCloseTo(1.5);
  expect(r?.consumed).toBe(2);
});

test('simple integer', () => {
  const r = parseQuantityTokens(['2']);
  expect(r?.qty).toBeCloseTo(2);
  expect(r?.consumed).toBe(1);
});

test('decimal number', () => {
  const r = parseQuantityTokens(['1.5']);
  expect(r?.qty).toBeCloseTo(1.5);
  expect(r?.consumed).toBe(1);
});

test('invalid token returns null', () => {
  const r = parseQuantityTokens(['invalid']);
  expect(r).toBeNull();
});

test('empty array returns null', () => {
  const r = parseQuantityTokens([]);
  expect(r).toBeNull();
});

// S1.1: Fractions attached to numbers
test('number with attached fraction "2½"', () => {
  const r = parseQuantityTokens(['2½']);
  expect(r?.qty).toBeCloseTo(2.5);
  expect(r?.consumed).toBe(1);
});

test('number with attached fraction "1¼"', () => {
  const r = parseQuantityTokens(['1¼']);
  expect(r?.qty).toBeCloseTo(1.25);
  expect(r?.consumed).toBe(1);
});

test('number with space and fraction "2 ½"', () => {
  const r = parseQuantityTokens(['2', '½']);
  expect(r?.qty).toBeCloseTo(2.5);
  expect(r?.consumed).toBe(2);
});

test('number with space and fraction "1 ¼"', () => {
  const r = parseQuantityTokens(['1', '¼']);
  expect(r?.qty).toBeCloseTo(1.25);
  expect(r?.consumed).toBe(2);
});

// S1.1: Ranges
test('range with hyphen "2-3"', () => {
  const r = parseQuantityTokens(['2', '-', '3']);
  expect(r?.qty).toBeCloseTo(2.5);
  expect(r?.consumed).toBe(3);
});

test('range with en-dash "2–3"', () => {
  const r = parseQuantityTokens(['2', '–', '3']);
  expect(r?.qty).toBeCloseTo(2.5);
  expect(r?.consumed).toBe(3);
});

test('range with "to" keyword "2 to 3"', () => {
  const r = parseQuantityTokens(['2', 'to', '3']);
  expect(r?.qty).toBeCloseTo(2.5);
  expect(r?.consumed).toBe(3);
});

test('range with spaced hyphen "2 - 3"', () => {
  const r = parseQuantityTokens(['2', '-', '3']);
  expect(r?.qty).toBeCloseTo(2.5);
  expect(r?.consumed).toBe(3);
});

// S1.1: Combined fractions with ranges
test('fraction with range "1½-2"', () => {
  const r = parseQuantityTokens(['1½', '-', '2']);
  expect(r?.qty).toBeCloseTo(1.75); // (1.5 + 2) / 2
  expect(r?.consumed).toBe(3);
});

test('range with fraction "2-3½"', () => {
  const r = parseQuantityTokens(['2', '-', '3½']);
  expect(r?.qty).toBeCloseTo(2.75); // (2 + 3.5) / 2
  expect(r?.consumed).toBe(3);
});

test('range with both fractions "1½-2½"', () => {
  const r = parseQuantityTokens(['1½', '-', '2½']);
  expect(r?.qty).toBeCloseTo(2.0); // (1.5 + 2.5) / 2
  expect(r?.consumed).toBe(3);
});
// Word-number quantities ("two eggs" -> 2, "a dozen eggs" -> 12)
test('word-number "two"', () => {
  const r = parseQuantityTokens(['two', 'eggs']);
  expect(r?.qty).toBe(2);
  expect(r?.consumed).toBe(1);
});

test('word-number "three"', () => {
  const r = parseQuantityTokens(['three', 'eggs']);
  expect(r?.qty).toBe(3);
  expect(r?.consumed).toBe(1);
});

test('word-number "ten"', () => {
  const r = parseQuantityTokens(['ten', 'wings']);
  expect(r?.qty).toBe(10);
  expect(r?.consumed).toBe(1);
});

test('word-number "one" is consumed (frees the unit)', () => {
  const r = parseQuantityTokens(['one', 'cup', 'flour']);
  expect(r?.qty).toBe(1);
  expect(r?.consumed).toBe(1);
});

test('"a dozen" -> 12 (article consumed)', () => {
  const r = parseQuantityTokens(['a', 'dozen', 'eggs']);
  expect(r?.qty).toBe(12);
  expect(r?.consumed).toBe(2);
});

test('"a couple of" -> 2 (article + partitive "of" consumed)', () => {
  const r = parseQuantityTokens(['a', 'couple', 'of', 'eggs']);
  expect(r?.qty).toBe(2);
  expect(r?.consumed).toBe(3);
});

test('"couple of" -> 2 (bare, partitive "of" consumed)', () => {
  const r = parseQuantityTokens(['couple', 'of', 'eggs']);
  expect(r?.qty).toBe(2);
  expect(r?.consumed).toBe(2);
});

test('bare article "a" is NOT a number word', () => {
  // "a bagel" must fall through so the caller applies its qty=1 default
  const r = parseQuantityTokens(['a', 'bagel']);
  expect(r).toBeNull();
});

test('word-number does not break "one and a half"', () => {
  const r = parseQuantityTokens(['one', 'and', 'a', 'half']);
  expect(r?.qty).toBeCloseTo(1.5);
  expect(r?.consumed).toBe(4);
});
