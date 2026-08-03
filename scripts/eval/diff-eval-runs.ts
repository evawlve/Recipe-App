/**
 * diff-eval-runs.ts — diff two golden-eval results files BY CASE ID.
 *
 * Why this exists: a cold run total is not stable. On 2026-08-03, three cold runs of the same
 * build each reported 14 real failures and no two were the same 14 — comparing summaries would
 * have read "unchanged" three times while the membership moved every time. The differing set
 * between two same-build runs is the NOISE FLOOR, and a refactor that only moves cases inside it
 * has not been shown to change behaviour.
 *
 * Measured caveat, worth knowing before you trust a number this prints: the floor grows with the
 * gap between runs. Back-to-back runs differed by 6 cases; runs minutes apart differed by 19-20.
 * Take at least THREE runs and union the pairwise diffs — a single pair understates the floor by
 * better than 3x. In-process caches (servingCache, 24h TTL) survive --nocache; only restarting
 * recipe-api clears them.
 *
 * Run (from repo root):
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     scripts/eval/diff-eval-runs.ts <a.json> <b.json> --build <BUILD_ID>
 *
 * Exit codes match the house contract: 0 = diffed, 2 = the run is not a result.
 */

import * as fs from 'fs';

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}

const BUILD = argValue('--build');
const flagValues = new Set(['--build'].map(argValue).filter(Boolean) as string[]);
const positionals = args.filter(a => !a.startsWith('--') && !flagValues.has(a));
const [pathA, pathB] = positionals;

function die(msg: string): never {
    console.error(msg);
    process.exit(2);
}

if (!pathA || !pathB) {
    die('usage: diff-eval-runs.ts <a.json> <b.json> --build <BUILD_ID>');
}

// The build id is REQUIRED and cannot be defaulted. A results file records `base` and `noCache`
// but not the build it ran against, so nothing in the data stops you diffing across a deploy and
// calling the difference noise. That is not hypothetical: the 08-02 23:50 / 08-03 00:48 cold pair
// looks like a clean 10-case floor, and two of those ten are PR #226 landing between the runs.
// Until a results file carries `summary.buildId`, the operator asserts it from outside.
if (!BUILD) {
    console.error('❗ --build <BUILD_ID> is REQUIRED.');
    console.error('   A results file does not record the build it ran against, so a "noise floor"');
    console.error('   spanning a deploy is indistinguishable from one that does not.');
    console.error("   Re-read it around every run:  ssh owner@192.168.1.133 'cat …/.next/BUILD_ID'");
    process.exit(2);
}

interface Observed {
    foodId?: string;
    grams?: number;
    kcal100?: number;
    source?: string;
    abstained?: boolean;
}
interface CaseResult {
    id: string;
    kind: string;
    category: string;
    query: string;
    pass: boolean;
    knownIssue?: boolean;
    observed?: Observed;
}
interface RunFile {
    summary: { base: string; noCache: boolean; ranAt: string; buildId?: string };
    results: CaseResult[];
}

function load(p: string): RunFile {
    let j: RunFile;
    try {
        j = JSON.parse(fs.readFileSync(p, 'utf8')) as RunFile;
    } catch (e) {
        die(`${p}: unreadable or not JSON — ${(e as Error).message}`);
    }
    if (!Array.isArray(j.results)) die(`${p}: no results[] — this is not an eval results file`);
    if (j.results.length === 0) die(`${p}: zero cases. A run that executed nothing is not a result.`);
    return j;
}

const A = load(pathA);
const B = load(pathB);

const banner = (j: RunFile, p: string) =>
    `${p.split('/').pop()}  noCache=${j.summary.noCache}  base=${j.summary.base}  ` +
    `ranAt=${j.summary.ranAt}  n=${j.results.length}`;
console.log('A: ' + banner(A, pathA));
console.log('B: ' + banner(B, pathB));

// Fail closed on a comparison that is not one. Cold measures the pipeline, warm measures the
// cache; their difference is a statement about the cache, not about nondeterminism.
if (A.summary.noCache !== B.summary.noCache) {
    die('\n❗ MODE MISMATCH: one run is cold and the other warm. Their diff is not a noise floor.');
}
if (A.summary.base !== B.summary.base) {
    die('\n❗ BASE MISMATCH: the runs hit different APIs.');
}
// If the harness has started recording the build, hold it to the asserted one rather than
// trusting the flag: an operator-supplied value is exactly as reliable as the operator.
for (const [j, p] of [[A, pathA], [B, pathB]] as const) {
    if (j.summary.buildId && j.summary.buildId !== BUILD) {
        die(`\n❗ BUILD MISMATCH: ${p} records buildId=${j.summary.buildId}, --build says ${BUILD}.`);
    }
}
console.log(
    A.summary.buildId
        ? `build: ${BUILD} (recorded in both files)`
        : `build: ${BUILD} (asserted by caller — the files do not record it)`,
);

const byId = (j: RunFile) => new Map(j.results.map(r => [r.id, r]));
const a = byId(A);
const b = byId(B);

const onlyA = [...a.keys()].filter(k => !b.has(k));
const onlyB = [...b.keys()].filter(k => !a.has(k));
if (onlyA.length || onlyB.length) {
    console.log(`\n⚠️  case-set mismatch — only in A: ${onlyA.join(',') || '(none)'} | ` +
        `only in B: ${onlyB.join(',') || '(none)'}`);
}

/**
 * Fields worth diffing, and why:
 *   pass    — the only one that gates. A flip here turns a gate red on noise alone.
 *   foodId  — the PICK. Movement here is retrieval/rerank nondeterminism, not serving.
 *   grams   — the SERVING. The AI serving tiers land here.
 *   kcal100 — the chosen row's panel; moves iff foodId moves.
 *   source  — which lane won. A block of these moving together is a lane shift, not per-case noise.
 */
const FIELDS = ['pass', 'foodId', 'grams', 'kcal100', 'source', 'abstained'] as const;
type Field = typeof FIELDS[number];
const get = (r: CaseResult, f: Field): unknown =>
    f === 'pass' ? r.pass : (r.observed ?? {})[f as keyof Observed];

interface Delta { f: Field; a: unknown; b: unknown }
interface Moved { id: string; kind: string; category: string; query: string; knownIssue: boolean; deltas: Delta[] }

const moved: Moved[] = [];
const sharedIds = [...a.keys()].filter(k => b.has(k));
for (const id of sharedIds) {
    const ra = a.get(id)!;
    const rb = b.get(id)!;
    const deltas = FIELDS
        .filter(f => JSON.stringify(get(ra, f)) !== JSON.stringify(get(rb, f)))
        .map(f => ({ f, a: get(ra, f), b: get(rb, f) }));
    if (deltas.length) {
        moved.push({ id, kind: ra.kind, category: ra.category, query: ra.query, knownIssue: !!ra.knownIssue, deltas });
    }
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');
console.log(`\n=== ${moved.length} of ${sharedIds.length} cases moved (${pct(moved.length, sharedIds.length)}) ===\n`);

for (const f of FIELDS) {
    const n = moved.filter(m => m.deltas.some(d => d.f === f)).length;
    if (n) console.log(`  ${f.padEnd(10)} moved on ${String(n).padStart(3)} case(s)  ${pct(n, sharedIds.length)}`);
}

const flips = moved.filter(m => m.deltas.some(d => d.f === 'pass'));
console.log(`\n--- PASS FLIPS (${flips.length}) — these turn a gate red on noise alone ---`);
for (const m of flips) {
    const d = m.deltas.find(x => x.f === 'pass')!;
    console.log(`  ${m.id.padEnd(12)} ${d.a ? 'PASS→FAIL' : 'FAIL→PASS'}  ${m.knownIssue ? '[known]' : '[REAL] '}  ${m.query}`);
}

console.log('\n--- ALL MOVED CASES ---');
for (const m of moved) {
    console.log(`  ${m.id.padEnd(12)} ${m.kind}/${m.category}  "${m.query}"${m.knownIssue ? ' [known]' : ''}`);
    for (const d of m.deltas) console.log(`      ${d.f}: ${JSON.stringify(d.a)}  →  ${JSON.stringify(d.b)}`);
}

console.log('\n--- MOVED SET (case ids) ---');
console.log(moved.map(m => m.id).sort().join(' '));

// The gating population, side by side. A case failing in one run and not the other is a flake and
// must not be quoted as a failure count — report the stable intersection.
const realFails = (j: RunFile) => j.results.filter(r => !r.pass && !r.knownIssue).map(r => r.id).sort();
const fa = realFails(A);
const fb = realFails(B);
const stable = fa.filter(x => fb.includes(x));
const flaky = [...fa.filter(x => !fb.includes(x)), ...fb.filter(x => !fa.includes(x))].sort();
console.log('\n--- REAL FAILURES ---');
console.log(`  A (${fa.length}): ${fa.join(' ')}`);
console.log(`  B (${fb.length}): ${fb.join(' ')}`);
console.log(`  STABLE in both (${stable.length}): ${stable.join(' ')}`);
console.log(`  flaky (in one only): ${flaky.join(' ') || '(none)'}`);
if (flaky.length) {
    console.log(`\n  ⚠️  Quote ${stable.length}, not ${fa.length} or ${fb.length}. The totals agree by coincidence`);
    console.log('     more often than the membership does.');
}

console.log('\nNOTE: one pair is not a noise floor. Union at least three pairwise diffs.');
