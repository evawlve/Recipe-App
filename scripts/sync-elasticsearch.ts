import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { performance } from 'perf_hooks';
import {
    createElasticIndex,
    bulkIndexElastic,
    isElasticAvailable
} from '../src/lib/search/elasticsearch-client';

async function main() {
    console.log('🚀 Starting Elasticsearch database synchronization...');

    if (!(await isElasticAvailable())) {
        console.error('❌ Elasticsearch is not running or unreachable. Please check your configuration.');
        process.exit(1);
    }

    const prisma = new PrismaClient();

    // 1. Recreate indices
    console.log('\nInitializing Elasticsearch indices...');

    const fdcMappings = {
        properties: {
            fdcId: { type: 'keyword' },
            description: { type: 'text' },
            brandName: { type: 'text' },
            dataType: { type: 'keyword', index: false },
            nutrientsPer100g: { type: 'object', enabled: false },
            servings: { type: 'object', enabled: false },
        },
    };
    await createElasticIndex('fdc_foods', fdcMappings);
    console.log('Created index: fdc_foods');

    const offMappings = {
        properties: {
            barcode: { type: 'keyword' },
            name: { type: 'text' },
            brandName: { type: 'text' },
            nutrientsPer100g: { type: 'object', enabled: false },
            servingGrams: { type: 'float', index: false },
            servingSize: { type: 'keyword', index: false },
            categories: { type: 'text', index: false },
        },
    };
    await createElasticIndex('off_foods', offMappings);
    console.log('Created index: off_foods');

    // 2. Ingest FdcFood
    console.log('\nSyncing FdcFood table to Elasticsearch...');
    const fdcStart = performance.now();
    const fdcFoods = await prisma.fdcFood.findMany({ include: { servings: true } });

    if (fdcFoods.length > 0) {
        console.log(`Fetched ${fdcFoods.length} FDC foods. Formatting...`);
        const fdcDocs = fdcFoods.map(f => ({
            id: String(f.fdcId),
            doc: {
                fdcId: String(f.fdcId),
                description: f.description,
                brandName: f.brandName || '',
                dataType: f.dataType || 'Generic',
                nutrientsPer100g: f.nutrientsPer100g || {},
                servings: f.servings.map(s => ({ description: s.description, grams: s.grams })),
            },
        }));
        await bulkIndexElastic('fdc_foods', fdcDocs);
        console.log('Import completed.');
    } else {
        console.log('No FDC foods found in PostgreSQL database.');
    }
    const fdcTime = (performance.now() - fdcStart) / 1000;
    console.log(`✅ FdcFood synchronization complete in ${fdcTime.toFixed(2)}s.`);

    // 3. Ingest OffFood (in batches — 601k rows post re-ingest)
    console.log('\nSyncing OffFood table (in batches)...');
    const offStart = performance.now();

    let offset = 0;
    const batchSize = 5000; // ES bulk API is heavier per-doc than Typesense/Meili — smaller batches

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
                categories: true,
            },
            orderBy: { barcode: 'asc' },
        });

        if (batch.length === 0) break;

        const offDocs = batch.map(f => ({
            id: String(f.barcode),
            doc: {
                barcode: String(f.barcode),
                name: f.name,
                brandName: f.brandName || '',
                nutrientsPer100g: f.nutrientsPer100g || {},
                servingGrams: f.servingGrams != null ? Number(f.servingGrams) : null,
                servingSize: f.servingSize || '',
                categories: f.categories || '',
            },
        }));

        await bulkIndexElastic('off_foods', offDocs);
        console.log(`Ingested OFF batch ${offset.toLocaleString()} to ${(offset + batch.length).toLocaleString()}`);

        offset += batch.length;
    }

    const offTime = (performance.now() - offStart) / 1000;
    console.log(`✅ OffFood synchronization complete in ${offTime.toFixed(2)}s.`);
    console.log(`Synced ${offset.toLocaleString()} total OFF products.`);

    await prisma.$disconnect();
}

main().catch(err => {
    console.error('❌ Elasticsearch sync script crashed:', err);
    process.exit(1);
});
