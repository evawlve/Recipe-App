#!/usr/bin/env ts-node
/**
 * backfill-canonical-base.ts — populate FoodMapping.canonicalBase for existing rows.
 *
 * canonicalBase is an observability/grouping column (see the FoodMapping schema note);
 * it never affects the normalizedForm lookup key. Historical rows predate the column and
 * have no AI-derived base, so this backfill approximates it deterministically from the
 * picked record's foodName + brandName via brandSafeCanonicalBase (brand kept so distinct
 * branded products stay distinct). PRECISE AI bases populate automatically on the next
 * save of each key; this just gives immediate dedup/grouping signal. LLM-free, idempotent.
 *
 * Only fills rows where canonicalBase IS NULL (won't clobber values written by the pipeline).
 *
 *   ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/backfill-canonical-base.ts [--dry-run] [--limit N] [--batch 500]
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { brandSafeCanonicalBase } from '../src/lib/mapping/validated-mapping-helpers';

function arg(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const limit = arg('--limit') ? parseInt(arg('--limit')!, 10) : undefined;
    const batchSize = arg('--batch') ? parseInt(arg('--batch')!, 10) : 500;

    const rows = await prisma.foodMapping.findMany({
        where: { canonicalBase: null },
        select: { normalizedForm: true, foodName: true, brandName: true },
        ...(limit ? { take: limit } : {}),
    });

    console.log(`${dryRun ? '[DRY RUN] ' : ''}rows to backfill: ${rows.length}`);
    let updated = 0, skipped = 0;
    const sample: string[] = [];

    for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        await Promise.all(chunk.map(async (r) => {
            const base = brandSafeCanonicalBase(r.foodName, r.brandName);
            if (!base) { skipped++; return; }
            if (sample.length < 15) sample.push(`${r.normalizedForm}  ->  ${base}`);
            if (!dryRun) {
                await prisma.foodMapping.update({
                    where: { normalizedForm: r.normalizedForm },
                    data: { canonicalBase: base },
                });
            }
            updated++;
        }));
        if (!dryRun) console.log(`  ...${Math.min(i + batchSize, rows.length)}/${rows.length}`);
    }

    console.log('\nsample:');
    sample.forEach((s) => console.log('  ' + s));
    console.log(`\n${dryRun ? '[DRY RUN] would update' : 'updated'}: ${updated}, skipped(no base): ${skipped}`);
    await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
