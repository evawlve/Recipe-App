/**
 * probe-bare-serving.ts — what the bare-query serving guard OVERRODE, per query.
 *
 * Answers one question the event log cannot: for a key billed at
 * `bare_category_default`, what did the tier cascade produce BEFORE the guard
 * fired? MappingEventLog records only the final grams/tier, so "the guard
 * replaced a fabricated 100g floor" and "the guard destroyed a genuine 52g bar
 * label" are indistinguishable in it — and they need opposite fixes.
 *
 * The guard logs previousTier/previousGrams at
 * map-ingredient-with-fallback.ts:5439; this captures that line per query
 * instead of grepping a shared service journal.
 *
 * READ-ONLY: every Prisma mutation is intercepted and no-oped, same guard as
 * winner-diff. Nothing is written to FoodMapping. skipCache is forced so each
 * query resolves cold.
 *
 * Run ON THE BOX, from the repo root:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/probe-bare-serving.ts <<'EOF'
 *   mac and cheese
 *   rxbar chocolate sea salt
 *   EOF
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
for (const f of ['.env', '.env.local']) {
    const p = path.join(REPO_ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = require('../../src/lib/db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const logger = require('../../src/lib/logger').logger;

const MUTATING = new Set([
    'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany',
    'upsert', 'delete', 'deleteMany', 'executeRaw', 'executeRawUnsafe',
]);
prisma.$use(async (params: any, next: any) => {
    if (MUTATING.has(params.action)) return null;
    return next(params);
});

/** Capture the guard's own log line rather than re-deriving what it did. */
let captured: Record<string, any> | null = null;
const realInfo = logger.info.bind(logger);
logger.info = (msg: string, meta?: any) => {
    if (typeof msg === 'string' && msg.endsWith('.bare_category_default')) captured = { msg, ...meta };
    return realInfo(msg, meta);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mapIngredientWithFallback } = require('../../src/lib/mapping/map-ingredient-with-fallback');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getBareQueryDefault } = require('../../src/lib/ai/ambiguous-serving-estimator');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createAiNutritionBudget } = require('../../src/lib/mapping/ai-nutrition-backfill');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AI_NUTRITION_MAX_PER_BATCH } = require('../../src/lib/mapping/config');

async function main() {
    const lines = fs.readFileSync(0, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    if (lines.length === 0) {
        // Fail closed: "probing 0 queries" over exit 0 reads as a clean probe.
        console.error('FAIL: ZERO queries on stdin — nothing was probed; exit 2.');
        process.exitCode = 2;
        await prisma.$disconnect();
        return;
    }
    console.log(`probing ${lines.length} queries — READ-ONLY, skipCache forced\n`);

    // ONE budget for the whole probe run, shared by every line (see warm-names.ts).
    const nutritionBudget = createAiNutritionBudget(AI_NUTRITION_MAX_PER_BATCH);
    for (const line of lines) {
        captured = null;
        let r: any = null;
        let err: string | null = null;
        try {
            r = await mapIngredientWithFallback(line, { skipCache: true, aiNutritionBudget: nutritionBudget });
        } catch (e: any) {
            err = e?.message ?? String(e);
        }
        const lex = getBareQueryDefault(line);
        console.log(`── ${line}`);
        if (err) { console.log(`   ERROR ${err}`); continue; }
        if (!r) { console.log('   (no mapping)'); continue; }
        console.log(`   record   ${r.foodId} "${r.foodName}"${r.brandName ? ` [${r.brandName}]` : ''}`);
        console.log(`   BILLED   ${r.grams}g  ${Math.round(r.kcal)}kcal  tier=${r.servingTier ?? '-'}  desc=${r.servingDescription ?? '-'}`);
        console.log(`   lexicon  ${lex ? `${lex.grams}g "${lex.description}"  (cap threshold ${lex.grams * 2}g)` : '(no category match)'}`);
        if (captured) {
            console.log(`   GUARD    ${captured.previousTier ?? '-'} ${captured.previousGrams}g  ->  ${captured.grams}g`);
        } else {
            console.log('   GUARD    did not fire');
        }
        console.log('');
    }
    await prisma.$disconnect();
}

main().catch(async e => { console.error(e); try { await prisma.$disconnect(); } catch { /* noop */ } process.exit(1); });
