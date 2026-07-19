/**
 * backfill-typesense-count-serving.ts — one-time Typesense backfill for the
 * `hasCountServing` retrieval flag (Cluster A pt2, Jul 2026).
 *
 * Adds the field to the live `off_foods` collection schema (PATCH — no
 * recreate, no full resync), then partial-updates (action=update) ONLY the
 * OffFood rows whose label serving enumerates pieces ("14 chips (28g)",
 * "15 pieces (28g)"): ~tens of thousands of docs instead of 1M+.
 *
 * Docs absent from Typesense (not yet synced) fail their update line — that's
 * expected and non-fatal; they'll get the flag from the next full sync, which
 * now computes it inline (scripts/sync-typesense.ts).
 *
 * Run (Mac or Mini-PC; TYPESENSE_HOST/DATABASE_URL from .env):
 *   ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/backfill-typesense-count-serving.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
    isTypesenseAvailable,
    updateTypesenseCollection,
    updateTypesenseDocumentsByFilter,
} from '../src/lib/search/typesense-client';
import { servingLabelHasPieceCount } from '../src/lib/mapping/count-label';

const BATCH = 10000;
// Barcodes per update-by-filter PATCH. Keeps the filter_by query string well
// under URI limits (~200 × 14 chars ≈ 3KB).
const PATCH_BATCH = 200;

async function main() {
    if (!(await isTypesenseAvailable())) {
        console.error('❌ Typesense unreachable — check TYPESENSE_HOST.');
        process.exit(1);
    }

    // 1. Add the field to the schema (idempotent: 400 "already exists" is fine).
    try {
        await updateTypesenseCollection('off_foods', {
            fields: [{ name: 'hasCountServing', type: 'bool', optional: true }],
        });
        console.log('✅ Added hasCountServing to off_foods schema.');
    } catch (e) {
        const msg = (e as Error).message;
        if (/already (exists|part of the schema)/i.test(msg)) {
            console.log('ℹ️ hasCountServing already in schema, continuing.');
        } else {
            throw e;
        }
    }

    // 2. Page through rows that can possibly qualify and flag the ones that do.
    const prisma = new PrismaClient();
    let lastBarcode = '';
    let scanned = 0, flagged = 0, updateErrors = 0;

    while (true) {
        const rows: Array<{ barcode: string; servingSize: string | null; servingGrams: number | null }> =
            await prisma.offFood.findMany({
                where: {
                    barcode: { gt: lastBarcode },
                    servingSize: { not: null },
                    servingGrams: { not: null },
                },
                select: { barcode: true, servingSize: true, servingGrams: true },
                orderBy: { barcode: 'asc' },
                take: BATCH,
            });
        if (rows.length === 0) break;
        lastBarcode = rows[rows.length - 1].barcode;
        scanned += rows.length;

        // The live collection's doc ids are auto-assigned (not barcodes), so
        // address docs through the indexed barcode field via update-by-filter.
        const barcodes = rows
            .filter(r => servingLabelHasPieceCount(r.servingSize, r.servingGrams))
            .map(r => r.barcode);

        for (let i = 0; i < barcodes.length; i += PATCH_BATCH) {
            const chunk = barcodes.slice(i, i + PATCH_BATCH);
            const res = await updateTypesenseDocumentsByFilter(
                'off_foods',
                `barcode:=[${chunk.join(',')}]`,
                { hasCountServing: true }
            );
            flagged += res.num_updated ?? 0;
            updateErrors += chunk.length - (res.num_updated ?? 0);
        }

        console.log(`scanned ${scanned.toLocaleString()} (flagged ${flagged.toLocaleString()}, update misses ${updateErrors})`);
    }

    console.log(`\n✅ Done. Scanned ${scanned.toLocaleString()} serving-bearing rows; flagged ${flagged.toLocaleString()} count-labeled docs; ${updateErrors} docs not in Typesense (will be covered by next full sync).`);
    await prisma.$disconnect();
}

main().catch(err => {
    console.error('❌ Backfill crashed:', err);
    process.exit(1);
});
