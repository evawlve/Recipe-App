import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { performance } from 'perf_hooks';
import {
    createRediSearchIndex,
    getRedisClient,
    isRedisAvailable
} from '../src/lib/search/redisearch-client';

async function main() {
    console.log('🚀 Starting RediSearch database synchronization...');

    if (!(await isRedisAvailable())) {
        console.error('❌ Redis is not running or unreachable. Please check your configuration.');
        process.exit(1);
    }

    const prisma = new PrismaClient();
    const redis = await getRedisClient();

    // 1. Recreate RediSearch Indexes
    console.log('\nInitializing RediSearch indexes...');

    // FDC Foods
    const fdcSchemaFields = [
        'fdcId', 'TEXT', 'SORTABLE',
        'description', 'TEXT', 'SORTABLE',
        'brandName', 'TEXT', 'SORTABLE',
        'dataType', 'TEXT',
        'nutrientsPer100g', 'TEXT',
        'servings', 'TEXT'
    ];
    await createRediSearchIndex('fdc_foods', 'fdc:', fdcSchemaFields);
    console.log('Created RediSearch index: fdc_foods');

    // OFF Foods
    const offSchemaFields = [
        'barcode', 'TEXT', 'SORTABLE',
        'name', 'TEXT', 'SORTABLE',
        'brandName', 'TEXT', 'SORTABLE',
        'nutrientsPer100g', 'TEXT',
        'servingGrams', 'NUMERIC', 'SORTABLE',
        'servingSize', 'TEXT',
        'categories', 'TEXT'
    ];
    await createRediSearchIndex('off_foods', 'off:', offSchemaFields);
    console.log('Created RediSearch index: off_foods');

    // 2. Ingest FdcFood
    console.log('\nSyncing FdcFood table to Redis...');
    const fdcStart = performance.now();
    const fdcFoods = await prisma.fdcFood.findMany({
        include: { servings: true }
    });

    if (fdcFoods.length > 0) {
        console.log(`Fetched ${fdcFoods.length} FDC foods. Indexing...`);
        const pipeline = redis.multi();
        
        for (const f of fdcFoods) {
            const key = `fdc:${f.fdcId}`;
            pipeline.hSet(key, {
                fdcId: String(f.fdcId),
                description: f.description,
                brandName: f.brandName || '',
                dataType: f.dataType || 'Generic',
                nutrientsPer100g: JSON.stringify(f.nutrientsPer100g),
                servings: JSON.stringify(f.servings.map(s => ({
                    description: s.description,
                    grams: s.grams
                })))
            });
        }

        await pipeline.exec();
        console.log('FDC indexing complete.');
    } else {
        console.log('No FDC foods found in PostgreSQL database.');
    }
    const fdcTime = (performance.now() - fdcStart) / 1000;
    console.log(`✅ FdcFood synchronization complete in ${fdcTime.toFixed(2)}s.`);

    // 3. Ingest OffFood (approx 4.22M items)
    console.log('\nSyncing OffFood table to Redis (in batches)...');
    const offStart = performance.now();

    let offset = 0;
    const batchSize = 10000; // Pipelining batch size
    
    // Clear old hash keys first if there are any
    // FT.DROPINDEX deletes the index but NOT the underlying hashes by default in RediSearch (unless DD option is passed)
    // Dropping index and deleting hashes: we can drop index with 'DD' option to delete underlying hashes!
    // But since it's prefix-based, we'll recreate them anyway. If we want to purge:
    try {
        // RediSearch drop with DD deletes document hashes
        await redis.sendCommand(['FT.DROPINDEX', 'off_foods', 'DD']);
        console.log('Purged existing off_foods index and hashes.');
        // Re-create it since we dropped it
        await createRediSearchIndex('off_foods', 'off:', offSchemaFields);
    } catch (e) {
        // Did not exist or already dropped
    }

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

        const pipeline = redis.multi();
        
        for (const f of batch) {
            const key = `off:${f.barcode}`;
            
            // Redis hSet expects flat strings or numbers. Objects must be stringified.
            const doc: Record<string, string> = {
                barcode: String(f.barcode),
                name: f.name,
                brandName: f.brandName || '',
                nutrientsPer100g: JSON.stringify(f.nutrientsPer100g || {}),
                servingSize: f.servingSize || '',
                categories: f.categories || ''
            };
            if (f.servingGrams != null) {
                doc.servingGrams = String(f.servingGrams);
            }
            
            pipeline.hSet(key, doc);
        }

        await pipeline.exec();
        console.log(`Ingested OFF batch ${offset.toLocaleString()} to ${(offset + batch.length).toLocaleString()}`);
        
        offset += batch.length;
    }

    const offTime = (performance.now() - offStart) / 1000;
    console.log(`✅ OffFood synchronization complete in ${offTime.toFixed(2)}s.`);
    console.log(`Synced ${offset.toLocaleString()} total OFF products.`);

    await prisma.$disconnect();
    await redis.disconnect();
}

main().catch(err => {
    console.error('❌ Redis sync script crashed:', err);
    process.exit(1);
});
