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

  it('KNOWN GAP: "whole" is consumed as a unit, so whole milk still collides', () => {
    // 'whole' is in IDENTITY_QUALIFIERS and the comment there claims it keeps
    // "whole milk" off "milk". It does not: src/lib/parse/unit.ts maps
    // 'whole' as a UNIT, so it never reaches parsed.qualifiers. Suspected cause
    // of golden n-mq-34 ("whole milk" -> "Milk" at fat100 1.3, i.e. skim).
    // Deliberately NOT fixed with the cooking-state change — it runs through
    // serving sizes. This test documents the gap; when it is fixed this
    // assertion flips to .not.toBe and the comment in qualifiers.ts comes out.
    expect(IDENTITY_QUALIFIERS.has('whole')).toBe(true);
    expect(parseIngredientLine('whole milk')!.qualifiers ?? []).not.toContain('whole');
    expect(key('whole milk')).toBe(key('milk'));
  });
});
