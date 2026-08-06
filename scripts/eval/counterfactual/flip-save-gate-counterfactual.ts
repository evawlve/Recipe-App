/* Gate design step 1, part 2: attribution + flip rule. READ-ONLY.
 * Input dir must hold joined.json (from join-save-gate-counterfactual.ts) and
 * attrib.tsv (foodId \t confidence \t selectionReason \t startTime). */
import fs from 'fs';

const DIR = process.argv[2];
const CROSS_SOURCE_DISPLACEMENT_MARGIN = 0.05;
const DECLINED = 0.78;

const CACHE_HIT_REASONS = new Set(['early_cache_hit_after_normalize', 'normalized_cache_hit']);
const LAUNDERED_REASONS = new Set(['scored_by_confidence', 'basic_produce_bypass', 'confidence_gate_backstop']);

// --- attribution index: latest NON-cache-hit decision per foodId at >= 0.999 ---
const latest = new Map<string, { reason: string; at: string }>();
for (const line of fs.readFileSync(`${DIR}/attrib.tsv`, 'utf8').split('\n').filter(Boolean)) {
    const [foodId, , reason, at] = line.split('\t');
    if (CACHE_HIT_REASONS.has(reason)) continue;
    const prev = latest.get(foodId);
    if (!prev || at > prev.at) latest.set(foodId, { reason, at });
}

type Verdict = 'LAUNDERED' | 'LEGITIMATE' | 'UNATTRIBUTED';
function classify(foodId: string, conf: number): { v: Verdict; reason: string } {
    if (conf < 0.999) return { v: 'LEGITIMATE', reason: 'not_at_clamp' };
    const a = latest.get(foodId);
    if (!a) return { v: 'UNATTRIBUTED', reason: '-' };
    return { v: LAUNDERED_REASONS.has(a.reason) ? 'LAUNDERED' : 'LEGITIMATE', reason: a.reason };
}
const corrected = (conf: number, v: Verdict) => (v === 'LAUNDERED' ? DECLINED : conf);

type Row = {
    id: string; raw: string; key: string; conf: number; source: string; foodId: string;
    incTarget: string; incConf: number; incName: string; incValidatedBy: string;
};
const rows: Row[] = JSON.parse(fs.readFileSync(`${DIR}/joined.json`, 'utf8'));

const cell: Record<string, number> = {};
const flips: string[] = [];
let unattributed = 0;
for (const r of rows) {
    const ci = classify(r.incTarget, r.incConf);
    const cc = classify(r.foodId, r.conf);
    if (ci.v === 'UNATTRIBUTED' || cc.v === 'UNATTRIBUTED') unattributed++;
    cell[`inc=${ci.v} ch=${cc.v}`] = (cell[`inc=${ci.v} ch=${cc.v}`] ?? 0) + 1;

    const inc2 = corrected(r.incConf, ci.v);
    const ch2 = corrected(r.conf, cc.v);
    const before = r.conf >= r.incConf + CROSS_SOURCE_DISPLACEMENT_MARGIN;
    const after = ch2 >= inc2 + CROSS_SOURCE_DISPLACEMENT_MARGIN;
    if (after && !before) {
        flips.push([
            r.key,
            `INC ${r.incTarget} "${r.incName}" conf=${r.incConf}->${inc2} ${ci.v}(${ci.reason}) validatedBy=${r.incValidatedBy}`,
            `CH  ${r.foodId} [${r.source}] conf=${r.conf}->${ch2} ${cc.v}(${cc.reason}) raw="${r.raw}"`,
        ].join('\n    '));
    }
}

console.log(`rows (usable joined rejections): ${rows.length}`);
console.log(`\n2x2 ATTRIBUTION (incumbent x challenger)`);
for (const [k, v] of Object.entries(cell).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log(`\nUNATTRIBUTED touching either side: ${unattributed} (reported separately, folded into NEITHER bucket)`);

console.log(`\nFLIPS (rejection would become a displacement): ${flips.length}`);
const byKey = new Map<string, number>();
for (const f of flips) { const k = f.split('\n')[0]; byKey.set(k, (byKey.get(k) ?? 0) + 1); }
console.log(`  distinct keys: ${byKey.size}`);
for (const [k, n] of [...byKey.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${n}`);
console.log(`\n--- every flip, by name ---`);
const seen = new Set<string>();
for (const f of flips) { const sig = f.replace(/raw="[^"]*"/, ''); if (seen.has(sig)) continue; seen.add(sig); console.log('  ' + f); }
