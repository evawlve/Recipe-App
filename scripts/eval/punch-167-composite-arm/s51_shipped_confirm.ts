/**
 * s51_shipped_confirm.ts — Lane A S51, punch #167 fix-forward. PURE: no DB query, no LLM.
 *
 * Replays every guard-1 input `s51_guard_capture.ts` recorded (the shipped mapper on master
 * `9d97675`, the 602 distinct SegmentationCache tuples, 2026-09-15) through the SHIPPED
 * `preserveDroppedBrand()` of whichever tree this runs from, and diffs each outcome against
 * the one master produced at capture time. Then the golden n-supp-22 fixture, which no real
 * input carries. The replica predicates in `s51_clauses.ts` measured the candidates; this is
 * the receipt that the shipped function matches them (memory: a helper number must come from
 * the shipped function).
 *
 * Importing the mapping module constructs a PrismaClient, so DATABASE_URL must be set
 * (`set -a; . ./.env; set +a`); nothing here queries it.
 */
import * as fs from 'fs';
import * as path from 'path';

const { preserveDroppedBrand } = require('@/lib/mapping/quantity-word-brand');
const { parseIngredientLine } = require('@/lib/parse/ingredient-line');

const CAPTURE = process.argv[2] ?? path.join(__dirname, 's51_guard_capture.jsonl');
const rows = fs.readFileSync(CAPTURE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

let reached = 0;
let same = 0;
const changed: string[] = [];
for (const r of rows) {
    if (!r.reached || !r.args) continue;
    reached++;
    const before = JSON.stringify(r.shipped);
    const after = JSON.stringify(preserveDroppedBrand(r.args));
    if (before === after) {
        same++;
    } else {
        changed.push(`#${r.idx} ${JSON.stringify(r.rawText)} brand=${JSON.stringify(r.args.targetBrand)}\n    master:    ${before}\n    this tree: ${after}`);
    }
}
console.log(`tuples: ${rows.length}; guard-1 inputs: ${reached}; identical to master's capture: ${same}; changed: ${changed.length}`);
for (const c of changed) console.log(c);

const fixture = {
    rawLine: '2 rx bars', baseName: 'protein bar', targetBrand: 'rxbar', rederived: 'rx bars',
    parsed: parseIngredientLine('2 rx bars'),
};
console.log(`fixture n-supp-22 -> ${JSON.stringify(preserveDroppedBrand(fixture))}`);
