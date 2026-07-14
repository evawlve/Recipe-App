import 'dotenv/config';
import { performance } from 'perf_hooks';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { searchMeili, isMeiliAvailable } from '../src/lib/search/meilisearch-client';
import { searchTypesense, isTypesenseAvailable } from '../src/lib/search/typesense-client';
import { searchRediSearch, isRedisAvailable } from '../src/lib/search/redisearch-client';
import { searchElastic, isElasticAvailable } from '../src/lib/search/elasticsearch-client';

const QUERIES = [
    'milk', 'eggs', 'butter', 'bread', 'avocado', 'salmon', 'chicken breast', 'ground beef',
    'brown rice', 'spinach', 'broccoli', 'banana', 'apple', 'strawberry', 'blueberries', 'oats',
    'greek yogurt', 'almond milk', 'peanut butter', 'olive oil', 'honey', 'maple syrup', 'cheddar cheese',
    'mozzarella', 'parmesan', 'tomato', 'onion', 'garlic', 'potato', 'sweet potato', 'carrot',
    'cucumber', 'bell pepper', 'lettuce', 'cabbage', 'tofu', 'tempeh', 'black beans', 'chickpeas',
    'lentils', 'quinoa', 'chia seeds', 'flax seeds', 'walnuts', 'almonds', 'cashews', 'pumpkin seeds',
    'tuna canned', 'sardines', 'shrimp', 'pork chops', 'bacon', 'sausage', 'ham', 'turkey breast',
    'sour cream', 'cream cheese', 'heavy cream', 'cottage cheese', 'whey protein', 'pasta', 'spaghetti',
    'tortilla', 'pita bread', 'bagel', 'croissant', 'white chocolate', 'dark chocolate', 'cocoa powder',
    'sugar', 'brown sugar', 'stevia', 'erythritol', 'maple sugar', 'coconut oil', 'butter salted',
    'ghee', 'canola oil', 'soy sauce', 'apple cider vinegar', 'balsamic vinegar', 'mayonnaise', 'mustard',
    'ketchup', 'sriracha', 'hot sauce', 'hummus', 'guacamole', 'salsa', 'pesto', 'marinara sauce',
    'oregano', 'basil', 'thyme', 'rosemary', 'cinnamon', 'black pepper', 'sea salt', 'garlic powder'
];

interface EngineStats {
    name: string;
    avgMs: number;
    maxMs: number;
    p95Ms: number;
    ramFootprint: string;
    successRate: number;
    top1Strict: number;
    recallAt5: number;
    precisionAt5: number;
    mrrAt5: number;
}

interface QueryJudgment {
    query: string;
    firstRelevantRank: number | null; // 1-based; null = nothing relevant in top 5
    relevantCount: number;
    returnedCount: number;
    topHits: string[]; // "name (brand)" for auditability
}

// ─── Strict relevance judging ────────────────────────────────────────────────
// A hit is RELEVANT iff every query token matches a token of the hit's
// name/brandName (after normalization + light singularization). This is a
// deliberately strict lexical gate: "milk" matching "milk chocolate bar" counts
// (all query tokens present), but "grape" matching "grapefruit juice" does not
// (token equality/short-prefix only, not substring).

function stemToken(t: string): string {
    if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
    if (t.length > 4 && t.endsWith('es')) return t.slice(0, -2);
    if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
    return t;
}

function tokenize(text: string): string[] {
    return (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map(stemToken);
}

function isRelevant(query: string, hit: any): boolean {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return false;
    const hitTokens = new Set([...tokenize(hit?.name || ''), ...tokenize(hit?.brandName || '')]);
    return queryTokens.every(qt => {
        for (const ht of hitTokens) {
            if (ht === qt) return true;
        }
        return false;
    });
}

function judgeHits(query: string, hits: any[]): QueryJudgment {
    const top5 = (hits || []).slice(0, 5);
    let firstRelevantRank: number | null = null;
    let relevantCount = 0;
    top5.forEach((hit, i) => {
        if (isRelevant(query, hit)) {
            relevantCount++;
            if (firstRelevantRank === null) firstRelevantRank = i + 1;
        }
    });
    return {
        query,
        firstRelevantRank,
        relevantCount,
        returnedCount: top5.length,
        topHits: top5.map((h: any) => `${h?.name || '?'} (${h?.brandName || 'N/A'})`),
    };
}

function getPercentile(arr: number[], percentile: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
}

function getDockerMemory(containerName: string): string {
    try {
        const out = execSync(`docker stats ${containerName} --no-stream --format "{{.MemUsage}}"`).toString().trim();
        return out || 'N/A';
    } catch (e) {
        return 'N/A';
    }
}

async function runBenchmark() {
    console.log('🏁 Starting Search Engine Benchmark Comparison...');
    console.log(`Evaluating ${QUERIES.length} search queries against Meilisearch, Typesense, RediSearch, and Elasticsearch...`);

    const meiliOk = await isMeiliAvailable();
    const typeOk = await isTypesenseAvailable();
    const redisOk = await isRedisAvailable();
    const elasticOk = await isElasticAvailable();

    console.log(`\nEngine Status:`);
    console.log(`- Meilisearch: ${meiliOk ? 'ONLINE' : 'OFFLINE'}`);
    console.log(`- Typesense: ${typeOk ? 'ONLINE' : 'OFFLINE'}`);
    console.log(`- RediSearch: ${redisOk ? 'ONLINE' : 'OFFLINE'}`);
    console.log(`- Elasticsearch: ${elasticOk ? 'ONLINE' : 'OFFLINE'}`);

    const enginesToTest = [
        { name: 'Meilisearch', active: meiliOk, test: async (q: string) => searchMeili('off_foods', q, 5) },
        { name: 'Typesense', active: typeOk, test: async (q: string) => searchTypesense('off_foods', q, 'name,brandName', 5) },
        { name: 'RediSearch', active: redisOk, test: async (q: string) => searchRediSearch('off_foods', q, 5) },
        { name: 'Elasticsearch', active: elasticOk, test: async (q: string) => searchElastic('off_foods', q, ['name^2', 'brandName'], 5) }
    ];

    const results: EngineStats[] = [];
    const perEngineJudgments: Record<string, QueryJudgment[]> = {};

    for (const engine of enginesToTest) {
        if (!engine.active) {
            console.log(`\n⚠️ Skipping benchmark for ${engine.name} as it is offline.`);
            continue;
        }

        console.log(`\nRunning benchmark for ${engine.name}...`);
        
        // Warmup runs
        for (let i = 0; i < 5; i++) {
            await engine.test(QUERIES[i]).catch(() => {});
        }

        const latencies: number[] = [];
        let successCount = 0;
        const judgments: QueryJudgment[] = [];

        for (const query of QUERIES) {
            const start = performance.now();
            try {
                const hits = await engine.test(query);
                const elapsed = performance.now() - start;
                latencies.push(elapsed);
                if (hits && hits.length > 0) {
                    successCount++;
                }
                judgments.push(judgeHits(query, hits || []));
            } catch (err) {
                // Query failed
                latencies.push(performance.now() - start);
                judgments.push(judgeHits(query, []));
            }
        }

        const avgMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const maxMs = Math.max(...latencies);
        const p95Ms = getPercentile(latencies, 95);
        const successRate = (successCount / QUERIES.length) * 100;

        // Strict relevance metrics (judged on the same top-5 hits used for latency)
        const n = judgments.length;
        const top1Strict = (judgments.filter(j => j.firstRelevantRank === 1).length / n) * 100;
        const recallAt5 = (judgments.filter(j => j.firstRelevantRank !== null).length / n) * 100;
        const precisionAt5 = (judgments.reduce((sum, j) => sum + (j.returnedCount > 0 ? j.relevantCount / j.returnedCount : 0), 0) / n) * 100;
        const mrrAt5 = judgments.reduce((sum, j) => sum + (j.firstRelevantRank ? 1 / j.firstRelevantRank : 0), 0) / n;
        perEngineJudgments[engine.name] = judgments;

        // Fetch container RAM
        let containerName = '';
        if (engine.name === 'Meilisearch') containerName = 'mealspire-meili';
        else if (engine.name === 'Typesense') containerName = 'mealspire-typesense';
        else if (engine.name === 'RediSearch') containerName = 'mealspire-redis';
        else if (engine.name === 'Elasticsearch') containerName = 'mealspire-es';

        const ramFootprint = getDockerMemory(containerName);

        results.push({
            name: engine.name,
            avgMs,
            maxMs,
            p95Ms,
            ramFootprint,
            successRate,
            top1Strict,
            recallAt5,
            precisionAt5,
            mrrAt5
        });
    }

    // Print comparison table
    console.log('\n==========================================================================================');
    console.log('📊 BENCHMARK COMPARISON SUMMARY TABLE');
    console.log('==========================================================================================\n');

    console.log('| Search Engine | Avg Latency (ms) | P95 Latency (ms) | Max Latency (ms) | Mini-PC RAM | Hit Rate (%) | Top-1 Strict (%) | Recall@5 (%) | Precision@5 (%) | MRR@5 |');
    console.log('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of results) {
        console.log(`| **${r.name}** | ${r.avgMs.toFixed(2)} ms | ${r.p95Ms.toFixed(2)} ms | ${r.maxMs.toFixed(2)} ms | ${r.ramFootprint} | ${r.successRate.toFixed(1)}% | ${r.top1Strict.toFixed(1)}% | ${r.recallAt5.toFixed(1)}% | ${r.precisionAt5.toFixed(1)}% | ${r.mrrAt5.toFixed(3)} |`);
    }

    console.log('\nMetric definitions:');
    console.log('- Hit Rate: query returned >=1 hit (the old lenient "success rate").');
    console.log('- Top-1 Strict: top hit contains ALL query tokens (stemmed) in name/brand.');
    console.log('- Recall@5: any of the top 5 hits is strictly relevant.');
    console.log('- Precision@5: fraction of returned top-5 hits that are strictly relevant.');
    console.log('- MRR@5: mean reciprocal rank of the first strictly-relevant hit.');

    console.log('\n==========================================================================================');

    // Persist results — the earlier run of this script never saved output,
    // so its findings were lost once the terminal scrolled past. Write both
    // a timestamped snapshot and a "latest" pointer for easy diffing later.
    const outDir = path.join(__dirname, '../scratch');
    fs.mkdirSync(outDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const output = {
        timestamp: new Date().toISOString(),
        queryCount: QUERIES.length,
        engineStatus: { meilisearch: meiliOk, typesense: typeOk, redisearch: redisOk, elasticsearch: elasticOk },
        results,
        // Per-query relevance judgments so surprising aggregate numbers can be audited
        // (e.g. inspect exactly which hits an engine returned for a failed query).
        judgments: perEngineJudgments,
    };
    const snapshotPath = path.join(outDir, `benchmark-engines-${timestamp}.json`);
    const latestPath = path.join(outDir, 'benchmark-engines-latest.json');
    fs.writeFileSync(snapshotPath, JSON.stringify(output, null, 2));
    fs.writeFileSync(latestPath, JSON.stringify(output, null, 2));
    console.log(`\n💾 Results saved to ${snapshotPath}`);
}

runBenchmark()
    .then(() => process.exit(0)) // the RediSearch client's open connection otherwise keeps the event loop alive forever
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
