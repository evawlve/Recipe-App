/**
 * semantic-recall-probe.ts — does query-side pooling actually change what
 * `searchOffSemantic()` retrieves, and by how much?
 *
 * WHY THIS EXISTS. The OFF corpus is CLS-pooled (`scripts/embed-off-cpu.ts`,
 * `scripts/embed_foods.py`) and `embedQuery()` embedded queries with `mean`
 * pooling until 2026-07-31, so queries and documents sat in different vector
 * spaces. The golden set is USELESS as the success metric for that fix: its five
 * `search/semantic` cases scored 5/5 *through* the mismatch (backend
 * `sync-docs/backend_integration_guide.md`, 2026-07-30 refresh transcript). It is
 * a regression gate, not evidence. This probe is the measurement.
 *
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/semantic-recall-probe.ts \
 *     [--limit N] [--k 10] [--json <path>]
 *
 *   --limit N   seeds to use (default 50; 0 = every eligible seed)
 *   --k K       recall@K, and the `limit` handed to searchOffSemantic (default 10)
 *   --json P    also write the full per-seed record to P
 *
 * Reads Typesense and Postgres. WRITES NOTHING. Point TYPESENSE_HOST at the box
 * (the Mac `.env` already does) — `searchOffSemantic()` reads vectors from
 * Typesense, never from pgvector, so there is no local-only way to run this.
 *
 * ------------------------------------------------------------------
 * GROUND TRUTH — where the "correct" barcodes come from, and what they are not
 * ------------------------------------------------------------------
 * Seeds are the applied repoint batches in `scripts/eval/repoints-*.json`:
 * (query seed -> the OFF record a triage agent examined and confirmed is the
 * right one), restricted to
 *   - `class: 'identity'`   — the repoint moved WHICH RECORD answers, which is
 *                             the axis retrieval controls. `nutrition` and
 *                             `ranking-gap` repoints are about panels and order,
 *                             so a retrieval probe cannot be scored on them.
 *   - `target` starting `off_` — FDC has no embeddings; only OFF is searchable
 *                             semantically.
 *   - not in `repoints-2026-07-21-reverted.json` — those six were withdrawn the
 *                             same day and are NOT ground truth.
 *   - target present in the live `off_foods` index with a 384-d embedding —
 *                             verified per-seed at startup, because a target the
 *                             index does not contain scores 0 under every pooling
 *                             and silently dilutes both arms.
 * The class filter is not incidental: `identity` is the triage label that
 * `scripts/eval/triage-drops.ts` maps `identity-query-token-dropped` onto, so
 * this population IS that failure class with barcodes attached — which the class
 * registry's own exemplars are not.
 *
 * WHAT THIS IS NOT. Recall of ONE barcode is a hard metric on generic seeds:
 * `whole milk` has thousands of defensible answers and exactly one is scored, so
 * absolute recall is a floor, not an accuracy estimate. It is still a valid A/B,
 * because the target is identical in both arms. Read the DELTA; do not quote the
 * absolute number as "semantic search finds the right food N% of the time".
 *
 * ------------------------------------------------------------------
 * CONTROLS — an instrument nobody has broken on purpose is not evidence
 * ------------------------------------------------------------------
 * (playbook §2, "Break the instrument on purpose before you quote its green")
 *
 *  C1  SAME-POOLING REPEAT (cls vs cls, and mean vs mean). Two runs of the same
 *      pooling in the same process. Any difference at all means the probe has a
 *      noise floor and no A/B smaller than it is a result. Expected: identical.
 *  C2  QUERY-VECTOR SEPARATION. Cosine between the cls and mean query vectors
 *      for every seed. If this is ~1.0 the override is not wired and the probe
 *      is running one pooling twice while reporting two.
 *  C3  RESULT-SET SEPARATION. cls and mean must retrieve different documents
 *      somewhere. Zero difference across every seed means the probe is not
 *      measuring retrieval.
 *  C4  CORPUS-POOLING RE-DERIVATION (positive control). Re-embed each sampled
 *      target's own `docText()` and cosine it against that document's STORED
 *      vector under each pooling. This is what tells you which pooling the
 *      corpus is actually in today rather than which one a doc says it is in —
 *      it goes red if the corpus is ever re-embedded differently.
 *
 * Exit codes: 0 = ran and every control passed · 1 = a control FAILED (the
 * numbers above it are not evidence) · 2 = could not run (fail closed).
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { docText } from '../embed-off-cpu';

const DIM = 384;
const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

const REPOINT_FILES = [
    'repoints-2026-07-20.json',
    'repoints-2026-07-20-pt2.json',
    'repoints-2026-07-21-bigwarm.json',
];
const REVERTED_FILE = 'repoints-2026-07-21-reverted.json';

type Pooling = 'cls' | 'mean';

interface Seed {
    query: string;
    target: string;      // off_<barcode>
    barcode: string;
    severity: string;
    source: string;      // which repoint file
    docName: string;
    docBrand: string | null;
}

interface RunResult {
    pooling: Pooling;
    label: string;
    /** query -> ordered candidate ids returned by searchOffSemantic */
    hits: Map<string, string[]>;
    vectors: Map<string, number[]>;
    /** query -> ordered barcodes from the RAW ANN call, pre-gate (diagnostic) */
    rawHits: Map<string, string[]>;
    /** query -> best cosine similarity the ANN index could offer, pre-gate */
    top1Similarity: Map<string, number>;
}

// ---------------------------------------------------------------- helpers

function cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function pct(n: number, d: number): string {
    return d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`;
}

function tsHost(): string {
    return process.env.TYPESENSE_HOST ?? 'http://localhost:8108';
}

async function tsGetDoc(barcode: string): Promise<any | null> {
    const res = await fetch(
        `${tsHost()}/collections/off_foods/documents/${encodeURIComponent(barcode)}`,
        { headers: { 'X-TYPESENSE-API-KEY': process.env.TYPESENSE_API_KEY ?? '' } },
    );
    if (!res.ok) return null;
    return res.json();
}

// ---------------------------------------------------------------- seeds

function loadSeeds(evalDir: string): { seeds: Seed[]; eligible: number } {
    const reverted = new Set<string>(
        JSON.parse(fs.readFileSync(path.join(evalDir, REVERTED_FILE), 'utf8')).map((r: any) => r.seed),
    );
    const seen = new Set<string>();
    const out: Seed[] = [];
    for (const f of REPOINT_FILES) {
        const rows = JSON.parse(fs.readFileSync(path.join(evalDir, f), 'utf8'));
        for (const r of rows) {
            if (r.class !== 'identity') continue;
            if (!String(r.target ?? '').startsWith('off_')) continue;
            if (reverted.has(r.seed)) continue;
            const query = String(r.seed).trim();
            if (!query || seen.has(query)) continue;   // one row per query text
            seen.add(query);
            out.push({
                query,
                target: r.target,
                barcode: String(r.target).slice(4),
                severity: r.severity ?? '?',
                source: f,
                docName: '',
                docBrand: null,
            });
        }
    }
    // Stable order so --limit selects the same seeds every run.
    out.sort((a, b) => (a.query < b.query ? -1 : a.query > b.query ? 1 : 0));
    return { seeds: out, eligible: out.length };
}

// ---------------------------------------------------------------- runs

async function runOnce(
    seeds: Seed[],
    pooling: Pooling,
    label: string,
    k: number,
): Promise<RunResult> {
    process.env.EMBED_QUERY_POOLING = pooling;
    const { embedQuery } = await import('../../src/lib/search/query-embedding');
    const { searchOffSemantic } = await import('../../src/lib/openfoodfacts/search');
    const { vectorSearchTypesense } = await import('../../src/lib/search/typesense-client');

    const hits = new Map<string, string[]>();
    const vectors = new Map<string, number[]>();
    const rawHits = new Map<string, string[]>();
    const top1Similarity = new Map<string, number>();

    for (const s of seeds) {
        const cands = await searchOffSemantic(s.query, { limit: k });
        hits.set(s.query, cands.map(c => c.id));

        // Diagnostic side-channel: the same embedding, straight at the ANN index,
        // so a miss can be attributed to retrieval vs to the 0.72 similarity gate
        // / nutrition filter inside searchOffSemantic. The PRIMARY metric above
        // never reads this.
        const vec = await embedQuery(s.query);
        if (vec) {
            vectors.set(s.query, vec);
            const raw = await vectorSearchTypesense('off_foods', vec, k * 2);
            rawHits.set(s.query, raw.map((d: any) => String(d.barcode)));
            if (raw.length) top1Similarity.set(s.query, 1 - (raw[0]._vectorDistance ?? 1));
        }
    }
    process.stdout.write(`  [run] ${label} (pooling=${pooling}) done — ${hits.size} seeds\n`);
    return { pooling, label, hits, vectors, rawHits, top1Similarity };
}

function recallAt(run: RunResult, seeds: Seed[], k: number): { hit: number; total: number; any: number } {
    let hit = 0, any = 0;
    for (const s of seeds) {
        const ids = run.hits.get(s.query) ?? [];
        if (ids.length > 0) any++;
        if (ids.slice(0, k).includes(s.target)) hit++;
    }
    return { hit, total: seeds.length, any };
}

function rawRecallAt(run: RunResult, seeds: Seed[], k: number): number {
    let hit = 0;
    for (const s of seeds) {
        if ((run.rawHits.get(s.query) ?? []).slice(0, k).includes(s.barcode)) hit++;
    }
    return hit;
}

/** Seeds whose returned id list differs between two runs. */
function diffSeeds(a: RunResult, b: RunResult, seeds: Seed[]): string[] {
    const out: string[] = [];
    for (const s of seeds) {
        const x = (a.hits.get(s.query) ?? []).join('|');
        const y = (b.hits.get(s.query) ?? []).join('|');
        if (x !== y) out.push(s.query);
    }
    return out;
}

// ---------------------------------------------------------------- main

async function main(): Promise<number> {
    const args = process.argv.slice(2);
    const arg = (flag: string, dflt: string) => {
        const i = args.indexOf(flag);
        return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
    };
    const limit = Number(arg('--limit', '50'));
    const k = Number(arg('--k', '10'));
    const jsonOut = arg('--json', '');

    if (process.env.SEMANTIC_SEARCH_ENABLED !== 'true') {
        console.error('FAIL: SEMANTIC_SEARCH_ENABLED is not "true" — embedQuery() returns null and every '
            + 'run would score 0 for a reason that has nothing to do with pooling.');
        return 2;
    }
    if (!process.env.TYPESENSE_API_KEY) {
        console.error('FAIL: TYPESENSE_API_KEY unset.');
        return 2;
    }

    const evalDir = __dirname;
    const { seeds: allSeeds, eligible } = loadSeeds(evalDir);
    console.log(`[seeds] ${eligible} eligible identity repoints with an off_ target (post-revert)`);

    // Verify each target is really in the index with a vector. A target the index
    // lacks scores 0 under both poolings and dilutes the A/B.
    const usable: Seed[] = [];
    const rejected: string[] = [];
    for (const s of allSeeds) {
        const doc = await tsGetDoc(s.barcode);
        if (!doc) { rejected.push(`${s.query} -> ${s.barcode} (not in off_foods)`); continue; }
        if (!Array.isArray(doc.embedding) || doc.embedding.length !== DIM) {
            rejected.push(`${s.query} -> ${s.barcode} (no ${DIM}-d embedding)`); continue;
        }
        s.docName = doc.name ?? '';
        s.docBrand = doc.brandName ?? null;
        (s as any)._stored = doc.embedding as number[];
        usable.push(s);
    }
    console.log(`[seeds] ${usable.length} targets present in off_foods with a ${DIM}-d vector; `
        + `${rejected.length} rejected`);
    for (const r of rejected.slice(0, 10)) console.log(`        reject: ${r}`);
    if (usable.length === 0) { console.error('FAIL: no usable seeds.'); return 2; }

    const seeds = limit > 0 ? usable.slice(0, limit) : usable;
    console.log(`[seeds] using ${seeds.length} (limit=${limit || 'all'}), recall@${k}\n`);

    // ---- C4: which pooling is the corpus actually in? (positive control)
    console.log('[C4] corpus-pooling re-derivation — re-embed each doc text, cosine vs its STORED vector');
    const { pipeline } = await import('@huggingface/transformers');
    const docExtractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32' });
    const sample = seeds.slice(0, 5);
    const c4: { barcode: string; cls: number; mean: number }[] = [];
    for (const s of sample) {
        const text = docText(s.docName, s.docBrand);
        const outCls = await docExtractor(text, { pooling: 'cls', normalize: true });
        const outMean = await docExtractor(text, { pooling: 'mean', normalize: true });
        const stored = (s as any)._stored as number[];
        c4.push({
            barcode: s.barcode,
            cls: cosine(Array.from(outCls.data as Float32Array), stored),
            mean: cosine(Array.from(outMean.data as Float32Array), stored),
        });
        console.log(`     ${s.barcode}  cls=${c4[c4.length - 1].cls.toFixed(5)}  `
            + `mean=${c4[c4.length - 1].mean.toFixed(5)}  "${text.slice(0, 56)}"`);
    }
    const clsAvg = c4.reduce((a, r) => a + r.cls, 0) / c4.length;
    const meanAvg = c4.reduce((a, r) => a + r.mean, 0) / c4.length;
    const corpusIs: Pooling = clsAvg >= meanAvg ? 'cls' : 'mean';
    const c4Pass = Math.abs(clsAvg - meanAvg) > 0.01;
    console.log(`     -> corpus reproduces best under '${corpusIs}' (cls ${clsAvg.toFixed(5)} vs `
        + `mean ${meanAvg.toFixed(5)}) — ${c4Pass ? 'CONCLUSIVE' : 'INCONCLUSIVE, the two poolings agree'}\n`);

    // ---- the A/B plus the same-pooling repeats, one process, one loaded model
    const runs: Record<string, RunResult> = {};
    runs.clsA = await runOnce(seeds, 'cls', 'cls run A', k);
    runs.meanA = await runOnce(seeds, 'mean', 'mean run A', k);
    runs.clsB = await runOnce(seeds, 'cls', 'cls run B (control)', k);
    runs.meanB = await runOnce(seeds, 'mean', 'mean run B (control)', k);
    console.log('');

    // ---- controls
    const c1cls = diffSeeds(runs.clsA, runs.clsB, seeds);
    const c1mean = diffSeeds(runs.meanA, runs.meanB, seeds);
    const c1Pass = c1cls.length === 0 && c1mean.length === 0;

    const sep = seeds
        .map(s => {
            const a = runs.clsA.vectors.get(s.query);
            const b = runs.meanA.vectors.get(s.query);
            return a && b ? cosine(a, b) : null;
        })
        .filter((x): x is number => x !== null);
    const sepMax = sep.length ? Math.max(...sep) : 1;
    const sepAvg = sep.length ? sep.reduce((a, b) => a + b, 0) / sep.length : 1;
    const c2Pass = sep.length > 0 && sepMax < 0.999;

    const c3 = diffSeeds(runs.clsA, runs.meanA, seeds);
    const c3Pass = c3.length > 0;

    // ---- recall
    const rows: { label: string; pooling: Pooling; r1: number; r5: number; rk: number; any: number; raw: number }[] = [];
    for (const key of ['clsA', 'meanA'] as const) {
        const r = runs[key];
        rows.push({
            label: r.label,
            pooling: r.pooling,
            r1: recallAt(r, seeds, 1).hit,
            r5: recallAt(r, seeds, 5).hit,
            rk: recallAt(r, seeds, k).hit,
            any: recallAt(r, seeds, k).any,
            raw: rawRecallAt(r, seeds, k),
        });
    }

    const N = seeds.length;
    console.log('================ RESULT ================');
    console.log(`seeds=${N}  k=${k}  corpus pooling (measured)='${corpusIs}'`);
    console.log('');
    console.log('pooling |  R@1        R@5        R@10       returned>=1  rawANN R@10');
    for (const r of rows) {
        console.log(
            `${r.pooling.padEnd(7)} | `
            + `${String(r.r1).padStart(3)} ${pct(r.r1, N).padStart(6)}  `
            + `${String(r.r5).padStart(3)} ${pct(r.r5, N).padStart(6)}  `
            + `${String(r.rk).padStart(3)} ${pct(r.rk, N).padStart(6)}  `
            + `${String(r.any).padStart(3)} ${pct(r.any, N).padStart(6)}   `
            + `${String(r.raw).padStart(3)} ${pct(r.raw, N).padStart(6)}`,
        );
    }
    const cls = rows.find(r => r.pooling === 'cls')!;
    const mn = rows.find(r => r.pooling === 'mean')!;
    console.log('');
    console.log(`delta (cls - mean): R@1 ${cls.r1 - mn.r1 >= 0 ? '+' : ''}${cls.r1 - mn.r1}`
        + `  R@5 ${cls.r5 - mn.r5 >= 0 ? '+' : ''}${cls.r5 - mn.r5}`
        + `  R@${k} ${cls.rk - mn.rk >= 0 ? '+' : ''}${cls.rk - mn.rk}`
        + `  returned>=1 ${cls.any - mn.any >= 0 ? '+' : ''}${cls.any - mn.any}`
        + `  rawANN ${cls.raw - mn.raw >= 0 ? '+' : ''}${cls.raw - mn.raw}`);

    // per-seed movement on the target
    const gained: string[] = [], lost: string[] = [];
    for (const s of seeds) {
        const inCls = (runs.clsA.hits.get(s.query) ?? []).slice(0, k).includes(s.target);
        const inMean = (runs.meanA.hits.get(s.query) ?? []).slice(0, k).includes(s.target);
        if (inCls && !inMean) gained.push(s.query);
        if (!inCls && inMean) lost.push(s.query);
    }
    console.log('');
    console.log(`target found by cls only (${gained.length}): ${gained.join(', ') || '—'}`);
    console.log(`target found by mean only (${lost.length}): ${lost.join(', ') || '—'}`);

    // ---- similarity shift: the MECHANISM behind any `returned>=1` movement.
    // searchOffSemantic drops every hit below SEMANTIC_MIN_SIMILARITY (0.72). A
    // query embedded in the wrong space sits further from every document, so the
    // gate discards the whole result set — a recall loss that never shows up as a
    // reordering. This block measures the shift directly, pre-gate.
    const SIM_GATE = 0.72;
    const simStats = (r: RunResult) => {
        const xs = seeds.map(s => r.top1Similarity.get(s.query)).filter((x): x is number => x !== undefined);
        const sorted = [...xs].sort((a, b) => a - b);
        return {
            n: xs.length,
            avg: xs.reduce((a, b) => a + b, 0) / (xs.length || 1),
            median: sorted[Math.floor(sorted.length / 2)] ?? 0,
            min: sorted[0] ?? 0,
            aboveGate: xs.filter(x => x >= SIM_GATE).length,
        };
    };
    const sc = simStats(runs.clsA), sm = simStats(runs.meanA);
    console.log('');
    console.log(`top-1 ANN similarity (pre-gate, gate=${SIM_GATE}):`);
    console.log(`  cls   avg ${sc.avg.toFixed(4)}  median ${sc.median.toFixed(4)}  min ${sc.min.toFixed(4)}  `
        + `>=gate ${sc.aboveGate}/${sc.n}`);
    console.log(`  mean  avg ${sm.avg.toFixed(4)}  median ${sm.median.toFixed(4)}  min ${sm.min.toFixed(4)}  `
        + `>=gate ${sm.aboveGate}/${sm.n}`);
    console.log(`  shift avg ${(sc.avg - sm.avg >= 0 ? '+' : '')}${(sc.avg - sm.avg).toFixed(4)}  `
        + `queries clearing the gate ${(sc.aboveGate - sm.aboveGate >= 0 ? '+' : '')}${sc.aboveGate - sm.aboveGate}`);

    console.log('');
    console.log('================ CONTROLS ================');
    console.log(`C1 same-pooling repeat .......... ${c1Pass ? 'PASS' : 'FAIL'}  `
        + `cls A/B differ on ${c1cls.length}/${N}, mean A/B differ on ${c1mean.length}/${N} (both must be 0)`);
    if (c1cls.length) console.log(`   cls movers: ${c1cls.slice(0, 8).join(', ')}`);
    if (c1mean.length) console.log(`   mean movers: ${c1mean.slice(0, 8).join(', ')}`);
    console.log(`C2 query-vector separation ...... ${c2Pass ? 'PASS' : 'FAIL'}  `
        + `cos(cls,mean) avg ${sepAvg.toFixed(4)}, max ${sepMax.toFixed(4)} (must be < 0.999)`);
    console.log(`C3 result-set separation ........ ${c3Pass ? 'PASS' : 'FAIL'}  `
        + `${c3.length}/${N} seeds return a different list under cls vs mean (must be > 0)`);
    console.log(`C4 corpus-pooling re-derivation .. ${c4Pass ? 'PASS' : 'FAIL'}  `
        + `stored vectors reproduce at cls ${clsAvg.toFixed(5)} / mean ${meanAvg.toFixed(5)}`);
    const allPass = c1Pass && c2Pass && c3Pass && c4Pass;
    console.log('');
    console.log(allPass
        ? 'All controls PASS — the recall numbers above are evidence.'
        : 'A CONTROL FAILED — the recall numbers above are NOT evidence. Read the control lines.');

    if (jsonOut) {
        const payload = {
            measuredAt: new Date().toISOString(),
            typesenseHost: tsHost(),
            seedCount: N, k, corpusPooling: corpusIs,
            recall: rows,
            top1Similarity: { gate: SIM_GATE, cls: sc, mean: sm },
            controls: {
                c1SamePoolingRepeat: { pass: c1Pass, clsMovers: c1cls, meanMovers: c1mean },
                c2QueryVectorSeparation: { pass: c2Pass, avgCosine: sepAvg, maxCosine: sepMax },
                c3ResultSetSeparation: { pass: c3Pass, differingSeeds: c3 },
                c4CorpusPooling: { pass: c4Pass, clsAvg, meanAvg, sample: c4 },
            },
            gainedByCls: gained,
            lostByCls: lost,
            perSeed: seeds.map(s => ({
                query: s.query, target: s.target, severity: s.severity, source: s.source,
                cls: runs.clsA.hits.get(s.query) ?? [],
                mean: runs.meanA.hits.get(s.query) ?? [],
            })),
        };
        fs.writeFileSync(jsonOut, JSON.stringify(payload, null, 2));
        console.log(`\n[json] wrote ${jsonOut}`);
    }

    return allPass ? 0 : 1;
}

if (require.main === module) {
    main()
        .then(c => process.exit(c))
        .catch(e => { console.error(e); process.exit(2); });
}
