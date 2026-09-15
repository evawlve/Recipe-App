/**
 * s51_clause_classifier.ts — Lane A S51, punch #167 fix-forward (ROW 0(c)), STEP 2.
 * PURE: no DB query, no LLM. Reads the tuple CSV and `s51_guard_capture.jsonl`.
 *
 * Classifies (text, brand) pairs by which clauses of `brandAlreadyPresent()` hold, after
 * SELF-CHECKING on every pair that the replica `c1 || c2 || c3` equals the SHIPPED function
 * (aborts, exit 2, on any mismatch). Pair sets:
 *   A. (normalizedForm, brand)  for every CSV tuple with a non-empty segmenter brand
 *   B. (rawText, brand)         the same tuples
 *   C. (baseName, targetBrand)  every captured guard-1 call
 *   D. (rederived, targetBrand) every captured guard-1 call
 * THE CLASS: fold(brand) is one word AND clause 2 AND NOT clause 1 AND NOT clause 3.
 */
import * as fs from 'fs';
import * as path from 'path';
import { c1, c2, c3, combo, isClass, foldBrandTokens, readTuples } from './s51_clauses';

const { brandAlreadyPresent } = require('@/lib/mapping/quantity-word-brand');
const CAPTURE = process.argv[2] ?? path.join(__dirname, 's51_guard_capture.jsonl');

const tuples = readTuples();
const captured = fs.readFileSync(CAPTURE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const calls = captured.filter((r: any) => r.reached);

type Pair = { set: string; line: string; text: string; brand: string };
const pairs: Pair[] = [];
for (const t of tuples) {
    if (!t.brand) continue;
    const line = `#${t.idx} ${JSON.stringify(t.rawText)}`;
    pairs.push({ set: 'A (normalizedForm, brand)', line, text: t.normalizedForm, brand: t.brand });
    pairs.push({ set: 'B (rawText, brand)', line, text: t.rawText, brand: t.brand });
}
for (const r of calls) {
    const line = `#${r.idx} ${JSON.stringify(r.rawText)}`;
    pairs.push({ set: 'C (baseName, targetBrand)', line, text: r.args.baseName, brand: r.args.targetBrand });
    pairs.push({ set: 'D (rederived, targetBrand)', line, text: r.args.rederived, brand: r.args.targetBrand });
}

let checked = 0;
for (const p of pairs) {
    const replica = c1(p.text, p.brand) || c2(p.text, p.brand) || c3(p.text, p.brand);
    const shipped = brandAlreadyPresent(p.text, p.brand);
    if (replica !== shipped) {
        console.log(`SELF-CHECK ABORT: replica ${replica} != shipped ${shipped} on ${JSON.stringify(p)}`);
        process.exit(2);
    }
    checked++;
}

console.log('=== STEP 2 — clause classifier ===');
console.log(`tuples ${tuples.length} · with segmenter brand ${tuples.filter(t => t.brand).length} · captured guard calls ${calls.length}`);
console.log(`SELF-CHECK: replica c1||c2||c3 == shipped brandAlreadyPresent on ${checked}/${pairs.length} pairs`);
console.log('');
console.log('clause combination counts (bits c1c2c3; "cls" = class members):');
const sets = [...new Set(pairs.map(p => p.set))];
const combos = ['000', '001', '010', '011', '100', '101', '110', '111'];
console.log(`set                         | ${combos.join('   | ')}   | total | cls`);
for (const s of sets) {
    const ps = pairs.filter(p => p.set === s);
    const cells = combos.map(c => String(ps.filter(p => combo(p.text, p.brand) === c).length).padStart(3));
    console.log(`${s.padEnd(27)} | ${cells.join('   | ')}   | ${String(ps.length).padStart(5)} | ${ps.filter(p => isClass(p.text, p.brand)).length}`);
}

console.log('');
console.log('CLASS MEMBERS (one-word folded brand, clause 2 only), every one:');
let members = 0;
for (const s of sets) {
    for (const p of pairs.filter(q => q.set === s && isClass(q.text, q.brand))) {
        members++;
        console.log(`  ${s} · ${p.line} · text ${JSON.stringify(p.text)} · brand ${JSON.stringify(p.brand)} · fold ${JSON.stringify(foldBrandTokens(p.brand))}`);
    }
}
if (members === 0) console.log('  (none)');

console.log('');
console.log('`&`-vs-`and` pairs (brand has `&`, text has the word `and`) — expected multi-word folds held by clause 3, NOT class:');
let ampRows = 0, ampClass = 0;
for (const p of pairs) {
    if (!p.brand.includes('&') || !/\band\b/i.test(p.text)) continue;
    ampRows++;
    const cls = isClass(p.text, p.brand);
    if (cls) ampClass++;
    console.log(`  ${p.set} · ${p.line} · text ${JSON.stringify(p.text)} · brand ${JSON.stringify(p.brand)} · fold ${foldBrandTokens(p.brand).length} words · c1c2c3 ${combo(p.text, p.brand)} · class ${cls}`);
}
console.log(`  -> ${ampRows} pairs, ${ampClass} class members`);

const dbLoaded = Object.keys(require.cache).some(k => /\/src\/lib\/db(\.ts|\/index\.ts)?$/.test(k));
console.log('');
console.log(`@/lib/db module loaded in this process: ${dbLoaded} (no query is issued by this script either way)`);
