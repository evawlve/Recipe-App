/**
 * probe-classify-seeds.ts — flywheel STAGE 0: classify uncached corpus seeds by what
 * the live pipeline actually does with them, so a warm batch is cut from the seeds a
 * warm can convert and nothing else.
 *
 * WHY THIS EXISTS. Before this script, a warm batch was cut from "seeds whose exact
 * cache key is absent from FoodMapping". That set conflates three populations that
 * need three different responses, and warming all of them wastes most of the batch:
 *
 *   cache_hit    The seed is ALREADY SERVED. It only reads as uncached because the
 *                coverage metric compares EXACT cache-key form and this seed's form
 *                differs. Warming it converts nothing — it was never a gap. Measured
 *                on batch 16 (2026-08-08): 42 of 93 seeds. Coverage is UNDERSTATED by
 *                this class, which is why the >70% re-scope grades by mapper key.
 *   saved        Resolved, and the save gate accepted it. This is the ONLY warmable
 *                class — cut batches from here.
 *   under_gate   Resolved but the save gate rejected it (cross-source margin, low
 *                confidence). More warming does not fix these; they are pipeline work.
 *   unmapped     Nothing came back. Corpus gap or retrieval failure. Also not warmable.
 *
 * This is the D-8 probe (batch 16, 2026-08-08) promoted from a session scratchpad to a
 * committed script, per the flywheel spec in the mobile repo's
 * sync-docs/reports/2026-08-08_the-screen-bills-a-pipeline-production-never-runs.md §5.
 *
 * READ-ONLY, AND IT PROVES IT. Every probe passes `nosave=1`, which `/api/nlp/parse`
 * honours by not writing the mapping. That is a claim about a code path, so this script
 * does not trust it: it counts FoodMapping before and after and REFUSES to report a
 * result if the count moved. A read-only instrument that quietly writes is exactly the
 * fail-open class this project keeps re-learning (playbook §11) — so it is tripwired,
 * not asserted. The count check is deliberately strict: concurrent live traffic would
 * also trip it, and a tripped run is "measure again in a quiet window", never a pass.
 *
 * IT COSTS MONEY AND TIME. Each probe is a live parse: an LLM call plus full retrieval.
 * Budget ~2-6 s per seed and a fraction of a cent. --limit exists so a first run can be
 * cheap; the default is deliberately NOT "everything".
 *
 * DO NOT STRADDLE 04:30 BOX-LOCAL — the nightly flywheel sweep starts then and updates
 * FoodMapping rows in place, which both moves the denominator mid-run and trips the
 * write tripwire above. The script warns if the estimated finish crosses it.
 *
 * USAGE
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/probe-classify-seeds.ts \
 *     --corpus scripts/eval/coverage-corpus-2026-08-08.tsv \
 *     --base http://192.168.1.133:3000 \
 *     [--limit 200] [--domain chicken-chains] [--out /tmp/stage0] [--concurrency 3]
 *
 * OUTPUT (into --out, default ./stage0-<timestamp>)
 *   classified.tsv   every probed seed with its class and what it resolved to
 *   warmable.txt     the `saved` seeds only, one per line — feed this to batch cutting
 *   report.md        the class breakdown, by domain, with the re-derive command
 *
 * Exit codes: 0 = a result. 2 = the run is NOT a result (refused, tripwire, or partial).
 * There is no exit 1: a classification run either produced a usable classification or
 * it did not.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { canonicalizeCacheKey } from '../../src/lib/mapping/normalization-rules';

type Klass = 'cache_hit' | 'saved' | 'under_gate' | 'unmapped' | 'error';

interface Row { domain: string; seed: string; cacheKey: string }
interface Classified extends Row {
    klass: Klass;
    funnelStage: string;
    foodName: string;
    brandName: string;
    foodId: string;
    source: string;
    grams: number | null;
    confidence: number | null;
    note: string;
}

const REFUSE = (msg: string): never => {
    console.error(`REFUSING: ${msg}`);
    process.exit(2);
};

function parseArgs(argv: string[]) {
    const get = (flag: string): string | undefined => {
        const i = argv.indexOf(flag);
        if (i === -1) return undefined;
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) REFUSE(`${flag} needs a value`);
        return v;
    };
    const corpus = get('--corpus');
    if (!corpus) REFUSE('--corpus is required (a coverage-corpus TSV)');
    const limitRaw = get('--limit');
    const limit = limitRaw === undefined ? Infinity : Number(limitRaw);
    if (!Number.isFinite(limit) && limitRaw !== undefined) REFUSE('--limit must be a number');
    if (limitRaw !== undefined && (!Number.isInteger(limit) || limit <= 0)) REFUSE('--limit must be a positive integer');
    const concRaw = get('--concurrency');
    const concurrency = concRaw === undefined ? 3 : Number(concRaw);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
        REFUSE('--concurrency must be an integer in 1..8 (the box serves one API process; more is not faster and distorts latency)');
    }
    return {
        corpus: corpus!,
        base: get('--base') ?? 'http://192.168.1.133:3000',
        limit,
        domain: get('--domain'),
        out: get('--out') ?? `./stage0-${new Date().toISOString().replace(/[:.]/g, '-')}`,
        concurrency,
    };
}

/**
 * Reads the corpus. A corpus whose header is not the expected shape REFUSES rather than
 * being parsed positionally: a silently mis-parsed corpus reads as "every seed uncached"
 * and would aim a whole campaign at a phantom gap.
 */
function readCorpus(file: string): { domain: string; seed: string }[] {
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
        return REFUSE(`cannot read corpus ${file}: ${(e as Error).message}`);
    }
    const lines = text.trim().split('\n');
    const header = lines.shift();
    if (!header) return REFUSE(`corpus ${file} is empty`);
    const cols = header.split('\t');
    if (cols[0] !== 'domain' || cols[2] !== 'seed') {
        return REFUSE(`corpus header is ${JSON.stringify(header)}; expected domain\\tbaseline\\tseed`);
    }
    const rows = lines.map(l => l.split('\t')).filter(p => p.length >= 3 && p[2].trim())
        .map(p => ({ domain: p[0], seed: p[2].trim() }));
    if (rows.length === 0) REFUSE(`corpus ${file} parsed to 0 seeds`);
    return rows;
}

async function probe(base: string, apiKey: string, seed: string): Promise<{ ok: true; item: Record<string, unknown> | null } | { ok: false; reason: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    try {
        const res = await fetch(`${base}/api/nlp/parse?nosave=1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({ text: seed }),
            signal: ctrl.signal,
        });
        if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
        const body = await res.json();
        if (!Array.isArray(body)) return { ok: false, reason: 'response is not an array' };
        return { ok: true, item: body.length > 0 ? body[0] : null };
    } catch (e) {
        return { ok: false, reason: (e as Error).name === 'AbortError' ? 'timeout 90s' : (e as Error).message };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The classification. `funnelStage` is the pipeline's own label and is authoritative for
 * cache_hit and saved. Anything else that still produced a food is under_gate (it
 * resolved but was not persisted); no food at all is unmapped.
 */
function classify(item: Record<string, unknown> | null): { klass: Klass; note: string } {
    if (item === null) return { klass: 'unmapped', note: 'empty parse result' };
    const stage = String(item.funnelStage ?? '');
    if (stage === 'cache_hit') return { klass: 'cache_hit', note: 'already served; key-form difference only' };
    if (stage === 'saved') return { klass: 'saved', note: 'warmable' };
    if (!item.foodId) return { klass: 'unmapped', note: `no foodId (stage=${stage || 'absent'})` };
    return { klass: 'under_gate', note: `resolved but not saved (stage=${stage || 'absent'})` };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const apiKey = process.env.DEV_API_KEY;
    if (!apiKey) REFUSE('DEV_API_KEY is not set — the probe cannot authenticate');

    const prisma = new PrismaClient();
    const liveKeys = new Set(
        (await prisma.foodMapping.findMany({ select: { normalizedForm: true } })).map(r => r.normalizedForm),
    );
    const countBefore = liveKeys.size;

    const corpus = readCorpus(args.corpus);
    const uncachedAll: Row[] = corpus
        .map(r => ({ ...r, cacheKey: canonicalizeCacheKey(r.seed) }))
        .filter(r => !liveKeys.has(r.cacheKey));
    // Report BOTH counts on refusal: collapsing them is how "your --domain is a typo"
    // reads as "this domain is fully covered", which is the opposite conclusion.
    const uncached = args.domain ? uncachedAll.filter(r => r.domain === args.domain) : uncachedAll;
    const targets = uncached.slice(0, args.limit === Infinity ? undefined : args.limit);

    if (targets.length === 0) {
        console.error(`REFUSING: 0 seeds to probe. Corpus ${corpus.length} seeds, ${uncachedAll.length} uncached overall${args.domain ? `, ${uncached.length} uncached in domain=${args.domain}` : ''}.`);
        if (args.domain && uncached.length === 0) {
            const known = [...new Set(corpus.map(r => r.domain))].sort();
            console.error(`Domains present in this corpus: ${known.join(', ')}`);
            console.error('A filtered run that matches nothing is not a clean result — check --domain against that list.');
        } else {
            console.error('A run with nothing to probe is not a clean result.');
        }
        process.exit(2);
    }

    // ~3s/seed at concurrency 3 is the observed shape; warn if we would cross the sweep.
    const etaMs = (targets.length / args.concurrency) * 3500;
    const finish = new Date(Date.now() + etaMs);
    const sweep = new Date(); sweep.setHours(4, 30, 0, 0);
    if (sweep.getTime() < Date.now()) sweep.setDate(sweep.getDate() + 1);
    if (finish.getTime() > sweep.getTime()) {
        console.warn(`WARNING: estimated finish ${finish.toISOString()} crosses the 04:30 flywheel sweep.`);
        console.warn('The sweep updates FoodMapping in place — it moves the denominator mid-run AND trips the write tripwire. Use --limit or start later.');
    }

    console.log(`corpus ${corpus.length} · live keys ${countBefore} · uncached ${uncached.length}${args.domain ? ` · domain=${args.domain}` : ''} · probing ${targets.length} @ concurrency ${args.concurrency}`);
    console.log(`base ${args.base} · nosave=1 (writes nothing; verified by tripwire at exit)\n`);

    const out: Classified[] = [];
    let done = 0;
    const queue = [...targets];
    const worker = async () => {
        for (;;) {
            const row = queue.shift();
            if (!row) return;
            const r = await probe(args.base, apiKey!, row.seed);
            let rec: Classified;
            if (!r.ok) {
                rec = { ...row, klass: 'error', funnelStage: '', foodName: '', brandName: '', foodId: '', source: '', grams: null, confidence: null, note: r.reason };
            } else {
                const { klass, note } = classify(r.item);
                const it = r.item ?? {};
                rec = {
                    ...row, klass, note,
                    funnelStage: String(it.funnelStage ?? ''),
                    foodName: String(it.foodName ?? ''),
                    brandName: String(it.brandName ?? ''),
                    foodId: String(it.foodId ?? ''),
                    source: String(it.source ?? ''),
                    grams: typeof it.grams === 'number' ? it.grams : null,
                    confidence: typeof it.matchConfidence === 'number' ? it.matchConfidence : null,
                };
            }
            out.push(rec);
            done++;
            if (done % 25 === 0 || done === targets.length) {
                process.stdout.write(`  ${done}/${targets.length}\n`);
            }
        }
    };
    await Promise.all(Array.from({ length: args.concurrency }, worker));

    // TRIPWIRE. nosave=1 is a claim about a code path; this is the check that it held.
    const countAfter = await prisma.foodMapping.count();
    await prisma.$disconnect();

    const tally = (k: Klass) => out.filter(r => r.klass === k).length;
    const errors = tally('error');
    const warmable = out.filter(r => r.klass === 'saved');

    fs.mkdirSync(args.out, { recursive: true });
    fs.writeFileSync(path.join(args.out, 'classified.tsv'),
        ['domain\tseed\tcachekey\tclass\tfunnelStage\tfoodId\tfoodName\tbrandName\tsource\tgrams\tconfidence\tnote',
            ...out.map(r => [r.domain, r.seed, r.cacheKey, r.klass, r.funnelStage, r.foodId, r.foodName, r.brandName, r.source, r.grams ?? '', r.confidence ?? '', r.note].join('\t'))].join('\n'));
    fs.writeFileSync(path.join(args.out, 'warmable.txt'), warmable.map(r => r.seed).join('\n') + (warmable.length ? '\n' : ''));

    const byDomain = new Map<string, Record<Klass, number>>();
    for (const r of out) {
        const d = byDomain.get(r.domain) ?? { cache_hit: 0, saved: 0, under_gate: 0, unmapped: 0, error: 0 };
        d[r.klass]++; byDomain.set(r.domain, d);
    }
    const pct = (n: number) => `${(100 * n / out.length).toFixed(1)}%`;
    const report = [
        `# Stage-0 probe classification — ${new Date().toISOString()}`, '',
        `Corpus \`${args.corpus}\` · ${corpus.length} seeds · ${uncached.length} uncached at exact key · probed ${out.length}${args.domain ? ` · domain=${args.domain}` : ''}`,
        `Base \`${args.base}\` · live FoodMapping ${countBefore} before, ${countAfter} after (nosave tripwire ${countBefore === countAfter ? 'GREEN' : 'RED'})`, '',
        '| class | n | share | meaning |', '|---|---:|---:|---|',
        `| cache_hit | ${tally('cache_hit')} | ${pct(tally('cache_hit'))} | already served — key-form only, NOT a gap |`,
        `| saved | ${tally('saved')} | ${pct(tally('saved'))} | **warmable** — cut batches from these |`,
        `| under_gate | ${tally('under_gate')} | ${pct(tally('under_gate'))} | resolved, save gate rejected — pipeline work |`,
        `| unmapped | ${tally('unmapped')} | ${pct(tally('unmapped'))} | nothing found — corpus gap |`,
        `| error | ${errors} | ${pct(errors)} | probe failed |`, '',
        '## By domain', '', '| domain | cache_hit | saved | under_gate | unmapped | error |', '|---|---:|---:|---:|---:|---:|',
        ...[...byDomain.entries()].sort((a, b) => b[1].saved - a[1].saved)
            .map(([d, c]) => `| ${d} | ${c.cache_hit} | ${c.saved} | ${c.under_gate} | ${c.unmapped} | ${c.error} |`),
        '', '## Re-derive', '', '```',
        `npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \\`,
        `  scripts/eval/probe-classify-seeds.ts --corpus ${args.corpus} --base ${args.base}${args.domain ? ` --domain ${args.domain}` : ''}${args.limit === Infinity ? '' : ` --limit ${args.limit}`}`,
        '```', '',
        `\`warmable.txt\` (${warmable.length} seeds) is the batch-cutting input. Dedupe against live`,
        'FoodMapping by BOTH exact and mapper-normalized key before cutting, and check the batch-id',
        'namespace with `ls [0-9]*.txt` — the runner resolves `$B-*.txt` alphabetically.',
    ].join('\n');
    fs.writeFileSync(path.join(args.out, 'report.md'), report + '\n');

    console.log(`\ncache_hit ${tally('cache_hit')} · saved ${tally('saved')} · under_gate ${tally('under_gate')} · unmapped ${tally('unmapped')} · error ${errors}`);
    console.log(`artifacts: ${args.out}/{classified.tsv,warmable.txt,report.md}`);

    if (countAfter !== countBefore) {
        console.error(`\nTRIPWIRE RED: FoodMapping moved ${countBefore} -> ${countAfter} during a nosave=1 run.`);
        console.error('Either nosave is not honoured on this build or concurrent traffic wrote rows. This run is NOT a result.');
        process.exit(2);
    }
    // A run that could not probe most of what it was asked to probe is not a classification.
    if (errors > out.length * 0.1) {
        console.error(`\nREFUSING to report: ${errors}/${out.length} probes failed (>10%). Fix the base URL/service and re-run.`);
        process.exit(2);
    }
    console.log('nosave tripwire GREEN — FoodMapping unchanged.');
}

main().catch(e => { console.error(`REFUSING: unhandled ${(e as Error).stack}`); process.exit(2); });
