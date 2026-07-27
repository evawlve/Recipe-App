/**
 * refresh-prod-shapes.ts — regenerate __tests__/fixtures/prod-shapes.json from the
 * live cache.
 *
 * WHY THIS EXISTS
 * `correctness-screen.test.ts` was 73 tests green while `ROW_SQL` was missing its
 * `FdcFood` join. Every fdc-sourced row therefore arrived with `recname=''` and
 * `per100g=null`, D8 fired on all of them, and the screen false-evicted 78 of 78
 * fdc rows in the live cache. Nothing caught it because BATCH 01 CONTAINS NO FDC
 * ROWS — the test corpus simply did not have the shape, so the whole class of bug
 * was invisible to a suite that could otherwise pin a confusion matrix to the row.
 *
 * A fixture cannot be trusted to notice what it does not contain. prod-shapes.json
 * is the external record of what production ACTUALLY holds, and
 * `prod-shape-coverage.test.ts` fails when the fixture corpus stops covering it.
 * The manifest is committed and read offline; CI has no prod DB. This script is the
 * MANUAL refresh, run from a machine that can reach the server.
 *
 * COST: the serving-tier tally calls `hydrateAndSelectServing` — the production
 * path — once per cached row. It can hit the USDA FDC API and it can invoke the
 * ambiguous-serving AI estimator. Over ~3,200 rows that is minutes of wall clock
 * and a few hundred model calls. It is not free and it is not pure.
 *
 * Run:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/refresh-prod-shapes.ts [--dry-run] [--limit N]
 *
 *   --dry-run   print the tally, write nothing
 *   --limit N   sample N rows. IMPLIES --dry-run and REFUSES to write: a sampled
 *               manifest silently drops the rare shapes, which are precisely the
 *               ones the fixture is most likely to be missing. Use it to smoke-test
 *               the script, never to produce the file.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    ROW_SQL,
    resolveRealServings,
    type PrismaLike,
    type ScreenRow,
} from './correctness-screen';

const OUT = path.join(__dirname, '__tests__', 'fixtures', 'prod-shapes.json');
const CHUNK = 400;

interface ShapeCount { value: string; count: number }

function tally(values: Array<string | null | undefined>): ShapeCount[] {
    const m = new Map<string, number>();
    for (const v of values) {
        const key = v == null || v === '' ? '(none)' : v;
        m.set(key, (m.get(key) ?? 0) + 1);
    }
    return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

function openPrisma(): PrismaLike {
    require('dotenv/config');
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient() as PrismaLike;
}

async function main(): Promise<number> {
    const args = process.argv.slice(2);
    const limitRaw = args.includes('--limit') ? args[args.indexOf('--limit') + 1] : undefined;
    const limit = limitRaw === undefined ? undefined : Number(limitRaw);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        console.error(`--limit must be a positive integer, got "${limitRaw}".`);
        return 2;
    }
    const dryRun = args.includes('--dry-run') || limit !== undefined;

    const prisma = openPrisma();
    let rows: ScreenRow[] = [];
    let population = 0;
    try {
        const keyRows = await prisma.$queryRawUnsafe(
            `SELECT "normalizedForm" AS k FROM "FoodMapping" ORDER BY "normalizedForm"`,
        ) as Array<{ k: string }>;
        population = keyRows.length;
        if (population === 0) {
            console.error('FATAL FoodMapping is empty. Refusing to write a manifest that claims '
                + 'production contains no shapes — that would make the coverage test pass vacuously.');
            return 2;
        }
        const keys = (limit ? keyRows.slice(0, limit) : keyRows).map(r => r.k);
        console.log(`pulling ${keys.length} of ${population} cached rows...`);
        for (let i = 0; i < keys.length; i += CHUNK) {
            const res = await prisma.$queryRawUnsafe(ROW_SQL, keys.slice(i, i + CHUNK)) as { json_agg: ScreenRow[] | null }[];
            rows = rows.concat(res?.[0]?.json_agg ?? []);
            process.stderr.write(`  rows ${rows.length}/${keys.length}\n`);
        }
    } finally { await prisma.$disconnect(); }

    console.log(`resolving the REAL serving anchor for ${rows.length} rows `
        + '(production path — FDC API + AI estimator, minutes)...');
    await resolveRealServings(rows);

    const sources = tally(rows.map(r => r.src));
    const servingTiers = tally(rows.map(r => (r.real?.error ? '(unresolved)' : r.real?.tier)));

    const manifest = {
        _readme:
            'Shapes the LIVE cache actually contains. __tests__/prod-shape-coverage.test.ts fails '
            + 'when the committed test fixtures stop covering one of them. This file is the only '
            + 'thing that knows about a shape the fixture is missing — batch 01 had zero fdc rows, '
            + 'which is why a missing FdcFood join in ROW_SQL survived 73 green tests and '
            + 'false-evicted 78 of 78 fdc rows. Regenerate with scripts/eval/refresh-prod-shapes.ts '
            + '(needs a live DB; never run in CI).',
        measuredAt: new Date().toISOString().slice(0, 10),
        refreshWith: 'npx ts-node --project tsconfig.scripts.json --transpile-only '
            + '-r tsconfig-paths/register scripts/eval/refresh-prod-shapes.ts',
        population: { table: 'FoodMapping', rows: population, screened: rows.length },
        shapes: {
            // FoodMapping.source — which corpus the cached record lives in. Each one
            // takes a DIFFERENT branch through ROW_SQL, tierD and hydrateAndSelectServing.
            source: sources,
            // The tier hydrateAndSelectServing resolved for a unitless `1 x`. This is
            // what D5/D6 judge, so a tier absent from the fixture is a rule branch that
            // has never been exercised.
            servingTier: servingTiers,
        },
    };

    console.log('\nsource:      ' + sources.map(s => `${s.value}=${s.count}`).join('  '));
    console.log('servingTier: ' + servingTiers.map(s => `${s.value}=${s.count}`).join('  '));

    if (dryRun) {
        console.log(`\n${limit ? `--limit ${limit} sampled only — ` : ''}NOT written. `
            + (limit ? 'A sampled manifest drops the rare shapes, which are exactly the ones the '
                + 'fixture is most likely to be missing. Re-run without --limit to write.' : '(--dry-run)'));
        return 0;
    }
    fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`\nWritten to ${path.relative(process.cwd(), OUT)}. `
        + 'Commit it, then run `npx jest scripts/eval/__tests__/prod-shape-coverage.test.ts` — '
        + 'a FAILURE means production grew a shape no fixture covers, and the fix is to add an '
        + 'exemplar row to fixtures/screen-shape-exemplars.json, not to edit the manifest.');
    return 0;
}

if (require.main === module) {
    main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(2); });
}
