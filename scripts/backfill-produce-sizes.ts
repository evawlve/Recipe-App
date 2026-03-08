/**
 * Batch Backfill Script for Produce Size Servings (OPTIMIZED)
 * 
 * Uses BATCHED AI calls to create small/medium/large servings for produce items.
 * Each item requires only 1 AI call instead of 3!
 * 
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/backfill-produce-sizes.ts [--dry-run] [--limit N]
 * 
 * Options:
 *   --dry-run   Show what would be backfilled without making changes
 *   --limit N   Only process first N items (for testing)
 */

process.env.DEBUG = '';

import { prisma } from '../src/lib/db';
import { isProduce } from '../src/lib/fatsecret/serving-backfill';
import { batchBackfillProduceSizes } from '../src/lib/fatsecret/ambiguous-unit-backfill';

const SIZE_UNITS = ['small', 'medium', 'large'];

interface ProduceItem {
    id: string;
    name: string;
    source: 'fatsecret' | 'fdc';
    missingSizes: string[];
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const limitIndex = args.indexOf('--limit');
    const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : undefined;

    console.log('=== Batch Produce Size Backfill (OPTIMIZED) ===\n');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log('Optimization: 1 AI call per item (instead of 3)');
    if (limit) console.log(`Limit: ${limit} items`);
    console.log('');

    // 1. Get all FatSecret produce items missing size servings
    const fatSecretFoods = await prisma.fatSecretFoodCache.findMany({
        select: {
            id: true,
            name: true,
            servings: {
                select: {
                    measurementDescription: true,
                }
            }
        }
    });

    const produceToBackfill: ProduceItem[] = [];

    for (const food of fatSecretFoods) {
        if (isProduce(food.name)) {
            const existingSizes = SIZE_UNITS.filter(size =>
                food.servings.some(s =>
                    s.measurementDescription?.toLowerCase().includes(size)
                )
            );
            const missingSizes = SIZE_UNITS.filter(s => !existingSizes.includes(s));

            if (missingSizes.length > 0) {
                produceToBackfill.push({
                    id: food.id,
                    name: food.name,
                    source: 'fatsecret',
                    missingSizes,
                });
            }
        }
    }

    // 2. Get all FDC produce items (FDC backfill not implemented yet, skip)
    const fdcFoods = await prisma.fdcFoodCache.findMany({
        select: {
            id: true,
            description: true,
            servings: {
                select: {
                    description: true,
                }
            }
        }
    });

    let fdcProduceCount = 0;
    for (const food of fdcFoods) {
        if (isProduce(food.description)) {
            fdcProduceCount++;
        }
    }

    // Filter to FatSecret only (FDC uses different backfill mechanism)
    const fatSecretOnly = produceToBackfill.filter(p => p.source === 'fatsecret');

    // Apply limit if specified
    const itemsToProcess = limit ? fatSecretOnly.slice(0, limit) : fatSecretOnly;
    const totalServingsToCreate = itemsToProcess.reduce((sum, p) => sum + p.missingSizes.length, 0);

    console.log(`Found ${fatSecretOnly.length} FatSecret produce items needing backfill`);
    console.log(`(FDC produce items: ${fdcProduceCount} - uses separate mechanism)`);
    console.log(`Total servings to create: ${totalServingsToCreate}`);
    console.log(`AI calls needed: ${itemsToProcess.length} (1 per item, not ${totalServingsToCreate})`);
    console.log(`Processing: ${itemsToProcess.length} items\n`);

    if (dryRun) {
        console.log('--- DRY RUN - Items that would be backfilled ---\n');
        for (const item of itemsToProcess.slice(0, 20)) {
            console.log(`  [${item.source}] ${item.name}`);
            console.log(`    Missing: ${item.missingSizes.join(', ')}`);
        }
        if (itemsToProcess.length > 20) {
            console.log(`  ... and ${itemsToProcess.length - 20} more`);
        }
        await prisma.$disconnect();
        return;
    }

    // 3. Process backfills with progress reporting
    let processed = 0;
    let totalCreated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    const errorItems: { name: string; error: string }[] = [];
    const successItems: { name: string; created: string[] }[] = [];

    console.log('Starting batched backfill...\n');

    for (const item of itemsToProcess) {
        const result = await batchBackfillProduceSizes(item.id, item.name);

        if (result.status === 'success' || result.status === 'partial') {
            totalCreated += result.created.length;
            totalSkipped += result.skipped.length;

            if (result.created.length > 0) {
                successItems.push({
                    name: item.name,
                    created: result.created.map(c => `${c.size}: ${c.grams}g`),
                });
            }
        } else {
            totalErrors++;
            errorItems.push({
                name: item.name,
                error: result.error || 'Unknown error',
            });
        }

        processed++;

        // Progress update every 10 items
        if (processed % 10 === 0 || processed === itemsToProcess.length) {
            const pct = Math.round((processed / itemsToProcess.length) * 100);
            console.log(`Progress: ${processed}/${itemsToProcess.length} (${pct}%) - Created: ${totalCreated}, Skipped: ${totalSkipped}, Errors: ${totalErrors}`);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    // 4. Print summary
    console.log('\n=== Backfill Complete ===\n');
    console.log(`Total items processed: ${processed}`);
    console.log(`AI calls made: ${processed} (saved ${totalServingsToCreate - processed} calls!)`);
    console.log(`Servings created: ${totalCreated}`);
    console.log(`Servings skipped (already exist): ${totalSkipped}`);
    console.log(`Errors: ${totalErrors}`);

    // Show sample of errors
    if (errorItems.length > 0) {
        console.log('\n--- Items with errors (first 10) ---\n');
        for (const item of errorItems.slice(0, 10)) {
            console.log(`  ${item.name}: ${item.error}`);
        }
    }

    // Show sample of successes
    if (successItems.length > 0) {
        console.log('\n--- Sample successful backfills (first 10) ---\n');
        for (const item of successItems.slice(0, 10)) {
            console.log(`  ${item.name}`);
            console.log(`    Created: ${item.created.join(', ')}`);
        }
    }

    await prisma.$disconnect();
}

main().catch(console.error);
