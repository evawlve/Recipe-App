import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { performance } from 'perf_hooks';
import {
    createTypesenseCollection,
    deleteTypesenseCollection,
    importTypesenseDocuments,
    isTypesenseAvailable
} from '../src/lib/search/typesense-client';
import { servingLabelHasPieceCount } from '../src/lib/mapping/count-label';

async function main() {
    console.log('🚀 Starting Typesense database synchronization...');

    if (!(await isTypesenseAvailable())) {
        console.error('❌ Typesense is not running or unreachable. Please check your configuration.');
        process.exit(1);
    }

    const prisma = new PrismaClient();

    // 1. Recreate Collections
    console.log('\nInitializing Typesense collections...');

    // FDC Foods
    try {
        await deleteTypesenseCollection('fdc_foods');
        console.log('Deleted existing collection: fdc_foods');
    } catch (e) {}

    const fdcSchema = {
        name: 'fdc_foods',
        fields: [
            { name: 'fdcId', type: 'string' },
            { name: 'description', type: 'string' },
            { name: 'brandName', type: 'string', optional: true },
            { name: 'dataType', type: 'string', optional: true, index: false },
            { name: 'nutrientsPer100g', type: 'string', optional: true, index: false },
            { name: 'servings', type: 'string', optional: true, index: false }
        ]
    };

    await createTypesenseCollection(fdcSchema);
    console.log('Created collection: fdc_foods');

    // OFF Foods
    try {
        await deleteTypesenseCollection('off_foods');
        console.log('Deleted existing collection: off_foods');
    } catch (e) {}

    const offSchema = {
        name: 'off_foods',
        fields: [
            { name: 'barcode', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'brandName', type: 'string', optional: true },
            { name: 'nutrientsPer100g', type: 'string', optional: true, index: false },
            { name: 'servingGrams', type: 'float', optional: true, index: false },
            { name: 'servingSize', type: 'string', optional: true, index: false },
            { name: 'categories', type: 'string', optional: true, index: false },
            // Label serving enumerates >=2 pieces with a sane per-piece weight
            // ("14 chips (28g)", "15 pieces (28g)"). Filterable so counted-piece
            // queries can pull count-labeled SKUs into the candidate pool.
            { name: 'hasCountServing', type: 'bool', optional: true },
            // Semantic-search vector (bge-small-en-v1.5). Bring-your-own vectors
            // (embedded externally on the GPU box); optional so rows without an
            // embedding still index for keyword search.
            { name: 'embedding', type: 'float[]', num_dim: 384, optional: true }
        ]
    };

    await createTypesenseCollection(offSchema);
    console.log('Created collection: off_foods');

    // 2. Ingest FdcFood (approx 704 items or 0)
    console.log('\nSyncing FdcFood table to Typesense...');
    const fdcStart = performance.now();
    const fdcFoods = await prisma.fdcFood.findMany({
        include: { servings: true }
    });

    if (fdcFoods.length > 0) {
        console.log(`Fetched ${fdcFoods.length} FDC foods. Formatting...`);
        const fdcDocs = fdcFoods.map(f => ({
            fdcId: String(f.fdcId),
            description: f.description,
            brandName: f.brandName || '',
            dataType: f.dataType || 'Generic',
            nutrientsPer100g: JSON.stringify(f.nutrientsPer100g),
            servings: JSON.stringify(f.servings.map(s => ({
                description: s.description,
                grams: s.grams
            })))
        }));

        console.log('Uploading FDC documents to Typesense...');
        const importRes = await importTypesenseDocuments('fdc_foods', fdcDocs);
        console.log('Import completed.');
    } else {
        console.log('No FDC foods found in PostgreSQL database.');
    }
    const fdcTime = (performance.now() - fdcStart) / 1000;
    console.log(`✅ FdcFood synchronization complete in ${fdcTime.toFixed(2)}s.`);

    // 3. Ingest OffFood (approx 4.22M items)
    console.log('\nSyncing OffFood table (in batches)...');
    const offStart = performance.now();

    let offset = 0;
    let lastBarcode = '';
    // Smaller batches than the old 25k: each doc now carries a 384-float vector
    // (~1.6KB), so 10k keeps the import payload ~16MB. Keyset pagination on the
    // barcode PK avoids the growing cost of OFFSET on a 1M-row table.
    const batchSize = 10000;
    let embedded = 0;

    while (true) {
        // Raw SQL because `embedding` is a Prisma `Unsupported("vector(384)")`
        // column and can't be selected via the typed client. embedding::text
        // yields pgvector's '[f1,f2,...]' form, which is valid JSON -> number[].
        const batch = await prisma.$queryRaw<Array<{
            barcode: string;
            name: string;
            brandName: string | null;
            nutrientsPer100g: unknown;
            servingGrams: number | null;
            servingSize: string | null;
            categories: string | null;
            embedding: string | null;
        }>>`
            SELECT barcode, name, "brandName", "nutrientsPer100g",
                   "servingGrams", "servingSize", categories,
                   embedding::text AS embedding
            FROM "OffFood"
            WHERE barcode > ${lastBarcode}
              AND "duplicateOfBarcode" IS NULL
              AND "corruptReason" IS NULL
            ORDER BY barcode ASC
            LIMIT ${batchSize}
        `;

        if (batch.length === 0) break;
        lastBarcode = batch[batch.length - 1].barcode;

        const offDocs = batch.map(f => {
            const doc: Record<string, unknown> = {
                id: String(f.barcode), // key TS doc by barcode so upserts are idempotent (no duplicates)
                barcode: String(f.barcode),
                name: f.name,
                brandName: f.brandName || '',
                nutrientsPer100g: JSON.stringify(f.nutrientsPer100g || {}),
                servingGrams: f.servingGrams != null ? Number(f.servingGrams) : null,
                servingSize: f.servingSize || '',
                categories: f.categories || '',
                hasCountServing: servingLabelHasPieceCount(f.servingSize, f.servingGrams != null ? Number(f.servingGrams) : null)
            };
            if (f.embedding) {
                doc.embedding = JSON.parse(f.embedding) as number[];
                embedded++;
            }
            return doc;
        });

        await importTypesenseDocuments('off_foods', offDocs);
        offset += batch.length;
        console.log(`Ingested OFF ${offset.toLocaleString()} rows (last barcode ${lastBarcode})`);
    }
    console.log(`  of which ${embedded.toLocaleString()} carried an embedding.`);

    const offTime = (performance.now() - offStart) / 1000;
    console.log(`✅ OffFood synchronization complete in ${offTime.toFixed(2)}s.`);
    console.log(`Synced ${offset.toLocaleString()} total OFF products.`);

    await prisma.$disconnect();
}

main().catch(err => {
    console.error('❌ Typesense sync script crashed:', err);
    process.exit(1);
});
