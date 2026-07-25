/**
 * cache-key-core.ts — the LEAF half of the cache-key derivation.
 *
 * Split out of cache-key.ts (2026-07-25) with ZERO behaviour change: the
 * functions below are moved verbatim and re-exported from cache-key.ts, so every
 * existing importer is unaffected.
 *
 * WHY THE SPLIT EXISTS. cache-key.ts needs `hasDecisiveBrandContext` for the
 * brand-prefix step, and that lives in simple-rerank — whose import graph reaches
 * `src/lib/mapping/config.ts` (which SNAPSHOTS `FATSECRET_RETRIEVAL_ENABLED` into
 * a const at module load) and `gather-candidates` (module-scope embedder warmup).
 * The read-only eval tooling (scripts/eval/failure-classes.ts and its consumers
 * classify-drops.ts / triage-drops.ts) must derive the SAME key as the pipeline,
 * but it MUST NOT load config.ts: triage-drops sets
 * `FATSECRET_RETRIEVAL_ENABLED=false` before it requires the probe modules, and a
 * config.ts already resident from a top-level import would defeat that — turning a
 * SELECT-only run into one that spends FatSecret quota and upserts FatSecretFood
 * rows. So the two steps a funnel row CAN reproduce (identity discriminators and
 * the adjacent-dup collapse) live here, where the graph is
 * normalization-rules + parse/qualifiers and nothing else.
 *
 * Anything needing the brand-prefix step must import from ./cache-key.
 */

import { canonicalizeCacheKey } from './normalization-rules';
import { IDENTITY_QUALIFIERS } from '../parse/qualifiers';
import type { ParsedIngredient } from '../parse/ingredient-line';

// Unit hints that name a distinct food part (egg white vs yolk vs whole egg).
// Piece-like hints (leaf, clove, slice, ...) are serving concerns, not identity.
export const IDENTITY_UNIT_HINTS = new Set(['white', 'yolk']);

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
