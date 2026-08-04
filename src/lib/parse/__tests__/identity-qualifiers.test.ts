/**
 * IDENTITY_QUALIFIERS — the half of the cooking-state fix that lives in the parser.
 *
 * Two strippers exist with DISJOINT token sets, which is why single-lever fixes
 * kept missing the collision:
 *
 *   - raw / dried / canned  — captured by extractQualifiers() into
 *     parsed.qualifiers, then DROPPED at the key because they were not
 *     whitelisted. Fixed here, by the whitelist. Guarded below.
 *   - grilled / scrambled / steamed / ... — never captured at all (absent from
 *     QUALIFIERS), stripped later by prep_phrases. Fixed there, and guarded in
 *     mapping/__tests__/normalization-rules{,-static-only}.test.ts.
 *
 * Owner: sync-docs/reports/2026-08-01_cooking-state-key-collision.md
 */

import { parseIngredientLine } from '../ingredient-line';
import { IDENTITY_QUALIFIERS, isQualifier } from '../qualifiers';
import { normalizeIngredientName } from '../../mapping/normalization-rules';
import { deriveCacheKeyName } from '../../mapping/cache-key-core';

/** The production path: parse -> normalize -> derive key. */
const key = (line: string): string => {
  const parsed = parseIngredientLine(line);
  if (!parsed) throw new Error(`parseIngredientLine returned null for "${line}"`);
  return deriveCacheKeyName(normalizeIngredientName(parsed.name).cleaned, parsed);
};

describe('IDENTITY_QUALIFIERS keeps state off the bare generic key', () => {
  const cases = [
    { stated: 'raw chicken', bare: 'chicken', token: 'raw' },
    { stated: 'dried apricots', bare: 'apricots', token: 'dried' },
    { stated: 'canned tuna', bare: 'tuna', token: 'canned' },
    { stated: 'cooked rice', bare: 'rice', token: 'cooked' },
  ];

  cases.forEach(({ stated, bare, token }) => {
    it(`"${stated}" does not share a key with "${bare}"`, () => {
      // Non-vacuity: the token must actually be CAPTURED as a qualifier, or
      // this passes for the wrong reason (the word surviving in the name).
      expect(isQualifier(token)).toBe(true);
      expect(parseIngredientLine(stated)!.qualifiers).toContain(token);

      expect(IDENTITY_QUALIFIERS.has(token)).toBe(true);
      expect(key(stated)).not.toBe(key(bare));
      expect(key(stated).split(/\s+/)).toContain(token);
    });
  });

  it('leaves the bare line untouched, so existing rows keep serving it', () => {
    // The reason the fix needs no migration: only the modifier-bearing key moves.
    expect(key('chicken')).toBe('chicken');
    expect(key('rice')).toBe('rice');
    expect(key('tuna')).toBe('tuna');
  });

  it('does NOT split on prep or size, which leave the panel basis alone', () => {
    expect(key('diced onion')).toBe(key('onion'));
    expect(key('large egg')).toBe(key('egg'));
  });

  // This block was `KNOWN GAP: "whole" is consumed as a unit, so whole milk
  // still collides` — a test that deliberately pinned the broken behaviour.
  // Fixed by gating the parser's count-unit consumption on the `whole` half of
  // PROTECTED_PRODUCT_PHRASES; the assertions below are the same three, flipped.
  describe('"whole" reaches the key on identity phrases, and only those', () => {
    it('splits whole milk off bare milk', () => {
      expect(IDENTITY_QUALIFIERS.has('whole')).toBe(true);
      expect(parseIngredientLine('whole milk')!.qualifiers ?? []).toContain('whole');
      expect(key('whole milk')).not.toBe(key('milk'));
    });

    it('agrees with the unit-led spelling of the same food', () => {
      // The collision this fix closes has a second half nobody had written down:
      // `whole milk` and `1 cup whole milk` derived DIFFERENT keys, because a
      // preceding unit token left `whole` in the name. They must now agree.
      expect(key('whole milk')).toBe(key('1 cup whole milk'));
    });

    it.each([
      ['whole wheat bread', 'wheat bread'],
      ['whole wheat pasta', 'wheat pasta'],
      ['whole grain oats', 'grain oats'],
    ])('splits %s off %s', (identity, bare) => {
      expect(key(identity)).not.toBe(key(bare));
      expect(parseIngredientLine(identity)!.qualifiers ?? []).toContain('whole');
    });

    // NEGATIVE CONTROLS — the reason this fix is gated rather than blanket.
    // `whole` is a portion word here, and dropping it as a unit would lose the
    // serving size: a banana bills 118 g and a whole egg 50 g through the count
    // estimator. The blanket fix (removing `whole` from countUnits in unit.ts)
    // regresses all three of these; measured 2026-08-04.
    it.each([
      '1 whole organic banana',
      'whole egg',
      '2 whole eggs',
      'whole pita bread',
      'whole chicken',
      'whole almonds',
    ])('keeps %s on the count-unit route', (line) => {
      const parsed = parseIngredientLine(line)!;
      expect(parsed.unit).toBe('whole');
      expect(parsed.qualifiers ?? []).not.toContain('whole');
    });

    it('keeps the whole-egg base key, which n-mq-33 depends on', () => {
      expect(key('whole egg')).toBe(key('egg'));
    });
  });
});
