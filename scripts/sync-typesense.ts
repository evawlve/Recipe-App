import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { performance } from 'perf_hooks';
import {
    createTypesenseCollection,
    deleteTypesenseCollection,
    importTypesenseDocuments,
    isTypesenseAvailable
} from '../src/lib/search/typesense-client';

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
            { name: 'categories', type: 'string', optional: true, index: false }
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
    const batchSize = 25000; // Typesense is extremely fast with bulk imports

    while (true) {
        const batch = await prisma.offFood.findMany({
            skip: offset,
            take: batchSize,
            select: {
                barcode: true,
                name: true,
                brandName: true,
                nutrientsPer100g: true,
                servingGrams: true,
                servingSize: true,
                categories: true
            },
            orderBy: { barcode: 'asc' }
        });

        if (batch.length === 0) break;

        const offDocs = batch.map(f => ({
            barcode: String(f.barcode),
            name: f.name,
            brandName: f.brandName || '',
            nutrientsPer100g: JSON.stringify(f.nutrientsPer100g || {}),
            servingGrams: f.servingGrams != null ? Number(f.servingGrams) : null,
            servingSize: f.servingSize || '',
            categories: f.categories || ''
        }));

        await importTypesenseDocuments('off_foods', offDocs);
        console.log(`Ingested OFF batch ${offset.toLocaleString()} to ${(offset + batch.length).toLocaleString()}`);
        
        offset += batch.length;
    }

    const offTime = (performance.now() - offStart) / 1000;
    console.log(`✅ OffFood synchronization complete in ${offTime.toFixed(2)}s.`);
    console.log(`Synced ${offset.toLocaleString()} total OFF products.`);

    await prisma.$disconnect();
}

main().catch(err => {
    console.error('❌ Typesense sync script crashed:', err);
    process.exit(1);
});
