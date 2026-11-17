/**
 * Small text helpers the adapters share. No HTML parser dependency: the chains collected by curl serve their
 * nutrition as server-rendered tables, labelled fields or a JSON literal, which these cover. A chain that needs a
 * real DOM is a sign it belongs to the Chrome pass.
 */
import type { Panel } from '../../../src/lib/chains/snapshot';
import { PANEL_FIELDS } from '../../../src/lib/chains/snapshot';

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', reg: '®', trade: '™', copy: '©',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', eacute: 'é', ntilde: 'ñ', frac12: '½',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, ent: string) => {
    if (ent.startsWith('#x') || ent.startsWith('#X')) return String.fromCodePoint(parseInt(ent.slice(2), 16));
    if (ent.startsWith('#')) return String.fromCodePoint(parseInt(ent.slice(1), 10));
    return NAMED[ent] ?? m;
  });
}

/** Tags removed, entities decoded, whitespace collapsed. */
export function cellText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * A published number, or null when the cell publishes none: "1,250" -> 1250, "12g" -> 12. A "<1" is null unless
 * `lessThanAs` is given, because "less than one" is not a number the chain stated.
 * Ranges ("120-240"), blanks, dashes and "N/A" are null.
 */
export function num(raw: string | number | null | undefined, opts: { lessThanAs?: number } = {}): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const t = raw.replace(/,/g, '').replace(/\s*(g|mg|kcal|cal)\s*$/i, '').trim();
  if (/^<\s*\d+(\.\d+)?$/.test(t)) return opts.lessThanAs ?? null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export function emptyPanel(): Panel {
  const p = {} as Panel;
  for (const f of PANEL_FIELDS) p[f] = null;
  return p;
}

export function panelOf(values: Partial<Panel>): Panel {
  return { ...emptyPanel(), ...values };
}

/** Lowercase slug for keys: "Chick-n-Strips® (3 ct)" -> "chick-n-strips-3-ct". */
export function slugify(s: string): string {
  // The marks go BEFORE NFKD, which would turn the trademark sign into the letters "TM".
  return s
    .replace(/[\u00ae\u2122\u00a9]/g, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
