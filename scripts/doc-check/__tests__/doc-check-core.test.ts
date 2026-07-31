/**
 * Fail-injection tests for the doc-claims checker verdict logic.
 *
 * Same discipline as scripts/eval/__tests__/fail-closed.test.ts: every fallible
 * input is forced to fail and the verdict must NOT be the passing one, and every
 * block carries a POSITIVE CONTROL so "never passes" can't satisfy the suite.
 * No network, no shell — the core is pure; the runner is deliberately thin.
 */

import {
    checkerExitCode,
    evaluateClaim,
    parseRegistry,
    type ClaimResult,
    type DocClaim,
} from '../doc-check-core';

function claim(over: Partial<DocClaim> = {}): DocClaim {
    return {
        id: 'test-claim',
        claim: 'the sky is blue',
        ownerDoc: 'mobile:CLAUDE.md#sky',
        where: 'mobile',
        command: 'echo blue',
        expect: { kind: 'equals', value: 'blue' },
        verified: '2026-07-30',
        ...over,
    };
}

const ran = (stdout: string, exitCode = 0) => ({ ran: true, stdout, exitCode });

describe('parseRegistry fails closed', () => {
    const valid = JSON.stringify({ claims: [claim()] });

    test('positive control: a valid registry parses to its claims', () => {
        expect(parseRegistry(valid)).toHaveLength(1);
    });

    test.each([
        ['not JSON', 'nonsense{{{'],
        ['no claims array', JSON.stringify({ foo: 1 })],
        ['claims is not an array', JSON.stringify({ claims: 'many' })],
    ])('%s throws instead of yielding an empty (green) run', (_name, raw) => {
        expect(() => parseRegistry(raw)).toThrow();
    });

    test.each([
        ['missing id', claim({ id: '' })],
        ['missing command', claim({ command: ' ' })],
        ['unknown context', claim({ where: 'laptop' as never })],
        ['unknown expect kind', claim({ expect: { kind: 'vibes' as never, value: 'x' } })],
        ['empty expect.value — empty output must never pass by accident', claim({ expect: { kind: 'equals', value: '' } })],
        ['non-integer count', claim({ expect: { kind: 'count', value: 'many' } })],
        ['non-date verified', claim({ verified: 'recently' })],
    ])('%s is rejected', (_name, bad) => {
        expect(() => parseRegistry(JSON.stringify({ claims: [bad] }))).toThrow();
    });

    test('duplicate ids are rejected — two claims sharing an id would let one shadow the other', () => {
        expect(() => parseRegistry(JSON.stringify({ claims: [claim(), claim()] }))).toThrow(/duplicate/);
    });

    // Pinned because a context is what decides which host is ALLOWED to skip a
    // claim. A typo'd context that still parsed would silently drop the claim
    // from every --where run; the 'laptop' case above is the negative control
    // for exactly that, and this is its positive counterpart.
    test.each([['backend'], ['mobile'], ['box'], ['devmachine']])(
        'context %s is accepted — the full set, so adding one is a deliberate edit here too',
        (where) => {
            const parsed = parseRegistry(JSON.stringify({ claims: [claim({ id: `c-${where}`, where: where as never })] }));
            expect(parsed).toHaveLength(1);
            expect(parsed[0].where).toBe(where);
        },
    );
});

describe('evaluateClaim fails closed', () => {
    test('positive control: equals passes on exact trimmed output', () => {
        expect(evaluateClaim(claim(), ran('blue\n')).pass).toBe(true);
    });

    test('a command that could not run FAILS the claim — an unreachable box must not read as verified', () => {
        const r = evaluateClaim(claim(), { ran: false, stdout: '', exitCode: null, error: 'ssh: connect refused' });
        expect(r.pass).toBe(false);
        expect(r.detail).toContain('COULD NOT RUN');
    });

    test('empty output fails an equals claim', () => {
        expect(evaluateClaim(claim(), ran('')).pass).toBe(false);
    });

    test('count: positive control and the empty/garbage cases', () => {
        const c = claim({ expect: { kind: 'count', value: '30' } });
        expect(evaluateClaim(c, ran('30\n')).pass).toBe(true);
        expect(evaluateClaim(c, ran('')).pass).toBe(false);            // no output != 0 != 30
        expect(evaluateClaim(c, ran('30 errors')).pass).toBe(false);   // prose is not a measurement
        expect(evaluateClaim(c, ran('29')).pass).toBe(false);
    });

    test('count 0 requires a literal 0, so a dead grep pipeline (empty stdout) still fails', () => {
        const c = claim({ expect: { kind: 'count', value: '0' } });
        expect(evaluateClaim(c, ran('0\n')).pass).toBe(true);
        expect(evaluateClaim(c, ran('')).pass).toBe(false);
    });

    test('min/max: boundaries hold in both directions', () => {
        expect(evaluateClaim(claim({ expect: { kind: 'min', value: '5' } }), ran('5')).pass).toBe(true);
        expect(evaluateClaim(claim({ expect: { kind: 'min', value: '5' } }), ran('4')).pass).toBe(false);
        expect(evaluateClaim(claim({ expect: { kind: 'max', value: '5' } }), ran('5')).pass).toBe(true);
        expect(evaluateClaim(claim({ expect: { kind: 'max', value: '5' } }), ran('6')).pass).toBe(false);
    });

    test('matches: positive control, non-match, and an uncompilable registry regex is a FAIL not a pass', () => {
        const c = (v: string) => claim({ expect: { kind: 'matches', value: v } });
        expect(evaluateClaim(c('^FATSECRET_RETRIEVAL_ENABLED=1$'), ran('FATSECRET_RETRIEVAL_ENABLED=1\n')).pass).toBe(true);
        expect(evaluateClaim(c('^FATSECRET_RETRIEVAL_ENABLED=1$'), ran('FATSECRET_RETRIEVAL_ENABLED=0\n')).pass).toBe(false);
        const bad = evaluateClaim(c('([unclosed'), ran('anything'));
        expect(bad.pass).toBe(false);
        expect(bad.detail).toContain('BAD REGEX');
    });
});

describe('checkerExitCode — zero claims is not a green run', () => {
    const pass: ClaimResult = { id: 'a', ownerDoc: 'x', pass: true, detail: '' };
    const fail: ClaimResult = { id: 'b', ownerDoc: 'x', pass: false, detail: '' };

    test('positive control: all-pass exits 0', () => {
        expect(checkerExitCode([pass, pass])).toBe(0);
    });
    test('any false claim exits 1', () => {
        expect(checkerExitCode([pass, fail])).toBe(1);
    });
    test('an empty run exits 2 — a filter matching nothing must be distinguishable from green', () => {
        expect(checkerExitCode([])).toBe(2);
    });
});
