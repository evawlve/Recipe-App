/**
 * s51_census_candidates.ts — Lane A S51, punch #167 fix-forward (ROW 0(c)), STEP 4.
 * PURE: no DB query, no LLM.
 *
 * The doubling rows of the committed 1,553-row AiNormalizeCache census, selected EXACTLY as
 * `s50_guard1_census.ts` selects them (its selection code is copied verbatim below), replayed
 * through guard 1 and guard 2 under candidate containment predicates:
 *   SHIPPED    guard 1 replica + shipped brandAlreadyPresent · guard 2 shipped repairDroppedBrand
 *   PRE438     guard 1 replica + c1                          · guard 2 replica + c2 only (reference)
 *   C1         guard 1 replica + (c1||c3)                    · guard 2 shipped repairDroppedBrand
 *   C2         guard 1 replica + C2                          · guard 2 shipped repairDroppedBrand
 *   C2-SHARED  guard 1 replica + C2                          · guard 2 replica + C2 (shipped candidateMatchesTargetBrand kept)
 * SELF-CHECKS, aborting on any miss: per row, the SHIPPED arm's replicas equal the direct shipped
 * calls `s50_guard1_census.ts` makes; the run script also diffs the two scripts' summary numbers.
 * Then the four unit inputs under every predicate and both scopes.
 */
import * as fs from 'fs';
import {
    PRE438, SHIPPED_REPLICA, C1, C2, c2, combo, foldBrandTokens, preserveReplica, repairReplica, sameOutcome,
    type Pred,
} from './s51_clauses';

const qwb = require('@/lib/mapping/quantity-word-brand');
const { candidateMatchesTargetBrand } = require('@/lib/mapping/simple-rerank');
const { preserveDroppedBrand, repairDroppedBrand, brandAlreadyPresent, brandWasConsumedAsQuantity } = qwb;

const APPENDIX_MAIN = '/Users/diego/dev/KindaHealthyMobile/sync-docs/reports/2026-09-11_lane-a-s47-appendix-scratchpad-salvage.md';
const APPENDIX_WT = '/Users/diego/dev/KindaHealthyMobile/.claude/worktrees/lane-a-s51/sync-docs/reports/2026-09-11_lane-a-s47-appendix-scratchpad-salvage.md';
const APPENDIX = fs.existsSync(APPENDIX_MAIN) ? APPENDIX_MAIN : APPENDIX_WT;

// ---- selection: verbatim from s50_guard1_census.ts ----
function canonicalizeBrandKey(value: string): string {
    return value.toLowerCase().replace(/['’`]/g, '').replace(/&/g, ' and ')
        .replace(/[-.\/]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const folded = (s: string) => canonicalizeBrandKey(s).split(' ').filter(Boolean);
function leadingRuns(s: string): Array<{ brand: string; tail: string }> {
    const toks = s.split(/\s+/).filter(Boolean);
    const out: Array<{ brand: string; tail: string }> = [];
    for (let k = Math.min(5, toks.length - 1); k >= 1; k--) {
        out.push({ brand: toks.slice(0, k).join(' '), tail: toks.slice(k).join(' ') });
    }
    return out;
}
const stem = (t: string) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);
function recursLaterSet(bt: string[], st: string[]): boolean {
    const rest = st.slice(bt.length).map(stem);
    return bt.every(t => rest.includes(stem(t)));
}

const lines = fs.readFileSync(APPENDIX, 'utf8').split('\n').slice(1030, 2583);
const rows = lines.filter(l => l.trim()).map(l => l.split('\\t'));
if (rows.length !== 1553 || rows.some(r => r.length !== 4)) {
    console.log(`UNEXPECTED census shape: ${rows.length} rows`);
    process.exit(2);
}
type Hit = { n: number; brand: string; tail: string };
const hits: Hit[] = [];
for (const [, useCount, base] of rows) {
    const st = folded(base);
    for (const { brand, tail } of leadingRuns(base)) {
        const bt = folded(brand);
        if (bt.length === 0) continue;
        if (bt.some((t, i) => st[i] !== t)) continue;
        if (!recursLaterSet(bt, st)) continue;
        if (tail.toLowerCase().includes(brand.toLowerCase())) continue;
        hits.push({ n: parseInt(useCount, 10) || 0, brand, tail });
        break;
    }
}
// ---- end verbatim selection ----

const shippedPred: Pred = (t, b) => brandAlreadyPresent(t, b);
const C2ONLY: Pred = (t, b) => c2(t, b);
const g1Args = (h: Hit) => ({ rawLine: h.tail, baseName: h.tail, targetBrand: h.brand, rederived: h.tail, parsed: null });
const g1Doubles = (h: Hit, o: { applied: boolean; baseName: string }) =>
    o.applied && o.baseName.toLowerCase().startsWith(`${h.brand.toLowerCase()} `);

// self-check: SHIPPED replicas == direct shipped calls, per row; clause replicas == shipped predicate on every text
for (const h of hits) {
    const direct1 = preserveDroppedBrand(g1Args(h));
    const rep1 = preserveReplica(g1Args(h), shippedPred, brandWasConsumedAsQuantity);
    const rep1c = preserveReplica(g1Args(h), SHIPPED_REPLICA, brandWasConsumedAsQuantity);
    const direct2 = repairDroppedBrand(h.tail, h.brand);
    const rep2 = repairReplica(h.tail, h.brand, shippedPred, candidateMatchesTargetBrand);
    const rep2c = repairReplica(h.tail, h.brand, SHIPPED_REPLICA, candidateMatchesTargetBrand);
    if (!sameOutcome(direct1, rep1) || !sameOutcome(direct1, rep1c) || direct2 !== rep2 || direct2 !== rep2c
        || brandAlreadyPresent(h.tail, h.brand) !== SHIPPED_REPLICA(h.tail, h.brand)) {
        console.log(`SELF-CHECK ABORT on ${JSON.stringify(h)}`);
        process.exit(2);
    }
}

type Arm = { name: string; g1: Pred; g2: ((name: string, brand: string) => string | null) };
const ARMS: Arm[] = [
    { name: 'SHIPPED', g1: shippedPred, g2: (n, b) => repairDroppedBrand(n, b) },
    { name: 'PRE438 (ref)', g1: PRE438, g2: (n, b) => repairReplica(n, b, C2ONLY, candidateMatchesTargetBrand) },
    { name: 'C1', g1: C1, g2: (n, b) => repairDroppedBrand(n, b) },
    { name: 'C2', g1: C2, g2: (n, b) => repairDroppedBrand(n, b) },
    { name: 'C2-SHARED', g1: C2, g2: (n, b) => repairReplica(n, b, C2, candidateMatchesTargetBrand) },
];

console.log('=== STEP 4 — the 1,553-row census under the candidates ===');
console.log(`appendix: ${APPENDIX}`);
console.log(`doubling rows selected: ${hits.length} rows, ${hits.reduce((s, h) => s + h.n, 0)} serves`);
console.log(`SELF-CHECK: SHIPPED-arm replicas == direct shipped guard calls on ${hits.length}/${hits.length} rows`);
console.log('');
console.log('arm           | guard 1 rows / serves | guard 2 rows / serves');
for (const arm of ARMS) {
    let r1 = 0, s1 = 0, r2 = 0, s2 = 0;
    const dbl: string[] = [];
    for (const h of hits) {
        const o = preserveReplica(g1Args(h), arm.g1, brandWasConsumedAsQuantity);
        const d1 = g1Doubles(h, o);
        const d2 = arm.g2(h.tail, h.brand) !== null;
        if (d1) { r1++; s1 += h.n; }
        if (d2) { r2++; s2 += h.n; }
        if (d1 || d2) dbl.push(`      ${h.n}\tg1 ${d1 ? 'DBL' : 'ok'}\tg2 ${d2 ? 'DBL' : 'ok'}\t${h.brand} | ${h.tail}  (fold ${foldBrandTokens(h.brand).length}w, c1c2c3 ${combo(h.tail, h.brand)})`);
    }
    console.log(`${arm.name.padEnd(13)} | ${String(r1).padStart(4)} / ${String(s1).padEnd(14)} | ${String(r2).padStart(4)} / ${s2}`);
    for (const l of dbl) console.log(l);
    if (arm.name === 'SHIPPED') {
        console.log(`guard 1 (preserveDroppedBrand) still doubles: ${r1} rows, ${s1} serves   [SHIPPED replica, compare with s50_guard1_census.ts]`);
        console.log(`guard 2 (repairDroppedBrand)  still doubles: ${r2} rows, ${s2} serves   [SHIPPED replica, compare with s50_guard1_census.ts]`);
    }
}

console.log('');
console.log('=== the four unit inputs, every predicate, both scopes ===');
console.log('scope g1 = preserveDroppedBrand replica (rawLine=baseName=rederived=text, parsed null) · scope g2 = repairDroppedBrand replica');
const UNITS: Array<[string, string]> = [["m m's", 'm&ms'], ['ben jerry', "Ben & Jerry's"], ['m and ms pretzel', "M&M's"], ['rx bars', 'rxbar']];
const PREDS: Array<[string, Pred]> = [['PRE438', PRE438], ['SHIPPED', shippedPred], ['C1', C1], ['C2', C2]];
for (const [text, brand] of UNITS) {
    console.log(`(${JSON.stringify(text)}, ${JSON.stringify(brand)})  c1c2c3=${combo(text, brand)}  fold ${foldBrandTokens(brand).length}w  · shipped repairDroppedBrand -> ${JSON.stringify(repairDroppedBrand(text, brand))}`);
    for (const [pn, p] of PREDS) {
        const g1 = preserveReplica({ rawLine: text, baseName: text, targetBrand: brand, rederived: text, parsed: null }, p, brandWasConsumedAsQuantity);
        const g2 = repairReplica(text, brand, p, candidateMatchesTargetBrand);
        console.log(`    ${pn.padEnd(8)} present=${p(text, brand)} · g1 ${g1.applied ? 'APPLIED' : 'kept'} ${JSON.stringify(g1.baseName)} · g2 ${JSON.stringify(g2)}`);
    }
}
const pin421 = repairDroppedBrand("m m's", 'm&ms');
const pin421Shared = repairReplica("m m's", 'm&ms', C2, candidateMatchesTargetBrand);
console.log(`PR #421 pin repairDroppedBrand("m m's", 'm&ms'): shipped ${JSON.stringify(pin421)} · C2-SHARED ${JSON.stringify(pin421Shared)} -> ${pin421 === null && pin421Shared === null ? 'PASS (null)' : 'FAIL'}`);
