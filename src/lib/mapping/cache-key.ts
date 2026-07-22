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
 * Key-symmetry fix (Track 1c, Jul 2026): read and write paths previously
 * diverged because the brand-prefix step lived OUTSIDE this module, at the
 * save site only, guarded by a substring includes() that singularization
 * defeats ("oikos" not a substring of the canonical token "oiko" → write key
 * "oiko oiko" while reads derived "oiko" — a permanently dead row). The full
 * key derivation, INCLUDING the brand-prefix decision, now lives in
 * deriveMappingCacheKey below, used verbatim at EXACTLY three sites in
 * map-ingredient-with-fallback.ts, computed at each site (so the AI-normalize
 * replacement path is reflected):
 *   - early cache lookup
 *   - step-1c normalized-cache lookup
 *   - Step-6 save key
 * All three pass the request-stable brandDetection (static detector +
 * options.brand, computed once before the early lookup) — NOT the AI-mutable
 * isBrandedQuery flag, which doesn't exist yet at early-lookup time.
 * Retrieval queries, baseName, and rerank input are deliberately NOT touched:
 * this is a cache-key-only concern.
 *
 * Kill-switch: CACHE_KEY_DISCRIMINATORS === '0' → plain canonicalizeCacheKey
 * (discriminators only; the brand step and dup-token guard always apply).
 */

import { canonicalizeCacheKey } from './normalization-rules';
import { hasDecisiveBrandContext } from './simple-rerank';
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

/**
 * Brand-detection shape consumed by deriveMappingCacheKey. Matches the
 * request-stable brandDetection object built in map-ingredient-with-fallback
 * (static detector result merged with options.brand).
 */
export interface BrandKeyInput {
  isBranded: boolean;
  matchedBrand?: string | null;
}

/**
 * Collapse adjacent duplicate tokens in a key ("oiko oiko" → "oiko").
 *
 * canonicalizeCacheKey sorts tokens, so in canonical space ALL duplicate
 * tokens are adjacent — collapsing adjacent runs is a full dedupe. Exported
 * for the malformed-key cleanup script (scripts/fix-malformed-cache-keys.ts),
 * which uses collapsed !== original as its malformation predicate.
 */
export function collapseAdjacentDuplicateTokens(key: string): string {
  const out: string[] = [];
  for (const token of key.split(/\s+/)) {
    if (token.length === 0) continue;
    if (out.length > 0 && out[out.length - 1] === token) continue;
    out.push(token);
  }
  return out.join(' ');
}

/**
 * True when a stored/derived cache key is malformed: it carries the same
 * token (or token stem) twice. Canonical keys are token-sorted, so after
 * re-canonicalizing, ALL duplicate stems sit adjacent — one adjacency scan is
 * a full dup check, and it also catches legacy unsorted keys and
 * plural/singular doubled brands ("oiko oikos").
 *
 * Shared by the legacy-key read fallback in map-ingredient-with-fallback.ts
 * (a malformed legacy key must never be looked up — zombie rows stay dead)
 * and scripts/fix-malformed-cache-keys.ts (the deletion predicate).
 */
export function isMalformedCacheKey(key: string): boolean {
  const normalizedWhitespace = key.split(/\s+/).filter(t => t.length > 0).join(' ');
  if (collapseAdjacentDuplicateTokens(key) !== normalizedWhitespace) return true;
  const canonical = canonicalizeCacheKey(key);
  return collapseAdjacentDuplicateTokens(canonical) !== canonical;
}

/**
 * THE cache key for FoodMapping reads AND writes — the single shared
 * derivation (Track 1c). Pure function of (normalizedName, parsed,
 * brandDetection, rawLine); no I/O, no side effects.
 *
 * Steps:
 *   1. deriveCacheKeyName — canonicalize + identity discriminators (above).
 *   2. Brand prefix — when the query DECISIVELY names a brand, prepend it so
 *      branded picks don't collide with generic cache rows ("met rx protein
 *      bar" vs "protein bar"). Two guards, both required:
 *
 *      a. DECISIVENESS (hasDecisiveBrandContext — the same definition the
 *         brand-mismatch save gate and rerank use): a multi-word brand counts
 *         only as its full detected phrase; a single-word brand counts only
 *         when it sits next to a product-form token in the raw line. This is
 *         what keeps false-positive lexicon hits from mutating keys: the
 *         lexicon's bare "bell" entry (Bell & Evans) matches the 1-gram scan
 *         for "bell pepper", and once AI normalize rewrote the name to
 *         "capsicum" an unconditional prefix produced read/write key
 *         "bell capsicum" — orphaning the live human-triage "capsicum" row
 *         (golden n-mq-30). Non-decisive brand hits must never alter the key.
 *
 *      b. PRESENCE, by CANONICALIZED TOKEN STEMS, not substring includes():
 *         the brand is already represented when any token of the key
 *         stem-matches any token of the brand, so "oikos" (stem "oiko")
 *         against key "greek oiko yogurt" correctly skips — the old
 *         `key.includes('oikos')` check was defeated by singularization and
 *         doubled the brand instead ("oiko oiko").
 *
 *   3. Final canonicalize (sorts the prefix into place, singularizes it) +
 *      adjacent-dup-token collapse, so no composed key can ever carry the
 *      same token twice — regardless of what AI normalize handed us as
 *      normalizedName ("canned canned kidney beans" class).
 *
 * Idempotent: feeding a derived key back in as normalizedName (with the same
 * brandDetection/rawLine) returns the identical key — required so a row
 * saved under key K is found by any later query that derives K.
 */
export function deriveMappingCacheKey(
  normalizedName: string,
  parsed: ParsedIngredient | null | undefined,
  brandDetection?: BrandKeyInput | null,
  rawLine?: string
): string {
  const base = deriveCacheKeyName(normalizedName, parsed);

  let composed = base;
  const brand = brandDetection?.isBranded
    ? brandDetection.matchedBrand?.trim().toLowerCase()
    : undefined;
  if (brand && hasDecisiveBrandContext(rawLine ?? normalizedName, brand)) {
    const keyTokens = new Set(base.split(/\s+/).filter(t => t.length > 0));
    const brandTokens = canonicalizeCacheKey(brand)
      .split(/\s+/)
      .filter(t => t.length > 0);
    const brandAlreadyPresent =
      brandTokens.length > 0 && brandTokens.some(bt => keyTokens.has(bt));
    if (brandTokens.length > 0 && !brandAlreadyPresent) {
      composed = `${brand} ${base}`;
    }
  }

  return collapseAdjacentDuplicateTokens(canonicalizeCacheKey(composed));
}
