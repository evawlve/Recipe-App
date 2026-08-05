/**
 * _lane_identity_probe.ts — read-only probe for Phase 2 item #18.
 *
 * Question: if lane identity in buildRerankPool() becomes `source x retrieval
 * mode` instead of `source`, what actually changes, and is the discriminator
 * sound?
 *
 * The discriminator is suspect by construction. gatherCandidates() dedupes by
 * id and, on a hit, MERGES semanticSimilarity onto the surviving KEYWORD copy
 * (`existing.semanticSimilarity = Math.max(...)`), keeping it at its keyword
 * position. So `semanticSimilarity != null` is a superset of "arrived by
 * semantic search", not a partition of it.
 *
 * Provenance is still recoverable positionally: searchOffSemantic() is pushed
 * LAST into searchPromises, Promise.allSettled preserves order, and only rows
 * absent from byId are appended. So within one source's candidates in gather
 * order, the semantic-ONLY block is the maximal trailing run whose members all
 * carry the flag. A flagged row before that run overlapped the keyword result
 * set. That labelling is a lower bound on overlap: a flagged row sitting at the
 * very end of the keyword block is absorbed into the trailing run.
 *
 * Window computation is EXACT and does not depend on that labelling — it calls
 * the real buildRerankPool() for the baseline and a keyed transcription for the
 * variant, and the transcription is proven against the real function on every
 * row before any number is quoted.
 *
 * Read-only: no DB, no network, no writes. Reads two JSON files.
 *
 * Run:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/_lane_identity_probe.ts \
 *     --snapshot <snap.json> --replay <replay.json>
 */

import * as fs from 'fs';
import { buildRerankPool, RERANK_POOL_LIMIT } from '../../src/lib/mapping/rerank-pool';

type Meta = {
    id: string;
    source?: string | null;
    sem: number | null;
    name: string;
    brandName?: string | null;
    score?: number | null;
};

const argStr = (n: string): string | undefined => {
    const i = process.argv.indexOf(`--${n}`);
    if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
    const eq = process.argv.find(a => a.startsWith(`--${n}=`));
    return eq ? eq.slice(n.length + 3) : undefined;
};

/**
 * Faithful transcription of buildRerankPool() with a pluggable lane key.
 * Proven equivalent to the imported original (keyed on `source`) on every row
 * before any variant number is reported — see PORT-CHECK below.
 */
function buildRerankPoolKeyed<T extends { source?: string | null }>(
    candidates: readonly T[],
    limit: number,
    laneKey: (c: T) => string,
): T[] {
    if (limit <= 0) return [];
    if (candidates.length <= limit) return candidates.slice();

    const lanes = new Map<string, T[]>();
    for (const c of candidates) {
        const key = laneKey(c);
        const lane = lanes.get(key);
        if (lane) lane.push(c);
        else lanes.set(key, [c]);
    }
    if (lanes.size <= 1) return candidates.slice(0, limit);

    const out: T[] = [];
    const cursors = new Map<string, number>();
    let progressed = true;
    while (out.length < limit && progressed) {
        progressed = false;
        for (const [key, lane] of lanes) {
            if (out.length >= limit) break;
            const cur = cursors.get(key) ?? 0;
            if (cur >= lane.length) continue;
            out.push(lane[cur]);
            cursors.set(key, cur + 1);
            progressed = true;
        }
    }
    return out;
}

const KEY_OLD = (c: Meta) => c.source ?? '';
/** The FLAT split, gated 2026-08-04 and rejected: it hands a split source two
 *  round-robin slots per pass, taken from the sources that did not split. Kept
 *  so the rejection stays reproducible, not because it is a candidate. */
const KEY_FLAT = (c: Meta) => `${c.source ?? ''}#${c.sem != null ? 's' : 'k'}`;

/**
 * The NESTED split — outer round-robin over `source`, inner rotation over that
 * source's retrieval blocks. Transcribed from buildRerankPool() on branch
 * `rerank/lane-identity-source-x-mode`; PORT-CHECK below proves the shared
 * skeleton against the real function before any number is quoted.
 */
function buildNested(candidates: readonly Meta[], limit: number): Meta[] {
    if (limit <= 0) return [];
    if (candidates.length <= limit) return candidates.slice();

    const sources = new Map<string, Map<string, Meta[]>>();
    for (const c of candidates) {
        const src = c.source ?? '';
        let modes = sources.get(src);
        if (!modes) { modes = new Map(); sources.set(src, modes); }
        const mode = c.sem != null ? 's' : 'k';
        const bucket = modes.get(mode);
        if (bucket) bucket.push(c);
        else modes.set(mode, [c]);
    }
    if (sources.size <= 1) {
        const only = sources.values().next().value;
        if (!only || only.size <= 1) return candidates.slice(0, limit);
    }

    const out: Meta[] = [];
    const modeCursor = new Map<string, number>();
    const cursors = new Map<string, number>();
    let progressed = true;
    while (out.length < limit && progressed) {
        progressed = false;
        for (const [src, modes] of sources) {
            if (out.length >= limit) break;
            const modeKeys = [...modes.keys()];
            let taken = false;
            for (let n = 0; n < modeKeys.length && !taken; n++) {
                const mk = modeKeys[((modeCursor.get(src) ?? 0) + n) % modeKeys.length];
                const ck = `${src} ${mk}`;
                const i = cursors.get(ck) ?? 0;
                const bucket = modes.get(mk)!;
                if (i >= bucket.length) continue;
                out.push(bucket[i]);
                cursors.set(ck, i + 1);
                modeCursor.set(src, ((modeCursor.get(src) ?? 0) + n + 1) % modeKeys.length);
                taken = true;
            }
            if (taken) progressed = true;
        }
    }
    return out;
}

/**
 * Positional provenance within one source's candidates, in gather order.
 * Returns the index at which the semantic-only trailing run begins, or
 * lane.length if there is none.
 */
function semanticOnlyStart(lane: Meta[]): number {
    let i = lane.length;
    while (i > 0 && lane[i - 1].sem != null) i--;
    return i;
}

function main() {
    const snapPath = argStr('snapshot');
    const replayPath = argStr('replay');
    if (!snapPath || !replayPath) {
        console.error('need --snapshot <file> --replay <file>');
        process.exit(2);
    }

    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    const replay = JSON.parse(fs.readFileSync(replayPath, 'utf8'));

    // id -> meta, per query (ids are not globally unique across queries in
    // meaning, but candidate metadata for the same id is stable; key by query
    // to stay honest).
    const metaByQuery = new Map<string, Map<string, Meta>>();
    for (const e of snap.entries ?? []) {
        const m = new Map<string, Meta>();
        for (const c of e.candidates ?? []) {
            m.set(c.id, {
                id: c.id,
                source: c.source,
                sem: c.semanticSimilarity ?? null,
                name: c.name,
                brandName: c.brandName ?? null,
                score: c.score ?? null,
            });
        }
        metaByQuery.set(e.query, m);
    }

    const variant = (argStr('variant') ?? 'nested') as 'flat' | 'nested';
    if (variant !== 'flat' && variant !== 'nested') {
        console.error('--variant must be flat | nested');
        process.exit(2);
    }
    let budgetViolations = 0;

    let rows = 0;
    let skippedNoMeta = 0;
    let skippedCountLabel = 0;
    let portMismatch = 0;
    const portMismatchQueries: string[] = [];

    let windowChanged = 0;
    let winnerInNewWindowOnly = 0;

    // Composition of what the new OFF-semantic lane admits.
    let newAdmitsSemanticOnly = 0;   // genuinely rescued: tail rows
    let newAdmitsOverlap = 0;        // wasted slot: flagged but keyword-positioned
    let evictedTotal = 0;

    // Discriminator soundness over ALL admitted OFF candidates.
    let offTotal = 0;
    let offFlagged = 0;
    let offFlaggedOverlap = 0;
    let offFlaggedSemanticOnly = 0;
    let queriesWithAnyOverlap = 0;
    let queriesWithOffSplit = 0;

    const examples: string[] = [];

    for (const row of replay.rows ?? []) {
        if (!row.admittedIds || row.admittedIds.length === 0) continue;
        const meta = metaByQuery.get(row.query);
        if (!meta) { skippedNoMeta++; continue; }

        const filtered: Meta[] = [];
        let missing = false;
        for (const id of row.admittedIds) {
            const m = meta.get(id);
            if (!m) { missing = true; break; }
            filtered.push(m);
        }
        if (missing) { skippedNoMeta++; continue; }

        // The caller extends the window past the limit for count-label rows.
        // buildRerankPool() cannot reproduce those; exclude rather than quote.
        if ((row.rerankWindowIds?.length ?? 0) > RERANK_POOL_LIMIT) {
            skippedCountLabel++;
            continue;
        }

        // PORT-CHECK: the transcription must equal the real function on the
        // old key, and the real function must equal what the harness recorded.
        const real = buildRerankPool(filtered, RERANK_POOL_LIMIT).map(c => c.id);
        const ported = buildRerankPoolKeyed(filtered, RERANK_POOL_LIMIT, KEY_OLD).map(c => c.id);
        if (real.join(',') !== ported.join(',')) {
            portMismatch++;
            if (portMismatchQueries.length < 5) portMismatchQueries.push(row.query);
            continue;
        }
        if (row.rerankWindowIds && row.rerankWindowIds.length > 0
            && real.join(',') !== row.rerankWindowIds.join(',')) {
            portMismatch++;
            if (portMismatchQueries.length < 5) portMismatchQueries.push(`${row.query} (vs harness)`);
            continue;
        }

        rows++;

        // Provenance labelling, per source lane, in gather order.
        const offLane = filtered.filter(c => c.source === 'openfoodfacts');
        const cut = semanticOnlyStart(offLane);
        const semOnlyIds = new Set(offLane.slice(cut).map(c => c.id));
        const overlapIds = new Set(
            offLane.slice(0, cut).filter(c => c.sem != null).map(c => c.id),
        );

        offTotal += offLane.length;
        offFlagged += offLane.filter(c => c.sem != null).length;
        offFlaggedOverlap += overlapIds.size;
        offFlaggedSemanticOnly += semOnlyIds.size;
        if (overlapIds.size > 0) queriesWithAnyOverlap++;
        if (semOnlyIds.size > 0 && cut > 0) queriesWithOffSplit++;

        const newWin = (variant === 'flat'
            ? buildRerankPoolKeyed(filtered, RERANK_POOL_LIMIT, KEY_FLAT)
            : buildNested(filtered, RERANK_POOL_LIMIT)).map(c => c.id);
        // Invariant 6, checked per row rather than asserted: the nested form must
        // not change any source's share. Counted, and reported, never assumed.
        if (variant === 'nested') {
            const share = (ids: string[]) => {
                const m: Record<string, number> = {};
                for (const id of ids) { const s = meta.get(id)!.source ?? ''; m[s] = (m[s] ?? 0) + 1; }
                return JSON.stringify(Object.entries(m).sort());
            };
            if (share(real) !== share(newWin)) budgetViolations++;
        }
        const oldSet = new Set(real);
        const newSet = new Set(newWin);
        const added = newWin.filter(id => !oldSet.has(id));
        const evicted = real.filter(id => !newSet.has(id));

        if (added.length > 0 || evicted.length > 0) {
            windowChanged++;
            evictedTotal += evicted.length;
            for (const id of added) {
                if (semOnlyIds.has(id)) newAdmitsSemanticOnly++;
                else if (overlapIds.has(id)) newAdmitsOverlap++;
            }
            if (examples.length < 12) {
                const nm = (id: string) => {
                    const m = meta.get(id)!;
                    const tag = semOnlyIds.has(id) ? 'sem-only' : overlapIds.has(id) ? 'OVERLAP' : 'kw';
                    return `${m.name.slice(0, 34)}${m.brandName ? ` [${m.brandName.slice(0, 14)}]` : ' [generic]'} (${tag})`;
                };
                examples.push(
                    `  "${row.query}"  +${added.length}/-${evicted.length}\n` +
                    added.map(id => `      + ${nm(id)}`).join('\n') +
                    (evicted.length ? '\n' + evicted.map(id => `      - ${nm(id)}`).join('\n') : ''),
                );
            }
        }

        const wid = row.winner?.foodId;
        if (wid && !oldSet.has(wid) && newSet.has(wid)) winnerInNewWindowOnly++;
    }

    const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`);

    console.log(`\n=== LANE IDENTITY PROBE — variant=${variant} ===`);
    console.log(variant === 'nested'
        ? '    baseline `source`  vs  outer source / inner retrieval mode (budget-neutral)'
        : '    baseline `source`  vs  FLAT source#mode  (GATED AND REJECTED 2026-08-04)');
    console.log(`snapshot: ${snapPath}`);
    console.log(`replay:   ${replayPath}\n`);
    console.log(`rows usable                 ${rows}`);
    console.log(`  skipped, no snapshot meta ${skippedNoMeta}`);
    console.log(`  skipped, count-label ext  ${skippedCountLabel}   (|window| > ${RERANK_POOL_LIMIT}; caller-side, not reproducible here)`);
    console.log(`  PORT MISMATCH             ${portMismatch}${portMismatchQueries.length ? '  e.g. ' + portMismatchQueries.join(' | ') : ''}`);

    console.log(`\n--- DISCRIMINATOR SOUNDNESS (is semanticSimilarity a partition?) ---`);
    console.log(`admitted OFF candidates      ${offTotal}`);
    console.log(`  carrying the flag          ${offFlagged}  (${pct(offFlagged, offTotal)} of OFF)`);
    console.log(`    semantic-only (tail)     ${offFlaggedSemanticOnly}  (${pct(offFlaggedSemanticOnly, offFlagged)} of flagged)`);
    console.log(`    OVERLAP (kw-positioned)  ${offFlaggedOverlap}  (${pct(offFlaggedOverlap, offFlagged)} of flagged)  <-- misattributed by the proposed key`);
    console.log(`queries with any overlap     ${queriesWithAnyOverlap} / ${rows}  (${pct(queriesWithAnyOverlap, rows)})`);
    console.log(`queries where OFF splits     ${queriesWithOffSplit} / ${rows}  (${pct(queriesWithOffSplit, rows)})`);

    console.log(`\n--- WINDOW EFFECT (exact; independent of the labelling above) ---`);
    console.log(`window changes               ${windowChanged} / ${rows}  (${pct(windowChanged, rows)})`);
    console.log(`  slots given to sem-only    ${newAdmitsSemanticOnly}   <-- the intended rescue`);
    console.log(`  slots given to OVERLAP     ${newAdmitsOverlap}   <-- wasted: keyword already surfaced these`);
    console.log(`  candidates evicted         ${evictedTotal}`);
    if (variant === 'nested') {
        console.log(`  INVARIANT 6 violations     ${budgetViolations}   (a source's share changed; must be 0)`);
    }
    console.log(`baseline winner reachable only in NEW window: ${winnerInNewWindowOnly}`);

    if (examples.length) {
        console.log(`\n--- EXAMPLES ---`);
        console.log(examples.join('\n'));
    }
    console.log();
}

main();
