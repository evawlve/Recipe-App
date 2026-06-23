#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { createFoodAlias } from '../src/lib/fatsecret/alias-manager';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

async function main() {
    console.log('\n🏷️  Backfilling FatSecret Food Aliases\n');
    console.log('='.repeat(50));

    // Find all ingredient mappings that have a FatSecret food ID
    const mappings = await prisma.ingredientFoodMap.findMany({
        where: {
            fatsecretFoodId: { not: null },
            confidence: { gte: 0.8 } // Only backfill high confidence mappings
        },
        include: {
            ingredient: true
        }
    });

    console.log(`Found ${mappings.length} high-confidence mappings to process.\n`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const map of mappings) {
        if (!map.fatsecretFoodId) continue;

        const ingredientLine = `${map.ingredient.qty} ${map.ingredient.unit} ${map.ingredient.name}`;
        const parsed = parseIngredientLine(ingredientLine);
        const aliasName = parsed?.name || map.ingredient.name;

        try {
            // We can't easily know if it was created or skipped without modifying createFoodAlias to return status,
            // but for this script we just want to ensure they exist.
            await createFoodAlias(map.fatsecretFoodId, aliasName, 'import');
            created++;
            if (created % 50 === 0) {
                process.stdout.write('.');
            }
        } catch (e) {
            errors++;
        }
    }

    console.log('\n\n' + '='.repeat(50));
    console.log(`Processed: ${mappings.length}`);
    console.log('Note: "Created" count includes existing aliases that were skipped.');
    console.log('Done!');
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
