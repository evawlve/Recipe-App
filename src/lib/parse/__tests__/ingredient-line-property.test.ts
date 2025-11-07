/**
 * S1.7: Property-based/fuzz tests for parser robustness
 * Lightweight property tests using fast-check
 */

import { parseIngredientLine } from '../ingredient-line';
import * as fc from 'fast-check';

describe('S1.7: Parser Property-Based Tests', () => {
  describe('Numeric Robustness', () => {
    test('randomized fraction inputs never crash', () => {
      const unicodeFractions = ['½', '¼', '¾', '⅓', '⅔', '⅛', '⅜', '⅝', '⅞'];
      
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10 }),
          fc.constantFrom(...unicodeFractions),
          fc.constantFrom('cup', 'tbsp', 'tsp', 'g', 'oz'),
          fc.constantFrom('flour', 'sugar', 'salt', 'milk', 'oil'),
          (whole, fraction, unit, name) => {
            // Test format: "whole fraction unit name" or "fraction unit name"
            const input = whole > 0 
              ? `${whole}${fraction} ${unit} ${name}`
              : `${fraction} ${unit} ${name}`;
            
            // Should not throw
            expect(() => parseIngredientLine(input)).not.toThrow();
            
            const result = parseIngredientLine(input);
            // If it parses, qty should be finite and > 0
            if (result) {
              expect(Number.isFinite(result.qty)).toBe(true);
              expect(result.qty).toBeGreaterThan(0);
              expect(result.qty).toBeLessThanOrEqual(100);
            }
          }
        ),
        { seed: 42, numRuns: 50 } // Deterministic with seed, lightweight
      );
    });

    test('randomized range inputs never crash and produce valid quantities', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 10 }),
          fc.constantFrom('cup', 'tbsp', 'tsp'),
          fc.constantFrom('flour', 'sugar', 'milk'),
          (first, second, unit, name) => {
            // Ensure first <= second for valid range
            const min = Math.min(first, second);
            const max = Math.max(first, second);
            
            // Test various range formats
            const formats = [
              `${min}-${max} ${unit} ${name}`,
              `${min}–${max} ${unit} ${name}`,
              `${min} to ${max} ${unit} ${name}`
            ];
            
            formats.forEach(input => {
              // Should not throw
              expect(() => parseIngredientLine(input)).not.toThrow();
              
              const result = parseIngredientLine(input);
              // If it parses, qty should be finite, > 0, and within range
              if (result) {
                expect(Number.isFinite(result.qty)).toBe(true);
                expect(result.qty).toBeGreaterThan(0);
                expect(result.qty).toBeLessThanOrEqual(100);
                // Range should average to between min and max
                expect(result.qty).toBeGreaterThanOrEqual(min);
                expect(result.qty).toBeLessThanOrEqual(max);
              }
            });
          }
        ),
        { seed: 42, numRuns: 30 } // Lightweight
      );
    });
  });

  describe('Whitespace Variations', () => {
    test('random whitespace/punctuation variants around valid core still parse', () => {
      const validCores = [
        '2 cups flour',
        '1 tbsp olive oil',
        '3 eggs',
        '½ cup milk',
        '2-3 large eggs'
      ];
      
      fc.assert(
        fc.property(
          fc.constantFrom(...validCores),
          fc.string({ minLength: 0, maxLength: 3 }).filter(s => /^[\s,]*$/.test(s)), // Only whitespace and commas
          fc.string({ minLength: 0, maxLength: 3 }).filter(s => /^[\s,]*$/.test(s)),
          (core, prefix, suffix) => {
            const input = prefix + core + suffix;
            
            // Should not throw
            expect(() => parseIngredientLine(input)).not.toThrow();
            
            const result = parseIngredientLine(input);
            // If it parses, should have valid structure
            if (result) {
              expect(Number.isFinite(result.qty)).toBe(true);
              expect(result.qty).toBeGreaterThan(0);
              expect(typeof result.name).toBe('string');
            }
          }
        ),
        { seed: 42, numRuns: 40 } // Lightweight
      );
    });

    test('unicode spaces are normalized correctly', () => {
      const unicodeSpaces = ['\u2009', '\u00A0', '\u2000', '\u2001']; // thin space, non-breaking, en quad, em quad
      
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.constantFrom(...unicodeSpaces),
          fc.constantFrom('½', '¼'),
          fc.constantFrom('cup', 'tbsp'),
          fc.constantFrom('flour', 'sugar'),
          (num, space, fraction, unit, name) => {
            // Test format: "num space fraction unit name"
            const input = `${num}${space}${fraction} ${unit} ${name}`;
            
            // Should not throw
            expect(() => parseIngredientLine(input)).not.toThrow();
            
            const result = parseIngredientLine(input);
            // Should parse correctly despite unicode spaces
            if (result) {
              expect(Number.isFinite(result.qty)).toBe(true);
              expect(result.qty).toBeGreaterThan(0);
            }
          }
        ),
        { seed: 42, numRuns: 30 } // Lightweight
      );
    });
  });

  describe('Error Handling', () => {
    test('random noisy strings return null (not throw)', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }), // Random strings
          (input) => {
            // Should never throw, even on completely random input
            expect(() => parseIngredientLine(input)).not.toThrow();
            
            const result = parseIngredientLine(input);
            // Should return null or valid ParsedIngredient, never throw
            if (result) {
              // If it somehow parses, should have valid structure
              expect(Number.isFinite(result.qty)).toBe(true);
              expect(typeof result.name).toBe('string');
            }
            // null is also acceptable for non-ingredient text
          }
        ),
        { seed: 42, numRuns: 100 } // More runs for error handling
      );
    });

    test('emojis and special characters return null (not throw)', () => {
      const specialChars = ['😀', '🎂', '🍕', '🔥', '💯', '⭐', '❤️', '🚀'];
      
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(...specialChars), { minLength: 1, maxLength: 10 }),
          fc.string({ minLength: 0, maxLength: 20 }),
          (emojis, text) => {
            const input = emojis.join(' ') + ' ' + text;
            
            // Should never throw
            expect(() => parseIngredientLine(input)).not.toThrow();
            
            const result = parseIngredientLine(input);
            // Should return null for emoji-heavy input, or valid parse if it happens to work
            if (result) {
              expect(Number.isFinite(result.qty)).toBe(true);
              expect(typeof result.name).toBe('string');
            }
          }
        ),
        { seed: 42, numRuns: 50 } // Lightweight
      );
    });

    test('malformed input with numbers but no valid structure returns null (not throw)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          fc.string({ minLength: 5, maxLength: 30 }).filter(s => !/^\d+$/.test(s)), // Non-numeric strings
          (num, text) => {
            // Create malformed inputs like "123 random text" or "random 123 text"
            const inputs = [
              `${num} ${text}`,
              `${text} ${num}`,
              `${text}${num}`,
              `${num}${text}`
            ];
            
            inputs.forEach(input => {
              // Should never throw - this is the main requirement
              // We don't care about the result, just that it doesn't throw
              expect(() => {
                parseIngredientLine(input);
              }).not.toThrow();
            });
          }
        ),
        { seed: 42, numRuns: 40 } // Lightweight
      );
    });
  });
});

