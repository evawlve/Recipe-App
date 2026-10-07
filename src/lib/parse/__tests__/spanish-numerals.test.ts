/**
 * Spanish numerals and fraction words in the quantity/unit tables.
 *
 * A PINNED TABLE, not a snapshot: every row below is a line whose parse this
 * change either MOVES on purpose or must leave byte-identical, and the reason
 * is stated per row. The absences are the load-bearing half -- SPANISH_WORD_NUMBERS
 * in quantity.ts owns why `tres`, `siete`, `once` and `un`/`una`/`uno` are out,
 * and the last block here is what makes a later "just add the rest" go red.
 *
 * Measured 2026-09-12 (Lane A S49) against the 43-line Spanish corpus in
 * scripts/eval/spanish/. Owner (mobile repo):
 * sync-docs/reports/2026-09-12_spanish-eval-corpus-baseline.md.
 */
import { parseIngredientLine } from '../ingredient-line';
import {
  parseQuantityTokens,
  SPANISH_WORD_NUMBERS,
  SPANISH_WORD_FRACTIONS,
} from '../quantity';
import { normalizeUnitToken } from '../unit';

type Row = { line: string; qty: number; name: string; why: string };

/** Lines this change MOVES, and the value it must move them to. */
const MOVED: Row[] = [
  { line: 'dos huevos', qty: 2, name: 'huevos', why: 'billed 50 g / 74 kcal for TWO eggs' },
  { line: 'dos piezas de pan', qty: 2, name: 'piezas de pan', why: 'billed 26 g against ~52-60 g' },
  { line: 'dos tamales de pollo', qty: 2, name: 'tamales de pollo', why: 'billed 57 g against ~114 g' },
  { line: 'media manzana', qty: 0.5, name: 'manzana', why: 'billed 138 g, a whole large apple' },
  { line: 'medio aguacate', qty: 0.5, name: 'aguacate', why: 'medio read as *medium*, billed a flat 100 g' },
];

/**
 * Lines this change must leave BYTE-IDENTICAL. The first two are the measured
 * organic-traffic regression that keeps `tres` out of the list; the next two are
 * the brand collisions; the three after that are the corpus lines that land
 * correctly BY LUCK and can only be moved off a right answer; the rest are the
 * English quantity paths that share these two tables.
 */
const HELD: Row[] = [
  { line: 'tres leches', qty: 1, name: 'tres leches', why: 'English dish name, organic cached traffic' },
  { line: 'tres leches cake', qty: 1, name: 'tres leches cake', why: 'same, 2 MEL events since 2026-07-21' },
  { line: 'siete tortilla chips', qty: 1, name: 'siete tortilla chips', why: 'Siete Foods is a single-token BRAND_SET entry' },
  { line: 'once again almond butter', qty: 1, name: 'once again almond butter', why: 'once leads two lexicon brands' },
  { line: 'una taza de arroz', qty: 1, name: 'una taza de arroz', why: 'already ~a cup; the over-bill is DRY rice, not the portion' },
  { line: 'un vaso de leche', qty: 1, name: 'un vaso de leche', why: 'lands 250 g on the record label, by luck' },
  { line: 'una cucharada de aceite de oliva', qty: 1, name: 'una cucharada de aceite de oliva', why: 'lands 15 g on the record label, by luck' },
  { line: 'tres rebanadas de pan integral', qty: 1, name: 'tres rebanadas de pan integral', why: 'needs `tres`, which is held' },
  { line: '100 g de pollo', qty: 100, name: 'de pollo', why: 'the Spanish control: already English-shaped, must not move' },
  { line: 'two eggs', qty: 2, name: 'eggs', why: 'English word number' },
  { line: 'a couple of eggs', qty: 2, name: 'eggs', why: 'article + word number + partitive' },
  { line: 'three slices of bacon', qty: 3, name: 'bacon', why: 'English word number with a unit' },
  { line: 'five guys little cheeseburger', qty: 1, name: 'five guys little cheeseburger', why: 'the multi-token word-number brand guard' },
  { line: '2% milk', qty: 1, name: '2% milk', why: 'a percent is not a quantity' },
  { line: '1 1/2 cups rice', qty: 1.5, name: 'rice', why: 'mixed fraction' },
];

function parsed(line: string) {
  const p = parseIngredientLine(line);
  if (!p) throw new Error(`parseIngredientLine returned null for ${line}`);
  return p;
}

describe('Spanish numerals: the lines that move', () => {
  it.each(MOVED)('$line -> qty $qty, name "$name" ($why)', ({ line, qty, name }) => {
    const p = parsed(line);
    expect(p.qty).toBeCloseTo(qty, 6);
    expect(p.name).toBe(name);
  });
});

describe('Spanish numerals: the lines that must NOT move', () => {
  it.each(HELD)('$line stays qty $qty, name "$name" ($why)', ({ line, qty, name }) => {
    const p = parsed(line);
    expect(p.qty).toBeCloseTo(qty, 6);
    expect(p.name).toBe(name);
  });
});

describe('the alias tables themselves', () => {
  it('carries the nine numerals and no more', () => {
    expect(Object.keys(SPANISH_WORD_NUMBERS).sort()).toEqual(
      ['cinco', 'cuatro', 'diez', 'doce', 'docena', 'dos', 'nueve', 'ocho', 'seis']
    );
  });

  it('carries both genders of half and no more', () => {
    expect(Object.keys(SPANISH_WORD_FRACTIONS).sort()).toEqual(['media', 'medio']);
  });

  // The absences are the point. Each of these is a measured refusal, not an
  // oversight, and adding one without reading the SPANISH_WORD_NUMBERS header
  // turns this test red rather than shipping the regression it documents.
  it.each([
    ['tres', 'breaks `tres leches` / `tres leches cake`, organic cached traffic'],
    ['siete', 'Siete Foods: a single-token BRAND_SET entry the multi-token brand guard cannot cover'],
    ['once', 'an English word, and it leads `once again` / `once upon a farm`'],
    ['un', 'consumes the leading token on lines that are already right'],
    ['una', 'same'],
    ['uno', 'same'],
  ])('%s is deliberately absent (%s)', (tok) => {
    expect(SPANISH_WORD_NUMBERS[tok]).toBeUndefined();
    expect(SPANISH_WORD_FRACTIONS[tok]).toBeUndefined();
    expect(parseQuantityTokens([tok, 'manzana'])).toBeNull();
  });

  // Container words stay out of the unit table for the same measured reason.
  it.each(['taza', 'vaso', 'cucharada', 'pieza', 'rebanada'])(
    '%s is not a unit', (tok) => {
      expect(normalizeUnitToken(tok)).toEqual({ kind: 'unknown', raw: tok });
    }
  );

  it('mirrors media/medio into the unit multiplier table, as `half` already is', () => {
    expect(normalizeUnitToken('media')).toEqual({ kind: 'multiplier', factor: 0.5 });
    expect(normalizeUnitToken('medio')).toEqual({ kind: 'multiplier', factor: 0.5 });
    expect(normalizeUnitToken('half')).toEqual({ kind: 'multiplier', factor: 0.5 });
  });
});
