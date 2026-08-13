/* Gate design step 3: what does the name-match term drop? READ-ONLY.
 *
 * Scope: ONLY the `scored_by_confidence` rows. The 22 `confidence_gate_backstop`
 * rows take the EARLIER branch of `if (!winner)` and never reach the name-match
 * term, so including them in the denominator would understate the drop rate.
 *
 * No pick is reconstructed (see risk 3: topCandidates is
 * `filtered.slice(0, MAPPING_ANALYSIS_TOP_N)`, which DEFAULTS to the historical
 * 5 -- a display cap unless a session was run with that env var raised, and
 * every file written before 2026-08-12 predates the knob). For a
 * `scored_by_confidence` decision the recorded
 * selectedCandidate IS sortedFiltered[0] by construction -- the leg does
 * `winner = sortedFiltered[0]` -- and the recorded confidence IS that
 * candidate's raw score, because the leg did `confidence = winner.score`. So
 * both inputs to the gate are read directly, not inferred.
 *
 * The query is the caller's own expression `parsed?.name || normalizedName`.
 * The analysis log's `parsed.ingredient` is written from `parsed?.name`
 * (three call sites in map-ingredient-with-fallback.ts), i.e. the first branch.
 * Rows where it is empty fall back to the raw line and are reported separately.
 */
import fs from 'fs';
import { assessConfidence, type UnifiedCandidate } from '../../../src/lib/mapping/gather-candidates';

const MIN_FALLBACK_RAW_SCORE = 0.80;
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const thresholds = process.argv[3] ? [Number(process.argv[3])] : [0.40, 0.50, 0.60, 0.70];

const scored = rows.filter((r: { reason: string }) => r.reason === 'scored_by_confidence');
const backstop = rows.filter((r: { reason: string }) => r.reason === 'confidence_gate_backstop');
console.log(`population: ${rows.length} abstention decisions`);
console.log(`  scored_by_confidence (reaches the name-match term): ${scored.length}`);
console.log(`  confidence_gate_backstop (takes the earlier branch, unaffected): ${backstop.length}`);

let noQuery = 0;
const withMatch = scored.map((r: { raw: string; parsed?: { ingredient?: string }; name: string; conf: number; foodId: string }) => {
    const q = r.parsed?.ingredient || '';
    if (!q) noQuery++;
    const query = q || r.raw;
    const cand: UnifiedCandidate = { id: r.foodId, source: 'off', name: r.name ?? '', score: r.conf, rawData: {} };
    return { r, query, usedFallbackQuery: !q, nameMatch: assessConfidence(query, cand) };
});
console.log(`  rows with an empty parsed.name (fell back to raw line): ${noQuery}`);

const belowRaw = withMatch.filter((x: { r: { conf: number } }) => x.r.conf < MIN_FALLBACK_RAW_SCORE).length;
console.log(`  rows already below MIN_FALLBACK_RAW_SCORE ${MIN_FALLBACK_RAW_SCORE}: ${belowRaw} (sanity: expect 0)`);

for (const t of thresholds) {
    const drops = withMatch.filter((x: { nameMatch: number }) => x.nameMatch < t);
    console.log(`\n=== MIN_FALLBACK_NAME_MATCH = ${t} ===`);
    console.log(`drops ${drops.length}/${scored.length} of scored_by_confidence  (${drops.length}/${rows.length} = ${(100 * drops.length / rows.length).toFixed(1)}% of all abstentions)`);
    const seen = new Set<string>();
    for (const d of drops.sort((a: { nameMatch: number }, b: { nameMatch: number }) => a.nameMatch - b.nameMatch)) {
        const sig = `${d.query}|${d.r.foodId}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        console.log(`  nameMatch=${d.nameMatch.toFixed(3)} score=${d.r.conf}  q=${JSON.stringify(d.query)} -> ${JSON.stringify(d.r.name)} [${d.r.foodId}]${d.usedFallbackQuery ? '  (RAW-LINE FALLBACK)' : ''}`);
    }
    console.log(`  distinct (query,record) pairs: ${seen.size}`);
}
