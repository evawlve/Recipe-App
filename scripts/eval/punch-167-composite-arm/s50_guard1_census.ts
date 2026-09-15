/**
 * s50_guard1_census.ts — Lane A S50 ROW 2. PURE: no DB, no LLM, no writes.
 *
 * Selects the DOUBLING rows of the committed 1,553-row AiNormalizeCache census exactly as
 * `scripts/eval/punch-167-composite-arm/s49row3_predicate.ts --set` does (P-SELF, set mode;
 * the selection functions below are copied verbatim from it), then replays every hit through
 * the SHIPPED guards of whichever tree this runs from:
 *   guard 1: preserveDroppedBrand({ rawLine: tail, baseName: tail, targetBrand: brand, rederived: tail, parsed: null })
 *            — the composite-path shape the S49 tokenizer probe used
 *   guard 2: repairDroppedBrand(tail, brand)
 * A row "still doubles" on guard 1 when it applies AND prepends the brand; on guard 2 when it
 * returns a non-null repair.
 */
import * as fs from 'fs';

const { preserveDroppedBrand, repairDroppedBrand } = require('@/lib/mapping/quantity-word-brand');

const APPENDIX = '/Users/diego/dev/KindaHealthyMobile/sync-docs/reports/2026-09-11_lane-a-s47-appendix-scratchpad-salvage.md';

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

let hits = 0, serves = 0, g1Rows = 0, g1Serves = 0, g2Rows = 0, g2Serves = 0;
console.log('serves\tg1\tg2\tbrand | tail\t=> guard1 baseName\t|| guard2');
for (const [, useCount, base] of rows) {
    const st = folded(base);
    for (const { brand, tail } of leadingRuns(base)) {
        const bt = folded(brand);
        if (bt.length === 0) continue;
        if (bt.some((t, i) => st[i] !== t)) continue;
        if (!recursLaterSet(bt, st)) continue;
        if (tail.toLowerCase().includes(brand.toLowerCase())) continue;
        const n = parseInt(useCount, 10) || 0;
        hits++; serves += n;
        const g1 = preserveDroppedBrand({ rawLine: tail, baseName: tail, targetBrand: brand, rederived: tail, parsed: null });
        const g1Doubles = g1.applied && g1.baseName.toLowerCase().startsWith(`${brand.toLowerCase()} `);
        const g2 = repairDroppedBrand(tail, brand);
        if (g1Doubles) { g1Rows++; g1Serves += n; }
        if (g2 !== null) { g2Rows++; g2Serves += n; }
        console.log(`${n}\t${g1Doubles ? 'DBL' : 'ok'}\t${g2 !== null ? 'DBL' : 'ok'}\t${brand} | ${tail}\t=> ${JSON.stringify(g1.baseName)}\t|| ${JSON.stringify(g2)}`);
        break;
    }
}
console.log('');
console.log(`doubling rows selected: ${hits} rows, ${serves} serves`);
console.log(`guard 1 (preserveDroppedBrand) still doubles: ${g1Rows} rows, ${g1Serves} serves`);
console.log(`guard 2 (repairDroppedBrand)  still doubles: ${g2Rows} rows, ${g2Serves} serves`);
