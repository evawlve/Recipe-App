/**
 * s51_candidate_replay.ts — Lane A S51, punch #167 fix-forward (ROW 0(c)), STEP 3.
 * PURE: no DB query, no LLM. Reads `s51_guard_capture.jsonl`.
 *
 * Replays every captured guard-1 call, plus the golden fixture for `n-supp-22`, through a
 * replica of `preserveDroppedBrand()` whose containment predicate is injected (both checks),
 * keeping the SHIPPED `brandWasConsumedAsQuantity()` refusal. SELF-CHECKS first, aborting on any
 * miss: (i) the shipped function re-called on the JSON-round-tripped args reproduces the
 * captured outcome; (ii) the replica with the SHIPPED `brandAlreadyPresent` injected reproduces
 * it; (iii) the replica with the clause-replica SHIPPED predicate reproduces it.
 *
 * Arms: PRE438 (c1) · SHIPPED (c1||c2||c3) · C1 (c1||c3) · C2 (c1 || c2&&multiword || c3).
 * Every C1/C2 outcome that differs from SHIPPED is listed and marked:
 *   RESTORES-CLASS  the candidate prepends, and the re-derivation SHIPPED read as carrying the
 *                   brand is a class member (one-word fold held by clause 2 only);
 *   RE-DOUBLES      the candidate prepends onto a re-derivation that carries the brand by a
 *                   clause the candidate still does not count on its own (a non-class clause-2
 *                   read, or clause 3) — the pre-#438 doubling returns;
 *   OTHER           any other change (a first-check flip that swaps baseName, a decline, ...).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    PRE438, SHIPPED_REPLICA, C1, C2, combo, isClass, preserveReplica, sameOutcome,
    type Outcome, type GuardArgs, type Pred,
} from './s51_clauses';

const qwb = require('@/lib/mapping/quantity-word-brand');
const { parseIngredientLine } = require('@/lib/parse/ingredient-line');
const CAPTURE = process.argv[2] ?? path.join(__dirname, 's51_guard_capture.jsonl');

const captured = fs.readFileSync(CAPTURE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const calls = captured.filter((r: any) => r.reached);

type Input = { label: string; args: GuardArgs; captured: Outcome | null };
const inputs: Input[] = calls.map((r: any) => ({
    label: `#${r.idx} ${JSON.stringify(r.rawText)} [nf ${JSON.stringify(r.normalizedForm)}]`,
    args: r.args, captured: r.shipped,
}));
const FIXTURE: Input = {
    label: 'FIXTURE n-supp-22 "2 rx bars"',
    args: { rawLine: '2 rx bars', baseName: 'protein bar', targetBrand: 'rxbar', rederived: 'rx bars', parsed: parseIngredientLine('2 rx bars') },
    captured: null,
};

const shippedPred: Pred = (t, b) => qwb.brandAlreadyPresent(t, b);
const consumed = qwb.brandWasConsumedAsQuantity;
const fmt = (o: Outcome) => `${o.applied ? 'APPLIED' : o.declined ? `DECLINED:${o.declined}` : 'kept'} ${JSON.stringify(o.baseName)}`;

console.log('=== STEP 3 — candidate replay over the captured guard-1 inputs ===');
let s1 = 0, s2 = 0, s3 = 0;
for (const inp of inputs) {
    const direct = qwb.preserveDroppedBrand(inp.args);
    const repShipped = preserveReplica(inp.args, shippedPred, consumed);
    const repClauses = preserveReplica(inp.args, SHIPPED_REPLICA, consumed);
    const cap = inp.captured!;
    if (!sameOutcome(direct, cap)) { console.log(`SELF-CHECK (i) ABORT ${inp.label}: ${fmt(direct)} vs captured ${fmt(cap)}`); process.exit(2); }
    s1++;
    if (!sameOutcome(repShipped, cap)) { console.log(`SELF-CHECK (ii) ABORT ${inp.label}: ${fmt(repShipped)} vs captured ${fmt(cap)}`); process.exit(2); }
    s2++;
    if (!sameOutcome(repClauses, cap)) { console.log(`SELF-CHECK (iii) ABORT ${inp.label}: ${fmt(repClauses)} vs captured ${fmt(cap)}`); process.exit(2); }
    s3++;
}
console.log(`captured guard-1 calls: ${inputs.length} (distinct args ${new Set(inputs.map(i => JSON.stringify([i.args.rawLine, i.args.baseName, i.args.targetBrand, i.args.rederived]))).size})`);
console.log(`SELF-CHECK (i)   shipped preserveDroppedBrand on round-tripped args == captured: ${s1}/${inputs.length}`);
console.log(`SELF-CHECK (ii)  replica + shipped brandAlreadyPresent == captured:            ${s2}/${inputs.length}`);
console.log(`SELF-CHECK (iii) replica + clause replicas c1||c2||c3 == captured:             ${s3}/${inputs.length}`);

const ARMS: Array<[string, Pred]> = [['PRE438', PRE438], ['SHIPPED', shippedPred], ['C1', C1], ['C2', C2]];
const all = [...inputs, FIXTURE];

console.log('');
console.log('outcome counts per arm (captured inputs only | fixture):');
for (const [name, pred] of ARMS) {
    let a = 0, k = 0, d = 0;
    for (const inp of inputs) {
        const o = preserveReplica(inp.args, pred, consumed);
        if (o.declined) d++; else if (o.applied) a++; else k++;
    }
    const fx = preserveReplica(FIXTURE.args, pred, consumed);
    console.log(`  ${name.padEnd(8)} applied ${a} · not applied ${k} · declined ${d}   | fixture ${fmt(fx)}`);
}

const fxShipped = preserveReplica(FIXTURE.args, shippedPred, consumed);
const fxC1 = preserveReplica(FIXTURE.args, C1, consumed);
const fxC2 = preserveReplica(FIXTURE.args, C2, consumed);
const fxOk = fxShipped.baseName === 'rx bars' && fxC1.baseName === 'rxbar rx bars' && fxC2.baseName === 'rxbar rx bars';
console.log(`fixture verification (SHIPPED "rx bars", C1 and C2 "rxbar rx bars"): ${fxOk ? 'PASS' : 'FAIL'}`);

function mark(inp: Input, cand: Outcome, candPred: Pred): string {
    const { baseName, rederived, targetBrand } = inp.args;
    const candPrepends = cand.applied && !candPred(rederived, targetBrand);
    const shipRederivedPresent = shippedPred(rederived, targetBrand);
    if (candPrepends && shipRederivedPresent) {
        return isClass(rederived, targetBrand) ? 'RESTORES-CLASS' : 'RE-DOUBLES';
    }
    const b1 = isClass(baseName, targetBrand) ? 'class' : 'non-class';
    return `OTHER (check-1 text ${b1})`;
}

for (const [name, pred] of [['PRE438', PRE438], ['C1', C1], ['C2', C2]] as Array<[string, Pred]>) {
    console.log('');
    const diffs = all.filter(inp => !sameOutcome(preserveReplica(inp.args, pred, consumed), preserveReplica(inp.args, shippedPred, consumed)));
    const realDiffs = diffs.filter(d => d !== FIXTURE);
    console.log(`${name} vs SHIPPED: ${realDiffs.length} captured inputs differ (+ fixture ${diffs.includes(FIXTURE) ? 'differs' : 'same'})`);
    const tally: Record<string, number> = {};
    for (const inp of diffs) {
        const cand = preserveReplica(inp.args, pred, consumed);
        const ship = preserveReplica(inp.args, shippedPred, consumed);
        const m = name === 'PRE438' ? '' : mark(inp, cand, pred);
        if (inp !== FIXTURE && m) tally[m] = (tally[m] ?? 0) + 1;
        console.log(`  ${m ? m.padEnd(26) : ''}${inp.label}`);
        console.log(`      brand ${JSON.stringify(inp.args.targetBrand)} · baseName ${JSON.stringify(inp.args.baseName)} c1c2c3=${combo(inp.args.baseName, inp.args.targetBrand)} · rederived ${JSON.stringify(inp.args.rederived)} c1c2c3=${combo(inp.args.rederived, inp.args.targetBrand)}`);
        console.log(`      SHIPPED ${fmt(ship)}  ->  ${name} ${fmt(cand)}`);
    }
    if (name !== 'PRE438') console.log(`  ${name} marks over captured inputs: ${JSON.stringify(tally)}`);
}
