/**
 * stress-latency.ts — high-volume latency & robustness stress test.
 *
 * Unlike run-eval.ts (labeled accuracy cases), this fires a LARGE generated
 * corpus at the live API purely to characterize latency under load and to
 * catch regressions the golden set can't: tail latency, error/timeout rate,
 * empty-result rate on foods that should exist, and null-nutrition leakage.
 * No golden answers required — it measures distributions, not correctness.
 *
 * Run (from repo root):
 *   npx ts-node --transpile-only --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/eval/stress-latency.ts [--base http://192.168.1.133:3000] [--n 1] [--concurrency 8] [--nlp] [--timeout 15000]
 *
 *   --n <k>            repeat the whole corpus k times (default 1)
 *   --concurrency <c>  parallel in-flight requests (default 1 = sequential latency; >1 = load test)
 *   --nlp              also stress POST /api/nlp/parse with magic-log phrases
 *   --timeout <ms>     per-request timeout (default 15000)
 *
 * Results are written to scripts/eval/results/stress-<timestamp>.json.
 */

import * as fs from 'fs';
import * as path from 'path';

const argv = process.argv.slice(2);
const flag = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const has = (f: string) => argv.includes(f);

const BASE = flag('--base') ?? process.env.EVAL_API_BASE ?? 'http://192.168.1.133:3000';
const API_KEY = process.env.EVAL_API_KEY ?? 'adminAPI_dev_key_bypass';
const REPEAT = parseInt(flag('--n') ?? '1', 10);
const CONCURRENCY = parseInt(flag('--concurrency') ?? '1', 10);
const TIMEOUT = parseInt(flag('--timeout') ?? '15000', 10);
const DO_NLP = has('--nlp');

const MACRO_KEYS = ['kcal100', 'protein100', 'carbs100', 'fat100'];
const hasNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

// ---- Corpus generation -------------------------------------------------

const PRODUCE = ['apple', 'banana', 'orange', 'strawberries', 'blueberries', 'grapes', 'watermelon',
    'pineapple', 'mango', 'peach', 'pear', 'cherries', 'broccoli', 'spinach', 'kale', 'carrot',
    'cucumber', 'tomato', 'bell pepper', 'zucchini', 'cauliflower', 'asparagus', 'green beans',
    'sweet potato', 'potato', 'onion', 'garlic', 'mushrooms', 'avocado', 'celery', 'lettuce', 'cabbage'];

const PROTEIN = ['chicken breast', 'chicken thigh', 'ground beef', 'steak', 'pork chop', 'bacon',
    'salmon', 'tuna', 'shrimp', 'tilapia', 'cod', 'turkey breast', 'ground turkey', 'tofu', 'tempeh',
    'eggs', 'egg whites', 'black beans', 'chickpeas', 'lentils', 'kidney beans', 'greek yogurt',
    'cottage cheese', 'whey protein', 'ham', 'sausage', 'ribeye', 'lamb'];

const STAPLES = ['white rice', 'brown rice', 'quinoa', 'oatmeal', 'rolled oats', 'whole wheat bread',
    'pasta', 'spaghetti', 'tortilla', 'bagel', 'olive oil', 'butter', 'peanut butter', 'almond butter',
    'honey', 'maple syrup', 'whole milk', 'almond milk', 'oat milk', 'cheddar cheese', 'mozzarella',
    'parmesan', 'flour', 'sugar', 'cinnamon', 'salt', 'black pepper', 'ketchup', 'mustard', 'mayonnaise'];

const BRANDS = ['cheerios', 'oreo', 'doritos', 'gatorade', 'coca cola', 'coke zero', 'pepsi', 'red bull',
    'monster energy', 'chobani', 'oikos', 'fairlife', 'quest bar', 'clif bar', 'kind bar', 'rx bar',
    'premier protein', 'muscle milk', 'ben and jerrys', 'haagen dazs', 'pop tarts', 'nature valley',
    'lays', 'pringles', 'ritz crackers', 'goldfish', 'nutella', 'skippy', 'jif', 'campbells soup',
    'ghost protein', 'optimum nutrition gold standard', 'celsius', 'bang energy', 'starbucks'];

const SEMANTIC = ['high protein snack', 'low carb bread', 'sugar free ice cream', 'plant based milk',
    'meal replacement shake', 'zero calorie soda', 'gluten free pasta', 'keto friendly bar',
    'unsweetened greek yogurt', 'high fiber cereal', 'low sodium soup', 'dairy free cheese',
    'protein ice cream', 'no sugar added applesauce', 'whole grain crackers'];

// Deterministic typo generator: single adjacent-char transposition / drop.
function typo(word: string, seed: number): string {
    const chars = word.split('');
    const letters = chars.map((c, i) => (/[a-z]/i.test(c) ? i : -1)).filter(i => i >= 2);
    if (!letters.length) return word;
    const pick = letters[seed % letters.length];
    if (seed % 2 === 0 && pick + 1 < chars.length) {
        [chars[pick], chars[pick + 1]] = [chars[pick + 1], chars[pick]]; // transpose
    } else {
        chars.splice(pick, 1); // drop a char
    }
    return chars.join('');
}

const MISSPELLINGS = [...PRODUCE, ...PROTEIN, ...STAPLES]
    .filter(w => !w.includes(' ') && w.length >= 5)
    .map((w, i) => typo(w, i + 1))
    .slice(0, 40);

function buildSearchCorpus(): { q: string; expectHits: boolean }[] {
    const real = [...PRODUCE, ...PROTEIN, ...STAPLES, ...BRANDS, ...SEMANTIC].map(q => ({ q, expectHits: true }));
    const typos = MISSPELLINGS.map(q => ({ q, expectHits: false })); // typos MAY be empty; don't count as failure
    return [...real, ...typos];
}

const NLP_PHRASES = [
    '2 eggs and toast', '1 cup of coffee with milk', 'grilled chicken with rice and broccoli',
    'a banana and a handful of almonds', 'protein shake after workout', '2 slices of pizza',
    'a bowl of oatmeal with blueberries', 'greek yogurt with granola and honey', 'a turkey sandwich',
    'chicken caesar salad', '3 strips of bacon and 2 fried eggs', 'a bottle of gatorade',
    '1 medium apple', '100g grilled salmon with asparagus', 'peanut butter and jelly sandwich',
    'a cup of brown rice and black beans', 'steak and mashed potatoes', 'oatmeal with peanut butter',
    'a protein bar', 'scrambled eggs with cheese and spinach',
];

// ---- Runner ------------------------------------------------------------

interface Sample { kind: 'search' | 'nlp'; q: string; ms: number; ok: boolean; empty: boolean; nullNut: boolean; status: number; expectHits?: boolean }

async function timedFetch(url: string, init?: any): Promise<{ ms: number; status: number; body: any; ok: boolean }> {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), TIMEOUT);
    const t0 = Date.now();
    try {
        const res = await fetch(url, { ...init, signal: ctl.signal });
        const body = await res.json().catch(() => null);
        return { ms: Date.now() - t0, status: res.status, body, ok: res.ok };
    } catch (err) {
        return { ms: Date.now() - t0, status: 0, body: null, ok: false };
    } finally {
        clearTimeout(to);
    }
}

async function runSearch(item: { q: string; expectHits: boolean }): Promise<Sample> {
    const r = await timedFetch(`${BASE}/api/foods/search?s=${encodeURIComponent(item.q)}&local=true`, { headers: { 'x-api-key': API_KEY } });
    const hits: any[] = Array.isArray(r.body) ? r.body : (r.body?.data ?? r.body?.results ?? []);
    const empty = hits.length === 0;
    const nullNut = hits.slice(0, 5).some(h => !MACRO_KEYS.some(k => hasNum(h?.[k])));
    return { kind: 'search', q: item.q, ms: r.ms, ok: r.ok, empty, nullNut, status: r.status, expectHits: item.expectHits };
}

async function runNlp(text: string): Promise<Sample> {
    const r = await timedFetch(`${BASE}/api/nlp/parse`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY }, body: JSON.stringify({ text }),
    });
    const items: any[] = Array.isArray(r.body) ? r.body : [];
    const empty = items.length === 0;
    const nullNut = items.some(it => !MACRO_KEYS.some(k => hasNum(it?.nutritionPer100g?.[k])));
    return { kind: 'nlp', q: text, ms: r.ms, ok: r.ok, empty, nullNut, status: r.status };
}

/** Run `tasks` with a bounded number of concurrent workers, preserving order-independent collection. */
async function runPool<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
    const out: T[] = new Array(tasks.length);
    let next = 0;
    async function worker() {
        while (true) {
            const i = next++;
            if (i >= tasks.length) return;
            out[i] = await tasks[i]();
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    return out;
}

function pct(sorted: number[], p: number): number {
    if (!sorted.length) return 0;
    const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, i)];
}

function report(label: string, samples: Sample[]) {
    if (!samples.length) return null;
    const lat = samples.map(s => s.ms).sort((a, b) => a - b);
    const errors = samples.filter(s => !s.ok);
    const emptyExpected = samples.filter(s => s.empty && s.expectHits !== false && s.ok);
    const nullViol = samples.filter(s => s.nullNut);
    const slowest = [...samples].sort((a, b) => b.ms - a.ms).slice(0, 8);
    const stats = {
        label, n: samples.length,
        p50: pct(lat, 50), p90: pct(lat, 90), p95: pct(lat, 95), p99: pct(lat, 99), max: lat[lat.length - 1],
        mean: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length),
        errorRate: +(errors.length / samples.length * 100).toFixed(1),
        emptyExpectedRate: +(emptyExpected.length / samples.length * 100).toFixed(1),
        nullNutViolations: nullViol.length,
    };
    console.log(`\n== ${label} (${stats.n} reqs) ==`);
    console.log(`  latency ms  p50 ${stats.p50}  p90 ${stats.p90}  p95 ${stats.p95}  p99 ${stats.p99}  max ${stats.max}  mean ${stats.mean}`);
    console.log(`  errors: ${errors.length} (${stats.errorRate}%)  |  empty-when-expected: ${emptyExpected.length} (${stats.emptyExpectedRate}%)  |  null-nutrition leaks: ${nullViol.length}`);
    if (errors.length) console.log(`  ERROR queries: ${errors.slice(0, 8).map(e => `"${e.q}"(${e.status})`).join(', ')}`);
    if (emptyExpected.length) console.log(`  EMPTY (expected hits): ${emptyExpected.slice(0, 12).map(e => `"${e.q}"`).join(', ')}`);
    if (nullViol.length) console.log(`  NULL-NUTRITION leaks: ${nullViol.slice(0, 8).map(e => `"${e.q}"`).join(', ')}`);
    console.log(`  slowest: ${slowest.map(s => `"${s.q}"(${s.ms}ms)`).join(', ')}`);
    return { stats, errors: errors.map(e => e.q), emptyExpected: emptyExpected.map(e => e.q), nullViol: nullViol.map(e => e.q) };
}

async function main() {
    const corpus = buildSearchCorpus();
    const searchTasks: (() => Promise<Sample>)[] = [];
    for (let r = 0; r < REPEAT; r++) for (const item of corpus) searchTasks.push(() => runSearch(item));

    console.log(`Stress test against ${BASE}`);
    console.log(`search corpus: ${corpus.length} unique × ${REPEAT} = ${searchTasks.length} reqs | concurrency ${CONCURRENCY} | timeout ${TIMEOUT}ms`);

    // Warm up.
    await runSearch({ q: 'warmup', expectHits: false });

    const t0 = Date.now();
    const searchSamples = await runPool(searchTasks, CONCURRENCY);
    const searchWall = Date.now() - t0;
    const searchRep = report(`SEARCH  (wall ${(searchWall / 1000).toFixed(1)}s, ${(searchTasks.length / (searchWall / 1000)).toFixed(1)} req/s)`, searchSamples);

    let nlpRep: any = null;
    let nlpSamples: Sample[] = [];
    if (DO_NLP) {
        const nlpTasks: (() => Promise<Sample>)[] = [];
        for (let r = 0; r < REPEAT; r++) for (const p of NLP_PHRASES) nlpTasks.push(() => runNlp(p));
        const n0 = Date.now();
        nlpSamples = await runPool(nlpTasks, CONCURRENCY);
        const nlpWall = Date.now() - n0;
        nlpRep = report(`NLP magic-log  (wall ${(nlpWall / 1000).toFixed(1)}s)`, nlpSamples);
    }

    const outDir = path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `stress-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
        base: BASE, ranAt: new Date().toISOString(), repeat: REPEAT, concurrency: CONCURRENCY,
        search: searchRep, nlp: nlpRep,
        rawSamples: [...searchSamples, ...nlpSamples],
    }, null, 2));
    console.log(`\nResults written to ${path.relative(process.cwd(), outPath)}`);

    // Fail only on hard problems: any request error, or a null-nutrition leak.
    const hardFail = searchSamples.some(s => !s.ok) || nlpSamples.some(s => !s.ok)
        || searchSamples.some(s => s.nullNut) || nlpSamples.some(s => s.nullNut);
    process.exit(hardFail ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(2); });
