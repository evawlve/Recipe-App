/**
 * Tests for unit.ts - unit normalization
 */

import { normalizeUnitToken } from '../unit';

describe('normalizeUnitToken', () => {
  describe('count units', () => {
    test('recognizes "block" unit', () => {
      const result = normalizeUnitToken('block');
      expect(result).toEqual({ kind: 'count', unit: 'block' });
    });

    test('recognizes "blocks" unit (plural)', () => {
      const result = normalizeUnitToken('blocks');
      expect(result).toEqual({ kind: 'count', unit: 'block' });
    });

    test('recognizes "can" unit', () => {
      const result = normalizeUnitToken('can');
      expect(result).toEqual({ kind: 'count', unit: 'can' });
    });

    test('recognizes "slice" unit', () => {
      const result = normalizeUnitToken('slice');
      expect(result).toEqual({ kind: 'count', unit: 'slice' });
    });

    test('recognizes "egg" unit', () => {
      const result = normalizeUnitToken('egg');
      expect(result).toEqual({ kind: 'count', unit: 'egg' });
    });
  });

  describe('mass units', () => {
    test('recognizes "g" unit', () => {
      const result = normalizeUnitToken('g');
      expect(result).toEqual({ kind: 'mass', unit: 'g' });
    });

    test('recognizes "oz" unit', () => {
      const result = normalizeUnitToken('oz');
      expect(result).toEqual({ kind: 'mass', unit: 'oz' });
    });

    test('recognizes "kg" unit', () => {
      const result = normalizeUnitToken('kg');
      expect(result).toEqual({ kind: 'mass', unit: 'kg' });
    });
  });

  describe('volume units', () => {
    test('recognizes "cup" unit', () => {
      const result = normalizeUnitToken('cup');
      expect(result).toEqual({ kind: 'volume', unit: 'cup' });
    });

    test('recognizes "tsp" unit', () => {
      const result = normalizeUnitToken('tsp');
      expect(result).toEqual({ kind: 'volume', unit: 'tsp' });
    });

    test('recognizes "liter" unit', () => {
      const result = normalizeUnitToken('liter');
      expect(result).toEqual({ kind: 'volume', unit: 'l' });
    });

    test('recognizes "pint" unit', () => {
      const result = normalizeUnitToken('pint');
      expect(result).toEqual({ kind: 'volume', unit: 'pint' });
    });

    test('recognizes "quart" unit', () => {
      const result = normalizeUnitToken('quart');
      expect(result).toEqual({ kind: 'volume', unit: 'quart' });
    });

    test('recognizes "gallon" unit', () => {
      const result = normalizeUnitToken('gallon');
      expect(result).toEqual({ kind: 'volume', unit: 'gallon' });
    });
  });

  describe('unknown units', () => {
    test('returns unknown for unrecognized unit', () => {
      const result = normalizeUnitToken('xyz');
      expect(result).toEqual({ kind: 'unknown', raw: 'xyz' });
    });
  });

  describe('unit conversions', () => {
    const { convertUnit } = require('../unit');

    test('converts kg to g', () => {
      const result = convertUnit(1.5, 'kg', 'g');
      expect(result).toBeCloseTo(1500, 2);
    });

    test('converts l to ml', () => {
      const result = convertUnit(2, 'l', 'ml');
      expect(result).toBeCloseTo(2000, 2);
    });

    test('converts pint to ml', () => {
      const result = convertUnit(1, 'pint', 'ml');
      expect(result).toBeCloseTo(473.176, 2);
    });

    test('converts quart to ml', () => {
      const result = convertUnit(1, 'quart', 'ml');
      expect(result).toBeCloseTo(946.353, 2);
    });

    test('converts gallon to ml', () => {
      const result = convertUnit(1, 'gallon', 'ml');
      expect(result).toBeCloseTo(3785.41, 2);
    });
  });
});


