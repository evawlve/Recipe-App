/**
 * seg-line-key.ts — canonicalizer for SegmentationCache lookup keys.
 *
 * Maps a raw magic-log line to the key under which its AI segmentation result
 * is cached (model SegmentationCache, keyed [lineKey, parserVersion]).
 *
 * Deliberately CONSERVATIVE: only normalizations that cannot change what the
 * segmenter would return are applied —
 *   - lowercase
 *   - collapse internal whitespace runs (incl. tabs/newlines) to one space
 *   - trim
 *   - strip TRAILING punctuation ("2 eggs and toast." == "2 eggs and toast")
 *
 * Digits and quantities are load-bearing and are NEVER touched:
 * "2 eggs and toast" and "3 eggs and toast" MUST produce different keys.
 * Internal punctuation is also preserved — commas/semicolons are list
 * separators the segmenter splits on ("eggs, toast" != "eggs toast").
 */

/** Trailing punctuation that never carries meaning at end-of-line. */
const TRAILING_PUNCT = /[.,;:!?]+$/;

export function canonicalizeSegLine(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TRAILING_PUNCT, '')
    .trim();
}
