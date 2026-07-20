/**
 * warm-cache.ts — FoodMapping cache warmer (PR B, flywheel Phase 1).
 *
 * Assembles a seed corpus of food names users actually log and replays each
 * through POST /api/nlp/parse on the NORMAL cache-first path (no nocache):
 * names already cached just bump usedCount; cold names run the full mapping
 * pipeline and populate the cache through saveValidatedMapping — which since
 * PR #109/#110 is protected by the save-time gates (macro plausibility,
 * serving-downgrade, brand-mismatch), so a bad resolution can serve once but
 * cannot poison the cache.
 *
 * Seeds (deduped, case-insensitive):
 *   - eval/gold.high_usage.csv        (raw_line column, qty/unit stripped)
 *   - scripts/eval/golden-set.json    (nlp item-form case names)
 *   - built-in PRODUCE/PROTEIN/STAPLES/BRANDS lists (mirrors stress-latency.ts,
 *     which self-executes on import and so can't be imported)
 *   - optional --seed <file>          (one extra name per line, # comments ok)
 *
 * Requests are ITEM-form and unitless ({rawText: name, quantity: 1, name}) —
 * item form bypasses AI segmentation (no LLM cost there), and FoodMapping is
 * identity-only so bare names warm exactly the rows real requests will hit.
 *
 * Run (from repo root):
 *   npx ts-node --transpile-only --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/eval/warm-cache.ts --base http://192.168.1.133:3000 [--concurrency 4] [--limit N] [--dry]
 *
 * Writes results/warm-<timestamp>.json: per-seed mapping result (food, source,
 * grams, confidence, per-100g macros) + summary. Feed the result file to the
 * triage workflow / parity sweep for validation.
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
const CONCURRENCY = Number(argValue('--concurrency') ?? 4);
const TIMEOUT_MS = Number(argValue('--timeout') ?? 45000);
const LIMIT = argValue('--limit') ? Number(argValue('--limit')) : undefined;
const DRY = args.includes('--dry');
const SEED_FILE = argValue('--seed');

// Mirrors stress-latency.ts (not importable: it self-executes).
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

/** Strip a leading quantity/unit from a raw log line to its food name. */
const LEADING_QTY_UNIT_RE = new RegExp(
    '^[\\d\\/.\\s]*\\s*' +
    '(?:(?:g|grams?|kg|oz|ounces?|lbs?|pounds?|ml|l|liters?|cups?|tbsp|tablespoons?|tsp|teaspoons?|' +
    'scoops?|slices?|cans?|bottles?|pouch(?:es)?|bars?|pieces?|servings?|cloves?|eggs?|large|medium|small)\\b)?' +
    '\\s*(of\\s+)?', 'i');
function nameFromRawLine(rawLine: string): string {
    return rawLine.replace(LEADING_QTY_UNIT_RE, '').replace(/,.*$/, '').trim();
}

/** Minimal CSV field splitter (handles double-quoted fields with commas). */
function csvFields(line: string): string[] {
    const out: string[] = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') inQ = false;
            else cur += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out;
}

function assembleSeeds(): string[] {
    const seeds: string[] = [];

    // 1. High-usage CSV (raw_line is column 1)
    const csvPath = path.join(__dirname, '..', '..', 'eval', 'gold.high_usage.csv');
    if (fs.existsSync(csvPath)) {
        const lines = fs.readFileSync(csvPath, 'utf8').split('\n').slice(1);
        for (const line of lines) {
            if (!line.trim()) continue;
            const rawLine = csvFields(line)[1];
            if (rawLine) {
                const name = nameFromRawLine(rawLine);
                if (name.length > 1) seeds.push(name);
            }
        }
    }

    // 2. Golden-set nlp item names
    const goldenPath = path.join(__dirname, 'golden-set.json');
    const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    for (const c of golden.nlp ?? []) {
        const name = c.item?.name;
        if (typeof name === 'string' && name.length > 1) seeds.push(name);
    }

    // 3. Built-in lists
    seeds.push(...PRODUCE, ...PROTEIN, ...STAPLES, ...BRANDS);

    // 4. Optional extra seed file
    if (SEED_FILE) {
        const extra = fs.readFileSync(SEED_FILE, 'utf8').split('\n')
            .map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        seeds.push(...extra);
    }

    const seen = new Set<string>();
    const deduped = seeds.filter(s => {
        const k = s.toLowerCase().trim();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    return LIMIT ? deduped.slice(0, LIMIT) : deduped;
}

interface WarmResult {
    seed: string;
    ok: boolean;
    ms: number;
    foodId?: string;
    foodName?: string;
    brandName?: string;
    source?: string;
    grams?: number;
    matchConfidence?: number;
    per100g?: { kcal?: number; protein?: number; carbs?: number; fat?: number };
    error?: string;
}

async function warmOne(seed: string): Promise<WarmResult> {
    const body = { items: [{ rawText: seed, quantity: 1, name: seed }] };
    const t0 = Date.now();
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const ctrl = new AbortController();
            const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
            const res = await fetch(`${BASE}/api/nlp/parse`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
                body: JSON.stringify(body),
                signal: ctrl.signal,
            });
            clearTimeout(to);
            if (!res.ok) throw new Error(`http ${res.status}`);
            const items: any = await res.json();
            const it = Array.isArray(items) ? items[0] : null;
            if (!it) throw new Error('empty response');
            const n = it.nutritionPer100g ?? {};
            return {
                seed, ok: true, ms: Date.now() - t0,
                foodId: it.foodId, foodName: it.foodName, brandName: it.brandName ?? undefined,
                source: it.source, grams: it.grams, matchConfidence: it.matchConfidence,
                per100g: { kcal: n.kcal100, protein: n.protein100, carbs: n.carbs100, fat: n.fat100 },
            };
        } catch (err) {
            if (attempt === 1) {
                return { seed, ok: false, ms: Date.now() - t0, error: (err as Error).message };
            }
        }
    }
    return { seed, ok: false, ms: Date.now() - t0, error: 'unreachable' };
}

async function main() {
    const seeds = assembleSeeds();
    console.log(`Warm corpus: ${seeds.length} names → ${BASE} (concurrency ${CONCURRENCY})`);
    if (DRY) {
        seeds.forEach(s => console.log(`  ${s}`));
        return;
    }

    const results: WarmResult[] = [];
    let done = 0;
    const queue = [...seeds];
    async function worker() {
        while (queue.length) {
            const seed = queue.shift()!;
            const r = await warmOne(seed);
            results.push(r);
            done++;
            if (done % 25 === 0 || done === seeds.length) {
                console.log(`  ${done}/${seeds.length} (${results.filter(x => !x.ok).length} errors)`);
            }
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const ok = results.filter(r => r.ok);
    const errors = results.filter(r => !r.ok);
    const lowConf = ok.filter(r => (r.matchConfidence ?? 0) < 0.85);
    const bySource: Record<string, number> = {};
    for (const r of ok) bySource[r.source ?? 'unknown'] = (bySource[r.source ?? 'unknown'] ?? 0) + 1;

    const outDir = path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(outDir, `warm-${ts}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
        base: BASE, at: new Date().toISOString(), seedCount: seeds.length,
        summary: { ok: ok.length, errors: errors.length, lowConf: lowConf.length, bySource },
        results,
    }, null, 1));

    console.log(`\nSources: ${JSON.stringify(bySource)}`);
    console.log(`Low-confidence (<0.85, NOT cached): ${lowConf.length}`);
    lowConf.slice(0, 20).forEach(r =>
        console.log(`   ${r.seed} → "${r.foodName}" conf=${r.matchConfidence?.toFixed(2)}`));
    if (errors.length) {
        console.log(`Errors: ${errors.length}`);
        errors.slice(0, 10).forEach(r => console.log(`   ${r.seed}: ${r.error}`));
    }
    console.log(`\nResults written to ${path.relative(process.cwd(), outPath)}`);
}

main().catch(err => { console.error(err); process.exit(2); });
