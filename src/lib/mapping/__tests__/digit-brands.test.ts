/**
 * Digit-leading brand lexicon (digit-brands.ts) + brand-detector integration.
 *
 * The lexicon must claim exactly the listed brands (7UP, 5-hour Energy,
 * 3 Musketeers) and nothing that could shadow a genuine count ("7 almonds").
 * detectBrandInQuery must flag digit-leading brand lines as branded instead
 * of stripping the digits as a leading quantity.
 */

import {
  isDigitBrandToken,
  matchDigitBrandTokens,
  matchDigitBrandPrefix,
} from '../digit-brands';
import { detectBrandInQuery } from '../brand-detector';

describe('digit-brands lexicon', () => {
  test('single tokens: 7up / 7-up / 3musketeers / 5-hour', () => {
    expect(isDigitBrandToken('7up')).toBe(true);
    expect(isDigitBrandToken('7UP')).toBe(true);
    expect(isDigitBrandToken('7-up')).toBe(true);
    expect(isDigitBrandToken('3musketeers')).toBe(true);
    expect(isDigitBrandToken('5-hour')).toBe(true);
    // trailing punctuation tolerated
    expect(isDigitBrandToken('7up.')).toBe(true);
  });

  test('non-brand tokens are not claimed', () => {
    expect(isDigitBrandToken('7')).toBe(false);
    expect(isDigitBrandToken('200g')).toBe(false);
    expect(isDigitBrandToken('almonds')).toBe(false);
    // 9Lives is pet food — deliberately excluded from a food-log lexicon
    expect(isDigitBrandToken('9lives')).toBe(false);
  });

  test('phrase matching consumes the right number of tokens', () => {
    expect(matchDigitBrandTokens(['7up'])).toBe(1);
    expect(matchDigitBrandTokens(['7', 'up'])).toBe(2);
    expect(matchDigitBrandTokens(['3', 'musketeers', 'bar'])).toBe(2);
    expect(matchDigitBrandTokens(['5', 'hour', 'energy'])).toBe(3);
    // trigram on purpose: bare "5 hour" is NOT claimed
    expect(matchDigitBrandTokens(['5', 'hour'])).toBe(0);
    expect(matchDigitBrandTokens(['5', 'hour', 'braise'])).toBe(0);
    // genuine counts are never claimed
    expect(matchDigitBrandTokens(['7', 'almonds'])).toBe(0);
    expect(matchDigitBrandTokens(['2', 'eggs'])).toBe(0);
    // startIdx offset works ("2 7up" -> brand starts at index 1)
    expect(matchDigitBrandTokens(['2', '7up'], 1)).toBe(1);
    expect(matchDigitBrandTokens(['2', '7', 'up'], 1)).toBe(2);
  });

  test('prefix matcher returns the raw typed prefix', () => {
    expect(matchDigitBrandPrefix('7up')).toBe('7up');
    expect(matchDigitBrandPrefix('7 Up zero')).toBe('7 Up');
    expect(matchDigitBrandPrefix('5 hour energy extra strength')).toBe('5 hour energy');
    expect(matchDigitBrandPrefix('2 7up')).toBeNull(); // count first -> not a prefix
    expect(matchDigitBrandPrefix('7 almonds')).toBeNull();
  });
});

describe('detectBrandInQuery with digit-leading brands', () => {
  test('"7up" is branded (leading-qty strip must not eat the brand)', () => {
    const r = detectBrandInQuery('7up');
    expect(r.isBranded).toBe(true);
    expect(r.matchedBrand?.toLowerCase()).toBe('7up');
  });

  test('"7 up" and "5 hour energy" space forms are branded', () => {
    expect(detectBrandInQuery('7 up').isBranded).toBe(true);
    expect(detectBrandInQuery('5 hour energy').isBranded).toBe(true);
    expect(detectBrandInQuery('3 musketeers bar').isBranded).toBe(true);
  });

  test('"2 7up" (count + brand) is branded via the n-gram scan', () => {
    const r = detectBrandInQuery('2 7up');
    expect(r.isBranded).toBe(true);
    expect(r.matchedBrand?.toLowerCase()).toBe('7up');
  });

  test('plain counts stay unbranded', () => {
    expect(detectBrandInQuery('7 almonds').isBranded).toBe(false);
    expect(detectBrandInQuery('2 eggs').isBranded).toBe(false);
  });

  test('existing behavior intact: leading qty stripped, brand still found', () => {
    const r = detectBrandInQuery('1 cup Heinz ketchup');
    expect(r.isBranded).toBe(true);
    expect(r.matchedBrand?.toLowerCase()).toBe('heinz');
  });

  test('number+unit lines still unbranded', () => {
    expect(detectBrandInQuery('200g chicken breast').isBranded).toBe(false);
  });
});
