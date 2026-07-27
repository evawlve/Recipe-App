/**
 * cache-ops-void-exits.test.ts — FAIL INJECTION for the two audit-prep
 * instruments that could run to completion having produced NOTHING and still
 * exit 0 (playbook §11 class B — absence encoded as a PASS):
 *
 *   `_recover_seeds.ts` — recovered 0 of N phrases, wrote an empty pin file,
 *     exited 0. Downstream that file silently un-pins EVERY row, and the whole
 *     fleet audit runs on token-sorted keys instead of shopper phrases.
 *   `_dump_cache_prompts.ts` — an empty or truncated pins.tsv read as "0 pins,
 *     carry on": all cards emitted unpinned, exit 0, and the operator ships an
 *     82-agent audit that measures the wrong thing.
 *
 * Both now refuse/void with an explicit expected-vs-observed message and a
 * nonzero exit. Every block carries a POSITIVE CONTROL, per fail-closed.test.ts:
 * a guard that refuses everything is a tautology, not a test.
 *
 * NO NETWORK, NO DATABASE — only the pure exported functions run here.
 */

import { RECOVER_VOID_EXIT, recoveryOutcome } from '../_recover_seeds';
import { parsePinsText, pinCoverageCheck } from '../_dump_cache_prompts';

// ===========================================================================
// 1. _recover_seeds — zero recovered is VOID, not success
// ===========================================================================

describe('_recover_seeds: recovering ZERO phrases is a distinct, nonzero outcome', () => {
    it('0 / 320 recovered exits VOID with an explicit message', () => {
        const o = recoveryOutcome(0, 320);
        expect(o.code).toBe(RECOVER_VOID_EXIT);
        const text = o.lines.join(' ');
        expect(text).toContain('VOID');
        expect(text).toContain('0 / 320');
        expect(text).toContain('produced NOTHING');
    });

    it('the VOID code is distinct from success (0) AND from error (2)', () => {
        expect(RECOVER_VOID_EXIT).not.toBe(0);
        expect(RECOVER_VOID_EXIT).not.toBe(2);
    });

    it('0 / 0 is also VOID — an empty want-list cannot produce a usable pin file', () => {
        expect(recoveryOutcome(0, 0).code).toBe(RECOVER_VOID_EXIT);
    });

    it('POSITIVE CONTROL — one recovered phrase is a clean exit with no VOID noise', () => {
        expect(recoveryOutcome(1, 320)).toEqual({ code: 0, lines: [] });
    });

    it('POSITIVE CONTROL — a realistic partial recovery (1,868 of 3,248) is NOT void', () => {
        // Partial recovery is the normal outcome (coverage was 57.5% on the real
        // cache); only ZERO is void. A guard that rejects partials could never run.
        expect(recoveryOutcome(1868, 3248).code).toBe(0);
    });
});

// ===========================================================================
// 2. _dump_cache_prompts — the pins file is load-bearing and refuses when broken
// ===========================================================================

describe('_dump_cache_prompts: an empty pins.tsv refuses, never "0 pins, carry on"', () => {
    it('an EMPTY file refuses with expected-vs-observed', () => {
        const v = parsePinsText('');
        expect(v.ok).toBe(false);
        if (!v.ok) {
            expect(v.reason).toContain('EMPTY');
            expect(v.reason).toContain('expected >=1');
            expect(v.reason).toContain('observed 0');
        }
    });

    it('a whitespace-only file refuses (truncated-to-nothing reads the same as empty)', () => {
        expect(parsePinsText('   \n \n  ').ok).toBe(false);
    });
});

describe('_dump_cache_prompts: a TRUNCATED or malformed pins.tsv refuses', () => {
    it('a file cut mid-line (no tab in the last line) refuses, naming the line', () => {
        const v = parsePinsText('and ben jerry\tben and jerrys ice cream\njersey mike sub');
        expect(v.ok).toBe(false);
        if (!v.ok) {
            expect(v.reason).toContain('MALFORMED');
            expect(v.reason).toContain('expected every non-empty line');
            expect(v.reason).toContain('line 2');
            expect(v.reason).toContain('jersey mike sub');
        }
    });

    it('a line with a key but no phrase refuses — half a pin is not a pin', () => {
        expect(parsePinsText('good key\tgood phrase\nbad key\t\n').ok).toBe(false);
        expect(parsePinsText('bad key\t').ok).toBe(false);
    });

    it('a line with extra tabs refuses — key<TAB>phrase is the ONLY shape _recover_seeds emits', () => {
        expect(parsePinsText('key\tphrase\textra field\n').ok).toBe(false);
    });

    it('the observed malformed count is reported, not just the first hit', () => {
        const v = parsePinsText('a\nb\nc key\tc phrase\n');
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.reason).toContain('2 line(s)');
    });

    it('POSITIVE CONTROL — a well-formed pins.tsv parses to exactly its pins, trimmed', () => {
        const v = parsePinsText('and ben jerry\tben and jerrys half baked\npropel water\tpropel water \n');
        expect(v.ok).toBe(true);
        if (v.ok) {
            expect(v.pins.size).toBe(2);
            expect(v.pins.get('and ben jerry')).toBe('ben and jerrys half baked');
            expect(v.pins.get('propel water')).toBe('propel water');
        }
    });
});

describe('_dump_cache_prompts: well-formed pins that touch ZERO rows are the WRONG pins', () => {
    const pins = new Map([['some other key space', 'a phrase']]);

    it('zero overlap refuses with expected-vs-observed counts', () => {
        const v = pinCoverageCheck(['and ben jerry', 'propel water'], pins);
        expect(v.ok).toBe(false);
        if (!v.ok) {
            expect(v.reason).toContain('ZERO');
            expect(v.reason).toContain('2 row key(s)');
            expect(v.reason).toContain('1 pin(s)');
        }
    });

    it('POSITIVE CONTROL — one overlapping pin passes and reports the pinned count', () => {
        const v = pinCoverageCheck(
            ['and ben jerry', 'propel water'],
            new Map([['propel water', 'propel water'], ['unrelated', 'x']]),
        );
        expect(v).toEqual({ ok: true, pinned: 1 });
    });
});
