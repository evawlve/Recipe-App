/**
 * Digit-leading brand quantity guard (fix: "7up" billed as 7 x 355ml can).
 *
 * Digit-leading brand names ("7UP", "5-hour Energy", "3 Musketeers") must not
 * have their leading digit consumed as a quantity by parseIngredientLine.
 * Explicit counts BEFORE the brand still parse ("2 7up" -> qty 2), and
 * generic digit-leading lines are untouched ("7 almonds" -> qty 7).
 *
 * Lexicon: src/lib/mapping/digit-brands.ts
 */

import { parseIngredientLine } from '../ingredient-line';

describe('digit-leading brand tokens are not quantities', () => {
  describe('7UP (single-token brand)', () => {
    test('"7up" -> qty 1, name keeps the whole brand token', () => {
      const r = parseIngredientLine('7up');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(1);
      expect(r!.multiplier).toBe(1);
      expect(r!.unit).toBeNull();
      expect(r!.name.toLowerCase()).toBe('7up');
    });

    test('"7-up" (hyphen form) -> qty 1, not a 7-to-something range', () => {
      const r = parseIngredientLine('7-up');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(1);
      expect(r!.name.toLowerCase()).toBe('7-up');
    });

    test('"7 up" (space form) -> qty 1 via the digit-brand bigram', () => {
      const r = parseIngredientLine('7 up');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(1);
      expect(r!.name.toLowerCase()).toBe('7 up');
    });

    test('"2 7up" -> explicit count still wins: qty 2 of 7up', () => {
      const r = parseIngredientLine('2 7up');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(2);
      expect(r!.name.toLowerCase()).toContain('7up');
    });

    test('"2 7up cans" -> qty 2, brand token survives into the name', () => {
      const r = parseIngredientLine('2 7up cans');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(2);
      expect(r!.name.toLowerCase()).toContain('7up');
    });

    test('"7up zero" -> qty 1, flavor suffix kept', () => {
      const r = parseIngredientLine('7up zero');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(1);
      expect(r!.name.toLowerCase()).toContain('7up');
    });
  });

  describe('5-hour Energy (multi-word digit brand)', () => {
    test('"5 hour energy" -> qty 1, not 5 units', () => {
      const r = parseIngredientLine('5 hour energy');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(1);
      expect(r!.name.toLowerCase()).toBe('5 hour energy');
    });

    test('"5-hour energy" (hyphen form) -> qty 1', () => {
      const r = parseIngredientLine('5-hour energy');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(1);
      expect(r!.name.toLowerCase()).toBe('5-hour energy');
    });

    test('"2 5 hour energy" -> explicit count: qty 2', () => {
      const r = parseIngredientLine('2 5 hour energy');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(2);
      expect(r!.name.toLowerCase()).toContain('hour energy');
    });

    // Deliberately deferred: bare "5 hour" WITHOUT "energy" is not claimed by
    // the lexicon (trigram on purpose) — it is too ambiguous against genuine
    // duration/count phrasings, so it keeps the historical quantity parse.
    test('bare "5 hour" is NOT claimed by the brand guard', () => {
      const r = parseIngredientLine('5 hour something');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(5);
    });
  });

  describe('3 Musketeers (multi-word digit brand)', () => {
    test('"3 musketeers bar" -> qty 1, not 3 bars', () => {
      const r = parseIngredientLine('3 musketeers bar');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(1);
      expect(r!.name.toLowerCase()).toContain('musketeers');
    });

    test('"3 musketeers" -> qty 1', () => {
      const r = parseIngredientLine('3 musketeers');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(1);
      expect(r!.name.toLowerCase()).toBe('3 musketeers');
    });

    test('"2 3 musketeers" -> explicit count: qty 2', () => {
      const r = parseIngredientLine('2 3 musketeers');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(2);
      expect(r!.name.toLowerCase()).toContain('musketeers');
    });

    test('"3musketeers" (no-space form) -> qty 1, token not split', () => {
      const r = parseIngredientLine('3musketeers');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(1);
      expect(r!.name.toLowerCase()).toBe('3musketeers');
    });
  });

  describe('generic digit-leading parsing is NOT broken', () => {
    test('"2 eggs" -> qty 2', () => {
      const r = parseIngredientLine('2 eggs');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(2);
      expect(r!.name.toLowerCase()).toContain('egg');
    });

    test('"7 almonds" -> qty 7 (digit + separate word stays a count)', () => {
      const r = parseIngredientLine('7 almonds');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(7);
      expect(r!.name.toLowerCase()).toContain('almond');
    });

    test('"200g chicken breast" -> number+unit token still splits', () => {
      const r = parseIngredientLine('200g chicken breast');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(200);
      expect(r!.unit).toBe('g');
      expect(r!.name.toLowerCase()).toContain('chicken');
    });

    test('"2-3 eggs" -> range averaging still works', () => {
      const r = parseIngredientLine('2-3 eggs');
      expect(r).not.toBeNull();
      expect(r!.qty).toBeCloseTo(2.5);
    });

    test('"7 oz chicken" -> qty 7 with mass unit', () => {
      const r = parseIngredientLine('7 oz chicken');
      expect(r).not.toBeNull();
      expect(r!.qty).toBe(7);
      expect(r!.unit).toBe('oz');
    });
  });

  // Deliberately deferred (documented, not implemented):
  // - Word-number brand forms ("seven up") still parse "seven" as qty 7. The
  //   word-number map predates this fix and "seven up" is a rare way to log
  //   the soda; claiming it would special-case the WORD_NUMBERS path for one
  //   brand. Revisit if telemetry ever shows real "seven up" logs.
  test.skip('"seven up" word-number form (deferred — see comment above)', () => {
    const r = parseIngredientLine('seven up');
    expect(r!.qty).toBe(1);
  });
});
