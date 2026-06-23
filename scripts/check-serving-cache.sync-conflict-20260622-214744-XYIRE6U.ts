/**
 * Check Serving Cache Script
 * 
 * Usage:
 *   npx tsx scripts/check-serving-cache.ts "black olives"
 *   npx tsx scripts/check-serving-cache.ts "yeast" --source fdc
 *   npx tsx scripts/check-serving-cache.ts --foodId 12345
 * 
 * Options:
 *   --source fatsecret|fdc   Filter by data source (default: both)
 *   --foodId <id>            Query by specific food ID
 *   --ai-only                Only show AI-estimated servings
 *   --json                   Output as JSON
 */

import { prisma } from '../src/lib/db';

interface ServingInfo {
    id: string;
    foodId: string;
    foodName: string;
    source: 'fatsecret' | 'fdc';
    measurementDescription: string;
    servingWeightGrams: number;
    isAiEstimated: boolean;
}

async function main() {
    const args = process.argv.slice(2);

    // Parse arguments
    let searchTerm = '';
    let source: 'fatsecret' | 'fdc' | 'both' = 'both';
    let foodId: string | null = null;
    let aiOnly = false;
    let jsonOutput = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--source' && args[i + 1]) {
            source = args[++i] as 'fatsecret' | 'fdc';
        } else if (args[i] === '--foodId' && args[i + 1]) {
            foodId = args[++i];
        } else if (args[i] === '--ai-only') {
            aiOnly = true;
        } else if (args[i] === '--json') {
            jsonOutput = true;
        } else if (!args[i].startsWith('--')) {
            searchTerm = args[i];
        }
    }

    if (!searchTerm && !foodId) {
        console.log('Usage: npx tsx scripts/check-serving-cache.ts "search term" [options]');
        console.log('  --source fatsecret|fdc   Filter by data source');
        console.log('  --foodId <id>            Query by specific food ID');
        console.log('  --ai-only                Only show AI-estimated servings');
        console.log('  --json                   Output as JSON');
        process.exit(1);
    }

    const results: ServingInfo[] = [];

    // Search FatSecret
    if (source === 'both' || source === 'fatsecret') {
        let foods: Array<{ id: string; name: string }> = [];

        if (foodId && !foodId.startsWith('fdc_')) {
            const found = await prisma.fatSecretFoodCache.findUnique({
                where: { id: foodId }
            });
            if (found) foods = [{ id: found.id, name: found.name }];
        } else if (searchTerm) {
            // Use raw query for reliable case-insensitive search
            foods = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id, name FROM "FatSecretFoodCache" 
        WHERE name ILIKE ${'%' + searchTerm + '%'}
        LIMIT 20
      `;
        }

        for (const food of foods) {
            const where: any = { foodId: food.id };
            if (aiOnly) where.isAiEstimated = true;

            const servings = await prisma.fatSecretServingCache.findMany({ where });

            for (const serving of servings) {
                results.push({
                    id: serving.id,
                    foodId: food.id,
                    foodName: food.name,
                    source: 'fatsecret',
                    measurementDescription: serving.measurementDescription ?? 'unknown',
                    servingWeightGrams: serving.servingWeightGrams ?? 0,
                    isAiEstimated: serving.isAiEstimated ?? false
                });
            }
        }
    }

    // Search FDC
    if (source === 'both' || source === 'fdc') {
        let foods: Array<{ id: number; description: string }> = [];

        if (foodId && foodId.startsWith('fdc_')) {
            const fdcId = parseInt(foodId.replace('fdc_', ''));
            const found = await prisma.fdcFoodCache.findUnique({
                where: { id: fdcId }
            });
            if (found) foods = [{ id: found.id, description: found.description }];
        } else if (searchTerm) {
            // Use raw query for reliable case-insensitive search
            foods = await prisma.$queryRaw<Array<{ id: number; description: string }>>`
        SELECT id, description FROM "FdcFoodCache" 
        WHERE description ILIKE ${'%' + searchTerm + '%'}
        LIMIT 20
      `;
        }

        for (const food of foods) {
            const where: any = { fdcId: food.id };
            if (aiOnly) where.isAiEstimated = true;

            const servings = await prisma.fdcServingCache.findMany({ where });

            for (const serving of servings) {
                results.push({
                    id: String(serving.id),
                    foodId: `fdc_${food.id}`,
                    foodName: food.description,
                    source: 'fdc',
                    measurementDescription: serving.description,
                    servingWeightGrams: serving.grams,
                    isAiEstimated: serving.isAiEstimated ?? false
                });
            }
        }
    }

    // Output results
    if (jsonOutput) {
        console.log(JSON.stringify(results, null, 2));
    } else {
        // Group by food
        const grouped = new Map<string, ServingInfo[]>();
        for (const r of results) {
            const key = `${r.foodName} (${r.foodId})`;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(r);
        }

        if (grouped.size === 0) {
            console.log('No results found.');
        } else {
            for (const [key, servings] of grouped) {
                console.log(`\n${key}:`);
                console.log(`  Source: ${servings[0].source}`);
                console.log('  Servings:');
                for (const s of servings) {
                    const aiTag = s.isAiEstimated ? ' [AI]' : '';
                    console.log(`    - ${s.measurementDescription}: ${s.servingWeightGrams}g${aiTag}`);
                    console.log(`      ID: ${s.id}`);
                }
            }
        }

        console.log(`\nTotal: ${results.length} servings across ${grouped.size} foods`);
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
