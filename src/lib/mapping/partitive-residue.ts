/**
 * stripPartitiveOfResidue — the key-site half of the partitive-`of` rule.
 *
 * Owner of the RULE: consumePartitiveOf() in src/lib/parse/ingredient-line.ts (unexported; its
 * whole directory is a FROZEN_INPUT_PATHS member, so it can never be exported or imported from
 * here — winner-gate exit 3). This module re-expresses the rule for the STRING input the mapping
 * key site sees (the LLM's normalizedForm / a parsed name). Parity is pinned by
 * src/lib/mapping/__tests__/partitive-parity.test.ts, which drives the exported
 * parseIngredientLine() end-to-end — if either implementation drifts, that test reds.
 *
 * Scope (plan 8 D1(c'), Diego, 2026-08-20): EDGE `of` only.
 *   leading:  "of spinach" -> "spinach"   (the parser rule with the consumed unit now absent)
 *   trailing: "garlic of"  -> "garlic"    (generalizes the follower guard: never keep a
 *                                          dangling partitive at the edge)
 *   AT MOST ONE drop per call ("of of salt" -> "of salt"), mirroring the parser's
 *   at-most-one-consumption guard so "cream of wheat"-class names survive.
 *   Never empties: "of" alone and mid-string `of` ("cream of wheat", "firm of tofu") return
 *   unchanged. Mid-`of` is deliberately OUT of scope: no lexicon separates "firm of tofu"
 *   from "cream of wheat", and the parser keeps both.
 *
 * TWO-SITE COMPOSITION: the pipeline applies this once at preflight (baseName) and once
 * inside deriveMappingCacheKey (step 0), so a double-edge input like "of of salt" yields
 * query "of salt" but key "salt" — a query/key divergence confined to a class with ZERO
 * observed forms in 148,643 MappingEventLog rows (measured 2026-08-20). Each single call
 * still drops AT MOST ONE token.
 *
 * IMPORT-LEAF CONTRACT: this file imports NOTHING. Read-only eval tooling imports it directly;
 * importing cache-key.ts instead would transitively load config.ts (env snapshot + ONNX warm).
 */
export function stripPartitiveOfResidue(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return name;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 2) return name;
  if (tokens[0].toLowerCase() === 'of') return tokens.slice(1).join(' ');
  if (tokens[tokens.length - 1].toLowerCase() === 'of') return tokens.slice(0, -1).join(' ');
  return name;
}
