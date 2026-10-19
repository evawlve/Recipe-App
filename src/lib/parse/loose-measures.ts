/**
 * loose-measures.ts - "a swig / gulp / sip / splash / drizzle of X" is a fluid-ounce measure.
 *
 * S202 design (row 5 = 8(g), design r2). The pour words are not units in normalizeUnitToken(), so
 * `a swig of soda` kept the whole phrase as the name (qty 1, no unit) and `2 swigs of soda` became
 * an unknown count unit; either way the mapper billed the record's default serving (369 g of soda
 * for one swig). The rewrite turns a LEADING `<count> <pour> of <food>` into canonical
 * `<n> floz of <food>`, a unit every downstream volume table already knows, so no new unit word
 * reaches serving code.
 *
 * The five amounts are CONVENTIONS, not measurements: swig 1.5 fl oz, gulp 1 fl oz, sip 0.5 fl oz,
 * splash 0.5 fl oz, drizzle 0.5 fl oz (about 1 tbsp).
 *
 * POSITIONAL: only at the line start, only with a count, the partitive `of`, and a letter or digit
 * after it. `a v8 splash`, `big gulp`, `splash of milk`, `a swig sugar cookie` and `a splash` stay
 * untouched. Known gaps: a non-leading pour (`had a swig of soda`), hedged pours (`half a splash`),
 * `one and a half swigs`, `a light drizzle of honey`, and a drizzle with no count.
 *
 * TWO JOBS, ONE FILE (C70 S239). POUR_RX is the LIQUID-ONLY class: it feeds the fl-oz rewrite
 * (resolveLoosePourMeasures / splitLeadingPour) and nothing else may widen it, because a sprinkle of
 * parmesan or a pat of butter is not fluid ounces (LOOSE_POUR_FLOZ has no entry for those words).
 * TOPPING_RX is the ROUTING class: POUR_RX's shape with the third group widened by solid topping
 * measures (spoonful, sprinkle, dollop, pat, smear, dash, pinch, dab, knob, squirt, squeeze, swirl;
 * NOT scoop - a main-food measure - and not handful). It feeds only isPourOntoSecondFood() (skip the
 * single-item shortcut so the second food survives) and restoreLeadingPour() (put the measure back on
 * the topping after a split). The restored segment bills as the standalone line does today.
 *
 * Mobile parity: SHORT_LINE_POUR_RX in the mobile repo's src/lib/magic-flow-timing.ts mirrors this
 * regex for a cosmetic chip animation; it lags until the device day (MGR 2026-10-19), and by the
 * TOPPING_RX words besides - the mismatch is cosmetic only.
 */

export const LOOSE_POUR_FLOZ: Record<string, number> = { swig: 1.5, gulp: 1, sip: 0.5, splash: 0.5, drizzle: 0.5 };

const WORD_COUNTS: Record<string, number> = {
  a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const POUR_RX = new RegExp(
  '^(\\s*)' +
    '(a|one|two|three|four|five|six|seven|eight|nine|ten|\\d+ \\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?)' +
    '\\s+(swigs?|gulps?|sips?|splash(?:es)?|drizzles?)\\s+of\\s+(?=[\\p{L}\\d])',
  'iu',
);

// ROUTING class (see the header): the pour words plus solid topping measures. Never used for the fl-oz rewrite.
const TOPPING_RX = new RegExp(
  '^(\\s*)' +
    '(a|one|two|three|four|five|six|seven|eight|nine|ten|\\d+ \\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?)' +
    '\\s+(swigs?|gulps?|sips?|splash(?:es)?|drizzles?|' +
    'spoonfuls?|teaspoonfuls?|tablespoonfuls?|sprinkles?|dollops?|pats?|smears?|dash(?:es)?|pinch(?:es)?|' +
    'dabs?|knobs?|squirts?|squeezes?|swirls?)\\s+of\\s+(?=[\\p{L}\\d])',
  'iu',
);

export interface LeadingPour {
  count: number;
  /** Singular lowercase pour word. */
  word: string;
  /** The text after `of `. */
  rest: string;
  /** Leading whitespace of the input, kept by the rewrite. */
  lead: string;
}

function countValue(token: string): number {
  const t = token.toLowerCase();
  if (WORD_COUNTS[t] !== undefined) return WORD_COUNTS[t];
  const mixed = /^(\d+) (\d+)\/(\d+)$/.exec(t);
  if (mixed) return Number(mixed[2]) > 0 && Number(mixed[3]) > 0 ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) : NaN;
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return Number(frac[2]) > 0 ? Number(frac[1]) / Number(frac[2]) : NaN;
  return Number(t);
}

function singular(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith('shes')) return w.slice(0, -2);
  return w.endsWith('s') ? w.slice(0, -1) : w;
}

// S202 (cloud-35 F9): a pour ONTO or INTO another food names two foods
// (`a splash of syrup on pancakes`, `a splash of rum in my coke`). The object is a bare or
// possessive noun; an article-led object (`in a glass`, `in the morning`, `on the side`) and a
// pronoun / `top` object are not a second food.
const POUR_VEHICLE_RX =
  /\s(?:on|onto|over|in|into)\s+(?!(?:(?:my|your|his|her|our|their)\s+)?(?:a|an|the|top|it|them|there|this|that|pan|pot|skillet|wok|bowl|cup|mug|glass|plate|jar|blender|total|cooking|everything|both|bed|vacation|holiday|break|work|school|class|office|car|train|plane|bus|one|go|morning|night|evening|lunch|dinner|breakfast|bulk)\b)(?:(?:my|your|his|her|our|their)\s+)?\p{L}/iu;

/** A leading pour whose rest pours it onto / into a second food. */
export function isPourOntoSecondFood(text: string): boolean {
  const m = TOPPING_RX.exec(text);
  return !!m && POUR_VEHICLE_RX.test(text.slice(m[0].length));
}

function splitWithLead(text: string): LeadingPour | null {
  const m = POUR_RX.exec(text);
  if (!m) return null;
  const count = countValue(m[2]);
  if (!Number.isFinite(count) || count <= 0) return null;
  return { count, word: singular(m[3]), rest: text.slice(m[0].length), lead: m[1] };
}

export function splitLeadingPour(text: string): { count: number; word: string; rest: string } | null {
  const s = splitWithLead(text);
  return s ? { count: s.count, word: s.word, rest: s.rest } : null;
}

function fmt(x: number): string {
  return String(Number(x.toFixed(3)));
}

export function resolveLoosePourMeasures(line: string): string {
  const s = splitWithLead(line);
  if (!s) return line;
  return `${s.lead}${fmt(s.count * LOOSE_POUR_FLOZ[s.word])} floz of ${s.rest}`;
}

// S202 (cloud-35 F9): refute MAJOR 1 - after the segmenter splits a pour onto/into a second food, put the
// line's own `<count> <pour> of` back on the liquid item when a draw lost it (`[syrup] [pancakes]`,
// `[splash of syrup] [pancakes]`), and drop a leading preposition a draw left on the second food (`on eggs`).
// Runs on every split (cache hit or fresh); the SegmentationCache keeps the segmenter's own split.
const LEADING_PREP_RX = /^\s*(?:on|onto|over|in|into)\s+(?:(?:my|your|his|her|our|their)\s+)?(?=\S)/i;
export function restoreLeadingPour<T extends { rawText: string }>(lineKey: string, items: T[]): { items: T[]; restored: number } {
  const m = TOPPING_RX.exec(lineKey);
  if (!m || items.length < 2) return { items, restored: 0 };
  const rest = lineKey.slice(m[0].length);
  const v = /\s(?:on|onto|over|in|into)\s/i.exec(' ' + rest);
  if (!v) return { items, restored: 0 };
  const liquid = rest.slice(0, Math.max(0, v.index - 1)).trim().toLowerCase();
  if (!liquid) return { items, restored: 0 };
  const word = m[3].toLowerCase();
  const bare = (t: string): string => t.trim().toLowerCase().replace(/^(?:a|an|the|some)\s+/, '');
  // The line's own second food: the text after the vehicle word, bare (articles / possessives dropped).
  // Cut at the first clause break (`,` `;` ` and ` ` with ` ` then ` ` plus ` ` & ` ` + `) so only the second food remains.
  const objectBare = ((' ' + rest).slice(v.index + v[0].length))
    .split(/\s*[,;]\s*|\s+(?:and|with|then|plus|&|\+)\s+/i)[0]
    .trim().toLowerCase().replace(/^(?:(?:my|your|his|her|our|their|a|an|the|some)\s+)+/, '');
  let restored = 0;
  let pourDone = false;
  const out = items.map(it => {
    const b = bare(it.rawText);
    if (!pourDone && (b === liquid || b === `${word} of ${liquid}`)) {
      pourDone = true;
      const rawText = `${m[0].trim()} ${liquid}`;
      if (rawText === it.rawText.trim()) return it;
      restored++;
      return { ...it, rawText };
    }
    if (!pourDone && TOPPING_RX.test(it.rawText)) pourDone = true;
    // M3 (C70 refute): strip a leading preposition only when what is left IS the line's own second food,
    // so `in n out burger` / `on the border queso` items are never touched.
    if (LEADING_PREP_RX.test(it.rawText)) {
      const stripped = it.rawText.replace(LEADING_PREP_RX, '');
      const strippedBare = stripped.trim().toLowerCase().replace(/^(?:(?:my|your|his|her|our|their|a|an|the|some)\s+)+/, '');
      if (objectBare && strippedBare === objectBare) {
        restored++;
        return { ...it, rawText: stripped };
      }
    }
    return it;
  });
  return { items: restored ? out : items, restored };
}
