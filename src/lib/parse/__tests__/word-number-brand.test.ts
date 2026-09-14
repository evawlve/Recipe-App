/**
 * The two number-word lists, held together in both directions.
 *
 * `parseQuantityTokens()` in ../quantity.ts reads a leading number word through
 * its function-local `WORD_NUMBERS` map. `matchWordNumberBrandTokens()` in
 * ../ingredient-line.ts stops that read when a detected MULTI-token brand opens
 * with a word from the module-level `QUANTITY_WORD_NUMBERS` set ("five guys",
 * "two good", "six star"). The set restates the map on purpose and neither is
 * exported, so a word added to one list and not the other passed every gate.
 *
 * Neither list is reachable as a value, so this file ENUMERATES them from their
 * source literals (CRLF-stripped) and PINS them through behaviour:
 *   1. both literals name the same words;
 *   2. every member of `QUANTITY_WORD_NUMBERS` is consumed as a count by
 *      `parseQuantityTokens()`;
 *   3. every key of `WORD_NUMBERS` is kept out of the quantity parse by the
 *      brand guard, reached through `parseIngredientLine()`.
 * The literal read is what catches an ADDITION to one list; the behavioural
 * asserts are what prove the literals are the ones that run.
 *
 * The guard is reached through `parseIngredientLine()` with `detectBrandInQuery()`
 * wrapped: the lexicon holds a multi-token brand for only three of these words,
 * so for a probe line `<word> zzqx crisps` the wrapper reports the synthetic brand
 * `<word> zzqx`, and every other query goes to the real detector. No number word
 * is a unit in `normalizeUnitToken()` (../unit.ts), so on a probe line the leading
 * word is read by the guard or by the quantity parse and nothing else.
 */
import * as fs from 'fs';
import * as path from 'path';

import { detectBrandInQuery } from '../../mapping/brand-detector';
import { parseIngredientLine } from '../ingredient-line';
import { parseQuantityTokens } from '../quantity';

// Hoisted above the imports, so the factory references nothing from this file's
// scope — only its own locals.
jest.mock('../../mapping/brand-detector', () => {
  const actual = jest.requireActual('../../mapping/brand-detector');
  return { ...actual, detectBrandInQuery: jest.fn(actual.detectBrandInQuery) };
});

const mockedDetect = detectBrandInQuery as jest.MockedFunction<typeof detectBrandInQuery>;
const realDetect: typeof detectBrandInQuery =
  jest.requireActual('../../mapping/brand-detector').detectBrandInQuery;

afterEach(() => {
  mockedDetect.mockImplementation(realDetect);
});

/** Capture group 1 of `pattern` in a sibling source file, with '\r' stripped. */
function sourceLiteral(file: string, pattern: RegExp): string {
  const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r/g, '');
  const m = pattern.exec(text);
  if (!m) throw new Error(`word-number-brand.test: ${pattern} not found in ${file}`);
  return m[1];
}

/**
 * The literal readers see an entry however it is written — bare, single-, double-
 * or backtick-quoted — and ignore comments. A reader that saw only the local style
 * would let a word added the other way pass silently: Lane A S49's first registry
 * claim over these lists matched `([a-z]+):` and stayed GREEN on a quoted `'tres': 3`.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * An entry the readers do not recognise — a spread (`...EXTRA`), a named value
 * (`thirteen: BAKERS_DOZEN`) — must fail the test, never be skipped: a skipped
 * entry leaves the reader returning the same fourteen words while the lists diverge.
 */
function readEntries(body: string, entry: RegExp): string[] {
  const text = stripComments(body);
  const words = [...text.matchAll(entry)].map((m) => m[1]);
  const rest = text.replace(entry, '');
  if (/[^,\s]/.test(rest)) {
    throw new Error(`word-number-brand.test: unrecognised entry in a list literal: ${JSON.stringify(rest.trim())}`);
  }
  return words;
}

function mapKeysOf(body: string): string[] {
  return readEntries(body, /['"`]?([a-z]+)['"`]?\s*:\s*\d+/g);
}

function setMembersOf(body: string): string[] {
  return readEntries(body, /['"`]([a-z]+)['"`]/g);
}

/** The keys of `WORD_NUMBERS` inside `parseQuantityTokens()`. */
function parserMapWords(): string[] {
  return mapKeysOf(sourceLiteral('quantity.ts', /const WORD_NUMBERS\b[^=]*=\s*\{([^}]*)\}/));
}

/** The members of `QUANTITY_WORD_NUMBERS` in ingredient-line.ts. */
function guardSetWords(): string[] {
  return setMembersOf(sourceLiteral('ingredient-line.ts', /const QUANTITY_WORD_NUMBERS\b[^=]*=\s*new Set\(\[([^\]]*)\]\)/));
}

/** Parse the probe line with the detector reporting the brand `<word> zzqx`. */
function parseBehindSyntheticBrand(word: string) {
  const brand = `${word} zzqx`;
  mockedDetect.mockImplementation((query: string) =>
    query.includes('zzqx')
      ? { ...realDetect(query), isBranded: true, matchedBrand: brand }
      : realDetect(query));
  return parseIngredientLine(`${word} zzqx crisps`);
}

describe('the number-word lists agree', () => {
  test('the literal readers see bare and quoted entries, and skip comments', () => {
    expect(mapKeysOf("\n  one: 1, 'tres': 3, \"cuatro\": 4, // 'cinco': 5\n  /* seis: 6 */ dozen: 12,\n"))
      .toEqual(['one', 'tres', 'cuatro', 'dozen']);
    expect(setMembersOf("\n  'one', \"tres\", // 'cinco'\n  'dozen',\n")).toEqual(['one', 'tres', 'dozen']);
    expect(() => mapKeysOf('one: 1, ...EXTRA')).toThrow(/unrecognised entry/);
    expect(() => mapKeysOf('one: 1, thirteen: BAKERS_DOZEN')).toThrow(/unrecognised entry/);
    expect(() => setMembersOf("'one', ...MORE")).toThrow(/unrecognised entry/);
  });

  test('both literals name the same fourteen words', () => {
    const expected = ['couple', 'dozen', 'eight', 'eleven', 'five', 'four', 'nine',
      'one', 'seven', 'six', 'ten', 'three', 'twelve', 'two'];
    expect([...parserMapWords()].sort()).toEqual(expected);
    expect([...guardSetWords()].sort()).toEqual(expected);
  });

  test('QUANTITY_WORD_NUMBERS -> parseQuantityTokens(): every member is consumed as a count', () => {
    for (const word of guardSetWords()) {
      const r = parseQuantityTokens([word, 'zzqx', 'crisps']);
      expect({ word, consumed: r?.consumed }).toEqual({ word, consumed: 1 });
    }
  });

  // Being brand-led does not protect a word the set lacks: behind the same synthetic
  // brand, `half` is still consumed (qty 0.5, name `zzqx crisps`, measured 2026-09-14).
  // What protects a word is membership, which is why the pin is on the set.
  test('WORD_NUMBERS -> the brand guard: every key stays in the name behind a detected brand', () => {
    for (const word of parserMapWords()) {
      const r = parseBehindSyntheticBrand(word);
      expect({ word, qty: r?.qty, name: r?.name })
        .toEqual({ word, qty: 1, name: `${word} zzqx crisps` });
    }
  });

  test('the probe discriminates: with the real detector the same words ARE counted', () => {
    // Without a brand the guard cannot fire, so the word leaves the name. If this
    // failed, the test above would pass for a reason other than the guard.
    for (const word of parserMapWords()) {
      expect({ word, name: parseIngredientLine(`${word} zzqx crisps`)?.name })
        .toEqual({ word, name: 'zzqx crisps' });
    }
  });

  // `half`, `quarter` and `third` are NOT negative controls: `parseQuantityTokens()`
  // consumes each as a fraction (0.5, 0.25, 1/3 — measured 2026-09-14) through a
  // separate map, and neither list here holds them. That is a third list the brand
  // guard does not read; it is handed to consolidation in the Lane A S50 report,
  // not pinned here.
  test('negative controls: a bare article is not a count, and neither list holds one', () => {
    // The guard side has nothing to observe for a word the parser does not
    // consume — the qty is 1 and the word stays in the name either way — so
    // membership is pinned through the literals.
    for (const word of ['a', 'an']) {
      expect({ word, r: parseQuantityTokens([word, 'zzqx', 'crisps']) }).toEqual({ word, r: null });
      expect(parserMapWords()).not.toContain(word);
      expect(guardSetWords()).not.toContain(word);
    }
  });
});
