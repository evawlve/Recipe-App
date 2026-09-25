/**
 * The label a browse-list serving option DISPLAYS, from a record's raw serving
 * string. Display only — see "WHAT THIS DOES NOT TOUCH" below.
 *
 * THE SHAPE. Some Open Food Facts records carry a `serving_size` whose unit
 * position holds a second bare number instead of a word: `4 4.0 (112 g)`,
 * `4 1 (112 g)`, `1 1 (100 g)`, `1 100 (100 g)`. The upstream household unit
 * was lost before the string reached OFF, and `ingest-off` stores the string
 * verbatim in `OffFood.servingSize`. `/api/foods/search`'s corpus lane used to
 * ship it as the option label as-is, and the logging screen rendered
 * `1 × 4 4.0 (112 g)` (punch #298: `off_0260664307833`, `off_0200947019732`,
 * query `Rosterrie chicken`).
 *
 * THE ANSWER IS `1 serving (<the record's own parenthetical>)`, because the only
 * thing such a label states is the weight of one label serving — and that weight
 * is exactly what the option's `grams` already carries (`servingGrams`). The
 * leading number cannot be kept: `4 (112 g)` reads as a count of four, which
 * the label never establishes. `1 serving` is the codebase's existing spelling
 * for "a label serving whose unit we cannot read": `normalizeServingDescription()`
 * in `src/lib/openfoodfacts/serving-resolver.ts` reduces a bare gram string to
 * it, and `resolveFoodDetails()` in `src/lib/nlp/resolve-payload.ts` falls back
 * to it for an OFF record with no `servingSize`. The parenthetical is kept
 * VERBATIM so the label changes nothing it can already say.
 *
 * WHAT THIS DOES NOT TOUCH. The mapper reads the same raw string off
 * `candidate.rawData.servingSize` and `OffFood.servingSize`, never through this
 * function, and nothing under `src/lib` imports it — so no billed gram and no
 * mapping decision can move. (Reasoned, and why it is also harmless there: the
 * mapper's `extractLabelServingUnit()` returns null on this shape, and every
 * per-piece and label-unit branch in `buildOffResult()` requires a non-null
 * unit word.) The parse lane's labels (`resolve-payload.ts`) are a separate
 * emitter, deliberately left alone here: the logging card matches `item.unit`
 * against those labels, so changing them is a wire-contract change of its own.
 *
 * POPULATION (MEASURED on the box 2026-09-24, SELECT only): 1,382 `OffFood` rows
 * over 560 distinct strings carry this shape, 1,144 of them searchable
 * (`duplicateOfBarcode` and `corruptReason` both null), and 0 `FdcServing` /
 * 0 `FatSecretServing` rows do. Re-derive:
 *   SELECT count(*) FROM "OffFood"
 *   WHERE "servingSize" ~ '^\s*[0-9]+(\.[0-9]+)?\s+[0-9]+(\.[0-9]+)?\s*(\(.*\))?\s*$';
 *
 * NOT this shape, deliberately: a mixed fraction (`1 1/2 cup` — the second token
 * carries a `/`) and a quantity-plus-measure (`1 4 oz (112 g)`, `4 1 piece
 * (112 g)` — a unit word follows the second number). Those still say something
 * a reader can use and pass through unchanged.
 *
 * THE PARENTHETICAL MUST BE A PLAIN `g` OR `ml` WEIGHT (or absent). Anything
 * else — `2 2 (2 slices, 56 g)`, `15 1 (15 fl oz)`, `0.25 1 (0.25 cup)` — passes
 * through unchanged, because the mobile pick reads the label's LEADING number:
 * `search-pick.ts` matches a typed unit word INTO the label and, when the label
 * states the same amount the user typed, bills one serving (#254). Dropping the
 * leading `2` from `2 2 (2 slices, 56 g)` would turn "2 slices" into 2 × 56 g.
 * A `g`/`ml` parenthetical carries no count word a user types, so the rewrite
 * cannot reach that rule. Measured 2026-09-24 over the 1,382 rows above: 1,311
 * `g` + 54 `ml` parentheticals are rewritten; 8 `oz`, 1 `cup` and 6 whose
 * parenthetical is not a single weight stay as they are.
 */
const NUMERIC_UNIT_LABEL_RE =
  /^\s*\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s*(\(\s*\d+(?:\.\d+)?\s*(?:g|ml)\s*\))?\s*$/i;

export function displayServingLabel(label: string): string {
  const m = label.match(NUMERIC_UNIT_LABEL_RE);
  if (!m) return label;
  return m[1] ? `1 serving ${m[1]}` : '1 serving';
}
