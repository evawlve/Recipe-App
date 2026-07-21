/**
 * Identity-preserving cache key derivation (PR D pt3, Lever C).
 *
 * The plain canonicalizeCacheKey(normalizedName) collapses identity-distinct
 * senses onto one key: "3 egg whites" parses to name "egg" (unitHint "white"),
 * "whole milk" parses to name "milk" (qualifier "whole") — so egg whites and
 * whole eggs (or whole milk and skim-adjacent generic milk) fight over the
 * same ValidatedMapping row. This helper re-attaches a tiny whitelist of
 * identity discriminators the parser already retains (ingredient-line.ts
 * qualifier/unit-hint extraction) before canonicalizing.
 *
 * Used at EXACTLY three sites in map-ingredient-with-fallback.ts, computed at
 * each site (so the AI-normalize replacement path is reflected):
 *   - :570  early cache lookup
 *   - :953  step-1c normalized-cache lookup
 *   - :2206 save key
 * The wire-in (3-site key swap) is a separately sequenced step — this module
 * ships first with no callers. Retrieval queries, baseName, and rerank input
 * are deliberately NOT touched: this is a cache-key-only concern.
 *
 * Kill-switch: CACHE_KEY_DISCRIMINATORS === '0' → plain canonicalizeCacheKey.
 */

import { canonicalizeCacheKey } from './normalization-rules';
import { IDENTITY_QUALIFIERS } from '../parse/qualifiers';
import type { ParsedIngredient } from '../parse/ingredient-line';

// Unit hints that name a distinct food part (egg white vs yolk vs whole egg).
// Piece-like hints (leaf, clove, slice, ...) are serving concerns, not identity.
const IDENTITY_UNIT_HINTS = new Set(['white', 'yolk']);

/**
 * Derive the ValidatedMapping cache key for a normalized ingredient name,
 * appending whitelisted identity discriminators from the parsed line.
 *
 * Pure function — no I/O, no side effects.
 *
 * Dedupe note (verified required): canonicalizeCacheKey lowercases,
 * singularizes, and sorts but does NOT dedupe tokens, so "whole milk" with a
 * re-attached "whole" qualifier would become "milk whole whole" without the
 * set-dedupe here. Dedupe compares in canonical (singularized) space so
 * "egg whites" + hint "white" also collapses correctly.
 */
export function deriveCacheKeyName(
  normalizedName: string,
  parsed: ParsedIngredient | null | undefined
): string {
  if (process.env.CACHE_KEY_DISCRIMINATORS === '0') {
    return canonicalizeCacheKey(normalizedName);
  }

  if (!parsed) {
    return canonicalizeCacheKey(normalizedName);
  }

  const discriminators: string[] = [];

  if (parsed.unitHint && IDENTITY_UNIT_HINTS.has(parsed.unitHint.toLowerCase())) {
    discriminators.push(parsed.unitHint.toLowerCase());
  }

  for (const qualifier of parsed.qualifiers ?? []) {
    const lower = qualifier.toLowerCase();
    if (IDENTITY_QUALIFIERS.has(lower)) {
      discriminators.push(lower);
    }
  }

  if (discriminators.length === 0) {
    return canonicalizeCacheKey(normalizedName);
  }

  // Set-dedupe BEFORE the final canonicalize call, comparing tokens in
  // canonical form so plural/singular variants ("whites" vs "white") and
  // already-present qualifiers ("whole milk" + "whole") don't duplicate.
  const seen = new Set(
    normalizedName
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 0)
      .map(t => canonicalizeCacheKey(t))
  );

  const appended: string[] = [];
  for (const discriminator of discriminators) {
    const canonical = canonicalizeCacheKey(discriminator);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    appended.push(discriminator);
  }

  if (appended.length === 0) {
    return canonicalizeCacheKey(normalizedName);
  }

  return canonicalizeCacheKey(`${normalizedName} ${appended.join(' ')}`);
}
