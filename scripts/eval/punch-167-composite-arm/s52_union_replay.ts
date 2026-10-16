/**
 * s52_union_replay.ts — Lane A S52, punch #196 (the PAYLOAD half of #167). PURE: no DB
 * query, no LLM, no network.
 *
 * TWO READINGS, IN THIS ORDER, BOTH OFF THE SHIPPED FUNCTION OF WHICHEVER TREE THIS RUNS
 * FROM (project memory: a helper number must come from the shipped function, never a replica).
 *
 *   1. SELF-CHECK. Replay every guard-1 input in the committed capture through this tree's
 *      `preserveDroppedBrand()` and compare against the outcome master recorded at capture
 *      time. On a MASTER checkout this must read 266/266 identical; a mismatch means the
 *      capture no longer describes the tree and every number below is void.
 *   2. THE UNION DIFF. Compare this tree's outcome against the capture's, counting how many
 *      APPLIED inputs change. `--expect-changed N` makes the script exit non-zero unless
 *      exactly N of the applied inputs changed, so CI or a gate script can assert it.
 *
 * The capture is `s51_guard_capture.jsonl` beside this file: 602 distinct `SegmentationCache`
 * segment tuples recorded from the SHIPPED mapper under the composite arm's write guard
 * (Lane A S51, 2026-09-15, master `9d97675`), of which 266 reach guard 1 and 218 apply.
 *
 * USAGE (ts-node, NEVER tsx — see the backend CLAUDE.md §Commands):
 *   set -a; . ./.env; set +a     # importing the mapping module constructs a PrismaClient
 *   ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/eval/punch-167-composite-arm/s52_union_replay.ts [--expect-changed 2] [capture.jsonl]
 *
 * Nothing here queries the database; DATABASE_URL only has to be SET for the import.
 */
import * as fs from 'fs';
import * as path from 'path';

const { preserveDroppedBrand } = require('@/lib/mapping/quantity-word-brand');

type CaptureRow = {
    idx: number;
    rawText: string;
    normalizedForm: string;
    brand: string;
    reached: boolean;
    args: Parameters<typeof preserveDroppedBrand>[0] | null;
    shipped: { baseName: string; applied: boolean; declined: string | null } | null;
};

const argv = process.argv.slice(2);
const expectIdx = argv.indexOf('--expect-changed');
const expectChanged = expectIdx >= 0 ? Number(argv[expectIdx + 1]) : null;
const capturePath = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--expect-changed')
    ?? path.join(__dirname, 's51_guard_capture.jsonl');

const rows: CaptureRow[] = fs.readFileSync(capturePath, 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l));

let reached = 0;
let applied = 0;
let identical = 0;
const changed: { idx: number; rawText: string; brand: string; before: string; after: string }[] = [];
const declinedChanged: number[] = [];

for (const r of rows) {
    if (!r.reached || !r.args || !r.shipped) continue;
    reached++;
    if (r.shipped.applied) applied++;
    const before = JSON.stringify(r.shipped);
    const after = JSON.stringify(preserveDroppedBrand(r.args));
    if (before === after) {
        identical++;
        continue;
    }
    if (!r.shipped.applied) declinedChanged.push(r.idx);
    changed.push({
        idx: r.idx,
        rawText: r.rawText,
        brand: r.args.targetBrand,
        before: r.shipped.baseName,
        after: JSON.parse(after).baseName,
    });
}

console.log(`capture:            ${capturePath}`);
console.log(`tuples:             ${rows.length}`);
console.log(`guard-1 inputs:     ${reached}`);
console.log(`applied (capture):  ${applied}`);
console.log(`identical:          ${identical}`);
console.log(`changed:            ${changed.length}`);
console.log(`of which NOT applied at capture time (must be 0): ${declinedChanged.length}`);
for (const c of changed) {
    console.log(`  #${c.idx} ${JSON.stringify(c.rawText)} brand=${JSON.stringify(c.brand)}`);
    console.log(`      capture:   ${JSON.stringify(c.before)}`);
    console.log(`      this tree: ${JSON.stringify(c.after)}`);
}

let bad = false;
if (declinedChanged.length > 0) {
    console.error(`FAIL: ${declinedChanged.length} DECLINED input(s) changed; the union must touch the applied branch only.`);
    bad = true;
}
if (expectChanged !== null && changed.length !== expectChanged) {
    console.error(`FAIL: expected exactly ${expectChanged} changed applied input(s), read ${changed.length}.`);
    bad = true;
}
if (expectChanged !== null && identical !== reached - expectChanged) {
    console.error(`FAIL: expected ${reached - expectChanged} identical, read ${identical}.`);
    bad = true;
}
process.exit(bad ? 1 : 0);
