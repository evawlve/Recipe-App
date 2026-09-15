/**
 * s51_guardcalls_selftest.ts — Lane A S51, punch #198.
 *
 * Pins the composite arm's `--mode diff` over synthetic item rows:
 *   1. every guard call is diffed as an ORDERED LIST (`guardCalls`), so a first call
 *      lost to a later one reads MOVED, where the last-call fields alone read SAME;
 *   2. an item whose guard ran more than once on EITHER side is FLAGGED — whether
 *      or not anything moved;
 *   3. a pre-S51 arm file (no `guardCalls` field) still diffs on the last-call fields,
 *      and the flag reads only the side that carries the lists.
 *
 * NO DB, NO LLM, NO NETWORK. It imports only the arm's pure diff functions (the arm
 * runs nothing on import) and never calls replay. Run it like the S49 guard self-test:
 *
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/eval/punch-167-composite-arm/s51_guardcalls_selftest.ts
 *
 * Exit 0 = every assertion held; exit 1 = one failed (the assertion is printed).
 */
import { strict as assert } from 'assert';

import { GuardCall, ResultRow, diffRows, formatDiff } from './s49row3_pinned_composite_arm';

function call(over: Partial<GuardCall> = {}): GuardCall {
    return {
        rawLine: 'optimum weigh nutrition protein',
        inputBaseName: 'protein',
        targetBrand: 'Optimum Nutrition',
        rederived: 'optimum weigh nutrition protein',
        applied: true,
        declined: null,
        baseName: 'Optimum Nutrition protein',
        ...over,
    };
}

/** An item row whose last-call fields are derived from `calls`, as replay writes them. */
function row(lineIdx: number, calls: GuardCall[]): ResultRow {
    const last = calls.length ? calls[calls.length - 1] : null;
    return {
        lineIdx, itemIdx: 0, line: `line ${lineIdx}`, rawText: `line ${lineIdx}`,
        pinnedForm: 'protein', pinnedBrand: 'Optimum Nutrition',
        guardApplied: last ? last.applied : null,
        guardDeclined: last ? last.declined : null,
        guardBaseName: last ? last.baseName : null,
        foodId: 'off_1', foodName: 'Whey Protein', brandName: 'Optimum Nutrition',
        grams: 31, kcal: 120, servingTier: 'label_serving',
        guardCalls: calls,
        guardCallCount: calls.length,
    };
}

/** The same row as a pre-S51 arm wrote it: no list, no count. */
function oldFormat(r: ResultRow): ResultRow {
    const copy: ResultRow = { ...r };
    delete copy.guardCalls;
    delete copy.guardCallCount;
    return copy;
}

// The mapper's re-entry (e.g. attemptAiSimplifyFallback) makes a SECOND guard call
// on a simplified line. On side A the first call applied a prepend and the second
// kept the simplified name; side B made only that second call. The last call is
// identical on both sides, so guardApplied / guardBaseName agree.
const recursionCall = call({ rawLine: 'protein', inputBaseName: 'protein', rederived: 'protein', applied: false, baseName: 'protein' });
const A: ResultRow[] = [row(0, [call()]), row(1, [call(), recursionCall])];
const B: ResultRow[] = [row(0, [call()]), row(1, [recursionCall])];

const checks: Array<[string, () => void]> = [
    ['the fixture is the #198 shape: last-call fields agree on the recursing item', () => {
        assert.equal(A[1].guardApplied, B[1].guardApplied);
        assert.equal(A[1].guardBaseName, B[1].guardBaseName);
    }],

    ['lists present on both sides: the lost first call reads MOVED on guardCalls', () => {
        const rep = diffRows(A, B);
        assert.equal(rep.compared, 2);
        assert.equal(rep.same, 1);
        assert.deepEqual(rep.moved.map(m => [m.key, m.fields]), [['1.0', ['guardCalls']]]);
        assert.deepEqual(rep.onlyOne, []);
        assert.deepEqual(rep.listsAbsent, { a: 0, b: 0 });
    }],

    ['the recursion flag names the item with 2 calls on A and 1 on B, and only that item', () => {
        const rep = diffRows(A, B);
        assert.deepEqual(rep.recursion, [{ key: '1.0', rawText: 'line 1', a: 2, b: 1 }]);
        const out = formatDiff(rep);
        assert.ok(out.includes('GUARD RECURSION (guard calls > 1 on either arm): 1  1.0'), out.join('\n'));
        assert.ok(out.some(l => l.includes('1.0') && l.includes('A=2') && l.includes('B=1')), out.join('\n'));
        assert.ok(out.includes('ITEM-COUNT MISMATCH (one arm only): 0  '), 'the pre-S51 summary line is unchanged');
    }],

    ['the flag is independent of movement: identical 2-call lists read SAME and are still flagged', () => {
        const rep = diffRows(A, A);
        assert.equal(rep.same, 2);
        assert.equal(rep.moved.length, 0);
        assert.deepEqual(rep.recursion, [{ key: '1.0', rawText: 'line 1', a: 2, b: 2 }]);
    }],

    ['NON-VACUITY: the same rows without lists read SAME and raise no flag (the pre-S51 blind spot)', () => {
        const rep = diffRows(A.map(oldFormat), B.map(oldFormat));
        assert.equal(rep.same, 2);
        assert.equal(rep.moved.length, 0);
        assert.deepEqual(rep.recursion, []);
        assert.deepEqual(rep.listsAbsent, { a: 2, b: 2 });
        assert.ok(formatDiff(rep).some(l => l.startsWith('GUARD-CALL LISTS ABSENT')));
    }],

    ['old-format A against new-format B degrades: no list compare, the flag reads B only', () => {
        const rep = diffRows(A.map(oldFormat), A);
        assert.equal(rep.same, 2);
        assert.equal(rep.moved.length, 0);
        assert.deepEqual(rep.recursion, [{ key: '1.0', rawText: 'line 1', a: null, b: 2 }]);
        assert.deepEqual(rep.listsAbsent, { a: 2, b: 0 });
    }],
];

let failed = 0;
for (const [name, fn] of checks) {
    try {
        fn();
        console.warn(`PASS  ${name}`);
    } catch (e: any) {
        failed++;
        console.warn(`FAIL  ${name}\n      ${e?.message ?? String(e)}`);
    }
}
console.warn(failed === 0 ? `\nall ${checks.length} checks passed` : `\n${failed} of ${checks.length} checks FAILED`);
process.exit(failed === 0 ? 0 : 1);
