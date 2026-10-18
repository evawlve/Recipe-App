/**
 * loose-measures.ts - "a swig / gulp / sip / splash of X" is a fluid-ounce measure.
 *
 * S202 design (row 5 = 8(g), design r2). The pour words are not units in normalizeUnitToken(), so
 * `a swig of soda` kept the whole phrase as the name (qty 1, no unit) and `2 swigs of soda` became
 * an unknown count unit; either way the mapper billed the record's default serving (369 g of soda
 * for one swig). The rewrite turns a LEADING `<count> <pour> of <food>` into canonical
 * `<n> floz of <food>`, a unit every downstream volume table already knows, so no new unit word
 * reaches serving code.
 *
 * The four amounts are CONVENTIONS, not measurements: swig 1.5 fl oz, gulp 1 fl oz, sip 0.5 fl oz,
 * splash 0.5 fl oz.
 *
 * POSITIONAL: only at the line start, only with a count, the partitive `of`, and a letter or digit
 * after it. `a v8 splash`, `big gulp`, `splash of milk`, `a swig sugar cookie` and `a splash` stay
 * untouched. Known gaps: a non-leading pour (`had a swig of soda`), hedged pours (`half a splash`),
 * `one and a half swigs`.
 */

export const LOOSE_POUR_FLOZ: Record<string, number> = { swig: 1.5, gulp: 1, sip: 0.5, splash: 0.5 };

const WORD_COUNTS: Record<string, number> = {
  a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const POUR_RX = new RegExp(
  '^(\\s*)' +
    '(a|one|two|three|four|five|six|seven|eight|nine|ten|\\d+ \\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?)' +
    '\\s+(swigs?|gulps?|sips?|splash(?:es)?)\\s+of\\s+(?=[\\p{L}\\d])',
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
