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

// The #242 shape on a commoner word: `egg`/`eggs` leading a unit-less line is
// almost always an ADJECTIVE naming a product (16 of the 17 `egg `-leading
// corpus seeds), and eating it as a count unit billed ~50 g whatever the food
// was AND dropped `egg` from the derived cache key. Gated by
// leadingEggIsAdjectival() at all three count-unit consumption sites; the
// egg-part lines (white/yolk) are exempt because their count-unit reading is
// load-bearing for the unit-hint machinery.
// Owner: sync-docs/reports/2026-08-09_egg-is-eaten-as-a-count-unit.md
describe('leading adjectival "egg" is not a count unit, egg parts excepted', () => {
  it.each([
    'egg noodles',
    'egg salad sandwich',
    'egg drop soup',
    'eggs benedict',
  ])('"%s" parses with no unit and the full name', (line) => {
    const p = parseIngredientLine(line)!;
    expect(p.unit).toBeNull();
    expect(p.name).toBe(line);
  });

  it('keeps egg in the derived key — the point of the fix', () => {
    expect(key('egg noodles')).not.toBe(key('noodles'));
    expect(key('egg noodles').split(/\s+/)).toContain('egg');
    expect(key('egg salad sandwich')).not.toBe(key('salad sandwich'));
    expect(key('egg salad sandwich').split(/\s+/)).toContain('egg');
  });

  it('qty-led spelling deliberately KEEPS the count reading, so the keys differ', () => {
    // Unlike #242, where `whole milk` and `1 cup whole milk` converge on one
    // key, `1 egg noodles` keeps `egg` as a count unit: a number at token [0]
    // means the user may genuinely be counting eggs ("2 egg omelette" is a
    // two-egg omelette), so leadingEggIsAdjectival() declines and the two
    // spellings derive DIFFERENT keys. Deliberate — do not "fix" this toward
    // the #242 convergence without re-measuring the qty-led population.
    expect(key('1 egg noodles')).not.toBe(key('egg noodles'));
  });

  // EXEMPTION — the egg-part lines keep the count-unit + unit-hint machinery
  // byte-identical. Suppressing the unit here would push these lines into the
  // token-side white-hint path (the "pasteurized egg whites" -> "pasteurized
  // white" misroute, a separate mechanism).
  it.each([
    ['egg whites', 'egg', 'white'],
    ['egg yolk', 'egg', 'yolk'],
  ])('"%s" keeps unit=egg, name=%s, hint=%s', (line, name, hint) => {
    const p = parseIngredientLine(line)!;
    expect(p.unit).toBe('egg');
    expect(p.name).toBe(name);
    expect(p.unitHint).toBe(hint);
  });

  it('egg white protein powder is unchanged', () => {
    const p = parseIngredientLine('egg white protein powder')!;
    expect(p.unit).toBe('egg');
    expect(p.unitHint).toBe('white');
    expect(p.name).toBe('protein powder');
  });

  // UNAFFECTED — an explicit qty puts a number at token [0], a bare token has
  // no second token, and a trailing `egg` never sits at [0]; all keep today's
  // reading (the blanket removal of egg from countUnits is refuted the same
  // way #242's was for `whole`).
  it.each([
    ['2 eggs', 2, 'egg'],
    ['1 egg', 1, 'egg'],
    ['egg', 1, 'egg'],
    ['eggs', 1, 'egg'],
    ['3 egg whites', 3, 'egg'],
  ])('"%s" keeps the count-unit reading', (line, qty, unit) => {
    const p = parseIngredientLine(line)!;
    expect(p.qty).toBeCloseTo(qty as number);
    expect(p.unit).toBe(unit);
  });

  it('whole egg stays on the count-unit route (the #242 negative control)', () => {
    expect(parseIngredientLine('whole egg')!.unit).toBe('whole');
  });

  it('trailing egg is untouched', () => {
    const p = parseIngredientLine('hard boiled egg')!;
    expect(p.unit).toBeNull();
    expect(p.name).toBe('hard boiled egg');
  });
});
