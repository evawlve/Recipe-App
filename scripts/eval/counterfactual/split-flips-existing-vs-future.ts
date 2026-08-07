/* Gate design step 2: WHO does the 0.78 correction actually make displaceable?
 * READ-ONLY. Input dir is the same one join-save-gate-counterfactual.ts wrote
 * (joined.json + attrib.tsv + incumbents.tsv).
 *
 * ## Why this script exists
 *
 * `flip-save-gate-counterfactual.ts` reports 118 flips — rejections that would
 * become displacements once laundered confidences drop to 0.78. The build report
 * filed all 118 under "unreachable by this PR, because there is no backfill".
 * Review showed that is only half right, and the halves point opposite ways:
 *
 *   * TRUE for existing rows. A flip needs the INCUMBENT's stored confidence to
 *     fall, and this PR does not rewrite stored rows.
 *   * FALSE for future rows. Every abstention from the merge onward is BORN at
 *     0.78, so its bar is born at crossSourceDisplacementBar(0.78) = 0.83 rather
 *     than the unreachable 1.05. Those rows are displaceable from birth.
 *
 * So "118 flips" is the wrong number to decide on in BOTH directions, and this
 * script prints the two populations separately. It decides nothing: the
 * cross-source unfreeze is a policy call, and the project has refuted unfreezing
 * twice already (mobile:sync-docs/reports/2026-08-02_cross-source-margin-unfreeze-refuted.md).
 * This PR does NOT change crossSourceDisplacementBar().
 *
 * ## What it measured, 2026-08-05
 *
 *   FoodMapping snapshot 3,824 rows; 459 (12.0%) at the saturated clamp >= 0.999.
 *   Of those 459, 153 are LAUNDERED (89 scored_by_confidence, 63
 *   basic_produce_bypass, 1 confidence_gate_backstop) and 306 are legitimate
 *   (247 high_confidence_clear_winner, 29 exact_match, ...).
 *   -> a backfill would move 153 rows; no-backfill leaves all 153 frozen at 1.05.
 *
 *   All 118 flips require the incumbent side to move. ZERO are reachable from the
 *   challenger side alone. So on merge, with no backfill, this PR produces NONE
 *   of them.
 *
 *   The 118 collapse to SIX keys and EIGHT incumbent rows, and the direction is
 *   not a source story:
 *     106  breast chicken   fs_1646 GENERIC   <- 3 OFF BRANDED barcodes
 *       6  broccoli         off McCain BRANDED <- fdc_170379 "Broccoli, raw" GENERIC
 *       2  chicken nugget   off Realgood BRANDED <- fs_1738 GENERIC
 *       2  baby carrot      off Bolthouse BRANDED <- fs_36979 GENERIC
 *       1  potato sweet     off The Potato Chef BRANDED <- fs_36617 GENERIC
 *       1  spinach          off (unbranded)    <- fs_36577 GENERIC
 *
 *   The 106 are ONE key, ONE incumbent and ONE raw query string ("chiken brest"),
 *   counted once per replay — the corpora are eval/warm traffic, so the
 *   multiplicity measures how often the harness ran, not demand. The 12 others run
 *   the OPPOSITE way (branded incumbent displaced by a generic challenger) and
 *   read as improvements.
 *
 *   The axis is therefore BRANDED-vs-GENERIC on a generic query, not
 *   FatSecret-vs-OFF and not confidence. That is plan items #18/#6's known defect
 *   showing through. Which means the flip counterfactual must be RE-RUN after
 *   `fix/n1-name-sibling-serving-anchor` and `rerank/lane-identity-source-x-mode`
 *   land: both exist to change which record wins on exactly this axis, the
 *   challenger confidences here are real rerank outputs (all classified
 *   `not_at_clamp`, i.e. NOT laundered), so a rerank change moves them directly
 *   and can add or delete flips on either side. Numbers taken before those land
 *   do not describe the tree that would ship an unfreeze.
 *
 * Standard caveats: `topCandidates` is `filtered.slice(0, 5)`, a display cap, so
 * pool sizes read from the corpus are lower bounds; `MappingEventLog` is
 * winner-only; and the sessions are eval/warm traffic, not user traffic.
 */
import fs from 'fs';

const DIR = process.argv[2];
if (!DIR) { console.error('usage: split-flips-existing-vs-future.ts <dir> [--emit-keys]'); process.exit(2); }
// --emit-keys: instead of the two-part report, print one line per LAUNDERED
// saturated incumbent row as `normalizedForm<TAB>attributedReason`.
// `normalizedForm` is FoodMapping's PRIMARY KEY (prisma/schema.prisma:
// `normalizedForm String @id`), i.e. exactly the identifier a backfill UPDATE
// needs — which no other output of this pipeline retains (PART 1 tallies by
// verdict and discards column 0). Added 2026-08-07 for docket D1 so the
// backfill's row set is derived by the SAME classifier that measured 150,
// not by a hand-rewritten copy of it. UNATTRIBUTED rows are deliberately NOT
// emitted: a row the corpus cannot attribute is a row the backfill must not
// touch.
const EMIT_KEYS = process.argv[3] === '--emit-keys';

const CROSS_SOURCE_DISPLACEMENT_MARGIN = 0.05;
const DECLINED = 0.78;
const CACHE_HIT_REASONS = new Set(['early_cache_hit_after_normalize', 'normalized_cache_hit']);
const LAUNDERED_REASONS = new Set(['scored_by_confidence', 'basic_produce_bypass', 'confidence_gate_backstop']);

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
const srcOf = (id: string) =>
    id.startsWith('off_') ? 'openfoodfacts' : id.startsWith('fs_') ? 'fatsecret' : id.startsWith('fdc_') ? 'fdc' : '?';

// ============ PART 1: the EXISTING-row population (needs a backfill) ============
const incs = fs.readFileSync(`${DIR}/incumbents.tsv`, 'utf8').split('\n').filter(Boolean).map(l => {
    const c = l.split('\\t');
    return {
        norm: c[0],
        conf: Number(c[1]),
        target: c[2] ? `off_${c[2]}` : c[3] ? `fdc_${c[3]}` : c[4] ? (c[4].startsWith('fs_') ? c[4] : `fs_${c[4]}`) : '',
    };
});
const sat = incs.filter(i => i.conf >= 0.999);
if (EMIT_KEYS) {
    for (const i of sat) {
        const c = classify(i.target, i.conf);
        if (c.v === 'LAUNDERED') console.log(`${i.norm}\t${c.reason}`);
    }
    process.exit(0);
}
const satTally: Record<string, number> = {};
let launderedExisting = 0;
for (const i of sat) {
    const c = classify(i.target, i.conf);
    satTally[`${c.v}:${c.reason}`] = (satTally[`${c.v}:${c.reason}`] ?? 0) + 1;
    if (c.v === 'LAUNDERED') launderedExisting++;
}
console.log('=== PART 1: EXISTING FoodMapping rows ===');
console.log(`rows in snapshot: ${incs.length}`);
console.log(`at the saturated clamp (>= 0.999): ${sat.length} (${(100 * sat.length / incs.length).toFixed(1)}%)`);
for (const [k, n] of Object.entries(satTally).sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${n}`);
console.log(`LAUNDERED existing rows: ${launderedExisting}`);
console.log(`  with a backfill: bar ${(DECLINED + CROSS_SOURCE_DISPLACEMENT_MARGIN).toFixed(2)} -> displaceable`);
console.log(`  WITHOUT a backfill (what this PR ships): bar 1.05 -> still permanently frozen`);

// ============ PART 2: the flip set, split by which side must move ============
type Row = {
    raw: string; key: string; conf: number; source: string; foodId: string;
    incTarget: string; incConf: number; incName: string;
};
const rows: Row[] = JSON.parse(fs.readFileSync(`${DIR}/joined.json`, 'utf8'));
type Flip = Row & { incV: Verdict; incReason: string; chV: Verdict };
const flips: Flip[] = [];
for (const r of rows) {
    const ci = classify(r.incTarget, r.incConf), cc = classify(r.foodId, r.conf);
    const inc2 = ci.v === 'LAUNDERED' ? DECLINED : r.incConf;
    const ch2 = cc.v === 'LAUNDERED' ? DECLINED : r.conf;
    const before = r.conf >= r.incConf + CROSS_SOURCE_DISPLACEMENT_MARGIN;
    const after = ch2 >= inc2 + CROSS_SOURCE_DISPLACEMENT_MARGIN;
    if (after && !before) flips.push({ ...r, incV: ci.v, incReason: ci.reason, chV: cc.v });
}
console.log(`\n=== PART 2: FLIPS ===`);
console.log(`total flips: ${flips.length}`);
const needIncMove = flips.filter(f => f.incV === 'LAUNDERED').length;
console.log(`  need the INCUMBENT row rewritten (BACKFILL-only, NOT shipped by this PR): ${needIncMove}`);
console.log(`  reachable from the challenger side alone (would ship on merge): ${flips.length - needIncMove}`);
console.log(`  distinct incumbent rows carrying them: ${new Set(flips.map(f => f.incTarget)).size}`);
console.log(`  distinct raw query strings: ${new Set(flips.map(f => f.raw)).size}`);

console.log(`\n=== PART 3: what KIND of displacement (the axis that actually matters) ===`);
const dir: Record<string, number> = {};
for (const f of flips) { const k = `${srcOf(f.incTarget)} -> ${f.source}`; dir[k] = (dir[k] ?? 0) + 1; }
for (const [k, n] of Object.entries(dir).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
const byKey = new Map<string, Flip[]>();
for (const f of flips) { if (!byKey.has(f.key)) byKey.set(f.key, []); byKey.get(f.key)!.push(f); }
for (const [k, group] of [...byKey.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${k}  x${group.length}   incReason=${group[0].incReason}`);
    console.log(`    incumbent: ${group[0].incTarget} "${group[0].incName}" [${srcOf(group[0].incTarget)}]`);
    const chs = new Map<string, number>();
    for (const f of group) chs.set(`${f.foodId} [${f.source}]`, (chs.get(`${f.foodId} [${f.source}]`) ?? 0) + 1);
    for (const [c, n] of [...chs.entries()].sort((a, b) => b[1] - a[1])) console.log(`    challenger x${n}: ${c}`);
    console.log(`    raw lines: ${[...new Set(group.map(f => JSON.stringify(f.raw)))].join(', ')}`);
}
