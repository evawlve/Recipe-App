/**
 * MAPPING_ANALYSIS_TOP_N — the mapping-analysis candidate depth knob.
 *
 * `logs/mapping-analysis-*.json` is the only corpus that records the LOSERS of a
 * mapping decision, so it is the only instrument that can separate "the right
 * record was gathered and out-ranked" from "the right record was never gathered".
 * The three write sites in `map-ingredient-with-fallback.ts` used to hard-code a
 * 5-candidate display cap, which collapses those two cases. This knob widens the
 * log; it feeds nothing that selects, ranks, filters or persists.
 *
 * Two things are pinned here, and the first matters more than it looks:
 *
 *   1. DEFAULT 5. An unset environment must write byte-identical records to every
 *      mapping-analysis file produced before the knob existed. If this test goes
 *      red, every historical/current log comparison silently changed meaning.
 *   2. FAIL CLOSED. This repo keeps re-finding instruments that fail OPEN — a
 *      malformed value quietly becoming a number nobody chose. `Number.parseInt`
 *      is the usual culprit: it accepts partial matches, so `parseInt('5x')` is 5
 *      and `parseInt('1e3')` is 1. Those cases are asserted explicitly below, not
 *      because anyone would type them on purpose, but because a partial parse is
 *      indistinguishable from a deliberate setting once it is in the log.
 */

import {
  parseMappingAnalysisTopN,
  MAPPING_ANALYSIS_TOP_N,
  MAPPING_ANALYSIS_TOP_N_DEFAULT,
  MAPPING_ANALYSIS_TOP_N_MAX,
} from '../config';

describe('parseMappingAnalysisTopN', () => {
  test('the historical literal is the default', () => {
    // The three call sites read `filtered.slice(0, 5)` before this knob existed.
    expect(MAPPING_ANALYSIS_TOP_N_DEFAULT).toBe(5);
  });

  test('absent or blank falls back to the default', () => {
    expect(parseMappingAnalysisTopN(undefined)).toBe(5);
    expect(parseMappingAnalysisTopN(null)).toBe(5);
    expect(parseMappingAnalysisTopN('')).toBe(5);
    expect(parseMappingAnalysisTopN('   ')).toBe(5);
  });

  test('a plain integer is honoured, surrounding whitespace tolerated', () => {
    expect(parseMappingAnalysisTopN('1')).toBe(1);
    expect(parseMappingAnalysisTopN('5')).toBe(5);
    expect(parseMappingAnalysisTopN('20')).toBe(20);
    expect(parseMappingAnalysisTopN('50')).toBe(50);
    expect(parseMappingAnalysisTopN(' 13 ')).toBe(13);
    expect(parseMappingAnalysisTopN('007')).toBe(7);
  });

  test('zero falls back rather than emptying topCandidates', () => {
    // A 0 cap writes `topCandidates: []` on every decision, which reads
    // downstream as "the pool was empty" — a fail-OPEN instrument, and the exact
    // confusion this knob exists to remove.
    expect(parseMappingAnalysisTopN('0')).toBe(5);
    expect(parseMappingAnalysisTopN('00')).toBe(5);
  });

  test('negative values fall back', () => {
    expect(parseMappingAnalysisTopN('-1')).toBe(5);
    expect(parseMappingAnalysisTopN('-20')).toBe(5);
  });

  test('non-numeric values fall back', () => {
    expect(parseMappingAnalysisTopN('abc')).toBe(5);
    expect(parseMappingAnalysisTopN('true')).toBe(5);
    expect(parseMappingAnalysisTopN('NaN')).toBe(5);
    expect(parseMappingAnalysisTopN('Infinity')).toBe(5);
    expect(parseMappingAnalysisTopN('null')).toBe(5);
  });

  test('PARTIAL parses fall back — parseInt would silently accept these', () => {
    expect(Number.parseInt('5x', 10)).toBe(5);          // what NOT to do
    expect(parseMappingAnalysisTopN('5x')).toBe(5);     // ...same answer here, but
    expect(parseMappingAnalysisTopN('20x')).toBe(5);    // ...here they diverge: parseInt gives 20
    expect(Number.parseInt('20x', 10)).toBe(20);
    expect(parseMappingAnalysisTopN('12 34')).toBe(5);
    expect(parseMappingAnalysisTopN('1,000')).toBe(5);
  });

  test('floats, signs, hex and exponents fall back', () => {
    expect(parseMappingAnalysisTopN('7.9')).toBe(5);    // parseInt would give 7
    expect(parseMappingAnalysisTopN('7.0')).toBe(5);
    expect(parseMappingAnalysisTopN('+7')).toBe(5);
    expect(parseMappingAnalysisTopN('0x10')).toBe(5);   // parseInt(.., 10) would give 0
    expect(parseMappingAnalysisTopN('1e3')).toBe(5);    // parseInt would give 1
  });

  test('absurd values clamp to the max instead of falling back', () => {
    expect(MAPPING_ANALYSIS_TOP_N_MAX).toBe(50);
    expect(parseMappingAnalysisTopN('51')).toBe(50);
    expect(parseMappingAnalysisTopN('1000')).toBe(50);
    expect(parseMappingAnalysisTopN('999999999999999999999')).toBe(50);
  });
});

describe('MAPPING_ANALYSIS_TOP_N (the module-level constant)', () => {
  const saved = process.env.MAPPING_ANALYSIS_TOP_N;

  afterEach(() => {
    if (saved === undefined) delete process.env.MAPPING_ANALYSIS_TOP_N;
    else process.env.MAPPING_ANALYSIS_TOP_N = saved;
    jest.resetModules();
  });

  test('an unset env yields 5 — the pre-knob log content, unchanged', () => {
    jest.resetModules();
    delete process.env.MAPPING_ANALYSIS_TOP_N;
    const fresh = require('../config');
    expect(fresh.MAPPING_ANALYSIS_TOP_N).toBe(5);
  });

  test('a set env is read at module load', () => {
    jest.resetModules();
    process.env.MAPPING_ANALYSIS_TOP_N = '25';
    const fresh = require('../config');
    expect(fresh.MAPPING_ANALYSIS_TOP_N).toBe(25);
  });

  test('a garbage env is read at module load and fails closed', () => {
    jest.resetModules();
    process.env.MAPPING_ANALYSIS_TOP_N = 'wide';
    const fresh = require('../config');
    expect(fresh.MAPPING_ANALYSIS_TOP_N).toBe(5);
  });

  test('the constant this process imported is a legal value', () => {
    expect(Number.isInteger(MAPPING_ANALYSIS_TOP_N)).toBe(true);
    expect(MAPPING_ANALYSIS_TOP_N).toBeGreaterThanOrEqual(1);
    expect(MAPPING_ANALYSIS_TOP_N).toBeLessThanOrEqual(MAPPING_ANALYSIS_TOP_N_MAX);
  });
});
