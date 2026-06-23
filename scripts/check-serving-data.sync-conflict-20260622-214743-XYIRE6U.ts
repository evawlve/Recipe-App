/**
 * Check Serving Data Script
 * 
 * Diagnoses serving selection issues by showing all available servings
 * for a food and highlighting which ones can handle weight/volume/count requests.
 * 
 * Usage:
 *   npx ts-node scripts/check-serving-data.ts --food-id "1269847"
 *   npx ts-node scripts/check-serving-data.ts --food-name "sugar substitute"
 */

process.env.LOG_LEVEL = 'error';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [] });

// Weight units that require gram-based serving
const WEIGHT_UNITS = ['g', 'gram', 'grams', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'kg', 'kilogram'];

interface CliArgs {
    foodId?: string;
    foodName?: string;
}

function parseArgs(): CliArgs {
    const args = process.argv.slice(2);
    const result: CliArgs = {};

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--food-id' && args[i + 1]) {
            result.foodId = args[i + 1];
            i++;
        } else if (args[i] === '--food-name' && args[i + 1]) {
            result.foodName = args[i + 1];
            i++;
        }
    }

    return result;
}

function hasWeightServing(servings: any[]): boolean {
    return servings.some(s => {
        const unit = s.metricServingUnit?.toLowerCase() || '';
        const desc = s.measurementDescription?.toLowerCase() || '';
        return unit === 'g' || unit === 'gram' || unit === 'grams' ||
            desc === 'g' || desc === '100g' || desc === '100 g' ||
            (s.servingWeightGrams != null && s.servingWeightGrams > 0);
    });
}

function hasVolumeServing(servings: any[]): boolean {
    return servings.some(s => {
        const unit = s.metricServingUnit?.toLowerCase() || '';
        const desc = s.measurementDescription?.toLowerCase() || '';
        return ['cup', 'tbsp', 'tsp', 'ml', 'tablespoon', 'teaspoon'].some(v =>
            unit.includes(v) || desc.includes(v)
        );
    });
}

async function checkFatsecretFood(foodId: string) {
    const food = await prisma.fatSecretFoodCache.findUnique({
        where: { id: foodId },
        include: { servings: true }
    });

    if (!food) {
        console.log(`❌ FatSecret food not found: ${foodId}`);
        return;
    }

    console.log('\n' + '='.repeat(70));
    console.log(`FATSECRET FOOD: ${food.name}`);
    console.log('='.repeat(70));
    console.log(`ID: ${food.id}`);
    console.log(`Brand: ${food.brandName || '(none)'}`);

    const nutrients = food.nutrientsPer100g as any;
    if (nutrients) {
        console.log(`Nutrition: ${nutrients.calories || 'N/A'} kcal/100g`);
    }

    console.log(`\n📏 SERVINGS (${food.servings.length}):`);
    console.log('-'.repeat(60));

    for (const s of food.servings) {
        const unit = s.metricServingUnit || 'N/A';
        const weight = s.servingWeightGrams;
        const source = s.source || 'fatsecret';
        const isAi = s.source === 'ai' ? ' [AI]' : '';

        console.log(`  "${s.measurementDescription}" = ${weight}g (unit: ${unit})${isAi}`);
    }

    console.log('\n📊 CAPABILITY CHECK:');
    const canWeight = hasWeightServing(food.servings);
    const canVolume = hasVolumeServing(food.servings);

    console.log(`  ✓ Weight requests (oz/g/lb): ${canWeight ? '✅ YES' : '❌ NO - may need backfill'}`);
    console.log(`  ✓ Volume requests (cup/tbsp): ${canVolume ? '✅ YES' : '⚠️  NO'}`);

    if (!canWeight) {
        console.log('\n⚠️  ISSUE: This food lacks weight-based servings.');
        console.log('   Weight unit requests (oz, g, lb) may fail and fall back to other candidates.');
        console.log('   Fix: Run backfillWeightServing() to create a 100g reference serving.');
    }
}

async function searchFoods(name: string) {
    const foods = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: name, mode: 'insensitive' } },
        include: { servings: true },
        take: 5
    });

    if (foods.length === 0) {
        console.log(`❌ No foods found containing: "${name}"`);
        return;
    }

    console.log(`\nFound ${foods.length} foods matching "${name}":\n`);

    for (const food of foods) {
        const nutrients = food.nutrientsPer100g as any;
        const kcal = nutrients?.calories || 'N/A';
        const canWeight = hasWeightServing(food.servings);
        const canVolume = hasVolumeServing(food.servings);
        const weightIcon = canWeight ? '✅' : '❌';
        const volumeIcon = canVolume ? '✅' : '⚠️';

        console.log(`  ${food.id}: ${food.name} (${food.brandName || 'generic'})`);
        console.log(`     ${kcal} kcal/100g | Servings: ${food.servings.length} | Weight:${weightIcon} Volume:${volumeIcon}`);
    }

    console.log('\nUse --food-id to see details for a specific food.');
}

async function main() {
    const args = parseArgs();

    if (!args.foodId && !args.foodName) {
        console.log('Usage:');
        console.log('  --food-id "1269847"     Check specific food by ID');
        console.log('  --food-name "sweetener" Search foods by name');
        process.exit(1);
    }

    if (args.foodId) {
        await checkFatsecretFood(args.foodId);
    } else if (args.foodName) {
        await searchFoods(args.foodName);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
