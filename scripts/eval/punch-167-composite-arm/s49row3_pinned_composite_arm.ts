/**
 * s49row3_pinned_composite_arm.ts — Lane A S49 ROW 3.
 * THE COMPOSITE-PATH GATE ARM punch #167 has never had.
 *
 * ==========================================================================
 * WHY THIS EXISTS
 * ==========================================================================
 * #167 edits `src/lib/mapping/quantity-word-brand.ts`. The documented gate,
 * `winner-gate.sh`, cannot gate it, for TWO independent reasons, both measured
 * 2026-09-12:
 *   1. `quantity-word-brand\.ts` is the 15th alternative in FROZEN_INPUT_PATHS,
 *      so the gate `exit 3`s before any node process starts. There is no --force.
 *   2. Even on the `--cross-snapshot` escape hatch it would fire ZERO times:
 *      both `mapIngredientWithFallback()` call sites in `winner-diff.ts` omit
 *      `normalizedForm` AND `brand`, and the only non-test call to
 *      `preserveDroppedBrand()` sits inside `if (options.normalizedForm?.trim())`.
 * So a green winner-gate on a #167-shaped change is a receipt for a program the
 * instrument never ran (memory `winner-diff-cannot-see-the-composite-path`).
 *
 * ==========================================================================
 * WHAT THIS PINS  (the whole point)
 * ==========================================================================
 * The segmenter output, ONCE, to disk. `mode=pin` calls `segmentTextWithAi()`
 * — the same entry point `_seg_ab_driver.ts` uses, cache-free by construction
 * because SegmentationCache lives in the parse route, not in the library — and
 * freezes, per seed line, the ordered list of segments with their three
 * composite-path fields:  rawText, normalizedForm, brand.
 *
 * `mode=replay` then feeds those IDENTICAL pinned fields to
 * `mapIngredientWithFallback(rawText, { brand, normalizedForm, … })`, which is
 * byte-for-byte the option shape `buildParsedItem()` in
 * `src/app/api/nlp/parse/route.ts` uses. Both trees replay the SAME pin file, so
 * the segmenter draw is held constant and cannot contaminate the diff.
 *
 * This is why the arm must NOT be built on `?nocache=1` HTTP probes:
 *   `const cachedSegments = noCache ? null : await lookupSegmentationCache(lineKey);`
 * nulls the segmentation cache, so every probe RE-DRAWS the LLM segmenter — the
 * exact input #167's mechanism reads. `n-prose-13` is a golden-roster rotator
 * whose recorded mechanism is "segmenter draw on a composite line", and
 * `coffee with cream and sugar` is recorded at 3 items warm on 166/166 runs
 * against 1 item on 69 of 75 cold ones.
 *
 * ==========================================================================
 * WHAT THIS DIFFS
 * ==========================================================================
 * Per ITEM (not per line), keyed by (lineIdx, itemIdx):
 *     foodId · grams · kcal · foodName · brandName · servingTier · baseNameUsed
 * `baseNameUsed` is the guard's own output, captured by wrapping the shipped
 * `preserveDroppedBrand()` — so the arm reports whether the guard FIRED and what
 * it produced, not only whether the winner moved. That matters because #167 can
 * be correct and still move no winner on a small seed set; a gate that can only
 * see winners would report SAME and teach nothing.
 *
 * ==========================================================================
 * WHAT THIS CANNOT SEE  (state it, do not discover it later)
 * ==========================================================================
 *  a. RETRIEVAL DRIFT. Unlike winner-diff there is no frozen gather pool: Typesense
 *     and Postgres are queried live on both arms, so corpus movement between the two
 *     runs is indistinguishable from a change. Mitigation: run the two arms close
 *     together and read the noise floor first.
 *  b. THE SEGMENTER ITSELF. Pinning is the point, so any #167 effect that only
 *     appears under a DIFFERENT split is invisible by construction. A segmenter
 *     change needs `_seg_ab_driver.ts`, not this.
 *  c. WARM BEHAVIOUR. `skipCache: true` forces cold resolution, so this says
 *     nothing about what an already-cached line serves. #167 moves the cache KEY
 *     (baseName is the `deriveMappingCacheKey()` input), so the cached population
 *     must be reasoned about separately — SAME here does NOT mean the stored rows
 *     are unchanged.
 *  d. THE SAVE GATES. `skipSave: true` and the write guard mean the save-time
 *     plausibility / brand-mismatch gates never run. A change that is correct
 *     pre-save and rejected at the save gate reads as a clean pass here.
 *  e. ANY CASE THE CHANGE IS SUPPOSED TO CREATE. The seed list is hand-cut from a
 *     census of lines that were ALREADY asked. Pair it with positive cases that
 *     assert the RIGHT answer, not merely a difference.
 *  f. AiNormalizeCache WARMTH. The write guard suppresses the cache write, so
 *     run 2 re-draws whatever run 1 drew. That inflates the noise floor rather
 *     than hiding movement — the honest direction — but it means a 0 floor is a
 *     claim about THIS seed set, not a general property.
 *
 * ==========================================================================
 * WRITE SAFETY  (read `s49row3_findings.md` §3 before changing any of this)
 * ==========================================================================
 * Three layers, and only the combination is sufficient:
 *   1. `skipSave: true` — gates ONE write, FoodMapping. Its own docstring says so.
 *   2. A Prisma `$use` middleware no-oping every mutating model action, the same
 *      mechanism `winner-diff.ts` uses.
 *   3. **queryRaw/queryRawUnsafe inspected for a mutating statement** — which
 *      `winner-diff.ts` does NOT do, and which is a live hole in its READ-ONLY
 *      promise: `touchAndFetchCacheRow()` bumps `AiNormalizeCache.useCount` via
 *      `prisma.$queryRaw\`UPDATE … RETURNING *\``, action `queryRaw`, absent from
 *      winner-diff's MUTATING set.
 * Every suppression is tallied and PRINTED. A run that reports zero suppressions
 * on a population that should have saved is a RED, not a pass.
 *
 * ==========================================================================
 * USAGE  (ts-node, NEVER tsx — memory `winner-diff-needs-ts-node-not-tsx`)
 * ==========================================================================
 *   cd /Users/diego/dev/Recipe-App
 *   R="npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register"
 *   $R <this> --mode pin     --seeds seeds.txt --pin pin.json
 *   $R <this> --mode replay  --pin pin.json --out armA.jsonl        # tree A
 *   $R <this> --mode replay  --pin pin.json --out armB.jsonl        # tree B (or same tree = noise floor)
 *   $R <this> --mode diff    --a armA.jsonl --b armB.jsonl
 *
 * `--dry` on replay runs everything EXCEPT the mapper call and prints the pinned
 * options each line would be given. It touches no DB and no LLM, and is the way
 * to inspect the arm without spending anything.
 */
// NO `import 'dotenv/config'`. S49 wrote this file OUTSIDE the repo, where a bare
// package specifier could not resolve; since Lane A S50 it lives IN the backend repo at
// scripts/eval/punch-167-composite-arm/, and it keeps the env-from-shell pattern
// `winner-diff.ts` uses:  set -a; . ./.env; set +a. `@/...` aliases resolve through
// tsconfig-paths. Run it from a scratchpad WORKTREE of this repo, never the main
// checkout, which Syncthing ships to the box (the USAGE `cd` above predates the move).
import * as fs from 'fs';

const arg = (n: string): string | null => {
    const i = process.argv.indexOf(n);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const has = (n: string) => process.argv.includes(n);

// ---------------------------------------------------------------- write guard
const MUTATING = new Set([
    'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany',
    'upsert', 'delete', 'deleteMany', 'executeRaw', 'executeRawUnsafe',
]);
const RAW_ACTIONS = new Set(['queryRaw', 'queryRawUnsafe']);
const MUTATING_SQL = /^\s*(UPDATE|INSERT|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i;
let suppressed: Record<string, number> = {};

/** Best-effort read of the SQL text out of a Prisma raw middleware params.args. */
function rawSqlOf(args: any): string {
    try {
        if (!args) return '';
        if (typeof args === 'string') return args;
        if (Array.isArray(args)) {
            const first = args[0];
            if (typeof first === 'string') return first;
            if (first && Array.isArray(first.strings)) return first.strings.join(' ');
            if (first && Array.isArray(first)) return first.join(' ');           // template strings array
            if (first && typeof first.sql === 'string') return first.sql;
            if (first && typeof first.text === 'string') return first.text;
        }
        if (typeof args.sql === 'string') return args.sql;
        if (Array.isArray(args.strings)) return args.strings.join(' ');
        return JSON.stringify(args).slice(0, 400);
    } catch { return ''; }
}

function installWriteGuard(prisma: any) {
    prisma.$use(async (params: any, next: any) => {
        if (MUTATING.has(params.action)) {
            const k = `${params.model ?? 'raw'}.${params.action}`;
            suppressed[k] = (suppressed[k] ?? 0) + 1;
            return null;                      // NO-OP, never throw (see winner-diff's note)
        }
        if (RAW_ACTIONS.has(params.action)) {
            const sql = rawSqlOf(params.args);
            if (MUTATING_SQL.test(sql)) {
                const k = `raw.${params.action}:MUTATING`;
                suppressed[k] = (suppressed[k] ?? 0) + 1;
                // null (not []) so touchAndFetchCacheRow's `rows[0]` throws inside its
                // OWN try/catch and it falls back to findUnique — preserving the cache
                // HIT while losing only the useCount bump.
                return null;
            }
        }
        return next(params);
    });
}

// ---------------------------------------------------------------- types
interface PinnedItem { rawText: string; normalizedForm: string | null; brand: string | null }
interface PinnedLine { line: string; items: PinnedItem[] }
interface PinFile { createdAt: string; seedsPath: string; lines: PinnedLine[] }

interface ResultRow {
    lineIdx: number; itemIdx: number; line: string;
    rawText: string; pinnedForm: string | null; pinnedBrand: string | null;
    /** the guard's own output — did preserveDroppedBrand fire, and with what? */
    guardApplied: boolean | null; guardDeclined: string | null; guardBaseName: string | null;
    foodId: string | null; foodName: string | null; brandName: string | null;
    grams: number | null; kcal: number | null; servingTier: string | null;
    error?: string;
}

// ---------------------------------------------------------------- pin
async function doPin() {
    const seedsPath = arg('--seeds'); const pinPath = arg('--pin');
    if (!seedsPath || !pinPath) { console.error('pin needs --seeds and --pin'); process.exit(1); }
    const { segmentTextWithAi } = require('@/lib/nlp/ai-segmenter');
    const seeds = fs.readFileSync(seedsPath, 'utf8').split('\n')
        .map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    const lines: PinnedLine[] = [];
    for (let i = 0; i < seeds.length; i++) {
        const line = seeds[i];
        let items: any[] | null = null;
        try { items = await segmentTextWithAi(line); } catch (e: any) {
            console.warn(`  [${i + 1}/${seeds.length}] SEGMENT-ERROR ${line}: ${e?.message}`);
        }
        // A null segmentation is what the route would treat as "one item, the whole
        // line" — pin that explicitly rather than dropping the seed, so the seed set
        // stays the same size on both arms.
        const pinned: PinnedItem[] = (items ?? [{ rawText: line, normalizedForm: null, brand: null }])
            .map((it: any) => ({
                rawText: it.rawText ?? line,
                normalizedForm: it.normalizedForm ?? null,
                brand: it.brand ?? null,
            }));
        lines.push({ line, items: pinned });
        console.warn(`  [${i + 1}/${seeds.length}] ${pinned.length} item(s)  ${line}`);
    }
    const out: PinFile = { createdAt: new Date().toISOString(), seedsPath, lines };
    fs.writeFileSync(pinPath, JSON.stringify(out, null, 2));
    console.warn(`\npinned ${lines.length} lines -> ${pinPath}`);
}

// ---------------------------------------------------------------- replay
async function doReplay() {
    const pinPath = arg('--pin'); const outPath = arg('--out'); const dry = has('--dry');
    if (!pinPath || (!outPath && !dry)) { console.error('replay needs --pin and --out (or --dry)'); process.exit(1); }
    const pin: PinFile = JSON.parse(fs.readFileSync(pinPath!, 'utf8'));

    let mapperMod: any = null, qwbMod: any = null;
    const guardSink: { applied: boolean | null; declined: string | null; baseName: string | null } =
        { applied: null, declined: null, baseName: null };

    if (!dry) {
        const { prisma } = require('@/lib/db');
        installWriteGuard(prisma);
        mapperMod = require('@/lib/mapping/map-ingredient-with-fallback');
        qwbMod = require('@/lib/mapping/quantity-word-brand');
        // Wrap the SHIPPED guard so the arm reports what it did. The mapper imports
        // it by binding at module load, so this wrap is observational only for trees
        // where the import is live-resolved; the recorded value is still the shipped
        // function's, never a replica (memory: a helper number must come from the
        // shipped function).
        const realPreserve = qwbMod.preserveDroppedBrand;
        qwbMod.preserveDroppedBrand = function (a: any) {
            const r = realPreserve(a);
            guardSink.applied = r.applied; guardSink.declined = r.declined; guardSink.baseName = r.baseName;
            return r;
        };
    }

    const rows: ResultRow[] = [];
    for (let li = 0; li < pin.lines.length; li++) {
        const L = pin.lines[li];
        for (let ii = 0; ii < L.items.length; ii++) {
            const it = L.items[ii];
            guardSink.applied = null; guardSink.declined = null; guardSink.baseName = null;
            const base: ResultRow = {
                lineIdx: li, itemIdx: ii, line: L.line, rawText: it.rawText,
                pinnedForm: it.normalizedForm, pinnedBrand: it.brand,
                guardApplied: null, guardDeclined: null, guardBaseName: null,
                foodId: null, foodName: null, brandName: null, grams: null, kcal: null, servingTier: null,
            };
            if (dry) {
                console.warn(`[${li}.${ii}] map("${it.rawText}", { brand: ${JSON.stringify(it.brand)}, ` +
                    `normalizedForm: ${JSON.stringify(it.normalizedForm)}, skipCache: true, skipSave: true })`);
                rows.push(base); continue;
            }
            try {
                // BYTE-FOR-BYTE the option shape buildParsedItem() uses in
                // src/app/api/nlp/parse/route.ts, plus the two suppressors.
                const mapped = await mapperMod.mapIngredientWithFallback(it.rawText, {
                    brand: it.brand || undefined,
                    normalizedForm: it.normalizedForm || undefined,
                    skipCache: true,
                    skipSave: true,
                });
                const ok = !!mapped && !('status' in mapped);
                if (ok) {
                    base.foodId = String((mapped as any).foodId ?? '') || null;
                    base.foodName = (mapped as any).foodName ?? null;
                    base.brandName = (mapped as any).brandName ?? null;
                    base.grams = (mapped as any).grams ?? null;
                    base.kcal = (mapped as any).calories ?? (mapped as any).kcal ?? null;
                    base.servingTier = (mapped as any).servingTier ?? null;
                } else {
                    base.error = `unmapped:${(mapped as any)?.status ?? 'null'}`;
                }
            } catch (e: any) {
                base.error = e?.message ?? String(e);
            }
            base.guardApplied = guardSink.applied;
            base.guardDeclined = guardSink.declined;
            base.guardBaseName = guardSink.baseName;
            rows.push(base);
            console.warn(`[${li}.${ii}] ${base.foodId ?? base.error}  g=${base.grams} kcal=${base.kcal}` +
                `  guard=${base.guardApplied === null ? 'not-reached' : base.guardApplied ? `APPLIED "${base.guardBaseName}"` : `declined:${base.guardDeclined}`}`);
        }
    }

    if (!dry) {
        fs.writeFileSync(outPath!, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
        console.warn(`\nwrote ${rows.length} item rows -> ${outPath}`);
    }
    console.warn(`SUPPRESSED WRITES: ${JSON.stringify(suppressed)}`);
    if (!dry && Object.keys(suppressed).length === 0) {
        console.warn('!! ZERO suppressions. On a cold population that should have SAVED, that is a RED:');
        console.warn('!! it means the guard is not installed on the client the mapper actually uses.');
    }
}

// ---------------------------------------------------------------- diff
function doDiff() {
    const aPath = arg('--a'); const bPath = arg('--b');
    if (!aPath || !bPath) { console.error('diff needs --a and --b'); process.exit(1); }
    const load = (p: string): Map<string, ResultRow> => {
        const m = new Map<string, ResultRow>();
        for (const l of fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
            const r: ResultRow = JSON.parse(l);
            m.set(`${r.lineIdx}.${r.itemIdx}`, r);
        }
        return m;
    };
    const A = load(aPath), B = load(bPath);
    const keys = [...new Set([...A.keys(), ...B.keys()])].sort();
    const FIELDS: Array<keyof ResultRow> = ['foodId', 'grams', 'kcal', 'guardApplied', 'guardBaseName'];
    let same = 0; const moved: string[] = []; const onlyOne: string[] = [];
    for (const k of keys) {
        const a = A.get(k), b = B.get(k);
        if (!a || !b) { onlyOne.push(k); continue; }
        const diffs = FIELDS.filter(f => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
        if (diffs.length === 0) { same++; continue; }
        moved.push(`${k}  "${a.rawText}"\n` + diffs.map(f =>
            `        ${String(f)}: ${JSON.stringify(a[f])}  ->  ${JSON.stringify(b[f])}`).join('\n'));
    }
    console.warn(`items compared : ${keys.length}`);
    console.warn(`SAME           : ${same}`);
    console.warn(`MOVED          : ${moved.length}`);
    console.warn(`ITEM-COUNT MISMATCH (one arm only): ${onlyOne.length}  ${onlyOne.join(' ')}`);
    if (moved.length) { console.warn(''); for (const m of moved) console.warn('  ' + m); }
    console.warn('');
    console.warn('A noise-floor run is A vs B on the SAME tree. MOVED must be 0 before any');
    console.warn('two-tree diff is readable. A non-zero floor is a finding about the ARM.');
}

async function main() {
    const mode = arg('--mode');
    if (mode === 'pin') return doPin();
    if (mode === 'replay') return doReplay();
    if (mode === 'diff') return doDiff();
    console.error('usage: --mode pin|replay|diff   (see header)');
    process.exit(1);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
