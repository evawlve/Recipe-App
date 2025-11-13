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
  });

  describe('unknown units', () => {
    test('returns unknown for unrecognized unit', () => {
      const result = normalizeUnitToken('xyz');
      expect(result).toEqual({ kind: 'unknown', raw: 'xyz' });
    });
  });
});

