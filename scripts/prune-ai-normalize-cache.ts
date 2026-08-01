/**
 * prune-ai-normalize-cache.ts — delete the AiNormalizeCache rows that provably cannot
 * change a mapping outcome. MANUAL ONLY. Never put this on a timer.
 *
 * READ THIS BEFORE RUNNING IT. AiNormalizeCache is not a pure cost cache:
 * `estimatedCaloriesPer100g` and `isBranded` are read back by
 * map-ingredient-with-fallback.ts and fed to simpleRerank, so deleting a row that carries
 * either can change which candidate wins. `synonyms` and `prepPhrases` are LLM
 * observations, and `isMultiIngredient` is a detection that a delete throws away.
 *
 * So the eviction predicate is the intersection of "nothing here is a rerank input" and
 * "nothing here is a detection":
 *     useCount = 1 AND estimatedCaloriesPer100g IS NULL AND NOT isBranded
 *     AND synonyms = '[]' AND prepPhrases = '[]' AND NOT isMultiIngredient
 *
 * MEASURED on the live table 2026-08-01
 * (re-derive: ssh owner@192.168.1.133 'docker exec mealspire-db psql -U postgres -d mealspire
 *   -c "SELECT count(*) FROM \"AiNormalizeCache\" WHERE \"useCount\"=1
 *       AND \"estimatedCaloriesPer100g\" IS NULL AND NOT \"isBranded\"
 *       AND \"synonyms\"::text=''[]'' AND \"prepPhrases\"::text=''[]''
 *       AND NOT \"isMultiIngredient\""'):
 *     433 of 2864 rows qualify. 1828 rows carry isBranded and 491 a nutrition estimate.
 *
 * THAT IS THE WHOLE REDUCTION AVAILABLE without touching rerank inputs, and the payoff is
 * bounded: the table is 1032 kB and 28 days old (measured 2026-08-01,
 * `pg_size_pretty(pg_total_relation_size('"AiNormalizeCache"'))`). The correct default is
 * to NOT run this. It exists so the option is a measured, reversible one rather than a
 * `deleteMany` someone types at 2am.
 *
 * A snapshot is REQUIRED before --apply, per the standing rule that cache rows are not
 * verified (a row means "passed the save gate at write time", not "correct") and every
 * eviction needs a restore anchor:
 *     ssh owner@192.168.1.133 'docker exec mealspire-db pg_dump -U postgres -d mealspire \
 *       -t "\"AiNormalizeCache\"" --data-only' > sync-docs/cache-snapshots/<date>_ainormalizecache.sql
 * --apply refuses to run without --snapshot=<path to an existing, non-empty file>.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json -r tsconfig-paths/register \
 *     scripts/prune-ai-normalize-cache.ts                       # dry-run (default)
 *   npx ts-node --project tsconfig.scripts.json -r tsconfig-paths/register \
 *     scripts/prune-ai-normalize-cache.ts --apply --snapshot=sync-docs/cache-snapshots/...
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Rows that carry no rerank input and no detection. Every clause is load-bearing; dropping
 * any one of them lets a row that feeds simpleRerank into the delete set.
 */
export const INERT_ROW_WHERE: Prisma.AiNormalizeCacheWhereInput = {
    useCount: 1,
    estimatedCaloriesPer100g: null,
    isBranded: false,
    isMultiIngredient: false,
    synonyms: { equals: [] },
    prepPhrases: { equals: [] },
};

export function requireSnapshot(argv: string[]): string {
    const arg = argv.find(a => a.startsWith('--snapshot='));
    const path = arg?.slice('--snapshot='.length);
    if (!path) {
        throw new Error(
            '--apply requires --snapshot=<file>. Cache rows are not verified, so an eviction '
            + 'without a restore anchor is not reversible. See the header for the pg_dump command.',
        );
    }
    if (!fs.existsSync(path) || fs.statSync(path).size === 0) {
        throw new Error(`snapshot ${path} does not exist or is empty — refusing to delete.`);
    }
    return path;
}

async function main(): Promise<void> {
    const apply = process.argv.includes('--apply');
    const prisma = new PrismaClient();

    try {
        const total = await prisma.aiNormalizeCache.count();
        const inert = await prisma.aiNormalizeCache.count({ where: INERT_ROW_WHERE });
        console.log(`rows          ${total}`);
        console.log(`inert         ${inert}`);
        console.log(`would remain  ${total - inert}`);

        if (!apply) {
            console.log('\ndry-run — nothing deleted. Re-run with --apply --snapshot=<file>.');
            return;
        }

        const snapshot = requireSnapshot(process.argv);
        const { count } = await prisma.aiNormalizeCache.deleteMany({ where: INERT_ROW_WHERE });
        console.log(`\ndeleted ${count} rows (restore anchor: ${snapshot}).`);
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
