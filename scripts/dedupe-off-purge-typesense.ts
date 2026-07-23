/**
 * dedupe-off-purge-typesense.ts — Remove marked near-duplicate OffFood rows
 * from the live off_foods Typesense collection without a full resync.
 *
 * Companion to dedupe-off-mark.ts: reads every barcode with
 * duplicateOfBarcode IS NOT NULL and issues batched
 * DELETE /collections/off_foods/documents?filter_by=barcode:[...] requests.
 * Filtering on the indexed barcode field works even where doc ids aren't
 * barcode-keyed (the live collection predates id=barcode keying).
 *
 * Fully recoverable: a normal scripts/sync-typesense.ts rebuild restores the
 * index from Postgres (and now skips marked rows anyway).
 *
 * Usage: npx ts-node --project tsconfig.scripts.json --transpile-only \
 *          -r tsconfig-paths/register scripts/dedupe-off-purge-typesense.ts [--dry-run]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HOST = process.env.TYPESENSE_HOST ?? 'http://192.168.1.133:8108';
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
    console.log(`🚀 dedupe-off-purge-typesense ${DRY_RUN ? '(DRY RUN)' : ''}`);

    const marked: Array<{ barcode: string }> = await prisma.offFood.findMany({
        where: { duplicateOfBarcode: { not: null } },
        select: { barcode: true },
    });
    console.log(`Marked rows in Postgres: ${marked.length.toLocaleString()}`);

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
