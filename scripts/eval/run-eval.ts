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
 *     scripts/eval/run-eval.ts [--base http://192.168.1.21:3000] [--only search|nlp] [--grep s-brand]
 *
 * Results are written to scripts/eval/results/eval-<timestamp>.json for
 * before/after diffing across ranking or ingest changes.
 *
 * NOTE: nlp cases with `item` bypass AI segmentation (deterministic, cheaper);
 * the two `text` cases exercise the full segmentation path and cost AI calls.
 */

import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}

const BASE = argValue('--base') ?? process.env.EVAL_API_BASE ?? 'http://192.168.1.21:3000';
const API_KEY = process.env.EVAL_API_KEY ?? 'adminAPI_dev_key_bypass';
const ONLY = argValue('--only');
const GREP = argValue('--grep');

const goldenPath = path.join(__dirname, 'golden-set.json');
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));

interface CaseResult {
    id: string;
    kind: 'search' | 'nlp';
    category: string;
    query: string;
    pass: boolean;
    ms: number;
    detail: string;
    confidence?: number;
}

const results: CaseResult[] = [];

function textOf(hit: any): string {
    return `${hit.name ?? hit.foodName ?? ''} ${hit.brandName ?? ''}`.toLowerCase();
}

/** True if any of the alternatives (each = list of required substrings) matches the text. */
function matchesAlt(text: string, alternatives: string[][]): boolean {
    return alternatives.some(alt => alt.every(sub => text.includes(sub.toLowerCase())));
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
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
        return { id: c.id, kind: 'search', category: c.category, query: c.query, pass, ms, detail, confidence };
    } catch (err) {
        return { id: c.id, kind: 'search', category: c.category, query: c.query, pass: false, ms: Date.now() - t0, detail: `ERROR: ${(err as Error).message}` };
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
            return { id: c.id, kind: 'nlp', category: c.category, query, pass: false, ms, detail: `no items returned (HTTP ${res.status})` };
        }

        const failures: string[] = [];

        if (c.expectItems && items.length < c.expectItems) {
            failures.push(`expected >=${c.expectItems} items, got ${items.length}`);
        }

        // Name check: for single-item cases the one item must match; for
        // segmentation cases at least one item must match.
        if (c.expectName) {
            const anyNameMatch = items.some(it => matchesAlt(textOf(it), c.expectName));
            if (!anyNameMatch) {
                failures.push(`name mismatch: [${items.map(it => `"${it.foodName}"`).join(', ')}]`);
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

        const confidence = items[0]?.matchConfidence;
        return {
            id: c.id, kind: 'nlp', category: c.category, query,
            pass: failures.length === 0, ms,
            detail: failures.length ? failures.join('; ') : `mapped: "${items[0]?.foodName}" conf=${confidence?.toFixed(2)}`,
            confidence,
        };
    } catch (err) {
        return { id: c.id, kind: 'nlp', category: c.category, query, pass: false, ms: Date.now() - t0, detail: `ERROR: ${(err as Error).message}` };
    }
}

async function main() {
    const searchCases = (ONLY && ONLY !== 'search') ? [] : golden.search.filter((c: any) => !GREP || c.id.includes(GREP));
    const nlpCases = (ONLY && ONLY !== 'nlp') ? [] : golden.nlp.filter((c: any) => !GREP || c.id.includes(GREP));

    console.log(`Eval against ${BASE} — ${searchCases.length} search + ${nlpCases.length} nlp cases\n`);

    // Warm the API (dev-mode compile, embedding model) so case 1 isn't penalized.
    await fetch(`${BASE}/api/foods/search?s=warmup&local=true`, { headers: { 'x-api-key': API_KEY } }).catch(() => {});

    for (const c of searchCases) {
        const r = await runSearchCase(c);
        results.push(r);
        console.log(`${r.pass ? '✅' : '❌'} [${r.id}] "${r.query}" (${r.ms}ms) ${r.pass ? '' : '— ' + r.detail}`);
    }
    for (const c of nlpCases) {
        const r = await runNlpCase(c);
        results.push(r);
        console.log(`${r.pass ? '✅' : '❌'} [${r.id}] "${r.query}" (${r.ms}ms) ${r.pass ? '' : '— ' + r.detail}`);
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
            p50ms: percentile(lat, 50), p95ms: percentile(lat, 95), maxMs: lat[lat.length - 1],
        };
    }
    for (const r of results) {
        const key = `${r.kind}/${r.category}`;
        summary.categories[key] = summary.categories[key] ?? { pass: 0, total: 0 };
        summary.categories[key].total++;
        if (r.pass) summary.categories[key].pass++;
    }

    console.log('\n================ SUMMARY ================');
    for (const [kind, s] of Object.entries(summary.kinds) as [string, any][]) {
        console.log(`${kind.padEnd(7)} ${s.pass}/${s.total} pass  |  p50 ${s.p50ms}ms  p95 ${s.p95ms}ms  max ${s.maxMs}ms`);
    }
    console.log('---- by category ----');
    for (const [cat, s] of Object.entries(summary.categories) as [string, any][]) {
        const flag = s.pass === s.total ? '  ' : '⚠️ ';
        console.log(`${flag}${cat.padEnd(28)} ${s.pass}/${s.total}`);
    }

    const outDir = path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));
    console.log(`\nResults written to ${path.relative(process.cwd(), outPath)}`);

    const failed = results.filter(r => !r.pass).length;
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(2); });
