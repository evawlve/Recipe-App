/**
 * s51_normalize_capture.ts — Lane A S51 ROW 2 (backend punch #114). READ-ONLY capture.
 * ==========================================================================
 * WHAT IT MEASURES
 * The exact string the SHIPPED mapper hands `normalizeIngredientName()` the first time it
 * calls it, for two populations:
 *   (i)  every distinct SegmentationCache segment tuple, on the COMPOSITE path —
 *        `mapIngredientWithFallback(rawText, { brand, normalizedForm, ... })`, the option
 *        shape `buildParsedItem()` in src/app/api/nlp/parse/route.ts uses;
 *   (ii) every distinct MappingEventLog.rawLine, on the SOLO path — the same builder with
 *        the `brand: ''` / `normalizedForm: ''` item `singleItemFromText()` returns, i.e.
 *        both options `undefined`.
 * The export `normalizeIngredientName` of `@/lib/mapping/normalization-rules` is wrapped:
 * the wrapper runs the real function (recording its argument and this tree's `cleaned` /
 * `nounOnly`) and then THROWS a sentinel, which aborts the mapper at that first call. The
 * mapper binds the import through the CommonJS exports object, so the wrap is live; the
 * self-test below proves it on `rice` before any population row runs.
 *
 * WRITE SAFETY
 *   1. `skipCache: true, skipSave: true`.
 *   2. The shared Prisma write guard from `scripts/eval/winner-diff-write-guard.ts` of the
 *      tree this runs in (mutating model actions no-oped; raw queries opening with a
 *      mutating verb no-oped). It is installed BEFORE the mapper module is loaded, and
 *      every suppression is tallied and printed.
 *   3. The only DB statement reachable before the first call is `findCanonicalName()`'s
 *      `learnedSynonym.findMany` (a read) and, on a LearnedSynonym hit, its
 *      `learnedSynonym.update` useCount bump — suppressed by (2) and tallied.
 *   4. The only LLM reachable before the first call is `aiParseIngredient()` (purpose
 *      `parse`). It is wrapped and CAPPED: past `--max-ai-parse` calls the run aborts
 *      before spending. `--dry` counts the trigger predicate without any DB or LLM.
 *
 * USAGE (ts-node, never tsx; cwd = the tree whose src you mean; env from the shell)
 *   set -a; . ./.env; set +a
 *   R="npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register"
 *   $R <this> --dry     --tuples seg.csv --mel mel.csv
 *   $R <this>           --tuples seg.csv --mel mel.csv --out args.jsonl --raw-out raw.jsonl \
 *                       [--max-ai-parse 40] [--limit N]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const arg = (n: string): string | null => {
    const i = process.argv.indexOf(n);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const has = (n: string) => process.argv.includes(n);

// ---------------------------------------------------------------- csv (RFC 4180)
interface Cell { v: string; q: boolean }
function parseCsv(text: string): Cell[][] {
    const rows: Cell[][] = [];
    let row: Cell[] = []; let cell = ''; let quoted = false; let inQ = false; let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (inQ) {
            if (c === '"') {
                if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
                inQ = false; i++; continue;
            }
            cell += c; i++; continue;
        }
        if (c === '"') { inQ = true; quoted = true; i++; continue; }
        if (c === ',') { row.push({ v: cell, q: quoted }); cell = ''; quoted = false; i++; continue; }
        if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push({ v: cell, q: quoted }); rows.push(row); row = []; cell = ''; quoted = false; i++; continue;
        }
        cell += c; i++;
    }
    if (cell !== '' || quoted || row.length) { row.push({ v: cell, q: quoted }); rows.push(row); }
    return rows;
}
/** Unquoted empty = SQL NULL under COPY csv; quoted "" = empty string. */
const nullable = (c: Cell | undefined): string | null => (!c ? null : (c.v === '' && !c.q ? null : c.v));

interface Input {
    path: 'composite' | 'solo';
    rawText: string;
    normalizedForm: string | null;
    brand: string | null;
    melEvents?: number;
    melAnyOrganic?: boolean;
}

function loadInputs(tuplesPath: string, melPath: string): { composite: Input[]; solo: Input[] } {
    const t = parseCsv(fs.readFileSync(tuplesPath, 'utf8'));
    const th = t.shift()!.map(c => c.v).join(',');
    if (th !== 'rawText,normalizedForm,brand') throw new Error(`unexpected tuples header ${th}`);
    const composite: Input[] = [];
    const seenT = new Set<string>();
    for (const r of t) {
        if (r.length !== 3) throw new Error(`tuples row with ${r.length} cells: ${JSON.stringify(r)}`);
        const inp: Input = { path: 'composite', rawText: r[0].v, normalizedForm: nullable(r[1]), brand: nullable(r[2]) };
        const k = JSON.stringify([inp.rawText, inp.normalizedForm, inp.brand]);
        if (seenT.has(k)) throw new Error(`duplicate tuple ${k}`);
        seenT.add(k); composite.push(inp);
    }
    const m = parseCsv(fs.readFileSync(melPath, 'utf8'));
    const mh = m.shift()!.map(c => c.v).join(',');
    if (mh !== 'rawLine,n,any_organic') throw new Error(`unexpected mel header ${mh}`);
    const solo: Input[] = [];
    const seenM = new Set<string>();
    for (const r of m) {
        if (r.length !== 3) throw new Error(`mel row with ${r.length} cells: ${JSON.stringify(r)}`);
        if (seenM.has(r[0].v)) throw new Error(`duplicate rawLine ${r[0].v}`);
        seenM.add(r[0].v);
        solo.push({ path: 'solo', rawText: r[0].v, normalizedForm: null, brand: null,
            melEvents: parseInt(r[1].v, 10), melAnyOrganic: r[2].v === 't' });
    }
    return { composite, solo };
}

// ---------------------------------------------------------------- provenance
function provenance() {
    const cwd = process.cwd();
    const rulesPath = path.join(cwd, 'data/fatsecret/normalization-rules.json');
    const sha = crypto.createHash('sha256').update(fs.readFileSync(rulesPath)).digest('hex');
    const resolvedRules = require.resolve('@/lib/mapping/normalization-rules');
    const resolvedMapper = require.resolve('@/lib/mapping/map-ingredient-with-fallback');
    return { cwd, rulesSha256: sha, resolvedRules, resolvedMapper };
}

// ---------------------------------------------------------------- dry pre-count
/** REPLICA of the aiParseIngredient trigger in preflightIngredientLine() (Step 1-AI-FALLBACK),
 *  for the pre-count ONLY. It ignores findCanonicalName(), which can change the parsed
 *  line for a British synonym. The live run counts the real calls through the wrap. */
function aiParseWouldTrigger(parseIngredientLine: (s: string) => any, rawLine: string): boolean {
    const trimmed = rawLine.trim();
    if (!trimmed) return false;
    const pre = trimmed.replace(/\bseconds?\s+(spray|squirt)s?\b/gi, '$1').replace(/\bsec\s+(spray|squirt)s?\b/gi, '$1');
    const parsed = parseIngredientLine(pre);
    const looksLikeHasUnit = /\d+\s*(floz|fl\s*oz|oz|cup|tbsp|tsp|ml|g|lb|lbs|serving)\b/i.test(trimmed);
    return !parsed?.unit && looksLikeHasUnit;
}

// ---------------------------------------------------------------- main
class Sentinel extends Error { constructor() { super('S51_NORMALIZE_SENTINEL'); } }
class CapReached extends Error { constructor(n: number) { super(`S51_AI_PARSE_CAP_REACHED after ${n}`); } }

async function main() {
    const tuplesPath = arg('--tuples'); const melPath = arg('--mel');
    if (!tuplesPath || !melPath) { console.error('need --tuples and --mel'); process.exit(1); }
    const { composite, solo } = loadInputs(tuplesPath, melPath);
    const limit = arg('--limit') ? parseInt(arg('--limit')!, 10) : null;
    const population = [...composite, ...solo];
    const run = limit ? [...composite.slice(0, limit), ...solo.slice(0, limit)] : population;
    const prov = provenance();
    console.log(`PROVENANCE ${JSON.stringify(prov)}`);
    console.log(`population: composite tuples ${composite.length}, solo MEL rawLines ${solo.length}; this run ${run.length}`);

    if (has('--dry')) {
        const { parseIngredientLine } = require('@/lib/parse/ingredient-line');
        const hits = run.filter(r => aiParseWouldTrigger(parseIngredientLine, r.rawText));
        const distinct = new Set(hits.map(h => h.rawText.trim()));
        console.log(`DRY aiParseIngredient trigger (replica): ${hits.length} inputs, ${distinct.size} distinct trimmed lines ` +
            `(composite ${hits.filter(h => h.path === 'composite').length}, solo ${hits.filter(h => h.path === 'solo').length})`);
        for (const h of hits) console.log(`  [${h.path}] ${JSON.stringify(h.rawText)}`);
        return;
    }

    const outPath = arg('--out'); const rawOut = arg('--raw-out');
    if (!outPath || !rawOut) { console.error('need --out and --raw-out'); process.exit(1); }
    const cap = parseInt(arg('--max-ai-parse') ?? '40', 10);

    // 1. guard BEFORE the mapper loads
    const suppressed: Record<string, number> = {};
    const { prisma } = require('@/lib/db');
    const guardMod = require(path.join(process.cwd(), 'scripts/eval/winner-diff-write-guard'));
    guardMod.installWriteGuard(prisma, (k: string) => { suppressed[k] = (suppressed[k] ?? 0) + 1; });

    // 2. wraps
    const nr = require('@/lib/mapping/normalization-rules');
    const treeHasCollapse = typeof nr.collapseAdjacentRepeatedRuns === 'function';
    console.log(`tree exports collapseAdjacentRepeatedRuns: ${treeHasCollapse}  (master must read false)`);
    const realNormalize = nr.normalizeIngredientName;
    let sink: { arg: string; cleaned: string; nounOnly: string; site: string } | null = null;
    nr.normalizeIngredientName = function (raw: string) {
        const out = realNormalize(raw);
        const frames = (new Error().stack ?? '').split('\n').slice(2);
        const f = frames.find(l => l.includes('/src/')) ?? frames[0] ?? '';
        const m = f.match(/\/src\/([^):]+):(\d+)/);
        sink = { arg: raw, cleaned: out.cleaned, nounOnly: out.nounOnly, site: m ? `${m[1]}:${m[2]}` : f.trim() };
        throw new Sentinel();
    };
    const aiMod = require('@/lib/mapping/ai-parse');
    const realAiParse = aiMod.aiParseIngredient;
    let aiParseCalls = 0;
    const aiParseLines: string[] = [];
    aiMod.aiParseIngredient = async function (line: string) {
        if (aiParseCalls >= cap) throw new CapReached(aiParseCalls);
        aiParseCalls++; aiParseLines.push(line);
        return realAiParse(line);
    };
    const mapper = require('@/lib/mapping/map-ingredient-with-fallback');
    const metrics = require('@/lib/ai/llm-usage-metrics');

    const callOne = async (inp: Input) => {
        sink = null;
        const before = aiParseCalls;
        const row: any = { path: inp.path, rawText: inp.rawText, normalizedForm: inp.normalizedForm, brand: inp.brand };
        try {
            // buildParsedItem()'s option shape: `brand || undefined`, `normalizedForm || undefined`.
            const res = await mapper.mapIngredientWithFallback(inp.rawText, {
                brand: inp.brand || undefined,
                normalizedForm: inp.normalizedForm || undefined,
                skipCache: true,
                skipSave: true,
                telemetry: {},
            });
            row.reached = false;
            row.outcome = res === null ? 'null' : ('status' in res ? `status:${res.status}` : `mapped:${res.foodId}`);
        } catch (e: any) {
            if (e instanceof CapReached) throw e;
            if (e instanceof Sentinel && sink) {
                row.reached = true; row.arg = sink.arg; row.cleaned = sink.cleaned; row.nounOnly = sink.nounOnly; row.site = sink.site;
            } else {
                row.reached = false; row.error = e?.message ?? String(e);
            }
        }
        row.aiParse = aiParseCalls - before;
        return row;
    };

    // 3. self-test: the wrap must bind
    const st = await callOne({ path: 'solo', rawText: 'rice', normalizedForm: null, brand: null });
    console.log(`SELF-TEST rice -> ${JSON.stringify(st)}`);
    if (!st.reached || st.arg !== 'rice') { console.log('!! wrap did not bind; aborting'); process.exit(4); }

    // 4. population
    const rows: any[] = [];
    try {
        for (let i = 0; i < run.length; i++) {
            const r = await callOne(run[i]);
            if (run[i].melEvents !== undefined) { r.melEvents = run[i].melEvents; r.melAnyOrganic = run[i].melAnyOrganic; }
            rows.push(r);
            if ((i + 1) % 500 === 0) console.error(`  ${i + 1}/${run.length}  aiParse=${aiParseCalls}  suppressed=${JSON.stringify(suppressed)}`);
        }
    } catch (e: any) {
        fs.writeFileSync(rawOut, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
        console.log(`!! ${e?.message} — partial raw rows (${rows.length}) -> ${rawOut}; NO args file written`);
        console.log(`aiParse lines so far: ${JSON.stringify(aiParseLines)}`);
        console.log(`SUPPRESSED WRITES: ${JSON.stringify(suppressed)}`);
        console.log(`LLM SNAPSHOT: ${JSON.stringify(metrics.getLlmUsageSnapshot())}`);
        process.exit(3);
    }
    fs.writeFileSync(rawOut, rows.map(r => JSON.stringify(r)).join('\n') + '\n');

    // 5. aggregate distinct arguments
    const byArg = new Map<string, any>();
    for (const r of rows) {
        if (!r.reached) continue;
        let a = byArg.get(r.arg);
        if (!a) {
            a = { arg: r.arg, masterCleaned: r.cleaned, masterNounOnly: r.nounOnly, compositeTuples: 0, soloMelLines: 0, soloMelEvents: 0, sites: {}, examples: [] };
            byArg.set(r.arg, a);
        } else if (a.masterCleaned !== r.cleaned || a.masterNounOnly !== r.nounOnly) {
            throw new Error(`impure: same arg, different output: ${r.arg}`);
        }
        if (r.path === 'composite') a.compositeTuples++; else { a.soloMelLines++; a.soloMelEvents += r.melEvents ?? 0; }
        a.sites[r.site] = (a.sites[r.site] ?? 0) + 1;
        if (a.examples.length < 3) a.examples.push(`${r.path}:${r.rawText}${r.normalizedForm ? ` | nf=${r.normalizedForm}` : ''}${r.brand ? ` | brand=${r.brand}` : ''}`);
    }
    const args = [...byArg.values()].sort((x, y) => (x.arg < y.arg ? -1 : x.arg > y.arg ? 1 : 0));
    fs.writeFileSync(outPath, args.map(a => JSON.stringify(a)).join('\n') + '\n');

    // 6. report
    const comp = rows.filter(r => r.path === 'composite'); const sol = rows.filter(r => r.path === 'solo');
    const tally = (rs: any[]) => {
        const t: Record<string, number> = {};
        for (const r of rs) { const k = r.reached ? `reached@${r.site}` : r.error ? `error:${r.error.slice(0, 80)}` : `not-reached:${String(r.outcome).split(':')[0]}`; t[k] = (t[k] ?? 0) + 1; }
        return t;
    };
    console.log(`composite: ${comp.length} tuples, reached ${comp.filter(r => r.reached).length}  ${JSON.stringify(tally(comp))}`);
    console.log(`solo     : ${sol.length} MEL lines, reached ${sol.filter(r => r.reached).length}  ${JSON.stringify(tally(sol))}`);
    console.log(`distinct arguments: ${args.length}  (composite-only ${args.filter(a => a.compositeTuples && !a.soloMelLines).length}, ` +
        `solo-only ${args.filter(a => !a.compositeTuples && a.soloMelLines).length}, both ${args.filter(a => a.compositeTuples && a.soloMelLines).length})`);
    console.log(`not reached, listed:`);
    for (const r of rows.filter(r => !r.reached)) console.log(`  [${r.path}] ${JSON.stringify(r.rawText)} nf=${JSON.stringify(r.normalizedForm)} -> ${r.error ? `ERROR ${r.error}` : r.outcome}`);
    console.log(`aiParseIngredient calls: ${aiParseCalls}  lines: ${JSON.stringify(aiParseLines)}`);
    console.log(`SUPPRESSED WRITES: ${JSON.stringify(suppressed)}`);
    const snap = metrics.getLlmUsageSnapshot();
    const nonZero = Object.fromEntries(Object.entries(snap.byPurpose).filter(([, v]: any) => v.responses || v.failures || v.logicalSuccesses));
    console.log(`LLM SNAPSHOT since=${snap.since} pid=${snap.pid} nonZeroPurposes=${JSON.stringify(nonZero)} byModel=${JSON.stringify(snap.byModel)}`);
    console.log(`wrote ${args.length} args -> ${outPath}; ${rows.length} raw rows -> ${rawOut}`);
    await prisma.$disconnect().catch(() => {});
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
