#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.log('Usage: npx ts-node scripts/add-user-override.ts <ingredient name> <foodId> <servingId> [source]');
        console.log('Example: npx ts-node scripts/add-user-override.ts "ketchup" "12345" "54321" "fatsecret"');
        process.exit(1);
    }

    const [ingredientName, foodId, servingId, source = 'fatsecret'] = args;
    const normalizedName = normalizeIngredientName(ingredientName).cleaned;

    console.log(`\n🔧 Adding User Override for "${ingredientName}" (normalized: "${normalizedName}")\n`);

    try {
        const data: any = {
            normalizedName,
            confidence: 1.0, // Overrides are always 100% confident
            source,
            isUserOverride: true,
            createdBy: 'script-override',
            lastUsed: new Date(),
            usageCount: 0
        };

        if (source === 'fatsecret') {
            data.fatsecretFoodId = foodId;
            data.fatsecretServingId = servingId;
        } else if (source === 'fdc') {
            data.fdcId = parseInt(foodId, 10);
        }

        const result = await (prisma as any).globalIngredientMapping.upsert({
            where: { normalizedName },
            update: {
                ...data,
                usageCount: { increment: 0 } // Don't reset usage count
            },
            create: data
        });

        console.log('✅ Override added successfully!');
        console.log(result);

    } catch (error) {
        console.error('❌ Failed to add override:', error);
    }
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
