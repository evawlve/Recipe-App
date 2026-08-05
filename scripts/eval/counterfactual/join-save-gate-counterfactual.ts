/* Gate design step 1: offline save-gate counterfactual. READ-ONLY. */
import fs from 'fs';
import { canonicalizeCacheKey } from '../../../src/lib/mapping/normalization-rules';

const DIR = process.argv[2];
const rd = (f: string) => fs.readFileSync(`${DIR}/${f}`, 'utf8').split('\n').filter(Boolean).map(l => l.split('\\t'));

type Inc = { key: string; norm: string; conf: number; off: string; fdc: string; fs: string; name: string; validatedBy: string; target: string };
const incs: Inc[] = rd('incumbents.tsv').map(c => ({
    key: canonicalizeCacheKey(c[0]), norm: c[0], conf: Number(c[1]),
    off: c[2], fdc: c[3], fs: c[4], name: c[5], validatedBy: c[6],
    // FoodMapping stores fsId BARE (712/712 rows have no `fs_` prefix, measured
    // 2026-08-05), while mapping-analysis-*.json records the prefixed form
    // (`fs_1646`). Joining on the bare value silently classified EVERY
    // FatSecret incumbent as UNATTRIBUTED — 106 of 219 saturated rows, all one
    // key. Normalise to the corpus's prefixed form.
    target: c[2] ? `off_${c[2]}` : c[3] ? `fdc_${c[3]}` : c[4] ? (c[4].startsWith('fs_') ? c[4] : `fs_${c[4]}`) : '',
}));
const byKey = new Map<string, Inc>();
for (const i of incs) if (!byKey.has(i.key)) byKey.set(i.key, i);

type Ch = { id: string; raw: string; norm: string; key: string; conf: number; source: string; foodId: string; at: string };
const chs: Ch[] = rd('challengers.tsv').map(c => ({
    id: c[0], raw: c[1], norm: c[2], key: canonicalizeCacheKey(c[2]),
    conf: Number(c[3]), source: c[4], foodId: c[5], at: c[6],
}));

// --- join validation (the doc claims naive 319/1082, canonical 976/1082) ---
const naiveKeys = new Set(incs.map(i => i.norm));
const naive = chs.filter(c => naiveKeys.has(c.norm)).length;
const joined = chs.filter(c => byKey.has(c.key));
console.log(`JOIN  naive ${naive}/${chs.length} (${(100 * naive / chs.length).toFixed(1)}%)  canonical ${joined.length}/${chs.length} (${(100 * joined.length / chs.length).toFixed(1)}%)`);

// --- RISK 2: incumbent turnover. Challenger == today's incumbent target. ---
const selfSame = joined.filter(c => c.foodId && c.foodId === byKey.get(c.key)!.target);
console.log(`\nRISK-2 TURNOVER (lower bound)`);
console.log(`  joined rejections whose challenger IS today's incumbent: ${selfSame.length}/${joined.length} (${(100 * selfSame.length / joined.length).toFixed(1)}%)`);
console.log(`  -> at rejection time the incumbent was someone else; these are EXCLUDED from flip counts.`);
const keysAffected = new Set(selfSame.map(c => c.key));
console.log(`  distinct keys affected: ${keysAffected.size}`);
for (const k of [...keysAffected].slice(0, 10)) {
    const n = selfSame.filter(c => c.key === k).length;
    console.log(`    ${k}  x${n}  incumbent=${byKey.get(k)!.target} "${byKey.get(k)!.name}"`);
}

const usable = joined.filter(c => !(c.foodId && c.foodId === byKey.get(c.key)!.target));
console.log(`\n  usable joined rejections after exclusion: ${usable.length}`);

// --- incumbents at the saturated clamp ---
const sat = usable.filter(c => byKey.get(c.key)!.conf >= 0.999);
const satKeys = new Set(sat.map(c => c.key));
console.log(`\nINCUMBENTS AT >= 0.999`);
console.log(`  usable rejections facing a 1.0 incumbent: ${sat.length} across ${satKeys.size} keys`);

fs.writeFileSync(`${DIR}/satkeys.txt`, [...satKeys].join('\n'));
fs.writeFileSync(`${DIR}/joined.json`, JSON.stringify(
    usable.map(c => ({ ...c, incTarget: byKey.get(c.key)!.target, incConf: byKey.get(c.key)!.conf, incName: byKey.get(c.key)!.name, incValidatedBy: byKey.get(c.key)!.validatedBy })), null, 1));
console.log(`\nwrote joined.json (${usable.length}) and satkeys.txt (${satKeys.size})`);
