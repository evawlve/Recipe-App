/**
 * Add Curated Serving Overrides
 * 
 * Fixes known incorrect serving data from FatSecret by creating
 * properly-weighted serving entries in FatSecretServingCache.
 * 
 * Run with: npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/add-curated-servings.ts
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

interface CuratedServing {
    foodId: string;
    foodName: string;
    description: string;
    metricServingAmount: number;
    metricServingUnit: string;
    note: string;
}

// Curated serving corrections for known FatSecret data quality issues
const CURATED_SERVINGS: CuratedServing[] = [
    {
        foodId: '4350223',
        foodName: 'Crushed Red Pepper Flakes (McCormick)',
        description: '1 tsp',
        metricServingAmount: 1.8,  // Standard density for crushed dried pepper
        metricServingUnit: 'g',
        note: 'Curated: FatSecret lists 0.32g which yields 1563 kcal/100g. Real dried pepper flakes are ~1.8g/tsp and ~300 kcal/100g.',
    },
];

async function main() {
    console.log('Adding curated serving overrides...\n');

    for (const serving of CURATED_SERVINGS) {
        console.log(`Processing: ${serving.foodName}`);

        // Check if food exists in cache
        const food = await prisma.fatSecretFoodCache.findUnique({
            where: { id: serving.foodId },
            include: { servings: true },
        });

        if (!food) {
            console.log(`  ⚠️ Food ID ${serving.foodId} not in cache. Will be applied on next hydration.`);
            continue;
        }

        // Check if curated serving already exists
        const existingCurated = food.servings.find(s =>
            s.source === 'curated' && s.measurementDescription === serving.description
        );

        if (existingCurated) {
            console.log(`  ✓ Curated serving already exists (${existingCurated.metricServingAmount}g)`);
            continue;
        }

        // Find the original FatSecret serving to compare
        const original = food.servings.find(s =>
            s.measurementDescription?.toLowerCase().includes('tsp') ||
            s.measurementDescription === serving.description
        );

        if (original) {
            console.log(`  Original: ${original.measurementDescription} = ${original.metricServingAmount}g`);
        }

        // Create new curated serving
        await prisma.fatSecretServingCache.create({
            data: {
                id: `curated-${serving.foodId}-${serving.description.replace(/\s+/g, '-')}`,
                foodId: serving.foodId,
                measurementDescription: serving.description,
                numberOfUnits: 1,
                metricServingAmount: serving.metricServingAmount,
                metricServingUnit: serving.metricServingUnit,
                isDefault: true,  // Prefer curated over original
                source: 'curated',
                confidence: 1.0,
                note: serving.note,
            },
        });

        console.log(`  ✅ Added curated serving: ${serving.description} = ${serving.metricServingAmount}g`);
    }

    console.log('\n✅ Done!');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
