/**
 * _snap_foodmapping.ts — full reversible snapshot of FoodMapping before a cache op.
 * Read-only against prod. Writes ONE json file. Standing rule: snapshot before any
 * cache-touching operation, because there is no staging copy of this database.
 *
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/_snap_foodmapping.ts <outfile>
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
    const out = process.argv[2];
    if (!out) throw new Error('usage: _snap_foodmapping.ts <outfile>');

    const rows = await prisma.foodMapping.findMany({ orderBy: { normalizedForm: 'asc' } });
    const payload = {
        table: 'FoodMapping',
        count: rows.length,
        // Callers must NOT trust a snapshot they cannot date; stamp it from the DB clock.
        takenAt: (await prisma.$queryRawUnsafe<{ now: Date }[]>('SELECT now() as now'))[0].now,
        rows,
    };
    fs.writeFileSync(out, JSON.stringify(payload, null, 1));
    console.log(`snapshot ${rows.length} FoodMapping rows -> ${out}`);
    console.log(`bytes: ${fs.statSync(out).size}`);
}

main()
    .catch(e => { console.error(e); process.exit(2); })
    .finally(() => prisma.$disconnect());
