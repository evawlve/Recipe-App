/**
 * purge-corrupt-typesense.ts — Remove corrupt-marked OffFood rows from the
 * live off_foods Typesense collection without a full resync.
 *
 * Companion to mark-corrupt-off.ts: reads every barcode with
 * corruptReason IS NOT NULL and issues batched
 * DELETE /collections/off_foods/documents?filter_by=barcode:[...] requests —
 * the same mechanics as dedupe-off-purge-typesense.ts.
 *
 * Fully recoverable: a normal scripts/sync-typesense.ts rebuild restores the
 * index from Postgres (and skips corrupt-marked rows anyway). To un-exclude a
 * record: clear its corruptReason, then reindex or upsert it.
 *
 * Usage: npx ts-node --project tsconfig.scripts.json --transpile-only \
 *          -r tsconfig-paths/register scripts/purge-corrupt-typesense.ts [--dry-run]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HOST = process.env.TYPESENSE_HOST ?? 'http://localhost:8108';
const KEY = process.env.TYPESENSE_API_KEY ?? '';
const COLLECTION = 'off_foods';
const DRY_RUN = process.argv.includes('--dry-run');

// Keep the filter_by URL comfortably under typical 8KB request-line limits.
const BATCH = 250;

async function typesenseReq(endpoint: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(`${HOST}${endpoint}`, {
        headers: { 'X-TYPESENSE-API-KEY': KEY },
        ...options,
    });
    if (!res.ok) {
        throw new Error(`Typesense ${endpoint} failed ${res.status}: ${await res.text()}`);
    }
    return res.json();
}

async function docCount(): Promise<number> {
    const info = await typesenseReq(`/collections/${COLLECTION}`);
    return info.num_documents as number;
}

async function main() {
    console.log(`🚀 purge-corrupt-typesense ${DRY_RUN ? '(DRY RUN)' : ''} → ${HOST}`);

    const marked: Array<{ barcode: string }> = await prisma.offFood.findMany({
        where: { corruptReason: { not: null } },
        select: { barcode: true },
    });
    console.log(`Corrupt-marked rows in Postgres: ${marked.length.toLocaleString()}`);

    const before = await docCount();
    console.log(`off_foods docs before  : ${before.toLocaleString()}`);

    if (DRY_RUN) {
        console.log('🔍 Dry run — no deletes. Done.');
        return;
    }

    let deleted = 0;
    for (let i = 0; i < marked.length; i += BATCH) {
        const batch = marked.slice(i, i + BATCH).map(m => m.barcode);
        const filterBy = encodeURIComponent(`barcode:[${batch.join(',')}]`);
        const res = await typesenseReq(
            `/collections/${COLLECTION}/documents?filter_by=${filterBy}`,
            { method: 'DELETE' }
        );
        deleted += res.num_deleted ?? 0;
        if ((i / BATCH) % 40 === 0) {
            console.log(`  processed ${Math.min(i + BATCH, marked.length).toLocaleString()} / ${marked.length.toLocaleString()} barcodes (${deleted.toLocaleString()} docs deleted)`);
        }
    }

    const after = await docCount();
    console.log('──────────────────────────────────────────────');
    console.log(`  Docs deleted : ${deleted.toLocaleString()}`);
    console.log(`  off_foods    : ${before.toLocaleString()} → ${after.toLocaleString()}`);
    console.log('✅ Done.');
}

main()
    .catch(err => {
        console.error('❌ Crashed:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
