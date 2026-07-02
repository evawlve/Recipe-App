import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { performance } from 'perf_hooks';

const HOST = process.env.MEILISEARCH_HOST ?? 'http://localhost:7700';
const KEY = process.env.MEILISEARCH_API_KEY ?? '';

async function meiliReq(endpoint: string, options: RequestInit = {}) {
    const url = `${HOST}${endpoint}`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (KEY) {
        headers['Authorization'] = `Bearer ${KEY}`;
    }
    const res = await fetch(url, { headers, ...options });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Meilisearch request to ${endpoint} failed: ${res.status} - ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitTask(taskUid: number) {
    while (true) {
        const task: any = await meiliReq(`/tasks/${taskUid}`);
        if (task.status === 'succeeded') {
            break;
        } else if (task.status === 'failed') {
            throw new Error(`Task ${taskUid} failed: ${JSON.stringify(task.error)}`);
        }
        await sleep(250);
    }
}

async function main() {
    console.log('🚀 Starting Meilisearch database synchronization...');
    console.log(`Meilisearch Host: ${HOST}`);

    const prisma = new PrismaClient();

    // 1. Initialize Indices
    console.log('\nInitializing indices...');
    
    // FDC Foods index
    try {
        await meiliReq('/indexes/fdc_foods', { method: 'DELETE' });
        console.log('Deleted existing index: fdc_foods');
    } catch (e) {}
    let task = await meiliReq('/indexes', {
        method: 'POST',
        body: JSON.stringify({ uid: 'fdc_foods', primaryKey: 'fdcId' })
    });
    await waitTask(task.taskUid);
    console.log('Created index: fdc_foods');

    // OFF Foods index
    try {
        await meiliReq('/indexes/off_foods', { method: 'DELETE' });
        console.log('Deleted existing index: off_foods');
    } catch (e) {}
    task = await meiliReq('/indexes', {
        method: 'POST',
        body: JSON.stringify({ uid: 'off_foods', primaryKey: 'barcode' })
    });
    await waitTask(task.taskUid);
    console.log('Created index: off_foods');

    // 2. Tune Settings (Searchable attributes, Typo tolerance, Synonyms, Stop words)
    console.log('\nApplying tuned settings to indices...');
    
    const synonyms = {
        'stberry': ['strawberries', 'strawberry'],
        'green pepper': ['bell pepper'],
        'green peppers': ['bell pepper'],
        'hot sauce': ['hot pepper sauce'],
        'celtic salt': ['sea salt'],
        'coriander': ['cilantro'],
        'cilantro seeds': ['coriander seeds'],
        'dry mustard': ['mustard powder'],
        'all purpose flour': ['flour'],
        'sweet potato': ['yam'],
        'sweet potatoes': ['yams']
    };

    const stopWords = [
        'of', 'and', 'the', 'a', 'an', 'with', 'divided', 
        'softened', 'fresh', 'raw', 'whole', 'pure', 
        'natural', 'organic', 'to', 'taste'
    ];

    const settings = {
        typoTolerance: {
            enabled: true,
            minWordSizeForTypos: {
                oneTypo: 3,  // Allow 1 typo on 3+ character words (Tuned for accuracy)
                twoTypos: 7
            }
        },
        synonyms,
        stopWords
    };

    task = await meiliReq('/indexes/fdc_foods/settings', {
        method: 'PATCH',
        body: JSON.stringify({
            ...settings,
            searchableAttributes: ['description', 'brandName']
        })
    });
    await waitTask(task.taskUid);

    task = await meiliReq('/indexes/off_foods/settings', {
        method: 'PATCH',
        body: JSON.stringify({
            ...settings,
            searchableAttributes: ['name', 'brandName']
        })
    });
    await waitTask(task.taskUid);
    console.log('Settings successfully applied.');

    // 3. Sync FDC Foods (704 items)
    console.log('\nSyncing FdcFood table...');
    const fdcStart = performance.now();
    const fdcFoods = await prisma.fdcFood.findMany({
        include: { servings: true }
    });
    console.log(`Fetched ${fdcFoods.length} FDC foods. Uploading...`);
    
    const fdcDocs = fdcFoods.map(f => ({
        fdcId: String(f.fdcId),
        description: f.description,
        brandName: f.brandName,
        dataType: f.dataType,
        nutrientsPer100g: f.nutrientsPer100g,
        servings: f.servings.map(s => ({
            description: s.description,
            grams: s.grams
        }))
    }));

    task = await meiliReq('/indexes/fdc_foods/documents', {
        method: 'POST',
        body: JSON.stringify(fdcDocs)
    });
    console.log(`Enqueued FDC ingestion task ${task.taskUid}. Waiting...`);
    await waitTask(task.taskUid);
    const fdcTime = (performance.now() - fdcStart) / 1000;
    console.log(`✅ FdcFood synchronization complete in ${fdcTime.toFixed(2)}s.`);

    // 4. Sync OFF Foods (377,369 items)
    console.log('\nSyncing OffFood table (in batches)...');
    const offStart = performance.now();
    
    let offset = 0;
    const batchSize = 20000;
    let lastOffTaskUid = 0;

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
            brandName: f.brandName,
            nutrientsPer100g: f.nutrientsPer100g,
            servingGrams: f.servingGrams,
            servingSize: f.servingSize,
            categories: f.categories
        }));

        task = await meiliReq('/indexes/off_foods/documents', {
            method: 'POST',
            body: JSON.stringify(offDocs)
        });
        lastOffTaskUid = task.taskUid;
        
        console.log(`Enqueued OFF batch ${offset.toLocaleString()} to ${(offset + batch.length).toLocaleString()} (Task: ${task.taskUid})`);
        
        offset += batch.length;
    }

    if (lastOffTaskUid > 0) {
        console.log(`Waiting for final Meilisearch OFF indexing task ${lastOffTaskUid} to complete...`);
        await waitTask(lastOffTaskUid);
    }
    
    const offTime = (performance.now() - offStart) / 1000;
    console.log(`✅ OffFood synchronization complete in ${offTime.toFixed(2)}s.`);
    console.log(`Synced ${offset.toLocaleString()} total OFF products.`);

    console.log('\n✨ Database synchronization finished successfully!');
    await prisma.$disconnect();
}

main().catch(err => {
    console.error('❌ Sync script crashed:', err);
    process.exit(1);
});
