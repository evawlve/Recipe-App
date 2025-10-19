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
