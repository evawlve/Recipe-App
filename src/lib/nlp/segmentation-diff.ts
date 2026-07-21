/**
 * segmentation-diff.ts — pure diff core for the seg-replay drift defense
 * (scripts/seg-replay-diff.ts). Lives under src/ so jest covers it.
 *
 * Compares a cached segmentation against a fresh AI re-run on two axes:
 *   1. item COUNT — a count change is always drift (split semantics moved);
 *   2. normalized item NAMES — compared as a multiset (order-insensitive:
 *      the LLM re-ordering "eggs, toast" → toast-first is not drift; the
 *      mapper handles items independently).
 *
 * Names are taken from normalizedForm (the mapper's food-name input) and
 * fall back to rawText when the model left normalizedForm empty. Grams/
 * quantities are NOT diffed here — quantity resolution is deterministic
 * downstream of segmentation (parseIngredientLine), so segment-name parity
 * implies billing parity.
 */

import { SegmentedItem } from './ai-segmenter';

/** Same conservative normalization family as seg-line-key: case/whitespace only. */
export function normalizeSegName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Normalized comparison names for a segmentation, sorted (multiset form). */
export function segmentNames(items: SegmentedItem[]): string[] {
  return items
    .map((it) => normalizeSegName(it.normalizedForm.trim() !== '' ? it.normalizedForm : it.rawText))
    .sort();
}

export interface SegDiffResult {
  /** True when count and name multiset both match — no drift. */
  same: boolean;
  countChanged: boolean;
  cachedCount: number;
  freshCount: number;
  /** Names present in the cached split but missing from the fresh one. */
  onlyCached: string[];
  /** Names present in the fresh split but missing from the cached one. */
  onlyFresh: string[];
}

export function diffSegments(cached: SegmentedItem[], fresh: SegmentedItem[]): SegDiffResult {
  const cachedNames = segmentNames(cached);
  const freshNames = segmentNames(fresh);

  // Multiset difference: consume matches pairwise so duplicates count.
  const freshPool = [...freshNames];
  const onlyCached: string[] = [];
  for (const name of cachedNames) {
    const idx = freshPool.indexOf(name);
    if (idx === -1) {
      onlyCached.push(name);
    } else {
      freshPool.splice(idx, 1);
    }
  }
  const onlyFresh = freshPool;

  const countChanged = cached.length !== fresh.length;
  return {
    same: !countChanged && onlyCached.length === 0 && onlyFresh.length === 0,
    countChanged,
    cachedCount: cached.length,
    freshCount: fresh.length,
    onlyCached,
    onlyFresh,
  };
}
