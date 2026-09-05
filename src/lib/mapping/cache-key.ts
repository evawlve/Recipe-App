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
import { deriveCacheKeyName, collapseAdjacentDuplicateTokens } from './cache-key-core';
import { stripPartitiveOfResidue } from './partitive-residue';
import type { ParsedIngredient } from '../parse/ingredient-line';

/**
 * Step 1 (identity discriminators) and step 3's dup-collapse live in
 * ./cache-key-core, which is import-leaf on purpose: the read-only eval tooling
 * (scripts/eval/failure-classes.ts) must derive the same key WITHOUT loading
 * simple-rerank -> ... -> src/lib/mapping/config.ts, which snapshots
 * FATSECRET_RETRIEVAL_ENABLED at module load. Re-exported here so this module
 * stays the one public surface for cache keys.
 */
export { deriveCacheKeyName, collapseAdjacentDuplicateTokens, IDENTITY_UNIT_HINTS } from './cache-key-core';

/**
 * Step 0's partitive-residue strip (LANE S). Lives in ./partitive-residue —
 * import-leaf by contract, ZERO imports — so read-only eval tooling can load
 * it without transitively warming config.ts (the same leaf-safety rule as
 * cache-key-core above). Re-exported here so this module stays the one public
 * surface for cache keys.
 */
export { stripPartitiveOfResidue } from './partitive-residue';

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
 *   0. stripPartitiveOfResidue — drop a single partitive-`of` residue from the
 *      NAME's edge (never mid-string; scope decision documented in
 *      ./partitive-residue). The key-site half of the parser's #350 skip: the
 *      ai-normalize replacement path re-introduces the residue AFTER the
 *      parser consumed it ("1 cup of rolled oats" -> normalizedForm
 *      "of rolled rolled oats" -> key "oat of rolled" instead of
 *      "oat rolled"). Deliberately NOT behind CACHE_KEY_DISCRIMINATORS — that
 *      kill-switch owns identity discriminators only.
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
 *         (golden n-mq-30). Non-decisive brand hits must never alter the key
 *         via the PREFIX; on the composite path the NAME itself may carry a
 *         brand the segmenter named and the mapper re-asserted after the
 *         normalizer (`brandReassertEvidence()`, 2026-09-05) — that is the
 *         name, not this prefix, and it stays a token of the sorted key.
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
 * Idempotence holds in NAME space: re-deriving from the same ingredient NAME
 * (same brandDetection/rawLine) returns the identical key, so a row saved
 * under key K is found by any later query that derives K. Feeding a derived
 * KEY back in as normalizedName is no longer always a fixed point:
 * canonicalizeCacheKey token-sorts with no stopword list, so a mid-`of` name
 * can sort its `of` to an edge ("leg of lamb" -> key "lamb leg of"), and
 * step 0 would strip that edge `of` if the KEY re-entered as a name
 * ("lamb leg"). No pipeline path feeds a derived key back in as a name — keys
 * re-enter only via canonicalizeCacheKey/isMalformedCacheKey (the legacy-key
 * read fallback and the malformed-key predicate), both untouched by step 0 —
 * and __tests__/partitive-residue.test.ts pins the exception.
 */
export function deriveMappingCacheKey(
  normalizedName: string,
  parsed: ParsedIngredient | null | undefined,
  brandDetection?: BrandKeyInput | null,
  rawLine?: string
): string {
  // Step 0 (LANE S): partitive-residue strip — see the doc block above.
  const cleaned = stripPartitiveOfResidue(normalizedName);
  const base = deriveCacheKeyName(cleaned, parsed);

  let composed = base;
  const brand = brandDetection?.isBranded
    ? brandDetection.matchedBrand?.trim().toLowerCase()
    : undefined;
  if (brand && hasDecisiveBrandContext(rawLine ?? cleaned, brand)) {
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
