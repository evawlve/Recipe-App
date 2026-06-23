#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { autoMapIngredients } from '../src/lib/nutrition/auto-map';

async function main() {
    console.log('\n🎯 Phase 2 Integration Test: Auto-Mapping with Cleanup Patterns\n');

    // Get first user
    const user = await prisma.user.findFirst();
    if (!user) {
        console.error('No users found');
        return;
    }

    // Create test recipe with our known failing ingredients
    const recipe = await prisma.recipe.create({
        data: {
            title: 'Phase 2 Cleanup Test',
            bodyMd: 'Testing cleanup pattern integration',
            authorId: user.id,
            ingredients: {
                create: [
                    { name: 'tsps ginger', qty: 2, unit: '' },
                    { name: 'tbsps cornstarch', qty: 3, unit: '' },
                    { name: 'chicken', qty: 1, unit: 'lb' }, // Should map (control)
                    { name: 'onions, diced', qty: 1, unit: '' }
                ]
            }
        }
    });

    console.log(`Created test recipe: ${recipe.id}\n`);

    try {
        // Run auto-mapping
        console.log('Running auto-map with cleanup patterns...\n');
        const mappedCount = await autoMapIngredients(recipe.id);

        // Check results
        const ingredients = await prisma.ingredient.findMany({
            where: { recipeId: recipe.id },
            include: { foodMaps: true }
        });

        console.log('📊 Results:\n');
        let successCount = 0;

        for (const ing of ingredients) {
            const isMapped = ing.foodMaps.some(m => (m as any).fatsecretFoodId);
            if (isMapped) successCount++;

            console.log(`${isMapped ? '✅' : '❌'} "${ing.name}"`);
            if (isMapped) {
                const mapping = ing.foodMaps[0] as any;
                console.log(`   → Confidence: ${mapping.fatsecretConfidence?.toFixed(2) || 'N/A'}`);
            }
        }

        console.log(`\n📈 Success Rate: ${successCount}/${ingredients.length} (${(successCount / ingredients.length * 100).toFixed(0)}%)`);

        // Check pattern usage stats
        const patterns = await prisma.ingredientCleanupPattern.findMany({
            where: { usageCount: { gt: 0 } },
            orderBy: { usageCount: 'desc' },
            take: 5
        });

        if (patterns.length > 0) {
            console.log('\n🔥 Most Used Cleanup Patterns:');
            patterns.forEach((p, i) => {
                console.log(`   ${i + 1}. ${p.description}`);
                console.log(`      Used: ${p.usageCount}x | Success Rate: ${p.successRate !== null ? `${(p.successRate * 100).toFixed(0)}%` : 'N/A'}`);
            });
        }

        // Check learned patterns
        const learnedPatterns = await prisma.ingredientCleanupPattern.findMany({
            where: { source: 'AI_LEARNED' }
        });

        if (learnedPatterns.length > 0) {
            console.log(`\n🤖 AI Learned Patterns: ${learnedPatterns.length}`);
            learnedPatterns.forEach(p => {
                console.log(`   - "${p.pattern}" (${p.description})`);
            });
        }

        console.log('\n✅ Integration test complete!');

        if (successCount === ingredients.length) {
            console.log('🎉 All ingredients mapped successfully!');
        } else {
            console.log(`⚠️  ${ingredients.length - successCount} ingredients still unmapped`);
            console.log('   These may need additional patterns or manual review.');
        }

    } finally {
        // Cleanup
        console.log('\n🧹 Cleaning up test data...');
        await prisma.recipe.delete({ where: { id: recipe.id } });
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
