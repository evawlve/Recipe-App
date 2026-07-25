/**
 * run-eval.ts — golden-set evaluation of the food mapping system.
 *
 * Hits the LIVE API (manual search + NLP magic log) with the labeled queries
 * in golden-set.json and reports accuracy per category plus latency
 * percentiles. Dependency-free (global fetch + node:fs) so it runs on any
 * machine without touching repo code paths.
 *
 * Run (from repo root):
 *   npx ts-node --transpile-only --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/eval/run-eval.ts [--base http://192.168.1.133:3000] [--only search|nlp] [--grep s-brand]
 *
 * Results are written to scripts/eval/results/eval-<timestamp>.json for
 * before/after diffing across ranking or ingest changes.
 *
 * NOTE: nlp cases with `item` bypass AI segmentation (deterministic, cheaper);
 * the two `text` cases exercise the full segmentation path and cost AI calls.
 */

import * as fs from 'fs';
import * as path from 'path';
import { textOf, matchesAlt, isAbstention, describeDrift, type BaselineEntry } from './assertions';

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}

const BASE = argValue('--base') ?? process.env.EVAL_API_BASE ?? 'http://192.168.1.133:3000';
const API_KEY = process.env.EVAL_API_KEY ?? 'adminAPI_dev_key_bypass';
const ONLY = argValue('--only');
const GREP = argValue('--grep');
/** Re-record the knownIssue baseline from this run instead of comparing against it. */
const WRITE_BASELINE = args.includes('--write-baseline');

const goldenPath = path.join(__dirname, 'golden-set.json');
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));

/**
 * What the mapper actually returned, as structured values rather than prose.
 *
 * `detail` already carried these numbers, but only inside a human-readable string,
 * so nothing could compare them across runs. That is what let n-cook-06 slide from
 * kcal100=361 (wrong record) to kcal100=0 (no nutrition at all) while the gate kept
 * reporting "0 real failures" — both are outside the band, both are knownIssue, and
 * a boolean cannot express "still failing, but worse".
 */
interface Observed {
    foodId?: string | null;
    foodName?: string | null;
    source?: string | null;
    grams?: number | null;
    kcal?: number | null;
    kcal100?: number | null;
    confidence?: number | null;
    itemCount?: number;
    abstained?: boolean;
}

interface CaseResult {
    id: string;
    kind: 'search' | 'nlp';
    category: string;
    query: string;
    pass: boolean;
    ms: number;
    detail: string;
    confidence?: number;
    /** Documented-but-unfixed defect: failure is expected and does NOT fail the suite. */
    knownIssue?: boolean;
    observed?: Observed;
}

const results: CaseResult[] = [];

const MACRO_KEYS = ['kcal100', 'protein100', 'carbs100', 'fat100'];
function hasNum(v: unknown): boolean {
    return typeof v === 'number' && Number.isFinite(v);
}
/** A search hit with NO finite macro at all — the null-nutrition rows the OFF filter should drop. */
function nutritionMissing(h: any): boolean {
    return !MACRO_KEYS.some(k => hasNum(h?.[k]));
}



function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
}

// ---------------------------------------------------------------------------
// knownIssue baseline
// ---------------------------------------------------------------------------


const baselinePath = path.join(__dirname, 'known-issue-baseline.json');

function loadKnownIssueBaseline(): Record<string, BaselineEntry> {
    try {
        return JSON.parse(fs.readFileSync(baselinePath, 'utf8')).cases ?? {};
    } catch {
        return {};
    }
}

function writeKnownIssueBaseline(rs: CaseResult[]): void {
    const cases: Record<string, BaselineEntry> = {};
    for (const r of rs) {
        if (!r.knownIssue || !r.observed) continue;
        cases[r.id] = {
            foodId: r.observed.foodId ?? null,
            foodName: r.observed.foodName ?? null,
            grams: r.observed.grams ?? null,
            kcal100: r.observed.kcal100 ?? null,
            abstained: r.observed.abstained ?? false,
        };
    }
    fs.writeFileSync(baselinePath, JSON.stringify({
        _readme: 'Recorded state of each knownIssue case. run-eval compares against this and '
            + 'reports 🟠 DRIFT when a pinned case keeps failing but fails DIFFERENTLY — the '
            + 'signal a pass/fail boolean cannot carry. Refresh with --write-baseline once the '
            + 'new values are understood to be the intended state.',
        writtenAt: new Date().toISOString(),
        cases,
    }, null, 2) + '\n');
}

/** Every knownIssue case whose recorded values moved since the baseline was written. */
function compareKnownIssueBaseline(rs: CaseResult[]): Array<{ id: string; what: string }> {
    const base = loadKnownIssueBaseline();
    const out: Array<{ id: string; what: string }> = [];
    for (const r of rs) {
        if (!r.knownIssue || !r.observed) continue;
        const b = base[r.id];
        if (!b) continue;  // new pin: nothing to compare until the baseline is refreshed
        const changes = describeDrift(b, r.observed);
        if (changes.length) out.push({ id: r.id, what: changes.join('; ') });
    }
    return out;
}

async function runSearchCase(c: any): Promise<CaseResult> {
    const t0 = Date.now();
    let detail = '';
    let pass = false;
    let confidence: number | undefined;
    try {
        const res = await fetch(`${BASE}/api/foods/search?s=${encodeURIComponent(c.query)}&local=true`, {
            headers: { 'x-api-key': API_KEY },
        });
        const ms = Date.now() - t0;
        const body: any = await res.json();
        const hits: any[] = Array.isArray(body) ? body : (body.data ?? body.results ?? []);
        const topN = hits.slice(0, c.rank ?? 3);
        pass = topN.some(h => matchesAlt(textOf(h), c.match));
        confidence = hits[0]?.confidence;
        detail = pass
            ? `hit: "${hits.find((h: any) => matchesAlt(textOf(h), c.match))?.name}"`
            : `top${c.rank ?? 3}: [${topN.map(h => `"${h.name}"`).join(', ') || 'EMPTY'}]`;
        // Invariant (unless opted out): no returned hit may lack all nutrition — verifies
        // the OFF null-nutrition filter keeps junk rows out of manual search results.
        if (c.requireNutrition !== false && topN.length) {
            const bad = topN.find(nutritionMissing);
            if (bad) { pass = false; detail = `NULL-NUTRITION "${bad.name}" | ${detail}`; }
        }
        return {
            id: c.id, kind: 'search', category: c.category, query: c.query, pass, ms, detail, confidence,
            knownIssue: c.knownIssue,
            observed: {
                foodId: hits[0]?.id ?? hits[0]?.foodId ?? null,
                foodName: hits[0]?.name ?? null,
                kcal100: hits[0]?.kcal100 ?? null,
                confidence: confidence ?? null,
                itemCount: hits.length,
            },
        };
    } catch (err) {
        return { id: c.id, kind: 'search', category: c.category, query: c.query, pass: false, ms: Date.now() - t0, detail: `ERROR: ${(err as Error).message}`, knownIssue: c.knownIssue };
    }
}

async function runNlpCase(c: any): Promise<CaseResult> {
    const t0 = Date.now();
    const query = c.item?.name ?? c.text;
    try {
        const body = c.item ? { items: [c.item] } : { text: c.text };
        const res = await fetch(`${BASE}/api/nlp/parse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
            body: JSON.stringify(body),
        });
        const ms = Date.now() - t0;
        const items: any[] = await res.json();
        if (!Array.isArray(items) || items.length === 0) {
            // Carries knownIssue for consistency with the catch branch below — otherwise a
            // transport hiccup on a pinned case reads as a REAL failure while an exception
            // on the same case is absorbed. The drift check still surfaces it, because
            // itemCount 1 -> 0 is a recorded change.
            return {
                id: c.id, kind: 'nlp', category: c.category, query, pass: false, ms,
                detail: `TRANSPORT: no items returned (HTTP ${res.status})`,
                knownIssue: c.knownIssue,
                observed: { itemCount: 0 },
            };
        }

        const failures: string[] = [];

        if (c.expectItems && items.length < c.expectItems) {
            failures.push(`expected >=${c.expectItems} items, got ${items.length}`);
        }

        // Name check: for single-item cases the one item must match; for
        // segmentation cases at least one item must match.
        //
        // An abstention can NEVER satisfy a positive name assertion — it echoes the
        // query text back as foodName, so it would otherwise match trivially. See
        // isAbstention().
        if (c.expectName) {
            const anyNameMatch = items.some(it => !isAbstention(it) && matchesAlt(textOf(it), c.expectName));
            if (!anyNameMatch) {
                const shown = items.map(it => isAbstention(it) ? 'NO PICK (abstained)' : `"${it.foodName}"`);
                failures.push(`name mismatch: [${shown.join(', ')}]`);
            }
        }

        // Negative name assertion — no returned item may match. This pins a
        // wrong-record class without needing to know the right answer, which is what
        // the composite->component drift cases need: "qdoba chicken burrito must not
        // resolve to Tequila Lime Chicken" is assertable even while the correct
        // billing figure is still being argued about.
        if (c.forbidName) {
            const offender = items.find(it => !isAbstention(it) && matchesAlt(textOf(it), c.forbidName));
            if (offender) {
                failures.push(`forbidden name matched: "${offender.foodName}" [${offender.brandName ?? ''}]`);
            }
        }

        // The mapper is REQUIRED to produce no confident pick. For a query whose
        // honest answer is "not in the corpus", billing a component at 0.95 is worse
        // than abstaining, and only this can express that.
        if (c.expectAbstain) {
            const confident = items.find(it => !isAbstention(it));
            if (confident) {
                failures.push(`expected abstention, got "${confident.foodName}" conf=${confident.matchConfidence} grams=${confident.grams}`);
            }
        }

        // Weak form: it may guess, but must not look authoritative enough to cache.
        if (typeof c.maxConfidence === 'number') {
            const conf = items[0]?.matchConfidence;
            if (typeof conf !== 'number' || conf > c.maxConfidence) {
                failures.push(`confidence=${conf} exceeds maxConfidence ${c.maxConfidence} (mapped: "${items[0]?.foodName}")`);
            }
        }

        if (c.macros) {
            const per100 = items[0]?.nutritionPer100g ?? {};
            for (const [key, range] of Object.entries(c.macros) as [string, [number, number]][]) {
                const v = per100[key];
                if (typeof v !== 'number' || v < range[0] || v > range[1]) {
                    failures.push(`${key}=${typeof v === 'number' ? v.toFixed(1) : v} outside [${range[0]}, ${range[1]}] (mapped: "${items[0]?.foodName}")`);
                }
            }
        }

        // Resolved serving weight: asserts the total grams for the requested unit/quantity.
        // This is what catches serving-estimation defects (e.g. "1 slice bread" → 100g).
        if (c.grams) {
            const g = items[0]?.grams;
            if (typeof g !== 'number' || g < c.grams[0] || g > c.grams[1]) {
                failures.push(`grams=${typeof g === 'number' ? g : String(g)} outside [${c.grams[0]}, ${c.grams[1]}] (unit "${c.item?.unit ?? ''}", mapped "${items[0]?.foodName}")`);
            }
        }

        // Billed totals for the requested quantity — the grams-scaled `nutrition`
        // block the app actually logs. This is the end-to-end assertion a per-100g
        // band can't provide: a wrong record, wrong serving, or wrong scaling all
        // surface as a wrong billed total ("1 tbsp olive oil" must bill ~119 kcal,
        // whether the failure was density, record choice, or grams math).
        // Keys: calories | protein | carbs | fat (also fiber/sugar/sodium).
        if (c.total) {
            const tot = items[0]?.nutrition ?? {};
            for (const [key, range] of Object.entries(c.total) as [string, [number, number]][]) {
                const v = tot[key];
                if (typeof v !== 'number' || v < range[0] || v > range[1]) {
                    failures.push(`total.${key}=${typeof v === 'number' ? v.toFixed(1) : v} outside [${range[0]}, ${range[1]}] (grams=${items[0]?.grams}, mapped: "${items[0]?.foodName}")`);
                }
            }
        }

        const confidence = items[0]?.matchConfidence;
        return {
            id: c.id, kind: 'nlp', category: c.category, query,
            pass: failures.length === 0, ms,
            detail: failures.length ? failures.join('; ') : `mapped: "${items[0]?.foodName}" grams=${items[0]?.grams} conf=${confidence?.toFixed(2)}`,
            confidence, knownIssue: c.knownIssue,
            observed: {
                foodId: items[0]?.foodId ?? null,
                foodName: items[0]?.foodName ?? null,
                source: items[0]?.source ?? null,
                grams: items[0]?.grams ?? null,
                kcal: items[0]?.nutrition?.calories ?? null,
                kcal100: items[0]?.nutritionPer100g?.kcal100 ?? null,
                confidence: confidence ?? null,
                itemCount: items.length,
                abstained: isAbstention(items[0]),
            },
        };
    } catch (err) {
        return { id: c.id, kind: 'nlp', category: c.category, query, pass: false, ms: Date.now() - t0, detail: `ERROR: ${(err as Error).message}`, knownIssue: c.knownIssue };
    }
}

async function main() {
    const searchCases = (ONLY && ONLY !== 'search') ? [] : golden.search.filter((c: any) => !GREP || c.id.includes(GREP));
    const nlpCases = (ONLY && ONLY !== 'nlp') ? [] : golden.nlp.filter((c: any) => !GREP || c.id.includes(GREP));

    console.log(`Eval against ${BASE} — ${searchCases.length} search + ${nlpCases.length} nlp cases\n`);

    // Warm the API (dev-mode compile, embedding model) so case 1 isn't penalized.
    await fetch(`${BASE}/api/foods/search?s=warmup&local=true`, { headers: { 'x-api-key': API_KEY } }).catch(() => {});

    const mark = (r: CaseResult) =>
        r.pass ? (r.knownIssue ? '🟢' : '✅') : (r.knownIssue ? '🟡' : '❌');
    const line = (r: CaseResult) => {
        const nowPassing = r.pass && r.knownIssue ? ' (known-issue NOW PASSING — promote it)' : '';
        console.log(`${mark(r)} [${r.id}] "${r.query}" (${r.ms}ms) ${r.pass ? '' : '— ' + r.detail}${nowPassing}`);
    };

    for (const c of searchCases) {
        const r = await runSearchCase(c);
        results.push(r);
        line(r);
    }
    for (const c of nlpCases) {
        const r = await runNlpCase(c);
        results.push(r);
        line(r);
    }

    // ---- Summary ----
    const byKind = (kind: string) => results.filter(r => r.kind === kind);
    const summary: any = { base: BASE, ranAt: new Date().toISOString(), kinds: {}, categories: {} };

    for (const kind of ['search', 'nlp']) {
        const rs = byKind(kind);
        if (!rs.length) continue;
        const passed = rs.filter(r => r.pass).length;
        const lat = rs.map(r => r.ms).sort((a, b) => a - b);
        summary.kinds[kind] = {
            pass: passed, total: rs.length,
            p50ms: percentile(lat, 50), p95ms: percentile(lat, 95), p99ms: percentile(lat, 99), maxMs: lat[lat.length - 1],
        };
    }
    for (const r of results) {
        const key = `${r.kind}/${r.category}`;
        summary.categories[key] = summary.categories[key] ?? { pass: 0, total: 0 };
        summary.categories[key].total++;
        if (r.pass) summary.categories[key].pass++;
    }

    const realFails = results.filter(r => !r.pass && !r.knownIssue);
    const knownFails = results.filter(r => !r.pass && r.knownIssue);
    const knownNowPassing = results.filter(r => r.pass && r.knownIssue);
    summary.realFailures = realFails.length;
    summary.knownIssues = knownFails.length;

    console.log('\n================ SUMMARY ================');
    for (const [kind, s] of Object.entries(summary.kinds) as [string, any][]) {
        console.log(`${kind.padEnd(7)} ${s.pass}/${s.total} pass  |  p50 ${s.p50ms}ms  p95 ${s.p95ms}ms  p99 ${s.p99ms}ms  max ${s.maxMs}ms`);
    }
    console.log('---- by category ----');
    for (const [cat, s] of Object.entries(summary.categories) as [string, any][]) {
        const flag = s.pass === s.total ? '  ' : '⚠️ ';
        console.log(`${flag}${cat.padEnd(28)} ${s.pass}/${s.total}`);
    }

    if (knownFails.length) {
        console.log(`\n---- 🟡 known issues (${knownFails.length}, documented, NOT blocking) ----`);
        for (const r of knownFails) console.log(`   [${r.id}] "${r.query}" — ${r.detail}`);
    }
    if (knownNowPassing.length) {
        console.log(`\n---- 🟢 known issues NOW PASSING (${knownNowPassing.length} — promote to hard assertions) ----`);
        for (const r of knownNowPassing) console.log(`   [${r.id}] "${r.query}"`);
    }

    // ---- knownIssue DRIFT ----
    // knownIssue is a whole-case, all-reasons, unbounded exemption: a pinned case can
    // move from "wrong record, right ballpark" to "0 kcal" or "no record at all" and the
    // gate still says "0 real failures", because a boolean cannot express "still failing,
    // but differently". n-cook-06 did exactly that (kcal100 361 -> 0). Comparing the
    // recorded values catches it.
    const drifts = compareKnownIssueBaseline(results);
    if (drifts.length) {
        console.log(`\n---- 🟠 knownIssue DRIFT (${drifts.length}) — still failing, but the failure CHANGED ----`);
        for (const d of drifts) console.log(`   [${d.id}] ${d.what}`);
        console.log(`   (non-gating. If the new values are the intended state, refresh with --write-baseline.)`);
    }
    summary.knownIssueDrift = drifts.length;

    if (WRITE_BASELINE) {
        writeKnownIssueBaseline(results);
        console.log(`\nBaseline written to ${path.relative(process.cwd(), baselinePath)} (${results.filter(r => r.knownIssue).length} knownIssue cases).`);
    }

    const outDir = path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));
    console.log(`\nResults written to ${path.relative(process.cwd(), outPath)}`);
    console.log(`\n${realFails.length ? '❌' : '✅'} ${realFails.length} real failures, 🟡 ${knownFails.length} known issues (expected).`);

    // Only genuine (non-known-issue) failures fail the suite.
    process.exit(realFails.length > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(2); });
